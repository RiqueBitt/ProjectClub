//! Limite de requisições igual ao `express-rate-limit` + `rate-limit-redis`
//! do Node, **no mesmo contador do Redis** (`ratelimit:<nome>:<ip>`, mesmo
//! script Lua): uma tentativa pelo Rust e outra pelo Node contam juntas.

use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::cache::Cache;

/// O script `increment` do rate-limit-redis 4.3 (o mesmo texto, só sem a
/// indentação, como ele manda pro Redis).
const INCREMENT: &str = r#"local windowMs = tonumber(ARGV[2])
local resetOnChange = ARGV[1] == "1"
local timeToExpire = redis.call("PTTL", KEYS[1])
if timeToExpire <= 0 then
redis.call("SET", KEYS[1], 1, "PX", windowMs)
return { 1, windowMs }
end
local totalHits = redis.call("INCR", KEYS[1])
if resetOnChange then
redis.call("PEXPIRE", KEYS[1], windowMs)
timeToExpire = windowMs
end
return { totalHits, timeToExpire }"#;

pub struct Limit {
    /// `ratelimit:<prefix>:` no Redis (ex.: `login`).
    pub prefix: &'static str,
    pub window_ms: u64,
    pub max: u64,
    /// Corpo da resposta 429: JSON `{ error }`; `None` = o texto padrão do
    /// express-rate-limit (`Too many requests, please try again later.`).
    pub message: Option<&'static str>,
    /// `standardHeaders: true` (cabeçalhos `RateLimit-*`, draft-6).
    pub standard: bool,
    /// `legacyHeaders` (padrão do express-rate-limit: ligado) — `X-RateLimit-*`.
    pub legacy: bool,
}

/// O login (`loginLimiter` em `server/src/routes/auth.js`): 15 em 10 min por IP.
pub const LOGIN: Limit = Limit {
    prefix: "login",
    window_ms: 10 * 60 * 1000,
    max: 15,
    message: Some("Muitas tentativas de login. Tente novamente em alguns minutos."),
    standard: true,
    legacy: false,
};

/// `authLimiter`: 50 em 15 min (cadastro, e-mail, senha, conta), cabeçalhos antigos.
pub const AUTH: Limit = Limit {
    prefix: "auth",
    window_ms: 15 * 60 * 1000,
    max: 50,
    message: None,
    standard: false,
    legacy: true,
};

/// `codeLimiter`: 20 em 10 min (códigos de e-mail e 2FA).
pub const CODE: Limit = Limit {
    prefix: "code",
    window_ms: 10 * 60 * 1000,
    max: 20,
    message: None,
    standard: true,
    legacy: false,
};

/// Cabeçalhos de uma contagem, pra pôr na resposta.
pub struct Counted {
    pub headers: Vec<(&'static str, String)>,
}

impl Counted {
    pub fn apply(&self, res: &mut Response) {
        for (k, v) in &self.headers {
            if let Ok(v) = HeaderValue::from_str(v) {
                res.headers_mut().insert(*k, v);
            }
        }
    }
}

/// Conta mais uma requisição de `key` (o IP): os cabeçalhos e, se passou do
/// limite, a resposta 429 pronta. Sem Redis ou com erro = `None` (o Node,
/// com `passOnStoreError: false`, devolve 500 nesse caso).
pub async fn hit(cache: &Cache, limit: &Limit, key: &str) -> Option<(Counted, Option<Response>)> {
    let redis_key = format!("ratelimit:{}:{key}", limit.prefix);
    let (total, ttl_ms): (i64, i64) = cache
        .eval(INCREMENT, &redis_key, &["0", &limit.window_ms.to_string()])
        .await?;
    let total = total.max(0) as u64;
    let remaining = limit.max.saturating_sub(total);
    let ttl_ms = ttl_ms.max(0);
    let reset_secs = ((ttl_ms as f64) / 1000.0).ceil() as u64;
    let mut headers = Vec::new();
    if limit.legacy {
        let reset_at =
            ((chrono::Utc::now().timestamp_millis() + ttl_ms) as f64 / 1000.0).ceil() as i64;
        headers.push(("x-ratelimit-limit", limit.max.to_string()));
        headers.push(("x-ratelimit-remaining", remaining.to_string()));
        headers.push(("x-ratelimit-reset", reset_at.to_string()));
    }
    if limit.standard {
        headers.push((
            "ratelimit-policy",
            format!("{};w={}", limit.max, limit.window_ms.div_ceil(1000)),
        ));
        headers.push(("ratelimit-limit", limit.max.to_string()));
        headers.push(("ratelimit-remaining", remaining.to_string()));
        if reset_secs > 0 {
            headers.push(("ratelimit-reset", reset_secs.to_string()));
        }
    }
    let blocked = (total > limit.max).then(|| {
        let mut r = match limit.message {
            Some(m) => (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": m }))).into_response(),
            None => {
                let mut r = (
                    StatusCode::TOO_MANY_REQUESTS,
                    "Too many requests, please try again later.",
                )
                    .into_response();
                r.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/html; charset=utf-8"),
                );
                r
            }
        };
        if (limit.legacy || limit.standard)
            && let Ok(v) = HeaderValue::from_str(&reset_secs.to_string())
        {
            r.headers_mut().insert(header::RETRY_AFTER, v);
        }
        r
    });
    Some((Counted { headers }, blocked))
}

/// O limitador como middleware de uma rota: conta; Redis fora → 500; passou
/// do limite → 429 (com os cabeçalhos). `Ok` traz os cabeçalhos pra pôr na
/// resposta da rota.
pub async fn guard(cache: &Cache, limit: &Limit, ip: &str) -> Result<Counted, Box<Response>> {
    let Some((counted, blocked)) = hit(cache, limit, ip).await else {
        return Err(Box::new(crate::auth::error(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": "Erro interno do servidor." }),
        )));
    };
    if let Some(mut blocked) = blocked {
        counted.apply(&mut blocked);
        return Err(Box::new(blocked));
    }
    Ok(counted)
}
