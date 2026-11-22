//! `/api/friends` (routes/friends.js + controllers/friendController.js):
//! lista de amigos e pedidos, pedir, responder, desfazer, bloquear e
//! desbloquear.
//!
//! Diferença de propósito em relação ao Node: o aviso `friend:request`
//! leva só os campos públicos de quem pediu (o Node mandava a linha
//! inteira do `User` — e-mail, hash da senha, segredo do 2FA).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::conversations;
use crate::db::{self, Db};
use crate::node::{self, Emit};
use crate::params;
use crate::prisma_json::{find_many, find_one};
use crate::routes::ctx::{err, finish, js_slice, js_to_string, prelude_or_return, uid};
use crate::routes::profile::friend_ids;
use crate::routes::users::reply;
use crate::users;

fn created(mut res: Response) -> Response {
    *res.status_mut() = StatusCode::CREATED;
    res
}

/// `getExtraPrefs(id).friendReqMessages !== false` (mostrar o recado do pedido?).
async fn shows_request_notes(db: &Db, user: &str) -> bool {
    let raw: Option<Option<String>> = db::scalar(
        db,
        "SELECT extraPrefs FROM UserSettings WHERE userId = ?",
        params![user],
    )
    .await
    .unwrap_or(None);
    let prefs = raw
        .flatten()
        .filter(|r| !r.is_empty())
        .and_then(|r| crate::js::parse(&r));
    !matches!(
        prefs.as_ref().and_then(|p| p.get("friendReqMessages")),
        Some(Value::Bool(false))
    )
}

/// A amizade (em qualquer direção) entre as duas pessoas.
async fn between(db: &Db, a: &str, b: &str) -> db::DbResult<Option<Map<String, Value>>> {
    find_one(
        db,
        "Friendship",
        "WHERE (requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)",
        params![a, b, b, a],
    )
    .await
}

fn str_of<'a>(m: &'a Map<String, Value>, k: &str) -> &'a str {
    m.get(k).and_then(Value::as_str).unwrap_or_default()
}

/// `.replace(/\s+/g, ' ').trim().slice(0, 200)` do recado.
fn clean_note(s: &str) -> String {
    let is_space = |c: char| c.is_whitespace() || c == '\u{feff}';
    let mut out = String::with_capacity(s.len());
    let mut in_space = false;
    for ch in s.chars() {
        if is_space(ch) {
            if !in_space {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(ch);
            in_space = false;
        }
    }
    js_slice(out.trim_matches(' '), 200)
}

/// `findUnique({ where: { username } })`: sem nome ou nome que não é
/// texto é erro de validação do Prisma (500).
async fn user_by_username(db: &Db, v: Option<&Value>) -> anyhow::Result<Option<db::Row>> {
    let Some(Value::String(name)) = v else {
        anyhow::bail!("Argument `where` of type UserWhereUniqueInput needs `username`");
    };
    Ok(db::first(
        db,
        "SELECT id, friendRequestPrivacy FROM `User` WHERE username = ?",
        params![name.as_str()],
    )
    .await?)
}

// ---------------------------------------------------------------- listas

/// `GET /api/friends`: amizades, pedidos e bloqueios feitos por mim.
pub async fn list(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c);
        let rows = find_many(
            &c.db,
            "Friendship",
            "WHERE requesterId = ? OR (addresseeId = ? AND status <> 'BLOCKED') ORDER BY updatedAt DESC",
            params![me, me],
        )
        .await?;
        let others: Vec<String> = rows
            .iter()
            .map(|f| {
                let r = str_of(f, "requesterId");
                if r == me { str_of(f, "addresseeId") } else { r }.to_string()
            })
            .collect();
        let people = users::public_by_ids(&c.db, &others).await?;
        let show_notes = shows_request_notes(&c.db, me).await;
        let mut list = Vec::with_capacity(rows.len());
        for (f, other) in rows.iter().zip(&others) {
            let mine = str_of(f, "requesterId") == me;
            let pending = str_of(f, "status") == "PENDING";
            let message = match f.get("message") {
                Some(Value::String(m)) if pending && (mine || show_notes) && !m.is_empty() => {
                    Value::String(m.clone())
                }
                _ => Value::Null,
            };
            let user = people
                .get(other)
                .cloned()
                .map(Value::Object)
                .unwrap_or(Value::Null);
            list.push(json!({
                "id": f["id"],
                "status": f["status"],
                "message": message,
                "isIncoming": str_of(f, "addresseeId") == me,
                "user": user,
                "createdAt": f["createdAt"],
                "updatedAt": f["updatedAt"],
            }));
        }
        Ok(reply(&c, json!({ "friendships": list })))
    }
    .await;
    finish(out, c.counted)
}

