//! Servidor do Project Club em Rust.
//!
//! Fase 1 (ver `rust/PLANO.md`): este binário fica na porta pública do app.
//! Rota já portada → responde aqui. O resto → [`proxy::forward`] repassa pro
//! Node (HTTP e WebSocket), que passa a escutar numa porta interna.

pub mod cache;
pub mod config;
pub mod proxy;
pub mod routes;

use axum::Router;
use axum::http::{HeaderName, HeaderValue};
use axum::routing::get;
use tower_http::set_header::SetResponseHeaderLayer;

#[derive(Clone)]
pub struct AppState {
    pub config: config::Config,
    pub cache: cache::Cache,
    /// cliente pro Node (proxy)
    pub http: proxy::HttpClient,
    /// cliente pra internet (GitHub etc.)
    pub web: reqwest::Client,
}

impl AppState {
    pub async fn new(config: config::Config) -> anyhow::Result<Self> {
        let cache = cache::Cache::connect(config.redis_url.as_deref()).await;
        let web = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()?;
        Ok(Self {
            config,
            cache,
            http: proxy::client(),
            web,
        })
    }
}

/// Rotas que o Rust responde sozinho. Levam os mesmos cabeçalhos de
/// segurança básicos que o helmet põe no Node, e `x-served-by: rust` pra
/// dar pra conferir de fora quem respondeu.
fn ported() -> Router<AppState> {
    let h = |name: &'static str, value: &'static str| {
        SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        )
    };
    Router::new()
        .route(
            "/api/system/desktop-latest",
            get(routes::system::desktop_latest),
        )
        .layer(h("x-content-type-options", "nosniff"))
        .layer(h("x-frame-options", "SAMEORIGIN"))
        .layer(h("referrer-policy", "no-referrer"))
        .layer(h("x-served-by", "rust"))
}

pub fn app(state: AppState) -> Router {
    ported().fallback(proxy::forward).with_state(state)
}
