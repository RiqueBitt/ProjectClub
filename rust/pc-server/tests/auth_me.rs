//! `requireAuth` + `GET /api/auth/me` num MySQL de verdade, com o esquema
//! do Prisma (`tests/fixtures/schema.sql`).
//!
//! Precisa de `PC_TEST_DATABASE_URL` (ex.: `mysql://root@127.0.0.1:3306`);
//! sem ela os testes só avisam e passam. Cada teste cria o próprio banco.

mod common;

use std::time::Duration;

use common::{Env, SECRET, add_user, setup};
use pc_server::auth::Tokens;
use serde_json::{Value, json};
use sqlx::Executor;

async fn me(env: &Env, user: Option<&str>) -> (u16, Value) {
    let mut req = reqwest::Client::new().get(format!("http://{}/api/auth/me", env.gw));
    if let Some(u) = user {
        req = req.bearer_auth(Tokens::new(SECRET).sign(u, Duration::from_secs(900)));
    }
    let r = req.send().await.unwrap();
    let status = r.status().as_u16();
    (
        status,
        serde_json::from_str(&r.text().await.unwrap()).unwrap(),
    )
}

#[tokio::test]
async fn sem_token_e_token_ruim() {
    let Some(env) = setup().await else { return };
    assert_eq!(
        me(&env, None).await,
        (401, json!({ "error": "Não autenticado." }))
    );
    let r = reqwest::Client::new()
        .get(format!("http://{}/api/auth/me", env.gw))
        .bearer_auth("lixo")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 401);
    assert_eq!(
        me(&env, Some("fantasma")).await,
        (401, json!({ "error": "Usuário não encontrado." }))
    );
}

