//! Sessões — porte de `issueSession`, `revokeRefreshTokens`, `refreshChain`
//! (`server/src/controllers/authController.js`), `server/src/services/sessionKeep.js`
//! e `keepSessionAlive` (`server/src/services/sessionSecurity.js`).
//!
//! Cada sessão (aparelho) é uma corrente de refresh tokens: a cada
//! renovação o token atual é revogado (`ROTATED`) e aponta (`replacedById`)
//! pro novo. Só o hash (SHA-256) do token fica no banco.

use std::net::SocketAddr;

use axum::http::{HeaderMap, HeaderValue, header};
use chrono::NaiveDateTime;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::AppState;
use crate::db::{self, Db, DbResult, Row};
use crate::iron;
use crate::params;

pub const REFRESH_COOKIE: &str = "refreshToken";
pub const KEEP_COOKIE: &str = "pcKeep";
const COOKIE_PATH: &str = "/api/auth";
const KEEP_TTL_SECS: u64 = 90 * 24 * 60 * 60;

/// Motivos de revogação (os mesmos textos gravados pelo Node).
pub mod reason {
    pub const ROTATED: &str = "ROTATED";
    pub const LOGOUT: &str = "LOGOUT";
    pub const ADMIN: &str = "ADMIN";
    pub const THEFT: &str = "THEFT";
    pub const ABANDONED: &str = "ABANDONED";
}

/// Revogações que NÃO encerram a sessão (rotação normal, substituto perdido).
pub const NON_TERMINAL_REASONS: [&str; 2] = [reason::ROTATED, reason::ABANDONED];

pub fn sha256_hex(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

/// `generateRefreshToken`: 48 bytes aleatórios em hex.
pub fn new_refresh_token() -> String {
    let mut b = [0u8; 48];
    rand::rng().fill_bytes(&mut b);
    hex::encode(b)
}

/// IP de quem pediu, como o `req.ip` do Express com `trust proxy 1`: o
/// último endereço do `X-Forwarded-For` (o que o proxy da hospedagem pôs);
/// sem ele, o da conexão.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    let from_header = headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .rfind(|v| !v.is_empty())
        .map(String::from);
    from_header.or_else(|| {
        peer.map(|p| match p.ip() {
            std::net::IpAddr::V4(v4) => format!("::ffff:{v4}"),
            std::net::IpAddr::V6(v6) => v6.to_string(),
        })
    })
}

/// Cookies do pedido (como o `cookie-parser`, que decodifica `%XX`).
pub fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| k.trim() == name)
        .map(|(_, v)| {
            let v = v.trim().trim_matches('"');
            url::form_urlencoded::parse(format!("x={}", v.replace('+', "%2B")).as_bytes())
                .next()
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default()
        })
        .filter(|v| !v.is_empty())
}

/// `Set-Cookie` igual ao `res.cookie` do Express (httpOnly, sameSite lax, path /api/auth).
pub fn set_cookie(name: &str, value: &str, max_age_secs: u64, secure: bool) -> HeaderValue {
    let expires = chrono::Utc::now() + chrono::Duration::seconds(max_age_secs as i64);
    let mut s = format!(
        "{name}={value}; Max-Age={max_age_secs}; Path={COOKIE_PATH}; Expires={}; HttpOnly",
        expires.format("%a, %d %b %Y %H:%M:%S GMT")
    );
    if secure {
        s.push_str("; Secure");
    }
    s.push_str("; SameSite=Lax");
    HeaderValue::from_str(&s).expect("cookie válido")
}

