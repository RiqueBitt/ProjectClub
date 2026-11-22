//! `/api/users/me/...`: configurações, jogos, atalhos, GIFs favoritos e
//! emojis que a pessoa pode usar — porte de `settingsController.js`,
//! `gamesController.js`, `shortcutsController.js`, `gifController.js`
//! (favoritos) e `emojiController.listUsableEmojis`.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{self, Db};
use crate::js;
use crate::params;
use crate::prisma_json::{find_many, find_one, param};
use crate::routes::ctx::{err, finish, js_slice, js_trim, prelude_or_return, security_log, uid};
use crate::routes::users::reply;

fn created(res: Response) -> Response {
    let mut res = res;
    *res.status_mut() = StatusCode::CREATED;
    res
}

// ---------------------------------------------------------------- validação das configurações

fn is_str_in(v: &Value, list: &[&str]) -> bool {
    v.as_str().is_some_and(|s| list.contains(&s))
}

fn is_num_in(v: &Value, list: &[f64]) -> bool {
    list.iter().any(|n| js::is_num(v, *n))
}

fn int_in(v: &Value, min: i64, max: i64) -> bool {
    js::integer(v).is_some_and(|i| (min..=max).contains(&i))
}

fn is_hex(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
    })
}

fn is_key(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        s.encode_utf16().count() <= max
            && !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

fn short_str(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| s.encode_utf16().count() < max)
}

const SOUND_KEYS: [&str; 26] = [
    "message",
    "messageActive",
    "mention",
    "incomingCall",
    "outgoingCall",
    "mute",
    "unmute",
    "deafen",
    "undeafen",
    "join",
    "leave",
    "userJoin",
    "userLeave",
    "userMoved",
    "camOn",
    "camOff",
    "streamStart",
    "streamStop",
    "streamUserJoin",
    "streamUserLeave",
    "pttActivate",
    "pttDeactivate",
    "disconnect",
    "reconnect",
    "friendRequest",
    "notice",
];

/// `parseHHMM`: "HH:MM" de 00:00 a 23:59.
fn is_hhmm(v: &Value) -> bool {
    let Some(s) = v.as_str() else { return false };
    let b = s.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 2 || c.is_ascii_digit())
        && (b[0] < b'2' || (b[0] == b'2' && b[1] <= b'3'))
        && b[3] <= b'5'
}

/// `isValidTimeZone` (o que o `Intl.DateTimeFormat` do Node 24 aceita):
/// nome IANA (sem diferença de maiúsculas) ou deslocamento `±HH`, `±HHMM`,
/// `±HH:MM`.
pub fn is_valid_time_zone(v: &Value) -> bool {
    let Some(tz) = v.as_str() else { return false };
    if tz.is_empty() || tz.encode_utf16().count() > 64 {
        return false;
    }
    if chrono_tz::Tz::from_str_insensitive(tz).is_ok() {
        return true;
    }
    let Some(rest) = tz.strip_prefix(['+', '-']) else {
        return false;
    };
    let digits: String = rest.chars().filter(|c| *c != ':').collect();
    let colon_ok = !rest.contains(':') || (rest.len() == 5 && rest.as_bytes()[2] == b':');
    let ok_len = matches!(digits.len(), 2 | 4) && digits.bytes().all(|b| b.is_ascii_digit());
    if !ok_len || !colon_ok || (digits.len() == 2 && rest.len() != 2) {
        return false;
    }
    let h: u32 = digits[..2].parse().unwrap_or(99);
    let m: u32 = match &digits[2..] {
        "" => 0,
        m => m.parse().unwrap_or(99),
    };
    h <= 23 && m <= 59
}

fn sanitize_quiet_hours(v: &Value) -> Option<Value> {
    let o = js::as_plain(v)?;
    let enabled = o.get("enabled")?.as_bool()?;
    let (start, end) = (o.get("start")?, o.get("end")?);
    if !is_hhmm(start) || !is_hhmm(end) {
        return None;
    }
    let days = o.get("days")?.as_array()?;
    if days.len() > 7 || !days.iter().all(|d| int_in(d, 0, 6)) {
        return None;
    }
    let tz = o.get("timezone")?;
    if !is_valid_time_zone(tz) {
        return None;
    }
    // `[...new Set(days)].sort()`: sem repetição e em ordem de TEXTO (o
    // `sort()` do JS compara como string — com 0..6 dá no mesmo)
    let mut uniq: Vec<i64> = Vec::new();
    for d in days.iter().filter_map(js::integer) {
        if !uniq.contains(&d) {
            uniq.push(d);
        }
    }
    uniq.sort_by_key(|d| d.to_string());
    Some(json!({ "enabled": enabled, "start": start, "end": end, "days": uniq, "timezone": tz }))
}

