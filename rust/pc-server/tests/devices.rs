//! Aparelhos conectados, desativar/excluir conta e troca rápida de conta —
//! num MySQL e Redis de verdade, com um "Node" de mentira pros avisos.

mod common;

use std::time::Duration;

use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use pc_server::session::sha256_hex;
use serde_json::{Value, json};
use sqlx::{Executor, Row};

const PASSWORD: &str = "Senha-Certa-123";
const CHROME_WIN: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

async fn env() -> Option<(Env, Calls)> {
    let calls: Calls = Default::default();
    let node = fake_node(calls.clone()).await;
    let env = setup_with(|c| pc_server::config::Config {
        node_upstream: format!("http://{node}"),
        ..c
    })
    .await?;
    if env.redis_url.is_none() {
        eprintln!("PC_TEST_REDIS_URL não definida — pulando");
        return None;
    }
    Some((env, calls))
}

fn ip() -> String {
    let n = uuid::Uuid::new_v4().as_u128();
    format!("10.{}.{}.{}", (n >> 16) as u8, (n >> 8) as u8, n as u8)
}

struct Resp {
    status: u16,
    cookies: Vec<String>,
    body: Value,
}

async fn call(
    env: &Env,
    method: &str,
    path: &str,
    user: Option<&str>,
    cookie: Option<&str>,
    body: Value,
) -> Resp {
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header("x-forwarded-for", ip())
        .header("user-agent", CHROME_WIN);
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    // sem corpo (como o site faz no GET/DELETE)
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    let cookies = r
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let text = r.text().await.unwrap();
    Resp {
        status,
        cookies,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
    }
}

async fn user(env: &Env, id: &str) {
    add_user(&env.db, id, "").await;
    let hash = include_str!("fixtures/bcryptjs_hash.txt").trim();
    sqlx::query("UPDATE `User` SET passwordHash = ? WHERE id = ?")
        .bind(hash)
        .bind(id)
        .execute(&env.db)
        .await
        .unwrap();
}

/// Sessão ativa. `started` = início da sessão (mesma família = mesmo valor).
async fn add_token(env: &Env, id: &str, user: &str, raw: &str, ip: &str, started: &str) {
    env.db
        .execute(
            format!(
                "INSERT INTO RefreshToken (id, tokenHash, userId, userAgent, ipAddress, createdAt, expiresAt, \
                 sessionStartedAt, lastUsedAt) VALUES ('{id}', '{hash}', '{user}', '{CHROME_WIN}', '{ip}', \
                 UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 30 DAY, '{started}', UTC_TIMESTAMP(3))",
                hash = sha256_hex(raw)
            )
            .as_str(),
        )
        .await
        .unwrap();
}

async fn revoked(env: &Env, id: &str) -> (bool, Option<String>) {
    let r = sqlx::query("SELECT revoked, revokedReason FROM RefreshToken WHERE id = ?")
        .bind(id)
        .fetch_one(&env.db)
        .await
        .unwrap();
    (r.get("revoked"), r.get("revokedReason"))
}

async fn logs(env: &Env, user: &str) -> Vec<String> {
    sqlx::query_scalar("SELECT action FROM SecurityLog WHERE userId = ? ORDER BY createdAt")
        .bind(user)
        .fetch_all(&env.db)
        .await
        .unwrap()
}

fn kicks(calls: &Calls) -> Vec<Value> {
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == "/api/internal/kick")
        .map(|(_, _, b)| b.clone())
        .collect()
}

