//! `POST /api/auth/login` — porte de `login` e `completeLogin`
//! (`server/src/controllers/authController.js`), caso a caso:
//! limite por IP (no mesmo contador do Node), bloqueio da conta depois de 10
//! erros (15 min), bcrypt sempre (até sem conta, contra enumeração), conta
//! banida/suspensa (com token de revisão), desativada, 2FA (código do app
//! sem reuso, ou código de recuperação de uso único), aviso de aparelho novo
//! (pela ponte com o Node) e reativação de conta desativada pela pessoa.

use std::net::SocketAddr;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, State};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use chrono::NaiveDateTime;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{error, mask_invisible};
use crate::db::{self, Db, DbResult};
use crate::params;
use crate::session::{self as s};
use crate::{node, ratelimit, totp, users, web};

/// O mesmo hash "de mentira" do Node: o bcrypt roda mesmo sem conta.
const DUMMY_PASSWORD_HASH: &str = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8k5xBLwtQD8lWy4EXd0f3wnPPh4GX2";

fn server_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Erro interno do servidor." }),
    )
}

/// O que o login precisa da conta.
pub(crate) struct LoginUser {
    pub(crate) id: String,
    pub(crate) password_hash: String,
    pub(crate) failed_login_attempts: i64,
    pub(crate) login_locked_until: Option<NaiveDateTime>,
    pub(crate) is_platform_banned: bool,
    pub(crate) platform_ban_reason: Option<String>,
    pub(crate) suspended_until: Option<NaiveDateTime>,
    pub(crate) account_disabled_at: Option<NaiveDateTime>,
    pub(crate) two_factor_enabled: bool,
    pub(crate) two_factor_secret: Option<String>,
    pub(crate) two_factor_last_used_step: Option<i64>,
    pub(crate) self_deactivated_at: Option<NaiveDateTime>,
}

async fn find_user(db: &Db, identifier: &str) -> DbResult<Option<LoginUser>> {
    load_user(
        db,
        "email = ? OR username = ?",
        params![identifier.to_lowercase(), identifier],
    )
    .await
}

/// A conta pelo id (troca rápida de conta).
pub(crate) async fn find_user_by_id(db: &Db, id: &str) -> DbResult<Option<LoginUser>> {
    load_user(db, "id = ?", params![id]).await
}

async fn load_user(db: &Db, cond: &str, p: Vec<db::Value>) -> DbResult<Option<LoginUser>> {
    let sql = format!(
        "SELECT id, passwordHash, failedLoginAttempts, loginLockedUntil, isPlatformBanned, platformBanReason, \
         suspendedUntil, accountDisabledAt, twoFactorEnabled, twoFactorSecret, twoFactorLastUsedStep, selfDeactivatedAt \
         FROM `User` WHERE {cond} LIMIT 1"
    );
    let row = db::first(db, &sql, p).await?;
    row.map(|r| {
        Ok(LoginUser {
            id: db::get(&r, "id")?,
            password_hash: db::get(&r, "passwordHash")?,
            failed_login_attempts: db::get(&r, "failedLoginAttempts")?,
            login_locked_until: db::get(&r, "loginLockedUntil")?,
            is_platform_banned: db::get(&r, "isPlatformBanned")?,
            platform_ban_reason: db::get(&r, "platformBanReason")?,
            suspended_until: db::get(&r, "suspendedUntil")?,
            account_disabled_at: db::get(&r, "accountDisabledAt")?,
            two_factor_enabled: db::get(&r, "twoFactorEnabled")?,
            two_factor_secret: db::get(&r, "twoFactorSecret")?,
            two_factor_last_used_step: db::get(&r, "twoFactorLastUsedStep")?,
            self_deactivated_at: db::get(&r, "selfDeactivatedAt")?,
        })
    })
    .transpose()
}

/// bcrypt fora da thread do servidor (custo 12 ≈ 250 ms).
pub(crate) async fn password_ok(password: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || bcrypt::verify(password, &hash).unwrap_or(false))
        .await
        .unwrap_or(false)
}

