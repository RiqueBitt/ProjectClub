//! Exportar meus dados (LGPD, art. 18 — portabilidade) — porte de
//! `dataExportController.js`: um JSON com os dados pessoais e o conteúdo da
//! conta, sem segredos (hash de senha, 2FA, tokens) e com o mínimo de dados
//! de outras pessoas.

use axum::body::Bytes;
use axum::extract::State;
use axum::http::request::Parts;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{self, Db};
use crate::params;
use crate::prisma_json::pick;
use crate::ratelimit;
use crate::routes::ctx::{By, err, finish, prelude_or_return, uid};

const LIMIT: u32 = 20000;
const SECRET_USER_FIELDS: [&str; 7] = [
    "passwordHash",
    "twoFactorSecret",
    "twoFactorLastUsedStep",
    "emailVerifyToken",
    "passwordResetToken",
    "passwordResetExpires",
    "emailVerifyExpires",
];

/// Linhas inteiras de um modelo (`SELECT *`), como o `findMany` sem `select`.
async fn rows(db: &Db, model: &str, rest: &str, p: Vec<db::Value>) -> db::DbResult<Vec<Value>> {
    Ok(crate::prisma_json::find_many(db, model, rest, p)
        .await?
        .into_iter()
        .map(Value::Object)
        .collect())
}

/// `safe()` do Node: erro vira `null` (e a lista vazia, mais abaixo).
fn safe<T>(r: db::DbResult<T>) -> Option<T> {
    r.inspect_err(|e| tracing::warn!("[export] parte falhou: {e}"))
        .ok()
}

