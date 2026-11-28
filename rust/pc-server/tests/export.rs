//! Exportar meus dados (LGPD): o JSON tem o que é da pessoa, sem segredos.

mod common;

use std::time::Duration;

use common::{SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::Value;
use sqlx::Executor;

#[tokio::test]
async fn exporta_sem_segredos() {
    let Some(env) = setup().await else { return };
    if env.redis_url.is_none() {
        return;
    }
    add_user(
        &env.db,
        "eu",
        ", twoFactorSecret, chatZoom|, 'SEGREDO', 1.25",
    )
    .await;
    add_user(&env.db, "amigo", "").await;
    add_user(&env.db, "estranho", "").await;
    for sql in [
        "INSERT INTO Friendship (id, requesterId, addresseeId, status, createdAt, updatedAt) VALUES ('f1', 'amigo', 'eu', 'ACCEPTED', '2026-03-01 10:00:00.000', UTC_TIMESTAMP(3))",
        "INSERT INTO Friendship (id, requesterId, addresseeId, status, createdAt, updatedAt) VALUES ('f2', 'eu', 'estranho', 'PENDING', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        "INSERT INTO Message (id, content, authorId, createdAt, updatedAt) VALUES ('m1', 'oi', 'eu', '2026-03-02 10:00:00.000', UTC_TIMESTAMP(3))",
        "INSERT INTO Message (id, content, authorId, deleted, createdAt, updatedAt) VALUES ('m2', 'apagada', 'eu', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        "INSERT INTO Attachment (id, messageId, url, filename, mimeType, size) VALUES ('a1', 'm1', '/u/x.png', 'x.png', 'image/png', 10)",
    ] {
        if let Err(e) = env.db.execute(sql).await {
            panic!("{sql}: {e}");
        }
    }
    let r = reqwest::Client::new()
        .get(format!("http://{}/api/auth/export-data", env.gw))
        .header("x-forwarded-for", "10.77.0.1")
        .bearer_auth(Tokens::new(SECRET).sign("eu", Duration::from_secs(900)))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let h = r.headers().clone();
    assert_eq!(h["content-type"], "application/json; charset=utf-8");
    assert_eq!(h["cache-control"], "no-store");
    assert_eq!(h["x-ratelimit-limit"], "50");
    let cd = h["content-disposition"].to_str().unwrap();
    assert!(
        cd.starts_with("attachment; filename=\"projectclub-dados-eu-20"),
        "{cd}"
    );
    let text = r.text().await.unwrap();
    assert!(
        text.starts_with("{\n  \"exportedAt\": \""),
        "JSON com 2 espaços, como o Node"
    );
    let v: Value = serde_json::from_str(&text).unwrap();

    let account = v["account"].as_object().unwrap();
    assert_eq!(account.keys().next().map(String::as_str), Some("id"));
    // os campos seguem a ordem do schema mesmo tirando os segredos
    let keys: Vec<&str> = account.keys().map(String::as_str).collect();
    let pos = |k: &str| keys.iter().position(|x| *x == k).unwrap();
    assert_eq!(pos("displayName") + 1, pos("avatarUrl"));
    assert_eq!(keys.last(), Some(&"selfDeactivatedAt"));
    assert!(!account.contains_key("passwordHash"));
    assert!(!account.contains_key("twoFactorSecret"));
    assert_eq!(account["chatZoom"], 1.25);
    assert_eq!(account["interfaceZoom"], 1);
    assert_eq!(account["emailVerified"], false);
    assert!(account["createdAt"].as_str().unwrap().ends_with('Z'));

    assert_eq!(v["friends"].as_array().unwrap().len(), 1);
    assert_eq!(v["friends"][0]["id"], "amigo");
    assert_eq!(v["friends"][0]["since"], "2026-03-01T10:00:00.000Z");
    assert!(v["friends"][0].get("email").is_none());

    let msgs = v["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 1, "a apagada não vai");
    assert_eq!(
        msgs[0].as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "id",
            "content",
            "channelId",
            "conversationId",
            "createdAt",
            "edited",
            "pinned",
            "attachments"
        ]
    );
    assert_eq!(msgs[0]["attachments"][0]["filename"], "x.png");
    assert_eq!(msgs[0]["attachments"][0]["size"], 10);
    assert_eq!(v["settings"], Value::Null);
    assert_eq!(v["games"]["playtime"], serde_json::json!([]));
    assert_eq!(v["counts"]["messages"], 1);
    assert_eq!(v["counts"]["friends"], 1);
}