#[tokio::test]
async fn me_completo() {
    let Some(env) = setup().await else { return };
    let db = &env.db;
    db.execute(
        "INSERT INTO ClanIcon (id, name, url, isDefault, createdAt) VALUES ('ic1', 'Escudo', '/i.png', 1, '2026-01-02 03:04:05.006'); \
         INSERT INTO Clan (id, name, iconId, iconColor) VALUES ('c1', 'Clã', 'ic1', '#ff0000'); \
         INSERT INTO ClanTag (id, clanId, tag) VALUES ('t1', 'c1', 'PC'); \
         INSERT INTO Pendant (id, name, iconUrl) VALUES ('p1', 'Lua', '/lua.png'); \
         INSERT INTO Badge (id, `key`, name, icon, ageYears) VALUES ('b2', 'age2', '2 anos', '*', 2), ('b5', 'age5', '5 anos', '*', 5), ('bx', 'x', 'x', '*', NULL);",
    )
    .await
    .unwrap();
    add_user(
        db,
        "u1",
        ", status, clanTagId, selectedPendantId, customStatus, customStatusExpiresAt, chatZoom, interfaceZoom|, 'INVISIBLE', 't1', 'p1', 'ocupado', '2020-01-01 00:00:00.000', 1.0, 1.25",
    )
    .await;
    // conta com ~3 anos
    db.execute(
        "UPDATE `User` SET createdAt = UTC_TIMESTAMP(3) - INTERVAL 1100 DAY WHERE id = 'u1'",
    )
    .await
    .unwrap();

    let (status, body) = me(&env, Some("u1")).await;
    assert_eq!(status, 200, "{body}");
    let u = &body["user"];
    // os mesmos campos, na mesma ordem, que o /api/auth/me do Node em produção
    // devolveu em 21/11/2026
    const NODE_KEYS: &str = "id publicId username displayName avatarUrl avatarDecoration profileEffect profileFont \
        profileStyle bannerUrl miniProfileBannerUrl bannerFraming miniProfileBannerFraming bio pronouns profileColor \
        status customStatus customStatusEmoji customStatusExpiresAt createdAt platformRole supporterTier tagEmoji \
        tagText youtubeUrl steamUrl robloxUrl xUrl profileNameFont profileNameEffect profileNameColor \
        profileNameColor2 profileNameColors accountLevel accountXp displayedAchievements displayedAchievementsMini \
        idCardUrl idCardFraming relationshipPartnerId profileSectionOrder levelBarColor profileSectionOpacity \
        miniProfileColor miniProfileButtonColor statusBubbleColor clanTag selectedPendant customPendantUrl email \
        emailVerified twoFactorEnabled isPlatformBanned platformBanReason suspendedUntil timeoutUntil \
        accountDisabledAt birthDate preferredTheme layoutStyle chatZoom interfaceZoom emojiStyle \
        friendRequestPrivacy usernameChangedAt";
    let keys: Vec<&str> = u.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, NODE_KEYS.split_whitespace().collect::<Vec<_>>());
    assert_eq!(
        body.as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["user"]
    );
    assert_eq!(u["id"], "u1");
    assert_eq!(u["email"], "u1@x.com");
    assert!(u.get("passwordHash").is_none());
    assert!(u.get("twoFactorSecret").is_none());
    assert_eq!(
        u["status"], "INVISIBLE",
        "a própria pessoa vê o próprio invisível"
    );
    assert_eq!(u["chatZoom"].to_string(), "1");
    assert_eq!(u["interfaceZoom"].to_string(), "1.25");
    assert_eq!(u["emailVerified"], false);
    assert_eq!(u["customStatus"], Value::Null);
    assert_eq!(u["customStatusExpiresAt"], Value::Null);
    assert_eq!(
        u["clanTag"],
        json!({ "tag": "PC", "clan": { "icon": { "id": "ic1", "name": "Escudo", "url": "/i.png", "createdAt": "2026-01-02T03:04:05.006Z", "isDefault": true }, "iconColor": "#ff0000" } })
    );
    assert_eq!(
        u["selectedPendant"],
        json!({ "id": "p1", "name": "Lua", "iconUrl": "/lua.png" })
    );
    let pid = u["publicId"].as_str().unwrap().to_string();
    assert_eq!(pid.len(), 9);

    // gravou no banco: publicId, insígnia de 2 anos (não a de 5), dia ativo, status limpo
    tokio::time::sleep(Duration::from_millis(300)).await;
    let saved: Option<String> = sqlx::query_scalar("SELECT publicId FROM `User` WHERE id='u1'")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(saved.as_deref(), Some(pid.as_str()));
    let badges: Vec<String> = sqlx::query_scalar("SELECT badgeId FROM UserBadge WHERE userId='u1'")
        .fetch_all(db)
        .await
        .unwrap();
    assert_eq!(badges, vec!["b2".to_string()]);
    let days: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM UserActiveDay WHERE userId='u1'")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(days, 1);
    let cs: Option<String> = sqlx::query_scalar("SELECT customStatus FROM `User` WHERE id='u1'")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(cs, None);

    // segunda vez: mesmo publicId, sem insígnia repetida
    let (_, body2) = me(&env, Some("u1")).await;
    assert_eq!(body2["user"]["publicId"], pid.as_str());
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM UserBadge WHERE userId='u1'")
        .fetch_one(db)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn banido_suspenso_desativado() {
    let Some(env) = setup().await else { return };
    add_user(
        &env.db,
        "ban",
        ", isPlatformBanned, platformBanReason|, 1, 'spam'",
    )
    .await;
    add_user(
        &env.db,
        "sus",
        ", suspendedUntil|, '2999-01-01 00:00:00.000'",
    )
    .await;
    add_user(&env.db, "des", ", accountDisabledAt|, UTC_TIMESTAMP(3)").await;
    add_user(
        &env.db,
        "ok",
        ", suspendedUntil|, '2001-01-01 00:00:00.000'",
    )
    .await;
    assert_eq!(
        me(&env, Some("ban")).await,
        (
            403,
            json!({ "error": "Sua conta foi banida da plataforma.", "platformBanned": true, "reason": "spam" })
        )
    );
    assert_eq!(
        me(&env, Some("sus")).await,
        (
            403,
            json!({ "error": "Sua conta está temporariamente suspensa.", "suspendedUntil": "2999-01-01T00:00:00.000Z" })
        )
    );
    assert_eq!(
        me(&env, Some("des")).await,
        (
            403,
            json!({ "error": "Essa conta foi desativada.", "accountDisabled": true })
        )
    );
    assert_eq!(
        me(&env, Some("ok")).await.0,
        200,
        "suspensão vencida não bloqueia"
    );
}

#[tokio::test]
async fn manutencao_so_deixa_a_staff() {
    let Some(env) = setup().await else { return };
    env.db
        .execute("INSERT INTO PlatformSettings (id, maintenanceMode) VALUES ('singleton', 1)")
        .await
        .unwrap();
    add_user(&env.db, "comum", "").await;
    add_user(&env.db, "mod", ", platformRole|, 'MODERATOR'").await;
    assert_eq!(
        me(&env, Some("comum")).await,
        (
            503,
            json!({ "error": "A plataforma está em manutenção no momento.", "maintenance": true })
        )
    );
    assert_eq!(me(&env, Some("mod")).await.0, 200);
}
