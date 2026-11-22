//! Campos de usuário que saem nas respostas — porte de `PUBLIC_USER_FIELDS`
//! e `SELF_USER_FIELDS` (`server/src/controllers/authController.js`).
//!
//! PUBLIC: seguro mostrar pra QUALQUER pessoa (autor de mensagem, perfil…).
//! SELF: só a própria pessoa (`/auth/me`) — inclui e-mail, 2FA, situação da
//! conta, aniversário completo e preferências.

use crate::db::{DbResult, Row};
use serde_json::{Map, Value, json};

use crate::db::{self, Ty};

/// `(campo no JSON, coluna em `User`, tipo)` na ordem do Node. As duas
/// relações (`clanTag`, `selectedPendant`) entram nas posições marcadas.
pub const PUBLIC_FIELDS: &[(&str, &str, Ty)] = &[
    ("id", "id", Ty::Str),
    ("publicId", "publicId", Ty::Str),
    ("username", "username", Ty::Str),
    ("displayName", "displayName", Ty::Str),
    ("avatarUrl", "avatarUrl", Ty::Str),
    ("avatarDecoration", "avatarDecoration", Ty::Str),
    ("profileEffect", "profileEffect", Ty::Str),
    ("profileFont", "profileFont", Ty::Str),
    ("profileStyle", "profileStyle", Ty::Str),
    ("bannerUrl", "bannerUrl", Ty::Str),
    ("miniProfileBannerUrl", "miniProfileBannerUrl", Ty::Str),
    ("bannerFraming", "bannerFraming", Ty::Str),
    (
        "miniProfileBannerFraming",
        "miniProfileBannerFraming",
        Ty::Str,
    ),
    ("bio", "bio", Ty::Str),
    ("pronouns", "pronouns", Ty::Str),
    ("profileColor", "profileColor", Ty::Str),
    ("status", "status", Ty::Str),
    ("customStatus", "customStatus", Ty::Str),
    ("customStatusEmoji", "customStatusEmoji", Ty::Str),
    ("customStatusExpiresAt", "customStatusExpiresAt", Ty::Date),
    ("createdAt", "createdAt", Ty::Date),
    ("platformRole", "platformRole", Ty::Str),
    ("supporterTier", "supporterTier", Ty::Str),
    ("tagEmoji", "tagEmoji", Ty::Str),
    ("tagText", "tagText", Ty::Str),
    ("youtubeUrl", "youtubeUrl", Ty::Str),
    ("steamUrl", "steamUrl", Ty::Str),
    ("robloxUrl", "robloxUrl", Ty::Str),
    ("xUrl", "xUrl", Ty::Str),
    ("profileNameFont", "profileNameFont", Ty::Str),
    ("profileNameEffect", "profileNameEffect", Ty::Str),
    ("profileNameColor", "profileNameColor", Ty::Str),
    ("profileNameColor2", "profileNameColor2", Ty::Str),
    ("profileNameColors", "profileNameColors", Ty::Str),
    ("accountLevel", "accountLevel", Ty::Int),
    ("accountXp", "accountXp", Ty::Int),
    ("displayedAchievements", "displayedAchievements", Ty::Str),
    (
        "displayedAchievementsMini",
        "displayedAchievementsMini",
        Ty::Str,
    ),
    ("idCardUrl", "idCardUrl", Ty::Str),
    ("idCardFraming", "idCardFraming", Ty::Str),
    ("relationshipPartnerId", "relationshipPartnerId", Ty::Str),
    ("profileSectionOrder", "profileSectionOrder", Ty::Str),
    ("levelBarColor", "levelBarColor", Ty::Str),
    ("profileSectionOpacity", "profileSectionOpacity", Ty::Int),
    ("miniProfileColor", "miniProfileColor", Ty::Str),
    ("miniProfileButtonColor", "miniProfileButtonColor", Ty::Str),
    ("statusBubbleColor", "statusBubbleColor", Ty::Str),
    // clanTag e selectedPendant entram aqui (ver `public_user`)
    ("customPendantUrl", "customPendantUrl", Ty::Str),
];

/// Só da própria pessoa (além dos públicos).
pub const SELF_FIELDS: &[(&str, &str, Ty)] = &[
    ("email", "email", Ty::Str),
    ("emailVerified", "emailVerified", Ty::Bool),
    ("twoFactorEnabled", "twoFactorEnabled", Ty::Bool),
    ("isPlatformBanned", "isPlatformBanned", Ty::Bool),
    ("platformBanReason", "platformBanReason", Ty::Str),
    ("suspendedUntil", "suspendedUntil", Ty::Date),
    ("timeoutUntil", "timeoutUntil", Ty::Date),
    ("accountDisabledAt", "accountDisabledAt", Ty::Date),
    ("birthDate", "birthDate", Ty::Date),
    ("preferredTheme", "preferredTheme", Ty::Str),
    ("layoutStyle", "layoutStyle", Ty::Str),
    ("chatZoom", "chatZoom", Ty::Float),
    ("interfaceZoom", "interfaceZoom", Ty::Float),
    ("emojiStyle", "emojiStyle", Ty::Str),
    ("friendRequestPrivacy", "friendRequestPrivacy", Ty::Str),
    ("usernameChangedAt", "usernameChangedAt", Ty::Date),
];

