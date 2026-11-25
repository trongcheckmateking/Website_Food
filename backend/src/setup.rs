use super::*;
pub async fn run(db: &PgPool) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let slug = env::var("SHOP_SLUG")?;
    if slug.is_empty()
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return Err("SHOP_SLUG phải gồm a-z, 0-9 hoặc dấu gạch nối.".into());
    }
    let owner = uuid::Uuid::parse_str(&env::var("SHOP_OWNER_ID")?)?.to_string();
    let origin = env::var("SHOP_ORIGIN")?;
    let (lat, lng) = origin
        .split_once(',')
        .ok_or("SHOP_ORIGIN cần dạng lat,lng")?;
    if !(-90.0..=90.0).contains(&lat.trim().parse::<f64>()?)
        || !(-180.0..=180.0).contains(&lng.trim().parse::<f64>()?)
    {
        return Err("Tọa độ ngoài phạm vi.".into());
    }
    let webhook = setting("SHOP_WEBHOOK_ENV");
    if !webhook.is_empty() && !webhook.starts_with("SEPAY_KEY_") {
        return Err("Tên biến khóa phải bắt đầu bằng SEPAY_KEY_".into());
    }
    let mut tx = db.begin().await?;
    sqlx::query("INSERT INTO shops(slug,name,owner_id,origin,bank,account,webhook_env) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,owner_id=excluded.owner_id,origin=excluded.origin,bank=excluded.bank,account=excluded.account,webhook_env=excluded.webhook_env").bind(&slug).bind(env::var("SHOP_NAME")?).bind(owner).bind(origin).bind(setting("SHOP_BANK")).bind(setting("SHOP_ACCOUNT")).bind(webhook).execute(&mut *tx).await?;
    tx.commit().await?;
    println!("Đã cấu hình /quan/{slug}");
    Ok(())
}
