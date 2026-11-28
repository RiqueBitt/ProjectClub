//! `/api/gifs` (routes/gifs.js + controllers/gifController.js): busca e
//! categorias de GIFs na Klipy, com o mesmo cache do Node no Redis
//! (`cache:gifs:...`) — um lado aproveita o que o outro já buscou.

use axum::Json;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::request::Parts;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Map, Value, json};

use crate::AppState;
use crate::auth::error;
use crate::ratelimit::Limit;
use crate::routes::ctx::{
    By, finish, js_parse_int, js_slice, js_string, js_trim, prelude_or_return,
};
use crate::routes::users::query_one;

/// `gifLimiter`: 90 por minuto por conta.
pub const GIFS: Limit = Limit {
    prefix: "gifs",
    window_ms: 60 * 1000,
    max: 90,
    message: None,
    standard: true,
    legacy: false,
};

const KLIPY_CLIENT: &str = "embercord";

/// Por que a Klipy não respondeu (o `gifError` do Node).
enum GifError {
    /// sem `KLIPY_KEY` → 503
    Unconfigured,
    /// resposta não-ok, rede, tempo esgotado ou `TypeError` → 502
    Upstream,
    /// o resto (ex.: JSON inválido) → 500
    Other(anyhow::Error),
}

fn gif_response(e: GifError) -> anyhow::Result<Response> {
    match e {
        GifError::Unconfigured => Ok(error(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "error": "Busca de GIFs não configurada.", "code": "unconfigured" }),
        )),
        GifError::Upstream => Ok(error(
            StatusCode::BAD_GATEWAY,
            json!({ "error": "Não foi possível carregar GIFs agora.", "code": "upstream" }),
        )),
        GifError::Other(e) => Err(e),
    }
}

/// `klipy(path, params)`: GET com a chave e 8 s de limite.
async fn klipy(state: &AppState, path: &str, params: &[(&str, String)]) -> Result<Value, GifError> {
    let key = &state.config.klipy_key.0;
    if key.is_empty() {
        return Err(GifError::Unconfigured);
    }
    let qs = {
        let mut s = url::form_urlencoded::Serializer::new(String::new());
        for (k, v) in params {
            s.append_pair(k, v);
        }
        s.append_pair("key", key)
            .append_pair("client_key", KLIPY_CLIENT)
            .append_pair("media_filter", "gif");
        s.finish()
    };
    let url = format!("{}/{path}?{qs}", state.config.klipy_base);
    let res = state
        .web
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|_| GifError::Upstream)?;
    if !res.status().is_success() {
        tracing::warn!("[gifs] KLIPY /{path} respondeu {}", res.status().as_u16());
        return Err(GifError::Upstream);
    }
    let text = res.text().await.map_err(|_| GifError::Upstream)?;
    crate::js::parse(&text)
        .ok_or_else(|| GifError::Other(anyhow::anyhow!("[gifs] JSON inválido da Klipy")))
}

/// `v?.campo` do JS (`None` = `undefined`). Em `null`/`undefined` o `?.`
/// para; em texto/número dá `undefined`.
fn opt<'a>(v: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    match v? {
        Value::Object(m) => m.get(key),
        _ => None,
    }
}

/// `v.campo` do JS sem `?.`: em `null`/`undefined` é TypeError.
fn prop<'a>(v: Option<&'a Value>, key: &str) -> Result<Option<&'a Value>, GifError> {
    match v {
        None | Some(Value::Null) => Err(GifError::Upstream),
        Some(Value::Object(m)) => Ok(m.get(key)),
        Some(_) => Ok(None),
    }
}

/// Verdadeiro no sentido do JS.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `a || b`.
fn or<'a>(a: Option<&'a Value>, b: Option<&'a Value>) -> Option<&'a Value> {
    if truthy(a) { a } else { b }
}

