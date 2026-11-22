//! `/api/missions/season*`: o Passe do clube (pontos, níveis e resgate).

mod common;

use std::time::Duration;

use chrono::{Datelike, Utc};
use common::{Env, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn call(env: &Env, method: &str, path: &str, user: &str, body: Value) -> (u16, Value) {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.9.{}.{}", (n >> 8) as u8, n as u8),
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

/// A chave da temporada de agora (mês em Brasília), como o servidor calcula.
fn season_key() -> String {
    let t = Utc::now().naive_utc() - chrono::Duration::hours(3);
    format!("{}-{:02}", t.year(), t.month())
}

async fn pass(env: &Env, user: &str, points: i64, free: &str, plus: &str) {
    let sql = format!(
        "INSERT INTO SeasonPass (userId, seasonKey, points, claimedFree, claimedPlus, updatedAt) \
         VALUES ('{user}', '{}', {points}, '{free}', '{plus}', UTC_TIMESTAMP(3))",
        season_key()
    );
    env.db.execute(sql.as_str()).await.unwrap();
}

#[tokio::test]
async fn passe_do_clube() {
    let Some(env) = setup().await else {
        return;
    };
    env.redis_url.as_ref().expect("precisa do Redis de teste");

    // sem nada ainda: nível 0, nada liberado, não é assinante
    let novo = uid("nv");
    add_user(&env.db, &novo, "").await;
    let (st, b) = call(&env, "GET", "/api/missions/season", &novo, Value::Null).await;
    assert_eq!(st, 200, "{b}");
    let keys: Vec<&str> = b.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "key",
            "name",
            "endsAt",
            "points",
            "level",
            "maxLevel",
            "levelPoints",
            "pointsPerMission",
            "isSupporter",
            "tiers"
        ]
    );
    assert_eq!(b["key"], json!(season_key()));
    assert!(b["name"].as_str().unwrap().starts_with("Temporada "));
    assert!(b["endsAt"].as_str().unwrap().ends_with("-01T03:00:00.000Z"));
    assert_eq!(
        (
            &b["points"],
            &b["level"],
            &b["maxLevel"],
            &b["levelPoints"],
            &b["isSupporter"]
        ),
        (&json!(0), &json!(0), &json!(30), &json!(100), &json!(false))
    );
    assert_eq!(b["pointsPerMission"], json!({ "daily": 10, "weekly": 40 }));
    let tiers = b["tiers"].as_array().unwrap();
    assert_eq!(tiers.len(), 30);
    assert_eq!(
        tiers[0],
        json!({ "level": 1, "unlocked": false, "free": { "coins": 45, "gems": 0 }, "plus": { "coins": 65, "gems": 1 }, "claimedFree": false, "claimedPlus": false })
    );
    assert_eq!(tiers[4]["free"], json!({ "coins": 150, "gems": 3 }));
    assert_eq!(tiers[29]["plus"], json!({ "coins": 450, "gems": 25 }));
    // sem pontos não resgata
    let (st, e) = call(
        &env,
        "POST",
        "/api/missions/season/claim",
        &novo,
        json!({ "level": 1, "track": "free" }),
    )
    .await;
    assert_eq!(
        (st, e["error"].as_str()),
        (400, Some("Você ainda não chegou nesse nível."))
    );

    // assinante com 640 pontos: nível 6; já resgatou o 1 e o 2 na faixa grátis
    let sub = uid("sb");
    add_user(
        &env.db,
        &sub,
        ", coins, gems, supporterTier|, 1000, 5, 'SUBSCRIBER'",
    )
    .await;
    pass(&env, &sub, 640, "[1,2]", "[]").await;
    let (st, b) = call(&env, "GET", "/api/missions/season", &sub, Value::Null).await;
    assert_eq!(
        (st, &b["points"], &b["level"], &b["isSupporter"]),
        (200, &json!(640), &json!(6), &json!(true))
    );
    let tiers = b["tiers"].as_array().unwrap();
    assert_eq!(
        (&tiers[5]["unlocked"], &tiers[6]["unlocked"]),
        (&json!(true), &json!(false))
    );
    assert_eq!(
        (
            &tiers[1]["claimedFree"],
            &tiers[2]["claimedFree"],
            &tiers[1]["claimedPlus"]
        ),
        (&json!(true), &json!(false), &json!(false))
    );

    // entradas inválidas
    for (body, msg) in [
        (json!({ "level": 0, "track": "free" }), "Nível inválido."),
        (json!({ "level": 31, "track": "free" }), "Nível inválido."),
        (
            json!({ "level": "abc", "track": "free" }),
            "Nível inválido.",
        ),
        (json!({ "level": 3, "track": "ouro" }), "Faixa inválida."),
        (json!({ "level": 3 }), "Faixa inválida."),
        (
            json!({ "level": 7, "track": "free" }),
            "Você ainda não chegou nesse nível.",
        ),
        (
            json!({ "level": 2, "track": "free" }),
            "Prêmio já resgatado.",
        ),
    ] {
        let (st, e) = call(
            &env,
            "POST",
            "/api/missions/season/claim",
            &sub,
            body.clone(),
        )
        .await;
        assert_eq!((st, e["error"].as_str()), (400, Some(msg)), "{body}");
    }

    // resgata o nível 5 (marco) na faixa de apoio: 200 moedas e 8 gemas
    let (st, b) = call(
        &env,
        "POST",
        "/api/missions/season/claim",
        &sub,
        json!({ "level": "5", "track": "plus" }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(
        b,
        json!({ "reward": { "coins": 200, "gems": 8 }, "balance": { "coins": 1200, "gems": 13 } })
    );
    let (free, plus): (String, String) =
        sqlx::query_as("SELECT claimedFree, claimedPlus FROM SeasonPass WHERE userId = ?")
            .bind(&sub)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!((free.as_str(), plus.as_str()), ("[1,2]", "[5]"));
    let (label, c, g): (String, i32, i32) = sqlx::query_as(
        "SELECT label, coins, gems FROM EconomyTransaction WHERE userId = ? AND kind = 'MISSION'",
    )
    .bind(&sub)
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert!(
        label.starts_with("Temporada ") && label.ends_with(": nível 5 (apoio)"),
        "{label}"
    );
    assert_eq!((c, g), (200, 8));
    // e o mesmo prêmio não sai duas vezes
    let (st, e) = call(
        &env,
        "POST",
        "/api/missions/season/claim",
        &sub,
        json!({ "level": 5, "track": "plus" }),
    )
    .await;
    assert_eq!(
        (st, e["error"].as_str()),
        (400, Some("Prêmio já resgatado."))
    );

    // dois cliques ao mesmo tempo no mesmo prêmio: só um vale
    let (a, b2) = tokio::join!(
        call(
            &env,
            "POST",
            "/api/missions/season/claim",
            &sub,
            json!({ "level": 3, "track": "free" })
        ),
        call(
            &env,
            "POST",
            "/api/missions/season/claim",
            &sub,
            json!({ "level": 3, "track": "free" })
        )
    );
    assert_eq!(
        [a.0, b2.0].iter().filter(|s| **s == 200).count(),
        1,
        "{a:?} {b2:?}"
    );
    let (coins,): (i32,) = sqlx::query_as("SELECT coins FROM `User` WHERE id = ?")
        .bind(&sub)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(coins, 1200 + 55);

    // quem não assina junta pontos, mas não resgata (nenhuma das faixas)
    let free_user = uid("fr");
    add_user(&env.db, &free_user, "").await;
    pass(&env, &free_user, 300, "[]", "[]").await;
    let (st, e) = call(
        &env,
        "POST",
        "/api/missions/season/claim",
        &free_user,
        json!({ "level": 1, "track": "free" }),
    )
    .await;
    assert_eq!(
        (st, e["error"].as_str()),
        (403, Some("O passe do clube é para Assinantes."))
    );

    // sem login
    let r = reqwest::Client::new()
        .get(format!("http://{}/api/missions/season", env.gw))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 401);
}