/// `res.clearCookie(name, { path: '/api/auth' })`.
pub fn clear_cookie(name: &str) -> HeaderValue {
    HeaderValue::from_str(&format!(
        "{name}=; Path={COOKIE_PATH}; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    ))
    .expect("cookie válido")
}

/// Uma linha de `RefreshToken`.
#[derive(Clone, Debug)]
pub struct RefreshRow {
    pub id: String,
    pub user_id: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    pub revoked: bool,
    pub revoked_at: Option<NaiveDateTime>,
    pub revoked_reason: Option<String>,
    pub replaced_by_id: Option<String>,
    pub session_started_at: Option<NaiveDateTime>,
}

impl RefreshRow {
    fn from_row(r: &Row) -> DbResult<Self> {
        Ok(Self {
            id: db::get(r, "id")?,
            user_id: db::get(r, "userId")?,
            user_agent: db::get(r, "userAgent")?,
            ip_address: db::get(r, "ipAddress")?,
            created_at: db::get(r, "createdAt")?,
            expires_at: db::get(r, "expiresAt")?,
            revoked: db::get(r, "revoked")?,
            revoked_at: db::get(r, "revokedAt")?,
            revoked_reason: db::get(r, "revokedReason")?,
            replaced_by_id: db::get(r, "replacedById")?,
            session_started_at: db::get(r, "sessionStartedAt")?,
        })
    }
}

const REFRESH_COLS: &str = "id, userId, userAgent, ipAddress, createdAt, expiresAt, revoked, revokedAt, \
     revokedReason, replacedById, sessionStartedAt";

pub async fn refresh_by_hash(db: &Db, hash: &str) -> DbResult<Option<RefreshRow>> {
    let sql = format!("SELECT {REFRESH_COLS} FROM RefreshToken WHERE tokenHash = ?");
    db::first(db, &sql, params![hash])
        .await?
        .as_ref()
        .map(RefreshRow::from_row)
        .transpose()
}

pub async fn refresh_by_id(db: &Db, id: &str) -> DbResult<Option<RefreshRow>> {
    let sql = format!("SELECT {REFRESH_COLS} FROM RefreshToken WHERE id = ?");
    db::first(db, &sql, params![id])
        .await?
        .as_ref()
        .map(RefreshRow::from_row)
        .transpose()
}

/// `refreshChain`/`followChain`: a corrente de rotação a partir de `start`.
pub async fn chain(db: &Db, start: &str) -> DbResult<Vec<RefreshRow>> {
    let mut out: Vec<RefreshRow> = Vec::new();
    let mut id = Some(start.to_string());
    while let Some(cur) = id.take() {
        if out.len() >= 200 || out.iter().any(|r| r.id == cur) {
            break;
        }
        let Some(row) = refresh_by_id(db, &cur).await? else {
            break;
        };
        id = row.replaced_by_id.clone();
        out.push(row);
    }
    Ok(out)
}

/// `revokeRefreshTokens({ id: { in: ids } }, reason)` (só os ainda válidos).
pub async fn revoke_ids(db: &Db, ids: &[String], why: &str) -> DbResult<u64> {
    if ids.is_empty() {
        return Ok(0);
    }
    let marks = vec!["?"; ids.len()].join(", ");
    let sql = format!(
        "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = ? WHERE revoked = 0 AND id IN ({marks})"
    );
    let mut p = params![db::now(), why];
    p.extend(ids.iter().map(|i| db::Value::from(i.as_str())));
    db::exec(db, &sql, p).await
}

pub async fn revoke_hash(db: &Db, hash: &str, why: &str) -> DbResult<u64> {
    db::exec(
        db,
        "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = ? WHERE revoked = 0 AND tokenHash = ?",
        params![db::now(), why, hash],
    )
    .await
}

/// Revoga uma linha se ainda não estava revogada; `true` = esta chamada ganhou.
pub async fn claim(db: &Db, id: &str, why: &str, touch_last_used: bool) -> DbResult<bool> {
    let now = db::now();
    let n = if touch_last_used {
        db::exec(
            db,
            "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = ?, lastUsedAt = ? WHERE id = ? AND revoked = 0",
            params![now, why, now, id],
        )
        .await?
    } else {
        db::exec(
            db,
            "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = ? WHERE id = ? AND revoked = 0",
            params![now, why, id],
        )
        .await?
    };
    Ok(n == 1)
}

pub async fn set_replaced_by(db: &Db, id: &str, new_id: &str) {
    let _ = db::exec(
        db,
        "UPDATE RefreshToken SET replacedById = ? WHERE id = ?",
        params![new_id, id],
    )
    .await;
}

/// Senha do selo do "lembrar login": HMAC-SHA256(JWT_REFRESH_SECRET, 'pc-keep-session-v1') em hex.
pub fn keep_password(refresh_secret: &str) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(refresh_secret.as_bytes()).expect("hmac");
    m.update(b"pc-keep-session-v1");
    hex::encode(m.finalize().into_bytes())
}

/// Resultado de abrir uma sessão: o token de acesso e os cookies a gravar.
pub struct Issued {
    pub access_token: String,
    pub refresh_id: String,
    pub cookies: Vec<HeaderValue>,
}

/// `issueSession`: refresh token novo (cookie), cookie "lembrar login" e token de acesso.
pub async fn issue(
    state: &AppState,
    db: &Db,
    user_id: &str,
    user_agent: Option<&str>,
    ip: Option<&str>,
    session_started_at: Option<NaiveDateTime>,
) -> DbResult<Issued> {
    let cfg = &state.config;
    let access_token = state.tokens.sign(user_id, cfg.access_token_ttl);
    let raw = new_refresh_token();
    let now = db::now();
    let expires_at = now + chrono::Duration::days(cfg.refresh_token_ttl_days);
    let id = db::new_id();
    db::exec(
        db,
        "INSERT INTO RefreshToken (id, tokenHash, userId, userAgent, ipAddress, createdAt, expiresAt, revoked, \
         sessionStartedAt, lastUsedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        params![
            id.as_str(),
            sha256_hex(&raw),
            user_id,
            user_agent,
            ip,
            now,
            expires_at,
            session_started_at.unwrap_or(now),
            now
        ],
    )
    .await?;
    let secure = cfg.node_env == "production";
    let mut cookies = vec![set_cookie(
        REFRESH_COOKIE,
        &raw,
        (cfg.refresh_token_ttl_days * 24 * 60 * 60) as u64,
        secure,
    )];
    cookies.push(keep_cookie(state, user_id, Some(&id)));
    Ok(Issued {
        access_token,
        refresh_id: id,
        cookies,
    })
}

