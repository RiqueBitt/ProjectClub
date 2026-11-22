//! O que as rotas de conta recebem já pronto: corpo JSON (400) → login
//! (401/403/503) → limitador (429), na mesma ordem do Express.

use std::net::SocketAddr;

use axum::body::Bytes;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Response;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{AuthUser, error};
use crate::db::{self, Db};
use crate::params;
use crate::ratelimit::{self, Limit};
use crate::session::{self as s};
use crate::web;

/// Por quem o limitador conta: IP (padrão do express-rate-limit) ou conta
/// (`keyGenerator: (req) => \`u:${req.user.id}\``).
#[derive(Clone, Copy)]
pub enum By {
    Ip,
    User,
}

pub fn server_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Erro interno do servidor." }),
    )
}

pub fn err(status: StatusCode, msg: &str) -> Response {
    error(status, json!({ "error": msg }))
}
/// `logSecurityEvent`: registro de segurança (nunca derruba a ação).
pub async fn security_log(
    db: &Db,
    user_id: &str,
    action: &str,
    headers: &HeaderMap,
    ip: Option<&str>,
) {
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // `.slice(0, 200)` do JavaScript conta em UTF-16
    let device: String =
        String::from_utf16_lossy(&ua.encode_utf16().take(200).collect::<Vec<u16>>());
    let ip_hash = ip.map(|i| s::sha256_hex(i)[..32].to_string());
    let r = db::exec(
        db,
        "INSERT INTO SecurityLog (id, userId, action, device, ipHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        params![db::new_id(), user_id, action, (!device.is_empty()).then_some(device), ip_hash, db::now()],
    )
    .await;
    if let Err(e) = r {
        tracing::error!("[securityLog] falha ao registrar evento: {e}");
    }
}

/// Pedido já com corpo, login (se pede) e limitador (se tem).
pub struct Ctx {
    pub db: Db,
    pub body: Value,
    pub headers: HeaderMap,
    pub ip: Option<String>,
    pub user: Option<AuthUser>,
    /// Cabeçalhos dos limitadores que contaram (os de `/api` e o da rota).
    pub counted: Vec<ratelimit::Counted>,
}

/// Os três limitadores montados em `app.use('/api', ...)` no Node, que
/// valem pra tudo menos `/api/auth` e `/api/platform/status`:
/// leituras (GET, 4000/15 min por IP), "marcar como lido" (3000) e
/// escritas (400/15 min, pela conta quando o token é válido).
pub const READS: Limit = Limit {
    prefix: "reads",
    window_ms: 15 * 60 * 1000,
    max: 4000,
    message: None,
    standard: true,
    legacy: false,
};
pub const READMARKS: Limit = Limit {
    prefix: "readmarks",
    window_ms: 15 * 60 * 1000,
    max: 3000,
    message: None,
    standard: false,
    legacy: false,
};
pub const WRITES: Limit = Limit {
    prefix: "writes",
    window_ms: 15 * 60 * 1000,
    max: 400,
    message: None,
    standard: true,
    legacy: false,
};

/// `/conversations/<id>/read` e `/community/channels/<id>/read`.
fn is_read_mark(path: &str) -> bool {
    let seg: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let ok_id = |s: &str| !s.is_empty();
    matches!(seg.as_slice(), ["conversations", id, "read"] if ok_id(id))
        || matches!(seg.as_slice(), ["community", "channels", id, "read"] if ok_id(id))
}

async fn api_limits(
    state: &AppState,
    parts: &Parts,
    ip: Option<&str>,
) -> Result<Vec<ratelimit::Counted>, Box<Response>> {
    let Some(path) = parts.uri.path().strip_prefix("/api") else {
        return Ok(vec![]);
    };
    if path.starts_with("/auth") || path == "/platform/status" || path.starts_with("/internal") {
        return Ok(vec![]);
    }
    let ip_key = ip.unwrap_or("unknown");
    let user_or_ip = || {
        parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .and_then(|t| state.tokens.verify(t))
            .map(|c| format!("u:{}", c.sub))
            .unwrap_or_else(|| format!("ip:{ip_key}"))
    };
    let mut out = Vec::new();
    let method = &parts.method;
    if method == axum::http::Method::GET {
        out.push(ratelimit::guard(&state.cache, &READS, ip_key).await?);
    } else if method == axum::http::Method::POST && is_read_mark(path) {
        out.push(ratelimit::guard(&state.cache, &READMARKS, &user_or_ip()).await?);
    } else {
        out.push(ratelimit::guard(&state.cache, &WRITES, &user_or_ip()).await?);
    }
    Ok(out)
}

