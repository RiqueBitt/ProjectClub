//! Ponte com o Node: o que o Rust ainda pede pro Node fazer (e-mail,
//! notificações, tempo real) pela rota interna `server/src/routes/internal.js`.
//!
//! Segredo: HMAC-SHA256(JWT_ACCESS_SECRET, "pc-internal-v1") em hex, no
//! cabeçalho `X-PC-Internal`. Tudo em segundo plano: falha só vai pro log
//! (como no Node, o aviso nunca bloqueia o login).

use hmac::{Hmac, Mac};
use serde_json::json;

use crate::AppState;

pub fn internal_secret(jwt_access_secret: &str) -> String {
    let mut m = Hmac::<sha2::Sha256>::new_from_slice(jwt_access_secret.as_bytes()).expect("hmac");
    m.update(b"pc-internal-v1");
    hex::encode(m.finalize().into_bytes())
}

/// Login num aparelho novo → e-mail "novo acesso" + aviso em Notificações.
pub fn login_alert(
    state: &AppState,
    user_id: &str,
    user_agent: Option<&str>,
    ip: Option<&str>,
    session_id: &str,
) {
    let url = format!("{}/api/internal/login-alert", state.config.node_upstream);
    let secret = internal_secret(&state.config.jwt_access_secret);
    let body =
        json!({ "userId": user_id, "userAgent": user_agent, "ip": ip, "sessionId": session_id });
    let web = state.web.clone();
    tokio::spawn(async move {
        match web
            .post(&url)
            .header("x-pc-internal", secret)
            .json(&body)
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {}
            Ok(r) => tracing::error!(
                "[login] aviso de novo acesso: o Node respondeu {}",
                r.status()
            ),
            Err(e) => tracing::error!("[login] aviso de novo acesso: {e}"),
        }
    });
}

/// E-mail pelo Node (verificação ou "esqueci a senha"). Espera o envio,
/// como o Node fazia na própria rota; falha só vai pro log.
pub async fn send_email(state: &AppState, body: serde_json::Value) {
    let url = format!("{}/api/internal/email", state.config.node_upstream);
    let secret = internal_secret(&state.config.jwt_access_secret);
    let r = state
        .web
        .post(&url)
        .header("x-pc-internal", secret)
        .timeout(std::time::Duration::from_secs(30))
        .json(&body)
        .send()
        .await;
    match r {
        Ok(r) if r.status().is_success() => {
            if let Ok(v) = r.json::<serde_json::Value>().await
                && v.get("ok") != Some(&serde_json::Value::Bool(true))
            {
                tracing::error!("[email] o Node não conseguiu enviar ({})", body["kind"]);
            }
        }
        Ok(r) => tracing::error!("[email] o Node respondeu {}", r.status()),
        Err(e) => tracing::error!("[email] {e}"),
    }
}

/// `io.kickUser`: avisa o evento nos sockets da pessoa e desconecta todos.
pub fn kick(state: &AppState, user_id: &str, event: &str, payload: serde_json::Value) {
    let url = format!("{}/api/internal/kick", state.config.node_upstream);
    let secret = internal_secret(&state.config.jwt_access_secret);
    let body = json!({ "userId": user_id, "event": event, "payload": payload });
    let web = state.web.clone();
    tokio::spawn(async move {
        if let Err(e) = web
            .post(&url)
            .header("x-pc-internal", secret)
            .json(&body)
            .send()
            .await
        {
            tracing::error!("[kick] {e}");
        }
    });
}

/// Um `emit` do Socket.IO pedido ao Node: `to` vazio = todo mundo.
#[derive(Clone, Debug, serde::Serialize)]
pub struct Emit {
    pub to: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub except: Vec<String>,
    pub event: String,
    pub payload: serde_json::Value,
}

impl Emit {
    pub fn to(rooms: &[&str], event: &str, payload: serde_json::Value) -> Self {
        Self {
            to: rooms.iter().map(|r| r.to_string()).collect(),
            except: vec![],
            event: event.into(),
            payload,
        }
    }

    pub fn except(mut self, rooms: &[&str]) -> Self {
        self.except = rooms.iter().map(|r| r.to_string()).collect();
        self
    }
}

/// Fila única de tempo real: os pedidos ao Node saem um de cada vez, na
/// ordem em que as rotas pediram (dois emits seguidos nunca se invertem).
#[derive(Clone)]
pub struct Realtime(tokio::sync::mpsc::UnboundedSender<(String, String, serde_json::Value)>);

impl Realtime {
    pub fn start(web: reqwest::Client) -> Self {
        let (tx, mut rx) =
            tokio::sync::mpsc::unbounded_channel::<(String, String, serde_json::Value)>();
        tokio::spawn(async move {
            while let Some((url, secret, body)) = rx.recv().await {
                let r = web
                    .post(&url)
                    .header("x-pc-internal", secret)
                    .json(&body)
                    .send()
                    .await;
                if let Err(e) = r {
                    tracing::error!("[realtime] {e}");
                }
            }
        });
        Self(tx)
    }
}

/// Manda emits (e, se tiver, a presença) pro Socket.IO do Node, sem esperar.
pub fn realtime(
    state: &AppState,
    emits: Vec<Emit>,
    presence: Option<(serde_json::Value, Option<&str>)>,
) {
    let mut body = json!({ "emits": emits });
    if let Some((user, manual)) = presence {
        body["presence"] = json!({ "user": user, "manualStatus": manual });
    }
    let url = format!("{}/api/internal/realtime", state.config.node_upstream);
    let secret = internal_secret(&state.config.jwt_access_secret);
    let _ = state.realtime.0.send((url, secret, body));
}

#[cfg(test)]
mod tests {
    #[test]
    fn segredo_igual_ao_do_node() {
        // crypto.createHmac('sha256', 'segredo').update('pc-internal-v1').digest('hex')
        assert_eq!(
            super::internal_secret("segredo"),
            include_str!("../tests/fixtures/internal_secret.txt").trim()
        );
    }
}
