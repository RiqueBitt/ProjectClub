//! Loja (controllers/shopController.js) — por enquanto a cestinha:
//! `POST /api/decorations/checkout`, que compra vários itens de uma vez,
//! TUDO OU NADA, numa transação só.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::http::request::Parts;
use axum::response::Response;
use chrono::NaiveDateTime;
use mysql_async::prelude::Queryable;
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::auth::error;
use crate::db::{self, DbError};
use crate::params;
use crate::routes::ctx::{
    err, finish, js_slice, js_string, js_to_number, js_to_string, js_trim, prelude_or_return, uid,
};
use crate::routes::users::reply;

const CHECKOUT_MAX: usize = 20;

/// Um tipo de item da Loja (`KINDS` do shopController).
struct Kind {
    label: &'static str,
    item: &'static str,
    own: &'static str,
    fk: &'static str,
    /// font/style dividem a tabela `ShopItem` (`kind` = FONT/STYLE).
    shop_kind: Option<&'static str>,
}

fn kind_of(key: &str) -> Option<&'static Kind> {
    const DECO: Kind = Kind {
        label: "moldura",
        item: "AvatarDecoration",
        own: "UserAvatarDecoration",
        fk: "decorationId",
        shop_kind: None,
    };
    const EFFECT: Kind = Kind {
        label: "efeito",
        item: "ProfileEffect",
        own: "UserProfileEffect",
        fk: "effectId",
        shop_kind: None,
    };
    const FONT: Kind = Kind {
        label: "fonte",
        item: "ShopItem",
        own: "UserShopItem",
        fk: "itemId",
        shop_kind: Some("FONT"),
    };
    const STYLE: Kind = Kind {
        label: "estilo",
        item: "ShopItem",
        own: "UserShopItem",
        fk: "itemId",
        shop_kind: Some("STYLE"),
    };
    match key {
        "deco" => Some(&DECO),
        "effect" => Some(&EFFECT),
        "font" => Some(&FONT),
        "style" => Some(&STYLE),
        _ => None,
    }
}

/// `TIER_LABEL`.
fn tier_label(t: &str) -> &'static str {
    match t {
        "SUPER" => "Super Assinante",
        "SUBSCRIBER" => "Assinante",
        _ => "Membro",
    }
}

/// `normalizeTier`.
fn normalize_tier(t: Option<&str>) -> &'static str {
    match t {
        Some("SUBSCRIBER") => "SUBSCRIBER",
        Some("SUPER") => "SUPER",
        _ => "NONE",
    }
}

/// Preço de um item numa moeda (`priceFor`): `(final, discount)`;
/// `final = None` = não é vendido nessa moeda.
fn price_for(base: Option<i64>, discount_eligible: bool, tier: &str) -> (Option<i64>, i64) {
    let pct = if tier == "NONE" || !discount_eligible {
        0
    } else if tier == "SUPER" {
        20
    } else {
        10
    };
    let Some(base) = base else {
        return (None, pct);
    };
    // `applyPct`: o desconto arredonda pra baixo
    let fin = if pct > 0 {
        (base - (base * pct).div_euclid(100)).max(0)
    } else {
        base
    };
    (Some(fin), pct)
}

/// O que interrompe a compra (desfaz a transação).
enum Stop {
    /// `fail(msg, status, extra)` → `{ error, ...extra }`
    Fail(StatusCode, String, Map<String, Value>),
    Db(DbError),
}

impl From<DbError> for Stop {
    fn from(e: DbError) -> Self {
        Stop::Db(e)
    }
}

impl From<mysql_async::Error> for Stop {
    fn from(e: mysql_async::Error) -> Self {
        Stop::Db(DbError::Driver(e))
    }
}

