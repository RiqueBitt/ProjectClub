//! `/api/users` — preferências da própria conta, status e busca (porte de
//! parte de `userController.js`). Toda rota aqui exige login
//! (`router.use(requireAuth)` no Node).

use axum::Json;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use serde_json::{Value, json};

use crate::AppState;
use crate::auth::mask_invisible;
use crate::db::{self, Db};
use crate::node::{self, Emit};
use crate::params;
use crate::routes::ctx::{
    Ctx, err, finish, js_round, js_slice, js_string, js_to_number, js_trim, prelude_or_return, uid,
};
use crate::users;

/// `res.json(body)` com a máscara do "invisível" (`maskInvisibleResponses`).
pub(crate) fn reply(c: &Ctx, mut body: Value) -> Response {
    mask_invisible(&mut body, c.user.as_ref().map(|u| u.id.as_str()));
    Json(body).into_response()
}

/// `prisma.user.update({ where: { id }, data, select: SELF_USER_FIELDS })`.
pub(crate) async fn update_self(
    db: &Db,
    user_id: &str,
    set_sql: &str,
    mut p: Vec<db::Value>,
) -> anyhow::Result<Value> {
    let now = db::now();
    p.push(now.into());
    p.push(user_id.into());
    db::exec(
        db,
        &format!("UPDATE `User` SET {set_sql}, updatedAt = ? WHERE id = ?"),
        p,
    )
    .await?;
    let row = db::first(db, &users::self_select_sql(), params![user_id])
        .await?
        .ok_or_else(|| anyhow::anyhow!("conta sumiu (P2025)"))?;
    Ok(Value::Object(users::self_user(&row)?))
}

/// `broadcastUserUpdate`: a versão completa vai pras abas da própria pessoa
/// e a pública (sem e-mail/2FA) pro resto da comunidade.
pub(crate) fn user_update_emits(user: &Value) -> Vec<Emit> {
    let id = user["id"].as_str().unwrap_or_default().to_string();
    let mut public = user.clone();
    if let Value::Object(m) = &mut public {
        for k in ["email", "emailVerified", "twoFactorEnabled"] {
            m.shift_remove(k);
        }
    }
    let room = format!("user:{id}");
    vec![
        Emit::to(&[&room], "user:update", user.clone()),
        Emit::to(&["community"], "user:update", public).except(&[&room]),
    ]
}

fn one_of(body: &Value, key: &str, allowed: &[&str]) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|v| allowed.contains(v))
        .map(String::from)
}

macro_rules! simple_setter {
    ($name:ident, $key:literal, $allowed:expr, $msg:literal, $set:literal) => {
        pub async fn $name(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
            let c = prelude_or_return!(state, parts, body, true, None);
            let out = async {
                let Some(v) = one_of(&c.body, $key, $allowed) else {
                    return Ok(err(StatusCode::BAD_REQUEST, $msg));
                };
                let user = update_self(&c.db, uid(&c), $set, params![v.as_str()]).await?;
                Ok(reply(&c, json!({ "user": user })))
            }
            .await;
            finish(out, c.counted)
        }
    };
}

simple_setter!(
    set_theme,
    "theme",
    &["facebook", "light", "dark", "amoled", "clubpenguin"],
    "Tema inválido.",
    "preferredTheme = ?"
);
// layoutVersion 2: a pessoa já escolheu na versão atual dos layouts
simple_setter!(
    set_layout_style,
    "layoutStyle",
    &["normal2", "normal", "discord"],
    "Layout inválido.",
    "layoutStyle = ?, layoutVersion = 2"
);
simple_setter!(
    set_emoji_style,
    "emojiStyle",
    &["native", "twemoji", "noto", "fluent", "openmoji"],
    "Estilo de emoji inválido.",
    "emojiStyle = ?"
);

