//! Entrar com Google/Discord/GitHub — com um provedor falso no lugar dos de
//! verdade (token e perfil), MySQL e Redis de verdade.

mod common;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::State;
use axum::routing::{get, post};
use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use pc_server::config::OAuthClient;
use pc_server::routes::oauth::{sign_payload, suggest_username, verify_payload};
use serde_json::{Value, json};
use sqlx::Executor;

#[test]
fn cookie_da_inscricao_igual_ao_do_node() {
    // assinado pelo `oauth.signPayload` do Node com o mesmo segredo
    let node = "eyJwIjoiZ29vZ2xlIiwiaWQiOiIxMjMiLCJlbWFpbCI6ImFAYi5jb20iLCJuYW1lIjoiWsOpIiwidXNlcm5hbWUiOiJ6ZV94IiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.axuIWHTBECv4jH-FrPOsrEr1gFKnvSxAov3zJ1khekg";
    let payload = json!({ "p": "google", "id": "123", "email": "a@b.com", "name": "Zé", "username": "ze_x", "exp": 9999999999999i64 });
    assert_eq!(sign_payload(SECRET, "signup", &payload), node);
    let back = verify_payload(SECRET, "signup", Some(node)).unwrap();
    assert_eq!(back["name"], "Zé");
}

#[test]
fn clubtag_como_nos_testes_do_node() {
    assert_eq!(
        suggest_username(Some("João Silva!"), None, None),
        "Joao_Silva"
    );
    assert_eq!(suggest_username(None, None, Some("ab@x.com")), "");
    assert_eq!(suggest_username(None, Some("Maria"), None), "Maria");
}

/// O que o provedor falso responde e o que ele recebeu.
#[derive(Default)]
struct Fake {
    profile: Value,
    emails: Value,
    token_forms: Vec<String>,
}
type Shared = Arc<Mutex<Fake>>;

async fn fake_provider(shared: Shared) -> String {
    async fn token(State(s): State<Shared>, body: String) -> axum::Json<Value> {
        s.lock().unwrap().token_forms.push(body);
        axum::Json(json!({ "access_token": "tok-123", "token_type": "Bearer" }))
    }
    async fn profile(State(s): State<Shared>) -> axum::Json<Value> {
        axum::Json(s.lock().unwrap().profile.clone())
    }
    async fn emails(State(s): State<Shared>) -> axum::Json<Value> {
        axum::Json(s.lock().unwrap().emails.clone())
    }
    let app = Router::new()
        .route("/{p}/token", post(token))
        .route("/google/userinfo", get(profile))
        .route("/discord/me", get(profile))
        .route("/github/user", get(profile))
        .route("/github/emails", get(emails))
        .with_state(shared);
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    format!("http://{addr}")
}

async fn env() -> Option<(Env, Shared)> {
    let calls: Calls = Default::default();
    let node = fake_node(calls).await;
    let shared: Shared = Default::default();
    let base = fake_provider(shared.clone()).await;
    let env = setup_with(|c| {
        let mut clients = BTreeMap::new();
        for p in ["google", "github"] {
            clients.insert(
                p.to_string(),
                OAuthClient {
                    client_id: format!("id-{p}"),
                    client_secret: format!("segredo-{p}"),
                },
            );
        }
        pc_server::config::Config {
            node_upstream: format!("http://{node}"),
            client_origin: "https://projectclub.shardweb.app".into(),
            oauth_clients: clients,
            oauth_test_base: Some(base),
            ..c
        }
    })
    .await?;
    if env.redis_url.is_none() {
        eprintln!("PC_TEST_REDIS_URL não definida — pulando");
        return None;
    }
    Some((env, shared))
}

struct Resp {
    status: u16,
    location: String,
    cookies: Vec<String>,
    body: Value,
}

impl Resp {
    fn cookie(&self, name: &str) -> Option<String> {
        self.cookies
            .iter()
            .find(|c| c.starts_with(&format!("{name}=")))
            .map(|c| c[name.len() + 1..].split(';').next().unwrap().to_string())
    }
}

async fn call(
    env: &Env,
    method: &str,
    path: &str,
    user: Option<&str>,
    cookie: Option<&str>,
    body: Value,
) -> Resp {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut req = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.{}.{}.{}", (n >> 16) as u8, (n >> 8) as u8, n as u8),
        )
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0");
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    if let Some(c) = cookie {
        req = req.header("cookie", c);
    }
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    let location = r
        .headers()
        .get("location")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    let cookies = r
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    let body = r.json().await.unwrap_or(Value::Null);
    Resp {
        status,
        location,
        cookies,
        body,
    }
}

