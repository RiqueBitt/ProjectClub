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
    /// Corpo da resposta 429.
    pub message: &'static str,
}

/// O login (`loginLimiter` em `server/src/routes/auth.js`): 15 em 10 min por IP.
pub const LOGIN: Limit = Limit {
    prefix: "login",
    window_ms: 10 * 60 * 1000,
    max: 15,
    message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
};

/// Resultado de uma contagem: cabeçalhos `RateLimit-*` (draft-6) a pôr na
/// resposta e, se passou do limite, a resposta 429 pronta.
pub struct Counted {
    pub headers: Vec<(&'static str, String)>,
    pub blocked: Option<Response>,
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

/// Conta mais uma requisição de `key` (o IP). Sem Redis ou com erro =
/// `None` (o Node, com `passOnStoreError: false`, devolve 500 nesse caso).
pub async fn hit(cache: &Cache, limit: &Limit, key: &str) -> Option<Counted> {
    let redis_key = format!("ratelimit:{}:{key}", limit.prefix);
    let (total, ttl_ms): (i64, i64) = cache
        .eval(INCREMENT, &redis_key, &["0", &limit.window_ms.to_string()])
        .await?;
    let total = total.max(0) as u64;
    let remaining = limit.max.saturating_sub(total);
    let reset_secs = ((ttl_ms.max(0) as f64) / 1000.0).ceil() as u64;
    let mut headers = vec![
        (
            "ratelimit-policy",
            format!("{};w={}", limit.max, limit.window_ms.div_ceil(1000)),
        ),
        ("ratelimit-limit", limit.max.to_string()),
        ("ratelimit-remaining", remaining.to_string()),
    ];
    if reset_secs > 0 {
        headers.push(("ratelimit-reset", reset_secs.to_string()));
    }
    let blocked = (total > limit.max).then(|| {
        let mut r = (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": limit.message })),
        )
            .into_response();
        if let Ok(v) = HeaderValue::from_str(&reset_secs.to_string()) {
            r.headers_mut().insert(header::RETRY_AFTER, v);
        }
        r
    });
    Some(Counted { headers, blocked })
}
