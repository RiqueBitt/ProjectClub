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
    pub counted: Option<ratelimit::Counted>,
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
    let user = if needs_auth {
        Some(
            AuthUser::from_request_parts(&mut parts, state)
                .await
                .map_err(Box::new)?,
        )
    } else {
        None
    };
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let ip = s::client_ip(&parts.headers, peer);
    let counted = match limit {
        Some((l, by)) => {
            let key = match (by, &user) {
                (By::User, Some(u)) => format!("u:{}", u.id),
                _ => ip.clone().unwrap_or_else(|| "unknown".into()),
            };
            Some(ratelimit::guard(&state.cache, l, &key).await?)
        }
        None => None,
    };
    Ok(Ctx {
        db,
        body,
        headers: parts.headers,
        ip,
        user,
        counted,
    })
}

pub fn finish(out: anyhow::Result<Response>, counted: Option<ratelimit::Counted>) -> Response {
    let mut res = out.unwrap_or_else(|e| {
        tracing::error!("[auth] {e}");
        server_error()
    });
    if let Some(c) = counted {
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
