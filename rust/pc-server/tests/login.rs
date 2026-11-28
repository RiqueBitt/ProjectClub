//! `POST /api/auth/login` num MySQL e Redis de verdade, com um "Node" de
//! mentira pra receber o aviso de aparelho novo — cada caso do `login` do Node.

mod common;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::HeaderMap;
use axum::routing::{any, post};
use common::{Env, SECRET, add_user, setup_with};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::{Executor, Row};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0) Chrome/130";
const PASSWORD: &str = "Senha-Certa-123";

/// O que o "Node" de mentira recebeu na rota interna.
type Alerts = Arc<Mutex<Vec<(String, Value)>>>;

async fn fake_node(alerts: Alerts) -> SocketAddr {
    let a = alerts.clone();
    let router = Router::new()
        .route(
            "/api/internal/login-alert",
            post(move |headers: HeaderMap, body: String| {
                let a = a.clone();
                async move {
                    let secret = headers
                        .get("x-pc-internal")
                        .map(|v| v.to_str().unwrap().to_string())
                        .unwrap_or_default();
                    a.lock()
                        .unwrap()
                        .push((secret, serde_json::from_str(&body).unwrap()));
                    "{\"ok\":true}"
                }
            }),
        )
        .fallback(any(|| async {
            (axum::http::StatusCode::IM_A_TEAPOT, "node")
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    addr
}

async fn env_with_node() -> Option<(Env, Alerts)> {
    let alerts: Alerts = Arc::default();
    let node = fake_node(alerts.clone()).await;
    let env = setup_with(|c| pc_server::config::Config {
        node_upstream: format!("http://{node}"),
        client_origin: "https://projectclub.shardweb.app".into(),
        ..c
    })
    .await?;
    if env.redis_url.is_none() {
        eprintln!(
            "PC_TEST_REDIS_URL não definida — o login precisa do Redis (limite por IP), pulando"
        );
        return None;
    }
    Some((env, alerts))
}

/// IP único por teste (o limite por IP mora no Redis, que é compartilhado).
fn ip() -> String {
    let n = uuid::Uuid::new_v4().as_u128();
    format!("10.{}.{}.{}", (n >> 16) as u8, (n >> 8) as u8, n as u8)
}

struct Resp {
    status: u16,
    headers: reqwest::header::HeaderMap,
    body: Value,
}

async fn login(env: &Env, ip: &str, body: Value) -> Resp {
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/auth/login", env.gw))
        .header("user-agent", UA)
        .header("x-forwarded-for", ip)
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = r.status().as_u16();
    let headers = r.headers().clone();
    let text = r.text().await.unwrap();
    Resp {
        status,
        headers,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
    }
}

async fn user_with_password(env: &Env, id: &str, extra: &str) {
    add_user(&env.db, id, extra).await;
    let hash = include_str!("fixtures/bcryptjs_hash.txt").trim(); // feito pelo bcryptjs do Node
    sqlx::query("UPDATE `User` SET passwordHash = ? WHERE id = ?")
        .bind(hash)
        .bind(id)
        .execute(&env.db)
        .await
        .unwrap();
}

async fn counters(env: &Env, id: &str) -> (i64, bool) {
    let r = sqlx::query("SELECT failedLoginAttempts, loginLockedUntil IS NOT NULL AS locked FROM `User` WHERE id = ?")
        .bind(id)
        .fetch_one(&env.db)
        .await
        .unwrap();
    (
        r.get::<i32, _>("failedLoginAttempts") as i64,
        r.get::<i64, _>("locked") == 1,
    )
}

#[tokio::test]
async fn validacao_do_corpo() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    let ip = ip();
    let r = login(&env, &ip, json!({})).await;
    assert_eq!(
        (r.status, r.body),
        (400, json!({ "error": "Informe usuário/e-mail e senha." }))
    );
    let r = login(&env, &ip, json!({ "emailOrUsername": {}, "password": "x" })).await;
    assert_eq!(r.status, 400);
    let r = login(
        &env,
        &ip,
        json!({ "emailOrUsername": "a", "password": "x", "twoFactorCode": 123456 }),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (400, json!({ "error": "Código 2FA inválido." }))
    );
    // JSON quebrado: 400 (e não conta como tentativa)
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/auth/login", env.gw))
        .header("content-type", "application/json")
        .header("x-forwarded-for", &ip)
        .body("{ruim")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 400);
    // sem Content-Type json: corpo vazio → 400 normal
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/auth/login", env.gw))
        .header("x-forwarded-for", &ip)
        .body("emailOrUsername=a&password=b")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 400);
}

