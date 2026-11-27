//! `/api/users/me/...`: configurações, jogos, atalhos, GIFs e emojis.

mod common;

use std::time::Duration;

use common::{Env, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn call(env: &Env, method: &str, path: &str, user: &str, body: Value) -> (u16, Value) {
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header("x-forwarded-for", "10.88.0.1")
        .bearer_auth(Tokens::new(SECRET).sign(user, Duration::from_secs(900)));
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let st = r.status().as_u16();
    (st, r.json().await.unwrap_or(Value::Null))
}

fn uid() -> String {
    format!("m{}", &uuid::Uuid::new_v4().simple().to_string()[..12])
}

async fn env() -> Option<Env> {
    let env = setup().await?;
    env.redis_url.as_ref()?;
    Some(env)
}

#[tokio::test]
async fn configuracoes() {
    let Some(env) = env().await else { return };
    let me = uid();
    add_user(&env.db, &me, "").await;

    // primeira leitura cria com os padrões
    let (st, b) = call(&env, "GET", "/api/users/me/settings", &me, Value::Null).await;
    assert_eq!(st, 200, "{b}");
    let s = &b["settings"];
    assert_eq!(s["userId"], me.as_str());
    assert_eq!(s["layoutPrefs"], Value::Null);
    assert_eq!(s["extraPrefs"], json!({}));
    assert_eq!(s["voiceVolumes"], json!({}));
    let keys: Vec<&String> = s.as_object().unwrap().keys().collect();
    assert_eq!(keys[0], "id");
    let updated = s["updatedAt"].clone();
    // ler de novo não mexe no updatedAt
    let (_, b) = call(&env, "GET", "/api/users/me/settings", &me, Value::Null).await;
    assert_eq!(b["settings"]["updatedAt"], updated);

    // nada válido
    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me/settings",
        &me,
        json!({ "lixo": 1, "language": "fr" }),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(
        b,
        json!({ "error": "Nenhuma configuração válida foi enviada.", "rejected": ["lixo", "language"] })
    );

    let (st, b) = call(
        &env,
        "PATCH",
        "/api/users/me/settings",
        &me,
        json!({
            "language": "en-US",
            "textScale": 1.2,
            "saturation": 50,
            "showAvatars": false,
            "layoutPrefs": { "density": "compact", "fontSize": 30, "x": 1, "theme": "claro", "accent": "neon", "visual": "club" },
            "extraPrefs": { "soundPack": "retro", "quietHours": { "enabled": true, "start": "22:00", "end": "07:00", "days": [3, 1], "timezone": "America/Sao_Paulo" } },
            "voiceVolumes": { "amigo": 150, "outro": 100 },
            "streamFPS": 45
        }),
    )
    .await;
    assert_eq!(st, 200, "{b}");
    let s = &b["settings"];
    assert_eq!(b["rejected"], json!(["streamFPS"]));
    assert_eq!(s["language"], "en-US");
    assert_eq!(s["textScale"], 1.2);
    assert_eq!(s["saturation"], 50);
    assert_eq!(s["showAvatars"], false);
    assert_eq!(s["layoutPrefs"], json!({ "density": "compact", "visual": "club", "theme": "claro" }));
    assert_eq!(s["extraPrefs"]["quietHours"]["days"], json!([1, 3]));
    assert_eq!(s["voiceVolumes"], json!({ "amigo": 150 }));
    let raw: String = sqlx::query_scalar("SELECT extraPrefs FROM UserSettings WHERE userId = ?")
        .bind(&me)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(
        raw,
        r#"{"soundPack":"retro","quietHours":{"enabled":true,"start":"22:00","end":"07:00","days":[1,3],"timezone":"America/Sao_Paulo"}}"#
    );

    // ajuste de um volume só (voiceVolumesPatch)
    let (_, b) = call(
        &env,
        "PATCH",
        "/api/users/me/settings",
        &me,
        json!({ "voiceVolumesPatch": { "amigo": null, "novo": 30 } }),
    )
    .await;
    assert_eq!(b["settings"]["voiceVolumes"], json!({ "novo": 30 }));
    assert!(b.get("rejected").is_none());

    // voltar ao padrão
    let (st, b) = call(&env, "POST", "/api/users/me/settings/reset", &me, json!({})).await;
    assert_eq!(st, 200);
    assert_eq!(b["settings"]["language"], "pt-BR");
    let logs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM SecurityLog WHERE userId = ? AND action = 'SETTINGS_RESET'",
    )
    .bind(&me)
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!(logs, 1);
}

