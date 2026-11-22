//! Editar o próprio perfil, trocar a ClubTag, votar em perfil, escolher as
//! conquistas exibidas e denunciar perfil — porte de `updateProfile`,
//! `updateUsername`, `voteProfile`, `setDisplayedAchievements`
//! (`userController.js`) e `createProfileReport` (`reportController.js`).

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::auth::error;
use crate::db::{self, Db};
use crate::js;
use crate::node;
use crate::params;
use crate::ratelimit::Limit;
use crate::routes::ctx::{
    By, err, finish, js_round, js_slice, js_string, js_to_number, js_trim, prelude_or_return, uid,
};
use crate::routes::users::{js_date, reply, update_self_data, user_update_emits};

const VALID_NAME_FONTS: [&str; 16] = [
    "NORMAL",
    "PIXEL",
    "CARTOON",
    "MEDIEVAL",
    "HANDWRITING",
    "CREEPY",
    "FUTURISTIC",
    "SIGNATURE",
    "BOLD_CONDENSED",
    "ROUNDED",
    "CASUAL_SCRIPT",
    "RETRO_NEON",
    "URBAN",
    "ELEGANT_SERIF",
    "PLAYFUL",
    "BOLD_SCRIPT",
];
const VALID_NAME_EFFECTS: [&str; 16] = [
    "SOLID",
    "NEON",
    "GRADIENT",
    "POP",
    "SKETCH",
    "SHADOW_3D",
    "OUTLINE",
    "RAINBOW",
    "GLITCH",
    "ICE",
    "FIRE",
    "METALLIC",
    "SHINE",
    "EMBOSS",
    "DOUBLE_STROKE",
    "GOLD",
];
const VALID_STATUS_BUBBLE_COLORS: [&str; 3] = ["#000000", "#80848E", "#FFFFFF"];
const VALID_SECTION_KEYS: [&str; 15] = [
    "about",
    "achievements",
    "album",
    "polls",
    "community_activity",
    "roles",
    "member_since",
    "connections",
    "mutual_friends",
    "relationship",
    "traits",
    "scraps",
    "testimonials",
    "visitors",
    "featured_modpack",
];
const PENGUIN_COLORS: [&str; 8] = [
    "blue", "red", "green", "yellow", "pink", "purple", "orange", "black",
];

/// Número do JS como texto (`${n}`), pros valores do enquadramento.
fn js_num_text(n: f64) -> String {
    match db::js_number(n) {
        Value::Number(m) => m.to_string(),
        other => other.to_string(),
    }
}

/// `sanitizeBannerFraming`: "x,y,zoom" (x/y 0–100, zoom 1–4) ou null.
pub fn sanitize_banner_framing(raw: &Value) -> Value {
    if raw.is_null() || raw.as_str() == Some("") {
        return Value::Null;
    }
    // `String(raw)`: "false"/"0" (que o js_string deixa vazio) também não
    // formam "x,y,zoom" — dá null do mesmo jeito
    let text = js_string(Some(raw));
    let parts: Vec<f64> = text
        .split(',')
        .map(|p| js_to_number(Some(&json!(p))))
        .collect();
    if parts.len() != 3 || parts.iter().any(|n| !n.is_finite()) {
        return Value::Null;
    }
    let (x, y, zoom) = (parts[0], parts[1], parts[2]);
    if !(0.0..=100.0).contains(&x) || !(0.0..=100.0).contains(&y) || !(1.0..=4.0).contains(&zoom) {
        return Value::Null;
    }
    json!(format!(
        "{},{},{}",
        js_num_text(js_round(x * 10.0) / 10.0),
        js_num_text(js_round(y * 10.0) / 10.0),
        js_num_text(js_round(zoom * 100.0) / 100.0)
    ))
}

