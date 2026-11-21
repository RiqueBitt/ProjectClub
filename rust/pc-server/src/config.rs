//! Configuração lida das variáveis de ambiente (as mesmas do servidor Node,
//! ver `server/src/config/env.js`), mais as do gateway.

use std::net::SocketAddr;

pub const DESKTOP_LATEST_URL: &str =
    "https://github.com/RiqueBitt/ProjectClub/releases/latest/download/latest.yml";

#[derive(Clone, Debug)]
pub struct Config {
    /// Onde o Rust escuta (a porta pública do app: `PORT`, como no Node).
    pub listen: SocketAddr,
    /// Onde o Node ficou (porta interna): tudo que ainda não foi portado vai pra lá.
    pub node_upstream: String,
    /// `NODE_ENV` (production / development).
    pub node_env: String,
    /// `REDIS_URL` — o mesmo Redis do Node (cache compartilhado).
    pub redis_url: Option<String>,
    /// De onde vem a versão nova do app de PC (o latest.yml do electron-updater).
    pub desktop_latest_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let node_env = env_or("NODE_ENV", "development");
        let default_port = if node_env == "production" {
            "80"
        } else {
            "3000"
        };
        let port: u16 = env_or("PORT", default_port).parse()?;
        let node_upstream = env_or("PC_NODE_UPSTREAM", "http://127.0.0.1:3001");
        let redis_url = std::env::var("REDIS_URL")
            .ok()
            .filter(|v| !v.trim().is_empty());
        Ok(Self {
            listen: SocketAddr::from(([0, 0, 0, 0], port)),
            node_upstream: node_upstream.trim_end_matches('/').to_string(),
            node_env,
            redis_url,
            desktop_latest_url: env_or("PC_DESKTOP_LATEST_URL", DESKTOP_LATEST_URL),
        })
    }
}

fn env_or(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