#[tokio::test]
async fn jogos_atalhos_e_gifs() {
    let Some(env) = env().await else { return };
    let me = uid();
    add_user(&env.db, &me, "").await;

    let (st, b) = call(
        &env,
        "POST",
        "/api/users/me/games",
        &me,
        json!({ "gameKey": "  Minecraft ", "displayName": "Minecraft" }),
    )
    .await;
    assert_eq!(st, 201, "{b}");
    assert_eq!(b["game"]["gameKey"], "minecraft");
    assert_eq!(b["game"]["iconUrl"], Value::Null);
    let id = b["game"]["id"].as_str().unwrap().to_string();
    let (st, b) = call(
        &env,
        "POST",
        "/api/users/me/games",
        &me,
        json!({ "gameKey": "MINECRAFT", "displayName": "x" }),
    )
    .await;
    assert_eq!(
        (st, b["error"].clone()),
        (400, json!("Esse jogo já está na sua lista."))
    );
    let (_, b) = call(
        &env,
        "POST",
        "/api/users/me/games",
        &me,
        json!({ "gameKey": "x" }),
    )
    .await;
    assert_eq!(b["error"], "displayName é obrigatório.");
    let (_, b) = call(&env, "GET", "/api/users/me/games", &me, Value::Null).await;
    assert_eq!(b["games"].as_array().unwrap().len(), 1);
    let (_, b) = call(
        &env,
        "DELETE",
        &format!("/api/users/me/games/{id}"),
        &me,
        Value::Null,
    )
    .await;
    assert_eq!(b, json!({ "success": true }));
    let (st, _) = call(
        &env,
        "DELETE",
        &format!("/api/users/me/games/{id}"),
        &me,
        Value::Null,
    )
    .await;
    assert_eq!(st, 404);

    let (_, b) = call(
        &env,
        "PUT",
        "/api/users/me/shortcuts",
        &me,
        json!({ "action": "abrir", "keyCombination": "Ctrl+K" }),
    )
    .await;
    assert_eq!(b["shortcut"]["keyCombination"], "Ctrl+K");
    let (_, b) = call(
        &env,
        "PUT",
        "/api/users/me/shortcuts",
        &me,
        json!({ "action": "outra", "keyCombination": "Ctrl+K" }),
    )
    .await;
    assert_eq!(b["error"], "Este atalho já está sendo utilizado.");
    // reatribuir a combinação da própria ação
    let (_, b) = call(
        &env,
        "PUT",
        "/api/users/me/shortcuts",
        &me,
        json!({ "action": "abrir", "keyCombination": "Ctrl+J" }),
    )
    .await;
    assert_eq!(b["shortcut"]["keyCombination"], "Ctrl+J");
    let (_, b) = call(&env, "GET", "/api/users/me/shortcuts", &me, Value::Null).await;
    assert_eq!(b["shortcuts"].as_array().unwrap().len(), 1);

    let (st, b) = call(&env, "POST", "/api/users/me/favorite-gifs", &me, json!({})).await;
    assert_eq!(
        (st, b["error"].clone()),
        (400, json!("URL do GIF é obrigatória."))
    );
    let (st, b) = call(
        &env,
        "POST",
        "/api/users/me/favorite-gifs",
        &me,
        json!({ "gifId": 123, "url": "https://g/x.gif" }),
    )
    .await;
    assert_eq!(st, 201, "{b}");
    assert_eq!(b["gif"]["gifId"], "123");
    assert_eq!(b["gif"]["preview"], "https://g/x.gif");
    // de novo: o mesmo (não duplica)
    let (st, _) = call(
        &env,
        "POST",
        "/api/users/me/favorite-gifs",
        &me,
        json!({ "gifId": "123", "url": "https://g/y.gif" }),
    )
    .await;
    assert_eq!(st, 201);
    let (_, b) = call(&env, "GET", "/api/users/me/favorite-gifs", &me, Value::Null).await;
    assert_eq!(b["gifs"].as_array().unwrap().len(), 1);
    assert_eq!(b["gifs"][0]["url"], "https://g/x.gif");
    let (st, _) = call(
        &env,
        "POST",
        "/api/users/me/favorite-gifs",
        &me,
        json!({ "url": 5 }),
    )
    .await;
    assert_eq!(st, 500, "o Prisma recusa url que não é texto");
    let (_, b) = call(
        &env,
        "DELETE",
        "/api/users/me/favorite-gifs/123",
        &me,
        Value::Null,
    )
    .await;
    assert_eq!(b, json!({ "ok": true }));
}

