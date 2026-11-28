//! Chaves de acesso: as respostas em `fixtures/webauthn_node.json` foram
//! geradas com chaves de verdade e aprovadas pelo `@simplewebauthn/server`
//! do Node (`fixtures/gerar_webauthn.cjs`). O Rust tem que aceitar as mesmas,
//! guardar a mesma chave pública e recusar repetição/adulteração.

mod common;

use std::time::Duration;

use common::{Calls, Env, SECRET, add_user, fake_node, setup_with};
use pc_server::auth::Tokens;
use pc_server::webauthn::{self as wa, Expected};
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/webauthn_node.json")).unwrap()
}

fn exp<'a>(f: &'a Value, challenge: &'a str) -> Expected<'a> {
    Expected {
        challenge,
        origin: f["origin"].as_str().unwrap(),
        rp_id: f["rpId"].as_str().unwrap(),
    }
}

#[test]
fn aceita_o_que_o_node_aceita() {
    let f = fixture();
    for case in f["cases"].as_array().unwrap() {
        let label = format!("{}/{}", case["kind"], case["fmt"]);
        let reg = wa::verify_registration(
            &case["registration"],
            &exp(&f, case["regChallenge"].as_str().unwrap()),
        )
        .unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_eq!(reg.credential_id, case["credentialId"], "{label}");
        assert_eq!(wa::b64u(&reg.public_key), case["publicKey"], "{label}");
        assert_eq!(reg.counter, 0);
        assert_eq!(reg.transports, vec!["internal", "hybrid"]);

        let a1 = &case["auth1"];
        let n = wa::verify_authentication(
            &a1["response"],
            &exp(&f, a1["challenge"].as_str().unwrap()),
            &reg.public_key,
            0,
        )
        .unwrap_or_else(|e| panic!("{label}: {e}"));
        assert_eq!(n, 1);
        let a2 = &case["auth2"];
        let n = wa::verify_authentication(
            &a2["response"],
            &exp(&f, a2["challenge"].as_str().unwrap()),
            &reg.public_key,
            1,
        )
        .unwrap();
        assert_eq!(n, 2);
        // repetir uma resposta velha (contador não andou)
        assert!(
            wa::verify_authentication(
                &a1["response"],
                &exp(&f, a1["challenge"].as_str().unwrap()),
                &reg.public_key,
                2
            )
            .is_err()
        );
    }
}

#[test]
fn recusa_resposta_adulterada() {
    let f = fixture();
    let case = &f["cases"][0];
    let challenge = case["regChallenge"].as_str().unwrap();
    // outro desafio, outra origem, outro site
    assert!(wa::verify_registration(&case["registration"], &exp(&f, "outro")).is_err());
    let other_origin = Expected {
        challenge,
        origin: "https://mal.com",
        rp_id: f["rpId"].as_str().unwrap(),
    };
    assert!(wa::verify_registration(&case["registration"], &other_origin).is_err());
    let other_rp = Expected {
        challenge,
        origin: f["origin"].as_str().unwrap(),
        rp_id: "mal.com",
    };
    assert!(wa::verify_registration(&case["registration"], &other_rp).is_err());
    // rawId diferente do id
    let mut bad = case["registration"].clone();
    bad["rawId"] = json!("outro");
    assert!(wa::verify_registration(&bad, &exp(&f, challenge)).is_err());

    // assinatura trocada
    let reg = wa::verify_registration(&case["registration"], &exp(&f, challenge)).unwrap();
    let a1 = &case["auth1"];
    let mut bad = a1["response"].clone();
    bad["response"]["signature"] = case["auth2"]["response"]["response"]["signature"].clone();
    assert!(
        wa::verify_authentication(
            &bad,
            &exp(&f, a1["challenge"].as_str().unwrap()),
            &reg.public_key,
            0
        )
        .is_err()
    );
    // chave de outra credencial
    let other = wa::from_b64u(f["cases"][1]["publicKey"].as_str().unwrap()).unwrap();
    assert!(
        wa::verify_authentication(
            &a1["response"],
            &exp(&f, a1["challenge"].as_str().unwrap()),
            &other,
            0
        )
        .is_err()
    );
}

// ---------------------------------------------------------------- pelas rotas

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