/// `sanitizeProfileShowcase`: até 4 jogos `{ gameKey, name, steamAppId?, iconUrl? }`.
pub fn sanitize_profile_showcase(raw: &Value) -> Value {
    let v = match raw {
        Value::String(s) => match js::parse(s) {
            Some(v) => v,
            None => return Value::Null,
        },
        other => other.clone(),
    };
    let Some(o) = v.as_object() else {
        return Value::Null;
    };
    let games = o
        .get("games")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();
    for g in games.iter().take(4) {
        if let Some(g) = clean_game(g, 64, 100)
            && !out.iter().any(|x| x["gameKey"] == g["gameKey"])
        {
            out.push(g);
        }
    }
    if out.is_empty() {
        Value::Null
    } else {
        json!(js::stringify(&json!({ "games": out })))
    }
}

/// Um jogo da vitrine/mural: `gameKey` e `name` obrigatórios.
pub fn clean_game(g: &Value, key_max: usize, name_max: usize) -> Option<Value> {
    let o = g.as_object()?;
    let text = |k: &str, max| {
        o.get(k)
            .and_then(Value::as_str)
            .map(|s| js_slice(js_trim(s), max))
            .unwrap_or_default()
    };
    let (key, name) = (text("gameKey", key_max), text("name", name_max));
    if key.is_empty() || name.is_empty() {
        return None;
    }
    let mut out = Map::new();
    out.insert("gameKey".into(), json!(key));
    out.insert("name".into(), json!(name));
    if let Some(app) = o.get("steamAppId").filter(|v| !v.is_null()) {
        let s = match app {
            Value::String(s) => s.clone(),
            Value::Number(n) => match n.as_f64().map(db::js_number) {
                Some(Value::Number(m)) => m.to_string(),
                _ => n.to_string(),
            },
            other => js_string(Some(other)),
        };
        if (1..=12).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()) {
            out.insert("steamAppId".into(), json!(s));
        }
    }
    if let Some(icon) = o.get("iconUrl").and_then(Value::as_str) {
        let lower = icon.to_ascii_lowercase();
        if icon.encode_utf16().count() <= 500
            && (lower.starts_with("http://")
                || lower.starts_with("https://")
                || icon.starts_with('/'))
        {
            out.insert("iconUrl".into(), json!(icon));
        }
    }
    Some(Value::Object(out))
}

/// O que o Prisma aceita pra um campo de texto (`String` ou `String?`).
fn prisma_text(key: &str, v: &Value, nullable: bool) -> anyhow::Result<db::Value> {
    match v {
        Value::String(s) => Ok(s.as_str().into()),
        Value::Null if nullable => Ok(db::Value::NULL),
        _ => anyhow::bail!("{key}: tipo inválido (validação do Prisma)"),
    }
}

fn is_section_order(text: &str) -> bool {
    let Some(Value::Array(items)) = js::parse(text) else {
        return false;
    };
    items.iter().all(|item| match item {
        Value::String(s) => VALID_SECTION_KEYS.contains(&s.as_str()),
        Value::Object(o) => {
            o.get("key")
                .and_then(Value::as_str)
                .is_some_and(|k| VALID_SECTION_KEYS.contains(&k))
                && o.get("hidden").is_some_and(Value::is_boolean)
        }
        _ => false,
    })
}

