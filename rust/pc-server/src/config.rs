//! Configuração lida das variáveis de ambiente (as mesmas do servidor Node,
//! ver `server/src/config/env.js`), mais as do gateway.

use std::net::SocketAddr;

const DEFAULT_ACCESS_SECRET: &str = "dev_access_secret_change_me";
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
    /// `DATABASE_URL` — o mesmo MySQL do Node.
    pub database_url: Option<String>,
    /// `JWT_ACCESS_SECRET` — assina os tokens de acesso (o mesmo do Node).
    pub jwt_access_secret: String,
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
        // Igual ao Node: em produção, recusa subir com o segredo padrão
        // (público no código) — senão qualquer um forjaria login de qualquer conta.
        let jwt_access_secret = env_or("JWT_ACCESS_SECRET", DEFAULT_ACCESS_SECRET);
        if node_env == "production" && jwt_access_secret == DEFAULT_ACCESS_SECRET {
            anyhow::bail!("JWT_ACCESS_SECRET ainda está com o valor padrão de desenvolvimento");
        }
        Ok(Self {
            listen: SocketAddr::from(([0, 0, 0, 0], port)),
            node_upstream: node_upstream.trim_end_matches('/').to_string(),
            node_env,
            redis_url,
            desktop_latest_url: env_or("PC_DESKTOP_LATEST_URL", DESKTOP_LATEST_URL),
            database_url: std::env::var("DATABASE_URL")
                .ok()
                .filter(|v| v.starts_with("mysql://")),
            jwt_access_secret,
        })
    }
}

fn env_or(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
