//! O que o Node faz em TODA requisição antes das rotas (`server/src/app.js`)
//! e o Rust precisa fazer igual nas rotas que ele mesmo responde:
//!
//! - `blockedIpGuard` (`middleware/honeypot.js`): IP bloqueado (caiu nas
//!   rotas-isca) recebe 503 — com o mesmo cache de 60 s;
//! - cabeçalhos do `helmet` (os mesmos valores, conferidos em produção) e
//!   do `cors({ origin: CLIENT_ORIGIN, credentials: true })`;
//! - corpo JSON como o `express.json({ limit: '5mb' })`.
//!
//! As rotas-isca do honeypot em si nunca chegam aqui (o Node responde).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use tokio::sync::Mutex;

use crate::AppState;
use crate::db;

/// CSP do helmet configurada em `server/src/app.js` (com o navegador do
/// Project Club ligado, `frame-src` inclui `https:`).
const CSP: &str = "default-src 'self';script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com;\
script-src-elem 'self' https://www.youtube.com;style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;\
worker-src 'self' blob:;font-src 'self' https://fonts.gstatic.com;img-src 'self' data: blob: https:;\
media-src 'self' data: blob: https:;connect-src 'self' https://api.klipy.com https://fonts.googleapis.com \
wss: ws: stun: turn: turns:;frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https:;\
object-src 'none';base-uri 'self';frame-ancestors 'self';form-action 'self';script-src-attr 'none';\
upgrade-insecure-requests";

/// Cabeçalhos que o Node manda em toda resposta da API (helmet), copiados
/// de uma resposta de produção em 21/11/2026.
const SECURITY_HEADERS: [(&str, &str); 12] = [
    ("content-security-policy", CSP),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-resource-policy", "same-origin"),
    ("origin-agent-cluster", "?1"),
    ("referrer-policy", "no-referrer"),
    (
        "strict-transport-security",
        "max-age=15552000; includeSubDomains",
    ),
    ("x-content-type-options", "nosniff"),
    ("x-dns-prefetch-control", "off"),
    ("x-download-options", "noopen"),
    ("x-frame-options", "SAMEORIGIN"),
    ("x-permitted-cross-domain-policies", "none"),
    ("x-xss-protection", "0"),
];

/// Quantas leituras o Rust errou (500) e o Node respondeu no lugar.
pub static GET_FALLBACKS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Porteiro das rotas portadas (a camada mais de fora):
///
/// - caminho listado em `PC_RUST_SKIP` vai direto pro Node (chave de
///   emergência por rota, sem precisar publicar nada);
/// - leitura (GET/HEAD) que der erro interno (500) no Rust é refeita no
///   Node, que ainda tem todas as rotas — quem pediu recebe a resposta do
///   Node e o erro fica no log pra corrigir. Escrita nunca é repetida.
pub async fn gate(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if crate::config::is_skipped(&state.config.skip_prefixes, req.uri().path()) {
        return crate::proxy::forward(State(state), req).await;
    }
    let readable =
        req.method() == axum::http::Method::GET || req.method() == axum::http::Method::HEAD;
    if !(readable && state.config.get_fallback) {
        return next.run(req).await;
    }
    let (method, uri, headers) = (
        req.method().clone(),
        req.uri().clone(),
        req.headers().clone(),
    );
    let res = next.run(req).await;
    if res.status() != StatusCode::INTERNAL_SERVER_ERROR
        || res.extensions().get::<crate::proxy::Proxied>().is_some()
    {
        return res;
    }
    GET_FALLBACKS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    tracing::error!(
        "[rust→node] {method} {path} deu 500 no Rust; respondendo pelo Node",
        path = uri.path()
    );
    let mut again = Request::new(Body::empty());
    *again.method_mut() = method;
    *again.uri_mut() = uri;
    *again.headers_mut() = headers;
    let node = crate::proxy::forward(State(state), again).await;
    // Node fora do ar: fica a resposta do Rust mesmo
    if node.status() == StatusCode::BAD_GATEWAY {
        return res;
    }
    node
}

