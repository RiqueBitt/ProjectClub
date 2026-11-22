//! `/api/economy` (routes/economy.js + controllers/economyController.js +
//! services/walletCard.js): carteira, cartão da carteira, baús, nível/rank,
//! ranking e a administração dos baús diários.
//!
//! O `POST /daily` (resgate do baú) continua no Node por enquanto: ele
//! devolve as conquistas novas na mesma resposta e mexe em missões.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::{IntoResponse, Response};
use chrono::{Duration, NaiveDateTime};
use serde_json::{Value, json};

use crate::AppState;
use crate::db::{self, Ty};
use crate::levels;
use crate::node::{self, Emit};
use crate::params;
use crate::prisma_json::{self, find_many, find_one};
use crate::routes::ctx::{
    Ctx, err, finish, js_parse_float, js_parse_int, js_string, prelude_or_return,
    require_platform_admin, require_system, uid,
};
use crate::routes::users::reply;
use crate::users;

/// `DAILY_COOLDOWN_MS` do services/economy.js.
const DAILY_COOLDOWN: Duration = Duration::hours(24);
/// `SHARE_COOLDOWN_MS` do walletCard.js.
const SHARE_COOLDOWN: Duration = Duration::seconds(10);

const STYLES: [&str; 3] = ["DEFAULT", "GOLD", "RAINBOW"];

fn created(mut res: Response) -> Response {
    *res.status_mut() = StatusCode::CREATED;
    res
}

/// `requireSystemEnabled(chave)` de dentro de uma rota (devolve a resposta).
macro_rules! system_or_return {
    ($c:expr, $key:expr) => {
        if let Some(r) = require_system(&$c.db, uid(&$c), $key).await? {
            return Ok(r);
        }
    };
}

macro_rules! admin_or_return {
    ($c:expr) => {
        if let Some(r) = require_platform_admin(&$c.db, uid(&$c)).await? {
            return Ok(r);
        }
    };
}

// ---------------------------------------------------------------- cartão

/// O que o cartão precisa saber da conta.
struct CardUser {
    tier: Option<String>,
    until: Option<NaiveDateTime>,
    style: Option<String>,
}

/// `effectiveTier`: categoria vencida vira NONE; desconhecida também.
fn effective_tier(u: &CardUser, now: NaiveDateTime) -> &'static str {
    if u.until.is_some_and(|d| d <= now) {
        return "NONE";
    }
    match u.tier.as_deref() {
        Some("SUBSCRIBER") => "SUBSCRIBER",
        Some("SUPER") => "SUPER",
        _ => "NONE",
    }
}

/// `ALLOWED[tier]`.
fn allowed_styles(tier: &str) -> &'static [&'static str] {
    match tier {
        "SUPER" => &["DEFAULT", "GOLD", "RAINBOW"],
        "SUBSCRIBER" => &["DEFAULT", "GOLD"],
        _ => &["DEFAULT"],
    }
}

/// `styleFor`: o estilo escolhido, se a categoria libera; senão o padrão dela.
fn style_for(u: &CardUser, now: NaiveDateTime) -> &'static str {
    let tier = effective_tier(u, now);
    let allowed = allowed_styles(tier);
    match u.style.as_deref() {
        Some(p) if !p.is_empty() => {
            if let Some(s) = allowed.iter().find(|s| **s == p) {
                return s;
            }
        }
        _ => {}
    }
    match tier {
        "SUPER" => "RAINBOW",
        "SUBSCRIBER" => "GOLD",
        _ => "DEFAULT",
    }
}

fn card_user(row: &mysql_async::Row) -> db::DbResult<CardUser> {
    Ok(CardUser {
        tier: db::get(row, "supporterTier")?,
        until: db::get(row, "supporterUntil")?,
        style: db::get(row, "walletCardStyle")?,
    })
}

// ---------------------------------------------------------------- carteira

