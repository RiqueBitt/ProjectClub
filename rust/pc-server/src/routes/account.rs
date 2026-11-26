//! Conta — porte de `register`, `sendVerification`, `verifyEmail`,
//! `forgotPassword`, `resetPassword`, `setup2FA`, `confirm2FA`,
//! `disable2FA`, `recoveryCodesStatus`, `regenerateRecoveryCodesHandler` e
//! `changePassword` (`server/src/controllers/authController.js`).
//!
//! Ordem igual à do Express: corpo JSON (400) → login (401/403/503) →
//! limitador da rota (429) → a rota.

use std::net::SocketAddr;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{ConnectInfo, FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use rand::Rng;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{AuthUser, error};
use crate::db::{self, Db};
use crate::params;
use crate::ratelimit::{self, Counted, Limit};
use crate::routes::login::{consume_recovery_code, password_ok, verify_totp_once_for};
use crate::session::{self as s};
use crate::{node, qr, totp, web};

type Out = anyhow::Result<Response>;

fn server_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Erro interno do servidor." }),
    )
}

fn err(status: StatusCode, msg: &str) -> Response {
    error(status, json!({ "error": msg }))
}

fn ok(body: Value) -> Response {
    Json(body).into_response()
}

/// O que toda rota daqui recebe já pronto.
struct Ctx {
    db: Db,
    body: Value,
    headers: axum::http::HeaderMap,
    user: Option<AuthUser>,
    counted: Option<Counted>,
}

impl Ctx {
    fn user_id(&self) -> &str {
        self.user
            .as_ref()
            .map(|u| u.id.as_str())
            .unwrap_or_default()
    }
    fn str(&self, k: &str) -> Option<&str> {
        self.body.get(k).and_then(Value::as_str)
    }
}

/// Corpo → login (se a rota pede) → limitador (se tem).
async fn prelude(
    state: &AppState,
    mut parts: Parts,
    body: &Bytes,
    needs_auth: bool,
    limit: Option<&Limit>,
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
    let counted = match limit {
        Some(l) => {
            let peer = parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0);
            let ip = s::client_ip(&parts.headers, peer).unwrap_or_else(|| "unknown".into());
            Some(ratelimit::guard(&state.cache, l, &ip).await?)
        }
        None => None,
    };
    Ok(Ctx {
        db,
        body,
        headers: parts.headers,
        user,
        counted,
    })
}

/// Roda a rota e põe os cabeçalhos do limitador na resposta.
async fn run<F, Fut>(
    state: AppState,
    parts: Parts,
    body: Bytes,
    auth: bool,
    limit: Option<&Limit>,
    f: F,
) -> Response
where
    F: FnOnce(AppState, Ctx) -> Fut,
    Fut: std::future::Future<Output = (Out, Option<Counted>)>,
{
    let ctx = match prelude(&state, parts, &body, auth, limit).await {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let (out, counted) = f(state, ctx).await;
    let mut res = out.unwrap_or_else(|e| {
        tracing::error!("[auth] {e}");
        server_error()
    });
    if let Some(c) = counted {
        c.apply(&mut res);
    }
    res
}

/// `isPasswordStrongEnough`: 8+ caracteres (contados como o JavaScript, em
/// UTF-16), com letra e número.
pub fn is_password_strong_enough(p: Option<&str>) -> bool {
    p.is_some_and(|p| {
        p.encode_utf16().count() >= 8
            && p.bytes().any(|b| b.is_ascii_alphabetic())
            && p.bytes().any(|b| b.is_ascii_digit())
    })
}

/// Senhas comuns demais — a MESMA lista do Node (server/src/data/senhas-comuns.txt).
const SENHAS_COMUNS: &str = include_str!("../../../../server/src/data/senhas-comuns.txt");
const COMMON_MSG: &str = "Essa senha é comum demais e fácil de adivinhar. Escolha outra.";
const PERSONAL_MSG: &str = "A senha não pode ser o seu nome de usuário ou o seu e-mail.";

/// "Senha123!" → "senha"; "abc12345" → "abc"; "12345678" → "12345678".
fn password_base(lower: &str) -> &str {
    let stripped = lower.trim_end_matches(|c: char| !c.is_ascii_lowercase());
    if stripped.is_empty() { lower } else { stripped }
}

/// `passwordProblem` (utils/passwordPolicy.js): senha comum demais ou igual
/// ao nome de usuário / começo do e-mail. `None` = pode usar.
pub fn password_problem(password: &str, username: &str, email: &str) -> Option<&'static str> {
    let lower = password.to_lowercase();
    let base = password_base(&lower);
    let common = SENHAS_COMUNS
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'));
    let mut found = false;
    for w in common {
        if w == lower || w == base {
            found = true;
            break;
        }
    }
    if found {
        return Some(COMMON_MSG);
    }
    let local = email.split('@').next().unwrap_or("");
    for p in [username, local] {
        let p = p.trim().to_lowercase();
        if p.chars().count() < 3 {
            continue;
        }
        if lower == p || base == password_base(&p) {
            return Some(PERSONAL_MSG);
        }
    }
    None
}

