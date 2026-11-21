//! Cache compartilhado com o Node: mesmas chaves (`cache:<chave>`), mesmo
//! formato (JSON) e mesmo TTL que `cacheGetOrSet` em
//! `server/src/config/redis.js` — o que um grava o outro lê.
//!
//! Sem Redis (ou com ele fora do ar) calcula direto, sem cache, igual ao Node.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde::{Serialize, de::DeserializeOwned};
use tokio::sync::{Mutex, broadcast};

#[derive(Clone, Default)]
pub struct Cache {
    redis: Option<ConnectionManager>,
    /// Quem pede a mesma chave enquanto ela está sendo calculada espera o
    /// primeiro cálculo (uma ida só à origem), como o `inflight` do Node.
    inflight: Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>,
}

impl Cache {
    pub async fn connect(url: Option<&str>) -> Self {
        let redis = match url {
            None => None,
            Some(url) => match redis::Client::open(url) {
                Ok(client) => match ConnectionManager::new(client).await {
                    Ok(conn) => Some(conn),
                    Err(err) => {
                        tracing::warn!("redis indisponível, seguindo sem cache: {err}");
                        None
                    }
                },
                Err(err) => {
                    tracing::warn!("REDIS_URL inválida, seguindo sem cache: {err}");
                    None
                }
            },
        };
        Self {
            redis,
            inflight: Arc::default(),
        }
    }

    /// `GET` direto (sem o prefixo `cache:`). `Err` = sem Redis ou falha
    /// (quem chama decide o que fazer — o Node costuma recusar).
    pub async fn get_raw(&self, key: &str) -> Result<Option<String>, ()> {
        let mut conn = self.redis.clone().ok_or(())?;
        conn.get::<_, Option<String>>(key).await.map_err(|_| ())
    }

    /// `SET key value EX ttl` direto. Falha só vai pro log.
    pub async fn set_raw(&self, key: &str, value: &str, ttl_secs: u64) {
        if let Some(mut conn) = self.redis.clone() {
            let r: Result<(), _> = conn.set_ex(key, value, ttl_secs).await;
            if let Err(e) = r {
                tracing::warn!("redis: não gravou {key}: {e}");
            }
        }
    }

    pub async fn get_or_set<T, F, Fut>(&self, key: &str, ttl_secs: u64, compute: F) -> T
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        let full = format!("cache:{key}");
        if let Some(mut conn) = self.redis.clone()
            && let Ok(Some(text)) = conn.get::<_, Option<String>>(&full).await
            && let Ok(v) = serde_json::from_str(&text)
        {
            return v;
        }

        // já tem alguém calculando esta chave? espera o resultado dele
        let waiter = {
            let mut map = self.inflight.lock().await;
            match map.get(key) {
                Some(tx) => Some(tx.subscribe()),
                None => {
                    map.insert(key.to_string(), broadcast::channel(1).0);
                    None
                }
            }
        };
        if let Some(mut rx) = waiter {
            if let Ok(text) = rx.recv().await
                && let Ok(v) = serde_json::from_str(&text)
            {
                return v;
            }
            // o cálculo do outro falhou: calcula por conta própria
            return compute().await;
        }

        let fresh = compute().await;
        let text = serde_json::to_string(&fresh).unwrap_or_default();
        if let Some(mut conn) = self.redis.clone() {
            let _: Result<(), _> = conn.set_ex(&full, &text, ttl_secs).await;
        }
        if let Some(tx) = self.inflight.lock().await.remove(key) {
            let _ = tx.send(text);
        }
        fresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn sem_redis_calcula_direto() {
        let cache = Cache::default();
        let v: u32 = cache.get_or_set("x", 60, || async { 7 }).await;
        assert_eq!(v, 7);
    }

    #[tokio::test]
    async fn pedidos_simultaneos_calculam_uma_vez() {
        let cache = Cache::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..5 {
            let (cache, calls) = (cache.clone(), calls.clone());
            tasks.push(tokio::spawn(async move {
                cache
                    .get_or_set("k", 60, || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        String::from("ok")
                    })
                    .await
            }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap(), "ok");
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
}