/// `GET /api/economy`.
pub async fn get_economy(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let row = db::first(
            &c.db,
            "SELECT coins, gems, dailyStreak, lastDailyAt, accountLevel, accountXp, \
             supporterTier, supporterUntil, walletCardStyle FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?
        .ok_or_else(|| anyhow::anyhow!("Cannot read properties of null (reading 'coins')"))?;
        let now = db::now();
        let last: Option<NaiveDateTime> = db::get(&row, "lastDailyAt")?;
        let next = last
            .map(|d| d + DAILY_COOLDOWN)
            .filter(|d| *d > now)
            .map(db::iso);
        let cu = card_user(&row)?;
        Ok(reply(
            &c,
            json!({
                "coins": db::col(&row, "coins", Ty::Int)?,
                "gems": db::col(&row, "gems", Ty::Int)?,
                "dailyStreak": db::col(&row, "dailyStreak", Ty::Int)?,
                "lastDailyAt": db::col(&row, "lastDailyAt", Ty::Date)?,
                "accountLevel": db::col(&row, "accountLevel", Ty::Int)?,
                "accountXp": db::col(&row, "accountXp", Ty::Int)?,
                "streakRequired": *levels::MEGA_CHEST_STREAK_REQUIRED,
                "nextDailyAt": next,
                "cardStyle": style_for(&cu, now),
                "cardStyles": allowed_styles(effective_tier(&cu, now)),
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// `PUT /api/economy/card-style { style }`.
pub async fn set_card_style(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let want = js_string(c.body.get("style")).to_uppercase();
        if !STYLES.contains(&want.as_str()) {
            return Ok(err(StatusCode::BAD_REQUEST, "Estilo de cartão inválido."));
        }
        let row = db::first(
            &c.db,
            "SELECT supporterTier, supporterUntil, NULL AS walletCardStyle FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?;
        let cu = match &row {
            Some(r) => card_user(r)?,
            None => CardUser {
                tier: None,
                until: None,
                style: None,
            },
        };
        let tier = effective_tier(&cu, db::now());
        if !allowed_styles(tier).contains(&want.as_str()) {
            let msg = if want == "RAINBOW" {
                "O cartão arco-íris é do Super Assinante."
            } else {
                "O cartão dourado é de Assinante."
            };
            return Ok(err(StatusCode::FORBIDDEN, msg));
        }
        if row.is_none() {
            anyhow::bail!("Record to update not found.");
        }
        db::exec(
            &c.db,
            "UPDATE `User` SET walletCardStyle = ?, updatedAt = ? WHERE id = ?",
            params![want.as_str(), db::now(), uid(&c)],
        )
        .await?;
        Ok(reply(
            &c,
            json!({ "style": want, "styles": allowed_styles(tier) }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// `POST /api/economy/card/share`: guarda uma "foto" do cartão pra mostrar.
pub async fn share_card(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let now = db::now();
        let last: Option<NaiveDateTime> = db::scalar(
            &c.db,
            "SELECT createdAt FROM WalletCardShare WHERE userId = ? ORDER BY createdAt DESC LIMIT 1",
            params![uid(&c)],
        )
        .await?;
        if last.is_some_and(|l| now - l < SHARE_COOLDOWN) {
            return Ok(err(
                StatusCode::TOO_MANY_REQUESTS,
                "Espere uns segundos pra mostrar o cartão de novo.",
            ));
        }
        let Some(row) = db::first(
            &c.db,
            "SELECT coins, gems, accountLevel, supporterTier, supporterUntil, walletCardStyle \
             FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Conta não encontrada."));
        };
        let coins: i64 = db::get(&row, "coins")?;
        let gems: i64 = db::get(&row, "gems")?;
        let level: i64 = db::get(&row, "accountLevel")?;
        let style = style_for(&card_user(&row)?, now);
        let id = db::new_id();
        db::exec(
            &c.db,
            "INSERT INTO WalletCardShare (id, userId, coins, gems, level, style, createdAt) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                id.as_str(),
                uid(&c),
                coins,
                gems,
                if level == 0 { 1 } else { level },
                style,
                db::now()
            ],
        )
        .await?;
        Ok(created(reply(&c, json!({ "id": id }))))
    }
    .await;
    finish(out, c.counted)
}

/// `GET /api/economy/card/{id}`: o cartão que alguém mostrou (sem trava de sistema).
pub async fn get_shared_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let Some(card) =
            find_one(&c.db, "WalletCardShare", "WHERE id = ?", params![id.as_str()]).await?
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Cartão não encontrado."));
        };
        let owner = card.get("userId").and_then(Value::as_str).unwrap_or_default();
        let user = db::first(
            &c.db,
            "SELECT id, displayName, username, avatarUrl, avatarDecoration, profileColor, createdAt \
             FROM `User` WHERE id = ?",
            params![owner],
        )
        .await?
        .map(|r| {
            db::object(
                &r,
                &[
                    ("id", "id", Ty::Str),
                    ("displayName", "displayName", Ty::Str),
                    ("username", "username", Ty::Str),
                    ("avatarUrl", "avatarUrl", Ty::Str),
                    ("avatarDecoration", "avatarDecoration", Ty::Str),
                    ("profileColor", "profileColor", Ty::Str),
                    ("createdAt", "createdAt", Ty::Date),
                ],
            )
        })
        .transpose()?;
        let card = prisma_json::pick(card, &["id", "coins", "gems", "level", "style", "createdAt"]);
        Ok(reply(&c, json!({ "card": card, "user": user })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- baús

/// `GET /api/economy/chests`: galeria pública (sem as chances).
pub async fn list_chests(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let chests: Vec<Value> = find_many(
            &c.db,
            "DailyChest",
            "WHERE enabled = 1 ORDER BY position ASC",
            vec![],
        )
        .await?
        .into_iter()
        .map(|r| {
            Value::Object(prisma_json::pick(
                r,
                &["id", "name", "imageClosed", "imageOpened"],
            ))
        })
        .collect();
        Ok(reply(&c, json!({ "chests": chests })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- nível / rank

/// `GET /api/economy/rank`.
pub async fn get_rank(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "rank");
        let row = db::first(
            &c.db,
            "SELECT accountXp, accountLevel FROM `User` WHERE id = ?",
            params![uid(&c)],
        )
        .await?
        .ok_or_else(|| {
            anyhow::anyhow!("Cannot read properties of null (reading 'accountLevel')")
        })?;
        let xp: i64 = db::get(&row, "accountXp")?;
        let level: i64 = db::get(&row, "accountLevel")?;
        let cur = levels::current(level);
        let next = levels::next(level);
        let higher: i64 = db::scalar(
            &c.db,
            "SELECT COUNT(*) FROM `User` WHERE accountXp > ?",
            params![xp],
        )
        .await?
        .unwrap_or(0);
        let (in_level, needed) = match (next, cur) {
            (Some(n), Some(cur)) => (xp - cur.min_xp, n.min_xp - cur.min_xp),
            _ => (0, 0),
        };
        Ok(reply(
            &c,
            json!({
                "level": level,
                "levelName": cur.map(|l| l.name.as_str()),
                "levelTitle": levels::title_for(level),
                "xp": xp,
                "nextLevel": next.map(|n| n.level),
                "xpInLevel": in_level,
                "xpNeeded": needed,
                "progress": levels::progress(level, xp),
                "isMaxLevel": next.is_none(),
                "position": higher + 1,
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// `GET /api/economy/leaderboard`: top 50 por XP (+ a própria pessoa no
/// fim, com `outsideTop50`, se ela não estiver no top).
pub async fn leaderboard(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "rank");
        // Os ids saem da mesma consulta simples que o Prisma faz (sem os
        // JOINs), pra empate de XP sair na mesma ordem.
        let ids: Vec<String> = db::column(
            &c.db,
            "SELECT id FROM `User` ORDER BY accountXp DESC LIMIT 50",
            vec![],
        )
        .await?;
        let mut by_id = users::public_by_ids(&c.db, &ids).await?;
        let mut board: Vec<Value> = ids
            .iter()
            .filter_map(|id| by_id.remove(id).map(Value::Object))
            .collect();
        if !ids.iter().any(|i| i == uid(&c)) {
            let me = db::first(
                &c.db,
                &users::public_select_sql("WHERE u.id = ?"),
                params![uid(&c)],
            )
            .await?;
            if let Some(r) = me {
                let mut u = users::public_user(&r)?;
                u.insert("outsideTop50".into(), Value::Bool(true));
                board.push(Value::Object(u));
            }
        }
        Ok(reply(&c, json!({ "leaderboard": board })))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- admin dos baús

fn chests_changed(state: &AppState) {
    node::realtime(
        state,
        vec![Emit::bare(&["community"], "chests:update")],
        None,
    );
}

/// Inteiro que o Prisma aceita num campo `Int` (32 bits); senão é erro (500).
fn prisma_int(n: f64, field: &str) -> anyhow::Result<i64> {
    if n.is_finite() && n.fract() == 0.0 && n >= f64::from(i32::MIN) && n <= f64::from(i32::MAX) {
        Ok(n as i64)
    } else {
        anyhow::bail!("Argument `{field}`: valor inválido pra Int ({n})")
    }
}

fn prisma_float(n: f64, field: &str) -> anyhow::Result<f64> {
    if n.is_finite() {
        Ok(n)
    } else {
        anyhow::bail!("Argument `{field}`: valor inválido pra Float ({n})")
    }
}

/// Verdadeiro no sentido do JS (`if (x)`).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// Texto pra um campo `String` do Prisma (outro tipo = erro de validação).
fn prisma_text(v: &Value, field: &str, nullable: bool) -> anyhow::Result<db::Value> {
    match v {
        Value::String(s) => Ok(db::Value::from(s.as_str())),
        Value::Null if nullable => Ok(db::Value::NULL),
        _ => anyhow::bail!("Argument `{field}`: esperado String"),
    }
}

/// `GET /api/economy/admin/chests`.
pub async fn admin_list_chests(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        admin_or_return!(c);
        let chests = find_many(&c.db, "DailyChest", "ORDER BY position ASC", vec![]).await?;
        Ok(reply(&c, json!({ "chests": chests })))
    }
    .await;
    finish(out, c.counted)
}

/// `POST /api/economy/admin/chests`.
pub async fn admin_create_chest(
    State(state): State<AppState>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        admin_or_return!(c);
        let b = &c.body;
        if !truthy(b.get("name")) {
            return Ok(err(StatusCode::BAD_REQUEST, "Nome é obrigatório."));
        }
        let count: i64 = db::scalar(&c.db, "SELECT COUNT(*) FROM DailyChest", vec![])
            .await?
            .unwrap_or(0);
        // `parseX(v) || padrão`: NaN e 0 caem no padrão.
        let or = |n: f64, d: f64| if n.is_nan() || n == 0.0 { d } else { n };
        let name = prisma_text(&b["name"], "name", false)?;
        let chance = prisma_float(
            or(js_parse_float(b.get("chanceRegular")), 0.1),
            "chanceRegular",
        )?;
        let int = |k: &str, d: f64| prisma_int(or(js_parse_int(b.get(k)), d), k);
        let (cmin, cmax) = (int("coinsMin", 1.0)?, int("coinsMax", 10.0)?);
        let (tmin, tmax) = (int("ticketsMin", 0.0)?, int("ticketsMax", 0.0)?);
        let image = |k: &str| -> anyhow::Result<db::Value> {
            if truthy(b.get(k)) {
                prisma_text(&b[k], k, false)
            } else {
                Ok(db::Value::NULL)
            }
        };
        let (closed, opened) = (image("imageClosed")?, image("imageOpened")?);
        let id = db::new_id();
        db::exec(
            &c.db,
            "INSERT INTO DailyChest (id, name, chanceRegular, coinsMin, coinsMax, ticketsMin, \
             ticketsMax, imageClosed, imageOpened, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            vec![
                db::Value::from(id.as_str()),
                name,
                db::Value::from(chance),
                db::Value::from(cmin),
                db::Value::from(cmax),
                db::Value::from(tmin),
                db::Value::from(tmax),
                closed,
                opened,
                db::Value::from(count),
            ],
        )
        .await?;
        let chest = find_one(&c.db, "DailyChest", "WHERE id = ?", params![id.as_str()]).await?;
        chests_changed(&state);
        Ok(created(reply(&c, json!({ "chest": chest }))))
    }
    .await;
    finish(out, c.counted)
}

/// `PATCH /api/economy/admin/chests/{id}`.
pub async fn admin_update_chest(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        admin_or_return!(c);
        let (sets, mut p) = chest_update(&c)?;
        if sets.is_empty() {
            // `update` com `data: {}` só confere se existe.
            let exists: Option<String> = db::scalar(
                &c.db,
                "SELECT id FROM DailyChest WHERE id = ?",
                params![id.as_str()],
            )
            .await?;
            if exists.is_none() {
                anyhow::bail!("Record to update not found.");
            }
        } else {
            p.push(db::Value::from(id.as_str()));
            let sql = format!("UPDATE DailyChest SET {} WHERE id = ?", sets.join(", "));
            if db::exec(&c.db, &sql, p).await? == 0 {
                // o MySQL conta 0 também quando nada mudou: confere se existe
                let exists: Option<String> = db::scalar(
                    &c.db,
                    "SELECT id FROM DailyChest WHERE id = ?",
                    params![id.as_str()],
                )
                .await?;
                if exists.is_none() {
                    anyhow::bail!("Record to update not found.");
                }
            }
        }
        let chest = find_one(&c.db, "DailyChest", "WHERE id = ?", params![id.as_str()]).await?;
        chests_changed(&state);
        Ok(reply(&c, json!({ "chest": chest })))
    }
    .await;
    finish(out, c.counted)
}

/// Os campos do `adminUpdateChest` (na ordem de `allowed`), já convertidos.
fn chest_update(c: &Ctx) -> anyhow::Result<(Vec<String>, Vec<db::Value>)> {
    const FLOATS: [&str; 2] = ["chanceRegular", "chanceSubscriber"];
    const INTS: [&str; 5] = [
        "coinsMin",
        "coinsMax",
        "ticketsMin",
        "ticketsMax",
        "position",
    ];
    const ALLOWED: [&str; 11] = [
        "name",
        "chanceRegular",
        "chanceSubscriber",
        "coinsMin",
        "coinsMax",
        "ticketsMin",
        "ticketsMax",
        "position",
        "enabled",
        "imageClosed",
        "imageOpened",
    ];
    let mut sets = Vec::new();
    let mut p = Vec::new();
    for key in ALLOWED {
        let Some(v) = c.body.get(key) else { continue };
        let value = if FLOATS.contains(&key) {
            db::Value::from(prisma_float(js_parse_float(Some(v)), key)?)
        } else if INTS.contains(&key) {
            db::Value::from(prisma_int(js_parse_int(Some(v)), key)?)
        } else if key == "enabled" {
            match v {
                Value::Bool(b) => db::Value::from(*b),
                _ => anyhow::bail!("Argument `enabled`: esperado Boolean"),
            }
        } else {
            prisma_text(v, key, key != "name")?
        };
        sets.push(format!("`{key}` = ?"));
        p.push(value);
    }
    Ok((sets, p))
}

/// `DELETE /api/economy/admin/chests/{id}`.
pub async fn admin_delete_chest(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        admin_or_return!(c);
        let n = db::exec(
            &c.db,
            "DELETE FROM DailyChest WHERE id = ?",
            params![id.as_str()],
        )
        .await?;
        if n == 0 {
            anyhow::bail!("Record to delete does not exist.");
        }
        chests_changed(&state);
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(tier: Option<&str>, until: Option<NaiveDateTime>, style: Option<&str>) -> CardUser {
        CardUser {
            tier: tier.map(Into::into),
            until,
            style: style.map(Into::into),
        }
    }

    #[test]
    fn estilo_do_cartao_igual_ao_walletcard_js() {
        let now = db::now();
        let past = now - Duration::days(1);
        let future = now + Duration::days(1);
        assert_eq!(style_for(&u(None, None, None), now), "DEFAULT");
        assert_eq!(style_for(&u(Some("SUBSCRIBER"), None, None), now), "GOLD");
        assert_eq!(
            style_for(&u(Some("SUPER"), Some(future), None), now),
            "RAINBOW"
        );
        assert_eq!(
            style_for(&u(Some("SUPER"), Some(past), Some("RAINBOW")), now),
            "DEFAULT"
        );
        assert_eq!(
            style_for(&u(Some("SUPER"), None, Some("DEFAULT")), now),
            "DEFAULT"
        );
        assert_eq!(
            style_for(&u(Some("SUBSCRIBER"), None, Some("RAINBOW")), now),
            "GOLD"
        );
        assert_eq!(
            style_for(&u(Some("ADMIN"), None, Some("GOLD")), now),
            "DEFAULT"
        );
        assert_eq!(
            effective_tier(&u(Some("SUPER"), Some(now), None), now),
            "NONE"
        );
    }

    #[test]
    fn verdadeiro_do_js() {
        assert!(!truthy(None));
        assert!(!truthy(Some(&json!(0))));
        assert!(!truthy(Some(&json!(""))));
        assert!(truthy(Some(&json!("a"))));
        assert!(truthy(Some(&json!([]))));
        assert!(truthy(Some(&json!(-1))));
    }

    #[test]
    fn inteiro_do_prisma() {
        assert_eq!(prisma_int(3.0, "x").unwrap(), 3);
        assert!(prisma_int(f64::NAN, "x").is_err());
        assert!(prisma_int(3_000_000_000.0, "x").is_err());
        assert!(prisma_float(f64::INFINITY, "x").is_err());
    }
}