/// `x[i]` do JS (array, texto ou objeto com a chave `"i"`).
fn index(v: Option<&Value>, i: usize) -> Option<Value> {
    match v? {
        Value::Array(a) => a.get(i).cloned(),
        Value::String(s) => {
            let u: Vec<u16> = s.encode_utf16().collect();
            u.get(i)
                .map(|c| Value::String(String::from_utf16_lossy(&[*c])))
        }
        Value::Object(m) => m.get(&i.to_string()).cloned(),
        _ => None,
    }
}

/// `(data?.lista || [])` que precisa ser um array (senão `.map`/`.slice`
/// dá TypeError → 502). Um texto também tem `.slice`, mas depois `.map` não.
fn list<'a>(data: &'a Value, key: &str) -> Result<&'a [Value], GifError> {
    match opt(Some(data), key) {
        v if !truthy(v) => Ok(&[]),
        Some(Value::Array(a)) => Ok(a),
        _ => Err(GifError::Upstream),
    }
}

fn put(out: &mut Map<String, Value>, key: &str, v: Option<Value>) {
    if let Some(v) = v {
        out.insert(key.into(), v);
    }
}

/// `mapResults` (com `width`/`height` do GIF pequeno).
fn map_results(data: &Value) -> Result<Vec<Value>, GifError> {
    let mut out = Vec::new();
    for r in list(data, "results")? {
        let id = prop(Some(r), "id")?.cloned();
        let formats = prop(Some(r), "media_formats")?;
        let tiny = opt(formats, "tinygif");
        let gif = opt(formats, "gif");
        let preview = or(opt(tiny, "url"), opt(gif, "url")).cloned();
        let full = opt(gif, "url").cloned();
        let empty = Value::Array(vec![]);
        let dims = or(or(opt(tiny, "dims"), opt(gif, "dims")), Some(&empty));
        let dim = |i| {
            let v = index(dims, i);
            if truthy(v.as_ref()) {
                v.unwrap_or(Value::Null)
            } else {
                Value::Null
            }
        };
        if !truthy(full.as_ref()) {
            continue;
        }
        let mut g = Map::new();
        put(&mut g, "id", id);
        put(&mut g, "preview", preview);
        put(&mut g, "full", full);
        g.insert("width".into(), dim(0));
        g.insert("height".into(), dim(1));
        out.push(Value::Object(g));
    }
    Ok(out)
}

/// As categorias (até 12): `{ name, searchterm, image }`.
fn map_tags(data: &Value) -> Result<Vec<Value>, GifError> {
    let mut out = Vec::new();
    for t in list(data, "tags")?.iter().take(12) {
        let mut g = Map::new();
        put(&mut g, "name", prop(Some(t), "name")?.cloned());
        put(&mut g, "searchterm", prop(Some(t), "searchterm")?.cloned());
        put(&mut g, "image", prop(Some(t), "image")?.cloned());
        out.push(Value::Object(g));
    }
    Ok(out)
}

fn locale(query: Option<&str>) -> String {
    let raw = query_one(query, "locale");
    let s = js_string(raw.as_ref());
    js_slice(if s.is_empty() { "pt_BR" } else { &s }, 10)
}

fn with_cache_control(body: Value, cc: &'static str) -> Response {
    let mut res = Json(body).into_response();
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(cc));
    res
}

