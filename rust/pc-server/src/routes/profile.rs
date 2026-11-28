//! Perfil de alguém (`GET /api/users/{id}`) com as regras de privacidade —
//! porte de `getUser`, `checkPrivacyLevel`, `hasFullProfileAccess` e
//! `hasActivityAccess` (`userController.js`) e de `getFeaturedForProfile`
//! (`modpackController.js`).

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use chrono::Datelike;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{self, Db};
use crate::js;
use crate::params;
use crate::prisma_json::{find_many, find_one, row};
use crate::routes::ctx::{err, finish, prelude_or_return, uid};
use crate::routes::users::reply;
use crate::users;

// ---------------------------------------------------------------- privacidade

async fn are_friends(db: &Db, a: &str, b: &str) -> db::DbResult<bool> {
    Ok(db::scalar::<String>(
        db,
        "SELECT id FROM Friendship WHERE status = 'ACCEPTED' AND ((requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)) LIMIT 1",
        params![a, b, b, a],
    )
    .await?
    .is_some())
}

/// `checkPrivacyLevel`: 'everyone' | 'friends' | 'friends_groups' | 'none'.
pub(crate) async fn check_privacy_level(
    db: &Db,
    viewer: &str,
    target: &str,
    level: &str,
) -> db::DbResult<bool> {
    if viewer == target || level == "everyone" {
        return Ok(true);
    }
    if level == "none" {
        return Ok(false);
    }
    if are_friends(db, viewer, target).await? {
        return Ok(true);
    }
    if level != "friends_groups" {
        return Ok(false);
    }
    let clan = |id: &str| {
        let id = id.to_string();
        async move {
            db::scalar::<Option<String>>(db, "SELECT clanId FROM `User` WHERE id = ?", params![id])
                .await
                .map(Option::flatten)
        }
    };
    let (a, b) = (clan(viewer).await?, clan(target).await?);
    Ok(matches!((a, b), (Some(a), Some(b)) if !a.is_empty() && a == b))
}

/// `hasFullProfileAccess`: quem está vendo pode ver o perfil completo?
pub(crate) async fn has_full_access(db: &Db, viewer: &str, target: &str) -> db::DbResult<bool> {
    if viewer == target {
        return Ok(true);
    }
    let level: Option<String> = db::scalar(
        db,
        "SELECT profilePrivacy FROM UserSettings WHERE userId = ?",
        params![target],
    )
    .await?;
    let level = level.filter(|l| !l.is_empty());
    check_privacy_level(db, viewer, target, level.as_deref().unwrap_or("everyone")).await
}

/// `hasActivityAccess`: pode ver o que a pessoa está jogando/fazendo?
pub(crate) async fn has_activity_access(db: &Db, viewer: &str, target: &str) -> db::DbResult<bool> {
    if viewer == target {
        return Ok(true);
    }
    let row = db::first(
        db,
        "SELECT activitySharing, activityVisibility FROM UserSettings WHERE userId = ?",
        params![target],
    )
    .await?;
    let (sharing, level) = match row {
        Some(r) => (
            db::get::<Option<bool>>(&r, "activitySharing")?,
            db::get::<Option<String>>(&r, "activityVisibility")?,
        ),
        None => (None, None),
    };
    if sharing == Some(false) {
        return Ok(false);
    }
    let level = level.filter(|l| !l.is_empty());
    check_privacy_level(db, viewer, target, level.as_deref().unwrap_or("everyone")).await
}

// ---------------------------------------------------------------- níveis

/// Quanto (0–100) do nível atual já foi.
fn level_progress(level: i64, xp: i64) -> i64 {
    crate::levels::progress(level, xp)
}

// ---------------------------------------------------------------- partes do perfil

const SMALL_USER: &str = "id, displayName, username, avatarUrl, avatarDecoration, profileColor";

