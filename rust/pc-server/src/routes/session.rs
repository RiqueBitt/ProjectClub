//! `POST /api/auth/refresh` e `POST /api/auth/logout` — porte de `refresh` e
//! `logout` (`server/src/controllers/authController.js`), caso a caso.

use std::net::SocketAddr;
use std::time::Duration;

use axum::Json;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::{error, mask_invisible};
use crate::db::{self, Db, DbResult};
use crate::session::{self as s, reason};
use crate::users;

/// Janela de corrida de renovação (duas abas renovando juntas).
const REFRESH_RACE_GRACE: Duration = Duration::from_secs(30);

struct Out {
    status: StatusCode,
    body: Value,
    cookies: Vec<HeaderValue>,
}

impl Out {
    fn json(body: Value) -> Self {
        Self {
            status: StatusCode::OK,
            body,
            cookies: Vec::new(),
        }
    }
    fn expired() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            body: json!({ "error": "Sessão expirada." }),
            cookies: Vec::new(),
        }
    }
    fn clearing(mut self, names: &[&str]) -> Self {
        // o Node limpa o refresh antes do "lembrar login" em alguns casos e
        // o contrário em outros: a ordem é a de `names`
        self.cookies
            .extend(names.iter().map(|n| s::clear_cookie(n)));
        self
    }
}

impl IntoResponse for Out {
    fn into_response(self) -> Response {
        let mut r = (self.status, Json(self.body)).into_response();
        for c in self.cookies {
            r.headers_mut().append(header::SET_COOKIE, c);
        }
        r
    }
}

fn server_error() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        json!({ "error": "Erro interno do servidor." }),
    )
}

/// `{ user: SELF_USER_FIELDS, accessToken }` — sem `req.user`, o Node
/// mascara o invisível até da própria pessoa nesta resposta.
async fn session_body(db: &Db, user_id: &str, access_token: &str) -> DbResult<Value> {
    let row = db::first(db, &users::self_select_sql(), crate::params![user_id]).await?;
    let user = match row {
        Some(r) => Value::Object(users::self_user(&r)?),
        None => Value::Null,
    };
    let mut body = json!({ "user": user, "accessToken": access_token });
    mask_invisible(&mut body, None);
    Ok(body)
}

struct Req {
    headers: HeaderMap,
    user_agent: Option<String>,
    ip: Option<String>,
}

pub async fn refresh(State(state): State<AppState>, parts: axum::http::request::Parts) -> Response {
    let Some(db) = state.db.clone() else {
        return server_error();
    };
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let headers = parts.headers;
    let req = Req {
        user_agent: headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(String::from),
        ip: s::client_ip(&headers, peer),
        headers,
    };
    match refresh_inner(&state, &db, &req).await {
        Ok(out) => out.into_response(),
        Err(e) => {
            tracing::error!("[auth] refresh: {e}");
            server_error()
        }
    }
}

/// `restoreFromKeep`: sem refresh válido, tenta o cookie "lembrar login".
async fn restore_from_keep(state: &AppState, db: &Db, req: &Req) -> DbResult<Option<Out>> {
    let Some((uid, rid)) = s::read_keep(state, &req.headers).await else {
        return Ok(None);
    };
    if !s::keep_session_alive(db, rid.as_deref()).await? {
        // aparelho encerrado em "Sair deste dispositivo": apaga o cookie e dá o 401 normal
        return Ok(Some(Out::expired().clearing(&[s::KEEP_COOKIE])));
    }
    let user = s::account(db, &uid).await?;
    if s::is_blocked(user.as_ref()) {
        return Ok(None);
    }
    let user = user.expect("conta existe");
    s::maybe_promote_to_platform_admin(state, db, &user).await;
    let issued = s::issue(
        state,
        db,
        &user.id,
        req.user_agent.as_deref(),
        req.ip.as_deref(),
        None,
    )
    .await?;
    let mut out = Out::json(session_body(db, &user.id, &issued.access_token).await?);
    out.cookies = issued.cookies;
    Ok(Some(out))
}

