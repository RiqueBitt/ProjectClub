//! `/api/missions/season` e `/api/missions/season/claim`
//! (routes/missions.js + services/missionSeason.js): o Passe do clube.
//!
//! A temporada muda todo mês (horário de Brasília). Cada missão resgatada dá
//! pontos; a cada 100 pontos sobe um nível (até 30) e cada nível libera um
//! prêmio em cada faixa. As missões em si (lista, progresso e resgate)
//! continuam no Node.

use std::sync::LazyLock;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use mysql_async::prelude::Queryable;
use serde_json::{Value, json};

use crate::AppState;
use crate::db;
use crate::params;
use crate::routes::ctx::{err, finish, js_parse_int, prelude_or_return, require_system, uid};
use crate::routes::users::reply;

const SEASON_JS: &str = include_str!("../../../../server/src/services/missionSeason.js");

fn js_const(name: &str, default: i64) -> i64 {
    regex::Regex::new(&format!(r"const {name}\s*=\s*(\d+)"))
        .expect("regex")
        .captures(SEASON_JS)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(default)
}

/// As constantes do `missionSeason.js`, lidas do próprio arquivo.
struct Rules {
    daily_points: i64,
    weekly_points: i64,
    level_points: i64,
    max_level: i64,
    themes: Vec<String>,
}

static RULES: LazyLock<Rules> = LazyLock::new(|| {
    let themes = regex::Regex::new(r"(?s)const THEMES\s*=\s*\[(.*?)\];")
        .expect("regex")
        .captures(SEASON_JS)
        .map(|c| {
            regex::Regex::new(r"'([^']*)'")
                .expect("regex")
                .captures_iter(&c[1])
                .map(|t| t[1].to_string())
                .collect()
        })
        .unwrap_or_default();
    Rules {
        daily_points: js_const("DAILY_POINTS", 10),
        weekly_points: js_const("WEEKLY_POINTS", 40),
        level_points: js_const("LEVEL_POINTS", 100).max(1),
        max_level: js_const("MAX_LEVEL", 30),
        themes,
    }
});

struct Season {
    key: String,
    name: String,
    ends_at: NaiveDateTime,
}

/// `current(now)`: a temporada do mês em Brasília; acaba à meia-noite de lá
/// (03:00 UTC) do dia 1 do mês seguinte.
fn current(now: NaiveDateTime) -> Season {
    let t = now - Duration::hours(3);
    let (y, m) = (t.year(), t.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let ends_at = NaiveDate::from_ymd_opt(ny, nm, 1)
        .and_then(|d| d.and_hms_opt(3, 0, 0))
        .unwrap_or(now);
    Season {
        key: format!("{y}-{m:02}"),
        name: RULES
            .themes
            .get(m as usize - 1)
            .cloned()
            .unwrap_or_default(),
        ends_at,
    }
}

/// `rewardsFor(level)`: `((moedas, gemas) grátis, (moedas, gemas) de apoio)`.
fn rewards_for(level: i64) -> ((i64, i64), (i64, i64)) {
    let last = level == RULES.max_level;
    if level % 5 == 0 {
        (
            (100 + level * 10, if last { 10 } else { 3 }),
            (150 + level * 10, if last { 25 } else { 8 }),
        )
    } else {
        ((40 + level * 5, 0), (60 + level * 5, 1))
    }
}

fn reward_json((coins, gems): (i64, i64)) -> Value {
    json!({ "coins": coins, "gems": gems })
}

/// `parse`: a lista de níveis já resgatados (texto JSON); qualquer outra coisa vira lista vazia.
fn parse_list(text: Option<&str>) -> Vec<Value> {
    let text = match text {
        Some(t) if !t.is_empty() => t,
        _ => "[]",
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(list)) => list,
        _ => Vec::new(),
    }
}

/// `list.includes(lv)` / `new Set(list).has(lv)` pra um número.
fn has_level(list: &[Value], level: i64) -> bool {
    list.iter().any(|v| v.as_f64() == Some(level as f64))
}

fn level_of(points: i64) -> i64 {
    RULES.max_level.min(points.div_euclid(RULES.level_points))
}

/// `normalizeTier(t) !== 'NONE'`.
fn is_supporter(tier: Option<&str>) -> bool {
    matches!(tier, Some("SUBSCRIBER" | "SUPER"))
}