fn small_user(r: &db::Row) -> db::DbResult<Value> {
    Ok(json!({
        "id": db::get::<String>(r, "id")?,
        "displayName": db::get::<String>(r, "displayName")?,
        "username": db::get::<String>(r, "username")?,
        "avatarUrl": db::get::<Option<String>>(r, "avatarUrl")?,
        "avatarDecoration": db::get::<Option<String>>(r, "avatarDecoration")?,
        "profileColor": db::get::<Option<String>>(r, "profileColor")?,
    }))
}

async fn small_users(db: &Db, ids: &[String]) -> db::DbResult<Vec<Value>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let marks = vec!["?"; ids.len()].join(", ");
    let p = ids.iter().map(|i| db::Value::from(i.as_str())).collect();
    let rows = db::all(
        db,
        &format!("SELECT {SMALL_USER} FROM `User` WHERE id IN ({marks})"),
        p,
    )
    .await?;
    rows.iter().map(small_user).collect()
}

pub(crate) async fn friend_ids(db: &Db, user: &str) -> db::DbResult<Vec<String>> {
    let rows = db::all(
        db,
        "SELECT requesterId, addresseeId FROM Friendship WHERE status = 'ACCEPTED' AND (requesterId = ? OR addresseeId = ?)",
        params![user, user],
    )
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let (a, b): (String, String) = (db::get(r, "requesterId")?, db::get(r, "addresseeId")?);
        out.push(if a == user { b } else { a });
    }
    Ok(out)
}

/// Amigos em comum (sem contar quem está vendo).
async fn mutual_friends(db: &Db, me: &str, target: &str) -> db::DbResult<Vec<Value>> {
    let mine: Vec<String> = friend_ids(db, me).await?;
    let theirs: HashSet<String> = friend_ids(db, target)
        .await?
        .into_iter()
        .filter(|f| f != me)
        .collect();
    let mut seen = HashSet::new();
    let common: Vec<String> = mine
        .into_iter()
        .filter(|f| theirs.contains(f) && seen.insert(f.clone()))
        .collect();
    small_users(db, &common).await
}

async fn count(db: &Db, sql: &str, p: Vec<db::Value>) -> db::DbResult<i64> {
    Ok(db::scalar::<i64>(db, sql, p).await?.unwrap_or(0))
}

/// Conquistas escolhidas pra mostrar (perfil e mini); JSON quebrado = nada.
async fn shown_achievements(db: &Db, profile: &Value, mini: &Value) -> (Vec<Value>, Vec<Value>) {
    let keys = |v: &Value| -> Option<Vec<Value>> {
        let text = v.as_str().filter(|s| !s.is_empty()).unwrap_or("[]");
        // só lista serve (com qualquer outra coisa o `.map` quebra → nada)
        match js::parse(text)? {
            Value::Array(a) => Some(a),
            _ => None,
        }
    };
    let (Some(p), Some(m)) = (keys(profile), keys(mini)) else {
        return (vec![], vec![]);
    };
    let mut all: Vec<String> = Vec::new();
    for k in p.iter().chain(m.iter()) {
        // o Prisma recusa chave que não é texto (vira lista vazia no catch)
        let Some(k) = k.as_str() else {
            return (vec![], vec![]);
        };
        if !all.iter().any(|x| x == k) {
            all.push(k.to_string());
        }
    }
    if all.is_empty() {
        return (vec![], vec![]);
    }
    let marks = vec!["?"; all.len()].join(", ");
    let p_vals = all.iter().map(|k| db::Value::from(k.as_str())).collect();
    let Ok(defs) = find_many(
        db,
        "Achievement",
        &format!("WHERE `key` IN ({marks})"),
        p_vals,
    )
    .await
    else {
        return (vec![], vec![]);
    };
    let by = |k: &Value| {
        defs.iter()
            .find(|d| d.get("key") == Some(k))
            .cloned()
            .map(Value::Object)
    };
    (
        p.iter().filter_map(by).collect(),
        m.iter().filter_map(by).collect(),
    )
}

