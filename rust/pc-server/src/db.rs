//! Banco MySQL — o mesmo do Node (`DATABASE_URL`), sem Prisma.
//!
//! Driver: `mysql_async`, o mesmo motor que o Prisma usa por baixo. Em
//! produção o MySQL fica atrás de um intermediário da Shard Cloud (sem TLS,
//! que começa com `mysql_native_password` e troca de método no meio do
//! login); o `sqlx` levava "acesso negado" ali e o `mysql_async` entra igual
//! ao Prisma (testado no servidor de verdade com `pc-server check diag`).
//!
//! Convenções do Prisma que o Rust segue pra o Node e o Rust lerem/gravarem
//! a mesma coisa:
//! - datas gravadas em **UTC** (DATETIME(3)), no JSON como
//!   `2026-11-21T12:00:00.000Z` ([`iso`]);
//! - campos `@updatedAt` (ex.: `User.updatedAt`) atualizados à mão ([`now`]);
//! - ids `@default(uuid())` são UUID v4 ([`new_id`]).

use std::fmt;

use chrono::{NaiveDateTime, Timelike, Utc};
use mysql_async::prelude::{FromValue, Queryable};
use mysql_async::{Opts, OptsBuilder, PoolConstraints, PoolOpts};
use serde_json::{Map, Number, Value as Json};

pub use mysql_async::Row;
pub use mysql_async::Value;

pub type Db = mysql_async::Pool;

/// Erro de banco: do driver, ou de uma coluna com tipo inesperado.
#[derive(Debug)]
pub enum DbError {
    Driver(mysql_async::Error),
    Column(String),
    /// Não conseguiu uma conexão a tempo (banco travado ou pool cheio).
    Busy,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Driver(e) => write!(f, "{e}"),
            DbError::Column(c) => write!(f, "coluna {c}: tipo inesperado ou ausente"),
            DbError::Busy => write!(f, "sem conexão livre com o banco em {CONN_WAIT_SECS}s"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<mysql_async::Error> for DbError {
    fn from(e: mysql_async::Error) -> Self {
        DbError::Driver(e)
    }
}

pub type DbResult<T> = Result<T, DbError>;

/// Lista de parâmetros posicionais: `params![a, b, c]`.
#[macro_export]
macro_rules! params {
    ($($v:expr),* $(,)?) => { vec![$($crate::db::Value::from($v)),*] };
}

/// Pool que conecta na hora do primeiro uso (o servidor sobe mesmo com o
/// banco fora do ar, igual ao Node). Cada conexão começa em UTC.
pub fn connect_lazy(url: &str) -> anyhow::Result<Db> {
    let opts = OptsBuilder::from_opts(Opts::from_url(url)?)
        .init(vec!["SET time_zone = '+00:00'"])
        .pool_opts(
            PoolOpts::default()
                .with_constraints(PoolConstraints::new(0, 10).expect("limites do pool")),
        );
    Ok(mysql_async::Pool::new(opts))
}

/// Quanto esperar por uma conexão do pool (o Prisma do Node espera 10 s).
const CONN_WAIT_SECS: u64 = 10;

/// Pega uma conexão do pool, com prazo: com o banco travado (ou as 10
/// conexões ocupadas) o pedido ficava esperando sem limite. Agora desiste
/// em 10 s com erro — e leitura que dá erro no Rust é respondida pelo Node.
pub async fn conn(db: &Db) -> DbResult<mysql_async::Conn> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(CONN_WAIT_SECS),
        db.get_conn(),
    )
    .await
    {
        Ok(c) => Ok(c?),
        Err(_) => Err(DbError::Busy),
    }
}

/// Primeira linha (ou nenhuma).
pub async fn first(db: &Db, sql: &str, params: Vec<Value>) -> DbResult<Option<Row>> {
    let mut c = conn(db).await?;
    Ok(c.exec_first(sql, params).await?)
}

/// Todas as linhas.
pub async fn all(db: &Db, sql: &str, params: Vec<Value>) -> DbResult<Vec<Row>> {
    let mut c = conn(db).await?;
    Ok(c.exec(sql, params).await?)
}

/// INSERT/UPDATE/DELETE — devolve quantas linhas mudaram.
pub async fn exec(db: &Db, sql: &str, params: Vec<Value>) -> DbResult<u64> {
    let mut c = conn(db).await?;
    c.exec_drop(sql, params).await?;
    Ok(c.affected_rows())
}

