//! Perfil de outra pessoa: privacidade, amigos em comum, votos, insígnias.

mod common;

use std::time::Duration;

use common::{Env, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn get(env: &Env, path: &str, user: &str) -> (u16, Value) {
    let r = reqwest::Client::new()
        .get(format!("http://{}{path}", env.gw))
        .header("x-forwarded-for", "10.99.0.1")
        .bearer_auth(Tokens::new(SECRET).sign(user, Duration::from_secs(900)))
        .send()
        .await
        .unwrap();
    let st = r.status().as_u16();
    (st, r.json().await.unwrap_or(Value::Null))
}

fn uid(p: &str) -> String {
    format!("{p}{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

async fn exec(env: &Env, sql: String) {
    if let Err(e) = env.db.execute(sql.as_str()).await {
        panic!("{sql}: {e}");
    }
}

async fn friends(env: &Env, a: &str, b: &str) {
    exec(env, format!("INSERT INTO Friendship (id, requesterId, addresseeId, status, updatedAt, acceptedAt) VALUES (UUID(), '{a}', '{b}', 'ACCEPTED', UTC_TIMESTAMP(3), '2026-05-05 10:00:00.000')")).await;
}

#[tokio::test]
async fn perfil_com_privacidade() {
    let Some(env) = setup().await else { return };
    if env.redis_url.is_none() {
        return;
    }
    let (me, alvo, comum) = (uid("eu"), uid("alvo"), uid("comum"));
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &alvo, ", bio, status, accountXp, displayedAchievements|, 'minha bio', 'INVISIBLE', 278, '[\"a1\",\"nada\"]'").await;
    add_user(&env.db, &comum, "").await;
    exec(&env, format!("INSERT INTO UserSettings (id, userId, profilePrivacy, updatedAt) VALUES (UUID(), '{alvo}', 'friends', UTC_TIMESTAMP(3))")).await;

    let (st, _) = get(&env, "/api/users/ninguem", &me).await;
    assert_eq!(st, 404);

    // sem amizade: perfil restrito
    let (st, b) = get(&env, &format!("/api/users/{alvo}"), &me).await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["profileRestricted"], true);
    assert_eq!(b["user"]["bio"], Value::Null);
    assert_eq!(b["user"]["displayedAchievements"], "[]");
    assert_eq!(b["user"]["status"], "OFFLINE", "invisível aparece offline");
    assert!(
        b["user"]["publicId"].as_str().is_some_and(|p| p.len() == 9),
        "ganha número público"
    );
    assert_eq!(b["badges"], json!([]));
    assert_eq!(b["levelProgress"], 50);
    assert_eq!(b["friendsSince"], Value::Null);

    // amigos: perfil completo, amigo em comum, desde quando, votos e conquistas
    friends(&env, &me, &alvo).await;
    friends(&env, &comum, &me).await;
    friends(&env, &alvo, &comum).await;
    exec(&env, format!("INSERT INTO ProfileVote (id, fromUserId, toUserId, value) VALUES (UUID(), '{me}', '{alvo}', 1)")).await;
    exec(&env, format!("INSERT INTO ProfileVote (id, fromUserId, toUserId, value) VALUES (UUID(), '{comum}', '{alvo}', -1)")).await;
    exec(&env, "INSERT INTO Badge (id, `key`, name, icon, priority) VALUES ('b2', 'k2', 'Segunda', 'x', 2), ('b1', 'k1', 'Primeira', 'x', 1)".into()).await;
    exec(&env, format!("INSERT INTO UserBadge (id, userId, badgeId) VALUES (UUID(), '{alvo}', 'b2'), (UUID(), '{alvo}', 'b1')")).await;
    exec(&env, "INSERT INTO Achievement (id, `key`, name, description, progressType, target) VALUES ('a1', 'a1', 'Conquista', 'd', 'COUNT', 1)".into()).await;

    let (_, b) = get(&env, &format!("/api/users/{alvo}"), &me).await;
    assert_eq!(b["profileRestricted"], false, "{b}");
    assert_eq!(b["user"]["bio"], "minha bio");
    assert_eq!(b["mutualFriends"].as_array().unwrap().len(), 1);
    assert_eq!(b["mutualFriends"][0]["id"], comum.as_str());
    assert_eq!(b["friendsSince"], "2026-05-05T10:00:00.000Z");
    assert_eq!(
        (
            b["likeCount"].clone(),
            b["dislikeCount"].clone(),
            b["myVote"].clone()
        ),
        (json!(1), json!(1), json!(1))
    );
    assert_eq!(b["totalUps"], 1);
    let names: Vec<&str> = b["badges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Primeira", "Segunda"]);
    assert!(b["badges"][0]["awardedAt"].is_string());
    assert_eq!(
        b["displayedAchievements"].as_array().unwrap().len(),
        1,
        "a que não existe some"
    );
    assert_eq!(b["featuredItem"], Value::Null);

    // a própria pessoa se vê invisível e sem "amigos desde"
    let (_, b) = get(&env, &format!("/api/users/{alvo}"), &alvo).await;
    assert_eq!(b["user"]["status"], "INVISIBLE");
    assert_eq!(b["friendsSince"], Value::Null);
    assert_eq!(b["mutualFriends"], json!([]));
}
