//! Login: o token de acesso (JWT) e o `requireAuth` — porte de
//! `server/src/services/tokens.js` e `server/src/middleware/auth.js`.
//!
//! O token é o MESMO do Node (HS256 com `JWT_ACCESS_SECRET`, `sub` = id do
//! usuário): quem logou pelo Node usa no Rust e vice-versa.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::FromRequestParts;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use chrono::NaiveDateTime;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;

use crate::AppState;
use crate::db::{self, Db};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iat: Option<u64>,
}

/// Chaves do token de acesso.
#[derive(Clone)]
pub struct Tokens {
    decoding: DecodingKey,
    encoding: EncodingKey,
    validation: Validation,
}

impl Tokens {
    pub fn new(secret: &str) -> Self {
        // SEGURANÇA: só HS256 (o único que o servidor usa pra assinar) — sem
        // "confusão de algoritmo". Sem folga no vencimento, como o
        // jsonwebtoken do Node (clockTolerance 0).
        let mut validation = Validation::new(Algorithm::HS256);
        validation.leeway = 0;
        validation.validate_nbf = true;
        validation.set_required_spec_claims(&["exp", "sub"]);
        Self {
            decoding: DecodingKey::from_secret(secret.as_bytes()),
            encoding: EncodingKey::from_secret(secret.as_bytes()),
            validation,
        }
    }

    pub fn verify(&self, token: &str) -> Option<Claims> {
        jsonwebtoken::decode::<Claims>(token, &self.decoding, &self.validation)
            .ok()
            .map(|d| d.claims)
    }

    /// Igual ao `signAccessToken` do Node (`{ sub, iat, exp }`).
    pub fn sign(&self, user_id: &str, ttl: Duration) -> String {
        let iat = chrono::Utc::now().timestamp() as u64;
        let claims = Claims {
            sub: user_id.to_string(),
            iat: Some(iat),
            exp: iat + ttl.as_secs(),
        };
        jsonwebtoken::encode(&Header::new(Algorithm::HS256), &claims, &self.encoding)
            .expect("assinar token")
    }
}

/// Quem está logado (o `req.user` do Node, só com o que as rotas usam).
#[derive(Clone, Debug)]
pub struct AuthUser {
    pub id: String,
    pub platform_role: String,
}

impl AuthUser {
    pub fn is_staff(&self) -> bool {
        matches!(self.platform_role.as_str(), "ADMIN" | "MODERATOR")
    }
}

/// Resposta de erro no formato do Node: `{ error, ...extra }`.
pub fn error(status: StatusCode, body: serde_json::Value) -> Response {
    (status, Json(body)).into_response()
}

fn unauthorized() -> Response {
    error(
        StatusCode::UNAUTHORIZED,
        json!({ "error": "Token inválido ou expirado." }),
    )
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let Some(token) = header.strip_prefix("Bearer ").filter(|t| !t.is_empty()) else {
            return Err(error(
                StatusCode::UNAUTHORIZED,
                json!({ "error": "Não autenticado." }),
            ));
        };
        let Some(claims) = state.tokens.verify(token) else {
            return Err(unauthorized());
        };
        let Some(db) = state.db.as_ref() else {
            return Err(unauthorized());
        };
        // qualquer falha daqui pra frente vira 401, como o try/catch do Node
        check_user(db, &state.auth_cache, &claims.sub)
            .await
            .map_err(|e| e.map(|b| *b).unwrap_or_else(unauthorized))
    }
}

/// Erro "de propósito" (ban etc.) = `Some(resposta)`; falha de banco = `None` (→ 401).
async fn check_user(
    db: &Db,
    cache: &AuthCache,
    user_id: &str,
) -> Result<AuthUser, Option<Box<Response>>> {
    let row = db::first(
        db,
        "SELECT id, platformRole, isPlatformBanned, platformBanReason, suspendedUntil, accountDisabledAt \
         FROM `User` WHERE id = ?",
        crate::params![user_id],
    )
    .await
    .map_err(|_| None)?;
    let Some(row) = row else {
        return Err(Some(Box::new(error(
            StatusCode::UNAUTHORIZED,
            json!({ "error": "Usuário não encontrado." }),
        ))));
    };
    let get = |c: &str| db::get::<Option<String>>(&row, c).ok().flatten();
    let banned: bool = db::get(&row, "isPlatformBanned").map_err(|_| None)?;
    if banned {
        let mut body =
            json!({ "error": "Sua conta foi banida da plataforma.", "platformBanned": true });
        if let Some(reason) = get("platformBanReason").filter(|r| !r.is_empty()) {
            body["reason"] = json!(reason);
        }
        return Err(Some(Box::new(error(StatusCode::FORBIDDEN, body))));
    }
    let suspended: Option<NaiveDateTime> = db::get(&row, "suspendedUntil").map_err(|_| None)?;
    if let Some(until) = suspended.filter(|u| *u > db::now()) {
        return Err(Some(Box::new(error(
            StatusCode::FORBIDDEN,
            json!({ "error": "Sua conta está temporariamente suspensa.", "suspendedUntil": db::iso(until) }),
        ))));
    }
    let disabled: Option<NaiveDateTime> = db::get(&row, "accountDisabledAt").map_err(|_| None)?;
    if disabled.is_some() {
        return Err(Some(Box::new(error(
            StatusCode::FORBIDDEN,
            json!({ "error": "Essa conta foi desativada.", "accountDisabled": true }),
        ))));
    }
    let user = AuthUser {
        id: user_id.to_string(),
        platform_role: get("platformRole").unwrap_or_default(),
    };
    if cache.maintenance_on(db).await.map_err(|_| None)? && !user.is_staff() {
        return Err(Some(Box::new(error(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "error": "A plataforma está em manutenção no momento.", "maintenance": true }),
        ))));
    }
    cache.mark_active(db, &user.id).await;
    Ok(user)
}

