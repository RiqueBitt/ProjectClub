//! `POST /api/auth/refresh` e `POST /api/auth/logout` — cada caminho do
//! `refresh` do Node, num MySQL de verdade.

mod common;

use common::{Env, REFRESH_SECRET, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use pc_server::session::{keep_password, sha256_hex};
use serde_json::{Value, json};
use sqlx::{Executor, Row};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0) Chrome/130";

struct Resp {
    status: u16,
    body: Value,
    set_cookies: Vec<String>,
}

impl Resp {
    fn cookie(&self, name: &str) -> Option<String> {
        self.set_cookies
            .iter()
            .find(|c| c.starts_with(&format!("{name}=")))
            .map(|c| c.split(';').next().unwrap()[name.len() + 1..].to_string())
    }
}

async fn post(env: &Env, path: &str, cookies: &str, ua: &str, ip: &str) -> Resp {
    let mut req = reqwest::Client::new()
        .post(format!("http://{}{path}", env.gw))
        .header("user-agent", ua)
        .header("x-forwarded-for", ip);
    if !cookies.is_empty() {
        req = req.header("cookie", cookies);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    let set_cookies = r
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let text = r.text().await.unwrap();
    Resp {
        status,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
        set_cookies,
    }
}

/// Refresh token com valor conhecido. `revoked` = (motivo, há quantos segundos).
#[allow(clippy::too_many_arguments)]
async fn add_token(
    db: &sqlx::MySqlPool,
    id: &str,
    user: &str,
    raw: &str,
    ua: &str,
    ip: &str,
    revoked: Option<(&str, i64)>,
    replaced_by: Option<&str>,
) {
    let (rev, reason, ago) = match revoked {
        Some((r, ago)) => (
            1,
            format!("'{r}'"),
            format!("UTC_TIMESTAMP(3) - INTERVAL {ago} SECOND"),
        ),
        None => (0, "NULL".into(), "NULL".into()),
    };
    let replaced = replaced_by
        .map(|r| format!("'{r}'"))
        .unwrap_or("NULL".into());
    db.execute(
        format!(
            "INSERT INTO RefreshToken (id, tokenHash, userId, userAgent, ipAddress, createdAt, expiresAt, revoked, revokedAt, \
             revokedReason, replacedById, sessionStartedAt, lastUsedAt) VALUES ('{id}', '{hash}', '{user}', '{ua}', '{ip}', \
             UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 30 DAY, {rev}, {ago}, {reason}, {replaced}, '2026-01-01 00:00:00.000', UTC_TIMESTAMP(3))",
            hash = sha256_hex(raw)
        )
        .as_str(),
    )
    .await
    .unwrap();
}

async fn token(db: &sqlx::MySqlPool, id: &str) -> (bool, Option<String>, Option<String>) {
    let r =
        sqlx::query("SELECT revoked, revokedReason, replacedById FROM RefreshToken WHERE id = ?")
            .bind(id)
            .fetch_one(db)
            .await
            .unwrap();
    (
        r.get("revoked"),
        r.get("revokedReason"),
        r.get("replacedById"),
    )
}

async fn count_tokens(db: &sqlx::MySqlPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM RefreshToken")
        .fetch_one(db)
        .await
        .unwrap()
}

fn assert_session(r: &Resp, user: &str) {
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["id"], user);
    let access = r.body["accessToken"].as_str().unwrap();
    assert_eq!(Tokens::new(SECRET).verify(access).unwrap().sub, user);
}

#[tokio::test]
async fn sem_cookie_e_saida() {
    let Some(env) = setup().await else { return };
    let r = post(&env, "/api/auth/refresh", "", UA, "1.1.1.1").await;
    assert_eq!(
        (r.status, r.body.clone()),
        (401, json!({ "error": "Sessão expirada." }))
    );

    add_user(&env.db, "u1", "").await;
    add_token(&env.db, "t1", "u1", "raw1", UA, "1.1.1.1", None, None).await;
    let r = post(&env, "/api/auth/logout", "refreshToken=raw1", UA, "1.1.1.1").await;
    assert_eq!((r.status, r.body.clone()), (200, json!({ "ok": true })));
    assert_eq!(r.cookie("refreshToken").as_deref(), Some(""));
    assert_eq!(r.cookie("pcKeep").as_deref(), Some(""));
    assert_eq!(token(&env.db, "t1").await.1.as_deref(), Some("LOGOUT"));
    // depois de sair, o refresh com o mesmo cookie não volta
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=raw1",
        UA,
        "1.1.1.1",
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.cookie("refreshToken").as_deref(), Some(""));
}

