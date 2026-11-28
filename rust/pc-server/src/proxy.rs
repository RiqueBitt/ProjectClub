//! Repasse pro Node de tudo que ainda não foi portado pro Rust — HTTP normal
//! e WebSocket (Socket.IO, Club Penguin, voz), sem o site nem os apps
//! perceberem diferença.
//!
//! Cabeçalhos: o `X-Forwarded-For` passa **sem mudar** — o Node usa
//! `trust proxy 1` e pega o último IP da lista, que é o que o proxy da
//! hospedagem colocou (o IP de verdade de quem acessou). Se o Rust
//! acrescentasse o IP da conexão dele, o Node passaria a ver o IP do proxy
//! da hospedagem em todo mundo (e o limite por IP viraria um só pra todos).

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Request, Response, StatusCode, Uri, header};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};

use crate::AppState;

pub type HttpClient = Client<HttpConnector, Body>;

pub fn client() -> HttpClient {
    let mut connector = HttpConnector::new();
    connector.set_nodelay(true);
    Client::builder(TokioExecutor::new())
        .pool_idle_timeout(std::time::Duration::from_secs(60))
        .build(connector)
}

/// Cabeçalhos de um salto só (RFC 9110 §7.6.1): não passam adiante.
const HOP_BY_HOP: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

fn is_upgrade(headers: &HeaderMap) -> bool {
    headers
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',')
                .any(|t| t.trim().eq_ignore_ascii_case("upgrade"))
        })
        && headers.contains_key(header::UPGRADE)
}

fn strip_hop_by_hop(headers: &mut HeaderMap) {
    // também os que o próprio Connection listou
    let listed: Vec<HeaderName> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|t| HeaderName::from_bytes(t.trim().as_bytes()).ok())
        .collect();
    for name in listed {
        headers.remove(name);
    }
    for name in HOP_BY_HOP {
        headers.remove(name);
    }
}

/// Marca nas respostas que vieram do Node (o Rust não mexe no corpo delas).
#[derive(Clone, Copy)]
pub struct Proxied;

pub async fn forward(State(state): State<AppState>, req: Request<Body>) -> Response<Body> {
    let mut res = forward_inner(state, req).await;
    res.extensions_mut().insert(Proxied);
    res
}

async fn forward_inner(state: AppState, mut req: Request<Body>) -> Response<Body> {
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|| "/".into());
    let uri: Uri = match format!("{}{}", state.config.node_upstream, path_and_query).parse() {
        Ok(u) => u,
        Err(_) => return status(StatusCode::BAD_REQUEST),
    };

    let upgrade = is_upgrade(req.headers());
    let client_upgrade = upgrade.then(|| hyper::upgrade::on(&mut req));

    let (mut parts, body) = req.into_parts();
    let upgrade_value = parts.headers.get(header::UPGRADE).cloned();
    strip_hop_by_hop(&mut parts.headers);
    if let Some(v) = upgrade_value.filter(|_| upgrade) {
        parts
            .headers
            .insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
        parts.headers.insert(header::UPGRADE, v);
    }
    parts.uri = uri;
    parts.version = axum::http::Version::HTTP_11;

    let mut resp = match state.http.request(Request::from_parts(parts, body)).await {
        Ok(r) => r,
        Err(err) => {
            // só o caminho: a query pode ter segredo (código do OAuth, chave…)
            let path = path_and_query.split('?').next().unwrap_or("");
            tracing::warn!("node fora do ar ({path}): {err}");
            return status(StatusCode::BAD_GATEWAY);
        }
    };

    if resp.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(client_upgrade) = client_upgrade
    {
        let node_upgrade = hyper::upgrade::on(&mut resp);
        tokio::spawn(async move {
            match (client_upgrade.await, node_upgrade.await) {
                (Ok(client), Ok(node)) => {
                    let (mut a, mut b) = (TokioIo::new(client), TokioIo::new(node));
                    let _ = tokio::io::copy_bidirectional(&mut a, &mut b).await;
                }
                (Err(err), _) | (_, Err(err)) => tracing::debug!("websocket não abriu: {err}"),
            }
        });
        let (parts, _) = resp.into_parts();
        return Response::from_parts(parts, Body::empty());
    }

    let (mut parts, body) = resp.into_parts();
    strip_hop_by_hop(&mut parts.headers);
    Response::from_parts(parts, Body::new(body))
}

fn status(code: StatusCode) -> Response<Body> {
    let mut r = Response::new(Body::empty());
    *r.status_mut() = code;
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detecta_upgrade() {
        let mut h = HeaderMap::new();
        h.insert(
            header::CONNECTION,
            HeaderValue::from_static("keep-alive, Upgrade"),
        );
        h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        assert!(is_upgrade(&h));
        h.remove(header::UPGRADE);
        assert!(!is_upgrade(&h));
    }

    #[test]
    fn tira_cabecalhos_de_um_salto() {
        let mut h = HeaderMap::new();
        h.insert(header::CONNECTION, HeaderValue::from_static("x-temp"));
        h.insert("x-temp", HeaderValue::from_static("1"));
        h.insert(
            header::TRANSFER_ENCODING,
            HeaderValue::from_static("chunked"),
        );
        h.insert("x-forwarded-for", HeaderValue::from_static("1.2.3.4"));
        strip_hop_by_hop(&mut h);
        assert!(h.get("x-temp").is_none());
        assert!(h.get(header::TRANSFER_ENCODING).is_none());
        assert_eq!(h.get("x-forwarded-for").unwrap(), "1.2.3.4");
    }
}
