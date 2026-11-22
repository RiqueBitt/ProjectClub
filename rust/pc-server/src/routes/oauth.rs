//! Entrar com Google, Discord e GitHub — porte de `oauthController.js` e
//! `services/oauth.js`.
//!
//! Os cookies assinados (estado, 2FA pendente e inscrição) têm o mesmo
//! formato do Node (`base64url(json).base64url(hmac)`, chave por uso), então
//! o cookie da inscrição feito aqui continua sendo lido pelo
//! `applicationsController` do Node.
//!
//! Segurança (igual ao Node): `state` aleatório conferido contra o cookie
//! assinado de 10 minutos, PKCE no Google, o token do provedor nunca sai do
//! servidor, e e-mail que já tem conta aqui NÃO é vinculado sozinho.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use hmac::{Hmac, Mac};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use unicode_normalization::UnicodeNormalization;

use crate::AppState;
use crate::auth::error;
use crate::db::{self, Db};
use crate::params;
use crate::ratelimit::{self, Limit};
use crate::routes::ctx::{By, err, finish, js_string, prelude_or_return, redirect, uid};
use crate::routes::login::{
    LoginUser, Req, complete_login_parts, consume_recovery_code, find_user_by_id,
    register_failed_login, verify_totp_once_for,
};
use crate::routes::qr_login::is_account_blocked;
use crate::session as s;

const STATE_TTL_MS: i64 = 10 * 60 * 1000;
const PENDING_2FA_TTL_MS: i64 = 10 * 60 * 1000;
const SIGNUP_TTL_MS: i64 = 30 * 60 * 1000;
const COOKIE_STATE: &str = "pc_oauth_state";
const COOKIE_2FA: &str = "pc_oauth_2fa";
const COOKIE_SIGNUP: &str = "pc_oauth_signup";
const STATE_PATH: &str = "/api/auth/oauth";
/// O cookie da inscrição precisa chegar também em `/api/applications`.
const SIGNUP_PATH: &str = "/api";

/// Início, callback e "conectar" contam no mesmo balde por IP.
pub const OAUTH: Limit = Limit {
    prefix: "oauth",
    window_ms: 10 * 60 * 1000,
    max: 40,
    message: Some("Muitas tentativas. Tente novamente em alguns minutos."),
    standard: true,
    legacy: false,
};

struct Provider {
    id: &'static str,
    label: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    scope: &'static str,
    pkce: bool,
    extra: (&'static str, &'static str),
}

const PROVIDERS: [Provider; 3] = [
    Provider {
        id: "google",
        label: "Google",
        authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        scope: "openid email profile",
        pkce: true,
        extra: ("prompt", "select_account"),
    },
    Provider {
        id: "discord",
        label: "Discord",
        authorize_url: "https://discord.com/oauth2/authorize",
        token_url: "https://discord.com/api/oauth2/token",
        scope: "identify email",
        pkce: false,
        extra: ("prompt", "none"),
    },
    Provider {
        id: "github",
        label: "GitHub",
        authorize_url: "https://github.com/login/oauth/authorize",
        token_url: "https://github.com/login/oauth/access_token",
        scope: "read:user user:email",
        pkce: false,
        extra: ("allow_signup", "true"),
    },
];

fn provider(id: &str) -> Option<&'static Provider> {
    PROVIDERS.iter().find(|p| p.id == id)
}

fn enabled(state: &AppState) -> Vec<&'static str> {
    PROVIDERS
        .iter()
        .filter(|p| state.config.oauth_clients.contains_key(p.id))
        .map(|p| p.id)
        .collect()
}

/// Endereço que o servidor chama (token e perfil); nos testes, o falso.
fn api_url(state: &AppState, real: &str, test_path: &str) -> String {
    match &state.config.oauth_test_base {
        Some(base) => format!("{base}{test_path}"),
        None => real.to_string(),
    }
}

/// `publicBaseUrl`: a primeira `CLIENT_ORIGIN`, sem barra no fim.
fn public_base(state: &AppState) -> String {
    let first = state
        .config
        .client_origin
        .split(',')
        .next()
        .unwrap_or("")
        .trim();
    let base = if first.is_empty() {
        "http://localhost:5173"
    } else {
        first
    };
    base.trim_end_matches('/').to_string()
}

