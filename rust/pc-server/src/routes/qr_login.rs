//! "Entrar com o celular" (login por QR Code) e a entrada do app nativo no
//! WebView — porte de `qrLoginController.js`, `services/qrLogin.js` e
//! `appHandoffController.js`.
//!
//! Pareamento (tabela `QrLoginPairing`):
//! `PENDING → SCANNED → APPROVED → CONSUMED` (ou `DENIED`), 2 minutos.
//! O `code` vai no QR e só deixa VER e APROVAR/RECUSAR (logado); o `secret`
//! fica só no PC e é o único que troca o pareamento aprovado por sessão.
//! Cada passo é um `UPDATE ... WHERE status = <anterior>`: só um pedido ganha.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use chrono::NaiveDateTime;
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::error;
use crate::db::{self, Db};
use crate::params;
use crate::qr;
use crate::ratelimit;
use crate::routes::ctx::{By, Ctx, err, finish, prelude_or_return, redirect, security_log, uid};
use crate::routes::devices::{describe_device, mask_ip};
use crate::routes::login::{LoginUser, Req, complete_login_parts, find_user_by_id};
use crate::session::{self as s};

const TTL_MS: i64 = 2 * 60 * 1000;
const ROTATION_GRACE_MS: i64 = 60 * 1000;

/// Erro do QR: `{ error, code }` com o status certo.
struct QrError(StatusCode, &'static str, &'static str);

impl QrError {
    fn response(&self) -> Response {
        error(self.0, json!({ "error": self.2, "code": self.1 }))
    }
}

const INVALID: QrError = QrError(
    StatusCode::NOT_FOUND,
    "invalid",
    "Código inválido ou expirado. Gere um novo QR no computador.",
);
const EXPIRED: QrError = QrError(
    StatusCode::GONE,
    "expired",
    "Este QR Code expirou. Gere um novo no computador.",
);
const TAKEN: QrError = QrError(
    StatusCode::CONFLICT,
    "taken",
    "Este QR Code já está sendo usado por outra conta.",
);
const USED: QrError = QrError(StatusCode::CONFLICT, "used", "Este QR Code já foi usado.");
const NOT_SCANNED: QrError = QrError(
    StatusCode::CONFLICT,
    "not_scanned",
    "Abra o link do QR Code de novo antes de aprovar.",
);
const DENIED: QrError = QrError(
    StatusCode::FORBIDDEN,
    "denied",
    "O acesso foi recusado no celular.",
);
const NOT_APPROVED: QrError = QrError(
    StatusCode::CONFLICT,
    "not_approved",
    "O acesso ainda não foi aprovado no celular.",
);
const DEVICE: QrError = QrError(
    StatusCode::FORBIDDEN,
    "device",
    "Este pedido foi criado em outro navegador. Gere um novo QR aqui.",
);

fn random_token(bytes: usize) -> String {
    let mut raw = vec![0u8; bytes];
    rand::RngCore::fill_bytes(&mut rand::rng(), &mut raw);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
}