/// `setKeepCookie`: o cookie "lembrar login" (90 dias), com o id do refresh
/// token que o criou quando houver.
pub fn keep_cookie(state: &AppState, user_id: &str, refresh_id: Option<&str>) -> HeaderValue {
    let now = chrono::Utc::now().timestamp_millis();
    let mut payload = json!({ "uid": user_id, "iat": now });
    if let Some(rid) = refresh_id {
        payload["rid"] = json!(rid);
    }
    let sealed = iron::seal(
        &payload.to_string(),
        "1",
        &keep_password(&state.config.jwt_refresh_secret),
        KEEP_TTL_SECS,
        now,
    );
    set_cookie(
        KEEP_COOKIE,
        &sealed,
        KEEP_TTL_SECS,
        state.config.node_env == "production",
    )
}

/// `markSessionsRevoked`: "lembrar login" de antes de agora deixa de valer
/// em todos os aparelhos (chave no Redis por 90 dias). Falha só vai pro log.
pub async fn mark_sessions_revoked(state: &AppState, user_id: &str) {
    let now = chrono::Utc::now().timestamp_millis().to_string();
    state
        .cache
        .set_raw(&format!("sess:revoked-at:{user_id}"), &now, KEEP_TTL_SECS)
        .await;
}

/// Hash do refresh token do cookie deste pedido (`currentRefreshHash`).
pub fn current_refresh_hash(headers: &HeaderMap) -> Option<String> {
    read_cookie(headers, REFRESH_COOKIE).map(|raw| sha256_hex(&raw))
}