async fn call(
    env: &Env,
    method: &str,
    path: &str,
    user: Option<&str>,
    body: Value,
) -> (u16, Value) {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut req = reqwest::Client::new()
        .request(method.parse().unwrap(), format!("http://{}{path}", env.gw))
        .header(
            "x-forwarded-for",
            format!("10.{}.{}.{}", (n >> 16) as u8, (n >> 8) as u8, n as u8),
        )
        .header("user-agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0");
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    if !body.is_null() {
        req = req.json(&body);
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    (status, r.json().await.unwrap_or(Value::Null))
}

async fn redis_set(env: &Env, key: &str, value: &str) {
    let client = redis::Client::open(env.redis_url.clone().unwrap()).unwrap();
    let mut con = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = redis::AsyncCommands::set_ex(&mut con, key, value, 300)
        .await
        .unwrap();
}

#[tokio::test]
async fn cadastrar_entrar_e_apagar() {
    let Some(env) = env().await else { return };
    let f = fixture();
    let case = &f["cases"][0];
    let uid = format!("pk-{}", uuid::Uuid::new_v4().simple());
    add_user(&env.db, &uid, "").await;

    // sem login
    let (st, _) = call(&env, "GET", "/api/auth/passkeys", None, Value::Null).await;
    assert_eq!(st, 401);

    let (st, opts) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/options",
        Some(&uid),
        json!({}),
    )
    .await;
    assert_eq!(st, 200, "{opts}");
    assert_eq!(
        opts["rp"],
        json!({ "name": "Project Club", "id": "projectclub.shardweb.app" })
    );
    assert_eq!(opts["user"]["name"], uid);
    assert_eq!(opts["user"]["id"], wa::b64u(uid.as_bytes()));
    assert_eq!(
        opts["pubKeyCredParams"],
        json!([{ "alg": -8, "type": "public-key" }, { "alg": -7, "type": "public-key" }, { "alg": -257, "type": "public-key" }])
    );
    assert_eq!(opts["authenticatorSelection"]["requireResidentKey"], true);
    assert_eq!(opts["challenge"].as_str().unwrap().len(), 43);

    // a resposta do navegador foi feita pra outro desafio: recusa
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/verify",
        Some(&uid),
        json!({ "response": case["registration"] }),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(body["error"], "Não deu pra confirmar a chave de acesso.");
    // o desafio é de uso único
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/verify",
        Some(&uid),
        json!({ "response": case["registration"] }),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(body["error"], "O pedido expirou. Tente de novo.");

    // agora com o desafio certo
    redis_set(
        &env,
        &format!("passkey:reg:{uid}"),
        case["regChallenge"].as_str().unwrap(),
    )
    .await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/verify",
        Some(&uid),
        json!({ "response": case["registration"], "name": "  Meu PC  " }),
    )
    .await;
    assert_eq!(st, 201, "{body}");
    assert_eq!(body["passkey"]["name"], "Meu PC");
    assert_eq!(body["passkey"]["lastUsedAt"], Value::Null);
    let key_id = body["passkey"]["id"].as_str().unwrap().to_string();
    let (pk, transports): (String, Option<String>) =
        sqlx::query_as("SELECT publicKey, transports FROM Passkey WHERE id = ?")
            .bind(&key_id)
            .fetch_one(&env.db)
            .await
            .unwrap();
    assert_eq!(pk, case["publicKey"].as_str().unwrap());
    assert_eq!(transports.as_deref(), Some("internal,hybrid"));

    // a mesma chave de novo
    redis_set(
        &env,
        &format!("passkey:reg:{uid}"),
        case["regChallenge"].as_str().unwrap(),
    )
    .await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/verify",
        Some(&uid),
        json!({ "response": case["registration"] }),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(body["error"], "Essa chave de acesso já está na sua conta.");

    let (_, list) = call(&env, "GET", "/api/auth/passkeys", Some(&uid), Value::Null).await;
    assert_eq!(list["passkeys"].as_array().unwrap().len(), 1);

    // entrar
    let (st, lo) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/options",
        None,
        json!({}),
    )
    .await;
    assert_eq!(st, 200, "{lo}");
    assert_eq!(lo["options"]["rpId"], "projectclub.shardweb.app");
    assert_eq!(lo["options"]["userVerification"], "preferred");
    let flow = lo["flowId"].as_str().unwrap().to_string();
    assert_eq!(flow.len(), 24);
    let a1 = &case["auth1"];
    redis_set(
        &env,
        &format!("passkey:auth:{flow}"),
        a1["challenge"].as_str().unwrap(),
    )
    .await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/verify",
        None,
        json!({ "flowId": flow, "response": a1["response"] }),
    )
    .await;
    assert_eq!(st, 200, "{body}");
    assert_eq!(body["user"]["id"], uid);
    let access = body["accessToken"].as_str().unwrap();
    assert_eq!(Tokens::new(SECRET).verify(access).unwrap().sub, uid);
    let counter: i32 = sqlx::query_scalar("SELECT counter FROM Passkey WHERE id = ?")
        .bind(&key_id)
        .fetch_one(&env.db)
        .await
        .unwrap();
    assert_eq!(counter, 1);

    // o mesmo fluxo não serve duas vezes
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/verify",
        None,
        json!({ "flowId": flow, "response": a1["response"] }),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(body["error"], "O pedido expirou. Tente de novo.");
    // resposta velha num fluxo novo (contador não andou)
    redis_set(
        &env,
        "passkey:auth:fluxo-novo",
        a1["challenge"].as_str().unwrap(),
    )
    .await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/verify",
        None,
        json!({ "flowId": "fluxo-novo", "response": a1["response"] }),
    )
    .await;
    assert_eq!(st, 401);
    assert_eq!(body["error"], "Não deu pra confirmar a chave de acesso.");

    // conta banida não entra (e recebe o token pra pedir revisão)
    sqlx::query("UPDATE `User` SET isPlatformBanned = 1 WHERE id = ?")
        .bind(&uid)
        .execute(&env.db)
        .await
        .unwrap();
    let a2 = &case["auth2"];
    redis_set(
        &env,
        "passkey:auth:fluxo-ban",
        a2["challenge"].as_str().unwrap(),
    )
    .await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/verify",
        None,
        json!({ "flowId": "fluxo-ban", "response": a2["response"] }),
    )
    .await;
    assert_eq!(st, 403);
    assert_eq!(body["platformBanned"], true);
    assert!(body["appealToken"].is_string());
    sqlx::query("UPDATE `User` SET isPlatformBanned = 0 WHERE id = ?")
        .bind(&uid)
        .execute(&env.db)
        .await
        .unwrap();

    // chave que ninguém tem
    redis_set(&env, "passkey:auth:fluxo-x", "x").await;
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/login/verify",
        None,
        json!({ "flowId": "fluxo-x", "response": { "id": "desconhecida" } }),
    )
    .await;
    assert_eq!(st, 401);
    assert_eq!(
        body["error"],
        "Essa chave de acesso não está ligada a nenhuma conta."
    );

    // apagar
    let (st, _) = call(
        &env,
        "DELETE",
        &format!("/api/auth/passkeys/{key_id}"),
        Some("outra"),
        Value::Null,
    )
    .await;
    assert_eq!(st, 401, "conta que não existe");
    let (st, body) = call(
        &env,
        "DELETE",
        &format!("/api/auth/passkeys/{key_id}"),
        Some(&uid),
        Value::Null,
    )
    .await;
    assert_eq!((st, body), (200, json!({ "ok": true })));
    let (st, body) = call(
        &env,
        "DELETE",
        &format!("/api/auth/passkeys/{key_id}"),
        Some(&uid),
        Value::Null,
    )
    .await;
    assert_eq!(st, 404);
    assert_eq!(body["error"], "Chave não encontrada.");
}

#[tokio::test]
async fn no_maximo_dez_chaves() {
    let Some(env) = env().await else { return };
    let uid = format!("pk-{}", uuid::Uuid::new_v4().simple());
    add_user(&env.db, &uid, "").await;
    for i in 0..10 {
        sqlx::query(
            "INSERT INTO Passkey (id, userId, credentialId, publicKey, name) VALUES (UUID(), ?, ?, 'x', 'k')",
        )
        .bind(&uid)
        .bind(format!("cred-{uid}-{i}"))
        .execute(&env.db)
        .await
        .unwrap();
    }
    let (st, body) = call(
        &env,
        "POST",
        "/api/auth/passkeys/register/options",
        Some(&uid),
        json!({}),
    )
    .await;
    assert_eq!(st, 400);
    assert_eq!(
        body["error"],
        "Você já tem 10 chaves de acesso. Apague uma antes de criar outra."
    );
}