/// `PATCH /me/chat-zoom { zoom }` — 1.0 a 2.0, uma casa.
pub async fn set_chat_zoom(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let v = js_to_number(c.body.get("zoom"));
        if !v.is_finite() || !(1.0..=2.0).contains(&v) {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "O zoom precisa estar entre 1.0 e 2.0.",
            ));
        }
        let rounded = js_round(v * 10.0) / 10.0;
        let user = update_self(&c.db, uid(&c), "chatZoom = ?", params![rounded]).await?;
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /me/interface-zoom { zoom }` — 50% a 200%, passos de 1%.
pub async fn set_interface_zoom(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let v = js_to_number(c.body.get("zoom"));
        if !v.is_finite() || !(0.5..=2.0).contains(&v) {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "O zoom precisa estar entre 50% e 200%.",
            ));
        }
        let rounded = js_round(v * 100.0) / 100.0;
        let user = update_self(&c.db, uid(&c), "interfaceZoom = ?", params![rounded]).await?;
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /me/status { status }`.
pub async fn set_status(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let Some(status) = one_of(&c.body, "status", &["ONLINE", "IDLE", "DND", "INVISIBLE"])
        else {
            return Ok(err(StatusCode::BAD_REQUEST, "Status inválido."));
        };
        let user = update_self(&c.db, uid(&c), "status = ?", params![status.as_str()]).await?;
        // escolha manual sempre vence o que o "ausente por inatividade" decidiu
        node::realtime(&state, vec![], Some((user.clone(), Some(status.as_str()))));
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `new Date(x)` pro horário do status (número = ms; texto no formato ISO).
fn js_date(v: &Value) -> Option<DateTime<Utc>> {
    match v {
        Value::Number(n) => {
            let ms = n.as_f64()?;
            if !ms.is_finite() || ms.abs() > 8.64e15 {
                return None;
            }
            DateTime::from_timestamp_millis(ms.trunc() as i64)
        }
        Value::Bool(b) => DateTime::from_timestamp_millis(i64::from(*b)),
        Value::String(s) => {
            let s = js_trim(s);
            if let Ok(d) = DateTime::parse_from_rfc3339(s) {
                return Some(d.with_timezone(&Utc));
            }
            // só a data = meia-noite UTC; data e hora sem fuso = hora local
            // do servidor (UTC no container)
            if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                return Some(d.and_hms_opt(0, 0, 0)?.and_utc());
            }
            for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
                if let Ok(d) = NaiveDateTime::parse_from_str(s, f) {
                    return Some(d.and_utc());
                }
            }
            None
        }
        _ => None,
    }
}

const MAX_STATUS_MS: i64 = 8 * 24 * 60 * 60 * 1000;
const MAX_DURATION_MIN: f64 = 7.0 * 24.0 * 60.0;

/// `computeStatusExpiry({ durationMinutes, expiresAt })`.
fn status_expiry(body: &Value) -> Result<Option<NaiveDateTime>, &'static str> {
    let now = Utc::now();
    let at = body.get("expiresAt");
    if let Some(at) = at.filter(|v| !v.is_null() && v.as_str() != Some("")) {
        let Some(at) = js_date(at) else {
            return Err("Data de expiração inválida.");
        };
        if at <= now {
            return Err("A expiração precisa ser no futuro.");
        }
        if (at - now).num_milliseconds() > MAX_STATUS_MS {
            return Err("A expiração pode ser de no máximo 7 dias.");
        }
        return Ok(Some(at.naive_utc()));
    }
    let d = body.get("durationMinutes");
    let empty = match d {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.is_empty() || s == "0",
        Some(Value::Number(n)) => n.as_f64() == Some(0.0),
        _ => false,
    };
    if empty {
        return Ok(None);
    }
    let min = js_to_number(d);
    if !min.is_finite() || min <= 0.0 {
        return Err("Duração inválida.");
    }
    if min > MAX_DURATION_MIN {
        return Err("A expiração pode ser de no máximo 7 dias.");
    }
    let ms = js_round(min * 60.0 * 1000.0) as i64;
    Ok(Some((now + chrono::Duration::milliseconds(ms)).naive_utc()))
}