/// `registerFailedLogin`: +1 erro; no 10º, a conta trava por 15 minutos.
async fn register_failed_login(db: &Db, user_id: &str) -> DbResult<()> {
    db::exec(
        db,
        "UPDATE `User` SET failedLoginAttempts = failedLoginAttempts + 1, updatedAt = ? WHERE id = ?",
        params![db::now(), user_id],
    )
    .await?;
    let n: i64 = db::scalar(
        db,
        "SELECT failedLoginAttempts FROM `User` WHERE id = ?",
        params![user_id],
    )
    .await?
    .unwrap_or(0);
    if n >= 10 {
        db::exec(
            db,
            "UPDATE `User` SET loginLockedUntil = ?, updatedAt = ? WHERE id = ?",
            params![
                db::now() + chrono::Duration::minutes(15),
                db::now(),
                user_id
            ],
        )
        .await?;
    }
    Ok(())
}

/// `verifyTotpOnce`: o mesmo código (o mesmo passo de 30 s) só vale UMA vez.
async fn verify_totp_once(db: &Db, user: &LoginUser, code: &str) -> anyhow::Result<bool> {
    verify_totp_once_for(
        db,
        &user.id,
        user.two_factor_secret.as_deref(),
        user.two_factor_last_used_step,
        code,
    )
    .await
}

pub(crate) async fn verify_totp_once_for(
    db: &Db,
    user_id: &str,
    secret: Option<&str>,
    last_step: Option<i64>,
    code: &str,
) -> anyhow::Result<bool> {
    let code = code.trim();
    let Some(secret) = secret.filter(|s| !s.is_empty()) else {
        return Ok(false);
    };
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(false);
    }
    let now = chrono::Utc::now().timestamp();
    let step =
        totp::verify(secret, code, now, last_step).map_err(|e| anyhow::anyhow!("totp: {e:?}"))?;
    let Some(step) = step else { return Ok(false) };
    let claimed = db::exec(
        db,
        "UPDATE `User` SET twoFactorLastUsedStep = ?, updatedAt = ? WHERE id = ? \
         AND (twoFactorLastUsedStep IS NULL OR twoFactorLastUsedStep < ?)",
        params![step, db::now(), user_id, step],
    )
    .await?;
    Ok(claimed == 1)
}

/// `normalizeRecoveryCode`: 10 letras/números, com ou sem hífen → `xxxxx-xxxxx`.
pub fn normalize_recovery_code(input: &str) -> Option<String> {
    let clean: String = input
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    (clean.len() == 10).then(|| format!("{}-{}", &clean[..5], &clean[5..]))
}

/// `consumeRecoveryCode`: código de recuperação de uso único.
pub(crate) async fn consume_recovery_code(db: &Db, user_id: &str, input: &str) -> DbResult<bool> {
    let Some(normalized) = normalize_recovery_code(input) else {
        return Ok(false);
    };
    let n = db::exec(
        db,
        "UPDATE TwoFactorRecoveryCode SET usedAt = ? WHERE userId = ? AND codeHash = ? AND usedAt IS NULL",
        params![db::now(), user_id, s::sha256_hex(&normalized)],
    )
    .await?;
    Ok(n == 1)
}

/// `isNewDeviceLogin`: já teve sessão antes e nenhuma com o mesmo navegador + IP.
async fn is_new_device(db: &Db, user_id: &str, ua: Option<&str>, ip: Option<&str>) -> bool {
    let rows = db::all(
        db,
        "SELECT userAgent, ipAddress FROM RefreshToken WHERE userId = ? ORDER BY createdAt DESC LIMIT 200",
        params![user_id],
    )
    .await;
    let Ok(rows) = rows else { return false };
    if rows.is_empty() {
        return false;
    }
    !rows.iter().any(|r| {
        let a: Option<String> = db::get(r, "userAgent").ok().flatten();
        let b: Option<String> = db::get(r, "ipAddress").ok().flatten();
        a.as_deref() == ua && b.as_deref() == ip
    })
}

/// Token de revisão de punição (`signAppealToken`): JWT de 30 min, `typ: appeal`.
fn appeal_token(state: &AppState, user_id: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut m = Hmac::<sha2::Sha256>::new_from_slice(state.config.jwt_access_secret.as_bytes())
        .expect("hmac");
    m.update(b"pc-appeal-token-v1");
    let secret = hex::encode(m.finalize().into_bytes());
    let iat = chrono::Utc::now().timestamp();
    let claims = json!({ "sub": user_id, "typ": "appeal", "iat": iat, "exp": iat + 30 * 60 });
    jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::HS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    )
    .unwrap_or_default()
}

