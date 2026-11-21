//! "Entrar com o celular" (QR Code) e a entrada do app no WebView — num
//! MySQL e Redis de verdade.

mod common;

use std::time::Duration;

use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use pc_server::session::sha256_hex;
use serde_json::{Value, json};
use sqlx::Executor;

const PC: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const PHONE: &str =
    "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";

async fn env() -> Option<Env> {
    let calls: Calls = Default::default();
    let node = fake_node(calls).await;
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
    Some(env)
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

struct Who<'a> {
    ua: &'a str,
    user: Option<&'a str>,
    cookie: Option<&'a str>,
}

const PC_ANON: Who = Who {
    ua: PC,
    user: None,
    cookie: None,
};

async fn call(env: &Env, method: &str, path: &str, who: &Who<'_>, body: Value) -> Resp {
    let mut req = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header("x-forwarded-for", ip())
        .header("user-agent", who.ua);
    if let Some(u) = who.user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    if let Some(c) = who.cookie {
        req = req.header("cookie", c);
    }
    if !body.is_null() {
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

async fn user(env: &Env, id: &str, verified: bool) {
    add_user(
        &env.db,
        id,
        &format!(", emailVerified|, {}", verified as u8),
    )
    .await;
}

async fn session(env: &Env, id: &str, user: &str, raw: &str) {
    env.db
        .execute(
            format!(
                "INSERT INTO RefreshToken (id, tokenHash, userId, userAgent, ipAddress, createdAt, expiresAt, \
                 sessionStartedAt, lastUsedAt) VALUES ('{id}', '{hash}', '{user}', '{PHONE}', '1.1.1.1', \
                 UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 30 DAY, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
                hash = sha256_hex(raw)
            )
            .as_str(),
        )
        .await
        .unwrap();
}

/// O `code` que vai dentro do QR (lido de volta da imagem).
fn code_from_qr(data_url: &str) -> String {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD
        .decode(data_url.strip_prefix("data:image/png;base64,").unwrap())
        .unwrap();
    let decoder = png::Decoder::new(std::io::Cursor::new(png));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).unwrap();
    assert_eq!((info.width, info.height), (260, 260));
    let (w, h) = (info.width as usize, info.height as usize);
    let mut img = rqrr::PreparedImage::prepare_from_greyscale(w, h, |x, y| buf[y * w + x]);
    let grids = img.detect_grids();
    let (_, content) = grids[0].decode().unwrap();
    let prefix = "https://projectclub.shardweb.app/entrar-qr?c=";
    assert!(content.starts_with(prefix), "{content}");
    content[prefix.len()..].to_string()
}

#[tokio::test]
async fn qr_do_comeco_ao_fim() {
    let Some(env) = env().await else { return };
    user(&env, "cel", true).await;
    session(&env, "s-cel", "cel", "cookie-do-celular").await;
    let phone = Who {
        ua: PHONE,
        user: Some("cel"),
        cookie: Some("refreshToken=cookie-do-celular"),
    };

    // PC pede o QR
    let r = call(&env, "POST", "/api/auth/qr/start", &PC_ANON, json!(null)).await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.headers["cache-control"], "no-store");
    assert_eq!(r.headers["ratelimit-limit"], "10");
    assert_eq!(r.body["ttlSeconds"], 120);
    let secret = r.body["secret"].as_str().unwrap().to_string();
    let code = code_from_qr(r.body["qrDataUrl"].as_str().unwrap());
    assert_eq!(code.len(), 43);

    let poll = |s: String| {
        let env = &env;
        async move {
            call(
                env,
                "POST",
                "/api/auth/qr/poll",
                &PC_ANON,
                json!({ "secret": s }),
            )
            .await
        }
    };
    assert_eq!(poll(secret.clone()).await.body["status"], "PENDING");
    let r = poll("x".repeat(43)).await;
    assert_eq!(r.status, 404);
    assert_eq!(r.body["code"], "invalid");

    // aprovar sem ter aberto o link antes
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/approve",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 409);
    assert_eq!(r.body["code"], "not_scanned");
    // trocar antes de aprovar
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/exchange",
        &PC_ANON,
        json!({ "secret": secret }),
    )
    .await;
    assert_eq!(r.status, 409);
    assert_eq!(r.body["code"], "not_approved");

    // celular abre o link
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.body["device"], "Chrome no Windows");
    assert_eq!(r.body["account"]["username"], "cel");
    assert_eq!(poll(secret.clone()).await.body["status"], "SCANNED");

    // outra conta não toma o QR
    user(&env, "outra", true).await;
    session(&env, "s-outra", "outra", "cookie-da-outra").await;
    let other = Who {
        ua: PHONE,
        user: Some("outra"),
        cookie: Some("refreshToken=cookie-da-outra"),
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &other,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 409);
    assert_eq!(r.body["code"], "taken");

    // aprova
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/approve",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.body, json!({ "ok": true, "status": "APPROVED" }));
    assert_eq!(poll(secret.clone()).await.body["status"], "APPROVED");

    // outro navegador não troca
    let foreign = Who {
        ua: "Firefox/1",
        user: None,
        cookie: None,
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/exchange",
        &foreign,
        json!({ "secret": secret }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["code"], "device");

    // o PC troca e entra
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/exchange",
        &PC_ANON,
        json!({ "secret": secret }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.body["via"], "qr");
    assert_eq!(r.body["user"]["id"], "cel");
    let access = r.body["accessToken"].as_str().unwrap();
    assert_eq!(Tokens::new(SECRET).verify(access).unwrap().sub, "cel");
    assert!(
        r.headers
            .get_all("set-cookie")
            .iter()
            .any(|c| c.to_str().unwrap().starts_with("refreshToken="))
    );
    // uma vez só
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/exchange",
        &PC_ANON,
        json!({ "secret": secret }),
    )
    .await;
    assert_eq!(r.status, 409);
    assert_eq!(r.body["code"], "used");
    assert_eq!(poll(secret.clone()).await.body["status"], "CONSUMED");

    let actions: Vec<String> =
        sqlx::query_scalar("SELECT action FROM SecurityLog WHERE userId = 'cel'")
            .fetch_all(&env.db)
            .await
            .unwrap();
    assert_eq!(actions, vec!["QR_LOGIN_APPROVED"]);
}

