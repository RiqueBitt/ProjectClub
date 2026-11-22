//! Chaves de acesso (passkeys): entrar com a digital, o rosto ou o PIN do
//! aparelho — porte de `passkeyController.js`. O desafio fica no Redis por
//! 5 minutos, nas mesmas chaves do Node (`passkey:reg:<conta>` e
//! `passkey:auth:<flowId>`), então um começa no Node e termina no Rust.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use crate::AppState;
use crate::db::{self, Db};
use crate::params;
use crate::ratelimit;
use crate::routes::ctx::{By, err, finish, js_string, prelude_or_return, security_log, uid};
use crate::routes::login::{Req, blocked_response, complete_login, find_user_by_id};
use crate::webauthn::{self as wa, Expected};

const CHALLENGE_TTL: u64 = 300;
const MAX_KEYS: usize = 10;

struct Rp {
    id: String,
    origin: String,
}

/// Origem pública do site (`CLIENT_ORIGIN`, a primeira se tiver várias).
fn rp(state: &AppState, headers: &HeaderMap) -> anyhow::Result<Rp> {
    let first = state
        .config
        .client_origin
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let origin = if first.is_empty() {
        let proto = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .map(str::trim)
            .unwrap_or("http");
        let host = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        format!("{proto}://{host}")
    } else {
        first
    };
    let id = url::Url::parse(&origin)?
        .host_str()
        .unwrap_or_default()
        .to_string();
    Ok(Rp { id, origin })
}

fn device_name(ua: &str) -> &'static str {
    let ua = ua.to_lowercase();
    if ua.contains("electron") {
        "App do PC"
    } else if ua.contains("android") {
        "Android"
    } else if ua.contains("iphone") || ua.contains("ipad") {
        "iPhone/iPad"
    } else if ua.contains("windows") {
        "Windows"
    } else if ua.contains("mac os") {
        "Mac"
    } else if ua.contains("linux") {
        "Linux"
    } else {
        "Chave de acesso"
    }
}

fn random_b64u(n: usize) -> String {
    let mut raw = vec![0u8; n];
    rand::RngCore::fill_bytes(&mut rand::rng(), &mut raw);
    wa::b64u(&raw)
}

fn key_json(r: &db::Row) -> db::DbResult<Value> {
    let last: Option<chrono::NaiveDateTime> = db::get(r, "lastUsedAt")?;
    Ok(json!({
        "id": db::get::<String>(r, "id")?,
        "name": db::get::<String>(r, "name")?,
        "createdAt": db::iso(db::get(r, "createdAt")?),
        "lastUsedAt": last.map(db::iso),
    }))
}

fn redis_down() -> anyhow::Error {
    anyhow::anyhow!("redis indisponível")
}

