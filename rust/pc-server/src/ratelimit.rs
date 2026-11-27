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

/// "Entrar com o celular" — PC sem login: gerar o QR (10 em 10 min por IP).
pub const QR_START: Limit = Limit {
    prefix: "qr-start",
    window_ms: 10 * 60 * 1000,
    max: 10,
    message: Some("Muitos QR Codes gerados. Espere alguns minutos e tente de novo."),
    standard: true,
    legacy: false,
};

/// Consultar o estado do QR (90 por minuto, uma consulta a cada 2 s folgada).
pub const QR_POLL: Limit = Limit {
    prefix: "qr-poll",
    window_ms: 60 * 1000,
    max: 90,
    message: Some("Muitas consultas. Espere um pouco."),
    standard: true,
    legacy: false,
};

/// Trocar o QR aprovado por sessão, e abrir o link do app-handoff.
pub const QR_EXCHANGE: Limit = Limit {
    prefix: "qr-exchange",
    window_ms: 10 * 60 * 1000,
    max: 20,
    message: Some("Muitas tentativas. Tente novamente em alguns minutos."),
    standard: true,
    legacy: false,
};

/// Celular logado (ler/aprovar/recusar QR, pedir app-handoff): por conta.
pub const QR_PHONE: Limit = Limit {
    prefix: "qr-phone",
    window_ms: 10 * 60 * 1000,
    max: 30,
    message: Some("Muitas tentativas. Tente novamente em alguns minutos."),
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

/// Contagem de reserva quando o Redis não responde: na memória deste
/// processo, com a mesma janela fixa do script `INCREMENT`. Antes, sem
/// Redis, toda rota com limite dava 500 (igual o Node fazia) — o site
/// inteiro parava por causa de um contador. Igual no Node:
/// `server/src/config/rateLimitStore.js` (createFallbackStore).
static LOCAL: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, (u64, std::time::Instant)>>,
> = std::sync::LazyLock::new(Default::default);
static LAST_WARN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

/// `(total, ms até zerar)` da chave na memória local.
pub fn local_increment(key: &str, window_ms: u64) -> (i64, i64) {
    use std::time::{Duration, Instant};
    let now = Instant::now();
    let window = Duration::from_millis(window_ms);
    let mut map = LOCAL.lock().unwrap_or_else(|e| e.into_inner());
    // muita chave (muitos IPs durante a queda): tira as que já venceram
    if map.len() > 50_000 {
        map.retain(|_, (_, reset)| *reset > now);
    }
    let entry = map.entry(key.to_string()).or_insert((0, now + window));
    if entry.1 <= now {
        *entry = (0, now + window);
    }
    entry.0 += 1;
    (
        entry.0 as i64,
        entry.1.saturating_duration_since(now).as_millis() as i64,
    )
}

fn warn_fallback(prefix: &str) {
    let now = chrono::Utc::now().timestamp();
    let last = LAST_WARN.load(std::sync::atomic::Ordering::Relaxed);
    if now - last >= 60
        && LAST_WARN
            .compare_exchange(
                last,
                now,
                std::sync::atomic::Ordering::Relaxed,
                std::sync::atomic::Ordering::Relaxed,
            )
            .is_ok()
    {
        tracing::warn!(
            "[rate-limit] Redis indisponível — contando na memória do processo ({prefix})"
        );
    }
}

/// Conta mais uma requisição de `key` (o IP): os cabeçalhos e, se passou do
/// limite, a resposta 429 pronta. Sem Redis ou com erro, conta na memória
/// do processo (`local_increment`) — o limite continua valendo.
pub async fn hit(cache: &Cache, limit: &Limit, key: &str) -> Option<(Counted, Option<Response>)> {
    let redis_key = format!("ratelimit:{}:{key}", limit.prefix);
    let (total, ttl_ms): (i64, i64) = match cache
        .eval(INCREMENT, &redis_key, &["0", &limit.window_ms.to_string()])
        .await
    {
        Some(v) => v,
        None => {
            warn_fallback(limit.prefix);
            local_increment(&redis_key, limit.window_ms)
        }
    };
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

/// O limitador como middleware de uma rota: conta (no Redis, ou na memória
/// se ele estiver fora); passou do limite → 429 (com os cabeçalhos). `Ok` traz os cabeçalhos pra pôr na
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sem_redis_conta_na_memoria_com_janela() {
        let k = "ratelimit:teste:1.2.3.4";
        assert_eq!(local_increment(k, 60_000).0, 1);
        assert_eq!(local_increment(k, 60_000).0, 2);
        let (_, ttl) = local_increment(k, 60_000);
        assert!(ttl > 0 && ttl <= 60_000);
        // outra chave começa do zero
        assert_eq!(local_increment("ratelimit:teste:5.6.7.8", 60_000).0, 1);
    }

    #[test]
    fn sem_redis_janela_vencida_zera() {
        let k = "ratelimit:teste-janela:9.9.9.9";
        assert_eq!(local_increment(k, 1).0, 1);
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert_eq!(local_increment(k, 1).0, 1);
    }

    #[tokio::test]
    async fn sem_redis_o_limite_continua_valendo() {
        let cache = Cache::default();
        let limit = Limit {
            prefix: "teste-guard",
            window_ms: 60_000,
            max: 2,
            message: Some("Muitas tentativas."),
            standard: true,
            legacy: false,
        };
        assert!(guard(&cache, &limit, "1.1.1.1").await.is_ok());
        assert!(guard(&cache, &limit, "1.1.1.1").await.is_ok());
        let blocked = guard(&cache, &limit, "1.1.1.1").await.err().unwrap();
        assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
    }
}