#[tokio::test]
async fn rotacao_normal_e_corrida() {
    let Some(env) = setup().await else { return };
    add_user(&env.db, "u1", ", status|, 'INVISIBLE'").await;
    add_token(&env.db, "t1", "u1", "raw1", UA, "1.1.1.1", None, None).await;

    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=raw1",
        UA,
        "1.1.1.1",
    )
    .await;
    assert_session(&r, "u1");
    // sem req.user, o Node mascara o invisível até da própria pessoa aqui
    assert_eq!(r.body["user"]["status"], "OFFLINE");
    let new_raw = r.cookie("refreshToken").unwrap();
    assert_eq!(new_raw.len(), 96);
    assert!(r.cookie("pcKeep").unwrap().starts_with("Fe26.2*1*"));
    let (rev, why, next) = token(&env.db, "t1").await;
    assert!(rev);
    assert_eq!(why.as_deref(), Some("ROTATED"));
    let next = next.unwrap();
    let started: chrono::NaiveDateTime =
        sqlx::query_scalar("SELECT sessionStartedAt FROM RefreshToken WHERE id = ?")
            .bind(&next)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(
        started.to_string(),
        "2026-01-01 00:00:00",
        "a sessão herda o início"
    );

    // a mesma aba de novo com o cookie velho, logo depois: só um token de acesso, sem sessão nova
    let before = count_tokens(&env.db).await;
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=raw1",
        "Outro navegador",
        "9.9.9.9",
    )
    .await;
    assert_session(&r, "u1");
    assert!(r.set_cookies.is_empty());
    assert_eq!(count_tokens(&env.db).await, before);

    // o cookie novo continua valendo
    let r = post(
        &env,
        "/api/auth/refresh",
        &format!("refreshToken={new_raw}"),
        UA,
        "1.1.1.1",
    )
    .await;
    assert_session(&r, "u1");
}

#[tokio::test]
async fn roubo_encerra_so_aquela_sessao() {
    let Some(env) = setup().await else { return };
    add_user(&env.db, "u1", "").await;
    // sessão A: t1 (rotacionado há 10 min) → t2 (também já usado) → t3 (atual)
    add_token(&env.db, "t3", "u1", "raw3", UA, "1.1.1.1", None, None).await;
    add_token(
        &env.db,
        "t2",
        "u1",
        "raw2",
        UA,
        "1.1.1.1",
        Some(("ROTATED", 300)),
        Some("t3"),
    )
    .await;
    add_token(
        &env.db,
        "t1",
        "u1",
        "raw1",
        UA,
        "1.1.1.1",
        Some(("ROTATED", 600)),
        Some("t2"),
    )
    .await;
    // outra sessão da mesma conta (outro aparelho)
    add_token(
        &env.db,
        "pc",
        "u1",
        "rawpc",
        "App desktop",
        "5.5.5.5",
        None,
        None,
    )
    .await;

    // alguém com o t1 antigo, de outro aparelho/rede
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=raw1",
        "Ladrão",
        "6.6.6.6",
    )
    .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (401, json!({ "error": "Sessão expirada." }))
    );
    for id in ["t1", "t2", "t3"] {
        let (rev, why, _) = token(&env.db, id).await;
        assert!(rev);
        if id == "t3" {
            assert_eq!(why.as_deref(), Some("THEFT"));
        }
    }
    assert!(
        !token(&env.db, "pc").await.0,
        "o outro aparelho continua logado"
    );
}

