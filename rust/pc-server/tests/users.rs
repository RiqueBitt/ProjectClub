//! `/api/users` (preferências, status, busca) e o que vale pra toda a API
//! fora do login: limitadores de leitura/escrita, cache compartilhado
//! apagado nas escritas e tempo real pelo Node.

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
    if env.redis_url.is_none() {
        eprintln!("PC_TEST_REDIS_URL não definida — pulando");
        return None;
    }
    Some((env, calls))
}

struct Resp {
    status: u16,
    headers: reqwest::header::HeaderMap,
    body: Value,
}

async fn call(env: &Env, method: &str, path: &str, user: Option<&str>, body: Value) -> Resp {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.{}.{}.{}", (n >> 16) as u8, (n >> 8) as u8, n as u8),
        );
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    let headers = r.headers().clone();
    Resp {
        status,
        headers,
        body: r.json().await.unwrap_or(Value::Null),
    }
}

async fn realtime_calls(calls: &Calls, n: usize) -> Vec<Value> {
    for _ in 0..100 {
        let list: Vec<Value> = calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(p, _, _)| p == "/api/internal/realtime")
            .map(|(_, _, b)| b.clone())
            .collect();
        if list.len() >= n {
            return list;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("o Node não recebeu {n} pedido(s) de tempo real");
}

fn uid() -> String {
    format!("u{}", &uuid::Uuid::new_v4().simple().to_string()[..12])
}

#[tokio::test]
async fn preferencias_da_conta() {
    let Some((env, _)) = env().await else { return };
    let me = uid();
    add_user(&env.db, &me, "").await;

    let r = call(
        &env,
        "PATCH",
        "/api/users/me/theme",
        Some(&me),
        json!({ "theme": "roxo" }),
    )
    .await;
    assert_eq!(
        (r.status, r.body["error"].clone()),
        (400, json!("Tema inválido."))
    );
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/theme",
        Some(&me),
        json!({ "theme": "amoled" }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["preferredTheme"], "amoled");
    assert_eq!(r.body["user"]["id"], me.as_str());
    // escrita conta no limitador de escritas da API (pela conta)
    assert_eq!(r.headers["ratelimit-limit"], "400");

    let r = call(
        &env,
        "PATCH",
        "/api/users/me/layout-style",
        Some(&me),
        json!({ "layoutStyle": "discord" }),
    )
    .await;
    assert_eq!(r.body["user"]["layoutStyle"], "discord");
    let v: i32 = sqlx::query_scalar("SELECT layoutVersion FROM `User` WHERE id = ?")
        .bind(&me)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(v, 2);

    let r = call(
        &env,
        "PATCH",
        "/api/users/me/chat-zoom",
        Some(&me),
        json!({ "zoom": "1.25" }),
    )
    .await;
    assert_eq!(r.body["user"]["chatZoom"], 1.3);
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/chat-zoom",
        Some(&me),
        json!({ "zoom": 3 }),
    )
    .await;
    assert_eq!(r.body["error"], "O zoom precisa estar entre 1.0 e 2.0.");
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/interface-zoom",
        Some(&me),
        json!({ "zoom": 0.755 }),
    )
    .await;
    assert_eq!(r.body["user"]["interfaceZoom"], 0.76);
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/emoji-style",
        Some(&me),
        json!({ "emojiStyle": "noto" }),
    )
    .await;
    assert_eq!(r.body["user"]["emojiStyle"], "noto");

    // sem login
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/theme",
        None,
        json!({ "theme": "dark" }),
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(
        r.headers["ratelimit-limit"], "400",
        "o limitador conta antes do login"
    );
}

