use super::*;
use axum::extract::Path;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone)]
pub struct Topping {
    pub name: String,
    pub price: i32,
    pub available: bool,
}
#[derive(Deserialize)]
pub struct Item {
    id: Option<String>,
    name: String,
    description: String,
    price: i32,
    stock_delta: i32,
    toppings: Vec<Topping>,
    photo: String,
}
pub async fn menu(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
) -> Result<Json<Value>> {
    let mut shop:Value=sqlx::query_scalar("SELECT jsonb_build_object('name',name,'free_m',free_m,'per_km',per_km,'qr',bank<>'' AND account<>'' AND webhook_env<>'') FROM shops WHERE slug=$1").bind(&s).fetch_one(&a.db).await?;
    let uid = if h.contains_key("authorization") {
        Some(user(&a, &h).await?)
    } else {
        None
    };
    shop["owner"] = json!(if let Some(u) = uid {
        owner(&a, &s, &u).await.is_ok()
    } else {
        false
    });
    let items:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(i)-'shop' || jsonb_build_object('reviews',COALESCE((SELECT jsonb_agg(to_jsonb(r)-'order_id'-'item') FROM reviews r WHERE r.item=i.id),'[]')) FROM items i WHERE shop=$1 ORDER BY name,id").bind(s).fetch_all(&a.db).await?;
    shop["items"] = json!(items);
    Ok(Json(shop))
}
pub async fn save(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(p): Json<Item>,
) -> Result<Json<Value>> {
    owner(&a, &s, &user(&a, &h).await?).await?;
    let mut names = std::collections::HashSet::new();
    if p.name.trim().is_empty()
        || p.name.len() > 200
        || p.description.len() > 1500
        || !(0..=1000000).contains(&p.price)
        || !(-10000..=10000).contains(&p.stock_delta)
        || p.toppings.len() > 20
        || p.toppings.iter().any(|t| {
            t.name.trim().is_empty()
                || t.name.len() > 100
                || !(0..=100000).contains(&t.price)
                || !names.insert(t.name.clone())
        })
        || !(p.photo.is_empty() || p.photo.starts_with("https://"))
    {
        return Err(bad("Kiểm tra tên, giá, số lượng và topping."));
    }
    let tops = json!(p.toppings);
    if let Some(i) = p.id {
        let changed=sqlx::query("UPDATE items SET name=$3,description=$4,price=$5,stock=stock+$6,toppings=$7,photo=$8 WHERE shop=$1 AND id=$2 AND stock+$6>=0").bind(s).bind(i).bind(p.name).bind(p.description).bind(p.price).bind(p.stock_delta).bind(tops).bind(p.photo).execute(&a.db).await?;
        if changed.rows_affected() == 0 {
            return Err(bad("Số phần còn lại đã thay đổi."));
        }
    } else {
        if p.stock_delta < 0 {
            return Err(bad("Tồn đầu kỳ phải dương hoặc bằng 0."));
        }
        sqlx::query("INSERT INTO items(shop,id,name,description,price,stock,toppings,photo) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(s).bind(id()).bind(p.name).bind(p.description).bind(p.price).bind(p.stock_delta).bind(tops).bind(p.photo).execute(&a.db).await?;
    }
    Ok(Json(json!({"ok":true})))
}
pub async fn counter(
    State(a): State<App>,
    Path((s, i)): Path<(String, String)>,
    h: HeaderMap,
) -> Result<Json<Value>> {
    owner(&a, &s, &user(&a, &h).await?).await?;
    let r = sqlx::query("UPDATE items SET stock=stock-1 WHERE shop=$1 AND id=$2 AND stock>0")
        .bind(s)
        .bind(i)
        .execute(&a.db)
        .await?;
    if r.rows_affected() == 0 {
        return Err(bad("Món đã hết."));
    }
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Settings {
    free_m: i32,
    per_km: i32,
}
pub async fn settings(
    State(a): State<App>,
    Path(s): Path<String>,
    h: HeaderMap,
    Json(p): Json<Settings>,
) -> Result<Json<Value>> {
    owner(&a, &s, &user(&a, &h).await?).await?;
    if !(0..=100000).contains(&p.free_m) || !(0..=1000000).contains(&p.per_km) {
        return Err(bad("Phí giao không hợp lệ."));
    }
    sqlx::query("UPDATE shops SET free_m=$2,per_km=$3 WHERE slug=$1")
        .bind(s)
        .bind(p.free_m)
        .bind(p.per_km)
        .execute(&a.db)
        .await?;
    Ok(Json(json!({"ok":true})))
}
