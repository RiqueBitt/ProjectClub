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
                    Ok(sqlx::query_scalar("SELECT VERSION()")
                        .fetch_one(&db)
                        .await?)
                })
                .await?;
                let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM `User`")
                    .fetch_one(&db)
                    .await?;
                let tz: String = sqlx::query_scalar("SELECT @@session.time_zone")
                    .fetch_one(&db)
                    .await?;
                let tls: Option<(String, String)> =
                    sqlx::query_as("SHOW SESSION STATUS LIKE 'Ssl_version'")
                        .fetch_optional(&db)
                        .await
                        .ok()
                        .flatten();
                let tls = tls
                    .map(|(_, v)| v)
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

#[cfg(test)]
mod tests {
    #[test]
    fn nao_mostra_senha() {
        let s = super::host_of("rediss://default:senha@abc123.shardatabases.app:6379");
        assert_eq!(s, "rediss://…shardatabases.app:6379");
        assert!(!s.contains("senha"));
    }
}