fn redirect_uri(state: &AppState, id: &str) -> String {
    format!("{}/api/auth/oauth/{id}/callback", public_base(state))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn b64u(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// `Buffer.from(x, 'base64url')`: aceita com ou sem `=`.
const B64U_LOOSE: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

fn random_b64u(n: usize) -> String {
    let mut raw = vec![0u8; n];
    rand::RngCore::fill_bytes(&mut rand::rng(), &mut raw);
    b64u(&raw)
}

// ---------------------------------------------------------------- tokens assinados

fn key_for(secret: &str, purpose: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac");
    m.update(format!("project-club-oauth:{purpose}").as_bytes());
    m.finalize().into_bytes().to_vec()
}

fn mac(secret: &str, purpose: &str, body: &str) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(&key_for(secret, purpose)).expect("hmac");
    m.update(body.as_bytes());
    b64u(&m.finalize().into_bytes())
}

pub fn sign_payload(secret: &str, purpose: &str, payload: &Value) -> String {
    let body = b64u(payload.to_string().as_bytes());
    let m = mac(secret, purpose, &body);
    format!("{body}.{m}")
}

pub fn verify_payload(
    secret: &str,
    purpose: &str,
    token: Option<&str>,
) -> Option<Map<String, Value>> {
    let token = token?;
    if token.encode_utf16().count() > 4096 {
        return None;
    }
    let (body, m) = token.split_once('.')?;
    if body.is_empty() || m.contains('.') {
        return None;
    }
    let expected = mac(secret, purpose, body);
    if m.len() != expected.len() || !bool::from(m.as_bytes().ct_eq(expected.as_bytes())) {
        return None;
    }
    let raw = B64U_LOOSE.decode(body).ok()?;
    let Value::Object(p) = serde_json::from_slice::<Value>(&raw).ok()? else {
        return None;
    };
    let exp = p.get("exp")?.as_f64()?;
    if exp < now_ms() as f64 {
        return None;
    }
    Some(p)
}

fn secure(state: &AppState) -> bool {
    state.config.node_env == "production"
}

fn cookie(state: &AppState, name: &str, value: &str, path: &str, ttl_ms: i64) -> HeaderValue {
    s::cookie_at(name, value, path, (ttl_ms / 1000) as u64, secure(state))
}

fn clear(state: &AppState, name: &str, path: &str) -> HeaderValue {
    s::clear_cookie_at(name, path, secure(state))
}

fn add_cookies(mut res: Response, cookies: impl IntoIterator<Item = HeaderValue>) -> Response {
    for c in cookies {
        res.headers_mut().append(header::SET_COOKIE, c);
    }
    res
}

fn no_store(mut res: Response) -> Response {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

/// `back(res, page, params)`: 303 pra tela do site com os parâmetros.
fn back(headers: &HeaderMap, page: &str, params: &[(&str, &str)]) -> Response {
    let qs = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params.iter().copied())
        .finish();
    let to = if qs.is_empty() {
        format!("/{page}")
    } else {
        format!("/{page}?{qs}")
    };
    redirect(headers, StatusCode::SEE_OTHER, &to)
}

/// Valores de um parâmetro da query (o `qs` do Express vira lista se repetir).
fn query_values(query: Option<&str>, key: &str) -> Vec<String> {
    query
        .map(|q| {
            url::form_urlencoded::parse(q.as_bytes())
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v.into_owned())
                .collect()
        })
        .unwrap_or_default()
}

fn query_one(query: Option<&str>, key: &str) -> Option<String> {
    match query_values(query, key).as_slice() {
        [v] => Some(v.clone()),
        _ => None,
    }
}

// ---------------------------------------------------------------- início

struct Authorization {
    url: String,
    cookie: String,
}

fn build_authorization(
    state: &AppState,
    p: &Provider,
    link_user: Option<&str>,
    from_register: bool,
) -> Option<Authorization> {
    let creds = state.config.oauth_clients.get(p.id)?;
    let nonce = random_b64u(24);
    let verifier = p.pkce.then(|| random_b64u(48));
    let mut payload = Map::new();
    payload.insert("p".into(), json!(p.id));
    payload.insert("n".into(), json!(nonce));
    payload.insert(
        "m".into(),
        json!(if link_user.is_some() { "link" } else { "login" }),
    );
    payload.insert(
        "f".into(),
        json!(if from_register { "register" } else { "login" }),
    );
    if let Some(u) = link_user {
        payload.insert("u".into(), json!(u));
    }
    if let Some(v) = &verifier {
        payload.insert("v".into(), json!(v));
    }
    payload.insert("exp".into(), json!(now_ms() + STATE_TTL_MS));
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    q.append_pair("client_id", &creds.client_id)
        .append_pair("redirect_uri", &redirect_uri(state, p.id))
        .append_pair("response_type", "code")
        .append_pair("scope", p.scope)
        .append_pair("state", &nonce)
        .append_pair(p.extra.0, p.extra.1);
    if let Some(v) = &verifier {
        q.append_pair("code_challenge", &b64u(&Sha256::digest(v.as_bytes())))
            .append_pair("code_challenge_method", "S256");
    }
    Some(Authorization {
        url: format!("{}?{}", p.authorize_url, q.finish()),
        cookie: sign_payload(
            &state.config.jwt_access_secret,
            "state",
            &Value::Object(payload),
        ),
    })
}