/// Colunas das relações, com apelidos (`_ct_*` etc.) pra não bater com as do User.
const RELATION_COLUMNS: &str = "ct.tag AS _ct_tag, ct.id AS _ct_id, \
     ci.id AS _ci_id, ci.name AS _ci_name, ci.url AS _ci_url, ci.createdAt AS _ci_createdAt, \
     ci.isDefault AS _ci_isDefault, c.iconColor AS _c_iconColor, \
     p.id AS _p_id, p.name AS _p_name, p.iconUrl AS _p_iconUrl";

const RELATION_JOINS: &str = "LEFT JOIN ClanTag ct ON ct.id = u.clanTagId \
     LEFT JOIN Clan c ON c.id = ct.clanId \
     LEFT JOIN ClanIcon ci ON ci.id = c.iconId \
     LEFT JOIN Pendant p ON p.id = u.selectedPendantId";

fn columns(fields: &[(&str, &str, Ty)]) -> String {
    fields
        .iter()
        .map(|(_, c, _)| format!("u.`{c}`"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `SELECT` com os campos públicos + da própria pessoa, por id.
pub fn self_select_sql() -> String {
    format!(
        "SELECT {pub_cols}, {self_cols}, {RELATION_COLUMNS} FROM `User` u {RELATION_JOINS} WHERE u.id = ?",
        pub_cols = columns(PUBLIC_FIELDS),
        self_cols = columns(SELF_FIELDS),
    )
}

/// `SELECT` com os campos públicos (`PUBLIC_USER_FIELDS`) e um `WHERE`/resto
/// à escolha (`u` é o apelido da tabela).
pub fn public_select_sql(rest: &str) -> String {
    format!(
        "SELECT {pub_cols}, {RELATION_COLUMNS} FROM `User` u {RELATION_JOINS} {rest}",
        pub_cols = columns(PUBLIC_FIELDS),
    )
}

/// Usuário só com os campos públicos.
pub fn public_user(row: &Row) -> DbResult<Map<String, Value>> {
    let mut out = Map::new();
    let (clan_tag, pendant) = relations(row)?;
    for (key, column, ty) in PUBLIC_FIELDS {
        if *key == "customPendantUrl" {
            out.insert("clanTag".into(), clan_tag.clone());
            out.insert("selectedPendant".into(), pendant.clone());
        }
        out.insert((*key).into(), db::col(row, column, *ty)?);
    }
    Ok(out)
}

fn relations(row: &Row) -> DbResult<(Value, Value)> {
    // clanTag: { tag, clan: { icon: ClanIcon | null, iconColor } } ou null
    let clan_tag = if db::col(row, "_ct_id", Ty::Str)?.is_null() {
        Value::Null
    } else {
        let icon = if db::col(row, "_ci_id", Ty::Str)?.is_null() {
            Value::Null
        } else {
            Value::Object(db::object(
                row,
                &[
                    ("id", "_ci_id", Ty::Str),
                    ("name", "_ci_name", Ty::Str),
                    ("url", "_ci_url", Ty::Str),
                    ("createdAt", "_ci_createdAt", Ty::Date),
                    ("isDefault", "_ci_isDefault", Ty::Bool),
                ],
            )?)
        };
        json!({
            "tag": db::col(row, "_ct_tag", Ty::Str)?,
            "clan": { "icon": icon, "iconColor": db::col(row, "_c_iconColor", Ty::Str)? },
        })
    };
    let pendant = if db::col(row, "_p_id", Ty::Str)?.is_null() {
        Value::Null
    } else {
        Value::Object(db::object(
            row,
            &[
                ("id", "_p_id", Ty::Str),
                ("name", "_p_name", Ty::Str),
                ("iconUrl", "_p_iconUrl", Ty::Str),
            ],
        )?)
    };
    Ok((clan_tag, pendant))
}

/// Usuário com os campos públicos + os da própria pessoa.
pub fn self_user(row: &Row) -> DbResult<Map<String, Value>> {
    let mut out = Map::new();
    let (clan_tag, pendant) = relations(row)?;
    for (key, column, ty) in PUBLIC_FIELDS {
        if *key == "customPendantUrl" {
            out.insert("clanTag".into(), clan_tag.clone());
            out.insert("selectedPendant".into(), pendant.clone());
        }
        out.insert((*key).into(), db::col(row, column, *ty)?);
    }
    out.extend(db::object(row, SELF_FIELDS)?);
    Ok(out)
}