fn numeric_code(len: usize) -> String {
    let mut r = rand::rng();
    (0..len)
        .map(|_| char::from(b'0' + r.random_range(0..10u8)))
        .collect()
}

const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// `generateRecoveryCode`: `abcde-fghij`, sem letras/números ambíguos.
pub fn recovery_code() -> String {
    let mut r = rand::rng();
    let s: String = (0..10)
        .map(|_| RECOVERY_ALPHABET[r.random_range(0..RECOVERY_ALPHABET.len())] as char)
        .collect();
    format!("{}-{}", &s[..5], &s[5..])
}

async fn hash_password(password: &str) -> anyhow::Result<String> {
    let p = password.to_string();
    Ok(tokio::task::spawn_blocking(move || bcrypt::hash(p, 12)).await??)
}

/// `regenerateRecoveryCodes`: apaga os antigos e cria 10 novos (só o hash fica).
async fn regenerate_recovery_codes(db: &Db, user_id: &str) -> anyhow::Result<Vec<String>> {
    let codes: Vec<String> = (0..10).map(|_| recovery_code()).collect();
    let now = db::now();
    let mut steps = vec![(
        "DELETE FROM TwoFactorRecoveryCode WHERE userId = ?",
        params![user_id],
    )];
    for c in &codes {
        steps.push((
            "INSERT INTO TwoFactorRecoveryCode (id, userId, codeHash, usedAt, createdAt) VALUES (?, ?, ?, NULL, ?)",
            params![db::new_id(), user_id, s::sha256_hex(c), now],
        ));
    }
    db::transaction(db, steps).await?;
    Ok(codes)
}

/// O que as rotas de 2FA/senha precisam da conta.
struct Who {
    username: String,
    email: String,
    email_verified: bool,
    password_hash: String,
    two_factor_enabled: bool,
    two_factor_secret: Option<String>,
    two_factor_last_used_step: Option<i64>,
}

async fn who(db: &Db, user_id: &str) -> anyhow::Result<Option<Who>> {
    let row = db::first(
        db,
        "SELECT username, email, emailVerified, passwordHash, twoFactorEnabled, twoFactorSecret, twoFactorLastUsedStep \
         FROM `User` WHERE id = ?",
        params![user_id],
    )
    .await?;
    Ok(match row {
        None => None,
        Some(r) => Some(Who {
            username: db::get(&r, "username")?,
            email: db::get(&r, "email")?,
            email_verified: db::get(&r, "emailVerified")?,
            password_hash: db::get(&r, "passwordHash")?,
            two_factor_enabled: db::get(&r, "twoFactorEnabled")?,
            two_factor_secret: db::get(&r, "twoFactorSecret")?,
            two_factor_last_used_step: db::get(&r, "twoFactorLastUsedStep")?,
        }),
    })
}

/// `checkPassword`: a senha atual, obrigatória nas ações sensíveis.
async fn check_password(
    db: &Db,
    user_id: &str,
    password: Option<&str>,
) -> anyhow::Result<Option<Who>> {
    let Some(user) = who(db, user_id).await? else {
        return Ok(None);
    };
    let Some(p) = password.filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    Ok(password_ok(p.to_string(), user.password_hash.clone())
        .await
        .then_some(user))
}

// ---------------------------------------------------------------- rotas

/// `POST /register` — desativado (410), só a inscrição pela staff.
pub async fn register(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, false, Some(&ratelimit::AUTH), |_, c| async move {
        let r = error(
            StatusCode::GONE,
            json!({
                "error": "O cadastro direto foi desativado. Para entrar no Project Club, faça sua inscrição pela página \"Fazer inscrição\" — ela será analisada pela equipe.",
                "useApplications": true,
            }),
        );
        (Ok(r), c.counted)
    })
    .await
}

