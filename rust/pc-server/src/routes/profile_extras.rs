//! Extras do perfil: mural de jogos, lista de desejos, atividade recente,
//! estatísticas e a nota — porte de `profileExtrasController.js`.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::db::{self, Db};
use crate::js;
use crate::node;
use crate::params;
use crate::routes::ctx::{err, finish, prelude_or_return, uid};
use crate::routes::profile::{has_activity_access, has_full_access};
use crate::routes::profile_edit::clean_game;
use crate::routes::users::{reply, update_self_data};

const LEVELS: [&str; 5] = [
    "Iniciante",
    "Casual",
    "Intermediário",
    "Avançado",
    "Profissional",
];
const FEELINGS: [&str; 6] = [
    "Curtindo muito",
    "Meio que amo isso",
    "Viciado",
    "Só relaxando",
    "Voltando agora",
    "Odeio que amo",
];
const TAGS: [&str; 15] = [
    "Procurando grupo",
    "Competitivo",
    "Cooperativo",
    "Ranqueada",
    "História",
    "Speedrun",
    "Completando 100%",
    "Modding",
    "Streamando",
    "Construindo",
    "Explorando",
    "PvP",
    "PvE",
    "Sobrevivência",
    "Roleplay",
];
const WIDGET_KEYS: [&str; 4] = ["favorite", "rotation", "liked", "want"];

fn text(v: Option<&Value>, max: usize) -> String {
    v.and_then(Value::as_str)
        .map(|s| crate::routes::ctx::js_slice(crate::routes::ctx::js_trim(s), max))
        .unwrap_or_default()
}

fn clean_tags(v: Option<&Value>, max: usize) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for t in v.and_then(Value::as_array).into_iter().flatten() {
        if t.as_str().is_some_and(|s| TAGS.contains(&s)) && !out.contains(t) {
            out.push(t.clone());
        }
    }
    out.truncate(max);
    out
}

/// Campos extras de cada jogo (nível, sentimento, tags do "em rotação").
type Extra<'a> = &'a dyn Fn(&Value) -> Map<String, Value>;

fn unique_games(list: Option<&Value>, max: usize, extra: Option<Extra>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for raw in list.and_then(Value::as_array).into_iter().flatten() {
        let Some(mut g) = clean_game(raw, 64, 100) else {
            continue;
        };
        if out.iter().any(|x| x["gameKey"] == g["gameKey"]) {
            continue;
        }
        if let (Some(f), Value::Object(m)) = (extra, &mut g) {
            m.extend(f(raw));
        }
        out.push(g);
        if out.len() >= max {
            break;
        }
    }
    out
}

/// `sanitizeWidgets`: o mural do perfil em JSON, ou null se ficou vazio.
pub fn sanitize_widgets(raw: Option<&Value>) -> Value {
    let v = match raw {
        Some(Value::String(s)) => match js::parse(s) {
            Some(v) => v,
            None => return Value::Null,
        },
        Some(other) => other.clone(),
        None => return Value::Null,
    };
    let Some(o) = v.as_object() else {
        return Value::Null;
    };
    let mut out = Map::new();
    if let Some(f) = o.get("favorite")
        && let Some(Value::Object(mut fav)) = clean_game(f, 64, 100)
    {
        fav.insert("comment".into(), json!(text(f.get("comment"), 190)));
        fav.insert("tags".into(), json!(clean_tags(f.get("tags"), 5)));
        out.insert("favorite".into(), Value::Object(fav));
    }
    let rotation_extra = |r: &Value| {
        let pick = |k: &str, list: &[&str]| {
            r.get(k)
                .and_then(Value::as_str)
                .filter(|s| list.contains(s))
                .map(|s| json!(s))
                .unwrap_or(Value::Null)
        };
        let mut m = Map::new();
        m.insert("level".into(), pick("level", &LEVELS));
        m.insert("feeling".into(), pick("feeling", &FEELINGS));
        m.insert("tags".into(), json!(clean_tags(r.get("tags"), 3)));
        m
    };
    let rotation = unique_games(o.get("rotation"), 5, Some(&rotation_extra));
    let liked = unique_games(o.get("liked"), 20, None);
    let want = unique_games(o.get("want"), 20, None);
    let keys_in = |k: &str| -> Vec<String> {
        o.get(k)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter(|s| WIDGET_KEYS.contains(s))
            .map(String::from)
            .collect()
    };
    let mut order: Vec<String> = Vec::new();
    for k in keys_in("order")
        .into_iter()
        .chain(WIDGET_KEYS.iter().map(|s| s.to_string()))
    {
        if !order.contains(&k) {
            order.push(k);
        }
    }
    let mut hidden: Vec<String> = Vec::new();
    for k in keys_in("hidden") {
        if !hidden.contains(&k) {
            hidden.push(k);
        }
    }
    let empty = !out.contains_key("favorite")
        && rotation.is_empty()
        && liked.is_empty()
        && want.is_empty()
        && hidden.is_empty()
        && order == WIDGET_KEYS;
    out.insert("rotation".into(), json!(rotation));
    out.insert("liked".into(), json!(liked));
    out.insert("want".into(), json!(want));
    out.insert("order".into(), json!(order));
    out.insert("hidden".into(), json!(hidden));
    if empty {
        Value::Null
    } else {
        json!(js::stringify(&Value::Object(out)))
    }
}