fn fail(status: StatusCode, msg: impl Into<String>, extra: Value) -> Stop {
    let extra = match extra {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    Stop::Fail(status, msg.into(), extra)
}

/// `fail(...)` com o `itemIndex` do item que travou (no fim do `extra`).
fn at(mut s: Stop, i: usize) -> Stop {
    if let Stop::Fail(_, _, extra) = &mut s {
        extra.insert("itemIndex".into(), json!(i));
    }
    s
}

struct Line {
    kind_raw: Value,
    kind: &'static Kind,
    id: String,
    currency: &'static str,
    expected: Option<Value>,
}

struct Ready {
    line_idx: usize,
    item_id: String,
    name: String,
    stock: Option<i64>,
    paid: i64,
    discount: i64,
    already: bool,
}

/// `POST /api/decorations/checkout { items: [{ kind, id, currency, expectedPrice }] }`.
pub async fn checkout(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let raw: &[Value] = match c.body.get("items") {
            Some(Value::Array(a)) => a,
            _ => &[],
        };
        if raw.is_empty() {
            return Ok(err(StatusCode::BAD_REQUEST, "A cestinha está vazia."));
        }
        if raw.len() > CHECKOUT_MAX {
            return Ok(err(
                StatusCode::BAD_REQUEST,
                &format!("No máximo {CHECKOUT_MAX} itens por compra."),
            ));
        }
        let mut lines: Vec<Option<Line>> = Vec::with_capacity(raw.len());
        for x in raw {
            let get = |k: &str| x.as_object().and_then(|m| m.get(k));
            // `hasOwnProperty.call(KINDS, v)`: a chave é `String(v)`
            let kind = get("kind").and_then(|v| kind_of(&js_to_string(v)));
            let id = js_string(get("id"));
            lines.push(kind.map(|k| Line {
                kind_raw: get("kind").cloned().unwrap_or(Value::Null),
                kind: k,
                id,
                currency: if get("currency").and_then(Value::as_str) == Some("gems") {
                    "gems"
                } else {
                    "coins"
                },
                expected: get("expectedPrice").cloned(),
            }));
        }
        let mut seen = HashSet::new();
        for (i, l) in lines.iter().enumerate() {
            let Some(l) = l.as_ref().filter(|l| !l.id.is_empty()) else {
                return Ok(error(
                    StatusCode::BAD_REQUEST,
                    json!({ "error": "Item inválido na cestinha.", "itemIndex": i }),
                ));
            };
            let key = format!("{}:{}", js_to_string(&l.kind_raw), l.id);
            if !seen.insert(key) {
                return Ok(error(
                    StatusCode::BAD_REQUEST,
                    json!({ "error": "O mesmo item está duas vezes na cestinha.", "itemIndex": i }),
                ));
            }
        }
        let lines: Vec<Line> = lines.into_iter().flatten().collect();
        let user_id = uid(&c).to_string();

        let mut conn = c.db.get_conn().await?;
        let mut tx = conn.start_transaction(mysql_async::TxOpts::default()).await?;
        let result = buy_all(&mut tx, &user_id, &lines).await;
        let bought = match result {
            Ok(b) => {
                tx.commit().await?;
                b
            }
            Err(stop) => {
                let _ = tx.rollback().await;
                return match stop {
                    Stop::Fail(status, msg, extra) => {
                        let mut body = Map::new();
                        body.insert("error".into(), Value::String(msg));
                        body.extend(extra);
                        Ok(error(status, Value::Object(body)))
                    }
                    Stop::Db(e) if db::is_unique_violation(&e) => Ok(error(
                        StatusCode::BAD_REQUEST,
                        json!({ "error": "Você já tem um dos itens da cestinha.", "code": "ALREADY_OWNED" }),
                    )),
                    Stop::Db(e) => Err(e.into()),
                };
            }
        };
        drop(conn);

        let mut list = Vec::with_capacity(bought.len());
        for b in &bought {
            let l = &lines[b.line_idx];
            if b.paid > 0 {
                let mut label = js_trim(&format!("Loja (cestinha): {} {}", l.kind.label, b.name)).to_string();
                if b.discount > 0 {
                    label.push_str(&format!(" (-{}% Assinante)", b.discount));
                }
                record_transaction(&c.db, &user_id, &js_slice(&label, 180), l.currency, -b.paid).await;
            }
            list.push(json!({
                "kind": l.kind_raw,
                "id": b.item_id,
                "name": b.name,
                "label": l.kind.label,
                "currency": l.currency,
                "paid": b.paid,
                "discount": b.discount,
            }));
        }
        let mut res = Map::new();
        res.insert("ok".into(), Value::Bool(true));
        res.insert("bought".into(), Value::Array(list));
        if let Some(r) = db::first(&c.db, "SELECT coins, gems FROM `User` WHERE id = ?", params![user_id.as_str()]).await? {
            res.insert("coins".into(), db::col(&r, "coins", db::Ty::Int)?);
            res.insert("gems".into(), db::col(&r, "gems", db::Ty::Int)?);
        }
        Ok(reply(&c, Value::Object(res)))
    }
    .await;
    finish(out, c.counted)
}

