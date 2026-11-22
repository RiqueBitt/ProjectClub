//! `/api/gifs`: busca e categorias na Klipy (servidor falso), com cache no
//! Redis igual ao do Node.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{Env, SECRET, add_user, setup_with};
use pc_server::auth::Tokens;
use serde_json::{Value, json};

type Seen = Arc<Mutex<Vec<String>>>;

/// Klipy de mentira: guarda as URLs pedidas; `/v2/featured` responde 500.
async fn fake_klipy(seen: Seen) -> String {
    use axum::extract::Request;
    let router = axum::Router::new().fallback(move |req: Request| {
        let seen = seen.clone();
        async move {
            let uri = req.uri().to_string();
            seen.lock().unwrap().push(uri.clone());
            if uri.starts_with("/v2/featured") {
                return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, String::new());
            }
            if uri.starts_with("/v2/categories") {
                return (
                    axum::http::StatusCode::OK,
                    json!({ "tags": [{ "name": "oi", "searchterm": "oi", "image": "i", "x": 1 }] }).to_string(),
                );
            }
            let body = json!({ "results": [
                { "id": 7, "media_formats": { "tinygif": { "url": "t", "dims": [20, 10] }, "gif": { "url": "g" } } },
                { "id": 8, "media_formats": { "tinygif": { "url": "só pequeno" } } },
            ]});
            (axum::http::StatusCode::OK, body.to_string())
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}/v2")
}

async fn env(key: &str) -> Option<(Env, Seen)> {
    let seen: Seen = Default::default();
    let base = fake_klipy(seen.clone()).await;
    let env = setup_with(|c| pc_server::config::Config {
        klipy_key: pc_server::config::Secret(key.into()),
        klipy_base: base,
        ..c
    })
    .await?;
    env.redis_url.as_ref()?;
    Some((env, seen))
}

async fn get(env: &Env, path: &str, user: &str) -> (u16, reqwest::header::HeaderMap, Value) {
    let r = reqwest::Client::new()
        .get(format!("http://{}{path}", env.gw))
        .bearer_auth(Tokens::new(SECRET).sign(user, Duration::from_secs(900)))
        .send()
        .await
        .unwrap();
    let st = r.status().as_u16();
    let h = r.headers().clone();
    (st, h, r.json().await.unwrap_or(Value::Null))
}

fn uid(p: &str) -> String {
    format!("{p}{}", &uuid::Uuid::new_v4().simple().to_string()[..10])
}

#[tokio::test]
async fn busca_com_cache() {
    let Some((env, seen)) = env("chave-teste").await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, "").await;
    let loc = &uuid::Uuid::new_v4().simple().to_string()[..10];

    let path = format!("/api/gifs/search?q=%20Gato%20Feliz%20&limit=99&locale={loc}xyz");
    let (st, h, b) = get(&env, &path, &me).await;
    assert_eq!(st, 200);
    assert_eq!(h["cache-control"], "private, max-age=300");
    assert_eq!(h["ratelimit-limit"], "90");
    assert_eq!(
        b,
        json!({ "results": [{ "id": 7, "preview": "t", "full": "g", "width": 20, "height": 10 }] })
    );
    {
        let s = seen.lock().unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(
            s[0],
            format!(
                "/v2/search?q=Gato+Feliz&limit=50&locale={loc}&key=chave-teste&client_key=embercord&media_filter=gif"
            )
        );
    }
    // o mesmo pedido vem do cache (a chave é a mesma do Node)
    let (st, _, b2) = get(&env, &path, &me).await;
    assert_eq!((st, &b2), (200, &b));
    assert_eq!(seen.lock().unwrap().len(), 1);
    let client = redis::Client::open(env.redis_url.clone().unwrap()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let cached: Option<String> =
        redis::AsyncCommands::get(&mut conn, format!("cache:gifs:search:{loc}:50:gato feliz"))
            .await
            .unwrap();
    assert_eq!(
        cached.as_deref(),
        Some(r#"[{"id":7,"preview":"t","full":"g","width":20,"height":10}]"#)
    );

    // destaque: a Klipy respondeu 500 → 502, e nada fica no cache
    let (st, _, b) = get(&env, &format!("/api/gifs/search?locale={loc}"), &me).await;
    assert_eq!(st, 502);
    assert_eq!(
        b,
        json!({ "error": "Não foi possível carregar GIFs agora.", "code": "upstream" })
    );
    let gone: Option<String> =
        redis::AsyncCommands::get(&mut conn, format!("cache:gifs:featured:{loc}:24"))
            .await
            .unwrap();
    assert!(gone.is_none());

    let (st, h, b) = get(&env, &format!("/api/gifs/categories?locale={loc}"), &me).await;
    assert_eq!(st, 200);
    assert_eq!(h["cache-control"], "private, max-age=3600");
    assert_eq!(
        b,
        json!({ "tags": [{ "name": "oi", "searchterm": "oi", "image": "i" }] })
    );

    // sem login: 401
    let r = reqwest::get(format!("http://{}/api/gifs/categories", env.gw))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 401);
}

#[tokio::test]
async fn sem_chave() {
    let Some((env, seen)) = env("").await else {
        return;
    };
    let me = uid("eu");
    add_user(&env.db, &me, "").await;
    let loc = &uuid::Uuid::new_v4().simple().to_string()[..10];
    let (st, _, b) = get(&env, &format!("/api/gifs/categories?locale={loc}"), &me).await;
    assert_eq!(st, 503);
    assert_eq!(
        b,
        json!({ "error": "Busca de GIFs não configurada.", "code": "unconfigured" })
    );
    assert!(seen.lock().unwrap().is_empty());
}