/// Coloca os cabeçalhos do helmet e do cors numa resposta do Rust.
pub async fn headers(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let mut res = next.run(req).await;
    // resposta do Node (método que o Rust não tem): já vem pronta
    if res.extensions().get::<crate::proxy::Proxied>().is_some() {
        return res;
    }
    let h = res.headers_mut();
    for (name, value) in SECURITY_HEADERS {
        h.entry(HeaderName::from_static(name))
            .or_insert(HeaderValue::from_static(value));
    }
    if let Ok(origin) = HeaderValue::from_str(&state.config.client_origin) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    h.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    // `Vary` na ordem do Node: `Origin` (cors), o que a rota pôs (`Accept`
    // no redirecionamento) e `Accept-Encoding` (compression, só em texto/JSON)
    let mut vary = vec!["Origin".to_string()];
    for v in h
        .get_all(header::VARY)
        .iter()
        .filter_map(|v| v.to_str().ok())
    {
        for t in v.split(',').map(str::trim).filter(|t| !t.is_empty()) {
            if !t.eq_ignore_ascii_case("origin") && !t.eq_ignore_ascii_case("accept-encoding") {
                vary.push(t.to_string());
            }
        }
    }
    let compressible = h
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| t.starts_with("text/") || t.starts_with("application/json"));
    if compressible {
        vary.push("Accept-Encoding".into());
    }
    if let Ok(v) = HeaderValue::from_str(&vary.join(", ")) {
        h.insert(header::VARY, v);
    }
    h.insert("x-served-by", HeaderValue::from_static("rust"));
    res
}

/// `invalidateOnWrite` (`services/sharedCache.js`): escrita que deu certo
/// (2xx) nessas rotas apaga o cache compartilhado do carregamento.
const WRITE_PREFIXES: [(&str, &[&str]); 7] = [
    ("/community", &["community"]),
    ("/users", &["community"]),
    ("/clans", &["community"]),
    ("/decorations", &["community"]),
    (
        "/admin",
        &[
            "community",
            "status",
            "announcement",
            "uiLayout",
            "events",
            "appCatalog",
        ],
    ),
    ("/platform", &["status", "announcement", "community"]),
    ("/ui-layout", &["uiLayout"]),
];
const EVENTS_PREFIX: (&str, &[&str]) = ("/events", &["events"]);

fn shared_key(name: &str) -> &'static str {
    match name {
        "community" => "shared:community",
        "status" => "shared:platform-status",
        "events" => "shared:events",
        "uiLayout" => "shared:ui-layout",
        "announcement" => "shared:announcement",
        _ => "shared:app-catalog",
    }
}

/// As seções afetadas por uma escrita em `path` (sem o `/api`).
pub fn sections_for_path(path: &str) -> Vec<&'static str> {
    let mut hit: Vec<&'static str> = Vec::new();
    for (prefix, names) in WRITE_PREFIXES.iter().chain(std::iter::once(&EVENTS_PREFIX)) {
        let starts = path
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'));
        if starts {
            for n in *names {
                if !hit.contains(n) {
                    hit.push(n);
                }
            }
        }
    }
    hit
}

pub async fn invalidate_on_write(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let res = next.run(req).await;
    if matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS")
        || res.extensions().get::<crate::proxy::Proxied>().is_some()
        || !res.status().is_success()
    {
        return res;
    }
    if let Some(path) = path.strip_prefix("/api") {
        let names = sections_for_path(path);
        if !names.is_empty() {
            let cache = state.cache.clone();
            tokio::spawn(async move {
                for n in names {
                    let _ = cache.del(&format!("cache:{}", shared_key(n))).await;
                }
            });
        }
    }
    res
}