/// Os caches do `requireAuth`: modo manutenção (5 s) e "quem já usou hoje".
#[derive(Clone, Default)]
pub struct AuthCache {
    maintenance: Arc<Mutex<Option<(bool, Instant)>>>,
    active: Arc<Mutex<(String, HashSet<String>)>>,
}

impl AuthCache {
    async fn maintenance_on(&self, db: &Db) -> db::DbResult<bool> {
        let mut m = self.maintenance.lock().await;
        if let Some((value, at)) = *m
            && at.elapsed() < Duration::from_secs(5)
        {
            return Ok(value);
        }
        let value: Option<bool> = db::scalar(
            db,
            "SELECT maintenanceMode FROM PlatformSettings WHERE id = 'singleton'",
            vec![],
        )
        .await?;
        let value = value.unwrap_or(false);
        *m = Some((value, Instant::now()));
        Ok(value)
    }

    /// `activeDays.markActive`: no máximo 1 linha por pessoa por dia (dia de Brasília).
    async fn mark_active(&self, db: &Db, user_id: &str) {
        let day = day_key(chrono::Utc::now());
        {
            let mut a = self.active.lock().await;
            if a.0 != day {
                a.0 = day.clone();
                a.1.clear();
            }
            if !a.1.insert(user_id.to_string()) {
                return;
            }
        }
        let (db, cache, uid) = (db.clone(), self.clone(), user_id.to_string());
        tokio::spawn(async move {
            let r = db::exec(
                &db,
                "INSERT IGNORE INTO UserActiveDay (userId, day, at) VALUES (?, ?, ?)",
                crate::params![uid.as_str(), day.as_str(), db::now()],
            )
            .await;
            if r.is_err() {
                cache.active.lock().await.1.remove(&uid);
            }
        });
    }
}

/// Dia no horário de Brasília (UTC-3), que é o "hoje" da comunidade.
pub fn day_key(now: chrono::DateTime<chrono::Utc>) -> String {
    (now - chrono::Duration::hours(3))
        .format("%Y-%m-%d")
        .to_string()
}

/// "Invisível" só a própria pessoa enxerga — porte de `maskDeep`
/// (`server/src/utils/presenceVisibility.js`): todo objeto com `id` e
/// status INVISIBLE que não seja de quem está vendo sai como OFFLINE.
pub fn mask_invisible(value: &mut serde_json::Value, viewer: Option<&str>) {
    fn walk(v: &mut serde_json::Value, viewer: Option<&str>, depth: usize) {
        if depth > 12 {
            return;
        }
        match v {
            serde_json::Value::Array(items) => {
                items.iter_mut().for_each(|i| walk(i, viewer, depth + 1))
            }
            serde_json::Value::Object(map) => {
                let hide = map.get("status").and_then(|s| s.as_str()) == Some("INVISIBLE")
                    && map
                        .get("id")
                        .and_then(|i| i.as_str())
                        .is_some_and(|id| Some(id) != viewer);
                if hide {
                    map.insert("status".into(), json!("OFFLINE"));
                }
                for child in map.values_mut() {
                    walk(child, viewer, depth + 1);
                }
            }
            _ => {}
        }
    }
    walk(value, viewer, 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_do_node_vale_no_rust() {
        // assinado pelo jsonwebtoken do Node: jwt.sign({ sub: 'u1' }, 'segredo', { expiresIn: '100y' })
        let from_node = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSIsImlhdCI6MTc5NTI2NDYzMiwiZXhwIjo0OTUxMDI0NjMyfQ.zOZl8a4arbMK_7FaKYjDQdG4aocUesSs9x8MyPf2HkQ";
        let t = Tokens::new("segredo");
        assert_eq!(t.verify(from_node).unwrap().sub, "u1");
        let mine = t.sign("u1", Duration::from_secs(60));
        assert_eq!(t.verify(&mine).unwrap().sub, "u1");
        assert!(Tokens::new("outro").verify(&mine).is_none());
    }

    #[test]
    fn token_vencido_ou_sem_assinatura_nao_vale() {
        let t = Tokens::new("segredo");
        let old = jsonwebtoken::encode(
            &Header::new(Algorithm::HS256),
            &Claims {
                sub: "u1".into(),
                exp: 1,
                iat: None,
            },
            &EncodingKey::from_secret(b"segredo"),
        )
        .unwrap();
        assert!(t.verify(&old).is_none());
        // "alg": "none"
        let none = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1MSIsImV4cCI6OTk5OTk5OTk5OX0.";
        assert!(t.verify(none).is_none());
    }

    #[test]
    fn dia_de_brasilia() {
        let d = chrono::DateTime::parse_from_rfc3339("2026-11-21T02:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert_eq!(day_key(d), "2026-11-20");
    }

    #[test]
    fn invisivel_so_pra_propria_pessoa() {
        let mut v = json!({
            "user": { "id": "eu", "status": "INVISIBLE" },
            "friends": [{ "id": "outro", "status": "INVISIBLE" }, { "id": "x", "status": "ONLINE" }]
        });
        mask_invisible(&mut v, Some("eu"));
        assert_eq!(v["user"]["status"], "INVISIBLE");
        assert_eq!(v["friends"][0]["status"], "OFFLINE");
        assert_eq!(v["friends"][1]["status"], "ONLINE");
        mask_invisible(&mut v, None);
        assert_eq!(v["user"]["status"], "OFFLINE");
    }
}