/// `getFeaturedForProfile`: o modpack (ou mod) em destaque no perfil.
async fn featured(db: &Db, user: &str, viewer: &str) -> anyhow::Result<Value> {
    let Some(u) = db::first(
        db,
        "SELECT featuredModpackId, featuredModJson FROM `User` WHERE id = ?",
        params![user],
    )
    .await?
    else {
        return Ok(Value::Null);
    };
    let mp_id: Option<String> = db::get(&u, "featuredModpackId")?;
    let mod_json: Option<String> = db::get(&u, "featuredModJson")?;
    if let Some(mp_id) = mp_id.filter(|i| !i.is_empty()) {
        let Some(mp) =
            find_one(db, "SharedModpack", "WHERE id = ?", params![mp_id.as_str()]).await?
        else {
            return Ok(Value::Null);
        };
        let public = mp.get("isPublic").and_then(Value::as_bool).unwrap_or(false);
        if !public && user != viewer {
            return Ok(Value::Null);
        }
        let author_id = mp
            .get("authorId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let author = db::first(
            db,
            &format!("SELECT {SMALL_USER} FROM `User` WHERE id = ?"),
            params![author_id],
        )
        .await?
        .map(|r| small_user(&r))
        .transpose()?
        .unwrap_or(Value::Null);
        let my_vote: Option<i64> = db::scalar(
            db,
            "SELECT value FROM SharedModpackVote WHERE userId = ? AND modpackId = ?",
            params![viewer, mp_id.as_str()],
        )
        .await?;
        let downloaded = db::scalar::<String>(
            db,
            "SELECT modpackId FROM SharedModpackDownload WHERE userId = ? AND modpackId = ? LIMIT 1",
            params![viewer, mp_id.as_str()],
        )
        .await?
        .is_some();
        return Ok(
            json!({ "type": "modpack", "modpack": serialize_modpack(mp, author, my_vote.filter(|v| *v != 0).unwrap_or(0), downloaded)? }),
        );
    }
    if let Some(text) = mod_json.filter(|t| !t.is_empty())
        && let Some(m) = js::parse(&text)
        && m.get("name").is_some_and(truthy)
    {
        return Ok(json!({ "type": "mod", "mod": m }));
    }
    Ok(Value::Null)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `serialize(mp, { myVote, downloadedByMe })` do modpackController.
fn serialize_modpack(
    mp: Map<String, Value>,
    author: Value,
    my_vote: i64,
    downloaded: bool,
) -> anyhow::Result<Value> {
    let items = mp
        .get("items")
        .and_then(Value::as_str)
        .map(|t| if t.is_empty() { "[]" } else { t })
        .and_then(js::parse)
        .and_then(|v| match v {
            Value::Array(a) => Some(a),
            _ => None,
        })
        .unwrap_or_default();
    // `i.thumbnailUrl` / `i.source` num item null quebra no Node (→ sem destaque)
    if items.iter().any(Value::is_null) {
        anyhow::bail!("item nulo no modpack");
    }
    let field = |k: &str| mp.get(k).cloned().unwrap_or(Value::Null);
    let cover = mp
        .get("coverUrl")
        .filter(|v| truthy(v))
        .cloned()
        .or_else(|| {
            items
                .iter()
                .find_map(|i| i.get("thumbnailUrl").filter(|t| truthy(t)).cloned())
        })
        .unwrap_or(Value::Null);
    let downloadable = items
        .iter()
        .filter(|i| i.get("source").and_then(Value::as_str) != Some("local"))
        .count();
    Ok(json!({
        "id": field("id"),
        "authorId": field("authorId"),
        "author": author,
        "steamAppId": field("steamAppId"),
        "gameName": field("gameName"),
        "name": field("name"),
        "description": field("description"),
        "coverUrl": cover,
        "hasCustomCover": mp.get("coverUrl").is_some_and(truthy),
        "isPublic": field("isPublic"),
        "likeCount": field("likeCount"),
        "dislikeCount": field("dislikeCount"),
        "downloadCount": field("downloadCount"),
        "itemCount": items.len(),
        "downloadableCount": downloadable,
        "myVote": my_vote,
        "downloadedByMe": downloaded,
        "createdAt": field("createdAt"),
        "updatedAt": field("updatedAt"),
        "items": items,
    }))
}

// ---------------------------------------------------------------- GET /api/users/{id}

const HIDDEN_WHEN_RESTRICTED: [&str; 10] = [
    "bio",
    "pronouns",
    "customStatus",
    "customStatusEmoji",
    "customStatusExpiresAt",
    "youtubeUrl",
    "steamUrl",
    "robloxUrl",
    "xUrl",
    "profileSectionOrder",
];

pub async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let db = &c.db;
        let sql = users::public_select_sql("WHERE u.id = ?").replacen(
            " FROM `User` u",
            ", u.profileShowcase AS _profileShowcase FROM `User` u",
            1,
        );
        let Some(r) = db::first(db, &sql, params![id.as_str()]).await? else {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        };
        let mut user = users::public_user(&r)?;
        user.insert(
            "profileShowcase".into(),
            json!(db::get::<Option<String>>(&r, "_profileShowcase")?),
        );
        if user.get("publicId").is_none_or(Value::is_null)
            && let Some(slot) = user.get_mut("publicId")
        {
            *slot = json!(crate::routes::auth::ensure_public_id(db, &id).await?);
        }

        let full = has_full_access(db, &me, &id).await?;
        if !full {
            for k in HIDDEN_WHEN_RESTRICTED {
                if let Some(v) = user.get_mut(k) {
                    *v = Value::Null;
                }
            }
            for k in ["displayedAchievements", "displayedAchievementsMini"] {
                if let Some(v) = user.get_mut(k) {
                    *v = json!("[]");
                }
            }
            if let Some(v) = user.get_mut("profileShowcase") {
                *v = Value::Null;
            }
        }

        let partner_id = user
            .get("relationshipPartnerId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(String::from);
        let partner = match partner_id.filter(|_| full) {
            Some(pid) => db::first(
                db,
                &format!("SELECT {SMALL_USER} FROM `User` WHERE id = ?"),
                params![pid.as_str()],
            )
            .await?
            .map(|r| small_user(&r))
            .transpose()?
            .unwrap_or(Value::Null),
            None => Value::Null,
        };

        let birthday = if full {
            let bd: Option<Option<chrono::NaiveDateTime>> =
                db::scalar(db, "SELECT birthDate FROM `User` WHERE id = ?", params![id.as_str()])
                    .await?;
            let today = chrono::Utc::now().date_naive();
            bd.flatten()
                .is_some_and(|d| d.day() == today.day() && d.month() == today.month())
        } else {
            false
        };

        let badges = if full {
            let rows = db::all(
                db,
                "SELECT b.*, ub.awardedAt AS __awardedAt FROM UserBadge ub JOIN Badge b ON b.id = ub.badgeId WHERE ub.userId = ? ORDER BY b.priority ASC",
                params![id.as_str()],
            )
            .await?;
            rows.into_iter()
                .map(|r| {
                    let mut b = row("Badge", r);
                    let at = b.shift_remove("__awardedAt").unwrap_or(Value::Null);
                    b.insert("awardedAt".into(), at);
                    Value::Object(b)
                })
                .collect::<Vec<_>>()
        } else {
            vec![]
        };

        let mutual = if full && id != me {
            mutual_friends(db, &me, &id).await?
        } else {
            vec![]
        };

        let friends_since = if id == me {
            Value::Null
        } else {
            let r = db::first(
                db,
                "SELECT acceptedAt, updatedAt, createdAt FROM Friendship WHERE status = 'ACCEPTED' AND ((requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)) LIMIT 1",
                params![me.as_str(), id.as_str(), id.as_str(), me.as_str()],
            )
            .await?;
            match r {
                Some(r) => {
                    let at: Option<chrono::NaiveDateTime> = db::get(&r, "acceptedAt")?;
                    let up: chrono::NaiveDateTime = db::get(&r, "updatedAt")?;
                    json!(db::iso(at.unwrap_or(up)))
                }
                None => Value::Null,
            }
        };

        let likes = count(db, "SELECT COUNT(*) FROM ProfileVote WHERE toUserId = ? AND value = 1", params![id.as_str()]).await?;
        let dislikes = count(db, "SELECT COUNT(*) FROM ProfileVote WHERE toUserId = ? AND value = -1", params![id.as_str()]).await?;
        let my_vote: Option<i64> = db::scalar(
            db,
            "SELECT value FROM ProfileVote WHERE fromUserId = ? AND toUserId = ?",
            params![me.as_str(), id.as_str()],
        )
        .await?;
        let post_ups = count(
            db,
            "SELECT COUNT(*) FROM PostVote v JOIN Post p ON p.id = v.postId WHERE v.value = 1 AND p.authorId = ?",
            params![id.as_str()],
        )
        .await?;
        let comment_ups = count(
            db,
            "SELECT COUNT(*) FROM PostCommentVote v JOIN PostComment c ON c.id = v.commentId WHERE v.value = 1 AND c.authorId = ?",
            params![id.as_str()],
        )
        .await?;

        let (shown, shown_mini) = if full {
            shown_achievements(
                db,
                user.get("displayedAchievements").unwrap_or(&Value::Null),
                user.get("displayedAchievementsMini").unwrap_or(&Value::Null),
            )
            .await
        } else {
            (vec![], vec![])
        };

        let progress = level_progress(
            user.get("accountLevel").and_then(Value::as_i64).unwrap_or(1),
            user.get("accountXp").and_then(Value::as_i64).unwrap_or(0),
        );

        let activity = if has_activity_access(db, &me, &id).await? {
            let raw = state
                .cache
                .get_raw(&format!("activity:{id}"))
                .await
                .ok_or_else(|| anyhow::anyhow!("redis indisponível"))?;
            match raw.filter(|t| !t.is_empty()) {
                Some(t) => js::parse(&t).ok_or_else(|| anyhow::anyhow!("atividade com JSON quebrado"))?,
                None => Value::Null,
            }
        } else {
            Value::Null
        };
        let featured_item = if full {
            featured(db, &id, &me).await.unwrap_or(Value::Null)
        } else {
            Value::Null
        };

        // `clearIfExpired`: status personalizado vencido some (e é limpo no banco)
        let expired = user
            .get("customStatusExpiresAt")
            .and_then(Value::as_str)
            .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
            .is_some_and(|t| t <= chrono::Utc::now());
        if expired {
            for k in ["customStatus", "customStatusEmoji", "customStatusExpiresAt"] {
                if let Some(v) = user.get_mut(k) {
                    *v = Value::Null;
                }
            }
            let db = db.clone();
            let target = id.clone();
            tokio::spawn(async move {
                let _ = db::exec(
                    &db,
                    "UPDATE `User` SET customStatus = NULL, customStatusEmoji = NULL, customStatusExpiresAt = NULL, updatedAt = ? WHERE id = ?",
                    params![db::now(), target.as_str()],
                )
                .await;
            });
        }

        Ok(reply(
            &c,
            json!({
                "user": user,
                "badges": badges,
                "mutualFriends": mutual,
                "likeCount": likes,
                "dislikeCount": dislikes,
                "myVote": my_vote.unwrap_or(0),
                "levelProgress": progress,
                "totalUps": likes + post_ups + comment_ups,
                "displayedAchievements": shown,
                "displayedAchievementsMini": shown_mini,
                "activity": activity,
                "relationshipPartner": partner,
                "isBirthdayToday": birthday,
                "featuredItem": featured_item,
                "friendsSince": friends_since,
                "profileRestricted": !full,
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}