/// `toLocaleString('pt-BR')` no fuso do servidor (UTC em produção).
fn pt_br_datetime(d: NaiveDateTime) -> String {
    d.format("%d/%m/%Y, %H:%M:%S").to_string()
}

pub(crate) struct Req {
    pub(crate) user_agent: Option<String>,
    pub(crate) ip: Option<String>,
}

pub async fn login(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let Some(db) = state.db.clone() else {
        return server_error();
    };
    // 1) corpo (o express.json roda antes do limite e não conta tentativa)
    let body = match web::json_body(&parts.headers, &body) {
        Ok(v) => v,
        Err(r) => return *r,
    };
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let req = Req {
        user_agent: parts
            .headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(String::from),
        ip: s::client_ip(&parts.headers, peer),
    };
    // 2) limite por IP (loginLimiter), no mesmo contador do Node
    let counted = match ratelimit::guard(
        &state.cache,
        &ratelimit::LOGIN,
        req.ip.as_deref().unwrap_or("unknown"),
    )
    .await
    {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let mut res = match login_inner(&state, &db, &req, &body).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("[auth] login: {e}");
            server_error()
        }
    };
    counted.apply(&mut res);
    res
}

fn bad(msg: &str) -> Response {
    error(StatusCode::BAD_REQUEST, json!({ "error": msg }))
}

async fn login_inner(
    state: &AppState,
    db: &Db,
    req: &Req,
    body: &Value,
) -> anyhow::Result<Response> {
    let field = |k: &str| body.get(k);
    let (Some(Value::String(ident)), Some(Value::String(password))) =
        (field("emailOrUsername"), field("password"))
    else {
        return Ok(bad("Informe usuário/e-mail e senha."));
    };
    if ident.trim().is_empty() || password.is_empty() {
        return Ok(bad("Informe usuário/e-mail e senha."));
    }
    let opt_str = |k: &str| match field(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(()),
    };
    let (Ok(two_factor_code), Ok(recovery_code)) =
        (opt_str("twoFactorCode"), opt_str("recoveryCode"))
    else {
        return Ok(bad("Código 2FA inválido."));
    };
    let identifier = ident.trim();

    let user = find_user(db, identifier).await?;

    if let Some(until) = user
        .as_ref()
        .and_then(|u| u.login_locked_until)
        .filter(|u| *u > db::now())
    {
        let mins = ((until - db::now()).num_milliseconds() as f64 / 60_000.0).ceil() as i64;
        return Ok(error(
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "error": format!("Muitas tentativas de login para esta conta. Tente novamente em {mins} minuto(s).") }),
        ));
    }

    let hash = user
        .as_ref()
        .map(|u| u.password_hash.clone())
        .unwrap_or_else(|| DUMMY_PASSWORD_HASH.into());
    let valid = password_ok(password.clone(), hash).await;
    let user = match user {
        Some(u) if valid => u,
        other => {
            if let Some(u) = other {
                register_failed_login(db, &u.id).await?;
            }
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                json!({ "error": "Credenciais inválidas." }),
            ));
        }
    };

    if user.is_platform_banned {
        let mut body =
            json!({ "error": "Esta conta foi banida da plataforma.", "platformBanned": true });
        if let Some(r) = user
            .platform_ban_reason
            .as_deref()
            .filter(|r| !r.is_empty())
        {
            body["reason"] = json!(r);
        }
        body["appealToken"] = json!(appeal_token(state, &user.id));
        return Ok(error(StatusCode::FORBIDDEN, body));
    }
    if let Some(until) = user.suspended_until.filter(|u| *u > db::now()) {
        return Ok(error(
            StatusCode::FORBIDDEN,
            json!({
                "error": format!("Esta conta está suspensa até {}.", pt_br_datetime(until)),
                "suspendedUntil": db::iso(until),
                "appealToken": appeal_token(state, &user.id),
            }),
        ));
    }
    if user.account_disabled_at.is_some() {
        return Ok(error(
            StatusCode::FORBIDDEN,
            json!({
                "error": "Esta conta foi desativada. Se você quer reativá-la, entre em contato com a equipe do Project Club.",
                "accountDisabled": true,
            }),
        ));
    }

    if user.two_factor_enabled {
        let has_totp = two_factor_code
            .as_deref()
            .is_some_and(|c| !c.trim().is_empty());
        let has_recovery = recovery_code
            .as_deref()
            .is_some_and(|c| !c.trim().is_empty());
        if !has_totp && !has_recovery {
            return Ok((
                StatusCode::PARTIAL_CONTENT,
                Json(json!({ "requiresTwoFactor": true })),
            )
                .into_response());
        }
        let ok = if has_recovery {
            consume_recovery_code(db, &user.id, recovery_code.as_deref().unwrap_or("")).await?
        } else {
            verify_totp_once(db, &user, two_factor_code.as_deref().unwrap_or("")).await?
        };
        if !ok {
            register_failed_login(db, &user.id).await?;
            let msg = if has_recovery {
                "Código de recuperação inválido ou já usado."
            } else {
                "Código 2FA inválido."
            };
            return Ok(error(StatusCode::UNAUTHORIZED, json!({ "error": msg })));
        }
    }

    complete_login(state, db, req, &user).await
}