#[tokio::test]
async fn celular_precisa_de_email_e_sessao_viva() {
    let Some(env) = env().await else { return };
    user(&env, "novo", false).await;
    user(&env, "cel-limite", true).await;
    session(&env, "s-cel", "cel-limite", "cookie-do-celular").await;
    let r = call(&env, "POST", "/api/auth/qr/start", &PC_ANON, json!(null)).await;
    let code = code_from_qr(r.body["qrDataUrl"].as_str().unwrap());

    let unverified = Who {
        ua: PHONE,
        user: Some("novo"),
        cookie: None,
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &unverified,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["code"], "unverified");

    // só o token de acesso (sem o cookie da sessão) não basta
    let no_cookie = Who {
        ua: PHONE,
        user: Some("cel-limite"),
        cookie: None,
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &no_cookie,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["code"], "session");
    // cookie de outra conta também não
    session(&env, "s-x", "novo", "cookie-x").await;
    let wrong = Who {
        ua: PHONE,
        user: Some("cel-limite"),
        cookie: Some("refreshToken=cookie-x"),
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &wrong,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.body["code"], "session");

    // recusar
    let phone = Who {
        ua: PHONE,
        user: Some("cel-limite"),
        cookie: Some("refreshToken=cookie-do-celular"),
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 200);
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/deny",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.body, json!({ "ok": true, "status": "DENIED" }));
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["code"], "denied");
    // limitador por conta (u:<id>)
    assert_eq!(r.headers["ratelimit-limit"], "30");
    // cada pedido vem de um IP diferente e mesmo assim conta junto
    let antes: u32 = r.headers["ratelimit-remaining"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &phone,
        json!({ "code": code }),
    )
    .await;
    let depois: u32 = r.headers["ratelimit-remaining"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(depois + 1, antes);
}