async fn wait_kicks(calls: &Calls, n: usize) -> Vec<Value> {
    for _ in 0..50 {
        let k = kicks(calls);
        if k.len() >= n {
            return k;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    kicks(calls)
}

#[tokio::test]
async fn lista_e_encerra_aparelhos() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1").await;
    user(&env, "u2").await;
    add_token(
        &env,
        "atual",
        "u1",
        "token-atual",
        "200.150.10.5",
        "2026-01-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "outro",
        "u1",
        "token-outro",
        "::ffff:177.10.2.3",
        "2026-02-01 00:00:00.000",
    )
    .await;
    // filho do "outro" nascendo numa rotação (mesma família, sem corrente)
    add_token(
        &env,
        "outro-filho",
        "u1",
        "token-filho",
        "177.10.2.3",
        "2026-02-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "alheio",
        "u2",
        "token-alheio",
        "1.2.3.4",
        "2026-02-01 00:00:00.000",
    )
    .await;
    let cookie = "refreshToken=token-atual";

    let r = call(
        &env,
        "GET",
        "/api/auth/sessions",
        Some("u1"),
        Some(cookie),
        json!(null),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let list = r.body["sessions"].as_array().unwrap();
    assert_eq!(list.len(), 3);
    let atual = list.iter().find(|s| s["id"] == "atual").unwrap();
    assert_eq!(atual["isCurrent"], true);
    assert_eq!(atual["device"], "Chrome no Windows");
    assert_eq!(atual["ip"], "200.150.x.x");
    assert_eq!(atual["createdAt"], "2026-01-01T00:00:00.000Z");
    let outro = list.iter().find(|s| s["id"] == "outro").unwrap();
    assert_eq!(outro["isCurrent"], false);
    assert_eq!(outro["ip"], "177.10.x.x");

    // sem login → 401
    let r = call(&env, "GET", "/api/auth/sessions", None, None, json!(null)).await;
    assert_eq!(r.status, 401);

    // a atual não pode, a de outra conta não existe
    let r = call(
        &env,
        "DELETE",
        "/api/auth/sessions/atual",
        Some("u1"),
        Some(cookie),
        json!(null),
    )
    .await;
    assert_eq!(r.status, 400);
    assert_eq!(
        r.body["error"],
        "Use \"Sair\" para encerrar a sessão atual."
    );
    let r = call(
        &env,
        "DELETE",
        "/api/auth/sessions/alheio",
        Some("u1"),
        Some(cookie),
        json!(null),
    )
    .await;
    assert_eq!(r.status, 404);
    assert_eq!(r.body["error"], "Sessão não encontrada.");
    assert!(!revoked(&env, "alheio").await.0);

    // encerra o "outro" e o filho que estava nascendo junto
    let r = call(
        &env,
        "DELETE",
        "/api/auth/sessions/outro",
        Some("u1"),
        Some(cookie),
        json!(null),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body, json!({ "ok": true }));
    assert_eq!(revoked(&env, "outro").await, (true, Some("REVOKED".into())));
    assert_eq!(
        revoked(&env, "outro-filho").await,
        (true, Some("REVOKED".into()))
    );
    assert!(!revoked(&env, "atual").await.0);
    assert_eq!(logs(&env, "u1").await, vec!["SESSION_REVOKED"]);
}

#[tokio::test]
async fn sair_dos_outros_aparelhos() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1").await;
    user(&env, "u2").await;
    add_token(
        &env,
        "atual",
        "u1",
        "token-atual",
        "1.1.1.1",
        "2026-01-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "a",
        "u1",
        "token-a",
        "1.1.1.1",
        "2026-02-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "b",
        "u1",
        "token-b",
        "1.1.1.1",
        "2026-03-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "alheio",
        "u2",
        "token-alheio",
        "1.1.1.1",
        "2026-03-01 00:00:00.000",
    )
    .await;

    let r = call(
        &env,
        "DELETE",
        "/api/auth/sessions/other",
        Some("u1"),
        Some("refreshToken=token-atual"),
        json!(null),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert!(!revoked(&env, "atual").await.0);
    assert_eq!(revoked(&env, "a").await, (true, Some("REVOKED".into())));
    assert_eq!(revoked(&env, "b").await, (true, Some("REVOKED".into())));
    assert!(!revoked(&env, "alheio").await.0);
    // o "lembrar login" deste aparelho é renovado
    assert!(
        r.cookies.iter().any(|c| c.starts_with("pcKeep=Fe26.2")),
        "{:?}",
        r.cookies
    );
    let client = redis::Client::open(env.redis_url.clone().unwrap()).unwrap();
    let mut con = client.get_multiplexed_async_connection().await.unwrap();
    let at: Option<String> = redis::AsyncCommands::get(&mut con, "sess:revoked-at:u1")
        .await
        .unwrap();
    assert!(at.is_some());
    assert_eq!(logs(&env, "u1").await, vec!["SESSIONS_REVOKED_OTHERS"]);
}

#[tokio::test]
async fn desativar_e_excluir_conta() {
    let Some((env, calls)) = env().await else {
        return;
    };
    user(&env, "u1").await;
    user(&env, "u2").await;
    add_token(
        &env,
        "t1",
        "u1",
        "token-1",
        "1.1.1.1",
        "2026-01-01 00:00:00.000",
    )
    .await;
    add_token(
        &env,
        "t2",
        "u2",
        "token-2",
        "1.1.1.1",
        "2026-01-01 00:00:00.000",
    )
    .await;
    env.db
        .execute("INSERT INTO AccountSwitchToken (id, userId, tokenHash, expiresAt) VALUES ('s2', 'u2', 'h', UTC_TIMESTAMP(3) + INTERVAL 1 DAY)")
        .await
        .unwrap();

    // senha errada
    let r = call(
        &env,
        "POST",
        "/api/auth/deactivate",
        Some("u1"),
        None,
        json!({ "password": "errada" }),
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.body["error"], "Senha incorreta.");
    let r = call(
        &env,
        "POST",
        "/api/auth/delete-account",
        Some("u2"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 401);

    // desativar por um tempo
    let r = call(
        &env,
        "POST",
        "/api/auth/deactivate",
        Some("u1"),
        None,
        json!({ "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert!(
        r.cookies.iter().any(|c| c.starts_with("refreshToken=;")),
        "{:?}",
        r.cookies
    );
    assert!(
        r.cookies.iter().any(|c| c.starts_with("pcKeep=;")),
        "{:?}",
        r.cookies
    );
    let row = sqlx::query(
        "SELECT selfDeactivatedAt IS NOT NULL AS d, status FROM `User` WHERE id = 'u1'",
    )
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!(row.get::<i64, _>("d"), 1);
    assert_eq!(row.get::<String, _>("status"), "OFFLINE");
    assert_eq!(revoked(&env, "t1").await, (true, Some("LOGOUT".into())));
    let k = wait_kicks(&calls, 1).await;
    assert_eq!(
        k[0],
        json!({ "userId": "u1", "event": "account:disabled", "payload": { "temporary": true } })
    );

    // excluir (desativa de vez; contas salvas pra troca saem)
    let r = call(
        &env,
        "POST",
        "/api/auth/delete-account",
        Some("u2"),
        None,
        json!({ "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let d: i64 =
        sqlx::query_scalar("SELECT accountDisabledAt IS NOT NULL FROM `User` WHERE id = 'u2'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(d, 1);
    assert_eq!(
        revoked(&env, "t2").await,
        (true, Some("ACCOUNT_DISABLED".into()))
    );
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM AccountSwitchToken WHERE userId = 'u2'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let k = wait_kicks(&calls, 2).await;
    assert_eq!(
        k[1],
        json!({ "userId": "u2", "event": "account:disabled", "payload": {} })
    );
}

#[tokio::test]
async fn troca_rapida_de_conta() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1").await;
    user(&env, "u2").await;

    // guardar (só logado)
    let r = call(
        &env,
        "POST",
        "/api/auth/switch/remember",
        None,
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 401);
    let r = call(
        &env,
        "POST",
        "/api/auth/switch/remember",
        Some("u2"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let token = r.body["token"].as_str().unwrap().to_string();
    assert_eq!(token.len(), 43);

    // token curto, desconhecido
    let r = call(
        &env,
        "POST",
        "/api/auth/switch",
        None,
        None,
        json!({ "token": "curto" }),
    )
    .await;
    assert_eq!(r.status, 400);
    assert_eq!(r.body["error"], "Conta salva inválida.");
    let r = call(
        &env,
        "POST",
        "/api/auth/switch",
        None,
        None,
        json!({ "token": "x".repeat(30) }),
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.body["code"], "SWITCH_EXPIRED");

    // troca: sai da sessão atual (u1) e entra na u2
    add_token(
        &env,
        "atual",
        "u1",
        "token-atual",
        "1.1.1.1",
        "2026-01-01 00:00:00.000",
    )
    .await;
    let r = call(
        &env,
        "POST",
        "/api/auth/switch",
        None,
        Some("refreshToken=token-atual"),
        json!({ "token": token }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["id"], "u2");
    let access = r.body["accessToken"].as_str().unwrap();
    assert_eq!(Tokens::new(SECRET).verify(access).unwrap().sub, "u2");
    assert!(
        r.cookies
            .iter()
            .any(|c| c.starts_with("refreshToken=") && !c.starts_with("refreshToken=;"))
    );
    assert_eq!(revoked(&env, "atual").await, (true, Some("LOGOUT".into())));

    // conta banida: o token salvo é apagado
    sqlx::query("UPDATE `User` SET isPlatformBanned = 1 WHERE id = 'u2'")
        .execute(&env.db)
        .await
        .unwrap();
    let r = call(
        &env,
        "POST",
        "/api/auth/switch",
        None,
        None,
        json!({ "token": token }),
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.body["error"], "Essa conta não está disponível.");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM AccountSwitchToken")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 0);

    // esquecer: tira da lista
    let r = call(
        &env,
        "POST",
        "/api/auth/switch/remember",
        Some("u1"),
        None,
        json!({}),
    )
    .await;
    let t1 = r.body["token"].as_str().unwrap().to_string();
    let r = call(
        &env,
        "POST",
        "/api/auth/switch/forget",
        None,
        None,
        json!({ "token": t1 }),
    )
    .await;
    assert_eq!(r.body, json!({ "ok": true }));
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM AccountSwitchToken")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn guarda_no_maximo_dez_contas_por_pessoa() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1").await;
    for _ in 0..12 {
        let r = call(
            &env,
            "POST",
            "/api/auth/switch/remember",
            Some("u1"),
            None,
            json!({}),
        )
        .await;
        assert_eq!(r.status, 200);
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM AccountSwitchToken WHERE userId = 'u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 10);
}
