//! Redis caído não trava o pedido: o limitador responde 500 rápido, como o
//! Node. Só roda com `PC_TEST_REDIS_SERVER` (caminho do `redis-server`).

mod common;

use std::time::{Duration, Instant};

#[tokio::test]
async fn redis_caido_responde_500_rapido() {
    let Ok(bin) = std::env::var("PC_TEST_REDIS_SERVER") else {
        eprintln!("PC_TEST_REDIS_SERVER não definida — pulando");
        return;
    };
    let port = 20000 + (uuid::Uuid::new_v4().as_u128() % 20000) as u16;
    let mut child = std::process::Command::new(bin)
        .args([
            "--port",
            &port.to_string(),
            "--save",
            "",
            "--appendonly",
            "no",
        ])
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    // espera o Redis de teste aceitar conexão (até 5 s)
    for _ in 0..50 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let Some(env) = common::setup_with(|c| pc_server::config::Config {
        redis_url: Some(format!("redis://127.0.0.1:{port}")),
        ..c
    })
    .await
    else {
        child.kill().ok();
        child.wait().ok();
        return;
    };
    let post = || async {
        reqwest::Client::new()
            .post(format!("http://{}/api/auth/qr/start", env.gw))
            .header("x-forwarded-for", "10.9.9.9")
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
    };
    assert_eq!(post().await, 200);
    child.kill().unwrap();
    child.wait().unwrap();
    let t = Instant::now();
    assert_eq!(post().await, 500);
    assert!(t.elapsed() < Duration::from_secs(15), "{:?}", t.elapsed());
}