/// `GET /oauth/providers`.
pub async fn providers(State(state): State<AppState>) -> Response {
    let list: Vec<Value> = enabled(&state)
        .into_iter()
        .filter_map(provider)
        .map(|p| json!({ "id": p.id, "label": p.label }))
        .collect();
    no_store(Json(json!({ "providers": list })).into_response())
}

/// `GET /oauth/{provider}/start?from=login|register`.
pub async fn start(
    State(state): State<AppState>,
    Path(id): Path<String>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&OAUTH, By::Ip)));
    let from = if query_one(query.as_deref(), "from").as_deref() == Some("register") {
        "register"
    } else {
        "login"
    };
    let out = async {
        let Some(p) = provider(&id) else {
            return Ok(back(&c.headers, from, &[("oauth_error", "indisponivel")]));
        };
        let Some(auth) = build_authorization(&state, p, None, from == "register") else {
            return Ok(back(
                &c.headers,
                from,
                &[("oauth_error", "indisponivel"), ("provider", &id)],
            ));
        };
        let res = redirect(&c.headers, StatusCode::FOUND, &auth.url);
        let res = add_cookies(
            res,
            [cookie(
                &state,
                COOKIE_STATE,
                &auth.cookie,
                STATE_PATH,
                STATE_TTL_MS,
            )],
        );
        Ok(no_store(res))
    }
    .await;
    finish(out, c.counted)
}

/// `POST /oauth/{provider}/link` (logado) → `{ url }`.
pub async fn link(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&OAUTH, By::Ip)));
    let out = async {
        let Some(p) = provider(&id) else {
            return Ok(err(StatusCode::NOT_FOUND, "Provedor desconhecido."));
        };
        let Some(auth) = build_authorization(&state, p, Some(uid(&c)), false) else {
            return Ok(err(
                StatusCode::SERVICE_UNAVAILABLE,
                "Este provedor não está disponível no momento.",
            ));
        };
        Ok(add_cookies(
            Json(json!({ "url": auth.url })).into_response(),
            [cookie(
                &state,
                COOKIE_STATE,
                &auth.cookie,
                STATE_PATH,
                STATE_TTL_MS,
            )],
        ))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- troca do código e perfil

struct Identity {
    provider_user_id: String,
    email: Option<String>,
    email_verified: bool,
    name: Option<String>,
    username: Option<String>,
}

/// `clip(v, n)`: texto não vazio, aparado e cortado em `n` (UTF-16).
fn clip(v: Option<&Value>, n: usize) -> Option<String> {
    let t = v?.as_str()?.trim();
    if t.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(
        &t.encode_utf16().take(n).collect::<Vec<u16>>(),
    ))
}

async fn exchange_code(
    state: &AppState,
    p: &Provider,
    code: Option<&str>,
    verifier: Option<&str>,
) -> anyhow::Result<String> {
    let creds = state
        .config
        .oauth_clients
        .get(p.id)
        .ok_or_else(|| anyhow::anyhow!("provider_disabled"))?;
    let code = code
        .filter(|c| !c.is_empty() && c.encode_utf16().count() <= 2048)
        .ok_or_else(|| anyhow::anyhow!("code_missing"))?;
    let form = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", &redirect_uri(state, p.id))
            .append_pair("client_id", &creds.client_id)
            .append_pair("client_secret", &creds.client_secret);
        if p.pkce {
            let v = verifier
                .filter(|v| !v.is_empty())
                .ok_or_else(|| anyhow::anyhow!("pkce_missing"))?;
            form.append_pair("code_verifier", v);
        }
        form.finish()
    };
    let url = api_url(state, p.token_url, &format!("/{}/token", p.id));
    let res = state
        .web
        .post(url)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(header::ACCEPT, "application/json")
        .timeout(std::time::Duration::from_secs(20))
        .body(form)
        .send()
        .await?;
    let ok = res.status().is_success();
    let status = res.status().as_u16();
    let data: Option<Value> = res.json().await.ok();
    match data
        .as_ref()
        .and_then(|d| d.get("access_token"))
        .and_then(Value::as_str)
    {
        Some(t) if ok => Ok(t.to_string()),
        // nunca o corpo (tem o token): só o código de erro do provedor
        _ => {
            let why = data
                .as_ref()
                .and_then(|d| d.get("error"))
                .and_then(Value::as_str)
                .map(String::from)
                .unwrap_or_else(|| format!("HTTP {status}"));
            anyhow::bail!("token_exchange_failed ({why})")
        }
    }
}