pub async fn prelude(
    state: &AppState,
    mut parts: Parts,
    body: &Bytes,
    needs_auth: bool,
    limit: Option<(&Limit, By)>,
) -> Result<Ctx, Box<Response>> {
    let Some(db) = state.db.clone() else {
        return Err(Box::new(server_error()));
    };
    let body = web::json_body(&parts.headers, body)?;
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let ip = s::client_ip(&parts.headers, peer);
    let mut counted = api_limits(state, &parts, ip.as_deref()).await?;
    let user = if needs_auth {
        match AuthUser::from_request_parts(&mut parts, state).await {
            Ok(u) => Some(u),
            Err(mut r) => {
                for c in &counted {
                    c.apply(&mut r);
                }
                return Err(Box::new(r));
            }
        }
    } else {
        None
    };
    let route_limit = match limit {
        Some((l, by)) => {
            let key = match (by, &user) {
                (By::User, Some(u)) => format!("u:{}", u.id),
                _ => ip.clone().unwrap_or_else(|| "unknown".into()),
            };
            match ratelimit::guard(&state.cache, l, &key).await {
                Ok(c) => Some(c),
                Err(mut r) => {
                    for c in &counted {
                        c.apply(&mut r);
                    }
                    return Err(r);
                }
            }
        }
        None => None,
    };
    counted.extend(route_limit);
    Ok(Ctx {
        db,
        body,
        headers: parts.headers,
        ip,
        user,
        counted,
    })
}

pub fn finish(out: anyhow::Result<Response>, counted: Vec<ratelimit::Counted>) -> Response {
    let mut res = out.unwrap_or_else(|e| {
        tracing::error!("[api] {e}");
        server_error()
    });
    for c in counted {
        c.apply(&mut res);
    }
    res
}

macro_rules! prelude_or_return {
    ($state:expr, $parts:expr, $body:expr, $auth:expr, $limit:expr) => {
        match $crate::routes::ctx::prelude(&$state, $parts, &$body, $auth, $limit).await {
            Ok(c) => c,
            Err(r) => return *r,
        }
    };
}
pub(crate) use prelude_or_return;

pub fn uid(c: &Ctx) -> &str {
    c.user.as_ref().map(|u| u.id.as_str()).unwrap_or_default()
}

/// `String(x || '')` do JavaScript.
pub fn js_string(v: Option<&Value>) -> String {
    fn conv(v: &Value) -> String {
        match v {
            Value::Null => "null".into(),
            Value::Bool(b) => b.to_string(),
            Value::Number(n) => match n.as_f64() {
                Some(f) => match db::js_number(f) {
                    Value::Number(m) => m.to_string(),
                    other => other.to_string(),
                },
                None => n.to_string(),
            },
            Value::String(s) => s.clone(),
            Value::Array(a) => a
                .iter()
                .map(|x| if x.is_null() { String::new() } else { conv(x) })
                .collect::<Vec<_>>()
                .join(","),
            Value::Object(_) => "[object Object]".into(),
        }
    }
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => String::new(),
        Some(Value::String(s)) if s.is_empty() => String::new(),
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => String::new(),
        Some(other) => conv(other),
    }
}

