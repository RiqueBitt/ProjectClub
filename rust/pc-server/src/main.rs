use std::net::SocketAddr;

use pc_server::{AppState, app, config::Config};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    use std::io::IsTerminal;
    tracing_subscriber::fmt()
        // cor só no terminal (no log da hospedagem viraria sujeira)
        .with_ansi(std::io::stdout().is_terminal())
        .with_env_filter(
            EnvFilter::try_from_env("PC_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = Config::from_env()?;
    // `pc-server check`: só confere Redis e MySQL e sai
    if std::env::args().nth(1).as_deref() == Some("check") {
        let only = std::env::args().nth(2).unwrap_or_default();
        if only == "diag" {
            if let Some(u) = config.redis_url.as_deref() {
                println!("redis (etapas):");
                pc_server::check::redis_raw(u).await;
            }
            if let Some(u) = config.database_url.as_deref() {
                println!("mysql:");
                pc_server::check::mysql_async_probe(u).await;
            }
            return Ok(());
        }
        let ok = pc_server::check::run(&config, &only).await;
        std::process::exit(if ok { 0 } else { 1 });
    }
    pc_server::routes::system::mark_started();
    raise_file_limit();
    let port = config.listen.port();
    // Como o Node (`listen(porta)`): IPv6 + IPv4 juntos; sem IPv6, só IPv4.
    let listener = match tokio::net::TcpListener::bind(SocketAddr::from((
        std::net::Ipv6Addr::UNSPECIFIED,
        port,
    )))
    .await
    {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(config.listen).await?,
    };
    tracing::info!(
        "Project Club (Rust {build}) — ambiente {env}, ouvindo em {listen}, o resto vai pro Node em {node}",
        build = option_env!("PC_BUILD_SHA").unwrap_or("dev"),
        env = config.node_env,
        listen = listener.local_addr()?,
        node = config.node_upstream
    );
    if !config.skip_prefixes.is_empty() {
        tracing::warn!(
            "PC_RUST_SKIP: estes caminhos vão direto pro Node: {:?}",
            config.skip_prefixes
        );
    }
    let state = AppState::new(config).await?;
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

/// Cada WebSocket que passa pelo Rust usa duas conexões (uma com quem
/// acessa, outra com o Node): sobe o limite de arquivos abertos até o teto
/// que a hospedagem deixa.
fn raise_file_limit() {
    #[cfg(unix)]
    match rlimit::increase_nofile_limit(u64::MAX) {
        Ok(n) => tracing::debug!("limite de arquivos abertos: {n}"),
        Err(e) => tracing::warn!("não deu pra subir o limite de arquivos abertos: {e}"),
    }
}