#[tokio::test]
async fn aparelho_que_perdeu_o_cookie_novo_recupera() {
    let Some(env) = setup().await else { return };
    add_user(&env.db, "u1", "").await;
    // t1 rotacionado há 10 min pra t2, mas t2 nunca foi usado
    add_token(&env.db, "t2", "u1", "raw2", UA, "1.1.1.1", None, None).await;
    add_token(
        &env.db,
        "t1",
        "u1",
        "raw1",
        UA,
        "2.2.2.2",
        Some(("ROTATED", 600)),
        Some("t2"),
    )
    .await;
    // mesmo navegador, rede diferente (fora da janela de corrida)
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=raw1",
        UA,
        "3.3.3.3",
    )
    .await;
    assert_session(&r, "u1");
    assert_eq!(token(&env.db, "t2").await.1.as_deref(), Some("ABANDONED"));
    let next = token(&env.db, "t1").await.2.unwrap();
    assert_ne!(next, "t2", "o anterior aponta pro token novo de verdade");
    assert!(!token(&env.db, &next).await.0);
}

#[tokio::test]
async fn conta_bloqueada_ou_sessao_encerrada() {
    let Some(env) = setup().await else { return };
    add_user(&env.db, "ban", ", isPlatformBanned|, 1").await;
    add_token(&env.db, "tb", "ban", "rawb", UA, "1.1.1.1", None, None).await;
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=rawb",
        UA,
        "1.1.1.1",
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(token(&env.db, "tb").await.1.as_deref(), Some("ADMIN"));
    assert_eq!(r.cookie("refreshToken").as_deref(), Some(""));

    add_user(&env.db, "u1", "").await;
    add_token(
        &env.db,
        "tl",
        "u1",
        "rawl",
        UA,
        "1.1.1.1",
        Some(("REVOKED", 5)),
        None,
    )
    .await;
    let r = post(
        &env,
        "/api/auth/refresh",
        "refreshToken=rawl",
        UA,
        "1.1.1.1",
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.cookie("pcKeep").as_deref(), Some(""));
}

#[tokio::test]
async fn lembrar_login() {
    let Some(env) = setup().await else { return };
    if env.redis_url.is_none() {
        eprintln!("PC_TEST_REDIS_URL não definida — pulando o lembrar login");
        return;
    }
    // cookie selado pelo Node (iron-session) com JWT_REFRESH_SECRET = "segredo"
    let from_node = include_str!("fixtures/keep_cookie_node.txt").trim();
    add_user(&env.db, "kn", "").await;
    let r = post(
        &env,
        "/api/auth/refresh",
        &format!("pcKeep={from_node}"),
        UA,
        "1.1.1.1",
    )
    .await;
    assert_session(&r, "kn");
    assert!(r.cookie("refreshToken").is_some());

    // cookie do Rust, de um aparelho que foi encerrado ("Sair deste dispositivo")
    add_user(&env.db, "u2", "").await;
    add_token(
        &env.db,
        "t9",
        "u2",
        "raw9",
        UA,
        "1.1.1.1",
        Some(("REVOKED", 5)),
        None,
    )
    .await;
    let now = chrono::Utc::now().timestamp_millis();
    let seal = pc_server::iron::seal(
        &json!({ "uid": "u2", "iat": now, "rid": "t9" }).to_string(),
        "1",
        &keep_password(REFRESH_SECRET),
        3600,
        now,
    );
    let r = post(
        &env,
        "/api/auth/refresh",
        &format!("pcKeep={seal}"),
        UA,
        "1.1.1.1",
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.cookie("pcKeep").as_deref(), Some(""));

    // "sair de todos os aparelhos" depois do cookie: recusa
    add_user(&env.db, "u3", "").await;
    let client = redis::Client::open(env.redis_url.as_deref().unwrap()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = redis::cmd("SET")
        .arg("sess:revoked-at:u3")
        .arg(now + 1000)
        .query_async(&mut conn)
        .await
        .unwrap();
    let seal = pc_server::iron::seal(
        &json!({ "uid": "u3", "iat": now }).to_string(),
        "1",
        &keep_password(REFRESH_SECRET),
        3600,
        now,
    );
    let r = post(
        &env,
        "/api/auth/refresh",
        &format!("pcKeep={seal}"),
        UA,
        "1.1.1.1",
    )
    .await;
    assert_eq!(r.status, 401);
    let _: () = redis::cmd("DEL")
        .arg("sess:revoked-at:u3")
        .query_async(&mut conn)
        .await
        .unwrap();
}