/// Vários comandos numa transação (o `prisma.$transaction([...])`): ou
/// todos valem, ou nenhum.
pub async fn transaction(db: &Db, steps: Vec<(&str, Vec<Value>)>) -> DbResult<()> {
    let mut conn = conn(db).await?;
    let mut tx = conn
        .start_transaction(mysql_async::TxOpts::default())
        .await?;
    for (sql, params) in steps {
        tx.exec_drop(sql, params).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Um valor só (primeira coluna da primeira linha).
pub async fn scalar<T: FromValue>(db: &Db, sql: &str, params: Vec<Value>) -> DbResult<Option<T>> {
    match first(db, sql, params).await? {
        Some(row) => Ok(Some(get_idx(&row, 0)?)),
        None => Ok(None),
    }
}

/// Primeira coluna de todas as linhas.
pub async fn column<T: FromValue>(db: &Db, sql: &str, params: Vec<Value>) -> DbResult<Vec<T>> {
    all(db, sql, params)
        .await?
        .iter()
        .map(|r| get_idx(r, 0))
        .collect()
}

/// Coluna `name` da linha, convertida pra `T` (`Option<T>` aceita NULL).
pub fn get<T: FromValue>(row: &Row, name: &str) -> DbResult<T> {
    match row.get_opt::<T, _>(name) {
        Some(Ok(v)) => Ok(v),
        _ => Err(DbError::Column(name.to_string())),
    }
}

fn get_idx<T: FromValue>(row: &Row, i: usize) -> DbResult<T> {
    match row.get_opt::<T, _>(i) {
        Some(Ok(v)) => Ok(v),
        _ => Err(DbError::Column(format!("#{i}"))),
    }
}

/// Agora, em UTC, com milissegundos (como o Prisma grava).
pub fn now() -> NaiveDateTime {
    let n = Utc::now().naive_utc();
    n.with_nanosecond(n.nanosecond() / 1_000_000 * 1_000_000)
        .unwrap_or(n)
}

/// Data no formato do `Date.toJSON()` do JavaScript.
pub fn iso(d: NaiveDateTime) -> String {
    d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Número como o `JSON.stringify` do JavaScript escreve: `1.0` vira `1`.
pub fn js_number(f: f64) -> Json {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 {
        Json::Number(Number::from(f as i64))
    } else {
        Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null)
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
pub fn col(row: &Row, col: &str, ty: Ty) -> DbResult<Json> {
    Ok(match ty {
        Ty::Str => get::<Option<String>>(row, col)?
            .map(Json::String)
            .unwrap_or(Json::Null),
        Ty::Int => get::<Option<i64>>(row, col)?
            .map(|v| Json::Number(v.into()))
            .unwrap_or(Json::Null),
        Ty::Float => get::<Option<f64>>(row, col)?
            .map(js_number)
            .unwrap_or(Json::Null),
        Ty::Bool => get::<Option<bool>>(row, col)?
            .map(Json::Bool)
            .unwrap_or(Json::Null),
        Ty::Date => get::<Option<NaiveDateTime>>(row, col)?
            .map(|d| Json::String(iso(d)))
            .unwrap_or(Json::Null),
    })
}

/// Monta um objeto JSON com as colunas listadas (`(nome no JSON, coluna, tipo)`).
pub fn object(row: &Row, fields: &[(&str, &str, Ty)]) -> DbResult<Map<String, Json>> {
    let mut out = Map::with_capacity(fields.len());
    for (key, column, ty) in fields {
        out.insert((*key).to_string(), col(row, column, *ty)?);
    }
    Ok(out)
}

/// Erro de chave única duplicada (o P2002 do Prisma; MySQL 1062).
pub fn is_unique_violation(err: &DbError) -> bool {
    matches!(err, DbError::Driver(mysql_async::Error::Server(e)) if e.code == 1062)
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
        assert_eq!(now().nanosecond() % 1_000_000, 0);
    }

    #[test]
    fn parametros() {
        let v: Vec<Value> = params!["a", 1i64, true, None::<String>];
        assert_eq!(v.len(), 4);
        assert_eq!(v[3], Value::NULL);
    }
}