async fn get_json(
    state: &AppState,
    url: String,
    token: &str,
    github: bool,
) -> anyhow::Result<Value> {
    let mut req = state
        .web
        .get(url)
        .bearer_auth(token)
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "ProjectClub-OAuth")
        .timeout(std::time::Duration::from_secs(20));
    if github {
        req = req.header("X-GitHub-Api-Version", "2022-11-28");
    }
    let res = req.send().await?;
    if !res.status().is_success() {
        anyhow::bail!("profile_failed (HTTP {})", res.status().as_u16());
    }
    match res.json::<Value>().await {
        Ok(v) if !v.is_null() => Ok(v),
        _ => anyhow::bail!("profile_failed"),
    }
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn lower(v: Option<String>) -> Option<String> {
    v.map(|e| e.to_lowercase()).filter(|e| !e.is_empty())
}

async fn fetch_profile(state: &AppState, id: &str, token: &str) -> anyhow::Result<Identity> {
    match id {
        "google" => {
            let url = api_url(
                state,
                "https://openidconnect.googleapis.com/v1/userinfo",
                "/google/userinfo",
            );
            let d = get_json(state, url, token, false).await?;
            if !truthy(d.get("sub")) {
                anyhow::bail!("profile_failed");
            }
            let ev = d.get("email_verified");
            Ok(Identity {
                provider_user_id: js_string(d.get("sub")),
                email: lower(clip(d.get("email"), 254)),
                email_verified: ev == Some(&json!(true)) || ev == Some(&json!("true")),
                name: clip(d.get("name"), 64),
                username: None,
            })
        }
        "discord" => {
            let url = api_url(state, "https://discord.com/api/users/@me", "/discord/me");
            let d = get_json(state, url, token, false).await?;
            if !truthy(d.get("id")) {
                anyhow::bail!("profile_failed");
            }
            Ok(Identity {
                provider_user_id: js_string(d.get("id")),
                email: lower(clip(d.get("email"), 254)),
                email_verified: d.get("verified") == Some(&json!(true)),
                name: clip(d.get("global_name"), 64).or_else(|| clip(d.get("username"), 64)),
                username: clip(d.get("username"), 64),
            })
        }
        "github" => {
            let url = api_url(state, "https://api.github.com/user", "/github/user");
            let d = get_json(state, url, token, true).await?;
            // `d.id == null`: 0 vale
            let gid = d.get("id").filter(|v| !v.is_null());
            let Some(gid) = gid else {
                anyhow::bail!("profile_failed");
            };
            let gid = match gid {
                Value::String(s) => s.clone(),
                Value::Number(n) => match n.as_f64().map(db::js_number) {
                    Some(Value::Number(m)) => m.to_string(),
                    _ => n.to_string(),
                },
                Value::Bool(b) => b.to_string(),
                Value::Array(_) | Value::Object(_) => js_string(Some(gid)),
                Value::Null => unreachable!(),
            };
            // o confiável é o "primário + verificado" da lista de e-mails
            let (mut email, mut verified) = (None, false);
            let url = api_url(
                state,
                "https://api.github.com/user/emails",
                "/github/emails",
            );
            if let Ok(Value::Array(list)) = get_json(state, url, token, true).await {
                let pick = list
                    .iter()
                    .find(|e| truthy(e.get("primary")) && truthy(e.get("verified")))
                    .or_else(|| list.iter().find(|e| truthy(e.get("verified"))));
                if let Some(e) = pick.filter(|e| truthy(e.get("email"))) {
                    let low = js_string(e.get("email")).to_lowercase();
                    email = Some(String::from_utf16_lossy(
                        &low.encode_utf16().take(254).collect::<Vec<u16>>(),
                    ));
                    verified = true;
                }
            }
            Ok(Identity {
                provider_user_id: gid,
                email,
                email_verified: verified,
                name: clip(d.get("name"), 64).or_else(|| clip(d.get("login"), 64)),
                username: clip(d.get("login"), 64),
            })
        }
        _ => anyhow::bail!("provider_unknown"),
    }
}

