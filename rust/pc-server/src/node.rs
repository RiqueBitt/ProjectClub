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