/// `createEmailVerificationCode`: só o último código vale.
async fn create_email_code(db: &Db, user_id: &str) -> anyhow::Result<String> {
    let code = numeric_code(6);
    db::exec(
        db,
        "DELETE FROM EmailVerificationCode WHERE userId = ?",
        params![user_id],
    )
    .await?;
    db::exec(
        db,
        "INSERT INTO EmailVerificationCode (id, code, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)",
        params![db::new_id(), code.as_str(), user_id, db::now() + chrono::Duration::minutes(15), db::now()],
    )
    .await?;
    Ok(code)
}

/// `POST /verify-email/send`.
pub async fn verify_email_send(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    run(
        state,
        parts,
        body,
        true,
        Some(&ratelimit::AUTH),
        |state, c| async move {
            let out = async {
                let Some(user) = who(&c.db, c.user_id()).await? else {
                    return Ok(server_error());
                };
                if user.email_verified {
                    return Ok(ok(json!({ "ok": true, "alreadyVerified": true })));
                }
                let code = create_email_code(&c.db, c.user_id()).await?;
                node::send_email(
                    &state,
                    json!({ "kind": "verification", "to": user.email, "code": code }),
                )
                .await;
                Ok(ok(json!({ "ok": true })))
            }
            .await;
            (out, c.counted)
        },
    )
    .await
}