/// 32 bytes em base64url = 43 caracteres `[A-Za-z0-9_-]`.
fn is_token(v: &str) -> bool {
    v.len() == 43
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `typeof req.body[key] === 'string' ? trim : ''`.
fn body_token(body: &Value, key: &str) -> String {
    body.get(key)
        .and_then(Value::as_str)
        .map(|s| s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}'))
        .unwrap_or("")
        .to_string()
}

/// `.slice(0, n)` do JavaScript (conta em UTF-16).
fn js_slice(v: &str, n: usize) -> String {
    String::from_utf16_lossy(&v.encode_utf16().take(n).collect::<Vec<u16>>())
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

fn no_store(mut res: Response) -> Response {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

struct Pairing {
    id: String,
    code_hash: String,
    status: String,
    requester_ip: Option<String>,
    requester_ua: Option<String>,
    scanned_by_id: Option<String>,
    user_id: Option<String>,
    expires_at: NaiveDateTime,
    created_at: NaiveDateTime,
}

async fn pairing_by(db: &Db, col: &str, raw: &str) -> db::DbResult<Option<Pairing>> {
    if !is_token(raw) {
        return Ok(None);
    }
    let sql = format!(
        "SELECT id, codeHash, status, requesterIp, requesterUa, scannedById, userId, expiresAt, createdAt \
         FROM QrLoginPairing WHERE {col} = ?"
    );
    let row = db::first(db, &sql, params![s::sha256_hex(raw)]).await?;
    row.map(|r| {
        Ok(Pairing {
            id: db::get(&r, "id")?,
            code_hash: db::get(&r, "codeHash")?,
            status: db::get(&r, "status")?,
            requester_ip: db::get(&r, "requesterIp")?,
            requester_ua: db::get(&r, "requesterUa")?,
            scanned_by_id: db::get(&r, "scannedById")?,
            user_id: db::get(&r, "userId")?,
            expires_at: db::get(&r, "expiresAt")?,
            created_at: db::get(&r, "createdAt")?,
        })
    })
    .transpose()
}

fn expired(p: &Pairing) -> bool {
    p.expires_at <= db::now()
}

/// Estado que o PC vê: vencido vira `EXPIRED` mesmo se a linha diz outra coisa.
fn public_status(p: &Pairing) -> &str {
    match p.status.as_str() {
        "CONSUMED" | "DENIED" => &p.status,
        _ if expired(p) => "EXPIRED",
        _ => &p.status,
    }
}

/// Erro "de propósito" (vira `{ error, code }`) ou falha de verdade (500).
enum Fail {
    Qr(QrError),
    Other(anyhow::Error),
}

impl<E: Into<anyhow::Error>> From<E> for Fail {
    fn from(e: E) -> Self {
        Fail::Other(e.into())
    }
}

type QrResult<T> = Result<T, Fail>;

fn done(out: QrResult<Response>, c: Ctx) -> Response {
    let out = match out {
        Ok(r) => Ok(r),
        Err(Fail::Qr(e)) => Ok(e.response()),
        Err(Fail::Other(e)) => Err(e),
    };
    finish(out, c.counted)
}

// ---------------------------------------------------------------- PC (sem login)

/// `POST /qr/start` — cria o pareamento e devolve o QR (o link não vai solto).
pub async fn start(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        false,
        Some((&ratelimit::QR_START, By::Ip))
    );
    let out: QrResult<Response> = async {
        let code = random_token(32);
        let secret = random_token(32);
        let now = db::now();
        let expires_at = now + chrono::Duration::milliseconds(TTL_MS);
        db::exec(
            &c.db,
            "INSERT INTO QrLoginPairing (id, codeHash, secretHash, status, requesterIp, requesterUa, expiresAt, createdAt) \
             VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)",
            params![
                db::new_id(),
                s::sha256_hex(&code),
                s::sha256_hex(&secret),
                c.ip.as_deref().filter(|i| !i.is_empty()).map(|i| js_slice(i, 64)),
                user_agent(&c.headers).filter(|u| !u.is_empty()).map(|u| js_slice(&u, 400)),
                expires_at,
                now
            ],
        )
        .await?;
        let origin = state.config.client_origin.trim_end_matches('/');
        let link = format!(
            "{origin}/entrar-qr?c={}",
            crate::totp::encode_uri_component(&code)
        );
        let qr_data_url = qr::data_url_with(&link, 1, Some(260))?;
        Ok(no_store(
            Json(json!({
                "secret": secret,
                "qrDataUrl": qr_data_url,
                "expiresAt": db::iso(expires_at),
                "ttlSeconds": TTL_MS / 1000,
            }))
            .into_response(),
        ))
    }
    .await;
    done(out, c)
}

/// `POST /qr/poll { secret }` — o PC consulta o estado.
pub async fn poll(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        false,
        Some((&ratelimit::QR_POLL, By::Ip))
    );
    let out: QrResult<Response> = async {
        let secret = body_token(&c.body, "secret");
        let Some(p) = pairing_by(&c.db, "secretHash", &secret).await? else {
            return Err(Fail::Qr(INVALID));
        };
        Ok(no_store(
            Json(json!({ "status": public_status(&p), "expiresAt": db::iso(p.expires_at) }))
                .into_response(),
        ))
    }
    .await;
    done(out, c)
}

pub(crate) fn is_account_blocked(u: &LoginUser) -> bool {
    u.is_platform_banned
        || u.account_disabled_at.is_some()
        || u.suspended_until.is_some_and(|s| s > db::now())
}

fn req_of(c: &Ctx) -> Req {
    Req {
        user_agent: user_agent(&c.headers),
        ip: c.ip.clone(),
    }
}

/// `POST /qr/exchange { secret }` — troca o pareamento aprovado por sessão.
pub async fn exchange(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        false,
        Some((&ratelimit::QR_EXCHANGE, By::Ip))
    );
    let out: QrResult<Response> = async {
        let secret = body_token(&c.body, "secret");
        let Some(p) = pairing_by(&c.db, "secretHash", &secret).await? else {
            return Err(Fail::Qr(INVALID));
        };
        match p.status.as_str() {
            "CONSUMED" => return Err(Fail::Qr(USED)),
            "DENIED" => return Err(Fail::Qr(DENIED)),
            _ if expired(&p) => return Err(Fail::Qr(EXPIRED)),
            "APPROVED" if p.user_id.is_some() => {}
            _ => return Err(Fail::Qr(NOT_APPROVED)),
        }
        // o MESMO navegador que pediu
        let ua = user_agent(&c.headers)
            .filter(|u| !u.is_empty())
            .map(|u| js_slice(&u, 400));
        if p.requester_ua != ua {
            return Err(Fail::Qr(DEVICE));
        }
        let won = db::exec(
            &c.db,
            "UPDATE QrLoginPairing SET status = 'CONSUMED', consumedAt = ? WHERE id = ? AND status = 'APPROVED'",
            params![db::now(), p.id.as_str()],
        )
        .await?;
        if won != 1 {
            return Err(Fail::Qr(USED));
        }
        let user_id = p.user_id.unwrap_or_default();
        let user = find_user_by_id(&c.db, &user_id).await?;
        let Some(user) = user.filter(|u| !is_account_blocked(u)) else {
            return Ok(error(
                StatusCode::FORBIDDEN,
                json!({ "error": "Esta conta não pode entrar agora (banida, suspensa ou desativada).", "code": "blocked" }),
            ));
        };
        let (mut body, cookies) = complete_login_parts(&state, &c.db, &req_of(&c), &user).await?;
        body["via"] = json!("qr");
        let mut res = no_store(Json(body).into_response());
        for k in cookies {
            res.headers_mut().append(header::SET_COOKIE, k);
        }
        Ok(res)
    }
    .await;
    done(out, c)
}

