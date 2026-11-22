//! Cestinha da Loja (`POST /api/decorations/checkout`): tudo ou nada.

mod common;

use std::time::Duration;

use common::{Env, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn call(env: &Env, user: &str, body: Value) -> (u16, Value) {
    let n = uuid::Uuid::new_v4().as_u128();
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/decorations/checkout", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.9.{}.{}", (n >> 8) as u8, n as u8),
        )
        .bearer_auth(Tokens::new(SECRET).sign(user, Duration::from_secs(900)))
        .json(&body)
        .send()
        .await
        .unwrap();
    let st = r.status().as_u16();
    (st, r.json().await.unwrap_or(Value::Null))
}

fn uid(p: &str) -> String {
    format!("{p}{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

async fn coins(env: &Env, user: &str) -> (i64, i64) {
    sqlx::query_as("SELECT coins, gems FROM `User` WHERE id = ?")
        .bind(user)
        .fetch_one(&env.db)
        .await
        .unwrap()
}

async fn owned(env: &Env, user: &str) -> i64 {
    let a: i64 = sqlx::query_scalar(
        "SELECT (SELECT COUNT(*) FROM UserAvatarDecoration WHERE userId = ?) + \
         (SELECT COUNT(*) FROM UserProfileEffect WHERE userId = ?) + \
         (SELECT COUNT(*) FROM UserShopItem WHERE userId = ?)",
    )
    .bind(user)
    .bind(user)
    .bind(user)
    .fetch_one(&env.db)
    .await
    .unwrap();
    a
}

#[tokio::test]
async fn cestinha() {
    let Some(env) = setup().await else {
        return;
    };
    let me = uid("eu");
    add_user(
        &env.db,
        &me,
        ", coins, gems, supporterTier|, 300, 10, 'SUBSCRIBER'",
    )
    .await;
    env.db
        .execute(
            "INSERT INTO AvatarDecoration (id, name, imageUrl, priceCoins, priceGems) VALUES \
             ('d1', 'Moldura A', 'x', 105, NULL), ('d2', 'Moldura B', 'x', 50, 4); \
             INSERT INTO AvatarDecoration (id, name, imageUrl, priceCoins, stock, sold) VALUES \
             ('d3', 'Limitada', 'x', 10, 2, 1), ('d4', 'Esgotada', 'x', 10, 1, 1); \
             INSERT INTO AvatarDecoration (id, name, imageUrl, priceCoins, exclusiveTier) VALUES \
             ('d5', 'Exclusiva', 'x', 10, 'SUPER'); \
             INSERT INTO AvatarDecoration (id, name, imageUrl, priceCoins, active) VALUES \
             ('d6', 'Fora', 'x', 10, 0); \
             INSERT INTO ShopCollection (id, name, showInShop) VALUES ('col', 'Oculta', 0); \
             INSERT INTO ProfileEffect (id, name, imageUrl, priceCoins, collectionId) VALUES \
             ('e1', 'Efeito oculto', 'x', 10, 'col'); \
             INSERT INTO ShopItem (id, kind, name, priceCoins, discountEligible) VALUES \
             ('f1', 'FONT', 'Fonte', 30, 0), ('s1', 'STYLE', 'Estilo', 20, 1);",
        )
        .await
        .unwrap();

    // validação antes de tudo
    let (st, b) = call(&env, &me, json!({ "items": [] })).await;
    assert_eq!((st, b), (400, json!({ "error": "A cestinha está vazia." })));
    let many: Vec<Value> = (0..21)
        .map(|i| json!({ "kind": "deco", "id": i }))
        .collect();
    let (st, b) = call(&env, &me, json!({ "items": many })).await;
    assert_eq!(
        (st, b),
        (400, json!({ "error": "No máximo 20 itens por compra." }))
    );
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [{ "kind": "deco", "id": "d1" }, { "kind": "x", "id": "d2" }] }),
    )
    .await;
    assert_eq!(
        (st, b),
        (
            400,
            json!({ "error": "Item inválido na cestinha.", "itemIndex": 1 })
        )
    );
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [{ "kind": "deco", "id": "d1" }, { "kind": "deco", "id": "d1" }] }),
    )
    .await;
    assert_eq!(
        (st, b),
        (
            400,
            json!({ "error": "O mesmo item está duas vezes na cestinha.", "itemIndex": 1 })
        )
    );

    // cada trava diz qual item foi
    let cases = [
        (
            json!({ "kind": "deco", "id": "d6" }),
            404,
            json!({ "error": "Um item da cestinha não está mais à venda.", "code": "NOT_FOUND", "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "font", "id": "s1" }),
            404,
            json!({ "error": "Um item da cestinha não está mais à venda.", "code": "NOT_FOUND", "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "effect", "id": "e1" }),
            403,
            json!({ "error": "\"Efeito oculto\" não está à venda na Loja.", "code": "NOT_FOR_SALE", "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "deco", "id": "d5" }),
            403,
            json!({ "error": "\"Exclusiva\" é exclusivo de Super Assinante: não é vendido.", "code": "EXCLUSIVE", "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "deco", "id": "d1", "currency": "gems" }),
            400,
            json!({ "error": "\"Moldura A\" não é vendido nessa moeda.", "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "deco", "id": "d2", "expectedPrice": 50 }),
            409,
            json!({ "error": "O preço mudou. Confira o valor novo e confirme de novo.", "code": "PRICE_CHANGED", "price": 45, "itemIndex": 1 }),
        ),
        (
            json!({ "kind": "deco", "id": "d4" }),
            409,
            json!({ "error": "Esgotado! Esse item limitado não tem mais estoque.", "code": "SOLD_OUT" }),
        ),
    ];
    for (item, status, want) in cases {
        let (st, b) = call(
            &env,
            &me,
            json!({ "items": [{ "kind": "style", "id": "s1" }, item] }),
        )
        .await;
        assert_eq!((st, &b), (status, &want), "{want}");
    }
    // nada foi cobrado nem entregue
    assert_eq!(coins(&env, &me).await, (300, 10));
    assert_eq!(owned(&env, &me).await, 0);

    // compra: Assinante tem 10% (menos na fonte), limitado ganha número de série
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [
            { "kind": "deco", "id": "d1", "expectedPrice": "95" },
            { "kind": "deco", "id": "d2", "currency": "gems" },
            { "kind": "deco", "id": "d3" },
            { "kind": "font", "id": "f1", "expectedPrice": null },
        ]}),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(
        b,
        json!({
            "ok": true,
            "bought": [
                { "kind": "deco", "id": "d1", "name": "Moldura A", "label": "moldura", "currency": "coins", "paid": 95, "discount": 10 },
                { "kind": "deco", "id": "d2", "name": "Moldura B", "label": "moldura", "currency": "gems", "paid": 4, "discount": 10 },
                { "kind": "deco", "id": "d3", "name": "Limitada", "label": "moldura", "currency": "coins", "paid": 9, "discount": 10 },
                { "kind": "font", "id": "f1", "name": "Fonte", "label": "fonte", "currency": "coins", "paid": 30, "discount": 0 },
            ],
            "coins": 300 - 95 - 9 - 30,
            "gems": 6,
        })
    );
    let serial: Option<i64> = sqlx::query_scalar(
        "SELECT serial FROM UserAvatarDecoration WHERE userId = ? AND decorationId = 'd3'",
    )
    .bind(&me)
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!(serial, Some(2));
    let labels: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT label, coins, gems FROM EconomyTransaction WHERE userId = ? ORDER BY label",
    )
    .bind(&me)
    .fetch_all(&env.db)
    .await
    .unwrap();
    assert_eq!(
        labels,
        vec![
            ("Loja (cestinha): fonte Fonte".into(), -30, 0),
            (
                "Loja (cestinha): moldura Limitada (-10% Assinante)".into(),
                -9,
                0
            ),
            (
                "Loja (cestinha): moldura Moldura A (-10% Assinante)".into(),
                -95,
                0
            ),
            (
                "Loja (cestinha): moldura Moldura B (-10% Assinante)".into(),
                0,
                -4
            ),
        ]
    );

    // já tem
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [{ "kind": "deco", "id": "d1" }] }),
    )
    .await;
    assert_eq!(
        (st, b),
        (
            400,
            json!({ "error": "Você já tem \"Moldura A\".", "code": "ALREADY_OWNED", "itemIndex": 0 })
        )
    );
    // item com prazo (missão): comprar deixa pra sempre
    env.db
        .execute(
            format!(
                "INSERT INTO UserShopItem (id, userId, itemId, expiresAt) VALUES ('us1', '{me}', 's1', UTC_TIMESTAMP() + INTERVAL 1 DAY)"
            )
            .as_str(),
        )
        .await
        .unwrap();
    // sem saldo: nada muda
    env.db
        .execute(format!("UPDATE `User` SET coins = 10 WHERE id = '{me}'").as_str())
        .await
        .unwrap();
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [{ "kind": "style", "id": "s1" }] }),
    )
    .await;
    assert_eq!(
        (st, b),
        (
            400,
            json!({ "error": "Moedas insuficientes.", "code": "INSUFFICIENT_FUNDS" })
        )
    );
    env.db
        .execute(format!("UPDATE `User` SET coins = 18 WHERE id = '{me}'").as_str())
        .await
        .unwrap();
    let (st, b) = call(
        &env,
        &me,
        json!({ "items": [{ "kind": "style", "id": "s1" }] }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["coins"], 0);
    let exp: Option<chrono::NaiveDateTime> =
        sqlx::query_scalar("SELECT expiresAt FROM UserShopItem WHERE id = 'us1'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert!(exp.is_none());
}
