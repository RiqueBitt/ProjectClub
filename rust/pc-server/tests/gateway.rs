//! O gateway de ponta a ponta: um "Node" de mentira na frente de quem o Rust
//! fica, e pedidos de verdade (HTTP e WebSocket) passando pelos dois.

use std::net::SocketAddr;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use futures_util::{SinkExt, StreamExt};
use pc_server::config::Config;
use pc_server::{AppState, app};

async fn spawn(router: Router) -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

/// Faz de conta que é o Node.
fn fake_node() -> Router {
    async fn echo_headers(headers: HeaderMap) -> impl IntoResponse {
        let xff = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();
        let host = headers
            .get("host")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();
        (
            StatusCode::IM_A_TEAPOT,
            [("x-node", "sim")],
            format!("xff={xff};host={host}"),
        )
    }
    async fn ws(up: WebSocketUpgrade) -> impl IntoResponse {
        up.on_upgrade(|mut socket: WebSocket| async move {
            while let Some(Ok(msg)) = socket.recv().await {
                if let Message::Text(t) = msg {
                    let _ = socket.send(Message::Text(format!("eco:{t}").into())).await;
                }
            }
        })
    }
    Router::new()
        .route("/api/eco", get(echo_headers))
        .route(
            "/api/corpo",
            post(|body: String| async move { format!("recebi {} bytes", body.len()) }),
        )
        .route("/socket.io/", get(ws))
        .route(
            "/latest.yml",
            get(|| async { "version: 9.9.9\nreleaseDate: '2026-11-21T00:00:00.000Z'\n" }),
        )
}

async fn gateway(node: SocketAddr) -> SocketAddr {
    gateway_with(node, |c| c).await
}

async fn gateway_with(node: SocketAddr, adjust: impl FnOnce(Config) -> Config) -> SocketAddr {
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        node_upstream: format!("http://{node}"),
        node_env: "test".into(),
        redis_url: None,
        desktop_latest_url: format!("http://{node}/latest.yml"),
        database_url: None,
        jwt_access_secret: "teste".into(),
        get_fallback: true, // como em produção
        ..Config::for_tests()
    };
    spawn(app(AppState::new(adjust(config)).await.unwrap())).await
}

#[tokio::test]
async fn rota_nao_portada_vai_pro_node_sem_mexer_no_ip() {
    let gw = gateway(spawn(fake_node()).await).await;
    let r = reqwest::Client::new()
        .get(format!("http://{gw}/api/eco"))
        .header("x-forwarded-for", "200.1.2.3")
        .header("host", "projectclub.shardweb.app")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 418);
    assert_eq!(r.headers()["x-node"], "sim");
    assert!(r.headers().get("x-served-by").is_none());
    assert_eq!(
        r.text().await.unwrap(),
        "xff=200.1.2.3;host=projectclub.shardweb.app"
    );
}

#[tokio::test]
async fn corpo_do_pedido_chega_inteiro() {
    let gw = gateway(spawn(fake_node()).await).await;
    let body = "x".repeat(300_000);
    let r = reqwest::Client::new()
        .post(format!("http://{gw}/api/corpo"))
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.text().await.unwrap(), "recebi 300000 bytes");
}

#[tokio::test]
async fn websocket_passa_pelo_rust() {
    let gw = gateway(spawn(fake_node()).await).await;
    let (mut ws, _) =
        tokio_tungstenite::connect_async(format!("ws://{gw}/socket.io/?EIO=4&transport=websocket"))
            .await
            .unwrap();
    ws.send(tokio_tungstenite::tungstenite::Message::Text("oi".into()))
        .await
        .unwrap();
    let msg = ws.next().await.unwrap().unwrap();
    assert_eq!(msg.into_text().unwrap().as_str(), "eco:oi");
}