/// `encodeurl` (o que o Express faz no `Location`): escapa o que não pode
/// numa URL e deixa as sequências `%XX` como estão.
pub fn encode_url(p: &str) -> String {
    let bytes = p.as_bytes();
    let mut out = String::with_capacity(p.len());
    for (i, &b) in bytes.iter().enumerate() {
        let is_escape = b == b'%'
            && bytes.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
            && bytes.get(i + 2).is_some_and(u8::is_ascii_hexdigit);
        if is_escape || b.is_ascii_alphanumeric() || b"!#$&'()*+,-./:;=?@[]_~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Quanto o `Accept` quer um tipo: (q, especificidade) da faixa mais
/// específica que casa (`text/html` > `text/*` > `*/*`).
fn accept_q(accept: &str, ty: &str) -> (f32, u8) {
    let (main, _) = ty.split_once('/').unwrap_or((ty, ""));
    let mut best: Option<(f32, u8)> = None;
    for part in accept.split(',') {
        let mut it = part.split(';');
        let range = it.next().unwrap_or("").trim().to_ascii_lowercase();
        let q = it
            .filter_map(|p| p.trim().strip_prefix("q="))
            .find_map(|v| v.trim().parse::<f32>().ok())
            .unwrap_or(1.0);
        let spec = if range == ty {
            2
        } else if range == format!("{main}/*") {
            1
        } else if range == "*/*" {
            0
        } else {
            continue;
        };
        if best.is_none_or(|(_, s)| spec > s) {
            best = Some((q, spec));
        }
    }
    best.unwrap_or((0.0, 0))
}

/// `res.redirect(status, to)` do Express 5: `Location` com `encodeurl` e o
/// corpo pelo `Accept` (texto, HTML ou vazio).
pub fn redirect(headers: &HeaderMap, status: StatusCode, to: &str) -> Response {
    let to = encode_url(to);
    let reason = status.canonical_reason().unwrap_or("");
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*/*");
    let text = accept_q(accept, "text/plain");
    let html = accept_q(accept, "text/html");
    let (kind, body) = if text.0 <= 0.0 && html.0 <= 0.0 {
        (None, String::new())
    } else if html.0 > text.0 || (html.0 == text.0 && html.1 > text.1) {
        (
            Some("text/html; charset=utf-8"),
            format!("<p>{reason}. Redirecting to {}</p>", escape_html(&to)),
        )
    } else {
        (
            Some("text/plain; charset=utf-8"),
            format!("{reason}. Redirecting to {to}"),
        )
    };
    let mut res = Response::new(axum::body::Body::from(body));
    *res.status_mut() = status;
    let h = res.headers_mut();
    if let Ok(v) = axum::http::HeaderValue::from_str(&to) {
        h.insert(header::LOCATION, v);
    }
    if let Some(k) = kind {
        h.insert(
            header::CONTENT_TYPE,
            axum::http::HeaderValue::from_static(k),
        );
    }
    h.insert(header::VARY, axum::http::HeaderValue::from_static("Accept"));
    res
}

/// `Number(x)` do JavaScript (`None` = `undefined` → NaN).
pub fn js_to_number(v: Option<&Value>) -> f64 {
    fn from_str(s: &str) -> f64 {
        let t = s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
        if t.is_empty() {
            return 0.0;
        }
        let radix = |p: &str, r: u32| {
            t.strip_prefix(p)
                .or_else(|| t.strip_prefix(&p.to_uppercase()))
                .map(|d| {
                    u64::from_str_radix(d, r)
                        .map(|n| n as f64)
                        .unwrap_or(f64::NAN)
                })
        };
        if let Some(n) = radix("0x", 16)
            .or_else(|| radix("0b", 2))
            .or_else(|| radix("0o", 8))
        {
            return n;
        }
        match t {
            "Infinity" | "+Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            _ => {
                // só o formato decimal do JS (nada de "inf", "nan", "1_000")
                let ok = t
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b));
                if ok {
                    t.parse::<f64>().unwrap_or(f64::NAN)
                } else {
                    f64::NAN
                }
            }
        }
    }
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => from_str(s),
        Some(Value::Array(a)) => match a.as_slice() {
            [] => 0.0,
            [one] if !one.is_array() && !one.is_object() => match one {
                Value::Null => 0.0,
                other => from_str(&js_string(Some(other))),
            },
            _ => f64::NAN,
        },
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `Math.round` do JavaScript (meio arredonda pra cima, inclusive negativo).
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

/// `.slice(0, n)` do JavaScript (conta em UTF-16).
pub fn js_slice(v: &str, n: usize) -> String {
    String::from_utf16_lossy(&v.encode_utf16().take(n).collect::<Vec<u16>>())
}

/// `.trim()` do JavaScript.
pub fn js_trim(v: &str) -> &str {
    v.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpo_do_redirect_pelo_accept() {
        let mut h = HeaderMap::new();
        let r = redirect(&h, StatusCode::SEE_OTHER, "/login?a=1&b=2");
        assert_eq!(r.headers()["location"], "/login?a=1&b=2");
        assert_eq!(r.headers()["content-type"], "text/plain; charset=utf-8");
        h.insert(
            header::ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                .parse()
                .unwrap(),
        );
        let r = redirect(&h, StatusCode::FOUND, "/praça");
        assert_eq!(r.headers()["location"], "/pra%C3%A7a");
        assert_eq!(r.headers()["content-type"], "text/html; charset=utf-8");
        h.insert(header::ACCEPT, "application/json".parse().unwrap());
        let r = redirect(&h, StatusCode::FOUND, "/x");
        assert!(r.headers().get("content-type").is_none());
        assert_eq!(encode_url("/a%20b c"), "/a%20b%20c");
    }
}
