//! Configuração lida das variáveis de ambiente (as mesmas do servidor Node,
//! ver `server/src/config/env.js`), mais as do gateway.

use std::net::SocketAddr;

const DEFAULT_ACCESS_SECRET: &str = "dev_access_secret_change_me";
const DEFAULT_REFRESH_SECRET: &str = "dev_refresh_secret_change_me";
pub const DESKTOP_LATEST_URL: &str =
    "https://github.com/RiqueBitt/ProjectClub/releases/latest/download/latest.yml";

/// App de um provedor de login (Google/Discord/GitHub). O `Debug` não
/// mostra o segredo.
#[derive(Clone)]
pub struct OAuthClient {
    pub client_id: String,
    pub client_secret: String,
}

impl std::fmt::Debug for OAuthClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OAuthClient")
            .field("client_id", &self.client_id)
            .finish_non_exhaustive()
    }
}

/// Texto secreto: o `Debug` não mostra o valor.
#[derive(Clone, Default)]
pub struct Secret(pub String);

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(if self.0.is_empty() {
            "Secret(vazio)"
        } else {
            "Secret(***)"
        })
    }
}

/// `KLIPY_BASE` do gifController.js.
pub const KLIPY_BASE: &str = "https://api.klipy.com/v2";

/// Provedor → variáveis do app (`GOOGLE_CLIENT_ID` etc.), como no Node.
pub const OAUTH_ENV: [(&str, &str, &str); 3] = [
    ("google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    ("discord", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"),
    ("github", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"),
];

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
    /// `JWT_REFRESH_SECRET` — daqui sai a senha do cookie "lembrar login".
    pub jwt_refresh_secret: String,
    /// `ACCESS_TOKEN_TTL` (ex.: `15m`) — validade do token de acesso.
    pub access_token_ttl: std::time::Duration,
    /// `REFRESH_TOKEN_TTL_DAYS` (mínimo 90, como no Node).
    pub refresh_token_ttl_days: i64,
    /// `PLATFORM_ADMIN_EMAIL` — dono da plataforma (vira ADMIN no login).
    pub platform_admin_email: String,
    /// `CLIENT_ORIGIN` — origem do site (CORS), como no Node.
    pub client_origin: String,
    /// Provedores de login configurados (só os com as DUAS variáveis).
    pub oauth_clients: std::collections::BTreeMap<String, OAuthClient>,
    /// Só nos testes: troca os endereços dos provedores por um servidor falso.
    pub oauth_test_base: Option<String>,
    /// `KLIPY_KEY` (ou `VITE_KLIPY_KEY`): chave da busca de GIFs.
    pub klipy_key: Secret,
    /// Endereço da API da Klipy (os testes apontam pra um servidor falso).
    pub klipy_base: String,
    /// `PC_RUST_SKIP`: começos de caminho (separados por vírgula) que o Rust
    /// NÃO responde — vão direto pro Node, mesmo já portados. É a chave de
    /// emergência por rota (ex.: `/api/economy,/api/friends`).
    pub skip_prefixes: Vec<String>,
    /// `PC_RUST_FALLBACK` (ligado, a não ser que seja `0`): leitura (GET) que
    /// der erro interno no Rust é refeita no Node.
    pub get_fallback: bool,
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
        let jwt_refresh_secret = env_or("JWT_REFRESH_SECRET", DEFAULT_REFRESH_SECRET);
        if node_env == "production"
            && (jwt_access_secret == DEFAULT_ACCESS_SECRET
                || jwt_refresh_secret == DEFAULT_REFRESH_SECRET)
        {
            anyhow::bail!(
                "JWT_ACCESS_SECRET e/ou JWT_REFRESH_SECRET ainda estão com o valor padrão de desenvolvimento"
            );
        }
        let access_token_ttl = parse_duration(&env_or("ACCESS_TOKEN_TTL", "15m"))
            .ok_or_else(|| anyhow::anyhow!("ACCESS_TOKEN_TTL inválido"))?;
        let refresh_token_ttl_days = std::env::var("REFRESH_TOKEN_TTL_DAYS")
            .ok()
            .and_then(|v| v.trim().parse::<i64>().ok())
            .filter(|d| *d != 0)
            .unwrap_or(90)
            .max(90);
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
            jwt_refresh_secret,
            access_token_ttl,
            refresh_token_ttl_days,
            platform_admin_email: env_or("PLATFORM_ADMIN_EMAIL", ""),
            client_origin: env_or("CLIENT_ORIGIN", "http://localhost:5173"),
            oauth_clients: OAUTH_ENV
                .iter()
                .filter_map(|(p, id, secret)| {
                    let id = std::env::var(id).unwrap_or_default().trim().to_string();
                    let secret = std::env::var(secret).unwrap_or_default().trim().to_string();
                    (!id.is_empty() && !secret.is_empty()).then(|| {
                        (
                            p.to_string(),
                            OAuthClient {
                                client_id: id,
                                client_secret: secret,
                            },
                        )
                    })
                })
                .collect(),
            oauth_test_base: None,
            klipy_key: Secret(
                std::env::var("KLIPY_KEY")
                    .ok()
                    .filter(|v| !v.is_empty())
                    .or_else(|| std::env::var("VITE_KLIPY_KEY").ok())
                    .unwrap_or_default(),
            ),
            klipy_base: KLIPY_BASE.into(),
            skip_prefixes: parse_skip(&std::env::var("PC_RUST_SKIP").unwrap_or_default()),
            get_fallback: std::env::var("PC_RUST_FALLBACK")
                .map(|v| v.trim() != "0")
                .unwrap_or(true),
        })
    }
}