#[tokio::test]
async fn rota_portada_responde_no_rust() {
    let gw = gateway(spawn(fake_node()).await).await;
    let r = reqwest::get(format!("http://{gw}/api/system/desktop-latest"))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(r.headers()["x-served-by"], "rust");
    assert_eq!(r.headers()["cache-control"], "public, max-age=120");
    assert_eq!(r.headers()["x-content-type-options"], "nosniff");
    let v: serde_json::Value = serde_json::from_str(&r.text().await.unwrap()).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "version": "9.9.9", "releaseDate": "2026-11-21T00:00:00.000Z" })
    );
}

#[tokio::test]
async fn node_fora_do_ar_da_502() {
    // porta fechada: pega uma livre e solta
    let dead = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap()
    };
    let gw = gateway(dead).await;
    let r = reqwest::get(format!("http://{gw}/api/qualquer"))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 502);
}

#[tokio::test]
async fn rust_no_ar_responde_o_status() {
    let node = spawn(fake_node()).await;
    let gw = gateway(node).await;
    let r = reqwest::get(format!("http://{gw}/api/system/rust"))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(r.headers()["x-served-by"], "rust");
    assert_eq!(r.headers()["cache-control"], "no-store");
    let v: serde_json::Value = r.json().await.unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["rust"], true);
    assert!(v["getFallbacks"].as_u64().is_some());
    assert!(v["startedAt"].is_string());
}

/// Chave de emergência: caminho em `PC_RUST_SKIP` vai pro Node mesmo já
/// portado (aqui o "Node" responde 418 em tudo).
#[tokio::test]
async fn caminho_desligado_vai_pro_node() {
    let node = spawn(fake_node().fallback(|| async { (StatusCode::IM_A_TEAPOT, "node") })).await;
    let gw = gateway_with(node, |c| Config {
        skip_prefixes: pc_server::config::parse_skip("/api/system/desktop-latest,/api/friends"),
        ..c
    })
    .await;
    for path in [
        "/api/system/desktop-latest",
        "/api/friends",
        "/api/friends/blocked",
    ] {
        let r = reqwest::get(format!("http://{gw}{path}")).await.unwrap();
        assert_eq!(r.status().as_u16(), 418, "{path}");
        assert!(r.headers().get("x-served-by").is_none(), "{path}");
    }
    // o que não está na lista continua no Rust
    let r = reqwest::get(format!("http://{gw}/api/system/rust"))
        .await
        .unwrap();
    assert_eq!(r.headers()["x-served-by"], "rust");
}

/// Leitura que dá erro interno no Rust (aqui: sem banco) é refeita no Node;
/// escrita não é repetida nunca.
#[tokio::test]
async fn leitura_com_erro_no_rust_cai_no_node() {
    let node = spawn(fake_node().fallback(|headers: HeaderMap| async move {
        let auth = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();
        (
            StatusCode::OK,
            [("x-node", "sim")],
            format!("node viu {auth}"),
        )
    }))
    .await;
    let gw = gateway(node).await;
    let http = reqwest::Client::new();
    let r = http
        .get(format!("http://{gw}/api/economy?x=1"))
        .header("authorization", "Bearer abc")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    assert_eq!(r.headers()["x-node"], "sim");
    assert!(r.headers().get("x-served-by").is_none());
    assert_eq!(r.text().await.unwrap(), "node viu Bearer abc");

    let r = http
        .put(format!("http://{gw}/api/economy/card-style"))
        .json(&serde_json::json!({ "style": "GOLD" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 500);
    assert_eq!(r.headers()["x-served-by"], "rust");

    // com o recurso desligado, a leitura fica com o erro do Rust
    let gw = gateway_with(node, |c| Config {
        get_fallback: false,
        ..c
    })
    .await;
    let r = reqwest::get(format!("http://{gw}/api/economy"))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 500);

    // Node fora do ar: também fica o erro do Rust (não vira 502)
    let dead = {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap()
    };
    let gw = gateway(dead).await;
    let r = reqwest::get(format!("http://{gw}/api/economy"))
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 500);
    assert_eq!(r.headers()["x-served-by"], "rust");
}