/// `GET /api/gifs/search?q=&limit=&locale=` (sem `q`: os em destaque).
pub async fn search(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&GIFS, By::User)));
    let out = async {
        let q = query.as_deref();
        let raw_q = query_one(q, "q");
        let text = js_slice(js_trim(&js_string(raw_q.as_ref())), 100);
        let raw_limit = query_one(q, "limit");
        let n = js_parse_int(raw_limit.as_ref());
        let limit = (if n.is_nan() || n == 0.0 { 24.0 } else { n }).clamp(1.0, 50.0) as i64;
        let loc = locale(q);
        let (key, ttl) = if text.is_empty() {
            (format!("gifs:featured:{loc}:{limit}"), 1800)
        } else {
            (
                format!("gifs:search:{loc}:{limit}:{}", text.to_lowercase()),
                600,
            )
        };
        let st = state.clone();
        let results = state
            .cache
            .try_get_or_set(&key, ttl, || async move {
                let data = if text.is_empty() {
                    klipy(
                        &st,
                        "featured",
                        &[("limit", limit.to_string()), ("locale", loc)],
                    )
                    .await?
                } else {
                    klipy(
                        &st,
                        "search",
                        &[("q", text), ("limit", limit.to_string()), ("locale", loc)],
                    )
                    .await?
                };
                map_results(&data)
            })
            .await;
        match results {
            Ok(r) => Ok(with_cache_control(
                json!({ "results": r }),
                "private, max-age=300",
            )),
            Err(e) => gif_response(e),
        }
    }
    .await;
    finish(out, c.counted)
}

/// `GET /api/gifs/categories?locale=`.
pub async fn categories(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    parts: Parts,
    body: Bytes,
) -> Response {
    let c = prelude_or_return!(state, parts, body, true, Some((&GIFS, By::User)));
    let out = async {
        let loc = locale(query.as_deref());
        let st = state.clone();
        let key = format!("gifs:categories:{loc}");
        let tags = state
            .cache
            .try_get_or_set(&key, 6 * 3600, || async move {
                let data = klipy(&st, "categories", &[("locale", loc)]).await?;
                map_tags(&data)
            })
            .await;
        match tags {
            Ok(t) => Ok(with_cache_control(
                json!({ "tags": t }),
                "private, max-age=3600",
            )),
            Err(e) => gif_response(e),
        }
    }
    .await;
    finish(out, c.counted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(v: Value) -> Vec<Value> {
        map_results(&v).unwrap_or_else(|_| panic!("erro"))
    }

    #[test]
    fn map_results_igual_ao_node() {
        let data = json!({ "results": [
            { "id": 1, "media_formats": { "tinygif": { "url": "t", "dims": [10, 20] }, "gif": { "url": "g", "dims": [100, 200] } } },
            { "id": "2", "media_formats": { "gif": { "url": "g2", "dims": [0, 5] } } },
            { "id": 3, "media_formats": { "tinygif": { "url": "t3" } } },
            { "media_formats": { "tinygif": { "url": "" }, "gif": { "url": "g4", "dims": "ab" } } },
            { "id": 5 },
        ]});
        assert_eq!(
            ok(data),
            vec![
                json!({ "id": 1, "preview": "t", "full": "g", "width": 10, "height": 20 }),
                json!({ "id": "2", "preview": "g2", "full": "g2", "width": null, "height": 5 }),
                json!({ "preview": "g4", "full": "g4", "width": "a", "height": "b" }),
            ]
        );
        assert!(ok(json!(null)).is_empty());
        assert!(ok(json!({ "results": "" })).is_empty());
        assert!(matches!(
            map_results(&json!({ "results": "x" })),
            Err(GifError::Upstream)
        ));
        assert!(matches!(
            map_results(&json!({ "results": [null] })),
            Err(GifError::Upstream)
        ));
        assert!(matches!(
            map_results(&json!({ "results": {} })),
            Err(GifError::Upstream)
        ));
    }

    #[test]
    fn tags_igual_ao_node() {
        let many: Vec<Value> = (0..20).map(|i| json!({ "name": i, "x": 1 })).collect();
        let t = map_tags(&json!({ "tags": many })).unwrap_or_default();
        assert_eq!(t.len(), 12);
        assert_eq!(t[0], json!({ "name": 0 }));
        assert_eq!(
            map_tags(&json!({ "tags": [5] })).ok(),
            Some(vec![json!({})])
        );
        assert!(matches!(
            map_tags(&json!({ "tags": "abc" })),
            Err(GifError::Upstream)
        ));
    }
}
