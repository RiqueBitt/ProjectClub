//! Linha inteira de uma tabela no JSON que o Prisma devolve: campos na
//! ordem do `schema.prisma`, `Boolean` como `true/false`, datas em ISO com
//! milissegundos, `Float` como número do JavaScript (1.0 → 1).
//!
//! A ordem dos campos vem do próprio `server/prisma/schema.prisma`
//! (embutido na compilação), então fica sempre igual ao Node.

use std::collections::HashMap;
use std::sync::LazyLock;

use chrono::NaiveDateTime;
use mysql_async::consts::ColumnType;
use mysql_async::{Row, Value as My};
use serde_json::{Map, Value};

use crate::db;

const SCHEMA: &str = include_str!("../../../server/prisma/schema.prisma");
const SCALARS: [&str; 9] = [
    "String", "Int", "Float", "Boolean", "DateTime", "BigInt", "Decimal", "Json", "Bytes",
];

/// Modelo → campos escalares (colunas), na ordem do schema.
static FIELDS: LazyLock<HashMap<String, Vec<String>>> = LazyLock::new(|| parse(SCHEMA));

fn parse(schema: &str) -> HashMap<String, Vec<String>> {
    let enums: Vec<&str> = schema
        .lines()
        .filter_map(|l| {
            let mut t = l.split_whitespace();
            (t.next() == Some("enum")).then(|| t.next()).flatten()
        })
        .collect();
    let mut out = HashMap::new();
    let mut current: Option<(String, Vec<String>)> = None;
    for line in schema.lines() {
        let line = line.trim();
        let mut t = line.split_whitespace();
        match (&mut current, t.next()) {
            (None, Some("model")) => {
                if let Some(name) = t.next() {
                    current = Some((name.to_string(), Vec::new()));
                }
            }
            (Some(_), Some("}")) => {
                let (name, fields) = current.take().unwrap_or_default();
                out.insert(name, fields);
            }
            (Some((_, fields)), Some(name))
                if !name.starts_with("//") && !name.starts_with("@@") =>
            {
                let Some(ty) = t.next() else { continue };
                if ty.ends_with("[]") {
                    continue;
                }
                let base = ty.trim_end_matches('?');
                if SCALARS.contains(&base) || enums.contains(&base) {
                    fields.push(name.to_string());
                }
            }
            _ => {}
        }
    }
    out
}

/// Os campos do modelo (vazio se não existir).
pub fn fields(model: &str) -> &'static [String] {
    FIELDS.get(model).map(Vec::as_slice).unwrap_or(&[])
}

/// Um valor do MySQL no JSON do Prisma, pelo tipo da coluna.
fn value(v: My, ty: ColumnType, len: u32) -> Value {
    if v == My::NULL {
        return Value::Null;
    }
    use ColumnType::*;
    match ty {
        MYSQL_TYPE_TINY if len == 1 => mysql_async::from_value_opt::<i64>(v)
            .map(|i| Value::Bool(i != 0))
            .unwrap_or(Value::Null),
        MYSQL_TYPE_DATETIME
        | MYSQL_TYPE_TIMESTAMP
        | MYSQL_TYPE_DATE
        | MYSQL_TYPE_DATETIME2
        | MYSQL_TYPE_TIMESTAMP2
        | MYSQL_TYPE_NEWDATE => mysql_async::from_value_opt::<NaiveDateTime>(v)
            .map(|d| Value::String(db::iso(d)))
            .unwrap_or(Value::Null),
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => mysql_async::from_value_opt::<f64>(v)
            .map(db::js_number)
            .unwrap_or(Value::Null),
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_LONG | MYSQL_TYPE_INT24
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => mysql_async::from_value_opt::<i64>(v)
            .map(Value::from)
            .unwrap_or(Value::Null),
        MYSQL_TYPE_JSON => mysql_async::from_value_opt::<String>(v)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null),
        _ => match v {
            My::Bytes(b) => Value::String(String::from_utf8_lossy(&b).into_owned()),
            other => mysql_async::from_value_opt::<String>(other)
                .map(Value::String)
                .unwrap_or(Value::Null),
        },
    }
}

/// A linha como o Prisma devolve num `findMany` sem `select`: os campos do
/// modelo, na ordem do schema (`SELECT *` da tabela do modelo).
pub fn row(model: &str, mut r: Row) -> Map<String, Value> {
    let cols: Vec<(String, ColumnType, u32)> = r
        .columns_ref()
        .iter()
        .map(|c| {
            (
                c.name_str().into_owned(),
                c.column_type(),
                c.column_length(),
            )
        })
        .collect();
    let mut by_name: HashMap<String, Value> = HashMap::with_capacity(cols.len());
    for (i, (name, ty, len)) in cols.iter().enumerate() {
        let v = r.take::<My, _>(i).unwrap_or(My::NULL);
        by_name.insert(name.clone(), value(v, *ty, *len));
    }
    let mut out = Map::new();
    for f in fields(model) {
        if let Some(v) = by_name.remove(f) {
            out.insert(f.clone(), v);
        }
    }
    // coluna que o schema embutido não conhece (não deve acontecer): no fim
    for (name, _, _) in cols {
        if let Some(v) = by_name.remove(&name) {
            out.insert(name, v);
        }
    }
    out
}

/// Só alguns campos (`select`), na ordem pedida.
pub fn pick(mut obj: Map<String, Value>, keys: &[&str]) -> Map<String, Value> {
    let mut out = Map::new();
    for k in keys {
        if let Some(v) = obj.remove(*k) {
            out.insert((*k).to_string(), v);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campos_do_schema() {
        let att = fields("Attachment");
        assert_eq!(
            att,
            [
                "id",
                "messageId",
                "url",
                "filename",
                "mimeType",
                "size",
                "isSpoiler"
            ]
        );
        // relação (`message Message`) e listas ficam de fora
        let user = fields("User");
        assert!(user.iter().any(|f| f == "passwordHash"));
        assert!(user.iter().all(|f| f != "messages"));
        assert_eq!(user.first().map(String::as_str), Some("id"));
    }

    #[test]
    fn enum_conta_como_campo() {
        let m = parse(
            "enum Cor {\n  AZUL\n}\nmodel A {\n  id String @id\n  cor Cor @default(AZUL)\n  b B?\n  @@index([id])\n}\n",
        );
        assert_eq!(m["A"], ["id", "cor"]);
    }
}