/// O que o `res.send` do Express faz com o corpo, nas rotas do Rust:
/// `charset=utf-8` no JSON, `ETag` fraco (`app.set('etag', 'weak')`) e 304
/// quando o navegador já tem a mesma resposta (`If-None-Match`).
pub async fn express_send(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let if_none_match = req
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let no_cache = req
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.to_ascii_lowercase().contains("no-cache"));
    let res = next.run(req).await;
    if res.extensions().get::<crate::proxy::Proxied>().is_some()
        || res.status().is_redirection()
        || res.headers().contains_key(header::ETAG)
    {
        return res;
    }
    let (mut parts, body) = res.into_parts();
    if parts
        .headers
        .get(header::CONTENT_TYPE)
        .is_some_and(|v| v == "application/json")
    {
        parts.headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
    }
    let Ok(bytes) = axum::body::to_bytes(body, 256 * 1024 * 1024).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let tag = weak_etag(&bytes);
    if let Ok(v) = HeaderValue::from_str(&tag) {
        parts.headers.insert(header::ETAG, v);
    }
    let fresh = (method == axum::http::Method::GET || method == axum::http::Method::HEAD)
        && (parts.status.is_success() || parts.status == StatusCode::NOT_MODIFIED)
        && !no_cache
        && if_none_match.is_some_and(|m| etag_matches(&m, &tag));
    if fresh {
        parts.status = StatusCode::NOT_MODIFIED;
        for h in [
            header::CONTENT_TYPE,
            header::CONTENT_LENGTH,
            header::TRANSFER_ENCODING,
        ] {
            parts.headers.remove(h);
        }
        return Response::from_parts(parts, Body::empty());
    }
    Response::from_parts(parts, Body::from(bytes))
}

/// `etag(body, { weak: true })`: `W/"<tamanho em hex>-<sha1 base64, 27>"`.
pub fn weak_etag(body: &[u8]) -> String {
    use base64::Engine;
    use sha1::Digest;
    if body.is_empty() {
        return "W/\"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk\"".into();
    }
    let hash = base64::engine::general_purpose::STANDARD.encode(sha1::Sha1::digest(body));
    format!("W/\"{:x}-{}\"", body.len(), &hash[..27])
}

/// `fresh`: o `If-None-Match` tem esta ETag (fraca ou não)?
fn etag_matches(header: &str, tag: &str) -> bool {
    let header = header.trim();
    if header == "*" {
        return true;
    }
    let strong = tag.strip_prefix("W/").unwrap_or(tag);
    header
        .split(',')
        .map(str::trim)
        .any(|m| m == tag || m == strong || m.strip_prefix("W/") == Some(strong))
}

/// Bloqueado até (ms; `i64::MAX` = sem prazo; `None` = livre) e quando entrou no cache.
type BlockEntry = (Option<i64>, Instant);

/// IP → [`BlockEntry`].
#[derive(Clone, Default)]
pub struct BlockCache(Arc<Mutex<HashMap<String, BlockEntry>>>);

const BLOCK_CACHE_TTL: Duration = Duration::from_secs(60);
const BLOCK_CACHE_MAX: usize = 10_000;

impl BlockCache {
    async fn blocked_until(&self, db: &db::Db, ip: &str) -> Result<Option<i64>, db::DbError> {
        if let Some((v, at)) = self.0.lock().await.get(ip).copied()
            && at.elapsed() < BLOCK_CACHE_TTL
        {
            return Ok(v);
        }
        let row = db::first(
            db,
            "SELECT expiresAt FROM BlockedIp WHERE ip = ?",
            crate::params![ip],
        )
        .await?;
        let until = match row {
            None => None,
            Some(r) => Some(
                db::get::<Option<chrono::NaiveDateTime>>(&r, "expiresAt")?
                    .map(|d| d.and_utc().timestamp_millis())
                    .unwrap_or(i64::MAX),
            ),
        };
        let mut map = self.0.lock().await;
        if map.len() >= BLOCK_CACHE_MAX {
            // simples: esvazia (o Node tira o mais antigo; aqui a próxima consulta repõe)
            map.clear();
        }
        map.insert(ip.to_string(), (until, Instant::now()));
        Ok(until)
    }
}

/// `blockedIpGuard`: IP na lista de bloqueio recebe a mesma página 503 do Node.
pub async fn blocked_ip_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let ip = crate::session::client_ip(req.headers(), peer).unwrap_or_else(|| "unknown".into());
    if let Some(db) = state.db.as_ref()
        && let Ok(Some(until)) = state.block_cache.blocked_until(db, &ip).await
        && until > chrono::Utc::now().timestamp_millis()
    {
        let mut r = (
            StatusCode::SERVICE_UNAVAILABLE,
            "<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1><p>The server is temporarily unable to service your request.</p></body></html>",
        )
            .into_response();
        r.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        );
        return r;
    }
    next.run(req).await
}