/// `GET /api/friends/blocked`: só os bloqueios que eu fiz.
pub async fn blocked(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let rows = find_many(
            &c.db,
            "Friendship",
            "WHERE status = 'BLOCKED' AND requesterId = ? ORDER BY updatedAt DESC",
            params![uid(&c)],
        )
        .await?;
        let ids: Vec<String> = rows
            .iter()
            .map(|r| str_of(r, "addresseeId").to_string())
            .collect();
        let people = users::public_by_ids(&c.db, &ids).await?;
        let list: Vec<Value> = rows
            .iter()
            .zip(&ids)
            .map(|(r, id)| {
                json!({
                    "id": r["id"],
                    "user": people.get(id).cloned().map(Value::Object).unwrap_or(Value::Null),
                    "blockedAt": r["updatedAt"],
                })
            })
            .collect();
        Ok(reply(&c, json!({ "blocked": list })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- pedido

/// `POST /api/friends/request { username, message? }`.
pub async fn send_request(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let Some(target) = user_by_username(&c.db, c.body.get("username")).await? else {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        };
        let target_id: String = db::get(&target, "id")?;
        if target_id == me {
            return Ok(err(StatusCode::BAD_REQUEST, "Você não pode se adicionar."));
        }
        if let Some(f) = between(&c.db, &me, &target_id).await? {
            return Ok(if str_of(&f, "status") == "BLOCKED" {
                err(StatusCode::FORBIDDEN, "Não é possível enviar pedido.")
            } else {
                err(
                    StatusCode::CONFLICT,
                    "Pedido já existe ou vocês já são amigos.",
                )
            });
        }
        let privacy: Option<String> = db::get(&target, "friendRequestPrivacy")?;
        match privacy.as_deref() {
            Some("NOBODY") => {
                return Ok(err(
                    StatusCode::FORBIDDEN,
                    "Esta pessoa não está aceitando pedidos de amizade.",
                ));
            }
            Some("FRIENDS_OF_FRIENDS") => {
                let mine: std::collections::HashSet<String> =
                    friend_ids(&c.db, &me).await?.into_iter().collect();
                let theirs = friend_ids(&c.db, &target_id).await?;
                if !theirs.iter().any(|t| mine.contains(t)) {
                    return Ok(err(
                        StatusCode::FORBIDDEN,
                        "Esta pessoa só aceita pedidos de amigos em comum.",
                    ));
                }
            }
            _ => {}
        }
        let note = match c.body.get("message") {
            Some(Value::String(s)) => clean_note(s),
            _ => String::new(),
        };
        let id = db::new_id();
        let now = db::now();
        db::exec(
            &c.db,
            "INSERT INTO Friendship (id, requesterId, addresseeId, status, message, createdAt, updatedAt) \
             VALUES (?, ?, ?, 'PENDING', ?, ?, ?)",
            params![
                id.as_str(),
                me.as_str(),
                target_id.as_str(),
                (!note.is_empty()).then_some(note.as_str()),
                now,
                now
            ],
        )
        .await?;
        let friendship = find_one(&c.db, "Friendship", "WHERE id = ?", params![id.as_str()])
            .await?
            .unwrap_or_default();
        let mut shown = friendship.clone();
        if !shows_request_notes(&c.db, &target_id).await {
            shown.insert("message".into(), Value::Null);
        }
        let from = db::first(&c.db, &users::public_select_sql("WHERE u.id = ?"), params![me.as_str()])
            .await?
            .map(|r| users::public_user(&r))
            .transpose()?
            .map(|mut u| {
                // só os campos da própria linha do User (sem as relações)
                u.remove("clanTag");
                u.remove("selectedPendant");
                Value::Object(u)
            })
            .unwrap_or(Value::Null);
        let actor = from.get("displayName").cloned().unwrap_or(Value::Null);
        let room = format!("user:{target_id}");
        node::realtime(
            &state,
            vec![Emit::to(
                &[room.as_str()],
                "friend:request",
                json!({ "friendship": shown, "from": from }),
            )],
            None,
        );
        node::after_json(
            &state,
            vec![json!({
                "name": "offlineEmail",
                "userId": target_id,
                "payload": { "type": "friend_request", "actorName": actor },
            })],
        );
        Ok(created(reply(&c, json!({ "friendship": friendship }))))
    }
    .await;
    finish(out, c.counted)
}

/// Propriedades que todo objeto do JS tem (`statusMap[action]` com uma
/// delas dá uma função, que o Prisma recusa: 500).
const PROTO_KEYS: [&str; 12] = [
    "constructor",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

/// `POST /api/friends/{id}/respond { action: accept | decline | block }`.
pub async fn respond(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let Some(f) = find_one(&c.db, "Friendship", "WHERE id = ?", params![id.as_str()])
            .await?
            .filter(|f| str_of(f, "addresseeId") == me)
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Pedido não encontrado."));
        };
        let action = c.body.get("action").map(js_to_string);
        let status = match action.as_deref() {
            Some("accept") => "ACCEPTED",
            Some("decline") => "DECLINED",
            Some("block") => "BLOCKED",
            Some(k) if PROTO_KEYS.contains(&k) => {
                anyhow::bail!("Argument `status`: Invalid value provided")
            }
            _ => return Ok(err(StatusCode::BAD_REQUEST, "Ação inválida.")),
        };
        let requester = str_of(&f, "requesterId").to_string();
        let now = db::now();
        match status {
            "BLOCKED" => {
                db::exec(
                    &c.db,
                    "UPDATE Friendship SET status = 'BLOCKED', requesterId = ?, addresseeId = ?, updatedAt = ? WHERE id = ?",
                    params![me.as_str(), requester.as_str(), now, id.as_str()],
                )
                .await?
            }
            "ACCEPTED" => {
                db::exec(
                    &c.db,
                    "UPDATE Friendship SET status = 'ACCEPTED', acceptedAt = ?, updatedAt = ? WHERE id = ?",
                    params![now, now, id.as_str()],
                )
                .await?
            }
            _ => {
                db::exec(
                    &c.db,
                    "UPDATE Friendship SET status = ?, updatedAt = ? WHERE id = ?",
                    params![status, now, id.as_str()],
                )
                .await?
            }
        };
        let updated = find_one(&c.db, "Friendship", "WHERE id = ?", params![id.as_str()])
            .await?
            .unwrap_or_default();
        let req_room = format!("user:{requester}");
        node::realtime(
            &state,
            vec![Emit::to(
                &[req_room.as_str()],
                "friend:update",
                json!({ "friendship": updated }),
            )],
            None,
        );
        if status == "ACCEPTED" || status == "BLOCKED" {
            node::friends_changed(&state, &requester, &me);
        }
        if status == "ACCEPTED" {
            // como no Discord: a conversa direta já fica pronta
            if let Some(conv) = conversations::ensure_direct(&c.db, &requester, &me).await? {
                let my_room = format!("user:{me}");
                node::realtime(
                    &state,
                    vec![
                        Emit::to(
                            &[req_room.as_str()],
                            "conversation:new",
                            json!({ "conversation": conv }),
                        ),
                        Emit::to(
                            &[my_room.as_str()],
                            "conversation:new",
                            json!({ "conversation": conv }),
                        ),
                    ],
                    None,
                );
            }
            node::after(
                &state,
                &[("achievements", requester.as_str()), ("achievements", me.as_str())],
            );
        }
        Ok(reply(&c, json!({ "friendship": updated })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- desfazer / bloquear

/// `DELETE /api/friends/{id}`: desfaz amizade/pedido (bloqueio só quem fez).
pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let found = find_one(&c.db, "Friendship", "WHERE id = ?", params![id.as_str()]).await?;
        let Some(f) = found.filter(|f| {
            let (r, a) = (str_of(f, "requesterId"), str_of(f, "addresseeId"));
            (r == me || a == me) && !(str_of(f, "status") == "BLOCKED" && r != me)
        }) else {
            return Ok(err(StatusCode::NOT_FOUND, "Amizade não encontrada."));
        };
        let n = db::exec(
            &c.db,
            "DELETE FROM Friendship WHERE id = ?",
            params![id.as_str()],
        )
        .await?;
        if n == 0 {
            anyhow::bail!("Record to delete does not exist.");
        }
        let (r, a) = (str_of(&f, "requesterId"), str_of(&f, "addresseeId"));
        let other = if r == me { a } else { r };
        node::friends_changed(&state, r, a);
        let room = format!("user:{other}");
        node::realtime(
            &state,
            vec![Emit::to(
                &[room.as_str()],
                "friend:removed",
                json!({ "friendshipId": id }),
            )],
            None,
        );
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `POST /api/friends/block { username }`.
pub async fn block(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let name = c.body.get("username").filter(|v| v.as_str().is_some_and(|s| !s.is_empty()));
        if name.is_none() {
            return Ok(err(StatusCode::BAD_REQUEST, "Usuário inválido."));
        }
        let Some(target) = user_by_username(&c.db, name).await? else {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        };
        let target_id: String = db::get(&target, "id")?;
        if target_id == me {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "Você não pode bloquear a si mesmo.",
            ));
        }
        let now = db::now();
        match between(&c.db, &me, &target_id).await? {
            Some(f) => {
                db::exec(
                    &c.db,
                    "UPDATE Friendship SET status = 'BLOCKED', requesterId = ?, addresseeId = ?, updatedAt = ? WHERE id = ?",
                    params![me.as_str(), target_id.as_str(), now, str_of(&f, "id")],
                )
                .await?;
            }
            None => {
                db::exec(
                    &c.db,
                    "INSERT INTO Friendship (id, requesterId, addresseeId, status, createdAt, updatedAt) \
                     VALUES (?, ?, ?, 'BLOCKED', ?, ?)",
                    params![db::new_id(), me.as_str(), target_id.as_str(), now, now],
                )
                .await?;
            }
        }
        node::friends_changed(&state, &me, &target_id);
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `DELETE /api/friends/block/{userId}`: desbloquear.
pub async fn unblock(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let n = db::exec(
            &c.db,
            "DELETE FROM Friendship WHERE status = 'BLOCKED' AND requesterId = ? AND addresseeId = ?",
            params![uid(&c), user_id.as_str()],
        )
        .await?;
        if n == 0 {
            return Ok(err(
                StatusCode::NOT_FOUND,
                "Este usuário não está na sua lista de bloqueados.",
            ));
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
    fn recado_limpo_igual_ao_js() {
        assert_eq!(clean_note("  oi\n\n  tudo\tbem?  "), "oi tudo bem?");
        assert_eq!(clean_note("\u{feff}a\u{a0}b"), "a b");
        assert_eq!(clean_note(&"x".repeat(300)).len(), 200);
        assert_eq!(clean_note("   "), "");
    }
}