// ---------------------------------------------------------------- celular (logado)

/// A sessão deste pedido (cookie de refresh) está viva e é desta conta?
/// Acabou de renovar (o cookie novo ainda a caminho): vale por 1 minuto.
async fn live_session(db: &Db, headers: &HeaderMap, user_id: &str) -> db::DbResult<bool> {
    let Some(hash) = s::current_refresh_hash(headers) else {
        return Ok(false);
    };
    let Some(row) = s::refresh_by_hash(db, &hash).await? else {
        return Ok(false);
    };
    let now = db::now();
    if row.user_id != user_id || row.expires_at <= now {
        return Ok(false);
    }
    Ok(!row.revoked
        || (row.revoked_reason.as_deref() == Some("ROTATED")
            && row
                .revoked_at
                .is_some_and(|at| (now - at).num_milliseconds() < ROTATION_GRACE_MS)))
}

struct Approver {
    email_verified: bool,
    username: String,
    display_name: String,
}

async fn approver(db: &Db, id: &str) -> db::DbResult<Option<Approver>> {
    let row = db::first(
        db,
        "SELECT emailVerified, username, displayName FROM `User` WHERE id = ?",
        params![id],
    )
    .await?;
    row.map(|r| {
        Ok(Approver {
            email_verified: db::get(&r, "emailVerified")?,
            username: db::get(&r, "username")?,
            display_name: db::get(&r, "displayName")?,
        })
    })
    .transpose()
}

/// `requireLiveSession`: e-mail confirmado + sessão viva desta conta (um
/// token de acesso roubado, de 15 min, não vira sessão de 90 dias).
async fn require_live(c: &Ctx) -> QrResult<Result<Approver, Response>> {
    let Some(me) = approver(&c.db, uid(c)).await? else {
        return Ok(Err(err(
            StatusCode::UNAUTHORIZED,
            "Usuário não encontrado.",
        )));
    };
    if !me.email_verified {
        return Ok(Err(error(
            StatusCode::FORBIDDEN,
            json!({ "error": "Confirme seu e-mail antes de aprovar acessos pelo celular.", "code": "unverified" }),
        )));
    }
    if !live_session(&c.db, &c.headers, uid(c)).await? {
        return Ok(Err(error(
            StatusCode::FORBIDDEN,
            json!({ "error": "Sua sessão neste aparelho expirou. Entre de novo na sua conta e leia o QR Code outra vez.", "code": "session" }),
        )));
    }
    Ok(Ok(me))
}