/// Limite do `express.json`.
pub const JSON_LIMIT: usize = 5 * 1024 * 1024;

/// Corpo como o `express.json()` deixa em `req.body`: só lê com
/// `Content-Type: application/json` (senão fica `{}`); JSON quebrado → 400;
/// grande demais → 413.
pub fn json_body(headers: &HeaderMap, body: &Bytes) -> Result<Value, Box<Response>> {
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .is_some_and(|t| {
            t == "application/json" || (t.starts_with("application/") && t.ends_with("+json"))
        });
    if !is_json || body.is_empty() {
        return Ok(json!({}));
    }
    if body.len() > JSON_LIMIT {
        return Err(Box::new(
            (
                StatusCode::PAYLOAD_TOO_LARGE,
                axum::Json(json!({ "error": "request entity too large" })),
            )
                .into_response(),
        ));
    }
    match serde_json::from_slice::<Value>(body) {
        // modo estrito do body-parser: só objeto ou lista no topo
        Ok(v) if v.is_object() || v.is_array() => Ok(v),
        Ok(_) => Err(Box::new(bad_json("JSON inválido: só objeto ou lista."))),
        Err(e) => Err(Box::new(bad_json(&format!("JSON inválido ({e})")))),
    }
}

fn bad_json(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, axum::Json(json!({ "error": msg }))).into_response()
}

/// Limite de corpo que o axum aplica antes do `json_body` (um pouco acima
/// de 5 MB, pra o `json_body` responder o 413 no formato do Node).
pub fn body_limit() -> axum::extract::DefaultBodyLimit {
    axum::extract::DefaultBodyLimit::max(JSON_LIMIT + 1)
}

/// Resposta vazia de erro sem corpo (para casos raros).
pub fn empty(status: StatusCode) -> Response {
    let mut r = Response::new(Body::empty());
    *r.status_mut() = status;
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(ct: &str) -> HeaderMap {
        let mut m = HeaderMap::new();
        m.insert(header::CONTENT_TYPE, HeaderValue::from_str(ct).unwrap());
        m
    }

    #[test]
    fn secoes_do_cache_como_o_node() {
        assert_eq!(sections_for_path("/users/me/theme"), ["community"]);
        assert_eq!(sections_for_path("/usersx"), Vec::<&str>::new());
        assert_eq!(
            sections_for_path("/platform"),
            ["status", "announcement", "community"]
        );
        assert_eq!(sections_for_path("/events/1"), ["events"]);
        assert!(sections_for_path("/messages/1").is_empty());
    }

    #[test]
    fn etag_como_o_express() {
        // `require('etag')('{"a":1}', { weak: true })`
        assert_eq!(
            weak_etag(br#"{"a":1}"#),
            "W/\"7-n4nHQM60bXQYySSnisV5QdXpZSA\""
        );
        assert!(etag_matches("W/\"7-x\", \"7-y\"", "W/\"7-y\""));
        assert!(!etag_matches("\"8-y\"", "W/\"7-y\""));
    }

    #[test]
    fn corpo_como_o_express() {
        assert_eq!(
            json_body(&h("application/json"), &Bytes::from(r#"{"a":1}"#)).unwrap(),
            json!({ "a": 1 })
        );
        assert_eq!(
            json_body(&h("application/json; charset=utf-8"), &Bytes::from("[1]")).unwrap(),
            json!([1])
        );
        // sem content-type json: corpo vazio
        assert_eq!(
            json_body(&h("text/plain"), &Bytes::from(r#"{"a":1}"#)).unwrap(),
            json!({})
        );
        assert_eq!(
            json_body(&HeaderMap::new(), &Bytes::from("x")).unwrap(),
            json!({})
        );
        assert_eq!(
            json_body(&h("application/json"), &Bytes::from("{ruim"))
                .unwrap_err()
                .status(),
            400
        );
        assert_eq!(
            json_body(&h("application/json"), &Bytes::from("123"))
                .unwrap_err()
                .status(),
            400
        );
        let big = Bytes::from(vec![b' '; JSON_LIMIT + 1]);
        assert_eq!(
            json_body(&h("application/json"), &big)
                .unwrap_err()
                .status(),
            413
        );
    }
}