async fn messages(db: &Db, user_id: &str) -> db::DbResult<Vec<Value>> {
    let list = rows(
        db,
        "Message",
        &format!("WHERE authorId = ? AND deleted = 0 ORDER BY createdAt DESC LIMIT {LIMIT}"),
        params![user_id],
    )
    .await?;
    let ids: Vec<String> = list
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect();
    let mut attachments: std::collections::HashMap<String, Vec<Value>> = Default::default();
    for chunk in ids.chunks(5000) {
        let marks = vec!["?"; chunk.len()].join(", ");
        let p = chunk.iter().map(|i| db::Value::from(i.as_str())).collect();
        for a in rows(
            db,
            "Attachment",
            &format!("WHERE messageId IN ({marks}) ORDER BY id"),
            p,
        )
        .await?
        {
            let Value::Object(a) = a else { continue };
            let mid = a["messageId"].as_str().unwrap_or_default().to_string();
            attachments.entry(mid).or_default().push(Value::Object(pick(
                a,
                &["url", "filename", "mimeType", "size"],
            )));
        }
    }
    Ok(list
        .into_iter()
        .filter_map(|m| match m {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .map(|m| {
            let id = m["id"].as_str().unwrap_or_default().to_string();
            let mut o = pick(
                m,
                &[
                    "id",
                    "content",
                    "channelId",
                    "conversationId",
                    "createdAt",
                    "edited",
                    "pinned",
                ],
            );
            o.insert(
                "attachments".into(),
                Value::Array(attachments.remove(&id).unwrap_or_default()),
            );
            Value::Object(o)
        })
        .collect())
}

fn picked(list: Vec<Value>, keys: &[&str]) -> Vec<Value> {
    list.into_iter()
        .filter_map(|v| match v {
            Value::Object(o) => Some(Value::Object(pick(o, keys))),
            _ => None,
        })
        .collect()
}

/// Amigos: só id + nome (dado mínimo de outra pessoa) e desde quando.
async fn friends(db: &Db, user_id: &str, friendships: &[Value]) -> db::DbResult<Vec<Value>> {
    if friendships.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<String> = friendships
        .iter()
        .filter_map(|f| {
            let other = if f["requesterId"] == user_id {
                &f["addresseeId"]
            } else {
                &f["requesterId"]
            };
            other.as_str().map(String::from)
        })
        .collect();
    let marks = vec!["?"; ids.len()].join(", ");
    let p = ids.iter().map(|i| db::Value::from(i.as_str())).collect();
    let users = rows(db, "User", &format!("WHERE id IN ({marks})"), p).await?;
    Ok(users
        .into_iter()
        .filter_map(|u| match u {
            Value::Object(u) => Some(u),
            _ => None,
        })
        .map(|u| {
            let id = u["id"].clone();
            let mut o = pick(u, &["id", "displayName", "username"]);
            let since = friendships
                .iter()
                .find(|f| f["requesterId"] == id || f["addresseeId"] == id)
                .map(|f| f["createdAt"].clone());
            if let Some(s) = since {
                o.insert("since".into(), s);
            }
            Value::Object(o)
        })
        .collect())
}

/// `GET /api/auth/export-data`.
pub async fn export_data(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        let me = uid(&c);
        let db = &c.db;
        let user = rows(db, "User", "WHERE id = ?", params![me]).await?;
        let Some(Value::Object(mut account)) = user.into_iter().next() else {
            return Ok(err(StatusCode::NOT_FOUND, "Conta não encontrada."));
        };
        for k in SECRET_USER_FIELDS {
            // `shift_remove` mantém a ordem (o `remove` puxaria o último campo pro lugar)
            account.shift_remove(k);
        }
        let username = account["username"].as_str().unwrap_or_default().to_string();
        let lim = format!("LIMIT {LIMIT}");
        let q_posts = format!("WHERE authorId = ? ORDER BY createdAt DESC {lim}");
        let q_eco = format!("WHERE userId = ? ORDER BY createdAt DESC {lim}");
        let q_test = format!("WHERE authorId = ? OR targetId = ? {lim}");
        let (settings, msgs, posts, comments, economy, friendships, playtime, minigames) = tokio::join!(
            rows(db, "UserSettings", "WHERE userId = ?", params![me]),
            messages(db, me),
            rows(db, "Post", &q_posts, params![me]),
            rows(db, "PostComment", &q_posts, params![me]),
            rows(db, "EconomyTransaction", &q_eco, params![me]),
            rows(
                db,
                "Friendship",
                "WHERE status = 'ACCEPTED' AND (requesterId = ? OR addresseeId = ?)",
                params![me, me]
            ),
            rows(db, "GamePlaytime", "WHERE userId = ?", params![me]),
            rows(db, "MinigameStat", "WHERE userId = ?", params![me]),
        );
        let (achievements, testimonials, reminders, scheduled) = tokio::join!(
            rows(db, "UserAchievement", "WHERE userId = ?", params![me]),
            rows(db, "Testimonial", &q_test, params![me, me]),
            rows(db, "Reminder", "WHERE userId = ?", params![me]),
            rows(db, "ScheduledMessage", "WHERE authorId = ?", params![me]),
        );
        let settings = safe(settings).and_then(|s| s.into_iter().next());
        let msgs = safe(msgs).unwrap_or_default();
        let posts = picked(
            safe(posts).unwrap_or_default(),
            &["id", "title", "content", "type", "createdAt", "communityId"],
        );
        let comments = picked(
            safe(comments).unwrap_or_default(),
            &["id", "content", "postId", "createdAt"],
        );
        let friendships = picked(
            safe(friendships).unwrap_or_default(),
            &["requesterId", "addresseeId", "createdAt"],
        );
        let friends = friends(db, me, &friendships).await?;
        let list = |v: db::DbResult<Vec<Value>>| Value::Array(safe(v).unwrap_or_default());
        let now = chrono::Utc::now();
        let counts = json!({
            "messages": msgs.len(),
            "posts": posts.len(),
            "comments": comments.len(),
            "friends": friends.len(),
        });
        let mut payload = Map::new();
        payload.insert("exportedAt".into(), json!(db::iso(now.naive_utc())));
        payload.insert(
            "about".into(),
            json!("Exportação dos seus dados no Project Club (LGPD). Guarde com cuidado: contém suas mensagens e informações pessoais."),
        );
        payload.insert("account".into(), Value::Object(account));
        payload.insert("settings".into(), settings.unwrap_or(Value::Null));
        payload.insert("friends".into(), Value::Array(friends));
        payload.insert("messages".into(), Value::Array(msgs));
        payload.insert("posts".into(), Value::Array(posts));
        payload.insert("comments".into(), Value::Array(comments));
        payload.insert("economy".into(), list(economy));
        payload.insert(
            "games".into(),
            json!({ "playtime": list(playtime), "minigames": list(minigames) }),
        );
        payload.insert("achievements".into(), list(achievements));
        payload.insert("testimonials".into(), list(testimonials));
        payload.insert("reminders".into(), list(reminders));
        payload.insert("scheduledMessages".into(), list(scheduled));
        payload.insert("counts".into(), counts);

        let clean: String = username
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
            .collect();
        let name = format!(
            "projectclub-dados-{clean}-{}.json",
            now.format("%Y-%m-%d")
        );
        let text = serde_json::to_string_pretty(&Value::Object(payload))?;
        let mut res = text.into_response();
        let h = res.headers_mut();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json; charset=utf-8"),
        );
        h.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{name}\""))?,
        );
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        Ok(res)
    }
    .await;
    finish(out, c.counted)
}
