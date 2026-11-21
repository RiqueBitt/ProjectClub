//! Conta: cadastro (410), verificação de e-mail, esqueci/redefinir senha,
//! 2FA (ativar, códigos de recuperação, desativar) e trocar senha — num
//! MySQL e Redis de verdade, com um "Node" de mentira pros e-mails.

mod common;

use std::time::Duration;

use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use pc_server::session::sha256_hex;
use serde_json::{Value, json};
use sqlx::Row;

const PASSWORD: &str = "Senha-Certa-123";

async fn env() -> Option<(Env, Calls)> {
    let calls: Calls = Default::default();
    let node = fake_node(calls.clone()).await;
    let env = setup_with(|c| pc_server::config::Config {
        node_upstream: format!("http://{node}"),
        client_origin: "https://projectclub.shardweb.app".into(),
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
    headers: reqwest::header::HeaderMap,
    body: Value,
    text: String,
}

async fn call(
    env: &Env,
    method: &str,
    path: &str,
    user: Option<&str>,
    body: Value,
    extra: &[(&str, &str)],
) -> Resp {
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            extra
                .iter()
                .find(|(k, _)| *k == "ip")
                .map(|(_, v)| v.to_string())
                .unwrap_or_else(ip),
        );
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    for (k, v) in extra.iter().filter(|(k, _)| *k != "ip") {
        req = req.header(*k, *v);
    }
    if method != "GET" {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    let headers = r.headers().clone();
    let text = r.text().await.unwrap();
    Resp {
        status,
        headers,
        body: serde_json::from_str(&text).unwrap_or(Value::Null),
        text,
    }
}

async fn user(env: &Env, id: &str, extra: &str) {
    add_user(&env.db, id, extra).await;
    let hash = include_str!("fixtures/bcryptjs_hash.txt").trim();
    sqlx::query("UPDATE `User` SET passwordHash = ? WHERE id = ?")
        .bind(hash)
        .bind(id)
        .execute(&env.db)
        .await
        .unwrap();
}

fn emails(calls: &Calls) -> Vec<Value> {
    calls
        .lock()
        .unwrap()
        .iter()
        .filter(|(p, _, _)| p == "/api/internal/email")
        .map(|(_, _, b)| b.clone())
        .collect()
}

#[tokio::test]
async fn cadastro_direto_desativado() {
    let Some((env, _)) = env().await else { return };
    let r = call(&env, "POST", "/api/auth/register", None, json!({}), &[]).await;
    assert_eq!(r.status, 410);
    assert_eq!(r.body["useApplications"], true);
    // authLimiter: cabeçalhos antigos (X-RateLimit-*), 50 por 15 min
    assert_eq!(r.headers["x-ratelimit-limit"], "50");
    assert_eq!(r.headers["x-ratelimit-remaining"], "49");
    assert!(r.headers.get("ratelimit-limit").is_none());
}

#[tokio::test]
async fn verificar_email() {
    let Some((env, calls)) = env().await else {
        return;
    };
    user(&env, "u1", "").await;
    let r = call(
        &env,
        "POST",
        "/api/auth/verify-email/send",
        Some("u1"),
        json!({}),
        &[],
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    let sent = emails(&calls);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["kind"], "verification");
    assert_eq!(sent[0]["to"], "u1@x.com");
    let code = sent[0]["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 6);
    assert_eq!(
        calls.lock().unwrap()[0].1,
        pc_server::node::internal_secret(SECRET)
    );

    // reenviar: só o último código vale
    call(
        &env,
        "POST",
        "/api/auth/verify-email/send",
        Some("u1"),
        json!({}),
        &[],
    )
    .await;
    let code2 = emails(&calls)[1]["code"].as_str().unwrap().to_string();
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM EmailVerificationCode WHERE userId='u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(n, 1);

    for bad in [
        json!({ "code": "12345" }),
        json!({ "code": 123456 }),
        json!({ "code": if code == code2 { "000000" } else { &code } }),
    ] {
        let r = call(
            &env,
            "POST",
            "/api/auth/verify-email/confirm",
            Some("u1"),
            bad,
            &[],
        )
        .await;
        assert_eq!(
            (r.status, r.body),
            (400, json!({ "error": "Código inválido ou expirado." }))
        );
    }
    let r = call(
        &env,
        "POST",
        "/api/auth/verify-email/confirm",
        Some("u1"),
        json!({ "code": format!(" {code2} ") }),
        &[],
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    assert_eq!(
        r.headers["ratelimit-limit"], "20",
        "codeLimiter: 20 por 10 min"
    );
    let verified: bool = sqlx::query_scalar("SELECT emailVerified FROM `User` WHERE id='u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert!(verified);
    let r = call(
        &env,
        "POST",
        "/api/auth/verify-email/send",
        Some("u1"),
        json!({}),
        &[],
    )
    .await;
    assert_eq!(r.body, json!({ "ok": true, "alreadyVerified": true }));
    // sem login
    let r = call(
        &env,
        "POST",
        "/api/auth/verify-email/send",
        None,
        json!({}),
        &[],
    )
    .await;
    assert_eq!(r.status, 401);
}

#[tokio::test]
async fn esqueci_e_redefini_a_senha() {
    let Some((env, calls)) = env().await else {
        return;
    };
    user(
        &env,
        "u1",
        ", failedLoginAttempts, loginLockedUntil|, 10, UTC_TIMESTAMP(3) + INTERVAL 10 MINUTE",
    )
    .await;
    sqlx::query("INSERT INTO RefreshToken (id, tokenHash, userId, expiresAt) VALUES ('t1', 'h1', 'u1', UTC_TIMESTAMP(3) + INTERVAL 1 DAY)")
        .execute(&env.db)
        .await
        .unwrap();

    // e-mail que não existe: 200 igual, sem e-mail (não entrega quem tem conta)
    let r = call(
        &env,
        "POST",
        "/api/auth/forgot-password",
        None,
        json!({ "email": "ninguem@x.com" }),
        &[],
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    assert!(emails(&calls).is_empty());

    let r = call(
        &env,
        "POST",
        "/api/auth/forgot-password",
        None,
        json!({ "email": " U1@X.com " }),
        &[],
    )
    .await;
    assert_eq!(r.status, 200);
    let sent = emails(&calls);
    assert_eq!(sent[0]["kind"], "password-reset");
    let url = sent[0]["url"].as_str().unwrap();
    assert!(url.starts_with("https://projectclub.shardweb.app/reset-password?token="));
    let token = url.split("token=").nth(1).unwrap().to_string();
    assert_eq!(token.len(), 64);
    // só o hash fica no banco
    let stored: String =
        sqlx::query_scalar("SELECT token FROM PasswordResetToken WHERE userId='u1'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(stored, sha256_hex(&token));

    let r = call(
        &env,
        "POST",
        "/api/auth/reset-password",
        None,
        json!({ "token": token, "newPassword": "fraca" }),
        &[],
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (
            400,
            json!({ "error": "A senha deve ter pelo menos 8 caracteres, com letras e números." })
        )
    );
    let r = call(
        &env,
        "POST",
        "/api/auth/reset-password",
        None,
        json!({ "token": "x", "newPassword": "NovaSenha99" }),
        &[],
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (400, json!({ "error": "Link inválido ou expirado." }))
    );
    let r = call(
        &env,
        "POST",
        "/api/auth/reset-password",
        None,
        json!({ "token": token, "newPassword": "NovaSenha99" }),
        &[],
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    // o link não vale de novo
    let r = call(
        &env,
        "POST",
        "/api/auth/reset-password",
        None,
        json!({ "token": token, "newPassword": "NovaSenha99" }),
        &[],
    )
    .await;
    assert_eq!(r.status, 400);

    let row = sqlx::query("SELECT failedLoginAttempts, loginLockedUntil IS NULL AS free, emailVerified FROM `User` WHERE id='u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(row.get::<i32, _>("failedLoginAttempts"), 0);
    assert_eq!(row.get::<i64, _>("free"), 1);
    assert!(row.get::<bool, _>("emailVerified"));
    let why: Option<String> =
        sqlx::query_scalar("SELECT revokedReason FROM RefreshToken WHERE id='t1'")
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(why.as_deref(), Some("PASSWORD_RESET"));

    // entra com a senha nova (pelo login do Rust)
    let r = call(
        &env,
        "POST",
        "/api/auth/login",
        None,
        json!({ "emailOrUsername": "u1", "password": "NovaSenha99" }),
        &[],
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let r = call(
        &env,
        "POST",
        "/api/auth/login",
        None,
        json!({ "emailOrUsername": "u1", "password": PASSWORD }),
        &[],
    )
    .await;
    assert_eq!(r.status, 401);
}

/// Lê o QR do PNG e devolve o texto.
fn read_qr(data_url: &str) -> String {
    use base64::Engine;
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(data_url.strip_prefix("data:image/png;base64,").unwrap())
        .unwrap();
    let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).unwrap();
    let (w, h) = (info.width as usize, info.height as usize);
    let mut img = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| buf[y * w + x]);
    let grids = img.detect_grids();
    grids[0].decode().unwrap().1
}

#[tokio::test]
async fn dois_fatores_do_comeco_ao_fim() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1", "").await;
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/setup",
        Some("u1"),
        json!({ "password": "errada" }),
        &[],
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (401, json!({ "error": "Senha incorreta." }))
    );

    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/setup",
        Some("u1"),
        json!({ "password": PASSWORD }),
        &[],
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let secret = r.body["secret"].as_str().unwrap().to_string();
    assert_eq!(secret.len(), 32);
    // o QR tem o mesmo link que o otplib do Node monta
    assert_eq!(
        read_qr(r.body["qrDataUrl"].as_str().unwrap()),
        format!("otpauth://totp/Project%20Club:u1%40x.com?secret={secret}&issuer=Project%20Club")
    );

    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/confirm",
        Some("u1"),
        json!({ "code": "000000" }),
        &[],
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (400, json!({ "error": "Código inválido." }))
    );
    let code = pc_server::totp::generate(&secret, chrono::Utc::now().timestamp()).unwrap();
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/confirm",
        Some("u1"),
        json!({ "code": code }),
        &[],
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let codes: Vec<String> = serde_json::from_value(r.body["recoveryCodes"].clone()).unwrap();
    assert_eq!(codes.len(), 10);

    let r = call(
        &env,
        "GET",
        "/api/auth/2fa/recovery-codes",
        Some("u1"),
        json!({}),
        &[],
    )
    .await;
    assert_eq!(r.body, json!({ "remaining": 10, "enabled": true }));
    // já ativo: não deixa trocar o segredo sem desativar
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/setup",
        Some("u1"),
        json!({ "password": PASSWORD }),
        &[],
    )
    .await;
    assert_eq!(r.status, 409);

    // gerar códigos novos: os antigos deixam de valer
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/recovery-codes",
        Some("u1"),
        json!({ "password": PASSWORD }),
        &[],
    )
    .await;
    let new_codes: Vec<String> = serde_json::from_value(r.body["recoveryCodes"].clone()).unwrap();
    assert_eq!(new_codes.len(), 10);
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/disable",
        Some("u1"),
        json!({ "password": PASSWORD, "recoveryCode": codes[0] }),
        &[],
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (
            401,
            json!({ "error": "Código de recuperação inválido ou já usado." })
        )
    );
    // senha errada não desativa
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/disable",
        Some("u1"),
        json!({ "password": "x", "recoveryCode": new_codes[0] }),
        &[],
    )
    .await;
    assert_eq!(r.status, 401);
    let r = call(
        &env,
        "POST",
        "/api/auth/2fa/disable",
        Some("u1"),
        json!({ "password": PASSWORD, "recoveryCode": new_codes[0] }),
        &[],
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    let r = call(
        &env,
        "GET",
        "/api/auth/2fa/recovery-codes",
        Some("u1"),
        json!({}),
        &[],
    )
    .await;
    assert_eq!(r.body, json!({ "remaining": 0, "enabled": false }));
    let s: Option<String> = sqlx::query_scalar("SELECT twoFactorSecret FROM `User` WHERE id='u1'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert!(s.is_none());
}

#[tokio::test]
async fn trocar_senha_mantem_esta_sessao() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1", "").await;
    sqlx::query(
        "INSERT INTO RefreshToken (id, tokenHash, userId, expiresAt) VALUES \
         ('aqui', ?, 'u1', UTC_TIMESTAMP(3) + INTERVAL 1 DAY), ('outro', 'h2', 'u1', UTC_TIMESTAMP(3) + INTERVAL 1 DAY)",
    )
    .bind(sha256_hex("raw-aqui"))
    .execute(&env.db)
    .await
    .unwrap();
    let cookie = [("cookie", "refreshToken=raw-aqui")];
    let r = call(
        &env,
        "POST",
        "/api/auth/change-password",
        Some("u1"),
        json!({ "currentPassword": PASSWORD, "newPassword": "curta" }),
        &cookie,
    )
    .await;
    assert_eq!(r.status, 400);
    let r = call(
        &env,
        "POST",
        "/api/auth/change-password",
        Some("u1"),
        json!({ "currentPassword": "x", "newPassword": "NovaSenha99" }),
        &cookie,
    )
    .await;
    assert_eq!(
        (r.status, r.body),
        (401, json!({ "error": "Senha atual incorreta." }))
    );
    let r = call(
        &env,
        "POST",
        "/api/auth/change-password",
        Some("u1"),
        json!({ "currentPassword": PASSWORD, "newPassword": "NovaSenha99" }),
        &cookie,
    )
    .await;
    assert_eq!(
        (r.status, r.body.clone()),
        (200, json!({ "ok": true, "keptCurrentSession": true }))
    );
    assert!(
        r.headers
            .get_all("set-cookie")
            .iter()
            .any(|c| c.to_str().unwrap().starts_with("pcKeep=Fe26.2"))
    );
    let revoked = |id: &'static str| {
        let db = env.db.clone();
        async move {
            sqlx::query("SELECT revoked, revokedReason FROM RefreshToken WHERE id = ?")
                .bind(id)
                .fetch_one(&db)
                .await
                .unwrap()
        }
    };
    assert!(!revoked("aqui").await.get::<bool, _>("revoked"));
    let o = revoked("outro").await;
    assert!(o.get::<bool, _>("revoked"));
    assert_eq!(
        o.get::<Option<String>, _>("revokedReason").as_deref(),
        Some("PASSWORD_CHANGE")
    );
    // "lembrar login" dos outros aparelhos cai (marca no Redis)
    let client = redis::Client::open(env.redis_url.as_deref().unwrap()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let at: Option<String> = redis::cmd("GET")
        .arg("sess:revoked-at:u1")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(at.is_some());
}

#[tokio::test]
async fn limite_de_codigos() {
    let Some((env, _)) = env().await else { return };
    user(&env, "u1", "").await;
    let ip = ip();
    for _ in 0..20 {
        let r = call(
            &env,
            "POST",
            "/api/auth/verify-email/confirm",
            Some("u1"),
            json!({ "code": "000000" }),
            &[("ip", &ip)],
        )
        .await;
        assert_eq!(r.status, 400);
    }
    let r = call(
        &env,
        "POST",
        "/api/auth/verify-email/confirm",
        Some("u1"),
        json!({ "code": "000000" }),
        &[("ip", &ip)],
    )
    .await;
    assert_eq!(r.status, 429);
    assert_eq!(r.text, "Too many requests, please try again later.");
    assert!(
        r.headers["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    assert!(r.headers.get("retry-after").is_some());
    assert_eq!(r.headers["ratelimit-remaining"], "0");
}
