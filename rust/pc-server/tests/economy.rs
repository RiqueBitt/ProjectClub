//! `/api/economy`: carteira, cartão, baús, rank, ranking e admin dos baús.

mod common;

use std::time::Duration;

use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn env() -> Option<(Env, Calls)> {
    let calls: Calls = Default::default();
    let node = fake_node(calls.clone()).await;
    let env = setup_with(|c| pc_server::config::Config {
        node_upstream: format!("http://{node}"),
        ..c
    })
    .await?;
    env.redis_url.as_ref()?;
    Some((env, calls))
}

async fn call(env: &Env, method: &str, path: &str, user: &str, body: Value) -> (u16, Value) {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.8.{}.{}", (n >> 8) as u8, n as u8),
        )
        .bearer_auth(Tokens::new(SECRET).sign(user, Duration::from_secs(900)));
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let st = r.status().as_u16();
    (st, r.json().await.unwrap_or(Value::Null))
}

fn uid(p: &str) -> String {
    format!("{p}{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

async fn realtime_calls(calls: &Calls) -> Vec<Value> {
    tokio::time::sleep(Duration::from_millis(200)).await;
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == "/api/internal/realtime")
        .map(|(_, _, b)| b.clone())
        .collect()
}

#[tokio::test]
async fn carteira_e_cartao() {
    let Some((env, _calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(
        &env.db,
        &me,
        ", coins, gems, accountLevel, accountXp, lastDailyAt|, 120, 3, 2, 600, UTC_TIMESTAMP(3) - INTERVAL 1 HOUR",
    )
    .await;

    let (st, body) = call(&env, "GET", "/api/economy", &me, Value::Null).await;
    assert_eq!(st, 200);
    let keys: Vec<&str> = body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "coins",
            "gems",
            "dailyStreak",
            "lastDailyAt",
            "accountLevel",
            "accountXp",
            "streakRequired",
            "nextDailyAt",
            "cardStyle",
            "cardStyles"
        ]
    );
    assert_eq!(body["coins"], 120);
    assert_eq!(body["streakRequired"], 5);
    assert!(body["nextDailyAt"].is_string());
    assert_eq!(body["cardStyle"], "DEFAULT");
    assert_eq!(body["cardStyles"], json!(["DEFAULT"]));

    // estilo: inválido 400, dourado sem assinatura 403, arco-íris 403
    let (st, b) = call(
        &env,
        "PUT",
        "/api/economy/card-style",
        &me,
        json!({ "style": "x" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].as_str()),
        (400, Some("Estilo de cartão inválido."))
    );
    let (st, b) = call(
        &env,
        "PUT",
        "/api/economy/card-style",
        &me,
        json!({ "style": "gold" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].as_str()),
        (403, Some("O cartão dourado é de Assinante."))
    );
    let (st, b) = call(
        &env,
        "PUT",
        "/api/economy/card-style",
        &me,
        json!({ "style": "RAINBOW" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].as_str()),
        (403, Some("O cartão arco-íris é do Super Assinante."))
    );

    // virou Super: pode tudo
    env.db
        .execute(format!("UPDATE `User` SET supporterTier = 'SUPER' WHERE id = '{me}'").as_str())
        .await
        .unwrap();
    let (st, b) = call(
        &env,
        "PUT",
        "/api/economy/card-style",
        &me,
        json!({ "style": "gold" }),
    )
    .await;
    assert_eq!(st, 200);
    assert_eq!(
        b,
        json!({ "style": "GOLD", "styles": ["DEFAULT", "GOLD", "RAINBOW"] })
    );
    let (_, body) = call(&env, "GET", "/api/economy", &me, Value::Null).await;
    assert_eq!(body["cardStyle"], "GOLD");

    // mostrar o cartão: 201, depois espera 10 s (429)
    let (st, b) = call(&env, "POST", "/api/economy/card/share", &me, Value::Null).await;
    assert_eq!(st, 201);
    let id = b["id"].as_str().unwrap().to_string();
    let (st, b) = call(&env, "POST", "/api/economy/card/share", &me, Value::Null).await;
    assert_eq!(
        (st, b["error"].as_str()),
        (
            429,
            Some("Espere uns segundos pra mostrar o cartão de novo.")
        )
    );

    let other = uid("ou");
    add_user(&env.db, &other, "").await;
    let (st, b) = call(
        &env,
        "GET",
        &format!("/api/economy/card/{id}"),
        &other,
        Value::Null,
    )
    .await;
    assert_eq!(st, 200);
    assert_eq!(b["card"]["coins"], 120);
    assert_eq!(b["card"]["level"], 2);
    assert_eq!(b["card"]["style"], "GOLD");
    let ck: Vec<&str> = b["card"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(ck, ["id", "coins", "gems", "level", "style", "createdAt"]);
    assert_eq!(b["user"]["id"], me.as_str());
    let uk: Vec<&str> = b["user"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        uk,
        [
            "id",
            "displayName",
            "username",
            "avatarUrl",
            "avatarDecoration",
            "profileColor",
            "createdAt"
        ]
    );
    let (st, b) = call(&env, "GET", "/api/economy/card/nada", &other, Value::Null).await;
    assert_eq!(
        (st, b["error"].as_str()),
        (404, Some("Cartão não encontrado."))
    );
}

#[tokio::test]
async fn sistema_desligado() {
    let Some((env, _calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, "").await;
    let admin = uid("ad");
    add_user(&env.db, &admin, ", platformRole|, 'ADMIN'").await;
    env.db
        .execute("INSERT INTO PlatformSettings (id, disabledSystems) VALUES ('singleton', '[\"economia\"]')")
        .await
        .unwrap();
    let (st, b) = call(&env, "GET", "/api/economy", &me, Value::Null).await;
    assert_eq!(st, 503);
    assert_eq!(
        b,
        json!({ "error": "Este sistema está temporariamente desativado pela equipe.", "systemDisabled": "economia" })
    );
    // o cartão mostrado não tem trava; o rank é outro sistema
    let (st, _) = call(&env, "GET", "/api/economy/card/x", &me, Value::Null).await;
    assert_eq!(st, 404);
    let (st, _) = call(&env, "GET", "/api/economy/rank", &me, Value::Null).await;
    assert_eq!(st, 200);
    // ADMIN passa
    let (st, _) = call(&env, "GET", "/api/economy", &admin, Value::Null).await;
    assert_eq!(st, 200);
    // lista quebrada: JSON inválido = nada desligado; número = erro (500)
    env.db
        .execute("UPDATE PlatformSettings SET disabledSystems = 'oi'")
        .await
        .unwrap();
    assert_eq!(
        call(&env, "GET", "/api/economy", &me, Value::Null).await.0,
        200
    );
    env.db
        .execute("UPDATE PlatformSettings SET disabledSystems = '5'")
        .await
        .unwrap();
    assert_eq!(
        call(&env, "GET", "/api/economy", &me, Value::Null).await.0,
        500
    );
}

#[tokio::test]
async fn rank_e_ranking() {
    let Some((env, _calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, ", accountLevel, accountXp|, 1, 278").await;
    let (st, b) = call(&env, "GET", "/api/economy/rank", &me, Value::Null).await;
    assert_eq!(st, 200);
    assert_eq!(
        b,
        json!({
            "level": 1, "levelName": "Lv.1", "levelTitle": "Novato", "xp": 278,
            "nextLevel": 2, "xpInLevel": 278, "xpNeeded": 556, "progress": 50,
            "isMaxLevel": false, "position": 1,
        })
    );

    for i in 0..55 {
        let id = format!("r{i:02}{}", &me[2..8]);
        add_user(&env.db, &id, &format!(", accountXp|, {}", 1000 + i)).await;
    }
    let (st, b) = call(&env, "GET", "/api/economy/leaderboard", &me, Value::Null).await;
    assert_eq!(st, 200);
    let list = b["leaderboard"].as_array().unwrap();
    assert_eq!(list.len(), 51);
    assert_eq!(list[0]["accountXp"], 1054);
    assert_eq!(list[49]["accountXp"], 1005);
    assert!(list[49].get("outsideTop50").is_none());
    assert_eq!(list[50]["id"], me.as_str());
    assert_eq!(list[50]["outsideTop50"], true);
    let (_, b) = call(&env, "GET", "/api/economy/rank", &me, Value::Null).await;
    assert_eq!(b["position"], 56);
}

#[tokio::test]
async fn admin_dos_baus() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, "").await;
    let admin = uid("ad");
    add_user(&env.db, &admin, ", platformRole|, 'ADMIN'").await;

    let (st, b) = call(&env, "GET", "/api/economy/admin/chests", &me, Value::Null).await;
    assert_eq!(
        (st, b["error"].as_str()),
        (
            403,
            Some("Acesso restrito a administradores da plataforma.")
        )
    );

    let (st, b) = call(
        &env,
        "POST",
        "/api/economy/admin/chests",
        &admin,
        json!({ "name": "" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].as_str()),
        (400, Some("Nome é obrigatório."))
    );
    // tipo errado = erro de validação do Prisma (500)
    let (st, _) = call(
        &env,
        "POST",
        "/api/economy/admin/chests",
        &admin,
        json!({ "name": 5 }),
    )
    .await;
    assert_eq!(st, 500);

    let (st, b) = call(
        &env,
        "POST",
        "/api/economy/admin/chests",
        &admin,
        json!({ "name": "Bronze", "chanceRegular": "0.5x", "coinsMin": " 3.9", "coinsMax": "abc", "imageClosed": "" }),
    )
    .await;
    assert_eq!(st, 201);
    let chest = &b["chest"];
    assert_eq!(chest["name"], "Bronze");
    assert_eq!(chest["chanceRegular"], 0.5);
    assert_eq!(chest["chanceSubscriber"], 0);
    assert_eq!(chest["coinsMin"], 3);
    assert_eq!(chest["coinsMax"], 10);
    assert_eq!(chest["ticketsMin"], 0);
    assert_eq!(chest["position"], 0);
    assert_eq!(chest["enabled"], true);
    assert!(chest["imageClosed"].is_null());
    let keys: Vec<&str> = chest
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "id",
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
            "imageOpened"
        ]
    );
    let id = chest["id"].as_str().unwrap().to_string();

    let path = format!("/api/economy/admin/chests/{id}");
    let (st, b) = call(
        &env,
        "PATCH",
        &path,
        &admin,
        json!({ "enabled": false, "position": "7", "imageOpened": null, "outro": 1 }),
    )
    .await;
    assert_eq!(st, 200);
    assert_eq!(b["chest"]["enabled"], false);
    assert_eq!(b["chest"]["position"], 7);
    // nada pra mudar: devolve igual
    let (st, b) = call(&env, "PATCH", &path, &admin, json!({})).await;
    assert_eq!((st, b["chest"]["position"].clone()), (200, json!(7)));
    let (st, _) = call(&env, "PATCH", &path, &admin, json!({ "enabled": "sim" })).await;
    assert_eq!(st, 500);
    let (st, _) = call(
        &env,
        "PATCH",
        "/api/economy/admin/chests/nada",
        &admin,
        json!({}),
    )
    .await;
    assert_eq!(st, 500);

    // galeria pública só mostra os ligados
    let (_, b) = call(&env, "GET", "/api/economy/chests", &me, Value::Null).await;
    assert_eq!(b, json!({ "chests": [] }));

    let (st, b) = call(&env, "DELETE", &path, &admin, Value::Null).await;
    assert_eq!((st, b), (200, json!({ "ok": true })));
    let (st, _) = call(&env, "DELETE", &path, &admin, Value::Null).await;
    assert_eq!(st, 500);

    // cada mudança avisou a comunidade com `chests:update` sem payload
    let rt = realtime_calls(&calls).await;
    assert_eq!(rt.len(), 4, "{rt:?}");
    for r in rt {
        assert_eq!(
            r,
            json!({ "emits": [{ "to": ["community"], "event": "chests:update", "payload": null, "bare": true }] })
        );
    }
}