#[tokio::test]
async fn senha_errada_conta_e_trava_a_conta() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    user_with_password(&env, "u1", "").await;
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "fantasma", "password": "x" }),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (401, json!({ "error": "Credenciais inválidas." }))
    );
    for i in 1..=10 {
        // IP novo a cada vez pra não esbarrar no limite por IP
        let r = login(
            &env,
            &ip(),
            json!({ "emailOrUsername": "u1", "password": "errada" }),
        )
        .await;
        assert_eq!(r.status, 401, "tentativa {i}");
    }
    assert_eq!(counters(&env, "u1").await, (10, true));
    // travada: nem a senha certa entra
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u1@x.com", "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 429);
    assert_eq!(
        r.body["error"],
        "Muitas tentativas de login para esta conta. Tente novamente em 15 minuto(s)."
    );
}

#[tokio::test]
async fn login_certo_abre_sessao() {
    let Some((env, alerts)) = env_with_node().await else {
        return;
    };
    user_with_password(
        &env,
        "u1",
        ", status, failedLoginAttempts, selfDeactivatedAt|, 'INVISIBLE', 3, UTC_TIMESTAMP(3)",
    )
    .await;
    let ip = ip();
    // por e-mail (maiúsculas viram minúsculas) — senha feita pelo bcryptjs do Node
    let r = login(
        &env,
        &ip,
        json!({ "emailOrUsername": "  U1@X.COM ", "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["id"], "u1");
    assert_eq!(
        r.body["user"]["status"], "OFFLINE",
        "sem req.user o Node mascara até a própria pessoa"
    );
    assert_eq!(r.body["reactivated"], true);
    assert_eq!(
        Tokens::new(SECRET)
            .verify(r.body["accessToken"].as_str().unwrap())
            .unwrap()
            .sub,
        "u1"
    );
    let cookies: Vec<&str> = r
        .headers
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(cookies.iter().any(|c| c.starts_with("refreshToken=")));
    assert!(cookies.iter().any(|c| c.starts_with("pcKeep=Fe26.2")));
    // cabeçalhos do limite (draft-6) e do helmet/cors
    assert_eq!(r.headers["ratelimit-limit"], "15");
    assert_eq!(r.headers["ratelimit-remaining"], "14");
    assert_eq!(r.headers["ratelimit-policy"], "15;w=600");
    assert_eq!(
        r.headers["access-control-allow-origin"],
        "https://projectclub.shardweb.app"
    );
    assert_eq!(r.headers["access-control-allow-credentials"], "true");
    assert_eq!(r.headers["x-frame-options"], "SAMEORIGIN");
    assert!(
        r.headers["permissions-policy"]
            .to_str()
            .unwrap()
            .starts_with("geolocation=()")
    );
    assert!(
        r.headers["content-security-policy"]
            .to_str()
            .unwrap()
            .starts_with("default-src 'self'")
    );
    assert_eq!(r.headers["x-served-by"], "rust");
    // zerou os erros, reativou a conta, criou a sessão
    assert_eq!(counters(&env, "u1").await, (0, false));
    let deact: Option<chrono::NaiveDateTime> =
        sqlx::query_scalar("SELECT selfDeactivatedAt FROM `User` WHERE id='u1'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert!(deact.is_none());
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM RefreshToken WHERE userId='u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    // primeiro login da conta não é "aparelho novo"
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(alerts.lock().unwrap().is_empty());

    // outro aparelho → aviso pelo Node, com o segredo interno
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/auth/login", env.gw))
        .header("user-agent", "Celular Android")
        .header("x-forwarded-for", "200.200.200.200")
        .json(&json!({ "emailOrUsername": "u1", "password": PASSWORD }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 200);
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let got = alerts.lock().unwrap().clone();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].0, pc_server::node::internal_secret(SECRET));
    assert_eq!(got[0].1["userId"], "u1");
    assert_eq!(got[0].1["userAgent"], "Celular Android");
    assert_eq!(got[0].1["ip"], "200.200.200.200");
    assert!(
        got[0].1["sessionId"]
            .as_str()
            .is_some_and(|s| s.len() == 36)
    );
}

#[tokio::test]
async fn conta_banida_suspensa_desativada() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    user_with_password(
        &env,
        "ban",
        ", isPlatformBanned, platformBanReason|, 1, 'spam'",
    )
    .await;
    user_with_password(&env, "sus", ", suspendedUntil|, '2999-01-02 03:04:05.000'").await;
    user_with_password(&env, "des", ", accountDisabledAt|, UTC_TIMESTAMP(3)").await;
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "ban", "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["error"], "Esta conta foi banida da plataforma.");
    assert_eq!(r.body["platformBanned"], true);
    assert_eq!(r.body["reason"], "spam");
    // token de revisão: assinado com HMAC(JWT_ACCESS_SECRET, 'pc-appeal-token-v1'), typ appeal
    let appeal = r.body["appealToken"].as_str().unwrap();
    let secret = {
        use hmac::{Hmac, Mac};
        let mut m = Hmac::<sha2::Sha256>::new_from_slice(SECRET.as_bytes()).unwrap();
        m.update(b"pc-appeal-token-v1");
        hex::encode(m.finalize().into_bytes())
    };
    let data = jsonwebtoken::decode::<Value>(
        appeal,
        &jsonwebtoken::DecodingKey::from_secret(secret.as_bytes()),
        &jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256),
    )
    .unwrap();
    assert_eq!(data.claims["typ"], "appeal");
    assert_eq!(data.claims["sub"], "ban");

    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "sus", "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(
        r.body["error"],
        "Esta conta está suspensa até 02/01/2999, 03:04:05."
    );
    assert_eq!(r.body["suspendedUntil"], "2999-01-02T03:04:05.000Z");

    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "des", "password": PASSWORD }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["accountDisabled"], true);
}