/// `parse(raw, fallback)`: texto vazio ou JSON quebrado = `fallback`.
fn parse_or(raw: Option<&str>, fallback: Value) -> Value {
    raw.filter(|r| !r.is_empty())
        .map(|r| js::parse(r).unwrap_or(fallback.clone()))
        .unwrap_or(fallback)
}

// ---------------------------------------------------------------- estatísticas

struct Tier {
    key: &'static str,
    label: &'static str,
    icon: &'static str,
    steps: [i64; 6],
    names: [&'static str; 6],
}

const TIERS: [Tier; 5] = [
    Tier {
        key: "age",
        label: "Idade da conta",
        icon: "crown",
        steps: [0, 1, 6, 12, 24, 48],
        names: [
            "Recém-chegado",
            "Broto",
            "Raiz",
            "Tronco",
            "Árvore antiga",
            "Floresta",
        ],
    },
    Tier {
        key: "variety",
        label: "Variedade de jogos",
        icon: "grid",
        steps: [1, 5, 15, 30, 50, 100],
        names: [
            "Curioso",
            "Explorador",
            "Navegante",
            "Aventureiro",
            "Colecionador",
            "Enciclopédia",
        ],
    },
    Tier {
        key: "playtime",
        label: "Tempo de jogo",
        icon: "clock",
        steps: [1, 10, 50, 200, 500, 1000],
        names: [
            "Iniciante",
            "Jogador",
            "Dedicado",
            "Veterano",
            "Lendário",
            "Imortal",
        ],
    },
    Tier {
        key: "gifts",
        label: "Presentes",
        icon: "gift",
        steps: [1, 2, 3, 6, 10, 20],
        names: [
            "Generoso",
            "Mão aberta",
            "Benfeitor",
            "Patrono",
            "Mecenas",
            "Lenda dos presentes",
        ],
    },
    Tier {
        key: "ups",
        label: "Ups recebidos",
        icon: "heart",
        steps: [10, 50, 150, 500, 1500, 5000],
        names: ["Notado", "Querido", "Popular", "Famoso", "Ídolo", "Ícone"],
    },
];

fn plural(n: i64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// `describeStat(tierFor(key, value))`.
pub fn stat(key: &str, value: i64) -> Option<Value> {
    let t = TIERS.iter().find(|t| t.key == key)?;
    let level = t.steps.iter().filter(|s| value >= **s).count();
    if level == 0 {
        return None;
    }
    let next = t.steps.get(level).copied();
    let text = match key {
        "age" => {
            if value >= 12 {
                let rest = value % 12;
                format!(
                    "{}{}",
                    plural(value / 12, "ano", "anos"),
                    if rest != 0 {
                        format!(", {}", plural(rest, "mês", "meses"))
                    } else {
                        String::new()
                    }
                )
            } else {
                plural(value, "mês", "meses")
            }
        }
        "variety" => plural(value, "jogo jogado", "jogos jogados"),
        "playtime" => plural(value, "hora de jogo", "horas de jogo"),
        "gifts" => plural(value, "presente dado", "presentes dados"),
        _ => plural(value, "up recebido", "ups recebidos"),
    };
    Some(json!({
        "key": key,
        "label": t.label,
        "icon": t.icon,
        "level": level,
        "name": t.names[level - 1],
        "value": value,
        "next": next,
        "nextName": next.map(|_| t.names[level]),
        "text": text,
    }))
}

async fn count_or_zero(db: &Db, sql: &str, p: Vec<db::Value>) -> i64 {
    db::scalar::<i64>(db, sql, p)
        .await
        .ok()
        .flatten()
        .unwrap_or(0)
}

async fn stat_badges(db: &Db, user: &str, created: chrono::NaiveDateTime) -> Vec<Value> {
    let ms = (chrono::Utc::now().naive_utc() - created).num_milliseconds() as f64;
    let months = ((ms / (30.44 * 86_400_000.0)).floor() as i64).max(0);
    let variety = count_or_zero(
        db,
        "SELECT COUNT(*) FROM GamePlaytime WHERE userId = ?",
        params![user],
    )
    .await;
    let seconds: i64 = db::scalar::<Option<i64>>(
        db,
        "SELECT CAST(SUM(totalSeconds) AS SIGNED) FROM GamePlaytime WHERE userId = ?",
        params![user],
    )
    .await
    .ok()
    .flatten()
    .flatten()
    .unwrap_or(0);
    let gifts = count_or_zero(
        db,
        "SELECT COUNT(*) FROM EconomyTransaction WHERE userId = ? AND kind = 'GIFT'",
        params![user],
    )
    .await;
    let ups = count_or_zero(
        db,
        "SELECT COUNT(*) FROM ProfileVote WHERE toUserId = ? AND value = 1",
        params![user],
    )
    .await
        + count_or_zero(
            db,
            "SELECT COUNT(*) FROM PostVote v JOIN Post p ON p.id = v.postId WHERE v.value = 1 AND p.authorId = ?",
            params![user],
        )
        .await;
    let hours = seconds.div_euclid(3600);
    [
        stat("age", months),
        stat("variety", variety),
        stat("playtime", hours),
        stat("gifts", gifts),
        stat("ups", ups),
    ]
    .into_iter()
    .flatten()
    .collect()
}

// ---------------------------------------------------------------- atividade recente

fn day_str(d: chrono::NaiveDateTime) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn day_ms(day: &str) -> Option<i64> {
    chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc().timestamp_millis())
}

/// `recentActivity`: jogos dos últimos 30 dias, com "Novo jogador" e
/// "Retornando após N meses".
async fn recent_activity(db: &Db, user: &str) -> anyhow::Result<Vec<Value>> {
    let now = chrono::Utc::now().naive_utc();
    let cutoff = day_str(now - chrono::Duration::milliseconds(30 * 86_400_000));
    let rows = db::all(
        db,
        "SELECT gameKey, day, seconds FROM GamePlayDay WHERE userId = ? AND day >= ?",
        params![user, cutoff.as_str()],
    )
    .await?;
    if rows.is_empty() {
        return Ok(vec![]);
    }
    struct G {
        key: String,
        seconds: i64,
        first: String,
        last: String,
        days: i64,
    }
    let mut games: Vec<G> = Vec::new();
    for r in &rows {
        let key: String = db::get(r, "gameKey")?;
        let day: String = db::get(r, "day")?;
        let secs: i64 = db::get(r, "seconds")?;
        match games.iter_mut().find(|g| g.key == key) {
            Some(g) => {
                g.seconds += secs;
                g.days += 1;
                if day < g.first {
                    g.first = day.clone();
                }
                if day > g.last {
                    g.last = day;
                }
            }
            None => games.push(G {
                key,
                seconds: secs,
                first: day.clone(),
                last: day,
                days: 1,
            }),
        }
    }
    let marks = vec!["?"; games.len()].join(", ");
    let keys: Vec<db::Value> = games
        .iter()
        .map(|g| db::Value::from(g.key.as_str()))
        .collect();
    let mut p = params![user];
    p.extend(keys.clone());
    let meta = db::all(
        db,
        &format!("SELECT gameKey, name, iconUrl, steamAppId, firstPlayedAt FROM GamePlaytime WHERE userId = ? AND gameKey IN ({marks})"),
        p,
    )
    .await?;
    let mut p = params![user];
    p.extend(keys);
    p.push(cutoff.as_str().into());
    // `.catch(() => [])` no Node
    let before: HashMap<String, String> = db::all(
        db,
        &format!("SELECT gameKey, MAX(day) AS d FROM GamePlayDay WHERE userId = ? AND gameKey IN ({marks}) AND day < ? GROUP BY gameKey"),
        p,
    )
    .await
    .unwrap_or_default()
    .iter()
    .filter_map(|r| Some((db::get::<String>(r, "gameKey").ok()?, db::get::<Option<String>>(r, "d").ok()??)))
    .collect();
    let mut out: Vec<(String, i64, Value)> = Vec::new();
    for g in games {
        let Some(m) = meta
            .iter()
            .find(|m| db::get::<String>(m, "gameKey").is_ok_and(|k| k == g.key))
        else {
            continue;
        };
        let first_played: chrono::NaiveDateTime = db::get(m, "firstPlayedAt")?;
        let tag = match before.get(&g.key) {
            None if day_str(first_played) >= cutoff => json!("Novo jogador"),
            Some(prev) => {
                let gap = match (day_ms(&g.first), day_ms(prev)) {
                    (Some(a), Some(b)) => {
                        crate::routes::ctx::js_round((a - b) as f64 / 86_400_000.0) as i64
                    }
                    _ => 0,
                };
                if gap >= 45 {
                    let months = crate::routes::ctx::js_round(gap as f64 / 30.0) as i64;
                    json!(format!(
                        "Retornando após {} {}",
                        months.max(1),
                        if months > 1 { "meses" } else { "mês" }
                    ))
                } else {
                    Value::Null
                }
            }
            None => Value::Null,
        };
        out.push((
            g.last.clone(),
            g.seconds,
            json!({
                "gameKey": g.key,
                "name": db::get::<String>(m, "name")?,
                "iconUrl": db::get::<Option<String>>(m, "iconUrl")?,
                "steamAppId": db::get::<Option<i64>>(m, "steamAppId")?,
                "seconds": g.seconds,
                "days": g.days,
                "lastDay": g.last,
                "tag": tag,
            }),
        ));
    }
    // mais recente primeiro; empate = mais tempo
    out.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    Ok(out.into_iter().take(20).map(|(_, _, v)| v).collect())
}

// ---------------------------------------------------------------- lista de desejos

const WISH_KINDS: [&str; 4] = ["deco", "effect", "font", "style"];
const WISH_MAX: usize = 30;

/// `cleanWishlist`: `[{ kind, id, at }]` válidos e sem repetição (até 30).
fn clean_wishlist(raw: Option<&str>) -> Vec<Value> {
    let list = parse_or(raw, json!([]));
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for w in list.as_array().into_iter().flatten() {
        let Some(o) = w.as_object() else { continue };
        let Some(kind) = o
            .get("kind")
            .and_then(Value::as_str)
            .filter(|k| WISH_KINDS.contains(k))
        else {
            continue;
        };
        let Some(id) = o
            .get("id")
            .and_then(Value::as_str)
            .filter(|i| i.encode_utf16().count() <= 64)
        else {
            continue;
        };
        let k = format!("{kind}:{id}");
        if seen.contains(&k) {
            continue;
        }
        seen.push(k);
        let at = o
            .get("at")
            .filter(|a| truthy(a))
            .cloned()
            .unwrap_or(Value::Null);
        out.push(json!({ "kind": kind, "id": id, "at": at }));
        if out.len() >= WISH_MAX {
            break;
        }
    }
    out
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

/// `resolveWishlist`: os itens da lista com nome, prévia e preço.
async fn resolve_wishlist(db: &Db, list: &[Value]) -> anyhow::Result<Vec<Value>> {
    if list.is_empty() {
        return Ok(vec![]);
    }
    let ids = |kinds: &[&str]| -> Vec<String> {
        list.iter()
            .filter(|w| w["kind"].as_str().is_some_and(|k| kinds.contains(&k)))
            .filter_map(|w| w["id"].as_str().map(String::from))
            .collect()
    };
    let mut by: HashMap<String, Value> = HashMap::new();
    for (table, kind) in [("AvatarDecoration", "deco"), ("ProfileEffect", "effect")] {
        let wanted = ids(&[kind]);
        if wanted.is_empty() {
            continue;
        }
        let marks = vec!["?"; wanted.len()].join(", ");
        let rows = db::all(
            db,
            &format!("SELECT id, name, imageUrl, priceCoins, priceGems, active FROM `{table}` WHERE id IN ({marks})"),
            wanted.iter().map(|i| db::Value::from(i.as_str())).collect(),
        )
        .await?;
        for r in &rows {
            let id: String = db::get(r, "id")?;
            by.insert(
                format!("{kind}:{id}"),
                json!({
                    "name": db::get::<String>(r, "name")?,
                    "previewUrl": db::get::<Option<String>>(r, "imageUrl")?,
                    "data": null,
                    "priceCoins": db::get::<Option<i64>>(r, "priceCoins")?,
                    "priceGems": db::get::<Option<i64>>(r, "priceGems")?,
                    "active": db::get::<Option<bool>>(r, "active")?,
                }),
            );
        }
    }
    let wanted = ids(&["font", "style"]);
    if !wanted.is_empty() {
        let marks = vec!["?"; wanted.len()].join(", ");
        let rows = db::all(
            db,
            &format!("SELECT id, kind, name, previewUrl, data, priceCoins, priceGems, active FROM ShopItem WHERE id IN ({marks})"),
            wanted.iter().map(|i| db::Value::from(i.as_str())).collect(),
        )
        .await?;
        for r in &rows {
            let id: String = db::get(r, "id")?;
            let kind: String = db::get(r, "kind")?;
            let data: Option<String> = db::get(r, "data")?;
            let data = parse_or(data.as_deref(), json!({}));
            by.insert(
                format!("{}:{id}", if kind == "FONT" { "font" } else { "style" }),
                json!({
                    "name": db::get::<String>(r, "name")?,
                    "previewUrl": db::get::<Option<String>>(r, "previewUrl")?,
                    "data": if truthy(&data) { data } else { Value::Null },
                    "priceCoins": db::get::<Option<i64>>(r, "priceCoins")?,
                    "priceGems": db::get::<Option<i64>>(r, "priceGems")?,
                    "active": db::get::<Option<bool>>(r, "active")?,
                }),
            );
        }
    }
    Ok(list
        .iter()
        .filter_map(|w| {
            let kind = w["kind"].as_str()?;
            let id = w["id"].as_str()?;
            let it = by.get(&format!("{kind}:{id}"))?;
            let preview = it
                .get("previewUrl")
                .filter(|p| truthy(p))
                .cloned()
                .unwrap_or(Value::Null);
            Some(json!({
                "kind": kind,
                "id": id,
                "name": it["name"],
                "previewUrl": preview,
                "data": it["data"],
                "priceCoins": it["priceCoins"],
                "priceGems": it["priceGems"],
                "available": it["active"] != json!(false),
                "at": w["at"],
            }))
        })
        .collect())
}

// ---------------------------------------------------------------- rotas

/// `GET /{id}/extras`.
pub async fn get_extras(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let me = uid(&c).to_string();
        let db = &c.db;
        let Some(u) = db::first(
            db,
            "SELECT id, createdAt, profileWidgets, profileWishlist FROM `User` WHERE id = ?",
            params![id.as_str()],
        )
        .await?
        else {
            return Ok(err(StatusCode::NOT_FOUND, "Usuário não encontrado."));
        };
        let created: chrono::NaiveDateTime = db::get(&u, "createdAt")?;
        let widgets: Option<String> = db::get(&u, "profileWidgets")?;
        let wish: Option<String> = db::get(&u, "profileWishlist")?;
        let full = has_full_access(db, &me, &id).await?;
        let act = has_activity_access(db, &me, &id).await?;
        let friends = me == id
            || db::scalar::<String>(
                db,
                "SELECT id FROM Friendship WHERE status = 'ACCEPTED' AND ((requesterId = ? AND addresseeId = ?) OR (requesterId = ? AND addresseeId = ?)) LIMIT 1",
                params![me.as_str(), id.as_str(), id.as_str(), me.as_str()],
            )
            .await
            .ok()
            .flatten()
            .is_some();
        let stats = stat_badges(db, &id, created).await;
        let activity = if act {
            json!(recent_activity(db, &id).await.unwrap_or_default())
        } else {
            Value::Null
        };
        let wishlist = if friends {
            json!(resolve_wishlist(db, &clean_wishlist(wish.as_deref())).await.unwrap_or_default())
        } else {
            Value::Null
        };
        let note = if id != me {
            db::scalar::<String>(
                db,
                "SELECT text FROM UserNote WHERE ownerId = ? AND targetId = ?",
                params![me.as_str(), id.as_str()],
            )
            .await
            .ok()
            .flatten()
            .unwrap_or_default()
        } else {
            String::new()
        };
        Ok(reply(
            &c,
            json!({
                "widgets": if full { parse_or(widgets.as_deref(), Value::Null) } else { Value::Null },
                "wishlist": wishlist,
                "activity": activity,
                "stats": stats,
                "note": note,
                "options": {
                    "levels": LEVELS,
                    "feelings": FEELINGS,
                    "tags": TAGS,
                    "limits": { "liked": 20, "rotation": 5, "want": 20 },
                },
            }),
        ))
    }
    .await;
    finish(out, c.counted)
}

/// `PUT /me/widgets { widgets }`.
pub async fn set_widgets(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let widgets = sanitize_widgets(c.body.get("widgets"));
        let user = update_self_data(
            &c.db,
            uid(&c),
            vec![("profileWidgets".into(), crate::prisma_json::param(&widgets))],
        )
        .await?;
        node::after(&state, &[("profileChanged", uid(&c))]);
        Ok(reply(
            &c,
            json!({ "user": user, "widgets": parse_or(widgets.as_str(), Value::Null) }),
        ))
    }
    .await;
    finish(out, c.counted)
}