async fn supporter_tier(db: &db::Db, user_id: &str) -> db::DbResult<Option<String>> {
    Ok(
        match db::first(
            db,
            "SELECT supporterTier FROM `User` WHERE id = ?",
            params![user_id],
        )
        .await?
        {
            Some(row) => db::get(&row, "supporterTier")?,
            None => None,
        },
    )
}

macro_rules! system_or_return {
    ($c:expr, $key:expr) => {
        if let Some(r) = require_system(&$c.db, uid(&$c), $key).await? {
            return Ok(r);
        }
    };
}

/// `GET /api/missions/season`.
pub async fn get_season(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let me = uid(&c);
        let s = current(db::now());
        let row = db::first(
            &c.db,
            "SELECT points, claimedFree, claimedPlus FROM SeasonPass WHERE userId = ? AND seasonKey = ?",
            params![me, s.key.as_str()],
        )
        .await?;
        let (points, free, plus) = match &row {
            Some(r) => (
                db::get::<Option<i64>>(r, "points")?.unwrap_or(0),
                parse_list(db::get::<Option<String>>(r, "claimedFree")?.as_deref()),
                parse_list(db::get::<Option<String>>(r, "claimedPlus")?.as_deref()),
            ),
            None => (0, Vec::new(), Vec::new()),
        };
        let level = level_of(points);
        let supporter = is_supporter(supporter_tier(&c.db, me).await?.as_deref());
        let tiers: Vec<Value> = (1..=RULES.max_level)
            .map(|lv| {
                let (f, p) = rewards_for(lv);
                json!({
                    "level": lv,
                    "unlocked": lv <= level,
                    "free": reward_json(f),
                    "plus": reward_json(p),
                    "claimedFree": has_level(&free, lv),
                    "claimedPlus": has_level(&plus, lv),
                })
            })
            .collect();
        Ok(reply(
            &c,
            json!({
                "key": s.key,
                "name": s.name,
                "endsAt": db::iso(s.ends_at),
                "points": points,
                "level": level,
                "maxLevel": RULES.max_level,
                "levelPoints": RULES.level_points,
                "pointsPerMission": { "daily": RULES.daily_points, "weekly": RULES.weekly_points },
                "isSupporter": supporter,
                "tiers": tiers,
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// Por que o resgate parou (vira a resposta de erro).
struct Stop(StatusCode, &'static str);

/// `POST /api/missions/season/claim { level, track }`.
pub async fn claim_season(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        system_or_return!(c, "economia");
        let me = uid(&c).to_string();
        let s = current(db::now());
        let lv = js_parse_int(c.body.get("level"));
        if !lv.is_finite() || lv < 1.0 || lv > RULES.max_level as f64 {
            return Ok(err(StatusCode::BAD_REQUEST, "Nível inválido."));
        }
        let lv = lv as i64;
        let plus = match c.body.get("track").and_then(Value::as_str) {
            Some("free") => false,
            Some("plus") => true,
            _ => return Ok(err(StatusCode::BAD_REQUEST, "Faixa inválida.")),
        };
        let (free_reward, plus_reward) = rewards_for(lv);
        let (coins, gems) = if plus { plus_reward } else { free_reward };
        let field = if plus { "claimedPlus" } else { "claimedFree" };

        let mut conn = crate::db::conn(&c.db).await?;
        let mut tx = conn.start_transaction(mysql_async::TxOpts::default()).await?;
        let result: anyhow::Result<Result<(i64, i64), Stop>> = async {
            let row: Option<mysql_async::Row> = tx
                .exec_first(
                    "SELECT points, claimedFree, claimedPlus FROM SeasonPass WHERE userId = ? AND seasonKey = ?",
                    (me.as_str(), s.key.as_str()),
                )
                .await?;
            let Some(row) = row else {
                return Ok(Err(Stop(StatusCode::BAD_REQUEST, "Você ainda não chegou nesse nível.")));
            };
            if level_of(db::get::<Option<i64>>(&row, "points")?.unwrap_or(0)) < lv {
                return Ok(Err(Stop(StatusCode::BAD_REQUEST, "Você ainda não chegou nesse nível.")));
            }
            // O passe é dos Assinantes (as duas faixas); os pontos somam pra todo mundo.
            let tier: Option<Option<String>> = tx
                .exec_first("SELECT supporterTier FROM `User` WHERE id = ?", (me.as_str(),))
                .await?;
            if !is_supporter(tier.flatten().as_deref()) {
                return Ok(Err(Stop(StatusCode::FORBIDDEN, "O passe do clube é para Assinantes.")));
            }
            let before: Option<String> = db::get(&row, field)?;
            let mut list = parse_list(before.as_deref());
            if has_level(&list, lv) {
                return Ok(Err(Stop(StatusCode::BAD_REQUEST, "Prêmio já resgatado.")));
            }
            list.push(json!(lv));
            // Trava otimista: só grava se a lista não mudou desde a leitura (sem resgate duplo).
            let sql = format!(
                "UPDATE SeasonPass SET {field} = ?, updatedAt = ? WHERE userId = ? AND seasonKey = ? AND {field} <=> ?"
            );
            tx.exec_drop(
                sql,
                (Value::Array(list).to_string(), db::now(), me.as_str(), s.key.as_str(), before),
            )
            .await?;
            if tx.affected_rows() != 1 {
                return Ok(Err(Stop(StatusCode::CONFLICT, "Tente de novo.")));
            }
            tx.exec_drop(
                "UPDATE `User` SET coins = coins + ?, gems = gems + ?, updatedAt = ? WHERE id = ?",
                (coins, gems, db::now(), me.as_str()),
            )
            .await?;
            let balance: Option<(i64, i64)> = tx
                .exec_first("SELECT coins, gems FROM `User` WHERE id = ?", (me.as_str(),))
                .await?;
            Ok(Ok(balance.ok_or_else(|| anyhow::anyhow!("Record to update not found."))?))
        }
        .await;
        let balance = match result {
            Ok(Ok(b)) => {
                tx.commit().await?;
                b
            }
            Ok(Err(Stop(status, msg))) => {
                let _ = tx.rollback().await;
                return Ok(err(status, msg));
            }
            Err(e) => {
                let _ = tx.rollback().await;
                return Err(e);
            }
        };
        drop(conn);

        // Registro da carteira (melhor esforço, como o recordTransaction do Node).
        let label = format!("{}: nível {lv}{}", s.name, if plus { " (apoio)" } else { "" });
        let label: String = label.chars().take(180).collect();
        if let Err(e) = db::exec(
            &c.db,
            "INSERT INTO EconomyTransaction (id, userId, kind, label, coins, gems, xp, createdAt) \
             VALUES (?, ?, 'MISSION', ?, ?, ?, 0, ?)",
            params![db::new_id(), me.as_str(), label, coins, gems, db::now()],
        )
        .await
        {
            tracing::warn!("[economyLedger] {e}");
        }

        Ok(reply(
            &c,
            json!({
                "reward": reward_json((coins, gems)),
                "balance": { "coins": balance.0, "gems": balance.1 },
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, m: u32, d: u32, h: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, 0, 0)
            .unwrap()
    }

    #[test]
    fn regras_lidas_do_node() {
        assert_eq!(
            (
                RULES.daily_points,
                RULES.weekly_points,
                RULES.level_points,
                RULES.max_level
            ),
            (10, 40, 100, 30)
        );
        assert_eq!(RULES.themes.len(), 12);
        assert!(RULES.themes[10].starts_with("Temporada Cyber"));
    }

    #[test]
    fn temporada_vira_a_meia_noite_de_brasilia() {
        // 1º de dezembro, 02:59 UTC ainda é novembro em Brasília.
        let s = current(at(2026, 12, 1, 2));
        assert_eq!((s.key.as_str(), s.ends_at), ("2026-11", at(2026, 12, 1, 3)));
        let s = current(at(2026, 12, 1, 3));
        assert_eq!((s.key.as_str(), s.ends_at), ("2026-12", at(2027, 1, 1, 3)));
        assert!(s.name.starts_with("Temporada Festas"));
    }

    #[test]
    fn premios_por_nivel() {
        assert_eq!(rewards_for(1), ((45, 0), (65, 1)));
        assert_eq!(rewards_for(5), ((150, 3), (200, 8)));
        assert_eq!(rewards_for(30), ((400, 10), (450, 25)));
        assert_eq!(
            (level_of(0), level_of(99), level_of(640), level_of(99999)),
            (0, 0, 6, 30)
        );
    }

    #[test]
    fn lista_de_resgatados() {
        assert!(parse_list(None).is_empty());
        assert!(parse_list(Some("")).is_empty());
        assert!(parse_list(Some("{}")).is_empty());
        assert!(parse_list(Some("não é json")).is_empty());
        let list = parse_list(Some("[1,2,\"3\"]"));
        assert!(has_level(&list, 2));
        assert!(!has_level(&list, 3)); // "3" (texto) não é o número 3, como no Set do JS
    }
}