/// `accountSwitchController.revokeAllFor`: contas salvas pra troca rápida saem.
pub async fn revoke_account_switch(db: &Db, user_id: &str) {
    let _ = db::exec(
        db,
        "DELETE FROM AccountSwitchToken WHERE userId = ?",
        params![user_id],
    )
    .await;
}

/// `readKeepCookieData`: `(uid, rid)` do cookie "lembrar login", se ele
/// for válido e não for de antes de um "sair de todos os aparelhos".
pub async fn read_keep(state: &AppState, headers: &HeaderMap) -> Option<(String, Option<String>)> {
    let raw = read_cookie(headers, KEEP_COOKIE)?;
    let password = keep_password(&state.config.jwt_refresh_secret);
    let text = iron::unseal(
        &raw,
        &[("1", &password)],
        chrono::Utc::now().timestamp_millis(),
    )?;
    let data: Value = serde_json::from_str(&text).ok()?;
    let uid = data
        .get("uid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?
        .to_string();
    let iat = data
        .get("iat")
        .and_then(Value::as_f64)
        .filter(|v| *v != 0.0)?;
    // sem Redis (ou com erro) o Node recusa — aqui também
    let revoked_at: f64 = state
        .cache
        .get_raw(&format!("sess:revoked-at:{uid}"))
        .await?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    if iat < revoked_at {
        return None;
    }
    let rid = data.get("rid").and_then(Value::as_str).map(String::from);
    Some((uid, rid))
}

/// `keepSessionAlive`: o aparelho do cookie "lembrar login" não foi encerrado.
pub async fn keep_session_alive(db: &Db, rid: Option<&str>) -> DbResult<bool> {
    let Some(rid) = rid else { return Ok(true) };
    let c = chain(db, rid).await?;
    Ok(!c.iter().any(|t| {
        t.revoked && !NON_TERMINAL_REASONS.contains(&t.revoked_reason.as_deref().unwrap_or(""))
    }))
}

/// O que o login/refresh precisam saber da conta.
#[derive(Debug, Clone)]
pub struct AccountState {
    pub id: String,
    pub email: String,
    pub email_verified: bool,
    pub platform_role: String,
    pub platform_admin_bootstrapped_at: Option<NaiveDateTime>,
    pub is_platform_banned: bool,
    pub suspended_until: Option<NaiveDateTime>,
    pub account_disabled_at: Option<NaiveDateTime>,
}

pub async fn account(db: &Db, user_id: &str) -> DbResult<Option<AccountState>> {
    let row = db::first(
        db,
        "SELECT id, email, emailVerified, platformRole, platformAdminBootstrappedAt, isPlatformBanned, \
         suspendedUntil, accountDisabledAt FROM `User` WHERE id = ?",
        params![user_id],
    )
    .await?;
    row.map(|r| {
        Ok(AccountState {
            id: db::get(&r, "id")?,
            email: db::get(&r, "email")?,
            email_verified: db::get(&r, "emailVerified")?,
            platform_role: db::get(&r, "platformRole")?,
            platform_admin_bootstrapped_at: db::get(&r, "platformAdminBootstrappedAt")?,
            is_platform_banned: db::get(&r, "isPlatformBanned")?,
            suspended_until: db::get(&r, "suspendedUntil")?,
            account_disabled_at: db::get(&r, "accountDisabledAt")?,
        })
    })
    .transpose()
}

/// `isAccountBlocked`: sem conta, banida, desativada ou suspensa.
pub fn is_blocked(user: Option<&AccountState>) -> bool {
    match user {
        None => true,
        Some(u) => {
            u.is_platform_banned
                || u.account_disabled_at.is_some()
                || u.suspended_until.is_some_and(|s| s > db::now())
        }
    }
}

/// `maybePromoteToPlatformAdmin`: o e-mail do dono (`PLATFORM_ADMIN_EMAIL`),
/// verificado, vira ADMIN (com as insígnias de staff e de dono).
pub async fn maybe_promote_to_platform_admin(state: &AppState, db: &Db, user: &AccountState) {
    let email = state.config.platform_admin_email.trim().to_lowercase();
    if email.is_empty() || user.email != email {
        return;
    }
    if user.platform_role == "ADMIN" {
        if user.platform_admin_bootstrapped_at.is_none() {
            let _ = db::exec(
                db,
                "UPDATE `User` SET platformAdminBootstrappedAt = ?, updatedAt = ? WHERE id = ?",
                params![db::now(), db::now(), user.id.as_str()],
            )
            .await;
        }
        return;
    }
    if !user.email_verified || user.platform_admin_bootstrapped_at.is_some() {
        return;
    }
    let r = db::exec(
        db,
        "UPDATE `User` SET platformRole = 'ADMIN', platformAdminBootstrappedAt = ?, updatedAt = ? WHERE id = ?",
        params![db::now(), db::now(), user.id.as_str()],
    )
    .await;
    if r.is_ok() {
        tracing::info!(
            "[admin-bootstrap] {} promovido a ADMIN da plataforma (checagem em login/refresh).",
            user.email
        );
        for key in ["STAFF", "PLATFORM_OWNER"] {
            grant_badge_by_key(db, &user.id, key).await;
        }
    }
}

/// `grantBadgeByKey` (upsert sem mudar nada se já tiver).
pub async fn grant_badge_by_key(db: &Db, user_id: &str, key: &str) {
    let badge: Option<String> =
        db::scalar(db, "SELECT id FROM Badge WHERE `key` = ?", params![key])
            .await
            .ok()
            .flatten();
    if let Some(badge_id) = badge {
        let _ = db::exec(
            db,
            "INSERT IGNORE INTO UserBadge (id, userId, badgeId, awardedAt) VALUES (?, ?, ?, ?)",
            params![db::new_id(), user_id, badge_id, db::now()],
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_como_o_express() {
        let mut h = HeaderMap::new();
        h.insert(
            "x-forwarded-for",
            HeaderValue::from_static("9.9.9.9, 200.1.2.3"),
        );
        assert_eq!(client_ip(&h, None).as_deref(), Some("200.1.2.3"));
        let peer: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        assert_eq!(
            client_ip(&HeaderMap::new(), Some(peer)).as_deref(),
            Some("::ffff:127.0.0.1")
        );
    }

    #[test]
    fn le_cookies() {
        let mut h = HeaderMap::new();
        h.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; refreshToken=abc%2Fd; pcKeep=Fe26.2*1*x~2"),
        );
        assert_eq!(read_cookie(&h, REFRESH_COOKIE).as_deref(), Some("abc/d"));
        assert_eq!(
            read_cookie(&h, KEEP_COOKIE).as_deref(),
            Some("Fe26.2*1*x~2")
        );
        assert_eq!(read_cookie(&h, "nada"), None);
    }

    #[test]
    fn cookie_igual_ao_express() {
        let c = set_cookie("refreshToken", "abc", 60, true);
        let s = c.to_str().unwrap();
        assert!(s.starts_with("refreshToken=abc; Max-Age=60; Path=/api/auth; Expires="));
        assert!(s.ends_with(" GMT; HttpOnly; Secure; SameSite=Lax"));
        assert_eq!(
            clear_cookie("pcKeep").to_str().unwrap(),
            "pcKeep=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        );
    }

    #[test]
    fn senha_do_selo_igual_a_do_node() {
        // crypto.createHmac('sha256', 'segredo').update('pc-keep-session-v1').digest('hex')
        assert_eq!(
            keep_password("segredo"),
            include_str!("../tests/fixtures/keep_password.txt").trim()
        );
    }

    #[test]
    fn token_tem_96_hex() {
        let t = new_refresh_token();
        assert_eq!(t.len(), 96);
        assert_eq!(
            sha256_hex("a"),
            "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"
        );
    }
}
