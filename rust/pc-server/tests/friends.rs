//! `/api/friends`: pedir, aceitar (cria a conversa), recusar, bloquear,
//! desbloquear, desfazer e as listas.

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
            format!("10.6.{}.{}", (n >> 8) as u8, n as u8),
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

/// O que chegou no "Node" (caminho, corpo), e limpa a lista.
async fn take(calls: &Calls) -> Vec<(String, Value)> {
    tokio::time::sleep(Duration::from_millis(250)).await;
    let mut c = calls.lock().unwrap();
    let out = c.iter().map(|(p, _, b)| (p.clone(), b.clone())).collect();
    c.clear();
    out
}

#[tokio::test]
async fn pedido_aceito_vira_conversa() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let (a, b) = (uid("aa"), uid("bb"));
    add_user(&env.db, &a, ", status|, 'INVISIBLE'").await;
    add_user(&env.db, &b, "").await;

    // erros do pedido
    let (st, _) = call(&env, "POST", "/api/friends/request", &a, json!({})).await;
    assert_eq!(st, 500, "sem username o Prisma recusa");
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": "ninguem" }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (404, Some("Usuário não encontrado."))
    );
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": a }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (400, Some("Você não pode se adicionar."))
    );

    // quem recebe esconde os recados
    env.db
        .execute(format!("INSERT INTO UserSettings (id, userId, extraPrefs, updatedAt) VALUES (UUID(), '{b}', '{{\"friendReqMessages\":false}}', UTC_TIMESTAMP(3))").as_str())
        .await
        .unwrap();
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": b.to_uppercase(), "message": "  oi,\n  bora?  " }),
    )
    .await;
    assert_eq!(st, 201, "{r}");
    let f = r["friendship"].clone();
    assert_eq!(f["message"], "oi, bora?");
    assert_eq!(f["status"], "PENDING");
    let keys: Vec<&str> = f.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "id",
            "requesterId",
            "addresseeId",
            "status",
            "message",
            "acceptedAt",
            "createdAt",
            "updatedAt"
        ]
    );
    let got = take(&calls).await;
    assert_eq!(got.len(), 2, "{got:?}");
    let emit = &got[0].1["emits"][0];
    assert_eq!(emit["to"], json!([format!("user:{b}")]));
    assert_eq!(emit["event"], "friend:request");
    assert!(
        emit["payload"]["friendship"]["message"].is_null(),
        "recado escondido"
    );
    let from = &emit["payload"]["from"];
    assert_eq!(from["id"], a.as_str());
    assert!(from.get("email").is_none() && from.get("passwordHash").is_none());
    assert!(from.get("clanTag").is_none());
    assert_eq!(
        got[1].1,
        json!({ "actions": [{ "name": "offlineEmail", "userId": b, "payload": { "type": "friend_request", "actorName": format!("Nome {a}") } }] })
    );

    // de novo: 409
    let (st, _) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": b }),
    )
    .await;
    assert_eq!(st, 409);

    // listas: quem pediu vê o recado; quem recebeu, não (preferência)
    let (_, la) = call(&env, "GET", "/api/friends", &a, Value::Null).await;
    assert_eq!(la["friendships"][0]["message"], "oi, bora?");
    assert_eq!(la["friendships"][0]["isIncoming"], false);
    assert_eq!(la["friendships"][0]["user"]["id"], b.as_str());
    let (_, lb) = call(&env, "GET", "/api/friends", &b, Value::Null).await;
    assert!(lb["friendships"][0]["message"].is_null());
    assert_eq!(lb["friendships"][0]["isIncoming"], true);
    // "invisível" aparece offline pra outra pessoa
    assert_eq!(lb["friendships"][0]["user"]["status"], "OFFLINE");

    // só quem recebeu responde; ação inválida
    let id = f["id"].as_str().unwrap();
    let path = format!("/api/friends/{id}/respond");
    let (st, _) = call(&env, "POST", &path, &a, json!({ "action": "accept" })).await;
    assert_eq!(st, 404);
    let (st, r) = call(&env, "POST", &path, &b, json!({ "action": "x" })).await;
    assert_eq!((st, r["error"].as_str()), (400, Some("Ação inválida.")));
    let (st, _) = call(&env, "POST", &path, &b, json!({ "action": "toString" })).await;
    assert_eq!(st, 500);
    take(&calls).await;

    let (st, r) = call(&env, "POST", &path, &b, json!({ "action": "accept" })).await;
    assert_eq!(st, 200);
    assert_eq!(r["friendship"]["status"], "ACCEPTED");
    assert!(r["friendship"]["acceptedAt"].is_string());
    let got = take(&calls).await;
    let paths: Vec<&str> = got.iter().map(|(p, _)| p.as_str()).collect();
    assert_eq!(
        paths,
        [
            "/api/internal/realtime",
            "/api/internal/after",
            "/api/internal/realtime",
            "/api/internal/after"
        ]
    );
    assert_eq!(got[0].1["emits"][0]["event"], "friend:update");
    assert_eq!(
        got[1].1,
        json!({ "actions": [{ "name": "friendsChanged", "userId": a, "otherId": b }] })
    );
    let conv = &got[2].1["emits"][0]["payload"]["conversation"];
    assert_eq!(got[2].1["emits"][1]["to"], json!([format!("user:{b}")]));
    assert_eq!(conv["isGroup"], false);
    assert!(conv["ownerId"].is_null() && conv["slug"].is_null());
    let members: Vec<&str> = conv["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(members.len(), 2);
    assert!(members.contains(&a.as_str()) && members.contains(&b.as_str()));
    assert_eq!(
        got[3].1,
        json!({ "actions": [{ "name": "achievements", "userId": a }, { "name": "achievements", "userId": b }] })
    );
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Conversation")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    // desfaz e pede de novo: a conversa existente é reaproveitada
    let (st, r) = call(
        &env,
        "DELETE",
        &format!("/api/friends/{id}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!((st, r), (200, json!({ "ok": true })));
    let got = take(&calls).await;
    assert_eq!(got[0].1["actions"][0]["name"], "friendsChanged");
    assert_eq!(
        got[1].1,
        json!({ "emits": [{ "to": [format!("user:{b}")], "event": "friend:removed", "payload": { "friendshipId": id } }] })
    );
    let (_, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &b,
        json!({ "username": a }),
    )
    .await;
    let id2 = r["friendship"]["id"].as_str().unwrap().to_string();
    let (st, _) = call(
        &env,
        "POST",
        &format!("/api/friends/{id2}/respond"),
        &a,
        json!({ "action": ["accept"] }),
    )
    .await;
    assert_eq!(st, 200);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM Conversation")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn bloquear_e_privacidade() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let (a, b, c, d) = (uid("aa"), uid("bb"), uid("cc"), uid("dd"));
    add_user(&env.db, &a, "").await;
    add_user(&env.db, &b, ", friendRequestPrivacy|, 'NOBODY'").await;
    add_user(&env.db, &c, ", friendRequestPrivacy|, 'FRIENDS_OF_FRIENDS'").await;
    add_user(&env.db, &d, "").await;

    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": b }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (
            403,
            Some("Esta pessoa não está aceitando pedidos de amizade.")
        )
    );
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": c }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (
            403,
            Some("Esta pessoa só aceita pedidos de amigos em comum.")
        )
    );
    // com um amigo em comum (d), passa
    env.db
        .execute(format!(
            "INSERT INTO Friendship (id, requesterId, addresseeId, status, updatedAt) VALUES \
             ('f1', '{a}', '{d}', 'ACCEPTED', UTC_TIMESTAMP(3)), ('f2', '{d}', '{c}', 'ACCEPTED', UTC_TIMESTAMP(3))"
        ).as_str())
        .await
        .unwrap();
    let (st, _) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": c }),
    )
    .await;
    assert_eq!(st, 201);

    // bloquear
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/block",
        &a,
        json!({ "username": 5 }),
    )
    .await;
    assert_eq!((st, r["error"].as_str()), (400, Some("Usuário inválido.")));
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/block",
        &a,
        json!({ "username": a }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (400, Some("Você não pode bloquear a si mesmo."))
    );
    // d bloqueia a (já eram amigos: a linha vira o bloqueio, com d como quem pediu)
    take(&calls).await;
    let (st, _) = call(
        &env,
        "POST",
        "/api/friends/block",
        &d,
        json!({ "username": a }),
    )
    .await;
    assert_eq!(st, 200);
    let row: (String, String, String) =
        sqlx::query_as("SELECT requesterId, addresseeId, status FROM Friendship WHERE id = 'f1'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(row, (d.clone(), a.clone(), "BLOCKED".into()));
    let got = take(&calls).await;
    assert_eq!(
        got[0].1,
        json!({ "actions": [{ "name": "friendsChanged", "userId": d, "otherId": a }] })
    );
    // quem foi bloqueado não vê o bloqueio, não pede e não apaga
    let (_, la) = call(&env, "GET", "/api/friends", &a, Value::Null).await;
    assert!(
        la["friendships"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["id"] != "f1")
    );
    let (st, r) = call(
        &env,
        "POST",
        "/api/friends/request",
        &a,
        json!({ "username": d }),
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (403, Some("Não é possível enviar pedido."))
    );
    let (st, _) = call(&env, "DELETE", "/api/friends/f1", &a, Value::Null).await;
    assert_eq!(st, 404);
    // a lista de bloqueados de d
    let (_, lb) = call(&env, "GET", "/api/friends/blocked", &d, Value::Null).await;
    assert_eq!(lb["blocked"][0]["id"], "f1");
    assert_eq!(lb["blocked"][0]["user"]["id"], a.as_str());
    assert!(lb["blocked"][0]["blockedAt"].is_string());
    // desbloquear
    let (st, r) = call(
        &env,
        "DELETE",
        &format!("/api/friends/block/{a}"),
        &a,
        Value::Null,
    )
    .await;
    assert_eq!(
        (st, r["error"].as_str()),
        (
            404,
            Some("Este usuário não está na sua lista de bloqueados.")
        )
    );
    let (st, _) = call(
        &env,
        "DELETE",
        &format!("/api/friends/block/{a}"),
        &d,
        Value::Null,
    )
    .await;
    assert_eq!(st, 200);
    let (_, lb) = call(&env, "GET", "/api/friends/blocked", &d, Value::Null).await;
    assert_eq!(lb, json!({ "blocked": [] }));
}
