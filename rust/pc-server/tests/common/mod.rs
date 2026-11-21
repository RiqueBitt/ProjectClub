//! Ambiente dos testes de banco: um MySQL novo por teste com o esquema do
//! Prisma, e o servidor Rust apontando pra ele.
//!
//! `PC_TEST_DATABASE_URL` (ex.: `mysql://root@127.0.0.1:3306`) liga os
//! testes de banco; `PC_TEST_REDIS_URL` liga o Redis (sem ele, as partes que
//! dependem do Redis se comportam como o Node sem Redis).

#![allow(dead_code)]

use std::net::SocketAddr;

use pc_server::config::Config;
use pc_server::{AppState, app};
use sqlx::{Executor, MySqlPool};

pub const SECRET: &str = "segredo-de-teste";
/// O mesmo usado nos selos de exemplo gerados pelo Node (`tests/fixtures`).
pub const REFRESH_SECRET: &str = "segredo";

pub struct Env {
    pub gw: SocketAddr,
    pub db: MySqlPool,
    pub redis_url: Option<String>,
}

pub async fn setup() -> Option<Env> {
    setup_with(|c| c).await
}

/// Igual ao `setup`, mas deixa ajustar a configuração (ex.: apontar o
/// "Node" pra um servidor de mentira).
pub async fn setup_with(adjust: impl FnOnce(Config) -> Config) -> Option<Env> {
    let Ok(base) = std::env::var("PC_TEST_DATABASE_URL") else {
        eprintln!("PC_TEST_DATABASE_URL não definida — pulando teste de banco");
        return None;
    };
    let base = base.trim_end_matches('/').to_string();
    let name = format!("pc_test_{}", uuid::Uuid::new_v4().simple());
    let admin = MySqlPool::connect(&base).await.unwrap();
    admin
        .execute(format!("CREATE DATABASE `{name}`").as_str())
        .await
        .unwrap();
    let url = format!("{base}/{name}");
    let db = MySqlPool::connect(&url).await.unwrap();
    db.execute("SET time_zone = '+00:00'").await.unwrap();
    sqlx::raw_sql(include_str!("../fixtures/schema.sql"))
        .execute(&db)
        .await
        .unwrap();

    let redis_url = std::env::var("PC_TEST_REDIS_URL").ok();
    let config = adjust(Config {
        database_url: Some(url),
        jwt_access_secret: SECRET.into(),
        jwt_refresh_secret: REFRESH_SECRET.into(),
        redis_url: redis_url.clone(),
        ..Config::for_tests()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let gw = listener.local_addr().unwrap();
    let router = app(AppState::new(config).await.unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap()
    });
    Some(Env { gw, db, redis_url })
}

/// Conta mínima. `extra` = `", col1, col2|, val1, val2"`.
pub async fn add_user(db: &MySqlPool, id: &str, extra: &str) {
    let sql = format!(
        "INSERT INTO `User` (id, email, username, displayName, passwordHash, updatedAt, createdAt{cols}) \
         VALUES ('{id}', '{id}@x.com', '{id}', 'Nome {id}', 'hash', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3){vals})",
        cols = extra.split('|').next().unwrap_or(""),
        vals = extra.split('|').nth(1).unwrap_or(""),
    );
    db.execute(sql.as_str()).await.unwrap();
}