#[tokio::test]
async fn status_e_status_personalizado() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid();
    add_user(&env.db, &me, "").await;

    let r = call(
        &env,
        "PATCH",
        "/api/users/me/status",
        Some(&me),
        json!({ "status": "OFFLINE" }),
    )
    .await;
    assert_eq!(r.body["error"], "Status inválido.");
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/status",
        Some(&me),
        json!({ "status": "INVISIBLE" }),
    )
    .await;
    assert_eq!(
        r.body["user"]["status"], "INVISIBLE",
        "a própria pessoa se vê invisível"
    );
    let rt = realtime_calls(&calls, 1).await;
    assert_eq!(rt[0]["presence"]["user"]["id"], me.as_str());
    assert_eq!(rt[0]["presence"]["manualStatus"], "INVISIBLE");

    let r = call(
        &env,
        "PATCH",
        "/api/users/me/custom-status",
        Some(&me),
        json!({ "text": "  estudando  ", "emoji": "📚", "durationMinutes": 30 }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["customStatus"], "estudando");
    let exp = r.body["user"]["customStatusExpiresAt"].as_str().unwrap();
    let exp = chrono::DateTime::parse_from_rfc3339(exp).unwrap();
    let mins = (exp.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_minutes();
    assert!((28..=30).contains(&mins), "{mins}");
    let rt = realtime_calls(&calls, 3).await;
    assert!(rt[1]["presence"].is_object(), "presença primeiro");
    let emits = rt[2]["emits"].as_array().unwrap();
    assert_eq!(emits[0]["to"], json!([format!("user:{me}")]));
    assert_eq!(emits[1]["to"], json!(["community"]));
    assert_eq!(emits[1]["except"], json!([format!("user:{me}")]));
    assert_eq!(emits[1]["payload"]["customStatus"], "estudando");

    // limpar: sem texto e sem emoji, a expiração some junto
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/custom-status",
        Some(&me),
        json!({ "durationMinutes": 30 }),
    )
    .await;
    assert_eq!(r.body["user"]["customStatus"], Value::Null);
    assert_eq!(r.body["user"]["customStatusExpiresAt"], Value::Null);
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/custom-status",
        Some(&me),
        json!({ "text": "x", "expiresAt": "2001-01-01T00:00:00.000Z" }),
    )
    .await;
    assert_eq!(r.body["error"], "A expiração precisa ser no futuro.");
}