async fn refresh_inner(state: &AppState, db: &Db, req: &Req) -> DbResult<Out> {
    let Some(raw) = s::read_cookie(&req.headers, s::REFRESH_COOKIE) else {
        return Ok(restore_from_keep(state, db, req)
            .await?
            .unwrap_or_else(Out::expired));
    };
    let hash = s::sha256_hex(&raw);
    let mut stored = s::refresh_by_hash(db, &hash).await?;
    let now = db::now();

    if let Some(st) = stored.clone().filter(|t| !t.revoked && t.expires_at >= now) {
        let user = s::account(db, &st.user_id).await?;
        if s::is_blocked(user.as_ref()) {
            s::revoke_ids(db, std::slice::from_ref(&st.id), reason::ADMIN).await?;
            return Ok(Out::expired().clearing(&[s::REFRESH_COOKIE, s::KEEP_COOKIE]));
        }
        let user = user.expect("conta existe");
        // rotação: só UMA requisição reivindica este token
        if s::claim(db, &st.id, reason::ROTATED, true).await? {
            s::maybe_promote_to_platform_admin(state, db, &user).await;
            let started = st.session_started_at.unwrap_or(st.created_at);
            let issued = s::issue(
                state,
                db,
                &user.id,
                req.user_agent.as_deref(),
                req.ip.as_deref(),
                Some(started),
            )
            .await?;
            s::set_replaced_by(db, &st.id, &issued.refresh_id).await;
            let mut out = Out::json(session_body(db, &user.id, &issued.access_token).await?);
            out.cookies = issued.cookies;
            return Ok(out);
        }
        // perdeu a corrida: relê (agora rotacionado)
        stored = s::refresh_by_hash(db, &hash).await?;
        if stored.as_ref().is_some_and(|t| {
            t.revoked
                && t.revoked_reason.as_deref() == Some(reason::ROTATED)
                && t.replaced_by_id.is_none()
        }) {
            tokio::time::sleep(Duration::from_millis(300)).await;
            stored = s::refresh_by_hash(db, &hash).await?;
        }
    }

    if let Some(st) = stored.filter(|t| t.revoked) {
        // revogação explícita (sair, encerrar sessão, senha, ban…): só esta sessão acabou
        if st.revoked_reason.as_deref() != Some(reason::ROTATED) {
            return Ok(Out::expired().clearing(&[s::REFRESH_COOKIE, s::KEEP_COOKIE]));
        }

        let same_device =
            st.user_agent == req.user_agent && st.ip_address.is_some() && st.ip_address == req.ip;
        let within_race = same_device
            || st.revoked_at.is_some_and(|at| {
                (db::now() - at)
                    .to_std()
                    .map(|d| d < REFRESH_RACE_GRACE)
                    .unwrap_or(true)
            });
        if within_race && let Some(next) = st.replaced_by_id.as_deref() {
            let c = s::chain(db, next).await?;
            let head_ok = c
                .last()
                .is_some_and(|h| !h.revoked && h.expires_at > db::now());
            if head_ok {
                let user = s::account(db, &st.user_id).await?;
                if let Some(user) = user.filter(|u| !s::is_blocked(Some(u))) {
                    let access = state.tokens.sign(&user.id, state.config.access_token_ttl);
                    return Ok(Out::json(session_body(db, &user.id, &access).await?));
                }
            }
        }

        // aparelho que perdeu o cookie novo (o substituto nunca foi usado)
        if let Some(next) = st.replaced_by_id.as_deref()
            && st.user_agent == req.user_agent
            && let Some(replacement) = s::refresh_by_id(db, next).await?
            && !replacement.revoked
            && replacement.expires_at > db::now()
        {
            let user = s::account(db, &st.user_id).await?;
            if let Some(user) = user.filter(|u| !s::is_blocked(Some(u)))
                && s::claim(db, &replacement.id, reason::ABANDONED, false).await?
            {
                s::maybe_promote_to_platform_admin(state, db, &user).await;
                let started = replacement
                    .session_started_at
                    .or(st.session_started_at)
                    .unwrap_or(st.created_at);
                let issued = s::issue(
                    state,
                    db,
                    &user.id,
                    req.user_agent.as_deref(),
                    req.ip.as_deref(),
                    Some(started),
                )
                .await?;
                s::set_replaced_by(db, &st.id, &issued.refresh_id).await;
                tracing::warn!(
                    "[auth] sessão recuperada: o aparelho voltou com o cookie anterior (usuário {}).",
                    st.user_id
                );
                let mut out = Out::json(session_body(db, &user.id, &issued.access_token).await?);
                out.cookies = issued.cookies;
                return Ok(out);
            }
        }

        // reuso de token rotacionado fora da janela = possível roubo: encerra só esta sessão
        let c = s::chain(db, &st.id).await?;
        let ids: Vec<String> = c.into_iter().map(|t| t.id).collect();
        s::revoke_ids(db, &ids, reason::THEFT).await?;
        tracing::warn!(
            "[auth] reuso de refresh token rotacionado detectado (usuário {}) — só essa sessão ({} token(s)) foi encerrada.",
            st.user_id,
            ids.len()
        );
        return Ok(Out::expired().clearing(&[s::KEEP_COOKIE, s::REFRESH_COOKIE]));
    }

    Ok(restore_from_keep(state, db, req)
        .await?
        .unwrap_or_else(Out::expired))
}

/// `POST /api/auth/logout`.
pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(db) = state.db.as_ref() else {
        return server_error();
    };
    if let Some(raw) = s::read_cookie(&headers, s::REFRESH_COOKIE)
        && let Err(e) = s::revoke_hash(db, &s::sha256_hex(&raw), reason::LOGOUT).await
    {
        tracing::error!("[auth] logout: {e}");
        return server_error();
    }
    Out::json(json!({ "ok": true }))
        .clearing(&[s::REFRESH_COOKIE, s::KEEP_COOKIE])
        .into_response()
}
