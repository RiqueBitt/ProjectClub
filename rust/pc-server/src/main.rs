use std::net::SocketAddr;

use pc_server::{AppState, app, config::Config};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("PC_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    // `pc-server check`: só confere Redis e MySQL e sai
    if std::env::args().nth(1).as_deref() == Some("check") {
        let only = std::env::args().nth(2).unwrap_or_default();
        let ok = pc_server::check::run(&config, &only).await;
        std::process::exit(if ok { 0 } else { 1 });
    }
    let listen = config.listen;
    tracing::info!(
        "Project Club (Rust) — ambiente {env}, ouvindo em {listen}, o resto vai pro Node em {node}",
        env = config.node_env,
        node = config.node_upstream
    );
    let state = AppState::new(config).await?;
    let listener = tokio::net::TcpListener::bind(listen).await?;
    axum::serve(
        listener,
        app(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown())
    .await?;
    Ok(())
}

async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("desligando — esperando as conexões em andamento terminarem");
}
