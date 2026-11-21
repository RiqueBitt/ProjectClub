//! Servidor do Project Club em Rust.
//!
//! Fase 1 (ver `rust/PLANO.md`): este binário fica na porta pública do app.
//! Rota já portada → responde aqui. O resto → [`proxy::forward`] repassa pro
//! Node (HTTP e WebSocket), que passa a escutar numa porta interna.

pub mod auth;
pub mod cache;
pub mod check;
pub mod config;
pub mod db;
pub mod iron;
pub mod node;
pub mod proxy;
pub mod qr;
pub mod ratelimit;
pub mod routes;
pub mod session;
pub mod totp;
pub mod users;
pub mod web;
pub mod webauthn;

use axum::Router;
use axum::http::StatusCode;
use axum::middleware::from_fn_with_state;
use axum::routing::{any, delete, get, post};
use tower_http::compression::CompressionLayer;

#[derive(Clone)]
pub struct AppState {
    pub config: config::Config,
    pub cache: cache::Cache,
    /// cliente pro Node (proxy)
    pub http: proxy::HttpClient,
    /// cliente pra internet (GitHub etc.)
    pub web: reqwest::Client,
    /// MySQL (None = sem DATABASE_URL: rotas que usam banco respondem erro)
    pub db: Option<db::Db>,
    pub tokens: auth::Tokens,
    pub auth_cache: auth::AuthCache,
    /// cache do `blockedIpGuard` (60 s por IP)
    pub block_cache: web::BlockCache,
}

impl AppState {
    pub async fn new(config: config::Config) -> anyhow::Result<Self> {
        let cache = cache::Cache::connect(config.redis_url.as_deref()).await;
        let web = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()?;
        let db = match config.database_url.as_deref() {
            Some(url) => Some(db::connect_lazy(url)?),
            None => None,
        };
        let tokens = auth::Tokens::new(&config.jwt_access_secret);
        Ok(Self {
            config,
            cache,
            http: proxy::client(),
            web,
            db,
            tokens,
            auth_cache: auth::AuthCache::default(),
            block_cache: web::BlockCache::default(),
        })
    }
}

/// Rotas que o Rust responde sozinho, com o que o Node faz em toda
/// requisição antes das rotas (`web.rs`): IP bloqueado → 503, cabeçalhos do
/// helmet e do cors, corpo até 5 MB e compressão. Método que o Rust não
/// tem pra aquele caminho (ex.: OPTIONS do CORS) vai pro Node.
fn ported(state: &AppState) -> Router<AppState> {
    Router::new()
        .route(
            "/api/system/desktop-latest",
            get(routes::system::desktop_latest),
        )
        .route("/api/auth/me", get(routes::auth::me))
        .route("/api/auth/login", post(routes::login::login))
        .route("/api/auth/register", post(routes::account::register))
        .route(
            "/api/auth/verify-email/send",
            post(routes::account::verify_email_send),
        )
        .route(
            "/api/auth/verify-email/confirm",
            post(routes::account::verify_email_confirm),
        )
        .route(
            "/api/auth/forgot-password",
            post(routes::account::forgot_password),
        )
        .route(
            "/api/auth/reset-password",
            post(routes::account::reset_password),
        )
        .route("/api/auth/2fa/setup", post(routes::account::twofa_setup))
        .route(
            "/api/auth/2fa/confirm",
            post(routes::account::twofa_confirm),
        )
        .route(
            "/api/auth/2fa/disable",
            post(routes::account::twofa_disable),
        )
        .route(
            "/api/auth/2fa/recovery-codes",
            get(routes::account::recovery_codes_status)
                .post(routes::account::recovery_codes_regenerate),
        )
        .route(
            "/api/auth/change-password",
            post(routes::account::change_password),
        )
        .route("/api/auth/refresh", post(routes::session::refresh))
        .route("/api/auth/logout", post(routes::session::logout))
        .route("/api/auth/sessions", get(routes::devices::list))
        .route(
            "/api/auth/sessions/other",
            delete(routes::devices::revoke_others),
        )
        .route(
            "/api/auth/sessions/{id}",
            delete(routes::devices::revoke_one),
        )
        .route(
            "/api/auth/delete-account",
            post(routes::devices::delete_account),
        )
        .route("/api/auth/deactivate", post(routes::devices::deactivate))
        .route(
            "/api/auth/switch/remember",
            post(routes::devices::switch_remember),
        )
        .route("/api/auth/switch", post(routes::devices::switch))
        .route(
            "/api/auth/switch/forget",
            post(routes::devices::switch_forget),
        )
        .route("/api/auth/qr/start", post(routes::qr_login::start))
        .route("/api/auth/qr/poll", post(routes::qr_login::poll))
        .route("/api/auth/qr/exchange", post(routes::qr_login::exchange))
        .route("/api/auth/qr/scan", post(routes::qr_login::scan))
        .route("/api/auth/qr/approve", post(routes::qr_login::approve))
        .route("/api/auth/qr/deny", post(routes::qr_login::deny))
        .route(
            "/api/auth/app-handoff",
            post(routes::qr_login::handoff_create),
        )
        .route(
            "/api/auth/app-handoff/{code}",
            get(routes::qr_login::handoff_consume),
        )
        .route("/api/auth/passkeys", get(routes::passkeys::list))
        .route(
            "/api/auth/passkeys/register/options",
            post(routes::passkeys::register_options),
        )
        .route(
            "/api/auth/passkeys/register/verify",
            post(routes::passkeys::register_verify),
        )
        .route(
            "/api/auth/passkeys/login/options",
            post(routes::passkeys::login_options),
        )
        .route(
            "/api/auth/passkeys/login/verify",
            post(routes::passkeys::login_verify),
        )
        .route("/api/auth/passkeys/{id}", delete(routes::passkeys::remove))
        // rotas internas (Rust → Node) não existem pra quem vem de fora
        .route("/api/internal", any(not_found))
        .route("/api/internal/{*rest}", any(not_found))
        .method_not_allowed_fallback(proxy::forward)
        .layer(web::body_limit())
        .layer(CompressionLayer::new())
        .layer(from_fn_with_state(state.clone(), web::headers))
        .layer(from_fn_with_state(state.clone(), web::blocked_ip_guard))
}

async fn not_found() -> axum::response::Response {
    auth::error(
        StatusCode::NOT_FOUND,
        serde_json::json!({ "error": "Rota não encontrada." }),
    )
}

pub fn app(state: AppState) -> Router {
    ported(&state).fallback(proxy::forward).with_state(state)
}