async fn internal_calls(calls: &Calls, path: &str) -> Vec<Value> {
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == path)
        .map(|(_, _, b)| b.clone())
        .collect()
}

#[tokio::test]
async fn bau_diario() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, ", coins, gems, dailyStreak|, 100, 2, 3").await;

    // sem nenhum baú ligado
    env.db
        .execute("INSERT INTO DailyChest (id, name, chanceRegular, coinsMin, coinsMax, position, enabled) VALUES ('off', 'Desligado', 1, 900, 900, 0, 0)")
        .await
        .unwrap();
    let (st, b) = call(&env, "POST", "/api/economy/daily", &me, Value::Null).await;
    assert_eq!(
        (st, b["error"].as_str()),
        (400, Some("Nenhum baú diário configurado."))
    );

    env.db
        .execute("INSERT INTO DailyChest (id, name, chanceRegular, coinsMin, coinsMax, position, enabled, imageClosed, imageOpened) VALUES ('c1', 'Comum', 1, 10, 20, 1, 1, 'fechado.png', 'aberto.png')")
        .await
        .unwrap();

    // primeiro resgate da vida: sequência vira 1 (nunca resgatou antes)
    let (st, b) = call(&env, "POST", "/api/economy/daily", &me, Value::Null).await;
    assert_eq!(st, 200, "{b}");
    let keys: Vec<&str> = b.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "chestName",
            "chestImageClosed",
            "chestImageOpened",
            "coins",
            "streak",
            "streakRequired",
            "megaAwarded",
            "megaGems",
            "balance",
            "newAchievements"
        ]
    );
    let coins = b["coins"].as_i64().unwrap();
    assert!((10..=20).contains(&coins), "{coins}");
    assert_eq!(
        (
            &b["chestName"],
            &b["chestImageClosed"],
            &b["chestImageOpened"]
        ),
        (&json!("Comum"), &json!("fechado.png"), &json!("aberto.png"))
    );
    assert_eq!(
        (
            &b["streak"],
            &b["streakRequired"],
            &b["megaAwarded"],
            &b["megaGems"]
        ),
        (&json!(1), &json!(5), &json!(false), &json!(0))
    );
    assert_eq!(
        b["balance"],
        json!({ "coins": 100 + coins, "gems": 2, "dailyStreak": 1 })
    );
    assert_eq!(b["newAchievements"], json!([]));
    // o Node foi avisado (missão "baú do dia" + conquistas) com o segredo interno
    let told = internal_calls(&calls, "/api/internal/daily-claimed").await;
    assert_eq!(told, vec![json!({ "userId": me })]);
    // ficou no registro da carteira
    let (kind, label, c, g): (String, String, i32, i32) =
        sqlx::query_as("SELECT kind, label, coins, gems FROM EconomyTransaction WHERE userId = ?")
            .bind(&me)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(
        (kind.as_str(), label.as_str(), c as i64, g),
        ("DAILY", "Baú diário: Comum", coins, 0)
    );

    // de novo no mesmo dia: 400 e nada muda
    let (st, b) = call(&env, "POST", "/api/economy/daily", &me, Value::Null).await;
    assert_eq!(
        (st, b["error"].as_str()),
        (400, Some("Você já resgatou a recompensa diária hoje."))
    );
    let (now_coins,): (i32,) = sqlx::query_as("SELECT coins FROM `User` WHERE id = ?")
        .bind(&me)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(now_coins as i64, 100 + coins);

    // 4 dias seguidos + resgate dentro das 48h = Mega Baú: gemas e a sequência zera
    let mega = uid("mg");
    add_user(
        &env.db,
        &mega,
        ", coins, gems, dailyStreak, lastDailyAt|, 0, 1, 4, UTC_TIMESTAMP(3) - INTERVAL 25 HOUR",
    )
    .await;
    let (st, b) = call(&env, "POST", "/api/economy/daily", &mega, Value::Null).await;
    assert_eq!(st, 200, "{b}");
    let gems = b["megaGems"].as_i64().unwrap();
    assert!((1..=6).contains(&gems), "{gems}");
    assert_eq!((&b["megaAwarded"], &b["streak"]), (&json!(true), &json!(0)));
    assert_eq!(b["balance"]["gems"], json!(1 + gems));
    assert_eq!(b["balance"]["dailyStreak"], json!(0));
    let (n,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM EconomyTransaction WHERE userId = ? AND label = 'Mega Baú (sequência completa)' AND gems = ?",
    )
    .bind(&mega)
    .bind(gems)
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!(n, 1);

    // mais de 48h sem resgatar: a sequência recomeça do 1
    let late = uid("lt");
    add_user(
        &env.db,
        &late,
        ", dailyStreak, lastDailyAt|, 3, UTC_TIMESTAMP(3) - INTERVAL 49 HOUR",
    )
    .await;
    let (st, b) = call(&env, "POST", "/api/economy/daily", &late, Value::Null).await;
    assert_eq!(
        (st, &b["streak"], &b["megaAwarded"]),
        (200, &json!(1), &json!(false))
    );

    // dois cliques ao mesmo tempo: só um abre o baú
    let twice = uid("tw");
    add_user(&env.db, &twice, ", coins|, 0").await;
    let (a, b) = tokio::join!(
        call(&env, "POST", "/api/economy/daily", &twice, Value::Null),
        call(&env, "POST", "/api/economy/daily", &twice, Value::Null)
    );
    let mut sts = [a.0, b.0];
    sts.sort_unstable();
    assert_eq!(sts, [200, 400]);
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM EconomyTransaction WHERE userId = ?")
        .bind(&twice)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
}
