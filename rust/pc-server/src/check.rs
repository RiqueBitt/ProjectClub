//! `pc-server check` — confere se o Rust alcança o Redis e o MySQL de
//! verdade (com TLS) usando as mesmas variáveis do Node, sem subir o
//! servidor. Não mostra senha nem endereço completo.

use std::time::Instant;

use redis::AsyncCommands;

use crate::config::Config;

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .map(|u| {
            let host = u.host_str().unwrap_or("?");
            // só o domínio principal (sem o nome do banco)
            let short: Vec<&str> = host.rsplitn(3, '.').collect();
            let base = if short.len() >= 2 {
                format!("{}.{}", short[1], short[0])
            } else {
                host.to_string()
            };
            format!("{}://…{}:{}", u.scheme(), base, u.port().unwrap_or(0))
        })
        .unwrap_or_else(|| "?".into())
}

async fn step<T>(
    name: &str,
    f: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    println!("  … {name}");
    match tokio::time::timeout(std::time::Duration::from_secs(15), f).await {
        Ok(r) => r,
        Err(_) => anyhow::bail!("{name}: passou de 15 s sem resposta"),
    }
}

/// `only`: "redis", "mysql" ou vazio (os dois).
pub async fn run(config: &Config, only: &str) -> bool {
    let mut ok = true;

    match config
        .redis_url
        .as_deref()
        .filter(|_| only.is_empty() || only == "redis")
    {
        None => println!("redis: REDIS_URL não definida"),
        Some(url) => {
            let t = Instant::now();
            println!("redis {}:", host_of(url));
            let r: anyhow::Result<String> = async {
                let client = redis::Client::open(url)?;
                let mut conn = step("conectar (TLS + senha)", async {
                    Ok(client.get_multiplexed_async_connection().await?)
                })
                .await?;
                let pong: String = step("PING", async {
                    Ok(redis::cmd("PING").query_async(&mut conn).await?)
                })
                .await?;
                let key = format!("pc:rust:check:{}", uuid::Uuid::new_v4().simple());
                step("gravar e ler", async {
                    let _: () = conn.set_ex(&key, "ok", 30).await?;
                    let back: String = conn.get(&key).await?;
                    let _: () = conn.del(&key).await?;
                    Ok(format!("{pong}, gravou e leu \"{back}\""))
                })
                .await
            }
            .await;
            match r {
                Ok(msg) => println!("redis {}: OK ({msg}) em {:?}", host_of(url), t.elapsed()),
                Err(e) => {
                    ok = false;
                    println!("redis {}: FALHOU — {e}", host_of(url));
                }
            }
        }
    }

    match config
        .database_url
        .as_deref()
        .filter(|_| only.is_empty() || only == "mysql")
    {
        None => println!("mysql: DATABASE_URL não definida"),
        Some(url) => {
            let t = Instant::now();
            println!("mysql {}:", host_of(url));
            let r: anyhow::Result<String> = async {
                let db = crate::db::connect_lazy(url)?;
                let version: String = step("conectar e SELECT VERSION()", async {
                    Ok(crate::db::scalar(&db, "SELECT VERSION()", vec![])
                        .await?
                        .unwrap_or_default())
                })
                .await?;
                let users: i64 = crate::db::scalar(&db, "SELECT COUNT(*) FROM `User`", vec![])
                    .await?
                    .unwrap_or(0);
                let tz: String = crate::db::scalar(&db, "SELECT @@session.time_zone", vec![])
                    .await?
                    .unwrap_or_default();
                let tls: String =
                    crate::db::first(&db, "SHOW SESSION STATUS LIKE 'Ssl_version'", vec![])
                        .await
                        .ok()
                        .flatten()
                        .and_then(|r| crate::db::get::<String>(&r, "Value").ok())
                        .filter(|v| !v.is_empty())
                        .unwrap_or_else(|| "sem TLS".into());
                Ok(format!(
                    "versão {version}, {users} contas, fuso da sessão {tz}, {tls}"
                ))
            }
            .await;
            match r {
                Ok(msg) => println!("mysql {}: OK ({msg}) em {:?}", host_of(url), t.elapsed()),
                Err(e) => {
                    ok = false;
                    println!("mysql {}: FALHOU — {e}", host_of(url));
                }
            }
        }
    }
    ok
}

