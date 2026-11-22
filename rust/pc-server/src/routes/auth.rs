//! `/api/auth/*` — porte de `server/src/routes/auth.js` (aos poucos).
//!
//! Já em Rust: `GET /me`.
//! Ainda no Node: cadastro, login, refresh, logout, 2FA, senha, OAuth,
//! passkeys, QR, troca de conta e exportação.

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{AuthUser, error, mask_invisible};
use crate::db::{self, Db, DbResult};
use crate::params;
use crate::users;

fn server_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Erro interno do servidor." }),
    )
}

/// `GET /api/auth/me` — os dados da própria conta.
pub async fn me(State(state): State<AppState>, user: AuthUser) -> Response {
    let Some(db) = state.db.as_ref() else {
        return server_error();
    };
    match load_me(db, &user.id).await {
        Ok(Some(mut body)) => {
            mask_invisible(&mut body, Some(&user.id));
            Json(body).into_response()
        }
        Ok(None) | Err(_) => server_error(),
    }
}

async fn load_me(db: &Db, user_id: &str) -> DbResult<Option<Value>> {
    let Some(row) = db::first(db, &users::self_select_sql(), params![user_id]).await? else {
        return Ok(None);
    };
    let mut user = users::self_user(&row)?;

    if user.get("publicId").is_none_or(Value::is_null) {
        let id = ensure_public_id(db, user_id).await?;
        user.insert(
            "publicId".into(),
            id.map(Value::String).unwrap_or(Value::Null),
        );
    }

    let created: chrono::NaiveDateTime = db::get(&row, "createdAt")?;
    grant_due_age_badges(db, user_id, created).await;

    clear_if_expired(db, user_id, &mut user).await;
    Ok(Some(json!({ "user": user })))
}

/// Número público de 9 dígitos (o `generatePublicId` do Node).
pub fn generate_public_id() -> String {
    rand::rng()
        .random_range(100_000_000..1_000_000_000u32)
        .to_string()
}

/// `ensurePublicId`: até 5 tentativas se bater com o de outra pessoa.
pub(crate) async fn ensure_public_id(db: &Db, user_id: &str) -> DbResult<Option<String>> {
    for _ in 0..5 {
        let candidate = generate_public_id();
        let r = db::exec(
            db,
            "UPDATE `User` SET publicId = ?, updatedAt = ? WHERE id = ?",
            params![candidate.as_str(), db::now(), user_id],
        )
        .await;
        match r {
            Ok(_) => return Ok(Some(candidate)),
            Err(e) if db::is_unique_violation(&e) => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(None)
}

/// Anos completos de conta, como o Node (ano de 365,25 dias).
pub fn account_age_years(created: chrono::NaiveDateTime, now: chrono::NaiveDateTime) -> i64 {
    let ms = (now - created).num_milliseconds() as f64;
    (ms / (365.25 * 24.0 * 60.0 * 60.0 * 1000.0)).floor() as i64
}

/// `grantDueAgeBadges` — insígnias de "N anos de conta". Nunca derruba o /me.
async fn grant_due_age_badges(db: &Db, user_id: &str, created: chrono::NaiveDateTime) {
    let years = account_age_years(created, db::now());
    if years < 1 {
        return;
    }
    let result: DbResult<()> = async {
        let missing: Vec<String> = db::column(
            db,
            "SELECT b.id FROM Badge b WHERE b.ageYears IS NOT NULL AND b.ageYears <= ? \
             AND NOT EXISTS (SELECT 1 FROM UserBadge ub WHERE ub.userId = ? AND ub.badgeId = b.id)",
            params![years, user_id],
        )
        .await?;
        for badge_id in missing {
            db::exec(
                db,
                "INSERT IGNORE INTO UserBadge (id, userId, badgeId, awardedAt) VALUES (?, ?, ?, ?)",
                params![db::new_id(), user_id, badge_id, db::now()],
            )
            .await?;
        }
        Ok(())
    }
    .await;
    if let Err(e) = result {
        tracing::debug!("insígnias de idade: {e}");
    }
}

/// `clearIfExpired` — status personalizado vencido some (na resposta e no banco).
async fn clear_if_expired(db: &Db, user_id: &str, user: &mut serde_json::Map<String, Value>) {
    let expired = user
        .get("customStatusExpiresAt")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|d| d.naive_utc() <= db::now());
    if !expired {
        return;
    }
    for k in ["customStatus", "customStatusEmoji", "customStatusExpiresAt"] {
        user.insert(k.into(), Value::Null);
    }
    let (db, id) = (db.clone(), user_id.to_string());
    tokio::spawn(async move {
        let _ = db::exec(
            &db,
            "UPDATE `User` SET customStatus = NULL, customStatusEmoji = NULL, customStatusExpiresAt = NULL, updatedAt = ? WHERE id = ?",
            params![db::now(), id],
        )
        .await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn id_publico_tem_9_digitos() {
        for _ in 0..1000 {
            let id = generate_public_id();
            assert_eq!(id.len(), 9);
            assert!(!id.starts_with('0'));
        }
    }

    #[test]
    fn idade_da_conta() {
        let c = NaiveDate::from_ymd_opt(2024, 11, 21)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let n = NaiveDate::from_ymd_opt(2026, 11, 21)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        assert_eq!(account_age_years(c, n), 1); // 730 dias < 2 × 365,25
        let n2 = NaiveDate::from_ymd_opt(2026, 11, 22)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        assert_eq!(account_age_years(c, n2), 2);
    }
}