fn query_of(url: &str) -> BTreeMap<String, String> {
    let q = url.split_once('?').map(|x| x.1).unwrap_or("");
    url::form_urlencoded::parse(q.as_bytes())
        .into_owned()
        .collect()
}

/// `start` + callback do provedor; devolve a resposta do callback.
async fn round_trip(env: &Env, provider: &str, from: &str) -> Resp {
    let r = call(
        env,
        "GET",
        &format!("/api/auth/oauth/{provider}/start?from={from}"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 302);
    let state = query_of(&r.location)["state"].clone();
    let cookie = r.cookie("pc_oauth_state").unwrap();
    call(
        env,
        "GET",
        &format!("/api/auth/oauth/{provider}/callback?code=abc&state={state}"),
        None,
        Some(&format!("pc_oauth_state={cookie}")),
        Value::Null,
    )
    .await
}

#[tokio::test]
async fn inscricao_e_login_pelo_google() {
    let Some((env, fake)) = env().await else {
        return;
    };

    let r = call(
        &env,
        "GET",
        "/api/auth/oauth/providers",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(
        r.body,
        json!({ "providers": [{ "id": "google", "label": "Google" }, { "id": "github", "label": "GitHub" }] })
    );

    // início: vai pro Google com PKCE e o cookie de estado
    let r = call(
        &env,
        "GET",
        "/api/auth/oauth/google/start",
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 302);
    assert!(r.location.starts_with("https://accounts.google.com/o/oauth2/v2/auth?client_id=id-google&redirect_uri=https%3A%2F%2Fprojectclub.shardweb.app%2Fapi%2Fauth%2Foauth%2Fgoogle%2Fcallback&response_type=code&scope=openid+email+profile&state="), "{}", r.location);
    let q = query_of(&r.location);
    assert_eq!(q["prompt"], "select_account");
    assert_eq!(q["code_challenge_method"], "S256");
    let state = q["state"].clone();
    let challenge = q["code_challenge"].clone();
    let state_cookie = r.cookie("pc_oauth_state").unwrap();
    assert!(r.cookies[0].contains("Path=/api/auth/oauth; Expires="));

    // sem o cookie: recusa
    let r = call(
        &env,
        "GET",
        &format!("/api/auth/oauth/google/callback?code=abc&state={state}"),
        None,
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 303);
    assert_eq!(r.location, "/login?oauth_error=estado&provider=google");
    // state trocado: recusa
    let r = call(
        &env,
        "GET",
        "/api/auth/oauth/google/callback?code=abc&state=outro",
        None,
        Some(&format!("pc_oauth_state={state_cookie}")),
        Value::Null,
    )
    .await;
    assert_eq!(r.location, "/login?oauth_error=estado&provider=google");

    // ninguém com essa conta Google: vai pra inscrição pré-preenchida
    fake.lock().unwrap().profile = json!({ "sub": "g-1", "email": "Nova@Gmail.com", "email_verified": true, "name": "Ana Lúcia" });
    let r = call(
        &env,
        "GET",
        &format!("/api/auth/oauth/google/callback?code=abc&state={state}"),
        None,
        Some(&format!("pc_oauth_state={state_cookie}")),
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 303);
    assert_eq!(r.location, "/register?oauth=google");
    assert!(r.cookies[0].starts_with("pc_oauth_state=; Path=/api/auth/oauth;"));
    let signup = r.cookie("pc_oauth_signup").unwrap();
    // a troca do código mandou o verificador do PKCE certo
    let form = fake.lock().unwrap().token_forms.last().unwrap().clone();
    let form = query_of(&format!("?{form}"));
    assert_eq!(form["grant_type"], "authorization_code");
    assert_eq!(form["client_secret"], "segredo-google");
    use base64::Engine;
    use sha2::Digest;
    let calc = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(form["code_verifier"].as_bytes()));
    assert_eq!(calc, challenge);

    let r = call(
        &env,
        "GET",
        "/api/auth/oauth/signup",
        None,
        Some(&format!("pc_oauth_signup={signup}")),
        Value::Null,
    )
    .await;
    assert_eq!(
        r.body,
        json!({ "pending": { "provider": "google", "label": "Google", "email": "nova@gmail.com", "name": "Ana Lúcia", "username": "Ana_Lucia" } })
    );
    let r = call(
        &env,
        "DELETE",
        "/api/auth/oauth/signup",
        None,
        None,
        Value::Null,
    )
    .await;
    assert!(r.cookies[0].starts_with("pc_oauth_signup=; Path=/api;"));

    // inscrição já pendente com essa identidade
    env.db
        .execute("INSERT INTO MembershipApplication (id, email, username, displayName, passwordHash, status, oauthProvider, oauthProviderUserId) VALUES ('ap1', 'x@x.com', 'x', 'x', 'h', 'PENDING', 'google', 'g-1')")
        .await
        .unwrap();
    let r = round_trip(&env, "google", "register").await;
    assert_eq!(
        r.location,
        "/register?oauth_error=inscricao_pendente&provider=google"
    );

    // e-mail que já tem conta aqui NÃO é vinculado sozinho
    add_user(&env.db, "dona", "").await;
    fake.lock().unwrap().profile =
        json!({ "sub": "g-2", "email": "dona@x.com", "email_verified": true });
    let r = round_trip(&env, "google", "login").await;
    assert_eq!(
        r.location,
        "/login?oauth_error=email_existente&provider=google"
    );

    // conta ligada: entra
    env.db
        .execute("INSERT INTO OAuthAccount (id, userId, provider, providerUserId) VALUES ('o1', 'dona', 'google', 'g-2')")
        .await
        .unwrap();
    let r = round_trip(&env, "google", "login").await;
    assert_eq!(r.location, "/login?oauth=ok&provider=google");
    assert!(r.cookie("refreshToken").is_some_and(|c| !c.is_empty()));

    // banida
    sqlx::query("UPDATE `User` SET isPlatformBanned = 1 WHERE id = 'dona'")
        .execute(&env.db)
        .await
        .unwrap();
    let r = round_trip(&env, "google", "login").await;
    assert_eq!(r.location, "/login?oauth_error=banida&provider=google");
}

#[tokio::test]
async fn segunda_etapa_do_2fa() {
    let Some((env, fake)) = env().await else {
        return;
    };
    let secret = pc_server::totp::generate_secret();
    add_user(
        &env.db,
        "dois",
        &format!(", twoFactorEnabled, twoFactorSecret|, 1, '{secret}'"),
    )
    .await;
    env.db
        .execute("INSERT INTO OAuthAccount (id, userId, provider, providerUserId) VALUES ('o2', 'dois', 'github', '77')")
        .await
        .unwrap();
    // GitHub: id numérico, e-mail da lista (primário + verificado)
    {
        let mut f = fake.lock().unwrap();
        f.profile = json!({ "id": 77, "login": "dois" });
        f.emails = json!([{ "email": "x@y.com", "primary": false, "verified": true }]);
    }
    let r = round_trip(&env, "github", "login").await;
    assert_eq!(r.location, "/login?oauth_2fa=github");
    assert!(
        r.cookie("refreshToken").is_none(),
        "sem sessão antes do código"
    );
    let pending = format!("pc_oauth_2fa={}", r.cookie("pc_oauth_2fa").unwrap());

    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/2fa",
        None,
        None,
        json!({ "twoFactorCode": "1" }),
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.body["expired"], true);
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/2fa",
        None,
        Some(&pending),
        json!({}),
    )
    .await;
    assert_eq!(r.status, 400);
    assert_eq!(r.body["error"], "Digite o código de verificação.");
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/2fa",
        None,
        Some(&pending),
        json!({ "twoFactorCode": 123456 }),
    )
    .await;
    assert_eq!(r.body["error"], "Código 2FA inválido.");
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/2fa",
        None,
        Some(&pending),
        json!({ "twoFactorCode": "000000" }),
    )
    .await;
    assert_eq!(r.status, 401);
    let fails: i32 = sqlx::query_scalar("SELECT failedLoginAttempts FROM `User` WHERE id = 'dois'")
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(fails, 1);

    let code = pc_server::totp::generate(&secret, chrono::Utc::now().timestamp()).unwrap();
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/2fa",
        None,
        Some(&pending),
        json!({ "twoFactorCode": code }),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["user"]["id"], "dois");
    assert!(r.cookies[0].starts_with("pc_oauth_2fa=; Path=/api/auth/oauth;"));
    assert!(r.cookie("refreshToken").is_some());
}