/// Diagnóstico do Redis por etapas: TCP, TLS (com o nome do servidor) e um
/// PING cru — mostra exatamente onde trava, sem a biblioteca do Redis no meio.
pub async fn redis_raw(url: &str) {
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let Ok(u) = url::Url::parse(url) else {
        println!("  url inválida");
        return;
    };
    let host = u.host_str().unwrap_or("").to_string();
    let port = u.port().unwrap_or(6379);
    let t = Instant::now();
    let tcp = match tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tokio::net::TcpStream::connect((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return println!("  TCP: erro {e}"),
        Err(_) => return println!("  TCP: passou de 8 s"),
    };
    println!(
        "  TCP: ok em {:?} ({:?})",
        t.elapsed(),
        tcp.peer_addr().ok().map(|a| a.port())
    );
    if u.scheme() != "rediss" {
        return;
    }
    let roots = tokio_rustls::rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let cfg = tokio_rustls::rustls::ClientConfig::builder_with_provider(Arc::new(
        tokio_rustls::rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .expect("versões")
    .with_root_certificates(roots)
    .with_no_client_auth();
    let name = match tokio_rustls::rustls::pki_types::ServerName::try_from(host.clone()) {
        Ok(n) => n,
        Err(e) => return println!("  TLS: nome inválido {e}"),
    };
    let t = Instant::now();
    let mut tls = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio_rustls::TlsConnector::from(Arc::new(cfg)).connect(name, tcp),
    )
    .await
    {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return println!("  TLS: erro {e}"),
        Err(_) => return println!("  TLS: passou de 10 s (handshake travado)"),
    };
    let (_, conn) = tls.get_ref();
    println!(
        "  TLS: ok em {:?} ({:?}, ALPN {:?})",
        t.elapsed(),
        conn.protocol_version(),
        conn.alpn_protocol()
            .map(|a| String::from_utf8_lossy(a).to_string())
    );
    if tls.write_all(b"*1\r\n$4\r\nPING\r\n").await.is_err() {
        return println!("  PING: não enviou");
    }
    let mut buf = [0u8; 128];
    match tokio::time::timeout(std::time::Duration::from_secs(8), tls.read(&mut buf)).await {
        Ok(Ok(n)) => println!(
            "  PING sem senha: {:?}",
            String::from_utf8_lossy(&buf[..n]).trim()
        ),
        Ok(Err(e)) => println!("  PING: erro {e}"),
        Err(_) => println!("  PING: sem resposta em 8 s"),
    }
}

/// Mesmo teste com o `mysql_async` (o driver que o Prisma usa por baixo).
pub async fn mysql_async_probe(url: &str) {
    use mysql_async::prelude::Queryable;
    let r: anyhow::Result<String> = async {
        let opts = mysql_async::Opts::from_url(url)?;
        let mut conn = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            mysql_async::Conn::new(opts),
        )
        .await
        .map_err(|_| anyhow::anyhow!("passou de 10 s"))??;
        let v: Option<String> = conn.query_first("SELECT VERSION()").await?;
        let n: Option<i64> = conn.query_first("SELECT COUNT(*) FROM `User`").await?;
        conn.disconnect().await?;
        Ok(format!(
            "versão {}, {} contas",
            v.unwrap_or_default(),
            n.unwrap_or_default()
        ))
    }
    .await;
    match r {
        Ok(m) => println!("  mysql_async: OK ({m})"),
        Err(e) => println!("  mysql_async: {e}"),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn nao_mostra_senha() {
        let s = super::host_of("rediss://default:senha@abc123.shardatabases.app:6379");
        assert_eq!(s, "rediss://…shardatabases.app:6379");
        assert!(!s.contains("senha"));
    }
}