/// `GET /passkeys` — as chaves da conta.
pub async fn list(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let rows = db::all(
            &c.db,
            "SELECT id, name, createdAt, lastUsedAt FROM Passkey WHERE userId = ? ORDER BY createdAt DESC",
            params![uid(&c)],
        )
        .await?;
        let keys = rows.iter().map(key_json).collect::<Result<Vec<_>, _>>()?;
        Ok(Json(json!({ "passkeys": keys })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `POST /passkeys/register/options` — o que o navegador precisa pra criar a chave.
pub async fn register_options(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        let existing = db::all(
            &c.db,
            "SELECT credentialId, transports FROM Passkey WHERE userId = ?",
            params![uid(&c)],
        )
        .await?;
        if existing.len() >= MAX_KEYS {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Você já tem {MAX_KEYS} chaves de acesso. Apague uma antes de criar outra."
                ),
            ));
        }
        let me = db::first(
            &c.db,
            "SELECT username, email, displayName FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("conta sumiu"))?;
        let username: String = db::get(&me, "username")?;
        let email: String = db::get(&me, "email")?;
        let display: String = db::get(&me, "displayName")?;
        let rp = rp(&state, &c.headers)?;
        let mut exclude = Vec::new();
        for k in &existing {
            let id: String = db::get(k, "credentialId")?;
            let transports: Option<String> = db::get(k, "transports")?;
            let mut item = json!({ "id": id.trim_end_matches('=') });
            if let Some(t) = transports.filter(|t| !t.is_empty()) {
                item["transports"] = json!(t.split(',').collect::<Vec<_>>());
            }
            item["type"] = json!("public-key");
            exclude.push(item);
        }
        let challenge = random_b64u(32);
        let options = json!({
            "challenge": challenge,
            "rp": { "name": "Project Club", "id": rp.id },
            "user": {
                "id": wa::b64u(uid(&c).as_bytes()),
                "name": if username.is_empty() { email } else { username.clone() },
                "displayName": if display.is_empty() { username } else { display },
            },
            "pubKeyCredParams": wa::REQUESTED_ALGS
                .iter()
                .map(|a| json!({ "alg": a, "type": "public-key" }))
                .collect::<Vec<_>>(),
            "timeout": 60000,
            "attestation": "none",
            "excludeCredentials": exclude,
            "authenticatorSelection": {
                "residentKey": "required",
                "userVerification": "preferred",
                "requireResidentKey": true,
            },
            "extensions": { "credProps": true },
            "hints": [],
        });
        state
            .cache
            .set_strict(
                &format!("passkey:reg:{}", uid(&c)),
                &challenge,
                CHALLENGE_TTL,
            )
            .await
            .ok_or_else(redis_down)?;
        Ok(Json(options).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `POST /passkeys/register/verify { response, name? }` — guarda a chave nova.
pub async fn register_verify(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        let key = format!("passkey:reg:{}", uid(&c));
        let Some(challenge) = state.cache.get_raw(&key).await.ok_or_else(redis_down)? else {
            return Ok(err(StatusCode::BAD_REQUEST, "O pedido expirou. Tente de novo."));
        };
        state.cache.del(&key).await.ok_or_else(redis_down)?;
        let rp = rp(&state, &c.headers)?;
        let exp = Expected {
            challenge: &challenge,
            origin: &rp.origin,
            rp_id: &rp.id,
        };
        let response = c.body.get("response").cloned().unwrap_or(Value::Null);
        let reg = match wa::verify_registration(&response, &exp) {
            Ok(r) => r,
            Err(why) => {
                tracing::info!("[passkey] cadastro recusado: {why}");
                return Ok(err(
                    StatusCode::BAD_REQUEST,
                    "Não deu pra confirmar a chave de acesso.",
                ));
            }
        };
        let ua = c
            .headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let typed = js_string(c.body.get("name"));
        let typed = typed.trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{feff}');
        let typed = String::from_utf16_lossy(&typed.encode_utf16().take(60).collect::<Vec<u16>>());
        let name = if typed.is_empty() {
            device_name(ua).to_string()
        } else {
            typed
        };
        let id = db::new_id();
        let now = db::now();
        let transports = reg.transports.join(",");
        let created = db::exec(
            &c.db,
            "INSERT INTO Passkey (id, userId, credentialId, publicKey, counter, transports, name, createdAt) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id.as_str(),
                uid(&c),
                reg.credential_id.as_str(),
                wa::b64u(&reg.public_key),
                reg.counter as i64,
                (!transports.is_empty()).then_some(transports),
                name.as_str(),
                now
            ],
        )
        .await;
        match created {
            Err(e) if db::is_unique_violation(&e) => {
                return Ok(err(
                    StatusCode::BAD_REQUEST,
                    "Essa chave de acesso já está na sua conta.",
                ));
            }
            other => {
                other?;
            }
        }
        security_log(&c.db, uid(&c), "PASSKEY_ADDED", &c.headers, c.ip.as_deref()).await;
        Ok((
            StatusCode::CREATED,
            Json(json!({
                "passkey": { "id": id, "name": name, "createdAt": db::iso(now), "lastUsedAt": null }
            })),
        )
            .into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `DELETE /passkeys/{id}`.
pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        let n = db::exec(
            &c.db,
            "DELETE FROM Passkey WHERE id = ? AND userId = ?",
            params![id.as_str(), uid(&c)],
        )
        .await?;
        if n == 0 {
            return Ok(err(StatusCode::NOT_FOUND, "Chave não encontrada."));
        }
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `POST /passkeys/login/options` (sem login).
pub async fn login_options(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&ratelimit::LOGIN, By::Ip)));
    let out = async {
        let rp = rp(&state, &c.headers)?;
        let challenge = random_b64u(32);
        let flow_id = random_b64u(18);
        state
            .cache
            .set_strict(
                &format!("passkey:auth:{flow_id}"),
                &challenge,
                CHALLENGE_TTL,
            )
            .await
            .ok_or_else(redis_down)?;
        Ok(Json(json!({
            "options": {
                "rpId": rp.id,
                "challenge": challenge,
                "timeout": 60000,
                "userVerification": "preferred",
            },
            "flowId": flow_id,
        }))
        .into_response())
    }
    .await;
    finish(out, c.counted)
}

async fn passkey_by_credential(db: &Db, credential_id: &str) -> db::DbResult<Option<db::Row>> {
    db::first(
        db,
        "SELECT id, userId, publicKey, counter FROM Passkey WHERE credentialId = ?",
        params![credential_id],
    )
    .await
}

/// `POST /passkeys/login/verify { flowId, response }` (sem login). A chave
/// já é um segundo fator (aparelho + digital/PIN): não pede o 2FA.
pub async fn login_verify(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&ratelimit::LOGIN, By::Ip)));
    let out = async {
        let flow_id = js_string(c.body.get("flowId"));
        let response = c.body.get("response").cloned().unwrap_or(Value::Null);
        let resp_id = js_string(response.get("id"));
        let challenge = if flow_id.is_empty() {
            None
        } else {
            state
                .cache
                .get_raw(&format!("passkey:auth:{flow_id}"))
                .await
                .ok_or_else(redis_down)?
        };
        let (Some(challenge), false) = (challenge, resp_id.is_empty()) else {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "O pedido expirou. Tente de novo.",
            ));
        };
        state
            .cache
            .del(&format!("passkey:auth:{flow_id}"))
            .await
            .ok_or_else(redis_down)?;
        let Some(key) = passkey_by_credential(&c.db, &resp_id).await? else {
            return Ok(err(
                StatusCode::UNAUTHORIZED,
                "Essa chave de acesso não está ligada a nenhuma conta.",
            ));
        };
        let key_id: String = db::get(&key, "id")?;
        let user_id: String = db::get(&key, "userId")?;
        let public_key: String = db::get(&key, "publicKey")?;
        let counter: i64 = db::get(&key, "counter")?;
        let rp = rp(&state, &c.headers)?;
        let exp = Expected {
            challenge: &challenge,
            origin: &rp.origin,
            rp_id: &rp.id,
        };
        let cose = wa::from_b64u(&public_key).unwrap_or_default();
        let new_counter = match wa::verify_authentication(
            &response,
            &exp,
            &cose,
            counter.clamp(0, u32::MAX as i64) as u32,
        ) {
            Ok(n) => n,
            Err(why) => {
                tracing::info!("[passkey] entrada recusada: {why}");
                return Ok(err(
                    StatusCode::UNAUTHORIZED,
                    "Não deu pra confirmar a chave de acesso.",
                ));
            }
        };
        db::exec(
            &c.db,
            "UPDATE Passkey SET counter = ?, lastUsedAt = ? WHERE id = ?",
            params![new_counter as i64, db::now(), key_id.as_str()],
        )
        .await?;
        let Some(user) = find_user_by_id(&c.db, &user_id).await? else {
            return Ok(err(StatusCode::UNAUTHORIZED, "Conta não encontrada."));
        };
        if let Some(r) = blocked_response(&state, &user) {
            return Ok(r);
        }
        let req = Req {
            user_agent: c
                .headers
                .get(header::USER_AGENT)
                .and_then(|v| v.to_str().ok())
                .map(String::from),
            ip: c.ip.clone(),
        };
        complete_login(&state, &c.db, &req, &user).await
    }
    .await;
    finish(out, c.counted)
}