#[tokio::test]
async fn emojis_que_posso_usar() {
    let Some(env) = env().await else { return };
    let me = uid();
    add_user(&env.db, &me, "").await;
    add_user(&env.db, "criador", "").await;
    for sql in [
        "INSERT INTO Role (id, name) VALUES ('r1', 'VIP')".to_string(),
        "INSERT INTO Emoji (id, name, url, createdById, allowedRoleId, createdAt) VALUES ('e1', 'livre', '/a.png', 'criador', NULL, '2026-01-01 00:00:00.000')".to_string(),
        "INSERT INTO Emoji (id, name, url, createdById, allowedRoleId, createdAt) VALUES ('e2', 'vip', '/b.png', 'criador', 'r1', '2026-01-02 00:00:00.000')".to_string(),
        "INSERT INTO CreatorItem (id, creatorId, kind, name, imageUrl, status, priceCoins, updatedAt) VALUES ('c1', 'criador', 'EMOJI', 'zebra', '/z.png', 'APPROVED', 10, UTC_TIMESTAMP(3))".to_string(),
        "INSERT INTO CreatorItem (id, creatorId, kind, name, imageUrl, status, priceCoins, updatedAt) VALUES ('c2', 'criador', 'EMOJI', 'livre', '/l.png', 'APPROVED', 10, UTC_TIMESTAMP(3))".to_string(),
        format!("INSERT INTO CreatorPurchase (id, itemId, buyerId, pricePaid, fee) VALUES ('p1', 'c1', '{me}', 10, 1)"),
        format!("INSERT INTO CreatorPurchase (id, itemId, buyerId, pricePaid, fee) VALUES ('p2', 'c2', '{me}', 10, 1)"),
    ] {
        if let Err(e) = env.db.execute(sql.as_str()).await {
            panic!("{sql}: {e}");
        }
    }
    let (_, b) = call(&env, "GET", "/api/users/me/usable-emojis", &me, Value::Null).await;
    let names: Vec<&str> = b["emojis"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    // sem o cargo VIP; o "livre" da loja não repete o do servidor
    assert_eq!(names, ["livre", "zebra"], "{b}");
    assert_eq!(b["emojis"][1]["id"], "criador-c1");
    assert_eq!(b["emojis"][1]["category"], "Loja dos criadores");

    env.db
        .execute(
            format!("INSERT INTO UserRole (id, userId, roleId) VALUES ('ur1', '{me}', 'r1')")
                .as_str(),
        )
        .await
        .unwrap();
    let (_, b) = call(&env, "GET", "/api/users/me/usable-emojis", &me, Value::Null).await;
    assert_eq!(b["emojis"].as_array().unwrap().len(), 3);
}
