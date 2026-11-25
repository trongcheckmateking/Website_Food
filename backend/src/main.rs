mod catalog;
mod orders;
mod services;
mod setup;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::env;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Clone)]
struct App {
    db: PgPool,
    http: reqwest::Client,
    auth_url: String,
    anon: String,
}
struct Error(StatusCode, String);
type Result<T> = std::result::Result<T, Error>;
fn bad(msg: &str) -> Error {
    Error(StatusCode::BAD_REQUEST, msg.into())
}
fn denied() -> Error {
    Error(StatusCode::FORBIDDEN, "Không có quyền truy cập.".into())
}
fn setting(key: &str) -> String {
    env::var(key).unwrap_or_default()
}
fn id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        if matches!(e, sqlx::Error::RowNotFound) {
            return Error(StatusCode::NOT_FOUND, "Không tìm thấy dữ liệu.".into());
        }
        eprintln!("database: {e}");
        Error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Lỗi cơ sở dữ liệu.".into(),
        )
    }
}
async fn user(a: &App, h: &HeaderMap) -> Result<String> {
    let token = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(denied)?;
    let r = a
        .http
        .get(format!("{}/auth/v1/user", a.auth_url))
        .header("apikey", &a.anon)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| bad("Dịch vụ đăng nhập chưa phản hồi."))?;
    if !r.status().is_success() {
        return Err(denied());
    }
    let body: Value = r.json().await.map_err(|_| denied())?;
    body["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(denied)
}
async fn owner(a: &App, shop: &str, uid: &str) -> Result<()> {
    let yes: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM shops WHERE slug=$1 AND owner_id=$2)")
            .bind(shop)
            .bind(uid)
            .fetch_one(&a.db)
            .await?;
    if yes {
        Ok(())
    } else {
        Err(denied())
    }
}
async fn config(State(a): State<App>) -> Json<Value> {
    Json(
        json!({"url":a.auth_url,"key":a.anon,"push":setting("ONESIGNAL_APP_ID"),"shop":setting("DEFAULT_SHOP")}),
    )
}
#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let db = PgPool::connect(&env::var("DATABASE_URL")?).await?;
    sqlx::migrate!().run(&db).await?;
    if env::args().nth(1).as_deref() == Some("setup-shop") {
        return setup::run(&db).await;
    }
    let app = App {
        db,
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?,
        auth_url: env::var("SUPABASE_URL")?.trim_end_matches('/').into(),
        anon: env::var("SUPABASE_ANON_KEY")?,
    };
    let worker = app.clone();
    tokio::spawn(async move {
        loop {
            if let Err(e) = orders::expire(&worker).await {
                eprintln!("expire: {}", e.1)
            }
            if let Err(e) = services::push(&worker).await {
                eprintln!("push: {}", e.1)
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
    let web = env::var("WEB_DIST").unwrap_or_else(|_| "../frontend/dist".into());
    let api = Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/config", get(config))
        .route("/api/shop/{s}", get(catalog::menu))
        .route("/api/shop/{s}/items", post(catalog::save))
        .route("/api/shop/{s}/counter/{i}", post(catalog::counter))
        .route("/api/shop/{s}/settings", post(catalog::settings))
        .route("/api/shop/{s}/quote", post(services::quote))
        .route(
            "/api/shop/{s}/orders",
            get(orders::list).post(orders::create),
        )
        .route("/api/shop/{s}/subscription", post(services::subscribe))
        .route("/api/shop/{s}/webhook", post(services::webhook))
        .route("/api/order/{i}", get(orders::detail))
        .route("/api/order/{i}/state", post(orders::change))
        .route("/api/order/{i}/messages", post(orders::message))
        .route("/api/order/{i}/reviews", post(orders::review))
        .fallback_service(ServeDir::new(&web).fallback(ServeFile::new(format!("{web}/index.html"))))
        .with_state(app);
    let listener =
        tokio::net::TcpListener::bind(env::var("BIND").unwrap_or_else(|_| "127.0.0.1:3000".into()))
            .await?;
    axum::serve(listener, api).await?;
    Ok(())
}
