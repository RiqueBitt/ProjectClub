//! `/api/system/*` — porte de `server/src/routes/system.js`.
//!
//! Já em Rust: `GET /desktop-latest`.
//! Ainda no Node (passam pelo proxy): `/deploy` e `/deployed` (dependem do
//! processo do Node que se atualiza sozinho), `/publish-release` e
//! `/client-error` (os erros vão pro anel em memória que a aba Saúde lê).

use axum::Json;
use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;
use serde_json::{Value, json};

use crate::AppState;

/// O que tem no latest.yml.
#[derive(Debug, PartialEq, Default)]
pub struct DesktopLatest {
    pub version: Option<String>,
    pub release_date: Option<String>,
}

impl DesktopLatest {
    /// Mesma forma do JSON do Node: `{ version, releaseDate }` (os dois
    /// podem ser null).
    pub fn to_json(&self) -> Value {
        json!({ "version": self.version, "releaseDate": self.release_date })
    }
}

/// Lê `version:` e `releaseDate:` do latest.yml do electron-updater (as
/// mesmas regras das expressões do Node).
pub fn parse_latest_yml(text: &str) -> DesktopLatest {
    let mut out = DesktopLatest::default();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("version:") {
            if out.version.is_none() {
                let v = rest.trim_start().trim_start_matches(['\'', '"']);
                let v: String = v
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
                    .collect();
                if v.starts_with(|c: char| c.is_ascii_digit()) {
                    out.version = Some(v);
                }
            }
        } else if let Some(rest) = line.strip_prefix("releaseDate:")
            && out.release_date.is_none()
        {
            let v = rest.trim_start().trim_start_matches(['\'', '"']);
            let v: String = v.chars().take_while(|c| !matches!(c, '\'' | '"')).collect();
            if !v.is_empty() {
                out.release_date = Some(v);
            }
        }
    }
    out
}

/// GitHub respondeu → `{ version, releaseDate }`; não respondeu (ou erro)
/// → `{ version: null }`, como no Node.
async fn fetch_latest(http: &reqwest::Client, url: &str) -> Value {
    let resp = http
        .get(url)
        .header(header::USER_AGENT, "ProjectClub")
        .send()
        .await;
    match resp {
        Ok(r) if r.status().is_success() => match r.text().await {
            Ok(text) => parse_latest_yml(&text).to_json(),
            Err(_) => json!({ "version": null }),
        },
        _ => json!({ "version": null }),
    }
}

pub async fn desktop_latest(State(state): State<AppState>) -> impl IntoResponse {
    let http = state.web.clone();
    let url = state.config.desktop_latest_url.clone();
    let data: Value = state
        .cache
        .get_or_set("desktop:latest", 5 * 60, || async move {
            fetch_latest(&http, &url).await
        })
        .await;
    ([(header::CACHE_CONTROL, "public, max-age=120")], Json(data))
}

/// Quando este processo subiu.
static STARTED: std::sync::LazyLock<(std::time::Instant, String)> =
    std::sync::LazyLock::new(|| {
        (
            std::time::Instant::now(),
            crate::db::iso(chrono::Utc::now().naive_utc()),
        )
    });

/// Marca a hora em que o servidor subiu (chamado no começo do `main`).
pub fn mark_started() {
    std::sync::LazyLock::force(&STARTED);
}

/// `GET /api/system/rust` — só existe quando o Rust está na frente (no Node
/// puro dá 404). Serve pra conferir que ele está no ar e pro vigia do
/// `scripts/deploy.js` saber que ele está respondendo.
pub async fn rust_status(State(state): State<AppState>) -> impl IntoResponse {
    let fallbacks = crate::web::GET_FALLBACKS.load(std::sync::atomic::Ordering::Relaxed);
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(json!({
            "ok": true,
            "rust": true,
            "build": option_env!("PC_BUILD_SHA").unwrap_or("dev"),
            "startedAt": STARTED.1,
            "uptimeSeconds": STARTED.0.elapsed().as_secs(),
            "getFallbacks": fallbacks,
            "skip": state.config.skip_prefixes,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_o_latest_yml() {
        let yml = "version: 1.42.0\nfiles:\n  - url: Project-Club-Setup.exe\nreleaseDate: '2026-11-17T20:02:16.000Z'\n";
        assert_eq!(
            parse_latest_yml(yml),
            DesktopLatest {
                version: Some("1.42.0".into()),
                release_date: Some("2026-11-17T20:02:16.000Z".into())
            }
        );
    }

    #[test]
    fn versao_entre_aspas_e_sem_data() {
        let d = parse_latest_yml("version: \"2.0.0-beta.1\"\n");
        assert_eq!(d.version.as_deref(), Some("2.0.0-beta.1"));
        assert_eq!(
            d.to_json(),
            json!({ "version": "2.0.0-beta.1", "releaseDate": null })
        );
    }

    #[test]
    fn sem_versao_vira_null() {
        let d = parse_latest_yml("nada aqui");
        assert_eq!(d.to_json(), json!({ "version": null, "releaseDate": null }));
    }
}