/// `PATCH /me/custom-status { text, emoji, durationMinutes, expiresAt }`.
pub async fn set_custom_status(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let text = js_slice(js_trim(&js_string(c.body.get("text"))), 128);
        let emoji = js_slice(js_trim(&js_string(c.body.get("emoji"))), 32);
        let expiry = match status_expiry(&c.body) {
            Ok(e) => e,
            Err(msg) => return Ok(err(StatusCode::BAD_REQUEST, msg)),
        };
        let empty = text.is_empty() && emoji.is_empty();
        let user = update_self(
            &c.db,
            uid(&c),
            "customStatus = ?, customStatusEmoji = ?, customStatusExpiresAt = ?",
            params![
                (!text.is_empty()).then_some(text),
                (!emoji.is_empty()).then_some(emoji),
                if empty { None } else { expiry }
            ],
        )
        .await?;
        let patch = json!({
            "id": user["id"],
            "customStatus": user["customStatus"],
            "customStatusEmoji": user["customStatusEmoji"],
            "customStatusExpiresAt": user["customStatusExpiresAt"],
        });
        // presença primeiro (como o Node), depois o `user:update`
        node::realtime(&state, vec![], Some((user.clone(), None)));
        node::realtime(&state, user_update_emits(&patch), None);
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /me/tag { active }` — mostrar (ou não) a tag da comunidade.
pub async fn set_active_tag(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let active = match c.body.get("active") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
            Some(Value::String(s)) => !s.is_empty(),
            Some(_) => true,
        };
        let user = if !active {
            update_self(&c.db, uid(&c), "tagEmoji = NULL, tagText = NULL", vec![]).await?
        } else {
            let row = db::first(
                &c.db,
                "SELECT communityTagEmoji, communityTagText FROM PlatformSettings WHERE id = 'singleton'",
                vec![],
            )
            .await?;
            let Some(row) = row else {
                return Ok(err(
                    StatusCode::BAD_REQUEST,
                    "A comunidade ainda não tem uma tag configurada.",
                ));
            };
            let emoji: Option<String> = db::get(&row, "communityTagEmoji")?;
            let text: Option<String> = db::get(&row, "communityTagText")?;
            update_self(
                &c.db,
                uid(&c),
                "tagEmoji = ?, tagText = ?",
                params![
                    emoji.filter(|e| !e.is_empty()).unwrap_or_else(|| "🏠".into()),
                    text.filter(|t| !t.is_empty()).unwrap_or_else(|| "CLUBE".into())
                ],
            )
            .await?
        };
        node::realtime(&state, user_update_emits(&user), None);
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `DELETE /me/id-card`.
pub async fn remove_id_card(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let user = update_self(
            &c.db,
            uid(&c),
            "idCardUrl = NULL, idCardFraming = NULL",
            vec![],
        )
        .await?;
        node::realtime(&state, user_update_emits(&user), None);
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

/// `LIKE '%q%'` do `contains` do Prisma no MySQL. O Prisma NÃO escapa `_`
/// nem `%` (conferido em produção: "a_" acha "D3kam"), então aqui também não.
fn like_contains(q: &str) -> String {
    format!("%{q}%")
}

fn query_one(query: Option<&str>, key: &str) -> Option<Value> {
    let vals: Vec<String> = query
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned())
                .collect()
        })
        .unwrap_or_default();
    match vals.len() {
        0 => None,
        1 => Some(Value::String(vals[0].clone())),
        _ => Some(json!(vals)),
    }
}

/// `GET /search?q=&self=1` — por ClubTag ou nome (até 20).
pub async fn search(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        // "@fulano" também vale (o @ é só o jeito de escrever a ClubTag)
        let raw = js_string(query_one(query.as_deref(), "q").as_ref());
        let q = js_trim(js_trim(&raw).trim_start_matches('@')).to_string();
        if q.encode_utf16().count() < 2 {
            return Ok(reply(&c, json!({ "users": [] })));
        }
        let include_self = query_one(query.as_deref(), "self") == Some(json!("1"));
        let like = like_contains(&q);
        let (sql, p) = if include_self {
            (
                users::public_select_sql(
                    "WHERE u.selfDeactivatedAt IS NULL AND (u.username LIKE ? OR u.displayName LIKE ?) LIMIT 20",
                ),
                params![like.as_str(), like.as_str()],
            )
        } else {
            (
                users::public_select_sql(
                    "WHERE NOT (u.id = ?) AND u.selfDeactivatedAt IS NULL AND (u.username LIKE ? OR u.displayName LIKE ?) LIMIT 20",
                ),
                params![uid(&c), like.as_str(), like.as_str()],
            )
        };
        let rows = db::all(&c.db, &sql, p).await?;
        let list = rows
            .iter()
            .map(|r| users::public_user(r).map(Value::Object))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(reply(&c, json!({ "users": list })))
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiracao_do_status() {
        assert_eq!(status_expiry(&json!({})), Ok(None));
        assert_eq!(status_expiry(&json!({ "durationMinutes": "0" })), Ok(None));
        assert_eq!(
            status_expiry(&json!({ "durationMinutes": -1 })),
            Err("Duração inválida.")
        );
        assert_eq!(
            status_expiry(&json!({ "durationMinutes": 20000 })),
            Err("A expiração pode ser de no máximo 7 dias.")
        );
        assert!(
            status_expiry(&json!({ "durationMinutes": "30" }))
                .unwrap()
                .is_some()
        );
        assert_eq!(
            status_expiry(&json!({ "expiresAt": "ontem" })),
            Err("Data de expiração inválida.")
        );
        assert_eq!(
            status_expiry(&json!({ "expiresAt": "2001-01-01T00:00:00Z" })),
            Err("A expiração precisa ser no futuro.")
        );
        let amanha = (Utc::now() + chrono::Duration::days(1)).to_rfc3339();
        assert!(
            status_expiry(&json!({ "expiresAt": amanha }))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn numero_e_arredondamento_do_js() {
        assert_eq!(js_to_number(Some(&json!("1.5"))), 1.5);
        assert_eq!(js_to_number(Some(&json!(" 2 "))), 2.0);
        assert_eq!(js_to_number(Some(&json!(""))), 0.0);
        assert!(js_to_number(Some(&json!("1,5"))).is_nan());
        assert!(js_to_number(None).is_nan());
        assert_eq!(js_to_number(Some(&json!(["1.2"]))), 1.2);
        assert_eq!(js_round(1.25 * 10.0) / 10.0, 1.3);
        assert_eq!(js_round(-0.5), 0.0);
    }

    #[test]
    fn like_como_o_prisma() {
        assert_eq!(like_contains("a_b%"), "%a_b%%");
    }
}