#[tokio::test]
async fn tag_da_comunidade_e_cache_apagado() {
    let Some((env, calls)) = env().await else {
        return;
    };
    let me = uid();
    add_user(&env.db, &me, "").await;
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/tag",
        Some(&me),
        json!({ "active": true }),
    )
    .await;
    assert_eq!(
        r.body["error"],
        "A comunidade ainda não tem uma tag configurada."
    );

    env.db
        .execute("INSERT INTO PlatformSettings (id) VALUES ('singleton')")
        .await
        .unwrap();
    // o carregamento da comunidade em cache (do Node) é apagado na escrita
    let client = redis::Client::open(env.redis_url.clone().unwrap()).unwrap();
    let mut con = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = redis::AsyncCommands::set_ex(&mut con, "cache:shared:community", "{}", 60)
        .await
        .unwrap();
    let r = call(
        &env,
        "PATCH",
        "/api/users/me/tag",
        Some(&me),
        json!({ "active": 1 }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["tagText"], "CLUBE");
    assert_eq!(r.body["user"]["tagEmoji"], "🏠");
    let mut gone = false;
    for _ in 0..50 {
        let v: Option<String> = redis::AsyncCommands::get(&mut con, "cache:shared:community")
            .await
            .unwrap();
        if v.is_none() {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(gone, "cache:shared:community continuou lá");
    let rt = realtime_calls(&calls, 1).await;
    assert_eq!(rt[0]["emits"][0]["event"], "user:update");
    assert!(
        rt[0]["emits"][1]["payload"].get("email").is_none(),
        "comunidade recebe sem e-mail"
    );
    assert!(
        rt[0]["emits"][0]["payload"].get("email").is_some(),
        "a própria pessoa recebe completo"
    );

    let r = call(&env, "PATCH", "/api/users/me/tag", Some(&me), json!({})).await;
    assert_eq!(r.body["user"]["tagText"], Value::Null);
    let r = call(
        &env,
        "DELETE",
        "/api/users/me/id-card",
        Some(&me),
        Value::Null,
    )
    .await;
    assert_eq!(r.body["user"]["idCardUrl"], Value::Null);
}

#[tokio::test]
async fn busca_de_pessoas() {
    let Some((env, _)) = env().await else { return };
    let tag = &uuid::Uuid::new_v4().simple().to_string()[..8];
    let me = format!("eu_{tag}");
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &format!("ana_{tag}"), ", status|, 'INVISIBLE'").await;
    add_user(&env.db, &format!("anax{tag}"), "").await;
    add_user(
        &env.db,
        &format!("ana2_{tag}"),
        ", selfDeactivatedAt|, UTC_TIMESTAMP(3)",
    )
    .await;

    let r = call(
        &env,
        "GET",
        &format!("/api/users/search?q=@ana_{tag}"),
        Some(&me),
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 200);
    assert_eq!(
        r.headers["ratelimit-limit"], "4000",
        "leitura conta no limitador de leituras"
    );
    let users = r.body["users"].as_array().unwrap();
    // como no Prisma, "_" vale como curinga do LIKE (anax… entra também);
    // a conta desativada não aparece
    let mut names: Vec<&str> = users
        .iter()
        .map(|u| u["username"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(
        names,
        [format!("ana_{tag}"), format!("anax{tag}")],
        "{users:?}"
    );
    let ana = users
        .iter()
        .find(|u| u["username"] == format!("ana_{tag}"))
        .unwrap();
    assert_eq!(
        ana["status"], "OFFLINE",
        "invisível aparece offline pros outros"
    );
    assert!(ana.get("email").is_none());

    let r = call(
        &env,
        "GET",
        &format!("/api/users/search?q=eu_{tag}"),
        Some(&me),
        Value::Null,
    )
    .await;
    assert_eq!(r.body["users"], json!([]), "sem a própria pessoa");
    let r = call(
        &env,
        "GET",
        &format!("/api/users/search?q=eu_{tag}&self=1"),
        Some(&me),
        Value::Null,
    )
    .await;
    assert_eq!(r.body["users"].as_array().unwrap().len(), 1);
    let r = call(&env, "GET", "/api/users/search?q=a", Some(&me), Value::Null).await;
    assert_eq!(r.body["users"], json!([]));
}

#[tokio::test]
async fn ignorar_e_notas() {
    let Some((env, _)) = env().await else { return };
    let me = uid();
    let other = uid();
    add_user(&env.db, &me, "").await;
    add_user(&env.db, &other, "").await;

    let r = call(
        &env,
        "POST",
        &format!("/api/users/{me}/ignore"),
        Some(&me),
        json!({}),
    )
    .await;
    assert_eq!(r.body["error"], "Você não pode se ignorar.");
    let r = call(
        &env,
        "POST",
        "/api/users/ninguem/ignore",
        Some(&me),
        json!({}),
    )
    .await;
    assert_eq!(r.status, 404);
    let r = call(
        &env,
        "POST",
        &format!("/api/users/{other}/ignore"),
        Some(&me),
        json!({}),
    )
    .await;
    assert_eq!(r.body, json!({ "ignored": true, "userId": other }));
    let r = call(&env, "GET", "/api/users/me/ignored", Some(&me), Value::Null).await;
    assert_eq!(r.body["ids"], json!([other]));
    assert_eq!(r.body["users"][0]["username"], other.as_str());
    assert_eq!(
        r.body["users"][0]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        ["id", "displayName", "username", "avatarUrl"]
    );
    // { on: true } de novo não desliga
    let r = call(
        &env,
        "POST",
        &format!("/api/users/{other}/ignore"),
        Some(&me),
        json!({ "on": true }),
    )
    .await;
    assert_eq!(r.body["ignored"], true);
    let r = call(
        &env,
        "POST",
        &format!("/api/users/{other}/ignore"),
        Some(&me),
        json!({}),
    )
    .await;
    assert_eq!(r.body["ignored"], false);

    let r = call(
        &env,
        "PUT",
        &format!("/api/users/{other}/note"),
        Some(&me),
        json!({ "text": "  amigo do trabalho  " }),
    )
    .await;
    assert_eq!(r.body, json!({ "note": "amigo do trabalho" }));
    let r = call(
        &env,
        "PUT",
        &format!("/api/users/{other}/note"),
        Some(&me),
        json!({ "text": "outra" }),
    )
    .await;
    assert_eq!(r.body["note"], "outra");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM UserNote WHERE ownerId = ?")
        .bind(&me)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let r = call(
        &env,
        "PUT",
        &format!("/api/users/{other}/note"),
        Some(&me),
        json!({ "text": 5 }),
    )
    .await;
    assert_eq!(r.body["note"], "", "texto que não é texto apaga");
    let r = call(
        &env,
        "PUT",
        "/api/users/ninguem/note",
        Some(&me),
        json!({ "text": "x" }),
    )
    .await;
    assert_eq!(r.status, 404);
    let r = call(
        &env,
        "PUT",
        &format!("/api/users/{me}/note"),
        Some(&me),
        json!({ "text": "x" }),
    )
    .await;
    assert_eq!(r.status, 400);
}