/// `EXTRA_PREF_RULES[key](v)`.
fn extra_rule(key: &str, v: &Value) -> bool {
    let b = v.is_boolean();
    match key {
        "colorTheme" => v.as_str() == Some("none") || is_key(v, 24),
        "customTheme" => js::as_plain(v).is_some_and(|t| {
            t.get("colors")
                .and_then(Value::as_array)
                .is_some_and(|c| (1..=5).contains(&c.len()) && c.iter().all(is_hex))
                && t.get("angle").is_some_and(|a| int_in(a, 0, 360))
                && t.get("accent").is_some_and(is_hex)
                && t.get("mix").is_some_and(|m| int_in(m, 0, 100))
        }),
        "themeSync"
        | "cacheMessages"
        | "themeOnProfiles"
        | "weeklyDigest"
        | "streamerMode"
        | "streamerHidePersonal"
        | "streamerHideLinks"
        | "streamerMuteSounds"
        | "streamerMuteNotifs"
        | "showReactions"
        | "emoticonsToEmoji"
        | "showSendButton"
        | "stickerSuggestions"
        | "underlineLinks"
        | "gifFocusOnly"
        | "animatedEmoji"
        | "showAltText"
        | "toggleIcons"
        | "notifyFriendOnline"
        | "notifyFriendAnniversary"
        | "notifyFriendProfile"
        | "shareProfileUpdates"
        | "unreadBadge"
        | "notifyAnnouncements"
        | "notifyEvents"
        | "emailComms"
        | "emailSocial"
        | "emailUpdates"
        | "emailTips"
        | "preJoinCheck"
        | "sensitivityAuto"
        | "streamPreview"
        | "messageRequests"
        | "friendReqMessages"
        | "clipVoice"
        | "gameJoinFriends"
        | "gameJoinVoice" => b,
        "appIcon" => is_key(v, 24),
        "groupSpacing" => is_num_in(v, &[0.0, 4.0, 8.0, 16.0, 24.0]),
        "spoilers" => is_str_in(v, &["click", "always"]),
        "searchScope" => is_str_in(v, &["current", "all"]),
        "minToastSec" => is_num_in(v, &[0.0, 3.0, 5.0, 10.0, 15.0, 20.0]),
        "stickerAnim" => is_str_in(v, &["always", "hover", "never"]),
        "ttsRate" => v.as_f64().is_some_and(|f| (0.5..=2.0).contains(&f)),
        "notifyReactions" => is_str_in(v, &["all", "dm", "none"]),
        "soundPack" => is_str_in(
            v,
            &["auto", "classic", "halloween", "natal", "retro", "suave"],
        ),
        "soundsOff" => v.as_array().is_some_and(|a| {
            a.len() <= 40
                && a.iter().all(|k| is_key(k, 32))
                && a.iter().all(|k| is_str_in(k, &SOUND_KEYS))
        }),
        "notifyLevel" => is_str_in(v, &["all", "mentions", "none"]),
        "quietHours" => sanitize_quiet_hours(v).is_some(),
        "inputProfile" => is_str_in(v, &["isolation", "studio", "custom"]),
        "sensitivityDb" => int_in(v, -100, 0),
        "inputVolume" => int_in(v, 0, 200),
        "joinSoundId" => v.is_null() || v.as_str().is_some_and(|s| s.encode_utf16().count() <= 64),
        "sfxVolume" => int_in(v, 0, 100),
        "spamFilter" => is_str_in(v, &["all", "strangers", "off"]),
        _ => false,
    }
}

const EXTRA_KEYS: &[&str] = &[
    "colorTheme",
    "customTheme",
    "themeSync",
    "cacheMessages",
    "themeOnProfiles",
    "appIcon",
    "weeklyDigest",
    "streamerMode",
    "streamerHidePersonal",
    "streamerHideLinks",
    "streamerMuteSounds",
    "streamerMuteNotifs",
    "groupSpacing",
    "spoilers",
    "showReactions",
    "emoticonsToEmoji",
    "showSendButton",
    "searchScope",
    "stickerSuggestions",
    "underlineLinks",
    "minToastSec",
    "stickerAnim",
    "gifFocusOnly",
    "animatedEmoji",
    "ttsRate",
    "showAltText",
    "toggleIcons",
    "notifyFriendOnline",
    "notifyFriendAnniversary",
    "notifyFriendProfile",
    "shareProfileUpdates",
    "notifyReactions",
    "soundPack",
    "soundsOff",
    "unreadBadge",
    "notifyAnnouncements",
    "notifyEvents",
    "notifyLevel",
    "quietHours",
    "emailComms",
    "emailSocial",
    "emailUpdates",
    "emailTips",
    "preJoinCheck",
    "inputProfile",
    "sensitivityAuto",
    "sensitivityDb",
    "inputVolume",
    "joinSoundId",
    "sfxVolume",
    "streamPreview",
    "spamFilter",
    "messageRequests",
    "friendReqMessages",
    "clipVoice",
    "gameJoinFriends",
    "gameJoinVoice",
];