/// `suggestUsername`: ClubTag sugerida a partir do perfil (pode trocar).
pub fn suggest_username(username: Option<&str>, name: Option<&str>, email: Option<&str>) -> String {
    let base = username
        .filter(|s| !s.is_empty())
        .or(name.filter(|s| !s.is_empty()))
        .or(email
            .and_then(|e| e.split('@').next())
            .filter(|s| !s.is_empty()))
        .unwrap_or("");
    let stripped: String = base
        .nfd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect();
    let mut out = String::new();
    for ch in stripped.chars() {
        let ch = if ch.is_ascii_alphanumeric() || ch == '_' || ch == '.' {
            ch
        } else {
            '_'
        };
        if ch == '_' && out.ends_with('_') {
            continue;
        }
        out.push(ch);
    }
    let out = out.trim_matches(|c| c == '_' || c == '.');
    let out: String = out.chars().take(32).collect();
    if out.len() >= 4 { out } else { String::new() }
}

// ---------------------------------------------------------------- decisão do callback

enum Decision {
    LinkOk,
    LinkError(&'static str),
    Blocked(&'static str),
    TwoFactor(LoginUser),
    Login(LoginUser),
    EmailExists,
    Pending,
    Signup,
}

fn blocked_kind(u: &LoginUser) -> Option<&'static str> {
    if u.is_platform_banned {
        Some("banida")
    } else if u.account_disabled_at.is_some() {
        Some("desativada")
    } else if u.suspended_until.is_some_and(|t| t > db::now()) {
        Some("suspensa")
    } else {
        None
    }
}

async fn resolve(
    db: &Db,
    provider: &str,
    who: &Identity,
    link_user: Option<&str>,
) -> anyhow::Result<Decision> {
    let existing: Option<String> = db::scalar(
        db,
        "SELECT userId FROM OAuthAccount WHERE provider = ? AND providerUserId = ?",
        params![provider, who.provider_user_id.as_str()],
    )
    .await?;

    if let Some(link_user) = link_user {
        let Some(user) = find_user_by_id(db, link_user).await? else {
            return Ok(Decision::LinkError("conta"));
        };
        if let Some(kind) = blocked_kind(&user) {
            return Ok(Decision::Blocked(kind));
        }
        if let Some(owner) = existing {
            return Ok(if owner == user.id {
                Decision::LinkOk
            } else {
                Decision::LinkError("ja-vinculada")
            });
        }
        let same: Option<String> = db::scalar(
            db,
            "SELECT id FROM OAuthAccount WHERE userId = ? AND provider = ? LIMIT 1",
            params![user.id.as_str(), provider],
        )
        .await?;
        if same.is_some() {
            return Ok(Decision::LinkError("provedor-ja-vinculado"));
        }
        let email = if who.email_verified {
            who.email.clone()
        } else {
            None
        };
        let r = db::exec(
            db,
            "INSERT INTO OAuthAccount (id, userId, provider, providerUserId, email, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
            params![
                db::new_id(),
                user.id.as_str(),
                provider,
                who.provider_user_id.as_str(),
                email,
                db::now()
            ],
        )
        .await;
        return match r {
            Ok(_) => Ok(Decision::LinkOk),
            Err(e) if db::is_unique_violation(&e) => Ok(Decision::LinkError("ja-vinculada")),
            Err(e) => Err(e.into()),
        };
    }

    if let Some(owner) = existing {
        let Some(user) = find_user_by_id(db, &owner).await? else {
            return Ok(Decision::Signup);
        };
        if let Some(kind) = blocked_kind(&user) {
            return Ok(Decision::Blocked(kind));
        }
        return Ok(if user.two_factor_enabled {
            Decision::TwoFactor(user)
        } else {
            Decision::Login(user)
        });
    }

    if let (Some(email), true) = (&who.email, who.email_verified) {
        let by_email: Option<String> = db::scalar(
            db,
            "SELECT id FROM `User` WHERE email = ? LIMIT 1",
            params![email.as_str()],
        )
        .await?;
        if by_email.is_some() {
            return Ok(Decision::EmailExists);
        }
    }

    let pending: Option<String> = db::scalar(
        db,
        "SELECT id FROM MembershipApplication WHERE status = 'PENDING' AND oauthProvider = ? AND oauthProviderUserId = ? LIMIT 1",
        params![provider, who.provider_user_id.as_str()],
    )
    .await?;
    if pending.is_some() {
        return Ok(Decision::Pending);
    }
    Ok(Decision::Signup)
}

fn req_of(headers: &HeaderMap, ip: Option<String>) -> Req {
    Req {
        user_agent: headers
            .get(header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .map(String::from),
        ip,
    }
}

/// `GET /oauth/{provider}/callback?code=…&state=…`.
pub async fn callback(
    State(state): State<AppState>,
    Path(id): Path<String>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&OAUTH, By::Ip)));
    let raw_cookie = s::read_cookie(&c.headers, COOKIE_STATE);
    // uso único: o cookie de estado some já na primeira chegada aqui
    let cleared = clear(&state, COOKIE_STATE, STATE_PATH);
    let h = &c.headers;
    let out: anyhow::Result<(Response, Vec<HeaderValue>)> = async {
        let Some(p) = provider(&id) else {
            return Ok((back(h, "login", &[("oauth_error", "indisponivel")]), vec![]));
        };
        let q = query.as_deref();
        let st = verify_payload(
            &state.config.jwt_access_secret,
            "state",
            raw_cookie.as_deref(),
        )
        .filter(|st| st.get("p").and_then(Value::as_str) == Some(p.id))
        .filter(|st| {
            let nonce = st.get("n").and_then(Value::as_str).unwrap_or("");
            matches!(query_one(q, "state"), Some(s) if !s.is_empty()
                    && s.len() == nonce.len()
                    && bool::from(s.as_bytes().ct_eq(nonce.as_bytes())))
        })
        .filter(|st| st.get("m").and_then(Value::as_str) != Some("link") || truthy(st.get("u")));
        let Some(st) = st else {
            return Ok((
                back(h, "login", &[("oauth_error", "estado"), ("provider", p.id)]),
                vec![],
            ));
        };
        let link_user =
            (st.get("m").and_then(Value::as_str) == Some("link")).then(|| js_string(st.get("u")));
        let from = st
            .get("f")
            .and_then(Value::as_str)
            .unwrap_or("login")
            .to_string();
        let fail = |code: &str| {
            if link_user.is_some() {
                back(h, "oauth/retorno", &[("erro", code), ("provedor", p.id)])
            } else {
                back(h, &from, &[("oauth_error", code), ("provider", p.id)])
            }
        };

        // a pessoa clicou em "Cancelar" no provedor (ou ele recusou)
        let error = query_values(q, "error");
        if error.len() > 1 || error.first().is_some_and(|e| !e.is_empty()) {
            return Ok((fail("cancelado"), vec![]));
        }

        let code = query_one(q, "code");
        let verifier = st.get("v").and_then(Value::as_str);
        let who = match exchange_code(&state, p, code.as_deref(), verifier).await {
            Ok(token) => fetch_profile(&state, p.id, &token).await,
            Err(e) => Err(e),
        };
        let who = match who {
            Ok(w) => w,
            Err(e) => {
                // só o código do erro — nunca o corpo da resposta (pode ter token)
                let short = e.to_string();
                let short = short.split(' ').next().unwrap_or("erro");
                tracing::warn!("[oauth] {}: falha na troca do código ({short}).", p.id);
                return Ok((fail("falha"), vec![]));
            }
        };

        let decision = resolve(&c.db, p.id, &who, link_user.as_deref()).await?;
        Ok(match decision {
            Decision::LinkOk => (back(h, "oauth/retorno", &[("vinculado", p.id)]), vec![]),
            Decision::LinkError(e) => (fail(e), vec![]),
            Decision::Blocked(kind) => (fail(kind), vec![]),
            Decision::EmailExists => (
                back(
                    h,
                    "login",
                    &[("oauth_error", "email_existente"), ("provider", p.id)],
                ),
                vec![],
            ),
            Decision::Pending => (fail("inscricao_pendente"), vec![]),
            Decision::TwoFactor(user) => {
                let token = sign_payload(
                    &state.config.jwt_access_secret,
                    "2fa",
                    &json!({ "uid": user.id, "p": p.id, "exp": now_ms() + PENDING_2FA_TTL_MS }),
                );
                (
                    back(h, "login", &[("oauth_2fa", p.id)]),
                    vec![cookie(
                        &state,
                        COOKIE_2FA,
                        &token,
                        STATE_PATH,
                        PENDING_2FA_TTL_MS,
                    )],
                )
            }
            Decision::Login(user) => {
                let (_, cookies) =
                    complete_login_parts(&state, &c.db, &req_of(h, c.ip.clone()), &user).await?;
                (
                    back(h, "login", &[("oauth", "ok"), ("provider", p.id)]),
                    cookies,
                )
            }
            Decision::Signup => {
                // e-mail só vai pré-preenchido quando o provedor confirmou
                let suggested = suggest_username(
                    who.username.as_deref(),
                    who.name.as_deref(),
                    who.email.as_deref(),
                );
                let token = sign_payload(
                    &state.config.jwt_access_secret,
                    "signup",
                    &json!({
                        "p": p.id,
                        "id": who.provider_user_id,
                        "email": if who.email_verified { who.email.clone() } else { None },
                        "name": who.name,
                        "username": (!suggested.is_empty()).then_some(suggested),
                        "exp": now_ms() + SIGNUP_TTL_MS,
                    }),
                );
                (
                    back(h, "register", &[("oauth", p.id)]),
                    vec![cookie(
                        &state,
                        COOKIE_SIGNUP,
                        &token,
                        SIGNUP_PATH,
                        SIGNUP_TTL_MS,
                    )],
                )
            }
        })
    }
    .await;
    let out =
        out.map(|(res, cookies)| add_cookies(res, std::iter::once(cleared.clone()).chain(cookies)));
    // erro de verdade (500) também limpa o cookie de estado
    let res = finish(out, c.counted);
    if res.status().is_server_error() {
        return add_cookies(res, [cleared]);
    }
    res
}

