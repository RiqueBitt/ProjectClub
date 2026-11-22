//! Aparelhos conectados, desativar/excluir conta e troca rápida de conta —
//! porte de `listSessions`, `revokeSession`, `revokeOtherSessions`,
//! `deactivateAccount`, `deleteAccount` (`authController.js`) e de
//! `accountSwitchController.js`.

use std::sync::LazyLock;

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use regex::{Regex, RegexBuilder};
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::error;
use crate::db::{self, Db};
use crate::node;
use crate::params;
use crate::ratelimit;
use crate::routes::ctx::{By, err, finish, js_string, prelude_or_return, security_log, uid};
use crate::routes::login::{Req, complete_login, find_user_by_id, password_ok};
use crate::session::{self as s};

fn re(p: &str) -> Regex {
    RegexBuilder::new(p)
        .case_insensitive(true)
        .build()
        .expect("regex")
}

/// `describeDevice` (`services/sessionSecurity.js`): "Chrome no Windows" etc.
pub fn describe_device(user_agent: Option<&str>) -> String {
    static BROWSERS: LazyLock<Vec<(Regex, &str)>> = LazyLock::new(|| {
        vec![
            (re(r"Electron/"), "App desktop"),
            (re(r"Edg(e|A|iOS)?/"), "Edge"),
            (re(r"OPR/|Opera"), "Opera"),
            (re(r"SamsungBrowser"), "Samsung Internet"),
            (re(r"Firefox/|FxiOS"), "Firefox"),
            (re(r"Chrome/|CriOS"), "Chrome"),
            (re(r"Safari/"), "Safari"),
        ]
    });
    static SYSTEMS: LazyLock<Vec<(Regex, &str)>> = LazyLock::new(|| {
        vec![
            (re(r"Android"), "Android"),
            (re(r"iPhone"), "iPhone"),
            (re(r"iPad"), "iPad"),
            (re(r"Windows"), "Windows"),
            (re(r"Mac OS X|Macintosh"), "macOS"),
            (re(r"CrOS"), "ChromeOS"),
            (re(r"Linux"), "Linux"),
        ]
    });
    static APP: LazyLock<Regex> = LazyLock::new(|| re(r"ProjectClub|Capacitor|wv\)"));
    let ua = user_agent.unwrap_or("");
    if ua.is_empty() {
        return "Dispositivo desconhecido".into();
    }
    let mut browser = BROWSERS
        .iter()
        .find(|(r, _)| r.is_match(ua))
        .map(|(_, b)| *b)
        .unwrap_or("Navegador");
    let os = SYSTEMS
        .iter()
        .find(|(r, _)| r.is_match(ua))
        .map(|(_, o)| *o)
        .unwrap_or("");
    if os == "Android" && APP.is_match(ua) {
        browser = "App";
    }
    if os.is_empty() {
        browser.to_string()
    } else {
        format!("{browser} no {os}")
    }
}

/// `maskIp`: só o começo da rede (o IP completo nunca sai do servidor).
pub fn mask_ip(ip: Option<&str>) -> Option<String> {
    let ip = ip.filter(|i| !i.is_empty())?;
    let clean = ip
        .strip_prefix("::ffff:")
        .or_else(|| ip.strip_prefix("::FFFF:"))
        .unwrap_or(ip);
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() == 4
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Some(format!("{}.{}.x.x", parts[0], parts[1]));
    }
    if clean.contains(':') {
        let groups: Vec<&str> = clean.split(':').filter(|g| !g.is_empty()).collect();
        return Some(format!(
            "{}:…",
            groups.iter().take(2).copied().collect::<Vec<_>>().join(":")
        ));
    }
    None
}

// ---------------------------------------------------------------- sessões

