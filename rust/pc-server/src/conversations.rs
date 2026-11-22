//! Conversas (controllers/conversationController.js) — por enquanto só o
//! que outras partes precisam: `ensureDirectConversation` e `hydrate`.

use serde_json::{Value, json};

use crate::db::{self, Db, DbResult, Ty};
use crate::params;
use crate::users;

/// `hydrate(id)`: a conversa no formato que vai pro site (membros por
/// ordem de entrada, "invisível" aparece como offline).
pub async fn hydrate(db: &Db, id: &str) -> DbResult<Option<Value>> {
    let Some(c) = db::first(
        db,
        "SELECT id, isGroup, name, slug, icon, ownerId, ephemeralSeconds FROM Conversation WHERE id = ?",
        params![id],
    )
    .await?
    else {
        return Ok(None);
    };
    let rows = db::all(
        db,
        &users::public_select_sql(
            "JOIN ConversationMember cm ON cm.userId = u.id WHERE cm.conversationId = ? ORDER BY cm.joinedAt ASC",
        ),
        params![id],
    )
    .await?;
    let mut members = Vec::with_capacity(rows.len());
    let mut first_member: Option<String> = None;
    for r in &rows {
        let u = users::public_user(r)?;
        if first_member.is_none() {
            first_member = u.get("id").and_then(Value::as_str).map(String::from);
        }
        members.push(Value::Object(u));
    }
    let mut members = Value::Array(members);
    crate::auth::mask_invisible(&mut members, None);
    let is_group: bool = db::get(&c, "isGroup")?;
    let slug = if is_group {
        db::get::<Option<String>>(&c, "slug")?.filter(|s| !s.is_empty())
    } else {
        None
    };
    let owner = if is_group {
        db::get::<Option<String>>(&c, "ownerId")?
            .filter(|s| !s.is_empty())
            .or(first_member)
    } else {
        None
    };
    Ok(Some(json!({
        "id": db::col(&c, "id", Ty::Str)?,
        "isGroup": is_group,
        "name": db::col(&c, "name", Ty::Str)?,
        "slug": slug,
        "icon": db::col(&c, "icon", Ty::Str)?,
        "ownerId": owner,
        "members": members,
        "ephemeralSeconds": db::col(&c, "ephemeralSeconds", Ty::Int)?,
    })))
}

/// `ensureDirectConversation(a, b)`: a conversa direta entre as duas
/// pessoas (cria se não existir).
pub async fn ensure_direct(db: &Db, a: &str, b: &str) -> DbResult<Option<Value>> {
    if a == b {
        return Ok(None);
    }
    let existing: Option<String> = db::scalar(
        db,
        "SELECT c.id FROM Conversation c WHERE c.isGroup = 0 \
         AND c.id IN (SELECT conversationId FROM ConversationMember WHERE userId = ?) \
         AND c.id IN (SELECT conversationId FROM ConversationMember WHERE userId = ?) LIMIT 1",
        params![a, b],
    )
    .await?;
    if let Some(id) = existing {
        let n: i64 = db::scalar(
            db,
            "SELECT COUNT(*) FROM ConversationMember WHERE conversationId = ?",
            params![id.as_str()],
        )
        .await?
        .unwrap_or(0);
        if n == 2 {
            return hydrate(db, &id).await;
        }
    }
    let id = db::new_id();
    let now = db::now();
    db::transaction(
        db,
        vec![
            (
                "INSERT INTO Conversation (id, isGroup, name, createdAt) VALUES (?, 0, NULL, ?)",
                params![id.as_str(), now],
            ),
            (
                "INSERT INTO ConversationMember (id, conversationId, userId, joinedAt) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
                params![
                    db::new_id(),
                    id.as_str(),
                    a,
                    now,
                    db::new_id(),
                    id.as_str(),
                    b,
                    now
                ],
            ),
        ],
    )
    .await?;
    hydrate(db, &id).await
}
