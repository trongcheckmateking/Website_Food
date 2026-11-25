use super::*;
use axum::extract::Path;
use serde::Deserialize;
use subtle::ConstantTimeEq;

#[derive(Deserialize)]
pub struct Destination {
    address: String,
}
async fn goong(a: &App, path: &str, mut params: Vec<(&str, String)>) -> Result<Value> {
    let key = setting("GOONG_API_KEY");
    if key.is_empty() {
        return Err(bad("Quán chưa bật tính phí giao theo địa chỉ."));
    }
    params.push(("api_key", key));
    a.http
        .get(format!(
            "{}/{path}",
            std::env::var("GOONG_BASE_URL")
                .unwrap_or_else(|_| "https://rsapi.goong.io".into())
                .trim_end_matches('/')
        ))
        .query(&params)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| bad("Dịch vụ bản đồ chưa phản hồi."))?
        .json()
        .await
        .map_err(|_| bad("Không đọc được bản đồ."))
}
fn fee_for(m: i32, free: i32, rate: i32) -> Result<i32> {
    let extra_meters = (i64::from(m) - i64::from(free)).max(0);
    let steps = (extra_meters + 999) / 1000;
    i32::try_from(steps * i64::from(rate)).map_err(|_| bad("Tuyến giao quá xa."))
}
pub async fn quote(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(p): Json<Destination>,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    if !(5..=500).contains(&p.address.trim().len()) {
        return Err(bad("Nhập đủ số nhà, đường và tỉnh thành."));
    }
    let (origin, free, rate): (String, i32, i32) =
        sqlx::query_as("SELECT origin,free_m,per_km FROM shops WHERE slug=$1")
            .bind(&s)
            .fetch_one(&a.db)
            .await?;
    let geo = goong(&a, "geocode", vec![("address", p.address.clone())]).await?;
    let best = &geo["results"][0];
    let point = &best["geometry"]["location"];
    let lat = point["lat"]
        .as_f64()
        .ok_or_else(|| bad("Không tìm thấy địa chỉ."))?;
    let lng = point["lng"]
        .as_f64()
        .ok_or_else(|| bad("Không tìm thấy địa chỉ."))?;
    let route = goong(
        &a,
        "Direction",
        vec![
            ("origin", origin),
            ("destination", format!("{lat},{lng}")),
            ("vehicle", "bike".into()),
        ],
    )
    .await?;
    let meters = route["routes"][0]["legs"][0]["distance"]["value"]
        .as_i64()
        .and_then(|n| i32::try_from(n).ok())
        .filter(|n| *n >= 0)
        .ok_or_else(|| bad("Chưa tìm thấy đường giao hàng."))?;
    let address = best["formatted_address"].as_str().unwrap_or(&p.address);
    let fee = fee_for(meters, free, rate)?;
    let key = id();
    sqlx::query("INSERT INTO quotes(id,shop,buyer,address,meters,fee) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(&key)
        .bind(s)
        .bind(uid)
        .bind(address)
        .bind(meters)
        .bind(fee)
        .execute(&a.db)
        .await?;
    Ok(Json(
        json!({"id":key,"address":address,"meters":meters,"fee":fee}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    id: i64,
    account_number: String,
    code: Option<String>,
    transfer_type: String,
    transfer_amount: i64,
}
pub async fn webhook(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(p): Json<Transfer>,
) -> Result<Json<Value>> {
    let env_key: String = sqlx::query_scalar("SELECT webhook_env FROM shops WHERE slug=$1")
        .bind(&s)
        .fetch_one(&a.db)
        .await?;
    let secret = setting(&env_key);
    let provided = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Apikey "))
        .unwrap_or("");
    if secret.is_empty() || !bool::from(provided.as_bytes().ct_eq(secret.as_bytes())) {
        return Err(denied());
    }
    if p.transfer_type != "in" {
        return Ok(Json(json!({"success":true})));
    }
    let code = p.code.unwrap_or_default();
    let mut tx = a.db.begin().await?;
    let r=sqlx::query("INSERT INTO transfers(shop,external_id,code,amount) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(&s).bind(p.id.to_string()).bind(&code).bind(p.transfer_amount).execute(&mut *tx).await?;
    if r.rows_affected() > 0 {
        let updated=sqlx::query("UPDATE orders SET paid=true WHERE shop=$1 AND id=$2 AND account=$3 AND total=$4 AND method='qr' AND state='confirmed' AND NOT paid").bind(&s).bind(code).bind(p.account_number).bind(p.transfer_amount).execute(&mut *tx).await?;
        if updated.rows_affected() == 1 {
            sqlx::query("UPDATE transfers SET matched=true WHERE shop=$1 AND external_id=$2")
                .bind(s)
                .bind(p.id.to_string())
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(Json(json!({"success":true})))
}
#[derive(Deserialize)]
pub struct Device {
    device: String,
}
pub async fn subscribe(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(p): Json<Device>,
) -> Result<Json<Value>> {
    owner(&a, &s, &user(&a, &h).await?).await?;
    if uuid::Uuid::parse_str(&p.device).is_err() {
        return Err(bad("Thiết bị không hợp lệ."));
    }
    sqlx::query("INSERT INTO subscriptions VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(s)
        .bind(p.device)
        .execute(&a.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
pub async fn push(a: &App) -> Result<()> {
    let secret = setting("ONESIGNAL_API_KEY");
    if secret.is_empty() {
        return Ok(());
    }
    let job:Option<(String,String)>=sqlx::query_as("UPDATE push_jobs SET attempts=attempts+1,next_try=now()+interval '1 minute' WHERE order_id=(SELECT j.order_id FROM push_jobs j JOIN orders o ON j.order_id=o.id WHERE j.next_try<=now() AND j.attempts<10 AND o.state='pending' ORDER BY j.next_try LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING order_id,(SELECT shop FROM orders WHERE id=order_id)").fetch_optional(&a.db).await?;
    if let Some((order, shop)) = job {
        let devices: Vec<String> =
            sqlx::query_scalar("SELECT device FROM subscriptions WHERE shop=$1")
                .bind(&shop)
                .fetch_all(&a.db)
                .await?;
        if devices.is_empty() {
            return Ok(());
        }
        let payload = json!({"app_id":setting("ONESIGNAL_APP_ID"),"include_subscription_ids":devices,"contents":{"en":"Quán có đơn hàng mới. Mở trang quản lý để xác nhận."},"url":format!("{}/quan/{shop}",setting("PUBLIC_URL").trim_end_matches('/'))});
        let res = a
            .http
            .post(
                std::env::var("ONESIGNAL_ENDPOINT")
                    .unwrap_or_else(|_| "https://api.onesignal.com/notifications".into()),
            )
            .header("Authorization", format!("Key {secret}"))
            .json(&payload)
            .send()
            .await
            .map_err(|_| bad("Chưa gửi được thông báo."))?;
        if res.status().is_success() {
            sqlx::query("DELETE FROM push_jobs WHERE order_id=$1")
                .bind(order)
                .execute(&a.db)
                .await?;
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delivery_boundaries() {
        for (m, expected) in [
            (0, 0),
            (3000, 0),
            (3001, 10000),
            (4000, 10000),
            (4001, 20000),
        ] {
            assert_eq!(fee_for(m, 3000, 10000).ok(), Some(expected));
        }
    }
}