/// `completeLogin`: zera os erros, abre a sessão, avisa de aparelho novo e
/// reativa conta desativada pela própria pessoa.
pub(crate) async fn complete_login(
    state: &AppState,
    db: &Db,
    req: &Req,
    user: &LoginUser,
) -> anyhow::Result<Response> {
    let (body, cookies) = complete_login_parts(state, db, req, user).await?;
    let mut res = Json(body).into_response();
    for c in cookies {
        res.headers_mut().append(header::SET_COOKIE, c);
    }
    Ok(res)
}

/// O mesmo `completeLogin`, devolvendo o corpo (`{ user, accessToken }`) e
/// os cookies separados (o QR acrescenta `via`, o handoff redireciona).
pub(crate) async fn complete_login_parts(
    state: &AppState,
    db: &Db,
    req: &Req,
    user: &LoginUser,
) -> anyhow::Result<(Value, Vec<axum::http::HeaderValue>)> {
    if let Some(acc) = s::account(db, &user.id).await? {
        s::maybe_promote_to_platform_admin(state, db, &acc).await;
    }
    if user.failed_login_attempts > 0 || user.login_locked_until.is_some() {
        db::exec(
            db,
            "UPDATE `User` SET failedLoginAttempts = 0, loginLockedUntil = NULL, updatedAt = ? WHERE id = ?",
            params![db::now(), user.id.as_str()],
        )
        .await?;
    }
    // "aparelho novo" ANTES de criar a sessão (senão ela bate consigo mesma)
    let new_device =
        is_new_device(db, &user.id, req.user_agent.as_deref(), req.ip.as_deref()).await;
    let issued = s::issue(
        state,
        db,
        &user.id,
        req.user_agent.as_deref(),
        req.ip.as_deref(),
        None,
    )
    .await?;
    if new_device {
        node::login_alert(
            state,
            &user.id,
            req.user_agent.as_deref(),
            req.ip.as_deref(),
            &issued.refresh_id,
        );
    }
    let mut reactivated = false;
    if user.self_deactivated_at.is_some() {
        db::exec(
            db,
            "UPDATE `User` SET selfDeactivatedAt = NULL, updatedAt = ? WHERE id = ?",
            params![db::now(), user.id.as_str()],
        )
        .await?;
        reactivated = true;
    }
    let row = db::first(db, &users::self_select_sql(), params![user.id.as_str()]).await?;
    let self_user = match row {
        Some(r) => Value::Object(users::self_user(&r)?),
        None => Value::Null,
    };
    let mut body = json!({ "user": self_user, "accessToken": issued.access_token });
    if reactivated {
        body["reactivated"] = json!(true);
    }
    // sem req.user no login: o Node mascara até o invisível da própria pessoa
    mask_invisible(&mut body, None);
    Ok((body, issued.cookies))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codigo_de_recuperacao() {
        assert_eq!(
            normalize_recovery_code("ABCDE-12345").as_deref(),
            Some("abcde-12345")
        );
        assert_eq!(
            normalize_recovery_code(" abcde 12345 ").as_deref(),
            Some("abcde-12345")
        );
        assert_eq!(normalize_recovery_code("abcde1234"), None);
    }

    #[test]
    fn data_em_portugues() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 11, 21)
            .unwrap()
            .and_hms_milli_opt(14, 5, 9, 120)
            .unwrap();
        assert_eq!(pt_br_datetime(d), "21/11/2026, 14:05:09");
    }
}