async fn my_list(db: &Db, user: &str) -> anyhow::Result<Vec<Value>> {
    let raw: Option<Option<String>> = db::scalar(
        db,
        "SELECT profileWishlist FROM `User` WHERE id = ?",
        params![user],
    )
    .await?;
    Ok(clean_wishlist(raw.flatten().as_deref()))
}

/// `GET /me/wishlist`.
pub async fn my_wishlist(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let list = my_list(&c.db, uid(&c)).await?;
        let items = resolve_wishlist(&c.db, &list).await?;
        Ok(reply(&c, json!({ "wishlist": list, "items": items })))
    }
    .await;
    finish(out, c.counted)
}

/// `findItem` do shopController: o item existe (e é do tipo certo)?
async fn item_exists(db: &Db, kind: &str, id: &str) -> db::DbResult<bool> {
    let (sql, k): (&str, Option<&str>) = match kind {
        "deco" => ("SELECT id FROM AvatarDecoration WHERE id = ?", None),
        "effect" => ("SELECT id FROM ProfileEffect WHERE id = ?", None),
        "font" => ("SELECT kind FROM ShopItem WHERE id = ?", Some("FONT")),
        _ => ("SELECT kind FROM ShopItem WHERE id = ?", Some("STYLE")),
    };
    let got: Option<String> = db::scalar(db, sql, params![id]).await?;
    Ok(match (got, k) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(found), Some(want)) => found == want,
    })
}

