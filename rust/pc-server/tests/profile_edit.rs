//! Editar perfil, trocar a ClubTag, votar, conquistas exibidas, denúncia,
//! mural e lista de desejos.

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
            format!("10.7.{}.{}", (n >> 8) as u8, n as u8),
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

async fn after_calls(calls: &Calls) -> Vec<Value> {
    tokio::time::sleep(Duration::from_millis(200)).await;
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == "/api/internal/after")
        .map(|(_, _, b)| b.clone())
        .collect()
}

#[tokio::test]
async fn editar_perfil() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, "").await;

    // nada válido: não grava (updatedAt igual)
    let before: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT updatedAt FROM `User` WHERE id = ?")
            .bind(&me)
            .fetch_one(&env.db)
            .await
            .unwrap();
    let (st, _) = call(
        &env,
        "PATCH",
        "/api/users/me",
        &me,
        json!({ "profileNameFont": "x", "statusBubbleColor": "#123456" }),
    )
    .await;
    assert_eq!(st, 200);
    let after: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT updatedAt FROM `User` WHERE id = ?")
            .bind(&me)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(before, after);
    assert!(after_calls(&calls).await.is_empty());

    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me",
        &me,
        json!({
            "displayName": "Novo Nome",
            "bio": "oi",
            "youtubeUrl": " youtube.com/@x ",
            "steamUrl": "",
            "bannerFraming": "50,33.33,1.234",
            "profileSectionOrder": "[\"about\",{\"key\":\"album\",\"hidden\":true}]",
            "profileNameColors": "[\"#AABBCC\",\"#000000\"]",
            "profileNameFont": "PIXEL",
            "avatarUrl": "penguin:red",
            "birthDate": "2000-05-06",
            "profileSectionOpacity": "40",
            "customStatusEmoji": 7,
            "profileShowcase": { "games": [{ "gameKey": "mc", "name": "Minecraft", "steamAppId": 123 }] }
        }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    let u = &b["user"];
    assert_eq!(u["displayName"], "Novo Nome");
    assert_eq!(u["youtubeUrl"], "https://youtube.com/@x");
    assert_eq!(u["steamUrl"], Value::Null);
    assert_eq!(u["bannerFraming"], "50,33.3,1.23");
    assert_eq!(u["profileNameColors"], "[\"#AABBCC\",\"#000000\"]");
    assert_eq!(u["profileNameFont"], "PIXEL");
    assert_eq!(u["avatarUrl"], "penguin:red");
    assert_eq!(u["profileSectionOpacity"], 40);
    assert_eq!(u["customStatusEmoji"], "7");
    let showcase: String = sqlx::query_scalar("SELECT profileShowcase FROM `User` WHERE id = ?")
        .bind(&me)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(
        showcase,
        r#"{"games":[{"gameKey":"mc","name":"Minecraft","steamAppId":"123"}]}"#
    );
    let a = after_calls(&calls).await;
    assert_eq!(
        a[0]["actions"][0],
        json!({ "name": "profileChanged", "userId": me })
    );

    // tipo errado: o Prisma recusa (500)
    let (st, _) = call(
        &env,
        "PATCH",
        "/api/users/me",
        &me,
        json!({ "displayName": 5 }),
    )
    .await;
    assert_eq!(st, 500);

    // cores desligadas pela staff
    env.db
        .execute("INSERT INTO PlatformSettings (id, disabledSystems) VALUES ('singleton', '[\"cores_perfil\"]')")
        .await
        .unwrap();
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me",
        &me,
        json!({ "profileColor": "#FF0000", "miniProfileColor": "#00FF00" }),
    )
    .await;
    assert_eq!(b["user"]["profileColor"], "#1877F2");
    assert_eq!(b["user"]["miniProfileColor"], Value::Null);
}

#[tokio::test]
async fn clubtag() {
    let Some((env, _)) = env().await else { return };
    let me = uid("eu");
    let other = uid("ou");
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &other, "").await;
    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": "ab" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].clone()),
        (
            400,
            json!("A ClubTag deve ter de 4 a 32 caracteres: letras, números, _ ou ponto.")
        )
    );
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": "Sta.ff" }),
    )
    .await;
    assert_eq!(b["error"], "Essa ClubTag é reservada. Escolha outra.");
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": me }),
    )
    .await;
    assert_eq!(b["error"], "Essa já é a sua ClubTag.");
    let (st, _) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": other.to_uppercase() }),
    )
    .await;
    assert_eq!(st, 409, "o banco não diferencia maiúsculas");
    let novo = uid("novo");
    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": format!(" {novo} ") }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    assert_eq!(b["user"]["username"], novo.as_str());
    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me/username",
        &me,
        json!({ "username": uid("outro") }),
    )
    .await;
    assert_eq!(st, 429);
    assert!(
        b["error"]
            .as_str()
            .unwrap()
            .contains("uma vez a cada 7 dias")
    );
    assert!(b["retryAt"].as_str().unwrap().ends_with('Z'));
}