/// `GET /sessions` — aparelhos conectados (o atual marcado).
pub async fn list(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let current = s::current_refresh_hash(&c.headers);
        let rows = db::all(
            &c.db,
            "SELECT id, userAgent, ipAddress, createdAt, tokenHash, lastUsedAt, sessionStartedAt FROM RefreshToken \
             WHERE userId = ? AND revoked = 0 AND expiresAt > ? ORDER BY createdAt DESC",
            params![uid(&c), db::now()],
        )
        .await?;
        let mut sessions = Vec::with_capacity(rows.len());
        for r in &rows {
            let ua: Option<String> = db::get(r, "userAgent")?;
            let ip: Option<String> = db::get(r, "ipAddress")?;
            let created: chrono::NaiveDateTime = db::get(r, "createdAt")?;
            let started: Option<chrono::NaiveDateTime> = db::get(r, "sessionStartedAt")?;
            let last: Option<chrono::NaiveDateTime> = db::get(r, "lastUsedAt")?;
            let hash: String = db::get(r, "tokenHash")?;
            sessions.push(json!({
                "id": db::get::<String>(r, "id")?,
                "userAgent": ua,
                "device": describe_device(ua.as_deref()),
                "ip": mask_ip(ip.as_deref()),
                "createdAt": db::iso(started.unwrap_or(created)),
                "lastUsedAt": db::iso(last.unwrap_or(created)),
                "isCurrent": current.as_deref() == Some(hash.as_str()),
            }));
        }
        Ok(Json(json!({ "sessions": sessions })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `revokeSessionFamily`: a sessão inteira (o token atual e um filho que
/// esteja nascendo numa rotação ao mesmo tempo).
async fn revoke_session_family(db: &Db, row: &s::RefreshRow, why: &str) -> db::DbResult<()> {
    if let Some(started) = row.session_started_at {
        db::exec(
            db,
            "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = ? \
             WHERE userId = ? AND sessionStartedAt = ? AND revoked = 0",
            params![db::now(), why, row.user_id.as_str(), started],
        )
        .await?;
    }
    let chain = s::chain(db, &row.id).await?;
    let ids: Vec<String> = chain
        .into_iter()
        .filter(|t| t.user_id == row.user_id && !t.revoked)
        .map(|t| t.id)
        .collect();
    s::revoke_ids(db, &ids, why).await?;
    Ok(())
}

/// `DELETE /sessions/:id` — encerra um aparelho (não o atual).
pub async fn revoke_one(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let current = s::current_refresh_hash(&c.headers);
        let Some(row) = s::refresh_by_id(&c.db, &id)
            .await?
            .filter(|r| r.user_id == uid(&c))
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Sessão não encontrada."));
        };
        let hash: Option<String> = db::scalar(
            &c.db,
            "SELECT tokenHash FROM RefreshToken WHERE id = ?",
            params![id.as_str()],
        )
        .await?;
        if hash.is_some() && hash == current {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "Use \"Sair\" para encerrar a sessão atual.",
            ));
        }
        revoke_session_family(&c.db, &row, "REVOKED").await?;
        security_log(
            &c.db,
            uid(&c),
            "SESSION_REVOKED",
            &c.headers,
            c.ip.as_deref(),
        )
        .await;
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `DELETE /sessions/other` — sai de todos os OUTROS aparelhos.
pub async fn revoke_others(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let current = s::current_refresh_hash(&c.headers);
        match &current {
            Some(h) => {
                db::exec(
                    &c.db,
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'REVOKED' \
                     WHERE userId = ? AND tokenHash <> ? AND revoked = 0",
                    params![db::now(), uid(&c), h.as_str()],
                )
                .await?
            }
            None => {
                db::exec(
                    &c.db,
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'REVOKED' WHERE userId = ? AND revoked = 0",
                    params![db::now(), uid(&c)],
                )
                .await?
            }
        };
        s::mark_sessions_revoked(&state, uid(&c)).await;
        let rid = match &current {
            Some(h) => s::refresh_by_hash(&c.db, h).await?.map(|r| r.id),
            None => None,
        };
        security_log(&c.db, uid(&c), "SESSIONS_REVOKED_OTHERS", &c.headers, c.ip.as_deref()).await;
        let mut res = Json(json!({ "ok": true })).into_response();
        res.headers_mut().append(header::SET_COOKIE, s::keep_cookie(&state, uid(&c), rid.as_deref()));
        Ok(res)
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- conta

async fn check_password(db: &Db, user_id: &str, password: Option<&str>) -> anyhow::Result<bool> {
    let Some(p) = password.filter(|p| !p.is_empty()) else {
        return Ok(false);
    };
    let hash: Option<String> = db::scalar(
        db,
        "SELECT passwordHash FROM `User` WHERE id = ?",
        params![user_id],
    )
    .await?;
    let Some(hash) = hash else { return Ok(false) };
    Ok(password_ok(p.to_string(), hash).await)
}

fn logged_out(body: Value) -> Response {
    let mut res = Json(body).into_response();
    res.headers_mut()
        .append(header::SET_COOKIE, s::clear_cookie(s::REFRESH_COOKIE));
    res.headers_mut()
        .append(header::SET_COOKIE, s::clear_cookie(s::KEEP_COOKIE));
    res
}

/// `POST /deactivate` — desativa por um tempo (entrar de novo reativa).
pub async fn deactivate(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        if !check_password(&c.db, uid(&c), c.body.get("password").and_then(Value::as_str)).await? {
            return Ok(err(StatusCode::UNAUTHORIZED, "Senha incorreta."));
        }
        let now = db::now();
        db::transaction(
            &c.db,
            vec![
                (
                    "UPDATE `User` SET selfDeactivatedAt = ?, status = 'OFFLINE', updatedAt = ? WHERE id = ?",
                    params![now, now, uid(&c)],
                ),
                (
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'LOGOUT' WHERE userId = ? AND revoked = 0",
                    params![now, uid(&c)],
                ),
            ],
        )
        .await?;
        s::mark_sessions_revoked(&state, uid(&c)).await;
        node::kick(&state, uid(&c), "account:disabled", json!({ "temporary": true }));
        Ok(logged_out(json!({ "ok": true })))
    }
    .await;
    finish(out, c.counted)
}

/// `POST /delete-account` — na verdade desativa de vez (nada é apagado).
pub async fn delete_account(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        if !check_password(&c.db, uid(&c), c.body.get("password").and_then(Value::as_str)).await? {
            return Ok(err(StatusCode::UNAUTHORIZED, "Senha incorreta."));
        }
        let now = db::now();
        db::transaction(
            &c.db,
            vec![
                ("UPDATE `User` SET accountDisabledAt = ?, updatedAt = ? WHERE id = ?", params![now, now, uid(&c)]),
                (
                    "UPDATE RefreshToken SET revoked = 1, revokedAt = ?, revokedReason = 'ACCOUNT_DISABLED' WHERE userId = ? AND revoked = 0",
                    params![now, uid(&c)],
                ),
            ],
        )
        .await?;
        s::mark_sessions_revoked(&state, uid(&c)).await;
        s::revoke_account_switch(&c.db, uid(&c)).await;
        node::kick(&state, uid(&c), "account:disabled", json!({}));
        Ok(logged_out(json!({ "ok": true })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- troca rápida de conta

const SWITCH_TTL_DAYS: i64 = 90;

/// `POST /switch/remember` — guarda esta conta pra troca rápida neste aparelho (até 10).
pub async fn switch_remember(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let mut raw = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::rng(), &mut raw);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        // fica com as 9 mais recentes + esta
        let old: Vec<String> = db::column(
            &c.db,
            "SELECT id FROM AccountSwitchToken WHERE userId = ? ORDER BY lastUsedAt DESC LIMIT 18446744073709551615 OFFSET 9",
            params![uid(&c)],
        )
        .await?;
        if !old.is_empty() {
            let marks = vec!["?"; old.len()].join(", ");
            let p: Vec<db::Value> = old.iter().map(|i| db::Value::from(i.as_str())).collect();
            db::exec(&c.db, &format!("DELETE FROM AccountSwitchToken WHERE id IN ({marks})"), p).await?;
        }
        let ua = c.headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("");
        let ua: String = String::from_utf16_lossy(&ua.encode_utf16().take(300).collect::<Vec<u16>>());
        let now = db::now();
        db::exec(
            &c.db,
            "INSERT INTO AccountSwitchToken (id, userId, tokenHash, userAgent, createdAt, lastUsedAt, expiresAt) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![db::new_id(), uid(&c), s::sha256_hex(&token), ua, now, now, now + chrono::Duration::days(SWITCH_TTL_DAYS)],
        )
        .await?;
        Ok(Json(json!({ "token": token })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `POST /switch` — entra na conta salva (sai da sessão atual deste aparelho).
pub async fn switch(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        let raw = js_string(c.body.get("token"));
        if raw.encode_utf16().count() < 20 {
            return Ok(err(StatusCode::BAD_REQUEST, "Conta salva inválida."));
        }
        let row = db::first(
            &c.db,
            "SELECT id, userId, expiresAt FROM AccountSwitchToken WHERE tokenHash = ?",
            params![s::sha256_hex(&raw)],
        )
        .await?;
        let expired = |r: &db::Row| db::get::<chrono::NaiveDateTime>(r, "expiresAt").map(|e| e < db::now()).unwrap_or(true);
        let Some(row) = row.filter(|r| !expired(r)) else {
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                json!({ "error": "Essa conta saiu deste aparelho. Entre de novo com a senha.", "code": "SWITCH_EXPIRED" }),
            ));
        };
        let (token_id, user_id): (String, String) = (db::get(&row, "id")?, db::get(&row, "userId")?);
        let user = find_user_by_id(&c.db, &user_id).await?;
        let Some(user) = user.filter(|u| u.account_disabled_at.is_none() && !u.is_platform_banned) else {
            let _ = db::exec(&c.db, "DELETE FROM AccountSwitchToken WHERE id = ?", params![token_id.as_str()]).await;
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                json!({ "error": "Essa conta não está disponível.", "code": "SWITCH_EXPIRED" }),
            ));
        };
        // sai da sessão atual deste aparelho (se houver)
        if let Some(h) = s::current_refresh_hash(&c.headers) {
            s::revoke_hash(&c.db, &h, "LOGOUT").await?;
        }
        let now = db::now();
        db::exec(
            &c.db,
            "UPDATE AccountSwitchToken SET lastUsedAt = ?, expiresAt = ? WHERE id = ?",
            params![now, now + chrono::Duration::days(SWITCH_TTL_DAYS), token_id.as_str()],
        )
        .await?;
        let req = Req {
            user_agent: c.headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).map(String::from),
            ip: c.ip.clone(),
        };
        let res = complete_login(&state, &c.db, &req, &user).await?;
        Ok(res)
    }
    .await;
    finish(out, c.counted)
}

/// `POST /switch/forget` — tira uma conta salva deste aparelho.
pub async fn switch_forget(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, false, None);
    let out = async {
        let raw = js_string(c.body.get("token"));
        if !raw.is_empty() {
            db::exec(
                &c.db,
                "DELETE FROM AccountSwitchToken WHERE tokenHash = ?",
                params![s::sha256_hex(&raw)],
            )
            .await?;
        }
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aparelho_como_o_node() {
        let w = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
        assert_eq!(describe_device(Some(w)), "Chrome no Windows");
        let edge =
            "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0";
        assert_eq!(describe_device(Some(edge)), "Edge no Windows");
        let iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
        assert_eq!(describe_device(Some(iphone)), "Safari no iPhone");
        let app = "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
        assert_eq!(describe_device(Some(app)), "App no Android");
        let desk = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 ProjectClub/1.42.0 Chrome/130 Electron/33.0 Safari/537.36";
        assert_eq!(describe_device(Some(desk)), "App desktop no Windows");
        assert_eq!(describe_device(Some("curl/8.0")), "Navegador");
        assert_eq!(describe_device(None), "Dispositivo desconhecido");
    }

    #[test]
    fn ip_mascarado() {
        assert_eq!(
            mask_ip(Some("200.150.10.5")).as_deref(),
            Some("200.150.x.x")
        );
        assert_eq!(
            mask_ip(Some("::ffff:127.0.0.1")).as_deref(),
            Some("127.0.x.x")
        );
        assert_eq!(
            mask_ip(Some("2804:14c:5bb2:8000::1")).as_deref(),
            Some("2804:14c:…")
        );
        assert_eq!(mask_ip(Some("lixo")), None);
        assert_eq!(mask_ip(None), None);
    }
}
