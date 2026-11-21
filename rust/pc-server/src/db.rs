//! Banco MySQL — o mesmo do Node (`DATABASE_URL`), sem Prisma.
//!
//! Convenções do Prisma que o Rust precisa seguir pra o Node e o Rust
//! lerem/gravarem a mesma coisa:
//! - datas são gravadas em **UTC** (DATETIME(3)) e saem no JSON como
//!   `2026-11-21T12:00:00.000Z` ([`iso`]);
//! - campos `@updatedAt` (ex.: `User.updatedAt`) são atualizados à mão em
//!   todo UPDATE ([`now`]);
//! - ids `@default(uuid())` são UUID v4 gerados aqui ([`new_id`]).

use chrono::{NaiveDateTime, Utc};
use serde_json::{Map, Number, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::{ConnectOptions, Executor, Row};
use std::str::FromStr;

pub type Db = MySqlPool;

/// Pool que conecta na hora do primeiro uso (o servidor sobe mesmo com o
/// banco fora do ar, igual ao Node).
pub fn connect_lazy(url: &str) -> anyhow::Result<Db> {
    let opts = MySqlConnectOptions::from_str(url)?.log_statements(tracing::log::LevelFilter::Trace);
    Ok(MySqlPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(std::time::Duration::from_secs(10))
        // sessão em UTC: CURRENT_TIMESTAMP e NOW() batem com o que o Prisma grava
        .after_connect(|conn, _| {
            Box::pin(async move {
                conn.execute("SET time_zone = '+00:00'").await?;
                Ok(())
            })
        })
        .connect_lazy_with(opts))
}

/// Agora, em UTC, com milissegundos (como o Prisma grava).
pub fn now() -> NaiveDateTime {
    let n = Utc::now().naive_utc();
    n.with_nanosecond_ms()
}

trait TruncMs {
    fn with_nanosecond_ms(self) -> Self;
}
impl TruncMs for NaiveDateTime {
    fn with_nanosecond_ms(self) -> Self {
        use chrono::Timelike;
        let ns = self.nanosecond() / 1_000_000 * 1_000_000;
        self.with_nanosecond(ns).unwrap_or(self)
    }
}

/// Data no formato do `Date.toJSON()` do JavaScript.
pub fn iso(d: NaiveDateTime) -> String {
    d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Número como o `JSON.stringify` do JavaScript escreve: `1.0` vira `1`.
pub fn js_number(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 {
        Value::Number(Number::from(f as i64))
    } else {
        Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null)
    }
}

/// Tipo de uma coluna pra montar o JSON igual ao Prisma.
#[derive(Clone, Copy, Debug)]
pub enum Ty {
    Str,
    Int,
    Float,
    Bool,
    Date,
}

/// Lê `col` da linha como o Prisma devolveria (null quando NULL).
pub fn col(row: &MySqlRow, col: &str, ty: Ty) -> Result<Value, sqlx::Error> {
    Ok(match ty {
        Ty::Str => row
            .try_get::<Option<String>, _>(col)?
            .map(Value::String)
            .unwrap_or(Value::Null),
        Ty::Int => row
            .try_get::<Option<i64>, _>(col)?
            .map(|v| Value::Number(v.into()))
            .unwrap_or(Value::Null),
        Ty::Float => row
            .try_get::<Option<f64>, _>(col)?
            .map(js_number)
            .unwrap_or(Value::Null),
        Ty::Bool => row
            .try_get::<Option<bool>, _>(col)?
            .map(Value::Bool)
            .unwrap_or(Value::Null),
        Ty::Date => row
            .try_get::<Option<NaiveDateTime>, _>(col)?
            .map(|d| Value::String(iso(d)))
            .unwrap_or(Value::Null),
    })
}

/// Monta um objeto JSON com as colunas listadas (`(nome no JSON, coluna, tipo)`).
pub fn object(
    row: &MySqlRow,
    fields: &[(&str, &str, Ty)],
) -> Result<Map<String, Value>, sqlx::Error> {
    let mut out = Map::with_capacity(fields.len());
    for (key, column, ty) in fields {
        out.insert((*key).to_string(), col(row, column, *ty)?);
    }
    Ok(out)
}

/// Erro de chave única duplicada (o P2002 do Prisma).
pub fn is_unique_violation(err: &sqlx::Error) -> bool {
    matches!(err, sqlx::Error::Database(e) if e.is_unique_violation())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn data_igual_ao_javascript() {
        let d = NaiveDate::from_ymd_opt(2026, 11, 21)
            .unwrap()
            .and_hms_milli_opt(12, 3, 4, 50)
            .unwrap();
        assert_eq!(iso(d), "2026-11-21T12:03:04.050Z");
    }

    #[test]
    fn numero_igual_ao_javascript() {
        assert_eq!(js_number(1.0).to_string(), "1");
        assert_eq!(js_number(1.25).to_string(), "1.25");
        assert_eq!(js_number(-3.0).to_string(), "-3");
    }

    #[test]
    fn agora_tem_so_milissegundos() {
        use chrono::Timelike;
        assert_eq!(now().nanosecond() % 1_000_000, 0);
    }
}