/// O que vale pra ler, aprovar e recusar.
fn check_open(p: &Pairing) -> QrResult<()> {
    match p.status.as_str() {
        "CONSUMED" | "APPROVED" => Err(Fail::Qr(USED)),
        "DENIED" => Err(Fail::Qr(DENIED)),
        _ if expired(p) => Err(Fail::Qr(EXPIRED)),
        _ => Ok(()),
    }
}

/// `POST /qr/scan { code }` — o celular abre o link e vê quem está pedindo.
/// O primeiro a abrir trava o pareamento pra si.
pub async fn scan(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        true,
        Some((&ratelimit::QR_PHONE, By::User))
    );
    let out: QrResult<Response> = async {
        let me = match require_live(&c).await? {
            Ok(me) => me,
            Err(r) => return Ok(r),
        };
        let code = body_token(&c.body, "code");
        let Some(p) = pairing_by(&c.db, "codeHash", &code).await? else {
            return Err(Fail::Qr(INVALID));
        };
        check_open(&p)?;
        if p.status == "SCANNED" {
            if p.scanned_by_id.as_deref() != Some(uid(&c)) {
                return Err(Fail::Qr(TAKEN));
            }
        } else {
            let won = db::exec(
                &c.db,
                "UPDATE QrLoginPairing SET status = 'SCANNED', scannedById = ?, scannedAt = ? WHERE id = ? AND status = 'PENDING'",
                params![uid(&c), db::now(), p.id.as_str()],
            )
            .await?;
            if won != 1 {
                // outro pedido ganhou a corrida: relê
                let again: Option<(String, Option<String>)> = db::first(
                    &c.db,
                    "SELECT status, scannedById FROM QrLoginPairing WHERE codeHash = ?",
                    params![p.code_hash.as_str()],
                )
                .await?
                .map(|r| Ok::<_, db::DbError>((db::get(&r, "status")?, db::get(&r, "scannedById")?)))
                .transpose()?;
                let mine = matches!(&again, Some((st, by)) if st == "SCANNED" && by.as_deref() == Some(uid(&c)));
                if !mine {
                    return Err(Fail::Qr(TAKEN));
                }
            }
        }
        Ok(no_store(
            Json(json!({
                "device": describe_device(p.requester_ua.as_deref()),
                "network": mask_ip(p.requester_ip.as_deref()),
                "requestedAt": db::iso(p.created_at),
                "expiresAt": db::iso(p.expires_at),
                "account": { "username": me.username, "displayName": me.display_name },
            }))
            .into_response(),
        ))
    }
    .await;
    done(out, c)
}

async fn decide(state: AppState, parts: Parts, body: Bytes, approve: bool) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        true,
        Some((&ratelimit::QR_PHONE, By::User))
    );
    let out: QrResult<Response> = async {
        if let Err(r) = require_live(&c).await? {
            return Ok(r);
        }
        let code = body_token(&c.body, "code");
        let Some(p) = pairing_by(&c.db, "codeHash", &code).await? else {
            return Err(Fail::Qr(INVALID));
        };
        check_open(&p)?;
        if p.status != "SCANNED" {
            return Err(Fail::Qr(NOT_SCANNED));
        }
        if p.scanned_by_id.as_deref() != Some(uid(&c)) {
            return Err(Fail::Qr(TAKEN));
        }
        let won = if approve {
            db::exec(
                &c.db,
                "UPDATE QrLoginPairing SET status = 'APPROVED', userId = ?, approvedAt = ? \
                 WHERE id = ? AND status = 'SCANNED' AND scannedById = ?",
                params![uid(&c), db::now(), p.id.as_str(), uid(&c)],
            )
            .await?
        } else {
            db::exec(
                &c.db,
                "UPDATE QrLoginPairing SET status = 'DENIED' WHERE id = ? AND status = 'SCANNED' AND scannedById = ?",
                params![p.id.as_str(), uid(&c)],
            )
            .await?
        };
        if won != 1 {
            return Err(Fail::Qr(USED));
        }
        let action = if approve { "QR_LOGIN_APPROVED" } else { "QR_LOGIN_DENIED" };
        security_log(&c.db, uid(&c), action, &c.headers, c.ip.as_deref()).await;
        let status = if approve { "APPROVED" } else { "DENIED" };
        Ok(Json(json!({ "ok": true, "status": status })).into_response())
    }
    .await;
    done(out, c)
}