#[tokio::test]
async fn votos_conquistas_e_denuncia() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid("eu");
    let other = uid("ou");
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &other, ", bio, pronouns|, 'bio dele', 'ele/dele'").await;

    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{me}/vote"),
        &me,
        json!({ "value": 1 }),
    )
    .await;
    assert_eq!(b["error"], "Você não pode votar no seu próprio perfil.");
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/vote"),
        &me,
        json!({ "value": 2 }),
    )
    .await;
    assert_eq!(b["error"], "Valor de voto inválido.");
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/vote"),
        &me,
        json!({ "value": 1 }),
    )
    .await;
    assert_eq!(b, json!({ "likeCount": 1, "dislikeCount": 0, "myVote": 1 }));
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/vote"),
        &me,
        json!({ "value": -1 }),
    )
    .await;
    assert_eq!(
        b,
        json!({ "likeCount": 0, "dislikeCount": 1, "myVote": -1 })
    );
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/vote"),
        &me,
        json!({ "value": -1 }),
    )
    .await;
    assert_eq!(
        b,
        json!({ "likeCount": 0, "dislikeCount": 0, "myVote": 0 }),
        "de novo tira o voto"
    );
    let a = after_calls(&calls).await;
    assert_eq!(
        a[0]["actions"],
        json!([{ "name": "ups", "userId": other }, { "name": "achievements", "userId": other }])
    );

    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/displayed-achievements",
        &me,
        json!({ "slot": "x" }),
    )
    .await;
    assert_eq!(b["error"], "Slot inválido.");
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/displayed-achievements",
        &me,
        json!({ "slot": "mini", "achievementIds": [1, 2, 3, 4, 5] }),
    )
    .await;
    assert_eq!(b["error"], "Escolha no máximo 4 conquistas.");
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/displayed-achievements",
        &me,
        json!({ "slot": "mini", "achievementIds": ["nao"] }),
    )
    .await;
    assert_eq!(
        b["error"],
        "Você só pode exibir conquistas que já desbloqueou."
    );
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/displayed-achievements",
        &me,
        json!({ "slot": "profile", "achievementIds": [] }),
    )
    .await;
    assert_eq!(b["user"]["displayedAchievements"], "[]");

    let (st, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/report"),
        &me,
        json!({ "category": "spam", "details": "muito   spam" }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    let id = b["report"]["id"].as_str().unwrap().to_string();
    assert_eq!(b["report"]["status"], "PENDING");
    let (snippet, reason): (String, String) =
        sqlx::query_as("SELECT snippet, reason FROM Report WHERE id = ?")
            .bind(&id)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(
        snippet,
        format!("Perfil: Nome {other} (@{other})\nPronomes: ele/dele\nBio: bio dele")
    );
    assert_eq!(reason, "Spam: muito spam");
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{other}/report"),
        &me,
        json!({ "category": "spam" }),
    )
    .await;
    assert_eq!(b["alreadyReported"], true);
    assert_eq!(b["report"]["id"], id.as_str());
    let (_, b) = call(
        &env,
        "POST",
        &format!("/api/users/{me}/report"),
        &me,
        json!({ "category": "spam" }),
    )
    .await;
    assert_eq!(b["error"], "Você não pode denunciar seu próprio perfil.");
}

#[tokio::test]
async fn mural_e_lista_de_desejos() {
    let Some((env, _)) = env().await else { return };
    let me = uid("eu");
    let other = uid("ou");
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &other, "").await;
    env.db
        .execute("INSERT INTO AvatarDecoration (id, name, imageUrl, priceCoins) VALUES ('d1', 'Moldura', '/m.png', 50)")
        .await
        .unwrap();

    let (_, b) = call(
        &env,
        "PUT",
        "/api/users/me/widgets",
        &me,
        json!({ "widgets": { "liked": [{ "gameKey": "a", "name": "A" }] } }),
    )
    .await;
    assert_eq!(b["widgets"]["liked"][0]["gameKey"], "a");
    assert_eq!(
        b["widgets"]["order"],
        json!(["favorite", "rotation", "liked", "want"])
    );

    let (st, b) = call(
        &env,
        "POST",
        "/api/users/me/wishlist",
        &me,
        json!({ "kind": "deco", "id": "" }),
    )
    .await;
    assert_eq!((st, b["error"].clone()), (400, json!("Item inválido.")));
    let (st, _) = call(
        &env,
        "POST",
        "/api/users/me/wishlist",
        &me,
        json!({ "kind": "font", "id": "d1" }),
    )
    .await;
    assert_eq!(st, 404);
    let (_, b) = call(
        &env,
        "POST",
        "/api/users/me/wishlist",
        &me,
        json!({ "kind": "deco", "id": "d1" }),
    )
    .await;
    assert_eq!(b["on"], true);
    let (_, b) = call(&env, "GET", "/api/users/me/wishlist", &me, Value::Null).await;
    assert_eq!(b["items"][0]["name"], "Moldura");
    assert_eq!(b["items"][0]["previewUrl"], "/m.png");
    assert_eq!(b["items"][0]["available"], true);

    // o mural é de quem pode ver o perfil; a lista de desejos só de amigos
    let (_, b) = call(
        &env,
        "GET",
        &format!("/api/users/{me}/extras"),
        &other,
        Value::Null,
    )
    .await;
    assert_eq!(b["widgets"]["liked"][0]["name"], "A", "{b}");
    assert_eq!(b["wishlist"], Value::Null);
    assert_eq!(b["note"], "");
    assert_eq!(b["stats"][0]["key"], "age");
    assert_eq!(
        b["options"]["limits"],
        json!({ "liked": 20, "rotation": 5, "want": 20 })
    );
    let (_, b) = call(
        &env,
        "GET",
        &format!("/api/users/{me}/extras"),
        &me,
        Value::Null,
    )
    .await;
    assert_eq!(b["wishlist"][0]["id"], "d1");
    assert_eq!(b["activity"], json!([]));
}