#[tokio::test]
async fn dois_fatores() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    let secret = "JBSWY3DPEHPK3PXPJBSWY3DP";
    user_with_password(
        &env,
        "u2",
        &format!(", twoFactorEnabled, twoFactorSecret|, 1, '{secret}'"),
    )
    .await;
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD }),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (206, json!({ "requiresTwoFactor": true }))
    );

    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD, "twoFactorCode": "000000" }),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (401, json!({ "error": "Código 2FA inválido." }))
    );
    assert_eq!(counters(&env, "u2").await.0, 1);

    let code = pc_server::totp::generate(secret, chrono::Utc::now().timestamp()).unwrap();
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD, "twoFactorCode": code }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    // o mesmo código não entra duas vezes
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD, "twoFactorCode": code }),
    )
    .await;
    assert_eq!(r.status, 401);

    // código de recuperação: vale uma vez só (com ou sem hífen, maiúsculas)
    let hash = pc_server::session::sha256_hex("abcde-12345");
    sqlx::query("INSERT INTO TwoFactorRecoveryCode (id, userId, codeHash) VALUES ('rc1', 'u2', ?)")
        .bind(hash)
        .execute(&env.db)
        .await
        .unwrap();
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD, "recoveryCode": "ABCDE12345" }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let r = login(
        &env,
        &ip(),
        json!({ "emailOrUsername": "u2", "password": PASSWORD, "recoveryCode": "abcde-12345" }),
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (
            401,
            json!({ "error": "Código de recuperação inválido ou já usado." })
        )
    );
}

#[tokio::test]
async fn limite_por_ip_no_mesmo_contador_do_node() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    let ip = ip();
    for _ in 0..15 {
        assert_eq!(
            login(
                &env,
                &ip,
                json!({ "emailOrUsername": "x", "password": "y" })
            )
            .await
            .status,
            401
        );
    }
    let r = login(
        &env,
        &ip,
        json!({ "emailOrUsername": "x", "password": "y" }),
    )
    .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (
            429,
            json!({ "error": "Muitas tentativas de login. Tente novamente em alguns minutos." })
        )
    );
    assert!(r.headers.get("retry-after").is_some());
    assert_eq!(r.headers["ratelimit-remaining"], "0");
    // a chave é a mesma do rate-limit-redis do Node
    let client = redis::Client::open(env.redis_url.as_deref().unwrap()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let hits: i64 = redis::cmd("GET")
        .arg(format!("ratelimit:login:{ip}"))
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(hits, 16);
}

#[tokio::test]
async fn ip_bloqueado_cors_e_rota_interna() {
    let Some((env, _)) = env_with_node().await else {
        return;
    };
    // IP que caiu nas rotas-isca: 503 na rota do Rust também
    env.db
        .execute("INSERT INTO BlockedIp (id, ip, reason, hitCount, expiresAt) VALUES ('b1', '6.6.6.6', 'isca', 3, UTC_TIMESTAMP(3) + INTERVAL 1 DAY)")
        .await
        .unwrap();
    let r = login(&env, "6.6.6.6", json!({})).await;
    assert_eq!(r.status, 503);
    // pré-voo do CORS (OPTIONS) não é rota do Rust: vai pro Node
    let r = reqwest::Client::new()
        .request(
            reqwest::Method::OPTIONS,
            format!("http://{}/api/auth/login", env.gw),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 418, "o Node de mentira responde 418");
    // /api/internal não existe pra quem vem de fora (nem chega no Node)
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/internal/login-alert", env.gw))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 404);
}
