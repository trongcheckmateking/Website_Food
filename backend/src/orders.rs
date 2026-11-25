use super::*;
use crate::catalog::Topping;
use axum::extract::Path;
use serde::Deserialize;
use sqlx::{Postgres, Row, Transaction};

#[derive(Deserialize)]
pub struct Line {
    id: String,
    qty: i32,
    toppings: Vec<String>,
    note: String,
}
#[derive(Deserialize)]
pub struct Checkout {
    lines: Vec<Line>,
    method: String,
    phone: String,
    note: String,
    quote: Option<String>,
    request_id: String,
    expected_total: i64,
}
pub async fn create(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(mut p): Json<Checkout>,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    if p.lines.is_empty()
        || p.lines.len() > 60
        || !["cash", "qr"].contains(&p.method.as_str())
        || !(8..=16).contains(&p.phone.len())
        || !p.phone.chars().all(|c| c.is_ascii_digit() || c == '+')
        || p.note.len() > 1000
        || uuid::Uuid::parse_str(&p.request_id).is_err()
    {
        return Err(bad("Kiểm tra giỏ hàng và số điện thoại."));
    }
    let mut tx = a.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{uid}:{}", p.request_id))
        .execute(&mut *tx)
        .await?;
    if let Some(i) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM orders WHERE buyer=$1 AND request_id=$2 AND shop=$3",
    )
    .bind(&uid)
    .bind(&p.request_id)
    .bind(&s)
    .fetch_optional(&mut *tx)
    .await?
    {
        return Ok(Json(json!({"id":i})));
    }
    let (bank, account, key): (String, String, String) =
        sqlx::query_as("SELECT bank,account,webhook_env FROM shops WHERE slug=$1")
            .bind(&s)
            .fetch_one(&mut *tx)
            .await?;
    if p.method == "qr" && (bank.is_empty() || account.is_empty() || setting(&key).is_empty()) {
        return Err(bad("Quán chưa kết nối QR."));
    }
    let (address, fee): (String, i32) = if let Some(q) = p.quote {
        sqlx::query_as("DELETE FROM quotes WHERE id=$1 AND buyer=$2 AND shop=$3 AND created>now()-interval '15 minutes' RETURNING address,fee").bind(q).bind(&uid).bind(&s).fetch_optional(&mut *tx).await?.ok_or_else(||bad("Vui lòng tính lại phí giao."))?
    } else {
        ("".into(), 0)
    };
    let mut lines = Vec::new();
    let mut total = i64::from(fee);
    p.lines.sort_by(|x, y| x.id.cmp(&y.id));
    for line in p.lines {
        if !(1..=99).contains(&line.qty) || line.note.len() > 400 {
            return Err(bad("Số lượng hoặc ghi chú không hợp lệ."));
        }
        let (name,price,ts):(String,i32,Value)=sqlx::query_as("UPDATE items SET stock=stock-$3 WHERE shop=$1 AND id=$2 AND stock>=$3 RETURNING name,price,toppings").bind(&s).bind(&line.id).bind(line.qty).fetch_optional(&mut *tx).await?.ok_or_else(||bad("Có món đã hết hoặc không đủ số phần."))?;
        let options: Vec<Topping> =
            serde_json::from_value(ts).map_err(|_| bad("Dữ liệu topping lỗi."))?;
        let mut unit = price;
        let mut selected = Vec::new();
        for n in line.toppings {
            if selected.contains(&n) {
                return Err(bad("Topping bị trùng."));
            }
            unit += options
                .iter()
                .find(|t| t.name == n && t.available)
                .ok_or_else(|| bad("Topping đã hết hoặc thay đổi."))?
                .price;
            selected.push(n);
        }
        total += i64::from(unit) * i64::from(line.qty);
        lines.push(json!({"id":line.id,"name":name,"unit":unit,"qty":line.qty,"toppings":selected,"note":line.note}));
    }
    if total != p.expected_total {
        return Err(bad(
            "Giá món đã thay đổi. Hãy bỏ món cũ và chọn lại từ thực đơn.",
        ));
    }
    let i = format!("DH{}", &id()[..16].to_uppercase());
    sqlx::query("INSERT INTO orders(id,shop,buyer,request_id,method,phone,address,note,lines,fee,total,bank,account,expires) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()+interval '30 minutes')").bind(&i).bind(s).bind(uid).bind(p.request_id).bind(p.method).bind(p.phone).bind(address).bind(p.note).bind(json!(lines)).bind(fee).bind(total).bind(bank).bind(account).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO push_jobs(order_id) VALUES($1)")
        .bind(&i)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":i})))
}
pub async fn list(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',o.id,'state',state,'paid',paid,'total',total,'created',created) FROM orders o JOIN shops s ON o.shop=s.slug WHERE shop=$1 AND (buyer=$2 OR s.owner_id=$2) ORDER BY created DESC LIMIT 200").bind(s).bind(uid).fetch_all(&a.db).await?;
    Ok(Json(json!(rows)))
}
async fn access(a: &App, i: &str, uid: &str) -> Result<Value> {
    let row:Value=sqlx::query_scalar("SELECT (to_jsonb(o)-'request_id'-'buyer'-'bank'-'account') || jsonb_build_object('owner',s.owner_id=$2,'mine',o.buyer=$2) || CASE WHEN o.method='qr' AND o.state='confirmed' AND NOT o.paid THEN jsonb_build_object('bank',o.bank,'account',o.account) ELSE '{}'::jsonb END FROM orders o JOIN shops s ON o.shop=s.slug WHERE o.id=$1 AND (buyer=$2 OR owner_id=$2)").bind(i).bind(uid).fetch_one(&a.db).await?;
    Ok(row)
}
pub async fn detail(
    State(a): State<App>,
    Path(i): Path<String>,
    h: HeaderMap,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    let mut o = access(&a, &i, &uid).await?;
    let msgs:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('body',body,'mine',author=$2,'id',id,'created',created) FROM messages WHERE order_id=$1 ORDER BY id").bind(&i).bind(&uid).fetch_all(&a.db).await?;
    o["messages"] = json!(msgs);
    o["reviewed"] = json!(
        sqlx::query_scalar::<_, String>("SELECT item FROM reviews WHERE order_id=$1")
            .bind(i)
            .fetch_all(&a.db)
            .await?
    );
    Ok(Json(o))
}
async fn restore(tx: &mut Transaction<'_, Postgres>, i: &str, lines: Value) -> Result<()> {
    for l in lines.as_array().ok_or_else(|| bad("Dữ liệu đơn lỗi."))? {
        sqlx::query("UPDATE items SET stock=stock+$2 WHERE id=$1")
            .bind(l["id"].as_str())
            .bind(l["qty"].as_i64().unwrap_or(0) as i32)
            .execute(&mut **tx)
            .await?;
    }
    sqlx::query("UPDATE orders SET state='cancelled',expires=NULL WHERE id=$1")
        .bind(i)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub async fn expire(a: &App) -> Result<()> {
    let mut tx = a.db.begin().await?;
    let rows=sqlx::query("SELECT id,lines FROM orders WHERE state IN ('pending','proposed') AND expires<=now() ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED").fetch_all(&mut *tx).await?;
    for r in rows {
        restore(&mut tx, &r.get::<String, _>("id"), r.get("lines")).await?
    }
    tx.commit().await?;
    Ok(())
}
#[derive(Deserialize)]
pub struct Action {
    action: String,
    total: Option<i64>,
    reason: Option<String>,
}
pub async fn change(
    State(a): State<App>,
    Path(i): Path<String>,
    h: HeaderMap,
    Json(p): Json<Action>,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    let mut tx = a.db.begin().await?;
    let (state,method,paid,lines,is_owner,buyer,expired):(String,String,bool,Value,bool,bool,bool)=sqlx::query_as("SELECT state,method,paid,lines,owner_id=$2,buyer=$2,coalesce(expires<=now(),false) FROM orders o JOIN shops s ON o.shop=s.slug WHERE o.id=$1 AND (owner_id=$2 OR buyer=$2) FOR UPDATE OF o").bind(&i).bind(uid).fetch_one(&mut *tx).await?;
    match p.action.as_str() {
        "cancel" if (state == "pending" || state == "proposed") && (buyer || is_owner) => {
            restore(&mut tx, &i, lines).await?
        }
        "propose" if is_owner && state == "pending" && !expired => {
            let total = p
                .total
                .filter(|t| (1..=1000000000).contains(t))
                .ok_or_else(|| bad("Tổng mới không hợp lệ."))?;
            let reason = p
                .reason
                .filter(|s| !s.trim().is_empty() && s.len() <= 600)
                .ok_or_else(|| bad("Cần lý do điều chỉnh."))?;
            sqlx::query("UPDATE orders SET state='proposed',proposed_total=$2,adjustment=$3,expires=now()+interval '30 minutes' WHERE id=$1").bind(i).bind(total).bind(reason).execute(&mut *tx).await?;
        }
        "accept" if buyer && state == "proposed" && !expired => {
            sqlx::query(
                "UPDATE orders SET state='confirmed',total=proposed_total,expires=NULL WHERE id=$1",
            )
            .bind(i)
            .execute(&mut *tx)
            .await?;
        }
        "confirm" if is_owner && state == "pending" && !expired => {
            sqlx::query("UPDATE orders SET state='confirmed',expires=NULL WHERE id=$1")
                .bind(i)
                .execute(&mut *tx)
                .await?;
        }
        "complete" if is_owner && state == "confirmed" && (paid || method == "cash") => {
            sqlx::query("UPDATE orders SET state='completed',paid=true WHERE id=$1")
                .bind(i)
                .execute(&mut *tx)
                .await?;
        }
        _ => return Err(bad("Đơn không thể chuyển trạng thái này.")),
    }
    tx.commit().await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Message {
    body: String,
}
pub async fn message(
    State(a): State<App>,
    Path(i): Path<String>,
    h: HeaderMap,
    Json(p): Json<Message>,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    access(&a, &i, &uid).await?;
    if p.body.trim().is_empty() || p.body.len() > 2000 {
        return Err(bad("Tin nhắn dài tối đa 2000 byte."));
    }
    sqlx::query("INSERT INTO messages(order_id,author,body) VALUES($1,$2,$3)")
        .bind(i)
        .bind(uid)
        .bind(p.body.trim())
        .execute(&a.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Review {
    item: String,
    stars: i32,
    body: String,
}
pub async fn review(
    State(a): State<App>,
    Path(i): Path<String>,
    h: HeaderMap,
    Json(p): Json<Review>,
) -> Result<Json<Value>> {
    let uid = user(&a, &h).await?;
    if !(1..=5).contains(&p.stars) || p.body.len() > 1500 {
        return Err(bad("Kiểm tra số sao và nhận xét."));
    }
    let r=sqlx::query("INSERT INTO reviews(order_id,item,stars,body) SELECT id,$3,$4,$5 FROM orders WHERE id=$1 AND buyer=$2 AND state='completed' AND lines @> jsonb_build_array(jsonb_build_object('id',$3::text)) ON CONFLICT DO NOTHING").bind(i).bind(uid).bind(p.item).bind(p.stars).bind(p.body).execute(&a.db).await?;
    if r.rows_affected() == 0 {
        return Err(bad("Bạn chưa nhận món hoặc đã đánh giá."));
    }
    Ok(Json(json!({"ok":true})))
}