/// `POST /verify-email/confirm`.
pub async fn verify_email_confirm(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    run(state, parts, body, true, Some(&ratelimit::CODE), |state, c| async move {
        let out = async {
            let invalid = || err(StatusCode::BAD_REQUEST, "Código inválido ou expirado.");
            let Some(code) = c.str("code").map(str::trim).filter(|v| v.len() == 6 && v.bytes().all(|b| b.is_ascii_digit()))
            else {
                return Ok(invalid());
            };
            let found: Option<String> = db::scalar(
                &c.db,
                "SELECT id FROM EmailVerificationCode WHERE userId = ? AND code = ? AND expiresAt > ? ORDER BY createdAt DESC LIMIT 1",
                params![c.user_id(), code, db::now()],
            )
            .await?;
            if found.is_none() {
                return Ok(invalid());
            }
            db::exec(
                &c.db,
                "UPDATE `User` SET emailVerified = 1, updatedAt = ? WHERE id = ?",
                params![db::now(), c.user_id()],
            )
            .await?;
            db::exec(&c.db, "DELETE FROM EmailVerificationCode WHERE userId = ?", params![c.user_id()]).await?;
            if let Some(acc) = s::account(&c.db, c.user_id()).await? {
                s::maybe_promote_to_platform_admin(&state, &c.db, &acc).await;
            }
            Ok(ok(json!({ "ok": true })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `POST /forgot-password` — sempre 200 (não entrega quem tem conta).
pub async fn forgot_password(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, false, Some(&ratelimit::AUTH), |state, c| async move {
        let out = async {
            let Some(email) = c.str("email").map(str::trim).filter(|e| !e.is_empty()) else {
                return Ok(ok(json!({ "ok": true })));
            };
            let row = db::first(&c.db, "SELECT id, email FROM `User` WHERE email = ?", params![email.to_lowercase()])
                .await?;
            let Some(row) = row else { return Ok(ok(json!({ "ok": true }))) };
            let (user_id, user_email): (String, String) = (db::get(&row, "id")?, db::get(&row, "email")?);
            // só o hash vai pro banco; pedir um link novo invalida os anteriores
            let mut raw = [0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::rng(), &mut raw);
            let token = hex::encode(raw);
            db::exec(&c.db, "UPDATE PasswordResetToken SET used = 1 WHERE userId = ? AND used = 0", params![user_id.as_str()])
                .await?;
            db::exec(
                &c.db,
                "INSERT INTO PasswordResetToken (id, token, userId, expiresAt, used, createdAt) VALUES (?, ?, ?, ?, 0, ?)",
                params![db::new_id(), s::sha256_hex(&token), user_id.as_str(), db::now() + chrono::Duration::hours(1), db::now()],
            )
            .await?;
            let url = format!("{}/reset-password?token={token}", state.config.client_origin);
            node::send_email(&state, json!({ "kind": "password-reset", "to": user_email, "url": url })).await;
            Ok(ok(json!({ "ok": true })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `POST /reset-password`.
pub async fn reset_password(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, false, Some(&ratelimit::AUTH), |state, c| async move {
        let out = async {
            let token = c.str("token").filter(|t| !t.is_empty());
            let new_password = c.str("newPassword");
            let (Some(token), true) = (token, is_password_strong_enough(new_password)) else {
                return Ok(err(StatusCode::BAD_REQUEST, "A senha deve ter pelo menos 8 caracteres, com letras e números."));
            };
            let row = db::first(
                &c.db,
                "SELECT userId, used, expiresAt FROM PasswordResetToken WHERE token = ?",
                params![s::sha256_hex(token)],
            )
            .await?;
            let valid = row.as_ref().map(|r| -> anyhow::Result<bool> {
                let used: bool = db::get(r, "used")?;
                let exp: chrono::NaiveDateTime = db::get(r, "expiresAt")?;
                Ok(!used && exp >= db::now())
            });
            let Some(Ok(true)) = valid else {
                return Ok(err(StatusCode::BAD_REQUEST, "Link inválido ou expirado."));
            };
            let user_id: String = db::get(row.as_ref().expect("linha"), "userId")?;
            let owner = db::first(&c.db, "SELECT username, email FROM `User` WHERE id = ?", params![user_id.as_str()]).await?;
            let (uname, mail) = match &owner {
                Some(r) => (db::get::<String>(r, "username")?, db::get::<String>(r, "email")?),
                None => (String::new(), String::new()),
            };
            if let Some(msg) = password_problem(new_password.unwrap_or_default(), &uname, &mail) {
                return Ok(err(StatusCode::BAD_REQUEST, msg));
            }
            let hash = hash_password(new_password.unwrap_or_default()).await?;
            let now = db::now();
            db::transaction(
                &c.db,
                vec![
                    // redefinir destrava a conta e conta como e-mail verificado
                    (
                        "UPDATE `User` SET passwordHash = ?, failedLoginAttempts = 0, loginLockedUntil = NULL, emailVerified = 1, updatedAt = ? WHERE id = ?",
                        params![hash, now, user_id.as_str()],
                    ),
                    ("UPDATE PasswordResetToken SET used = 1 WHERE userId = ? AND used = 0", params![user_id.as_str()]),
                    (
                        "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'PASSWORD_RESET' WHERE userId = ? AND revoked = 0",
                        params![now, user_id.as_str()],
                    ),
                ],
            )
            .await?;
            s::mark_sessions_revoked(&state, &user_id).await;
            s::revoke_account_switch(&c.db, &user_id).await;
            Ok(ok(json!({ "ok": true })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `POST /2fa/setup` — segredo novo + QR (exige a senha; não com 2FA ativo).
pub async fn twofa_setup(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, true, Some(&ratelimit::CODE), |_, c| async move {
        let out = async {
            let Some(user) = check_password(&c.db, c.user_id(), c.str("password")).await? else {
                return Ok(err(StatusCode::UNAUTHORIZED, "Senha incorreta."));
            };
            if user.two_factor_enabled {
                return Ok(err(
                    StatusCode::CONFLICT,
                    "A autenticação em dois fatores já está ativa. Desative-a primeiro para configurar de novo.",
                ));
            }
            let secret = totp::generate_secret();
            let otpauth = totp::otpauth_uri("Project Club", &user.email, &secret);
            let qr = qr::data_url(&otpauth)?;
            db::exec(
                &c.db,
                "UPDATE `User` SET twoFactorSecret = ?, twoFactorLastUsedStep = NULL, updatedAt = ? WHERE id = ?",
                params![secret.as_str(), db::now(), c.user_id()],
            )
            .await?;
            Ok(ok(json!({ "secret": secret, "qrDataUrl": qr })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `POST /2fa/confirm` — o primeiro código liga o 2FA e gera os códigos de recuperação.
pub async fn twofa_confirm(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(
        state,
        parts,
        body,
        true,
        Some(&ratelimit::CODE),
        |_, c| async move {
            let out = async {
                let Some(user) = who(&c.db, c.user_id()).await? else {
                    return Ok(server_error());
                };
                if user.two_factor_enabled {
                    return Ok(err(
                        StatusCode::CONFLICT,
                        "A autenticação em dois fatores já está ativa.",
                    ));
                }
                if user.two_factor_secret.as_deref().is_none_or(str::is_empty) {
                    return Ok(err(StatusCode::BAD_REQUEST, "Configure o 2FA primeiro."));
                }
                let code = c.str("code").unwrap_or_default();
                if !verify_totp_once_for(
                    &c.db,
                    c.user_id(),
                    user.two_factor_secret.as_deref(),
                    user.two_factor_last_used_step,
                    code,
                )
                .await?
                {
                    return Ok(err(StatusCode::BAD_REQUEST, "Código inválido."));
                }
                db::exec(
                    &c.db,
                    "UPDATE `User` SET twoFactorEnabled = 1, updatedAt = ? WHERE id = ?",
                    params![db::now(), c.user_id()],
                )
                .await?;
                let codes = regenerate_recovery_codes(&c.db, c.user_id()).await?;
                Ok(ok(json!({ "ok": true, "recoveryCodes": codes })))
            }
            .await;
            (out, c.counted)
        },
    )
    .await
}

/// `POST /2fa/disable` — exige a senha E um código (do app ou de recuperação).
pub async fn twofa_disable(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, true, Some(&ratelimit::CODE), |_, c| async move {
        let out = async {
            let Some(user) = check_password(&c.db, c.user_id(), c.str("password")).await? else {
                return Ok(err(StatusCode::UNAUTHORIZED, "Senha incorreta."));
            };
            if !user.two_factor_enabled {
                db::exec(
                    &c.db,
                    "UPDATE `User` SET twoFactorSecret = NULL, twoFactorLastUsedStep = NULL, updatedAt = ? WHERE id = ?",
                    params![db::now(), c.user_id()],
                )
                .await?;
                return Ok(ok(json!({ "ok": true })));
            }
            let recovery = c.str("recoveryCode").filter(|r| !r.trim().is_empty());
            let good = match recovery {
                Some(r) => consume_recovery_code(&c.db, c.user_id(), r).await?,
                None => {
                    verify_totp_once_for(
                        &c.db,
                        c.user_id(),
                        user.two_factor_secret.as_deref(),
                        user.two_factor_last_used_step,
                        c.str("code").unwrap_or_default(),
                    )
                    .await?
                }
            };
            if !good {
                let msg = if recovery.is_some() { "Código de recuperação inválido ou já usado." } else { "Código 2FA inválido." };
                return Ok(err(StatusCode::UNAUTHORIZED, msg));
            }
            db::transaction(
                &c.db,
                vec![
                    (
                        "UPDATE `User` SET twoFactorEnabled = 0, twoFactorSecret = NULL, twoFactorLastUsedStep = NULL, updatedAt = ? WHERE id = ?",
                        params![db::now(), c.user_id()],
                    ),
                    ("DELETE FROM TwoFactorRecoveryCode WHERE userId = ?", params![c.user_id()]),
                ],
            )
            .await?;
            Ok(ok(json!({ "ok": true })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `GET /2fa/recovery-codes` — só quantos códigos restam.
pub async fn recovery_codes_status(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    run(state, parts, body, true, None, |_, c| async move {
        let out = async {
            let remaining: i64 = db::scalar(
                &c.db,
                "SELECT COUNT(*) FROM TwoFactorRecoveryCode WHERE userId = ? AND usedAt IS NULL",
                params![c.user_id()],
            )
            .await?
            .unwrap_or(0);
            let enabled = who(&c.db, c.user_id())
                .await?
                .is_some_and(|u| u.two_factor_enabled);
            Ok(ok(json!({ "remaining": remaining, "enabled": enabled })))
        }
        .await;
        (out, c.counted)
    })
    .await
}

/// `POST /2fa/recovery-codes` — 10 códigos novos (os anteriores deixam de valer).
pub async fn recovery_codes_regenerate(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    run(
        state,
        parts,
        body,
        true,
        Some(&ratelimit::CODE),
        |_, c| async move {
            let out = async {
                let Some(user) = check_password(&c.db, c.user_id(), c.str("password")).await?
                else {
                    return Ok(err(StatusCode::UNAUTHORIZED, "Senha incorreta."));
                };
                if !user.two_factor_enabled {
                    return Ok(err(
                        StatusCode::BAD_REQUEST,
                        "Ative a autenticação em dois fatores primeiro.",
                    ));
                }
                let codes = regenerate_recovery_codes(&c.db, c.user_id()).await?;
                Ok(ok(json!({ "recoveryCodes": codes })))
            }
            .await;
            (out, c.counted)
        },
    )
    .await
}

/// `POST /change-password` — encerra as OUTRAS sessões e mantém esta.
pub async fn change_password(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    run(state, parts, body, true, Some(&ratelimit::AUTH), |state, c| async move {
        let out = async {
            let new_password = c.str("newPassword");
            if !is_password_strong_enough(new_password) {
                return Ok(err(
                    StatusCode::BAD_REQUEST,
                    "A nova senha deve ter pelo menos 8 caracteres, com letras e números.",
                ));
            }
            let Some(user) = who(&c.db, c.user_id()).await? else { return Ok(server_error()) };
            let current = c.str("currentPassword").filter(|p| !p.is_empty());
            let right = match current {
                Some(p) => password_ok(p.to_string(), user.password_hash.clone()).await,
                None => false,
            };
            if !right {
                return Ok(err(StatusCode::UNAUTHORIZED, "Senha atual incorreta."));
            }
            if let Some(msg) = password_problem(new_password.unwrap_or_default(), &user.username, &user.email) {
                return Ok(err(StatusCode::BAD_REQUEST, msg));
            }
            let hash = hash_password(new_password.unwrap_or_default()).await?;
            let current_hash = s::current_refresh_hash(&c.headers);
            let now = db::now();
            let revoke = match &current_hash {
                Some(h) => (
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'PASSWORD_CHANGE' WHERE userId = ? AND revoked = 0 AND tokenHash <> ?",
                    params![now, c.user_id(), h.as_str()],
                ),
                None => (
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'PASSWORD_CHANGE' WHERE userId = ? AND revoked = 0",
                    params![now, c.user_id()],
                ),
            };
            db::transaction(
                &c.db,
                vec![
                    ("UPDATE `User` SET passwordHash = ?, updatedAt = ? WHERE id = ?", params![hash, now, c.user_id()]),
                    revoke,
                    ("UPDATE PasswordResetToken SET used = 1 WHERE userId = ? AND used = 0", params![c.user_id()]),
                ],
            )
            .await?;
            s::mark_sessions_revoked(&state, c.user_id()).await;
            s::revoke_account_switch(&c.db, c.user_id()).await;
            let mut res = ok(json!({ "ok": true, "keptCurrentSession": current_hash.is_some() }));
            if let Some(h) = &current_hash {
                let rid = s::refresh_by_hash(&c.db, h).await?.map(|r| r.id);
                res.headers_mut().append(header::SET_COOKIE, s::keep_cookie(&state, c.user_id(), rid.as_deref()));
            }
            Ok(res)
        }
        .await;
        (out, c.counted)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn senha_forte_como_o_node() {
        assert!(is_password_strong_enough(Some("abcdefg1")));
        // senhas comuns e pessoais (mesma lista do Node)
        assert!(password_problem("senha123", "ana", "ana@x.com").is_some());
        assert!(password_problem("Qwerty!1", "ana", "ana@x.com").is_some());
        assert!(password_problem("Flamengo2024", "ana", "ana@x.com").is_some());
        assert_eq!(
            password_problem("riquebitt9", "riquebitt", "r@x.com"),
            Some(PERSONAL_MSG)
        );
        assert_eq!(
            password_problem("joana77", "ana", "joana@x.com"),
            Some(PERSONAL_MSG)
        );
        assert_eq!(
            password_problem("Tr0pical-Lua-77", "ana", "ana@x.com"),
            None
        );
        assert_eq!(password_problem("xk29fj3la", "ana", "ana@x.com"), None);
        assert!(!is_password_strong_enough(Some("abcdefgh")));
        assert!(!is_password_strong_enough(Some("12345678")));
        assert!(!is_password_strong_enough(Some("abc12")));
        assert!(!is_password_strong_enough(None));
        // emoji conta 2 no JavaScript (UTF-16)
        assert!(is_password_strong_enough(Some("a1😀😀😀")));
    }

    #[test]
    fn codigos() {
        let c = recovery_code();
        assert_eq!(c.len(), 11);
        assert_eq!(&c[5..6], "-");
        assert!(
            c.bytes()
                .filter(|b| *b != b'-')
                .all(|b| RECOVERY_ALPHABET.contains(&b))
        );
        let n = numeric_code(6);
        assert!(n.len() == 6 && n.bytes().all(|b| b.is_ascii_digit()));
    }
}