// ---------------------------------------------------------------- 2FA depois do provedor

/// `POST /oauth/2fa { twoFactorCode | recoveryCode }` — mesmas regras do
/// login com senha (código de uso único, bloqueio por erros).
pub async fn complete_2fa(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, false, Some((&ratelimit::LOGIN, By::Ip)));
    let out = async {
        let pending = verify_payload(
            &state.config.jwt_access_secret,
            "2fa",
            s::read_cookie(&c.headers, COOKIE_2FA).as_deref(),
        )
        .filter(|p| truthy(p.get("uid")));
        let Some(pending) = pending else {
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                json!({ "error": "A confirmação expirou. Entre de novo com o provedor.", "expired": true }),
            ));
        };
        let field = |k: &str| c.body.get(k).filter(|v| !v.is_null());
        let (totp, recovery) = (field("twoFactorCode"), field("recoveryCode"));
        if totp.is_some_and(|v| !v.is_string()) || recovery.is_some_and(|v| !v.is_string()) {
            return Ok(err(StatusCode::BAD_REQUEST, "Código 2FA inválido."));
        }
        let user = find_user_by_id(&c.db, &js_string(pending.get("uid"))).await?;
        let Some(user) = user.filter(|u| !is_account_blocked(u)) else {
            return Ok(add_cookies(
                err(StatusCode::FORBIDDEN, "Não foi possível entrar nesta conta."),
                [clear(&state, COOKIE_2FA, STATE_PATH)],
            ));
        };
        let now = db::now();
        if let Some(until) = user.login_locked_until.filter(|u| *u > now) {
            let ms = (until - now).num_milliseconds();
            let mins = (ms + 59_999) / 60_000;
            return Ok(err(
                StatusCode::TOO_MANY_REQUESTS,
                &format!("Muitas tentativas de login para esta conta. Tente novamente em {mins} minuto(s)."),
            ));
        }
        let trimmed = |v: Option<&Value>| {
            v.and_then(Value::as_str)
                .filter(|s| !s.trim_matches(|ch: char| ch.is_whitespace() || ch == '\u{feff}').is_empty())
                .map(String::from)
        };
        let (recovery, totp) = (trimmed(recovery), trimmed(totp));
        if recovery.is_none() && totp.is_none() {
            return Ok(err(StatusCode::BAD_REQUEST, "Digite o código de verificação."));
        }
        if user.two_factor_enabled {
            let ok = match (&recovery, &totp) {
                (Some(r), _) => consume_recovery_code(&c.db, &user.id, r).await?,
                (None, Some(t)) => {
                    verify_totp_once_for(
                        &c.db,
                        &user.id,
                        user.two_factor_secret.as_deref(),
                        user.two_factor_last_used_step,
                        t,
                    )
                    .await?
                }
                (None, None) => false,
            };
            if !ok {
                register_failed_login(&c.db, &user.id).await?;
                let msg = if recovery.is_some() {
                    "Código de recuperação inválido ou já usado."
                } else {
                    "Código 2FA inválido."
                };
                return Ok(err(StatusCode::UNAUTHORIZED, msg));
            }
        }
        let (session, cookies) =
            complete_login_parts(&state, &c.db, &req_of(&c.headers, c.ip.clone()), &user).await?;
        Ok(add_cookies(
            Json(session).into_response(),
            std::iter::once(clear(&state, COOKIE_2FA, STATE_PATH)).chain(cookies),
        ))
    }
    .await;
    finish(out, c.counted)
}