pub fn sanitize_extra_prefs(v: &Value) -> Option<Value> {
    let o = js::as_plain(v)?;
    let mut out = Map::new();
    for key in EXTRA_KEYS {
        let Some(val) = o.get(*key) else { continue };
        if !extra_rule(key, val) {
            continue;
        }
        let kept = match *key {
            "customTheme" => json!({
                "colors": val["colors"], "angle": val["angle"], "accent": val["accent"], "mix": val["mix"],
            }),
            "quietHours" => sanitize_quiet_hours(val).unwrap_or(Value::Null),
            _ => val.clone(),
        };
        out.insert((*key).into(), kept);
    }
    Some(Value::Object(out))
}

fn layout_rule(key: &str, v: &Value) -> bool {
    match key {
        "density" => is_str_in(v, &["compact", "normal", "spacious"]),
        "corners" => is_str_in(v, &["round", "square"]),
        "sidebarWidth" => int_in(v, 200, 420),
        "fontSize" => int_in(v, 12, 20),
        "showMembers" | "seasonal" | "legibleFont" | "resumeLastPage" | "colorblindFilter"
        | "statusShapes" => v.is_boolean(),
        "animatedBg" => is_str_in(v, &["off", "gradient", "particles"]),
        "colorblind" => is_str_in(
            v,
            &[
                "none",
                "protanopia",
                "deuteranopia",
                "tritanopia",
                "achromatopsia",
            ],
        ),
        "colorblindStrength" => int_in(v, 0, 100),
        _ => false,
    }
}

const LAYOUT_KEYS: [&str; 13] = [
    "density",
    "corners",
    "sidebarWidth",
    "fontSize",
    "showMembers",
    "animatedBg",
    "seasonal",
    "legibleFont",
    "resumeLastPage",
    "colorblind",
    "colorblindStrength",
    "colorblindFilter",
    "statusShapes",
];

fn sanitize_layout_prefs(v: &Value) -> Option<Value> {
    let o = js::as_plain(v)?;
    let mut out = Map::new();
    for key in LAYOUT_KEYS {
        if let Some(val) = o.get(key).filter(|val| layout_rule(key, val)) {
            out.insert(key.into(), val.clone());
        }
    }
    Some(Value::Object(out))
}

// ---------------------------------------------------------------- volume de cada pessoa na chamada

const VOICE_MAX: usize = 500;