/// `POST /qr/approve { code }`.
pub async fn approve(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    decide(state, parts, body, true).await
}

/// `POST /qr/deny { code }`.
pub async fn deny(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    decide(state, parts, body, false).await
}

// ---------------------------------------------------------------- app nativo → WebView

/// Códigos de uso único (hash → conta, validade), na memória como no Node.
static HANDOFF: LazyLock<Mutex<HashMap<String, (String, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const HANDOFF_TTL: Duration = Duration::from_secs(120);

fn sweep(map: &mut HashMap<String, (String, Instant)>) {
    let now = Instant::now();
    map.retain(|_, (_, until)| *until > now);
}

/// `POST /app-handoff` — o app (logado, com sessão viva) pede um código de
/// 2 minutos pro WebView entrar sozinho.
pub async fn handoff_create(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        true,
        Some((&ratelimit::QR_PHONE, By::User))
    );
    let out = async {
        if !live_session(&c.db, &c.headers, uid(&c)).await? {
            return Ok(err(
                StatusCode::FORBIDDEN,
                "Entre de novo no app para abrir o jogo.",
            ));
        }
        let code = random_token(24);
        {
            let mut map = HANDOFF.lock().unwrap_or_else(|e| e.into_inner());
            sweep(&mut map);
            map.insert(
                s::sha256_hex(&code),
                (uid(&c).to_string(), Instant::now() + HANDOFF_TTL),
            );
        }
        Ok(no_store(
            Json(json!({ "code": code, "expiresIn": HANDOFF_TTL.as_secs() })).into_response(),
        ))
    }
    .await;
    finish(out, c.counted)
}

fn text(status: StatusCode, msg: &str) -> Response {
    let mut r = (status, msg.to_string()).into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    r
}

/// `safePath`: só caminho do próprio site (nada de `//outro-site`).
fn safe_path(query: Option<&str>) -> String {
    let to: Vec<String> = query
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .filter(|(k, _)| k == "to")
                .map(|(_, v)| v.into_owned())
                .collect()
        })
        .unwrap_or_default();
    match to.as_slice() {
        [p] if p.starts_with('/') && !p.starts_with("//") => p.clone(),
        _ => "/praca/app".into(),
    }
}

/// `GET /app-handoff/{code}?to=/praca/app` — cria uma sessão NOVA (cookie)
/// pro WebView e redireciona.
pub async fn handoff_consume(
    State(state): State<AppState>,
    Path(code): Path<String>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(
        state,
        parts,
        body,
        false,
        Some((&ratelimit::QR_EXCHANGE, By::Ip))
    );
    let out = async {
        let entry = {
            let mut map = HANDOFF.lock().unwrap_or_else(|e| e.into_inner());
            sweep(&mut map);
            map.remove(&s::sha256_hex(&code))
        };
        let Some((user_id, _)) = entry else {
            return Ok(text(
                StatusCode::GONE,
                "Este link de entrada expirou. Abra o jogo de novo pelo app.",
            ));
        };
        let user = find_user_by_id(&c.db, &user_id).await?;
        let Some(user) = user.filter(|u| !is_account_blocked(u)) else {
            return Ok(text(
                StatusCode::FORBIDDEN,
                "Esta conta não pode entrar agora.",
            ));
        };
        let (_, cookies) = complete_login_parts(&state, &c.db, &req_of(&c), &user).await?;
        let mut res = redirect(&c.headers, StatusCode::FOUND, &safe_path(query.as_deref()));
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        for k in cookies {
            res.headers_mut().append(header::SET_COOKIE, k);
        }
        Ok(res)
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caminho_seguro() {
        assert_eq!(safe_path(None), "/praca/app");
        assert_eq!(
            safe_path(Some("to=%2Fpraca%2Fapp%3Fx%3D1")),
            "/praca/app?x=1"
        );
        assert_eq!(safe_path(Some("to=//mal.com")), "/praca/app");
        assert_eq!(safe_path(Some("to=https://mal.com")), "/praca/app");
        assert_eq!(safe_path(Some("to=/a&to=/b")), "/praca/app");
    }

    #[test]
    fn token() {
        assert!(is_token(&random_token(32)));
        assert!(!is_token("curto"));
        assert_eq!(random_token(24).len(), 32);
    }
}