#[tokio::test]
async fn conectar_e_desconectar_conta() {
    let Some((env, fake)) = env().await else {
        return;
    };
    add_user(&env.db, "eu", "").await;
    add_user(&env.db, "outro", "").await;

    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/discord/link",
        Some("eu"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 503, "Discord não está configurado");
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/nada/link",
        Some("eu"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 404);

    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/github/link",
        Some("eu"),
        None,
        json!({}),
    )
    .await;
    assert_eq!(r.status, 200);
    let url = r.body["url"].as_str().unwrap().to_string();
    assert!(url.starts_with("https://github.com/login/oauth/authorize?client_id=id-github"));
    assert!(!url.contains("code_challenge"), "PKCE só no Google");
    let state = query_of(&url)["state"].clone();
    let cookie = format!("pc_oauth_state={}", r.cookie("pc_oauth_state").unwrap());

    {
        let mut f = fake.lock().unwrap();
        f.profile = json!({ "id": 5, "login": "eu-gh" });
        f.emails = json!([{ "email": "EU@GH.com", "primary": true, "verified": true }]);
    }
    // cancelou no GitHub
    let r = call(
        &env,
        "GET",
        &format!("/api/auth/oauth/github/callback?error=access_denied&state={state}"),
        None,
        Some(&cookie),
        Value::Null,
    )
    .await;
    assert_eq!(r.location, "/oauth/retorno?erro=cancelado&provedor=github");

    let r = call(
        &env,
        "GET",
        &format!("/api/auth/oauth/github/callback?code=abc&state={state}"),
        None,
        Some(&cookie),
        Value::Null,
    )
    .await;
    assert_eq!(r.location, "/oauth/retorno?vinculado=github");
    let (pid, email): (String, Option<String>) = sqlx::query_as(
        "SELECT providerUserId, email FROM OAuthAccount WHERE userId = 'eu' AND provider = 'github'",
    )
    .fetch_one(&env.db)
    .await
    .unwrap();
    assert_eq!((pid.as_str(), email.as_deref()), ("5", Some("eu@gh.com")));

    // a mesma conta do GitHub não liga em outra pessoa
    let r = call(
        &env,
        "POST",
        "/api/auth/oauth/github/link",
        Some("outro"),
        None,
        json!({}),
    )
    .await;
    let state = query_of(r.body["url"].as_str().unwrap())["state"].clone();
    let cookie = format!("pc_oauth_state={}", r.cookie("pc_oauth_state").unwrap());
    let r = call(
        &env,
        "GET",
        &format!("/api/auth/oauth/github/callback?code=abc&state={state}"),
        None,
        Some(&cookie),
        Value::Null,
    )
    .await;
    assert_eq!(
        r.location,
        "/oauth/retorno?erro=ja-vinculada&provedor=github"
    );

    let r = call(
        &env,
        "GET",
        "/api/auth/oauth/accounts",
        Some("eu"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.body["accounts"][0]["provider"], "github");
    assert_eq!(r.body["accounts"][0]["email"], "eu@gh.com");
    assert_eq!(
        r.body["providers"],
        json!([{ "id": "google", "label": "Google", "enabled": true }, { "id": "github", "label": "GitHub", "enabled": true }])
    );

    let r = call(
        &env,
        "DELETE",
        "/api/auth/oauth/accounts/github",
        Some("eu"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.body, json!({ "ok": true }));
    let r = call(
        &env,
        "DELETE",
        "/api/auth/oauth/accounts/github",
        Some("eu"),
        None,
        Value::Null,
    )
    .await;
    assert_eq!(r.status, 404);
    assert_eq!(r.body["error"], "Nenhuma conta conectada desse provedor.");
}

/// O `res.json` do Express: `charset=utf-8`, ETag fraco e 304.
#[tokio::test]
async fn json_com_etag_e_304_como_o_express() {
    let Some((env, _)) = env().await else { return };
    let url = format!("http://{}/api/auth/oauth/providers", env.gw);
    let r = reqwest::get(&url).await.unwrap();
    assert_eq!(
        r.headers()["content-type"],
        "application/json; charset=utf-8"
    );
    let tag = r.headers()["etag"].to_str().unwrap().to_string();
    let body = r.text().await.unwrap();
    assert_eq!(tag, pc_server::web::weak_etag(body.as_bytes()));
    let r = reqwest::Client::new()
        .get(&url)
        .header("if-none-match", &tag)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 304);
    assert!(r.headers().get("content-type").is_none());
    assert_eq!(r.text().await.unwrap(), "");
    // POST não vira 304
    let r = reqwest::Client::new()
        .post(format!("http://{}/api/auth/oauth/2fa", env.gw))
        .header("if-none-match", "*")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    assert!(r.headers().contains_key("etag"));
}