#[tokio::test]
async fn qr_vencido() {
    let Some(env) = env().await else { return };
    user(&env, "cel", true).await;
    session(&env, "s-cel", "cel", "cookie-do-celular").await;
    let r = call(&env, "POST", "/api/auth/qr/start", &PC_ANON, json!(null)).await;
    let secret = r.body["secret"].as_str().unwrap().to_string();
    let code = code_from_qr(r.body["qrDataUrl"].as_str().unwrap());
    sqlx::query("UPDATE QrLoginPairing SET expiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND")
        .execute(&env.db)
        .await
        .unwrap();
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/poll",
        &PC_ANON,
        json!({ "secret": secret }),
    )
    .await;
    assert_eq!(r.body["status"], "EXPIRED");
    let phone = Who {
        ua: PHONE,
        user: Some("cel"),
        cookie: Some("refreshToken=cookie-do-celular"),
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/qr/scan",
        &phone,
        json!({ "code": code }),
    )
    .await;
    assert_eq!(r.status, 410);
    assert_eq!(r.body["code"], "expired");
}

#[tokio::test]
async fn app_abre_o_jogo_no_webview() {
    let Some(env) = env().await else { return };
    user(&env, "cel", true).await;
    session(&env, "s-cel", "cel", "cookie-do-celular").await;

    let sem_sessao = Who {
        ua: PHONE,
        user: Some("cel"),
        cookie: None,
    };
    let r = call(
        &env,
        "POST",
        "/api/auth/app-handoff",
        &sem_sessao,
        json!(null),
    )
    .await;
    assert_eq!(r.status, 403);
    assert_eq!(r.body["error"], "Entre de novo no app para abrir o jogo.");

    let app = Who {
        ua: PHONE,
        user: Some("cel"),
        cookie: Some("refreshToken=cookie-do-celular"),
    };
    let r = call(&env, "POST", "/api/auth/app-handoff", &app, json!(null)).await;
    assert_eq!(r.status, 200, "{}", r.text);
    assert_eq!(r.body["expiresIn"], 120);
    let code = r.body["code"].as_str().unwrap().to_string();

    let webview = Who {
        ua: PHONE,
        user: None,
        cookie: None,
    };
    let path = format!("/api/auth/app-handoff/{code}?to=%2Fpraca%2Fapp%3Fsala%3D1");
    let r = call(&env, "GET", &path, &webview, json!(null)).await;
    assert_eq!(r.status, 302, "{}", r.text);
    assert_eq!(r.headers["location"], "/praca/app?sala=1");
    assert!(
        r.headers
            .get_all("set-cookie")
            .iter()
            .any(|c| c.to_str().unwrap().starts_with("refreshToken="))
    );
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM RefreshToken WHERE userId = 'cel' AND revoked = 0",
    )
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!(n, 2, "a sessão do app continua e a do WebView é nova");

    // uso único
    let r = call(&env, "GET", &path, &webview, json!(null)).await;
    assert_eq!(r.status, 410);
    assert_eq!(
        r.text,
        "Este link de entrada expirou. Abra o jogo de novo pelo app."
    );

    // destino de fora vira a Praça
    let r = call(&env, "POST", "/api/auth/app-handoff", &app, json!(null)).await;
    let code = r.body["code"].as_str().unwrap();
    let r = call(
        &env,
        "GET",
        &format!("/api/auth/app-handoff/{code}?to=//mal.com"),
        &webview,
        json!(null),
    )
    .await;
    assert_eq!(r.headers["location"], "/praca/app");
}
