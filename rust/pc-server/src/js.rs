//! Comportamentos do JavaScript que mudam o resultado e por isso precisam
//! ser imitados ao pé da letra: ordem das chaves de objeto, números
//! (`1.0` é `1`) e `Number.isInteger`.

use serde_json::{Map, Number, Value};

/// Chave que o JS trata como índice de array (`"0"`, `"42"`, nunca `"01"`).
fn index_key(k: &str) -> Option<u32> {
    if k.is_empty() || (k.len() > 1 && k.starts_with('0')) || !k.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    k.parse::<u32>().ok().filter(|n| *n < u32::MAX)
}

/// Ordem de `Object.keys`: índices numéricos crescentes primeiro, depois o
/// resto na ordem em que entrou.
pub fn reorder(map: Map<String, Value>) -> Map<String, Value> {
    if !map.keys().any(|k| index_key(k).is_some()) {
        return map;
    }
    let mut idx: Vec<(u32, String, Value)> = Vec::new();
    let mut rest = Map::new();
    for (k, v) in map {
        match index_key(&k) {
            Some(n) => idx.push((n, k, v)),
            None => {
                rest.insert(k, v);
            }
        }
    }
    idx.sort_by_key(|(n, _, _)| *n);
    let mut out = Map::new();
    for (_, k, v) in idx {
        out.insert(k, v);
    }
    out.extend(rest);
    out
}

/// O valor como ficaria depois de `JSON.parse` no JS: número com parte
/// fracionária zero vira inteiro e as chaves seguem a ordem do JS.
pub fn normalize(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::Number(normalize_number(n)),
        Value::Array(a) => Value::Array(a.into_iter().map(normalize).collect()),
        Value::Object(m) => Value::Object(reorder(
            m.into_iter().map(|(k, v)| (k, normalize(v))).collect(),
        )),
        other => other,
    }
}

fn normalize_number(n: Number) -> Number {
    if n.is_i64() || n.is_u64() {
        return n;
    }
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 => Number::from(f as i64),
        _ => n,
    }
}

/// `JSON.stringify(v)` (compacto) do valor já normalizado.
pub fn stringify(v: &Value) -> String {
    normalize(v.clone()).to_string()
}

/// `JSON.parse(texto)`; `None` se o texto não for JSON.
pub fn parse(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok().map(normalize)
}

/// `Number.isInteger(v)`.
pub fn is_integer(v: &Value) -> bool {
    v.as_f64()
        .is_some_and(|f| f.is_finite() && f.fract() == 0.0)
}

/// Número inteiro do JS (`Number.isInteger`) como `i64`.
pub fn integer(v: &Value) -> Option<i64> {
    is_integer(v).then(|| v.as_f64().unwrap_or(0.0) as i64)
}

/// `v` é o número `n` (`[0, 50, 75].includes(v)`)?
pub fn is_num(v: &Value, n: f64) -> bool {
    v.as_f64() == Some(n)
}

/// Objeto "de verdade" (`!!v && typeof v === 'object' && !Array.isArray(v)`).
pub fn as_plain(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ordem_das_chaves_como_no_js() {
        let v = parse(r#"{"b":1,"10":2,"a":3,"2":4,"01":5}"#).unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["2", "10", "b", "a", "01"]);
    }

    #[test]
    fn numeros_como_no_js() {
        assert_eq!(
            stringify(&json!({ "a": 1.0, "b": 1.5, "c": [2.0] })),
            r#"{"a":1,"b":1.5,"c":[2]}"#
        );
        assert!(is_integer(&json!(5.0)));
        assert!(!is_integer(&json!(5.5)));
        assert!(!is_integer(&json!("5")));
    }
}