// ---------------------------------------------------------------- inscrição e contas ligadas

/// `GET /oauth/signup` — dados pra pré-preencher a inscrição.
pub async fn signup_info(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let p = verify_payload(
        &state.config.jwt_access_secret,
        "signup",
        s::read_cookie(&headers, COOKIE_SIGNUP).as_deref(),
    )
    .filter(|p| {
        p.get("p")
            .and_then(Value::as_str)
            .and_then(provider)
            .is_some()
    })
    .filter(|p| {
        p.get("id")
            .and_then(Value::as_str)
            .is_some_and(|i| !i.is_empty())
    });
    let Some(p) = p else {
        return no_store(Json(json!({ "pending": null })).into_response());
    };
    let prov = p.get("p").and_then(Value::as_str).and_then(provider);
    let text = |k: &str| {
        let v = p.get(k);
        if truthy(v) {
            v.cloned().unwrap_or(json!(""))
        } else {
            json!("")
        }
    };
    no_store(
        Json(json!({
            "pending": {
                "provider": prov.map(|x| x.id),
                "label": prov.map(|x| x.label),
                "email": text("email"),
                "name": text("name"),
                "username": text("username"),
            }
        }))
        .into_response(),
    )
}

/// `DELETE /oauth/signup` — "não usar a conta X nesta inscrição".
pub async fn cancel_signup(State(state): State<AppState>) -> Response {
    add_cookies(
        Json(json!({ "ok": true })).into_response(),
        [clear(&state, COOKIE_SIGNUP, SIGNUP_PATH)],
    )
}