/// `POST /me/wishlist { kind, id, on? }`.
pub async fn toggle_wishlist(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let kind = c
            .body
            .get("kind")
            .and_then(Value::as_str)
            .filter(|k| WISH_KINDS.contains(k));
        let id = c
            .body
            .get("id")
            .and_then(Value::as_str)
            .map(|i| crate::routes::ctx::js_slice(i, 64))
            .filter(|i| !i.is_empty());
        let (Some(kind), Some(id)) = (kind, id) else {
            return Ok(err(StatusCode::BAD_REQUEST, "Item inválido."));
        };
        if !item_exists(&c.db, kind, &id).await? {
            return Ok(err(StatusCode::NOT_FOUND, "Item não encontrado."));
        }
        let mut list = my_list(&c.db, uid(&c)).await?;
        let has = list
            .iter()
            .any(|w| w["kind"] == kind && w["id"] == id.as_str());
        let want = c.body.get("on").and_then(Value::as_bool).unwrap_or(!has);
        if want && !has {
            if list.len() >= WISH_MAX {
                return Ok(err(
                    StatusCode::BAD_REQUEST,
                    &format!("A lista de desejos aceita até {WISH_MAX} itens."),
                ));
            }
            let at = db::iso(chrono::Utc::now().naive_utc());
            list.insert(0, json!({ "kind": kind, "id": id, "at": at }));
        } else if !want && has {
            list.retain(|w| !(w["kind"] == kind && w["id"] == id.as_str()));
        }
        let stored = if list.is_empty() {
            db::Value::NULL
        } else {
            js::stringify(&json!(list)).into()
        };
        db::exec(
            &c.db,
            "UPDATE `User` SET profileWishlist = ?, updatedAt = ? WHERE id = ?",
            params![stored, db::now(), uid(&c)],
        )
        .await?;
        Ok(reply(&c, json!({ "wishlist": list, "on": want })))
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estatisticas_como_o_node() {
        let s = stat("age", 14).unwrap();
        assert_eq!(s["text"], "1 ano, 2 meses");
        assert_eq!(s["level"], 4);
        assert_eq!(s["name"], "Tronco");
        assert_eq!(s["next"], 24);
        assert_eq!(s["nextName"], "Árvore antiga");
        assert!(stat("ups", 9).is_none());
        let top = stat("gifts", 50).unwrap();
        assert_eq!(
            (top["next"].clone(), top["nextName"].clone()),
            (Value::Null, Value::Null)
        );
        assert_eq!(stat("age", 0).unwrap()["text"], "0 meses");
    }

    #[test]
    fn mural_do_perfil() {
        assert_eq!(sanitize_widgets(Some(&json!({}))), Value::Null);
        assert_eq!(sanitize_widgets(Some(&json!("lixo"))), Value::Null);
        let v = sanitize_widgets(Some(&json!({
            "favorite": { "gameKey": " mc ", "name": "Minecraft", "comment": "top", "tags": ["PvP", "PvP", "x"] },
            "rotation": [{ "gameKey": "a", "name": "A", "level": "Casual", "feeling": "nada" }, { "gameKey": "a", "name": "A2" }],
            "order": ["want", "lixo"],
            "hidden": ["liked", "liked"],
        })));
        assert_eq!(
            v,
            json!(
                r#"{"favorite":{"gameKey":"mc","name":"Minecraft","comment":"top","tags":["PvP"]},"rotation":[{"gameKey":"a","name":"A","level":"Casual","feeling":null,"tags":[]}],"liked":[],"want":[],"order":["want","favorite","rotation","liked"],"hidden":["liked"]}"#
            )
        );
    }

    #[test]
    fn lista_de_desejos() {
        let l = clean_wishlist(Some(
            r#"[{"kind":"deco","id":"1","at":0},{"kind":"deco","id":"1"},{"kind":"x","id":"2"},"lixo",{"kind":"font","id":"3","at":"2026"}]"#,
        ));
        assert_eq!(
            l,
            vec![
                json!({ "kind": "deco", "id": "1", "at": null }),
                json!({ "kind": "font", "id": "3", "at": "2026" })
            ]
        );
        assert!(clean_wishlist(Some("{")).is_empty());
    }
}