/// `PC_RUST_SKIP`: só começos de caminho de verdade (`/api/...`), sem barra no fim.
pub fn parse_skip(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|p| p.trim().trim_end_matches('/'))
        .filter(|p| p.starts_with('/') && p.len() > 1)
        .map(String::from)
        .collect()
}

/// O caminho está num dos começos de `PC_RUST_SKIP`? (`/api/eco` não pega
/// `/api/economy`: só o caminho inteiro ou seguido de `/`.)
pub fn is_skipped(prefixes: &[String], path: &str) -> bool {
    prefixes.iter().any(|p| {
        path.strip_prefix(p.as_str())
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

fn env_or(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

/// Tempo no formato da biblioteca `ms` do Node (`15m`, `1h`, `7d`, `30s`,
/// `900` = milissegundos) — usado no `expiresIn` do token de acesso.
pub fn parse_duration(v: &str) -> Option<std::time::Duration> {
    let v = v.trim().to_ascii_lowercase();
    let split = v
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(v.len());
    let (num, unit) = v.split_at(split);
    let n: f64 = num.parse().ok()?;
    let ms = match unit.trim() {
        "" | "ms" | "msec" | "msecs" | "millisecond" | "milliseconds" => n,
        "s" | "sec" | "secs" | "second" | "seconds" => n * 1e3,
        "m" | "min" | "mins" | "minute" | "minutes" => n * 60e3,
        "h" | "hr" | "hrs" | "hour" | "hours" => n * 3600e3,
        "d" | "day" | "days" => n * 86_400e3,
        "w" | "week" | "weeks" => n * 604_800e3,
        "y" | "yr" | "yrs" | "year" | "years" => n * 31_557_600e3,
        _ => return None,
    };
    Some(std::time::Duration::from_millis(ms as u64))
}

impl Config {
    /// Valores neutros pros testes (cada teste troca o que precisa).
    pub fn for_tests() -> Self {
        Self {
            listen: "127.0.0.1:0".parse().expect("endereço"),
            node_upstream: "http://127.0.0.1:9".into(),
            node_env: "test".into(),
            redis_url: None,
            desktop_latest_url: String::new(),
            database_url: None,
            jwt_access_secret: "teste".into(),
            jwt_refresh_secret: "teste-refresh".into(),
            access_token_ttl: std::time::Duration::from_secs(900),
            refresh_token_ttl_days: 90,
            platform_admin_email: String::new(),
            client_origin: "http://localhost:5173".into(),
            oauth_clients: Default::default(),
            oauth_test_base: None,
            klipy_key: Secret::default(),
            klipy_base: KLIPY_BASE.into(),
            skip_prefixes: vec![],
            // os testes conferem a resposta do próprio Rust (inclusive os 500)
            get_fallback: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_duration;
    use std::time::Duration;

    #[test]
    fn chave_de_emergencia_por_rota() {
        let p = super::parse_skip(" /api/economy/, api/x, /, ,/api/friends");
        assert_eq!(p, ["/api/economy", "/api/friends"]);
        assert!(super::is_skipped(&p, "/api/economy"));
        assert!(super::is_skipped(&p, "/api/economy/rank"));
        assert!(!super::is_skipped(&p, "/api/economy2"));
        assert!(!super::is_skipped(&p, "/api/users/me"));
        assert!(!super::is_skipped(&[], "/api/economy"));
    }

    #[test]
    fn tempo_como_o_ms_do_node() {
        assert_eq!(parse_duration("15m"), Some(Duration::from_secs(900)));
        assert_eq!(parse_duration("1h"), Some(Duration::from_secs(3600)));
        assert_eq!(parse_duration("7d"), Some(Duration::from_secs(604_800)));
        assert_eq!(parse_duration("30 s"), Some(Duration::from_secs(30)));
        assert_eq!(parse_duration("lixo"), None);
    }
}