fn is_user_id(k: &str) -> bool {
    (1..=64).contains(&k.len())
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_volume(v: &Value) -> bool {
    int_in(v, 0, 200)
}

fn cap_entries(map: Map<String, Value>, max: usize) -> Map<String, Value> {
    if map.len() <= max {
        return map;
    }
    let skip = map.len() - max;
    map.into_iter().skip(skip).collect()
}

fn sanitize_voice_volumes(v: &Value, max: usize) -> Option<Map<String, Value>> {
    let o = js::as_plain(v)?;
    let mut out = Map::new();
    for (k, vol) in js::reorder(o.clone()) {
        if !is_user_id(&k) || !is_volume(&vol) || js::is_num(&vol, 100.0) {
            continue;
        }
        out.insert(k, vol);
    }
    Some(js::reorder(cap_entries(out, max)))
}

fn sanitize_voice_volumes_patch(v: &Value) -> Option<Map<String, Value>> {
    let o = js::as_plain(v)?;
    if o.is_empty() || o.len() > VOICE_MAX {
        return None;
    }
    let mut out = Map::new();
    for (k, vol) in js::reorder(o.clone()) {
        if !is_user_id(&k) {
            continue;
        }
        if vol.is_null() || is_volume(&vol) {
            out.insert(k, vol);
        }
    }
    (!out.is_empty()).then_some(out)
}

fn merge_voice_volumes(current: &Value, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut base = sanitize_voice_volumes(current, usize::MAX).unwrap_or_default();
    for (k, vol) in patch {
        base.shift_remove(k);
        if !vol.is_null() && !js::is_num(vol, 100.0) && is_volume(vol) && is_user_id(k) {
            base.insert(k.clone(), vol.clone());
        }
    }
    js::reorder(cap_entries(js::reorder(base), VOICE_MAX))
}

fn parse_voice_volumes(raw: &Value) -> Value {
    let parsed = raw
        .as_str()
        .filter(|s| !s.is_empty())
        .and_then(js::parse)
        .unwrap_or(Value::Null);
    Value::Object(sanitize_voice_volumes(&parsed, usize::MAX).unwrap_or_default())
}

/// `FIELD_VALIDATORS[key](value)` (`None` = campo desconhecido).
fn field_ok(key: &str, v: &Value) -> Option<bool> {
    let b = v.is_boolean();
    Some(match key {
        "language" => is_str_in(v, &["pt-BR", "en-US", "es-ES"]),
        "timezone" => v.is_null() || short_str(v, 64),
        "timeFormat" => is_str_in(v, &["12h", "24h", "auto"]),
        "messageDensity" => is_str_in(v, &["compact", "standard", "comfortable"]),
        "messageDisplay" => is_str_in(v, &["cozy", "compact"]),
        "showTimestamps"
        | "showAvatars"
        | "groupMessages"
        | "showLinkPreviews"
        | "autoPlayMedia"
        | "enterSends"
        | "spamFilterEnabled"
        | "showReadReceipts"
        | "desktopNotifications"
        | "emailNotifications"
        | "notificationSounds"
        | "reducedMotion"
        | "highContrast"
        | "noiseSuppression"
        | "echoCancellation"
        | "automaticGain"
        | "streamAudioEnabled"
        | "activitySharing"
        | "gameDetectionEnabled"
        | "overlayEnabled"
        | "overlayNotifications"
        | "startWithSystem"
        | "minimizeToTray"
        | "openLinksInApp"
        | "confirmOnExit"
        | "developerMode" => b,
        "profilePrivacy" => is_str_in(v, &["everyone", "friends_groups", "friends"]),
        "dmPrivacy" => is_str_in(v, &["everyone", "friends", "friends_groups", "none"]),
        "friendRequestPrivacy" => is_str_in(v, &["everyone", "friends_of_friends", "none"]),
        "contentFilterLevel" => is_str_in(v, &["off", "moderate", "high"]),
        "textScale" => v.as_f64().is_some_and(|f| (0.8..=1.5).contains(&f)),
        "saturation" => is_num_in(v, &[0.0, 50.0, 75.0, 100.0]),
        "inputDeviceId" | "outputDeviceId" => v.is_null() || v.is_string(),
        "inputMode" => is_str_in(v, &["voice_activity", "push_to_talk"]),
        "pushToTalkKey" => v.is_null() || short_str(v, 32),
        "inputVolume" | "outputVolume" => int_in(v, 0, 100),
        "streamQuality" => is_str_in(v, &["720p", "1080p"]),
        "streamFPS" => is_num_in(v, &[30.0, 60.0]),
        "activityVisibility" => is_str_in(v, &["everyone", "friends", "friends_groups", "none"]),
        "gameJoinPrivacy" => is_str_in(v, &["none", "friends", "friends_groups", "everyone"]),
        "gamesVisibility" => is_str_in(v, &["everyone", "friends", "nobody"]),
        "layoutPrefs" => v.is_null() || sanitize_layout_prefs(v).is_some(),
        "extraPrefs" => v.is_null() || sanitize_extra_prefs(v).is_some(),
        "voiceVolumes" => v.is_null() || sanitize_voice_volumes(v, VOICE_MAX).is_some(),
        "voiceVolumesPatch" => sanitize_voice_volumes_patch(v).is_some(),
        _ => return None,
    })
}

// ---------------------------------------------------------------- linha de UserSettings

/// `serializeSettings`: os campos de texto JSON viram objetos, no mesmo lugar.
fn serialize(mut s: Map<String, Value>) -> Value {
    let layout = s
        .get("layoutPrefs")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .and_then(js::parse)
        .unwrap_or(Value::Null);
    let extra = s
        .get("extraPrefs")
        .and_then(Value::as_str)
        .filter(|t| !t.is_empty())
        .and_then(js::parse)
        .filter(|v| {
            // `JSON.parse(raw) || {}`: falso (0, "", false, null) vira {}
            !matches!(v, Value::Null | Value::Bool(false))
                && v.as_str() != Some("")
                && !js::is_num(v, 0.0)
        })
        .unwrap_or_else(|| json!({}));
    let voice = parse_voice_volumes(s.get("voiceVolumes").unwrap_or(&Value::Null));
    for (k, v) in [
        ("layoutPrefs", layout),
        ("extraPrefs", extra),
        ("voiceVolumes", voice),
    ] {
        if let Some(slot) = s.get_mut(k) {
            *slot = v;
        }
    }
    Value::Object(s)
}

/// `safeUpsert(userSettings, { where: { userId }, update: {}, create: { userId } })`
/// — sem mexer no `updatedAt` de quem já tem.
async fn get_or_create(db: &Db, user_id: &str) -> anyhow::Result<Map<String, Value>> {
    let q = "WHERE userId = ?";
    if let Some(s) = find_one(db, "UserSettings", q, params![user_id]).await? {
        return Ok(s);
    }
    let r = db::exec(
        db,
        "INSERT INTO UserSettings (id, userId, updatedAt) VALUES (?, ?, ?)",
        params![db::new_id(), user_id, db::now()],
    )
    .await;
    if let Err(e) = r
        && !db::is_unique_violation(&e)
    {
        return Err(e.into());
    }
    find_one(db, "UserSettings", q, params![user_id])
        .await?
        .ok_or_else(|| anyhow::anyhow!("UserSettings sumiu"))
}

/// `GET /me/settings`.
pub async fn get_settings(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let s = get_or_create(&c.db, uid(&c)).await?;
        Ok(reply(&c, json!({ "settings": serialize(s) })))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /me/settings` — só os campos conhecidos e válidos; o resto volta
/// em `rejected`.
pub async fn update_settings(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        // `Object.entries(req.body || {})` (lista também tem "entradas": os índices)
        let entries: Vec<(String, Value)> = match &c.body {
            Value::Object(m) => js::reorder(m.clone()).into_iter().collect(),
            Value::Array(a) => a
                .iter()
                .enumerate()
                .map(|(i, v)| (i.to_string(), v.clone()))
                .collect(),
            _ => vec![],
        };
        let mut data: Vec<(String, Value)> = Vec::new();
        let mut rejected: Vec<String> = Vec::new();
        let mut patch: Option<Map<String, Value>> = None;
        for (key, value) in entries {
            if field_ok(&key, &value) != Some(true) {
                rejected.push(key);
                continue;
            }
            let stored = match key.as_str() {
                "layoutPrefs" if !value.is_null() => json!(js::stringify(
                    &sanitize_layout_prefs(&value).unwrap_or_default()
                )),
                "extraPrefs" if !value.is_null() => json!(js::stringify(
                    &sanitize_extra_prefs(&value).unwrap_or_default()
                )),
                "voiceVolumes" => {
                    if value.is_null() {
                        Value::Null
                    } else {
                        json!(js::stringify(&Value::Object(
                            sanitize_voice_volumes(&value, VOICE_MAX).unwrap_or_default()
                        )))
                    }
                }
                "voiceVolumesPatch" => {
                    patch = sanitize_voice_volumes_patch(&value);
                    continue;
                }
                _ => value,
            };
            data.retain(|(k, _)| *k != key);
            data.push((key, stored));
        }
        if data.is_empty() && patch.is_none() {
            return Ok(reply(
                &c,
                json!({ "error": "Nenhuma configuração válida foi enviada.", "rejected": rejected }),
            )
            .map_status(StatusCode::BAD_REQUEST));
        }
        let current = get_or_create(&c.db, uid(&c)).await?;
        if let Some(p) = &patch {
            let base = match data.iter().find(|(k, _)| k == "voiceVolumes") {
                Some((_, v)) => parse_voice_volumes(v),
                None => parse_voice_volumes(current.get("voiceVolumes").unwrap_or(&Value::Null)),
            };
            let merged = js::stringify(&Value::Object(merge_voice_volumes(&base, p)));
            data.retain(|(k, _)| k != "voiceVolumes");
            data.push(("voiceVolumes".into(), json!(merged)));
        }
        let mut sets: Vec<String> = data.iter().map(|(k, _)| format!("`{k}` = ?")).collect();
        sets.push("updatedAt = ?".into());
        let mut p: Vec<db::Value> = data.iter().map(|(_, v)| param(v)).collect();
        p.push(db::now().into());
        p.push(uid(&c).into());
        db::exec(
            &c.db,
            &format!("UPDATE UserSettings SET {} WHERE userId = ?", sets.join(", ")),
            p,
        )
        .await?;
        let s = find_one(&c.db, "UserSettings", "WHERE userId = ?", params![uid(&c)])
            .await?
            .ok_or_else(|| anyhow::anyhow!("UserSettings sumiu (P2025)"))?;
        let mut body = json!({ "settings": serialize(s) });
        if !rejected.is_empty() {
            body["rejected"] = json!(rejected);
        }
        Ok(reply(&c, body))
    }
    .await;
    finish(out, c.counted)
}

trait MapStatus {
    fn map_status(self, s: StatusCode) -> Response;
}

impl MapStatus for Response {
    fn map_status(mut self, s: StatusCode) -> Response {
        *self.status_mut() = s;
        self
    }
}

/// `POST /me/settings/reset` — apaga e recria com os padrões.
pub async fn reset_settings(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        db::exec(
            &c.db,
            "DELETE FROM UserSettings WHERE userId = ?",
            params![uid(&c)],
        )
        .await?;
        let s = get_or_create(&c.db, uid(&c)).await?;
        security_log(
            &c.db,
            uid(&c),
            "SETTINGS_RESET",
            &c.headers,
            c.ip.as_deref(),
        )
        .await;
        Ok(reply(&c, json!({ "settings": serialize(s) })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- jogos

/// `!x || typeof x !== 'string' || !x.trim()` ao contrário: o texto, se vale.
fn required_text(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !js_trim(s).is_empty())
}

pub async fn list_games(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let games = find_many(
            &c.db,
            "RegisteredGame",
            "WHERE userId = ? ORDER BY createdAt ASC",
            params![uid(&c)],
        )
        .await?;
        Ok(reply(&c, json!({ "games": games })))
    }
    .await;
    finish(out, c.counted)
}

pub async fn add_game(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let Some(key) = required_text(c.body.get("gameKey")) else {
            return Ok(err(StatusCode::BAD_REQUEST, "gameKey é obrigatório."));
        };
        let Some(name) = required_text(c.body.get("displayName")) else {
            return Ok(err(StatusCode::BAD_REQUEST, "displayName é obrigatório."));
        };
        let key = js_slice(&js_trim(key).to_lowercase(), 64);
        let exists = find_one(
            &c.db,
            "RegisteredGame",
            "WHERE userId = ? AND gameKey = ?",
            params![uid(&c), key.as_str()],
        )
        .await?;
        if exists.is_some() {
            return Ok(err(StatusCode::BAD_REQUEST, "Esse jogo já está na sua lista."));
        }
        let id = db::new_id();
        let icon = c.body.get("iconUrl").and_then(Value::as_str);
        db::exec(
            &c.db,
            "INSERT INTO RegisteredGame (id, userId, gameKey, displayName, iconUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
            params![
                id.as_str(),
                uid(&c),
                key.as_str(),
                js_slice(js_trim(name), 100),
                icon,
                db::now()
            ],
        )
        .await?;
        let game = find_one(&c.db, "RegisteredGame", "WHERE id = ?", params![id.as_str()])
            .await?
            .unwrap_or_default();
        Ok(created(reply(&c, json!({ "game": game }))))
    }
    .await;
    finish(out, c.counted)
}

pub async fn remove_game(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let n = db::exec(
            &c.db,
            "DELETE FROM RegisteredGame WHERE id = ? AND userId = ?",
            params![id.as_str(), uid(&c)],
        )
        .await?;
        if n == 0 {
            return Ok(err(StatusCode::NOT_FOUND, "Jogo não encontrado."));
        }
        Ok(reply(&c, json!({ "success": true })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- atalhos

pub async fn list_shortcuts(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let list = find_many(
            &c.db,
            "UserShortcut",
            "WHERE userId = ? ORDER BY createdAt ASC",
            params![uid(&c)],
        )
        .await?;
        Ok(reply(&c, json!({ "shortcuts": list })))
    }
    .await;
    finish(out, c.counted)
}

pub async fn set_shortcut(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let Some(action) = required_text(c.body.get("action")) else {
            return Ok(err(StatusCode::BAD_REQUEST, "action é obrigatório."));
        };
        let Some(combo) = required_text(c.body.get("keyCombination")) else {
            return Ok(err(StatusCode::BAD_REQUEST, "keyCombination é obrigatório."));
        };
        let action = js_slice(js_trim(action), 64);
        let combo = js_slice(js_trim(combo), 32);
        // a combinação não pode estar em OUTRA ação (a própria pode reatribuir)
        let conflict = find_one(
            &c.db,
            "UserShortcut",
            "WHERE userId = ? AND keyCombination = ? AND NOT (action = ?)",
            params![uid(&c), combo.as_str(), action.as_str()],
        )
        .await?;
        if conflict.is_some() {
            return Ok(err(StatusCode::BAD_REQUEST, "Este atalho já está sendo utilizado."));
        }
        let q = "WHERE userId = ? AND action = ?";
        let exists = find_one(&c.db, "UserShortcut", q, params![uid(&c), action.as_str()]).await?;
        if exists.is_some() {
            db::exec(
                &c.db,
                "UPDATE UserShortcut SET keyCombination = ? WHERE userId = ? AND action = ?",
                params![combo.as_str(), uid(&c), action.as_str()],
            )
            .await?;
        } else {
            let r = db::exec(
                &c.db,
                "INSERT INTO UserShortcut (id, userId, action, keyCombination, createdAt) VALUES (?, ?, ?, ?, ?)",
                params![db::new_id(), uid(&c), action.as_str(), combo.as_str(), db::now()],
            )
            .await;
            match r {
                Ok(_) => {}
                // outro pedido criou ao mesmo tempo: atualiza (o `safeUpsert`)
                Err(e) if db::is_unique_violation(&e) => {
                    db::exec(
                        &c.db,
                        "UPDATE UserShortcut SET keyCombination = ? WHERE userId = ? AND action = ?",
                        params![combo.as_str(), uid(&c), action.as_str()],
                    )
                    .await?;
                }
                Err(e) => return Err(e.into()),
            }
        }
        let shortcut = find_one(&c.db, "UserShortcut", q, params![uid(&c), action.as_str()])
            .await?
            .unwrap_or_default();
        Ok(reply(&c, json!({ "shortcut": shortcut })))
    }
    .await;
    finish(out, c.counted)
}

pub async fn delete_shortcut(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let n = db::exec(
            &c.db,
            "DELETE FROM UserShortcut WHERE id = ? AND userId = ?",
            params![id.as_str(), uid(&c)],
        )
        .await?;
        if n == 0 {
            return Ok(err(StatusCode::NOT_FOUND, "Atalho não encontrado."));
        }
        Ok(reply(&c, json!({ "success": true })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- GIFs favoritos

pub async fn list_gifs(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let gifs = find_many(
            &c.db,
            "FavoriteGif",
            "WHERE userId = ? ORDER BY createdAt DESC",
            params![uid(&c)],
        )
        .await?;
        Ok(reply(&c, json!({ "gifs": gifs })))
    }
    .await;
    finish(out, c.counted)
}

/// `String(x)` do valor que já se sabe "verdadeiro".
fn truthy_string(v: Option<&Value>) -> Option<String> {
    let s = crate::routes::ctx::js_string(v);
    (!s.is_empty()).then_some(s)
}

pub async fn add_gif(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let url = c.body.get("url");
        let Some(url_text) = truthy_string(url) else {
            return Ok(err(StatusCode::BAD_REQUEST, "URL do GIF é obrigatória."));
        };
        // o Prisma recusa (500) url/preview que não sejam texto
        let Some(url) = url.and_then(Value::as_str) else {
            anyhow::bail!("url não é texto (validação do Prisma)");
        };
        let key = js_slice(
            &truthy_string(c.body.get("gifId")).unwrap_or(url_text),
            300,
        );
        let preview = match c.body.get("preview") {
            Some(Value::String(p)) if !p.is_empty() => p.clone(),
            Some(v) if crate::routes::ctx::js_string(Some(v)).is_empty() || v.is_null() => {
                url.to_string()
            }
            None => url.to_string(),
            Some(_) => anyhow::bail!("preview não é texto (validação do Prisma)"),
        };
        let q = "WHERE userId = ? AND gifId = ?";
        if find_one(&c.db, "FavoriteGif", q, params![uid(&c), key.as_str()])
            .await?
            .is_none()
        {
            let r = db::exec(
                &c.db,
                "INSERT INTO FavoriteGif (id, userId, gifId, url, preview, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
                params![db::new_id(), uid(&c), key.as_str(), url, preview.as_str(), db::now()],
            )
            .await;
            if let Err(e) = r
                && !db::is_unique_violation(&e)
            {
                return Err(e.into());
            }
        }
        let gif = find_one(&c.db, "FavoriteGif", q, params![uid(&c), key.as_str()])
            .await?
            .unwrap_or_default();
        Ok(created(reply(&c, json!({ "gif": gif }))))
    }
    .await;
    finish(out, c.counted)
}

pub async fn remove_gif(
    State(state): State<AppState>,
    Path(gif_id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        db::exec(
            &c.db,
            "DELETE FROM FavoriteGif WHERE userId = ? AND gifId = ?",
            params![uid(&c), gif_id.as_str()],
        )
        .await?;
        Ok(reply(&c, json!({ "ok": true })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- emojis

/// `GET /me/usable-emojis` — os do servidor que o cargo da pessoa permite e
/// os da loja dos criadores que ela comprou ou fez.
pub async fn usable_emojis(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let emojis = find_many(&c.db, "Emoji", "ORDER BY createdAt ASC", vec![]).await?;
        let roles: Vec<String> = db::column(
            &c.db,
            "SELECT roleId FROM UserRole WHERE userId = ?",
            params![uid(&c)],
        )
        .await?;
        let roles: HashSet<String> = roles.into_iter().collect();
        let usable: Vec<Map<String, Value>> = emojis
            .into_iter()
            .filter(|e| match e.get("allowedRoleId").and_then(Value::as_str) {
                None | Some("") => true,
                Some(r) => roles.contains(r),
            })
            .collect();
        // erro aqui não derruba a lista (`.catch(() => [])` no Node)
        let shop = creator_emojis(&c.db, uid(&c)).await.unwrap_or_default();
        let taken: HashSet<String> = usable
            .iter()
            .filter_map(|e| e.get("name").and_then(Value::as_str).map(String::from))
            .collect();
        let mut list: Vec<Value> = usable.into_iter().map(Value::Object).collect();
        list.extend(
            shop.into_iter()
                .filter(|e| !e["name"].as_str().is_some_and(|n| taken.contains(n))),
        );
        Ok(reply(&c, json!({ "emojis": list })))
    }
    .await;
    finish(out, c.counted)
}

/// `usableEmojisFor` (`services/creatorShop.js`).
async fn creator_emojis(db: &Db, user_id: &str) -> db::DbResult<Vec<Value>> {
    let bought: Vec<String> = db::column(
        db,
        "SELECT itemId FROM CreatorPurchase WHERE buyerId = ?",
        params![user_id],
    )
    .await?;
    let mut sql = String::from(
        "SELECT id, name, imageUrl FROM CreatorItem WHERE kind = 'EMOJI' AND status = 'APPROVED' AND (",
    );
    let mut p: Vec<db::Value> = Vec::new();
    if !bought.is_empty() {
        sql.push_str(&format!(
            "id IN ({}) OR ",
            vec!["?"; bought.len()].join(", ")
        ));
        p.extend(bought.iter().map(|b| db::Value::from(b.as_str())));
    }
    sql.push_str("creatorId = ?) ORDER BY name ASC");
    p.push(user_id.into());
    let rows = db::all(db, &sql, p).await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let id: String = db::get(r, "id")?;
        out.push(json!({
            "id": format!("criador-{id}"),
            "name": db::get::<String>(r, "name")?,
            "url": db::get::<Option<String>>(r, "imageUrl")?,
            "category": "Loja dos criadores",
            "collectionId": null,
            "allowedRoleId": null,
            "creatorShop": true,
        }));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuso_como_o_intl() {
        for ok in [
            "America/Sao_Paulo",
            "america/sao_paulo",
            "UTC",
            "utc",
            "GMT",
            "Etc/GMT+3",
            "+03:00",
            "-0300",
            "EST",
            "Brazil/East",
            "+03",
            "+23:59",
            "-00",
            "US/Pacific",
            "etc/utc",
        ] {
            assert!(is_valid_time_zone(&json!(ok)), "{ok}");
        }
        for bad in [
            "x",
            "",
            "+3",
            "+03:0",
            "+24:00",
            "+0360",
            "Europe/Lisbon ",
            "Z",
        ] {
            assert!(!is_valid_time_zone(&json!(bad)), "{bad}");
        }
    }

    #[test]
    fn preferencias_extras() {
        let v = sanitize_extra_prefs(&json!({
            "zzz": 1, "soundPack": "retro", "ttsRate": 3, "groupSpacing": 8.0,
            "customTheme": { "colors": ["#aabbcc"], "angle": 90, "accent": "#000000", "mix": 50, "lixo": 1 },
            "quietHours": { "enabled": true, "start": "22:00", "end": "07:00", "days": [5, 1, 1], "timezone": "UTC" },
        }))
        .unwrap();
        assert_eq!(
            js::stringify(&v),
            r##"{"customTheme":{"colors":["#aabbcc"],"angle":90,"accent":"#000000","mix":50},"groupSpacing":8,"soundPack":"retro","quietHours":{"enabled":true,"start":"22:00","end":"07:00","days":[1,5],"timezone":"UTC"}}"##
        );
    }

    #[test]
    fn volumes_da_chamada() {
        let m = merge_voice_volumes(
            &json!({ "a": 50, "b": 100, "c": 300 }),
            &serde_json::from_value(json!({ "a": null, "d": 20 })).unwrap(),
        );
        assert_eq!(Value::Object(m), json!({ "d": 20 }));
        assert!(sanitize_voice_volumes_patch(&json!({})).is_none());
        assert!(sanitize_voice_volumes_patch(&json!({ "a b": 5 })).is_none());
    }
}