/// `PATCH /me` — editar o perfil.
pub async fn update_profile(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let b = &c.body;
        let get = |k: &str| b.get(k);
        let mut data: Vec<(String, db::Value)> = Vec::new();
        let mut touched: Vec<&str> = Vec::new();
        let set = |data: &mut Vec<(String, db::Value)>, k: &str, v: db::Value| {
            data.retain(|(x, _)| x != k);
            data.push((k.to_string(), v));
        };

        // campos copiados como vieram (o Prisma confere o tipo)
        for (k, nullable) in [
            ("displayName", false),
            ("bio", true),
            ("pronouns", true),
            ("customStatus", true),
            ("profileColor", false),
            ("levelBarColor", true),
        ] {
            if let Some(v) = get(k) {
                set(&mut data, k, prisma_text(k, v, nullable)?);
                touched.push(k);
            }
        }
        // ordem das seções: só lista válida (texto JSON)
        if let Some(v) = get("profileSectionOrder")
            && let Some(text) = v.as_str()
            && is_section_order(text)
        {
            set(&mut data, "profileSectionOrder", text.into());
        }

        if let Some(v) = get("birthDate") {
            if v.is_null() || v.as_str() == Some("") {
                set(&mut data, "birthDate", db::Value::NULL);
            } else if let Some(d) = js_date(v) {
                set(&mut data, "birthDate", d.naive_utc().into());
            }
        }
        if let Some(v) = get("profileSectionOpacity") {
            let n = js_to_number(Some(v));
            if n.is_finite() && n.fract() == 0.0 && (0.0..=100.0).contains(&n) {
                set(&mut data, "profileSectionOpacity", (n as i64).into());
            }
        }

        let colors = [
            "miniProfileColor",
            "miniProfileButtonColor",
            "profileNameColor",
            "profileNameColor2",
            "profileNameColors",
        ];
        if get("profileColor").is_some() || colors.iter().any(|k| get(k).is_some()) {
            let raw: Option<Option<String>> = db::scalar(
                &c.db,
                "SELECT disabledSystems FROM PlatformSettings WHERE id = 'singleton'",
                vec![],
            )
            .await?;
            let disabled = raw
                .flatten()
                .filter(|t| !t.is_empty())
                .and_then(|t| js::parse(&t))
                .unwrap_or_else(|| json!([]));
            // `disabled.includes(...)`: lista ou texto; outra coisa quebra no Node (500)
            let off = match &disabled {
                Value::Array(a) => a.iter().any(|x| x == "cores_perfil"),
                Value::String(s) => s.contains("cores_perfil"),
                _ => anyhow::bail!("disabledSystems sem .includes"),
            };
            if off {
                data.retain(|(k, _)| k != "profileColor");
                touched.retain(|k| *k != "profileColor");
            } else {
                for (k, nullable) in [
                    ("miniProfileColor", true),
                    ("miniProfileButtonColor", true),
                    ("profileNameColor", false),
                    ("profileNameColor2", false),
                ] {
                    if let Some(v) = get(k) {
                        set(&mut data, k, prisma_text(k, v, nullable)?);
                    }
                }
                if let Some(v) = get("profileNameColors") {
                    if v.is_null() || v.as_str() == Some("") {
                        set(&mut data, "profileNameColors", db::Value::NULL);
                    } else if let Some(Value::Array(list)) = v.as_str().and_then(js::parse) {
                        let ok = list.len() <= 8
                            && list.iter().all(|c| {
                                c.as_str().is_some_and(|s| {
                                    s.len() == 7
                                        && s.starts_with('#')
                                        && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
                                })
                            });
                        if ok {
                            set(
                                &mut data,
                                "profileNameColors",
                                js::stringify(&Value::Array(list)).into(),
                            );
                        }
                    }
                }
            }
        }
        if let Some(v) = get("statusBubbleColor") {
            if v.is_null() || v.as_str() == Some("") {
                set(&mut data, "statusBubbleColor", db::Value::NULL);
            } else if let Some(s) = v
                .as_str()
                .filter(|s| VALID_STATUS_BUBBLE_COLORS.contains(s))
            {
                set(&mut data, "statusBubbleColor", s.into());
            }
        }
        if let Some(s) = get("profileNameFont")
            .and_then(Value::as_str)
            .filter(|s| VALID_NAME_FONTS.contains(s))
        {
            set(&mut data, "profileNameFont", s.into());
        }
        if let Some(s) = get("profileNameEffect")
            .and_then(Value::as_str)
            .filter(|s| VALID_NAME_EFFECTS.contains(s))
        {
            set(&mut data, "profileNameEffect", s.into());
        }
        if let Some(v) = get("avatarUrl") {
            let raw = js_string(Some(v));
            if raw
                .strip_prefix("penguin:")
                .is_some_and(|c| PENGUIN_COLORS.contains(&c))
            {
                set(&mut data, "avatarUrl", raw.as_str().into());
            } else if raw.is_empty() {
                set(&mut data, "avatarUrl", db::Value::NULL);
            }
        }
        for k in ["youtubeUrl", "steamUrl", "robloxUrl", "xUrl"] {
            let Some(v) = get(k) else { continue };
            // `(v || '').trim()`: valor "verdadeiro" que não é texto quebra (500)
            let raw = match v {
                Value::String(s) => js_trim(s).to_string(),
                other if js_string(Some(other)).is_empty() || other.is_null() => String::new(),
                _ => anyhow::bail!("{k}: .trim de não-texto"),
            };
            if raw.is_empty() {
                set(&mut data, k, db::Value::NULL);
                continue;
            }
            let lower = raw.to_ascii_lowercase();
            let url = if lower.starts_with("http://") || lower.starts_with("https://") {
                raw
            } else {
                format!("https://{raw}")
            };
            set(&mut data, k, url.as_str().into());
        }
        if let Some(s) = get("friendRequestPrivacy")
            .and_then(Value::as_str)
            .filter(|s| ["EVERYONE", "FRIENDS_OF_FRIENDS", "NOBODY"].contains(s))
        {
            set(&mut data, "friendRequestPrivacy", s.into());
        }
        if let Some(v) = get("customStatusEmoji") {
            let t = js_string(Some(v));
            set(
                &mut data,
                "customStatusEmoji",
                if t.is_empty() {
                    db::Value::NULL
                } else {
                    js_slice(&t, 32).as_str().into()
                },
            );
        }
        for k in ["bannerFraming", "miniProfileBannerFraming", "idCardFraming"] {
            if let Some(v) = get(k) {
                set(
                    &mut data,
                    k,
                    crate::prisma_json::param(&sanitize_banner_framing(v)),
                );
            }
        }
        if let Some(v) = get("profileShowcase") {
            set(
                &mut data,
                "profileShowcase",
                crate::prisma_json::param(&sanitize_profile_showcase(v)),
            );
            touched.push("profileShowcase");
        }

        let user = update_self_data(&c.db, uid(&c), data).await?;
        node::realtime(&state, user_update_emits(&user), None);
        if [
            "bio",
            "pronouns",
            "displayName",
            "profileShowcase",
            "profileColor",
        ]
        .iter()
        .any(|k| touched.contains(k))
        {
            node::after(&state, &[("profileChanged", uid(&c))]);
        }
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- ClubTag

const RESERVED: &[&str] = &[
    "admin",
    "administrador",
    "administrator",
    "adm",
    "staff",
    "equipe",
    "team",
    "projectclub",
    "pc",
    "oficial",
    "official",
    "moderador",
    "moderadora",
    "moderator",
    "mod",
    "mods",
    "suporte",
    "support",
    "ajuda",
    "help",
    "sistema",
    "system",
    "root",
    "owner",
    "dono",
    "dona",
    "bot",
    "automod",
    "everyone",
    "here",
    "todos",
    "null",
    "undefined",
    "anonimo",
    "anonymous",
];
const USERNAME_COOLDOWN_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// `validateUsername` (`utils/usernameRules.js`).
pub fn validate_username(v: &Value) -> Option<&'static str> {
    let Some(name) = v.as_str() else {
        return Some("A ClubTag deve ter de 3 a 32 caracteres: letras, números, _ ou ponto.");
    };
    let ok = (3..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.');
    if !ok {
        return Some("A ClubTag deve ter de 3 a 32 caracteres: letras, números, _ ou ponto.");
    }
    let n: String = name
        .to_lowercase()
        .chars()
        .filter(|c| *c != '.' && *c != '_')
        .collect();
    if RESERVED.contains(&n.as_str()) || n.contains("projectclub") {
        return Some("Essa ClubTag é reservada. Escolha outra.");
    }
    None
}

/// `toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })`.
fn pt_br_sp(at: chrono::DateTime<chrono::Utc>) -> String {
    at.with_timezone(&chrono_tz::America::Sao_Paulo)
        .format("%d/%m/%Y, %H:%M:%S")
        .to_string()
}

/// `PATCH /me/username { username }`.
pub async fn update_username(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let raw = c.body.get("username").cloned().unwrap_or(Value::Null);
        let username = match &raw {
            Value::String(s) => json!(js_trim(s)),
            other => other.clone(),
        };
        if let Some(msg) = validate_username(&username) {
            return Ok(err(StatusCode::BAD_REQUEST, msg));
        }
        let username = username.as_str().unwrap_or_default().to_string();
        let me = db::first(
            &c.db,
            "SELECT username, usernameChangedAt FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("conta sumiu"))?;
        let current: String = db::get(&me, "username")?;
        if username == current {
            return Ok(err(StatusCode::BAD_REQUEST, "Essa já é a sua ClubTag."));
        }
        let changed: Option<chrono::NaiveDateTime> = db::get(&me, "usernameChangedAt")?;
        if let Some(last) = changed {
            let last = last.and_utc();
            let since = (chrono::Utc::now() - last).num_milliseconds();
            if last.timestamp_millis() != 0 && since < USERNAME_COOLDOWN_MS {
                let retry = last + chrono::Duration::milliseconds(USERNAME_COOLDOWN_MS);
                return Ok(error(
                    StatusCode::TOO_MANY_REQUESTS,
                    json!({
                        "error": format!("Você só pode trocar sua ClubTag uma vez a cada 7 dias. Próxima troca liberada em {}.", pt_br_sp(retry)),
                        "retryAt": db::iso(retry.naive_utc()),
                    }),
                ));
            }
        }
        let taken: Option<String> = db::scalar(
            &c.db,
            "SELECT id FROM `User` WHERE username = ? AND NOT (id = ?) LIMIT 1",
            params![username.as_str(), uid(&c)],
        )
        .await?;
        if taken.is_some() {
            return Ok(err(StatusCode::CONFLICT, "Nome de usuário já em uso."));
        }
        let user = update_self_data(
            &c.db,
            uid(&c),
            vec![
                ("username".into(), username.as_str().into()),
                ("usernameChangedAt".into(), db::now().into()),
            ],
        )
        .await?;
        node::realtime(&state, user_update_emits(&user), None);
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- votos e conquistas

async fn vote_counts(db: &Db, target: &str) -> db::DbResult<(i64, i64)> {
    let up: Option<i64> = db::scalar(
        db,
        "SELECT COUNT(*) FROM ProfileVote WHERE toUserId = ? AND value = 1",
        params![target],
    )
    .await?;
    let down: Option<i64> = db::scalar(
        db,
        "SELECT COUNT(*) FROM ProfileVote WHERE toUserId = ? AND value = -1",
        params![target],
    )
    .await?;
    Ok((up.unwrap_or(0), down.unwrap_or(0)))
}

/// `POST /{id}/vote { value: 1 | -1 }` — votar de novo no mesmo tira o voto.
pub async fn vote_profile(
    State(state): State<AppState>,
    Path(target): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        if target == uid(&c) {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "Você não pode votar no seu próprio perfil.",
            ));
        }
        let value = c.body.get("value");
        let value = match value {
            Some(v) if js::is_num(v, 1.0) => 1i64,
            Some(v) if js::is_num(v, -1.0) => -1,
            _ => return Ok(err(StatusCode::BAD_REQUEST, "Valor de voto inválido.")),
        };
        let exists: Option<String> =
            db::scalar(&c.db, "SELECT id FROM `User` WHERE id = ?", params![target.as_str()])
                .await?;
        if exists.is_none() {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        }
        let current = db::first(
            &c.db,
            "SELECT id, value FROM ProfileVote WHERE fromUserId = ? AND toUserId = ?",
            params![uid(&c), target.as_str()],
        )
        .await?;
        let mut my_vote = value;
        match current {
            Some(r) if db::get::<i64>(&r, "value")? == value => {
                let id: String = db::get(&r, "id")?;
                let n = db::exec(&c.db, "DELETE FROM ProfileVote WHERE id = ?", params![id.as_str()])
                    .await?;
                if n == 0 {
                    anyhow::bail!("voto sumiu (P2025)");
                }
                my_vote = 0;
            }
            Some(_) => {
                db::exec(
                    &c.db,
                    "UPDATE ProfileVote SET value = ? WHERE fromUserId = ? AND toUserId = ?",
                    params![value, uid(&c), target.as_str()],
                )
                .await?;
            }
            None => {
                let r = db::exec(
                    &c.db,
                    "INSERT INTO ProfileVote (id, fromUserId, toUserId, value, createdAt) VALUES (?, ?, ?, ?, ?)",
                    params![db::new_id(), uid(&c), target.as_str(), value, db::now()],
                )
                .await;
                match r {
                    Ok(_) => {}
                    Err(e) if db::is_unique_violation(&e) => {
                        db::exec(
                            &c.db,
                            "UPDATE ProfileVote SET value = ? WHERE fromUserId = ? AND toUserId = ?",
                            params![value, uid(&c), target.as_str()],
                        )
                        .await?;
                    }
                    Err(e) => return Err(e.into()),
                }
            }
        }
        let (likes, dislikes) = vote_counts(&c.db, &target).await?;
        node::after(&state, &[("ups", target.as_str()), ("achievements", target.as_str())]);
        Ok(reply(
            &c,
            json!({ "likeCount": likes, "dislikeCount": dislikes, "myVote": my_vote }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /me/displayed-achievements { slot: 'profile' | 'mini', achievementIds }`.
pub async fn set_displayed_achievements(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let slot = c.body.get("slot").and_then(Value::as_str);
        let Some(slot) = slot.filter(|s| *s == "profile" || *s == "mini") else {
            return Ok(err(StatusCode::BAD_REQUEST, "Slot inválido."));
        };
        let Some(ids) = c.body.get("achievementIds").and_then(Value::as_array) else {
            return Ok(err(StatusCode::BAD_REQUEST, "Lista inválida."));
        };
        let limit = if slot == "profile" { 6 } else { 4 };
        if ids.len() > limit {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                &format!("Escolha no máximo {limit} conquistas."),
            ));
        }
        let unlocked: Vec<String> = db::column(
            &c.db,
            "SELECT achievementId FROM UserAchievement WHERE userId = ?",
            params![uid(&c)],
        )
        .await?;
        if ids
            .iter()
            .any(|id| !id.as_str().is_some_and(|s| unlocked.iter().any(|u| u == s)))
        {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "Você só pode exibir conquistas que já desbloqueou.",
            ));
        }
        let field = if slot == "profile" {
            "displayedAchievements"
        } else {
            "displayedAchievementsMini"
        };
        let user = update_self_data(
            &c.db,
            uid(&c),
            vec![(
                field.into(),
                js::stringify(&Value::Array(ids.clone())).into(),
            )],
        )
        .await?;
        Ok(reply(&c, json!({ "user": user })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- denúncia de perfil

/// Denúncias de perfil: 10 a cada 15 min por IP.
pub const PROFILE_REPORT: Limit = Limit {
    prefix: "profile-report",
    window_ms: 15 * 60 * 1000,
    max: 10,
    message: None,
    standard: true,
    legacy: false,
};

const REPORT_DETAILS_MAX: usize = 500;

fn category_label(c: &str) -> Option<&'static str> {
    Some(match c {
        "spam" => "Spam",
        "harassment" => "Assédio ou ódio",
        "nsfw" => "Conteúdo impróprio/NSFW",
        "scam" => "Golpe ou phishing",
        "impersonation" => "Se passando por alguém",
        "other" => "Outro",
        _ => return None,
    })
}

/// `parseReportInput`: `{ category, reason }` ou a mensagem de erro.
pub fn parse_report_input(b: &Value) -> Result<(String, String), String> {
    let details_v = b.get("details");
    if details_v.is_some_and(|d| !d.is_string()) {
        return Err("Detalhes inválidos.".into());
    }
    let mut details = details_v
        .and_then(Value::as_str)
        .map(|d| {
            let mut out = String::new();
            let mut ws = false;
            for ch in d.chars() {
                if ch.is_whitespace() || ch == '\u{feff}' {
                    ws = true;
                } else {
                    if ws {
                        out.push(' ');
                    }
                    ws = false;
                    out.push(ch);
                }
            }
            if ws {
                out.push(' ');
            }
            js_trim(&out).to_string()
        })
        .unwrap_or_default();
    if details.encode_utf16().count() > REPORT_DETAILS_MAX {
        return Err(format!(
            "Os detalhes podem ter no máximo {REPORT_DETAILS_MAX} caracteres."
        ));
    }
    let category = if let Some(c) = b.get("category") {
        match c.as_str().filter(|c| category_label(c).is_some()) {
            Some(c) => c.to_string(),
            None => return Err("Motivo de denúncia inválido.".into()),
        }
    } else if let Some(legacy) = b
        .get("reason")
        .and_then(Value::as_str)
        .map(js_trim)
        .filter(|r| !r.is_empty())
    {
        let known = match legacy.to_lowercase().as_str() {
            "spam" => Some("spam"),
            "assédio ou bullying" => Some("harassment"),
            "conteúdo impróprio no perfil" => Some("nsfw"),
            "perfil falso / se passando por outra pessoa" => Some("impersonation"),
            "outro" => Some("other"),
            _ => None,
        };
        match known {
            Some(k) => k.to_string(),
            None => {
                let parts: Vec<String> = [js_slice(legacy, REPORT_DETAILS_MAX), details.clone()]
                    .into_iter()
                    .filter(|p| !p.is_empty())
                    .collect();
                details = js_slice(&parts.join(" — "), REPORT_DETAILS_MAX);
                "other".to_string()
            }
        }
    } else {
        return Err("Escolha o motivo da denúncia.".into());
    };
    if category == "other" && details.is_empty() {
        return Err("Conte o que aconteceu para a equipe entender a denúncia.".into());
    }
    let label = category_label(&category).unwrap_or("Outro");
    let reason = if details.is_empty() {
        label.to_string()
    } else {
        format!("{label}: {details}")
    };
    Ok((category, reason))
}

/// `POST /{id}/report` — denunciar o perfil de alguém.
pub async fn report_profile(
    State(state): State<AppState>,
    Path(target): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&PROFILE_REPORT, By::Ip)));
    let out = async {
        let (category, reason) = match parse_report_input(&c.body) {
            Ok(p) => p,
            Err(msg) => return Ok(err(StatusCode::BAD_REQUEST, &msg)),
        };
        if target == uid(&c) {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                "Você não pode denunciar seu próprio perfil.",
            ));
        }
        let Some(t) = db::first(
            &c.db,
            "SELECT username, displayName, bio, pronouns FROM `User` WHERE id = ?",
            params![target.as_str()],
        )
        .await?
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        };
        let existing = db::first(
            &c.db,
            "SELECT id, status FROM Report WHERE kind = 'PROFILE' AND reportedUserId = ? AND reporterId = ? AND status = 'PENDING' LIMIT 1",
            params![target.as_str(), uid(&c)],
        )
        .await?;
        if let Some(r) = existing {
            return Ok(reply(
                &c,
                json!({
                    "report": { "id": db::get::<String>(&r, "id")?, "status": db::get::<String>(&r, "status")? },
                    "alreadyReported": true,
                }),
            ));
        }
        let username: String = db::get(&t, "username")?;
        let display: String = db::get(&t, "displayName")?;
        let bio: String = db::get::<Option<String>>(&t, "bio")?.unwrap_or_default();
        let pronouns: Option<String> = db::get(&t, "pronouns")?;
        let mut lines = vec![format!("Perfil: {display} (@{username})")];
        if let Some(p) = pronouns.filter(|p| !p.is_empty()) {
            lines.push(format!("Pronomes: {p}"));
        }
        if !bio.is_empty() {
            let short = if bio.encode_utf16().count() > 300 {
                format!("{}…", js_slice(&bio, 300))
            } else {
                bio.clone()
            };
            lines.push(format!("Bio: {short}"));
        }
        let id = db::new_id();
        db::exec(
            &c.db,
            "INSERT INTO Report (id, kind, reporterId, reportedUserId, category, reason, snippet, status, createdAt) VALUES (?, 'PROFILE', ?, ?, ?, ?, ?, 'PENDING', ?)",
            params![
                id.as_str(),
                uid(&c),
                target.as_str(),
                category.as_str(),
                reason.as_str(),
                lines.join("\n"),
                db::now()
            ],
        )
        .await?;
        Ok(reply(&c, json!({ "report": { "id": id, "status": "PENDING" } })))
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enquadramento_do_banner() {
        assert_eq!(
            sanitize_banner_framing(&json!("50,33.33,1.234")),
            json!("50,33.3,1.23")
        );
        assert_eq!(sanitize_banner_framing(&json!(" 1 , 2 ,3")), json!("1,2,3"));
        assert_eq!(sanitize_banner_framing(&json!("50,50,5")), Value::Null);
        assert_eq!(sanitize_banner_framing(&json!("a,b,c")), Value::Null);
        assert_eq!(sanitize_banner_framing(&json!("")), Value::Null);
        assert_eq!(sanitize_banner_framing(&json!(5)), Value::Null);
    }

    #[test]
    fn clubtag() {
        assert!(validate_username(&json!("ab")).is_some());
        assert!(validate_username(&json!("joão")).is_some());
        assert_eq!(
            validate_username(&json!("Ad.Min")),
            Some("Essa ClubTag é reservada. Escolha outra.")
        );
        assert!(validate_username(&json!("meu_projectclub")).is_some());
        assert_eq!(validate_username(&json!("rique.bitt")), None);
        assert_eq!(
            pt_br_sp("2026-11-28T00:30:05Z".parse().unwrap()),
            "27/11/2026, 21:30:05"
        );
    }

    #[test]
    fn denuncia() {
        assert_eq!(
            parse_report_input(
                &json!({ "category": "spam", "details": "  muita   coisa \n aqui " })
            ),
            Ok(("spam".into(), "Spam: muita coisa aqui".into()))
        );
        assert_eq!(
            parse_report_input(&json!({ "reason": "Assédio ou bullying" })),
            Ok(("harassment".into(), "Assédio ou ódio".into()))
        );
        assert_eq!(
            parse_report_input(&json!({ "reason": "ele me xingou" })),
            Ok(("other".into(), "Outro: ele me xingou".into()))
        );
        assert_eq!(
            parse_report_input(&json!({ "category": "other" })),
            Err("Conte o que aconteceu para a equipe entender a denúncia.".into())
        );
        assert_eq!(
            parse_report_input(&json!({})),
            Err("Escolha o motivo da denúncia.".into())
        );
        assert_eq!(
            parse_report_input(&json!({ "category": "x" })),
            Err("Motivo de denúncia inválido.".into())
        );
        assert_eq!(
            parse_report_input(&json!({ "details": 1 })),
            Err("Detalhes inválidos.".into())
        );
    }
}
