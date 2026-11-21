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
    let config = Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        node_upstream: format!("http://{node}"),
        node_env: "test".into(),
        redis_url: None,
        desktop_latest_url: format!("http://{node}/latest.yml"),
    };
    spawn(app(AppState::new(config).await.unwrap())).await
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