/// `GET /oauth/accounts` (logado).
pub async fn accounts(State(state): State<AppState>, parts: Parts, body: Bytes) -> Response {
    let c = prelude_or_return!(state, parts, body, true, None);
    let out = async {
        let rows = db::all(
            &c.db,
            "SELECT provider, email, createdAt FROM OAuthAccount WHERE userId = ? ORDER BY createdAt ASC",
            params![uid(&c)],
        )
        .await?;
        let mut list = Vec::with_capacity(rows.len());
        for r in &rows {
            list.push(json!({
                "provider": db::get::<String>(r, "provider")?,
                "email": db::get::<Option<String>>(r, "email")?,
                "createdAt": db::iso(db::get(r, "createdAt")?),
            }));
        }
        let on = enabled(&state);
        let providers: Vec<Value> = PROVIDERS
            .iter()
            .filter(|p| on.contains(&p.id) || list.iter().any(|a| a["provider"] == p.id))
            .map(|p| json!({ "id": p.id, "label": p.label, "enabled": on.contains(&p.id) }))
            .collect();
        Ok(Json(json!({ "accounts": list, "providers": providers })).into_response())
    }
    .await;
    finish(out, c.counted)
}

/// `DELETE /oauth/accounts/{provider}` (logado).
pub async fn unlink(
    State(state): State<AppState>,
    Path(id): Path<String>,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&ratelimit::AUTH, By::Ip)));
    let out = async {
        if provider(&id).is_none() {
            return Ok(err(StatusCode::NOT_FOUND, "Provedor desconhecido."));
        }
        let n = db::exec(
            &c.db,
            "DELETE FROM OAuthAccount WHERE userId = ? AND provider = ?",
            params![uid(&c), id.as_str()],
        )
        .await?;
        if n == 0 {
            return Ok(err(
                StatusCode::NOT_FOUND,
                "Nenhuma conta conectada desse provedor.",
            ));
        }
        Ok(Json(json!({ "ok": true })).into_response())
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clubtag_sugerida_como_o_node() {
        assert_eq!(suggest_username(Some("João Ção"), None, None), "Joao_Cao");
        assert_eq!(suggest_username(None, Some("__ab.c__"), None), "ab.c");
        assert_eq!(suggest_username(None, None, Some("ze@x.com")), "");
        assert_eq!(
            suggest_username(None, None, Some("zezinho@x.com")),
            "zezinho"
        );
        assert_eq!(suggest_username(Some("😀😀abcd"), None, None), "abcd");
        assert_eq!(
            suggest_username(Some(&"a".repeat(40)), None, None).len(),
            32
        );
    }

    #[test]
    fn token_assinado() {
        let t = sign_payload(
            "seg",
            "state",
            &json!({ "p": "google", "exp": now_ms() + 1000 }),
        );
        assert!(verify_payload("seg", "state", Some(&t)).is_some());
        assert!(
            verify_payload("seg", "2fa", Some(&t)).is_none(),
            "outro uso"
        );
        assert!(verify_payload("outro", "state", Some(&t)).is_none());
        let velho = sign_payload("seg", "state", &json!({ "exp": now_ms() - 1 }));
        assert!(verify_payload("seg", "state", Some(&velho)).is_none());
        assert!(verify_payload("seg", "state", Some("a.b.c")).is_none());
    }
}