/// `economyLedger.recordTransaction` (melhor esforço: erro não trava nada).
async fn record_transaction(db: &db::Db, user_id: &str, label: &str, currency: &str, amount: i64) {
    let (coins, gems) = if currency == "gems" {
        (0, amount)
    } else {
        (amount, 0)
    };
    let r = db::exec(
        db,
        "INSERT INTO EconomyTransaction (id, userId, kind, label, coins, gems, xp, createdAt) \
         VALUES (?, ?, 'SHOP', ?, ?, ?, 0, ?)",
        params![db::new_id(), user_id, label, coins, gems, db::now()],
    )
    .await;
    if let Err(e) = r {
        tracing::warn!("[economyLedger] {e}");
    }
}

/// O miolo da transação: confere tudo, cobra e entrega.
async fn buy_all(
    tx: &mut mysql_async::Transaction<'_>,
    user_id: &str,
    lines: &[Line],
) -> Result<Vec<Ready>, Stop> {
    let tier_raw: Option<Option<String>> = tx
        .exec_first("SELECT supporterTier FROM `User` WHERE id = ?", (user_id,))
        .await?;
    let tier = normalize_tier(tier_raw.flatten().as_deref());
    let (mut coins, mut gems) = (0i64, 0i64);
    let mut ready = Vec::with_capacity(lines.len());
    for (i, l) in lines.iter().enumerate() {
        let k = l.kind;
        let kind_col = if k.shop_kind.is_some() {
            "kind"
        } else {
            "NULL AS kind"
        };
        let sql = format!(
            "SELECT id, name, active, priceCoins, priceGems, discountEligible, exclusiveTier, \
             collectionId, stock, {kind_col} FROM `{}` WHERE id = ?",
            k.item
        );
        let row: Option<mysql_async::Row> = tx.exec_first(sql, (l.id.as_str(),)).await?;
        let row = row.filter(|r| {
            k.shop_kind.is_none()
                || db::get::<Option<String>>(r, "kind")
                    .ok()
                    .flatten()
                    .as_deref()
                    == k.shop_kind
        });
        let active = match &row {
            Some(r) => db::get::<bool>(r, "active")?,
            None => false,
        };
        let Some(row) = row.filter(|_| active) else {
            return Err(at(
                fail(
                    StatusCode::NOT_FOUND,
                    "Um item da cestinha não está mais à venda.",
                    json!({ "code": "NOT_FOUND" }),
                ),
                i,
            ));
        };
        let item_id: String = db::get(&row, "id")?;
        let name: String = db::get(&row, "name")?;
        if let Some(col) = db::get::<Option<String>>(&row, "collectionId")? {
            let show: Option<bool> = tx
                .exec_first(
                    "SELECT showInShop FROM ShopCollection WHERE id = ?",
                    (col.as_str(),),
                )
                .await?;
            if show == Some(false) {
                return Err(at(
                    fail(
                        StatusCode::FORBIDDEN,
                        format!("\"{name}\" não está à venda na Loja."),
                        json!({ "code": "NOT_FOR_SALE" }),
                    ),
                    i,
                ));
            }
        }
        let exclusive = db::get::<Option<String>>(&row, "exclusiveTier")?
            .filter(|t| t == "SUBSCRIBER" || t == "SUPER");
        if let Some(t) = exclusive {
            return Err(at(
                fail(
                    StatusCode::FORBIDDEN,
                    format!(
                        "\"{name}\" é exclusivo de {}: não é vendido.",
                        tier_label(&t)
                    ),
                    json!({ "code": "EXCLUSIVE" }),
                ),
                i,
            ));
        }
        let base: Option<i64> = db::get(
            &row,
            if l.currency == "gems" {
                "priceGems"
            } else {
                "priceCoins"
            },
        )?;
        let (fin, discount) = price_for(base, db::get(&row, "discountEligible")?, tier);
        let Some(fin) = fin else {
            return Err(at(
                fail(
                    StatusCode::BAD_REQUEST,
                    format!("\"{name}\" não é vendido nessa moeda."),
                    Value::Null,
                ),
                i,
            ));
        };
        let own_sql = format!(
            "SELECT expiresAt FROM `{}` WHERE userId = ? AND `{}` = ?",
            k.own, k.fk
        );
        let already: Option<Option<NaiveDateTime>> =
            tx.exec_first(own_sql, (user_id, item_id.as_str())).await?;
        if matches!(already, Some(None)) {
            return Err(at(
                fail(
                    StatusCode::BAD_REQUEST,
                    format!("Você já tem \"{name}\"."),
                    json!({ "code": "ALREADY_OWNED" }),
                ),
                i,
            ));
        }
        // `checkExpected`: o preço que a pessoa confirmou na tela
        let expected = l
            .expected
            .as_ref()
            .filter(|v| !v.is_null() && v.as_str() != Some(""));
        if let Some(v) = expected {
            let exp = js_to_number(Some(v));
            if !exp.is_finite() || exp != fin as f64 {
                return Err(at(
                    fail(
                        StatusCode::CONFLICT,
                        "O preço mudou. Confira o valor novo e confirme de novo.",
                        json!({ "code": "PRICE_CHANGED", "price": fin }),
                    ),
                    i,
                ));
            }
        }
        if l.currency == "gems" {
            gems += fin;
        } else {
            coins += fin;
        }
        ready.push(Ready {
            line_idx: i,
            item_id,
            name,
            stock: db::get(&row, "stock")?,
            paid: fin,
            discount,
            already: already.is_some(),
        });
    }

    for (cur, total) in [("coins", coins), ("gems", gems)] {
        if total <= 0 {
            continue;
        }
        let sql = format!(
            "UPDATE `User` SET `{cur}` = `{cur}` - ?, updatedAt = ? WHERE id = ? AND `{cur}` >= ?"
        );
        tx.exec_drop(sql, (total, db::now(), user_id, total))
            .await?;
        if tx.affected_rows() == 0 {
            let msg = if cur == "gems" {
                "Gemas insuficientes."
            } else {
                "Moedas insuficientes."
            };
            return Err(fail(
                StatusCode::BAD_REQUEST,
                msg,
                json!({ "code": "INSUFFICIENT_FUNDS" }),
            ));
        }
    }

    for r in &ready {
        let k = lines[r.line_idx].kind;
        if r.already {
            let sql = format!(
                "UPDATE `{}` SET expiresAt = NULL WHERE userId = ? AND `{}` = ?",
                k.own, k.fk
            );
            tx.exec_drop(sql, (user_id, r.item_id.as_str())).await?;
            continue;
        }
        // `claimStock`: limitado reserva uma cópia e pega o número de série
        let serial: Option<i64> = match r.stock {
            None => None,
            Some(_) => {
                let sql = format!(
                    "UPDATE `{}` SET sold = sold + 1 WHERE id = ? AND sold < stock",
                    k.item
                );
                tx.exec_drop(sql, (r.item_id.as_str(),)).await?;
                if tx.affected_rows() == 0 {
                    return Err(fail(
                        StatusCode::CONFLICT,
                        "Esgotado! Esse item limitado não tem mais estoque.",
                        json!({ "code": "SOLD_OUT" }),
                    ));
                }
                let sql = format!("SELECT sold FROM `{}` WHERE id = ?", k.item);
                tx.exec_first(sql, (r.item_id.as_str(),)).await?
            }
        };
        let sql = format!(
            "INSERT INTO `{}` (id, userId, `{}`, serial, createdAt) VALUES (?, ?, ?, ?, ?)",
            k.own, k.fk
        );
        tx.exec_drop(
            sql,
            (db::new_id(), user_id, r.item_id.as_str(), serial, db::now()),
        )
        .await?;
    }
    Ok(ready)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preco_igual_ao_supporters_js() {
        assert_eq!(price_for(Some(100), true, "NONE"), (Some(100), 0));
        assert_eq!(price_for(Some(105), true, "SUBSCRIBER"), (Some(95), 10));
        assert_eq!(price_for(Some(105), true, "SUPER"), (Some(84), 20));
        assert_eq!(price_for(Some(105), false, "SUPER"), (Some(105), 0));
        assert_eq!(price_for(Some(-5), true, "SUBSCRIBER"), (Some(0), 10));
        assert_eq!(price_for(Some(-5), true, "NONE"), (Some(-5), 0));
        assert_eq!(price_for(None, true, "SUPER"), (None, 20));
    }
}
