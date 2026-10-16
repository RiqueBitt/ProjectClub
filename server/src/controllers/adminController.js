const prisma = require('../config/prisma');
const sessionKeep = require('../services/sessionKeep');
const { SELF_USER_FIELDS } = require('./authController');

const ADMIN_USER_FIELDS = { ...SELF_USER_FIELDS, isPlatformBanned: true, platformBanReason: true, suspendedUntil: true };

function logPlatformAction(req, { action, targetType, targetId, reason, metadata }) {
  return prisma.platformAuditLog.create({
    data: {
      actorId: req.user.id, action, targetType, targetId, reason,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

// --- Configurações da comunidade (antes era CRUD de servidores) ---

async function getCommunitySettings(req, res, next) {
  try {
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
    });
    res.json({ settings });
  } catch (err) { next(err); }
}

async function updateCommunitySettings(req, res, next) {
  try {
    // Item pedido: "refaça esse sistema [de tag da comunidade]" —
    // communityTagText/Emoji adicionados à lista de campos editáveis,
    // pra staff poder configurar a tag de verdade em vez dela ficar
    // presa a derivar do nome da comunidade pra sempre.
    const allowed = ['communityName', 'communityIconUrl', 'communityBannerUrl', 'communityTagText', 'communityTagEmoji'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: data, create: { id: 'singleton', ...data },
    });
    await logPlatformAction(req, { action: 'COMMUNITY_EDIT', targetType: 'PLATFORM', targetId: 'singleton', metadata: data });
    req.app.get('io')?.to('community').emit('community:update', settings);
    res.json({ settings });
  } catch (err) { next(err); }
}

async function uploadCommunityIcon(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { communityIconUrl: req.file.url },
      create: { id: 'singleton', communityIconUrl: req.file.url },
    });
    req.app.get('io')?.to('community').emit('community:update', settings);
    res.json({ settings });
  } catch (err) { next(err); }
}

async function uploadCommunityBanner(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem.' });
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: { communityBannerUrl: req.file.url },
      create: { id: 'singleton', communityBannerUrl: req.file.url },
    });
    req.app.get('io')?.to('community').emit('community:update', settings);
    res.json({ settings });
  } catch (err) { next(err); }
}

// --- Toggles de sistema (adaptado do "disabled_systems" do bot Robbie —
// liga/desliga uma seção inteira pra toda a comunidade de uma vez). ---

const TOGGLEABLE_SYSTEMS = ['economia', 'rank', 'casas', 'cartas', 'cores_perfil', 'cargos'];

// "economia", "casas" e "figurinhas" nascem DESLIGADOS (só "rank" fica
// ativo por padrão) — pedido do dono da comunidade pra simplificar a
// interface sem apagar o código de nenhum dos sistemas. Isso só define o
// valor inicial da linha na primeira vez que ela é criada; a staff pode
// religar qualquer um deles a qualquer momento em /admin → Sistema.
// "cores_perfil" nasce LIGADO — o sistema de cor de perfil já existia e já
// funcionava antes desse toggle existir, então desligar ele por padrão
// tiraria uma opção que ninguém pediu pra tirar; esse toggle serve pra
// staff DESATIVAR quando quiser, não pra já nascer desativado.
// economia agora nasce LIGADA (round 5: virou categoria principal do menu).
const SYSTEMS_ENABLED_BY_DEFAULT = { economia: true, rank: true, casas: false, figurinhas: false, cartas: true, cores_perfil: true };

async function getSystemToggles(req, res, next) {
  try {
    // Garante que toda chave conhecida tenha uma linha (systems novos
    // começam com o valor de SYSTEMS_ENABLED_BY_DEFAULT).
    for (const key of TOGGLEABLE_SYSTEMS) {
      const defaultEnabled = SYSTEMS_ENABLED_BY_DEFAULT[key] !== false;
      await prisma.systemToggle.upsert({ where: { key }, update: {}, create: { key, enabled: defaultEnabled } });
    }
    const rows = await prisma.systemToggle.findMany({ where: { key: { in: TOGGLEABLE_SYSTEMS } } });
    const disabled = rows.filter((r) => !r.enabled).map((r) => r.key);
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' }, update: {}, create: { id: 'singleton' },
    });
    res.json({ disabledSystems: disabled, maintenanceMode: settings.maintenanceMode, availableSystems: TOGGLEABLE_SYSTEMS });
  } catch (err) { next(err); }
}

async function adminUpdateSystemToggles(req, res, next) {
  try {
    const { system, enabled } = req.body;
    if (!TOGGLEABLE_SYSTEMS.includes(system)) return res.status(400).json({ error: 'Sistema inválido.' });

    // UPDATE atômico numa linha PRÓPRIA — sem ler o estado de outros
    // sistemas primeiro, então não tem como um clique rápido em "casas"
    // apagar o que acabou de acontecer em "economia" (cada um mexe só
    // na sua própria linha, o banco cuida da atomicidade sozinho).
    await prisma.systemToggle.upsert({
      where: { key: system }, update: { enabled: !!enabled }, create: { key: system, enabled: !!enabled },
    });

    const rows = await prisma.systemToggle.findMany({ where: { key: { in: TOGGLEABLE_SYSTEMS } } });
    const disabled = rows.filter((r) => !r.enabled).map((r) => r.key);

    const updated = await prisma.platformSettings.update({
      where: { id: 'singleton' }, data: { disabledSystems: JSON.stringify(disabled) },
    });
    await logPlatformAction(req, { action: 'SYSTEM_TOGGLE', targetType: 'PLATFORM', targetId: system, metadata: { enabled: !!enabled } });
    req.app.get('io')?.to('community').emit('system:toggles-update', { disabledSystems: disabled });
    res.json({ disabledSystems: disabled });
  } catch (err) { next(err); }
}

// --- Users ---

async function listUsers(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ username: { contains: q } }, { displayName: { contains: q } }, { email: { contains: q } }] } : undefined,
      select: { ...ADMIN_USER_FIELDS, badges: { select: { badgeId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // Flatten to a plain array of badge ids per user — the client only
    // needs to know *which* badges someone has (to show a checkmark / let
    // the "Insígnias" menu below toggle grant vs revoke correctly), not
    // the join-table rows themselves.
    const shaped = users.map((u) => ({ ...u, badgeIds: u.badges.map((b) => b.badgeId), badges: undefined }));
    res.json({ users: shaped });
  } catch (err) { next(err); }
}

async function updateUserAdmin(req, res, next) {
  try {
    const { id } = req.params;
    const allowed = ['displayName', 'bio', 'pronouns', 'customStatus', 'profileColor', 'username'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    // Account Level (see utils/accountLevel.js on the client for the actual
    // shape/color rendering) — no upper bound baked in here since the
    // visual system itself is designed to keep cycling forever (new icon
    // shape every 100 levels, colors repeating within each).
    if (req.body.accountLevel !== undefined) {
      const lvl = parseInt(req.body.accountLevel, 10);
      if (Number.isFinite(lvl) && lvl >= 1) data.accountLevel = lvl;
    }

    const user = await prisma.user.update({ where: { id }, data, select: ADMIN_USER_FIELDS });
    await logPlatformAction(req, { action: 'USER_EDIT', targetType: 'USER', targetId: id, metadata: data });
    res.json({ user });
  } catch (err) { next(err); }
}

async function banUser(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const user = await prisma.user.update({
      where: { id }, data: { isPlatformBanned: true, platformBanReason: reason || null }, select: ADMIN_USER_FIELDS,
    });
    await prisma.refreshToken.updateMany({ where: { userId: id, revoked: false }, data: { revoked: true, revokedAt: new Date(), revokedReason: 'ADMIN' } });
    await sessionKeep.markSessionsRevoked(id);
    // Derruba os sockets abertos na hora (ver io.kickUser em sockets/index.js).
    req.app.get('io')?.kickUser?.(id, 'account:banned', { reason: reason || null });
    await logPlatformAction(req, { action: 'USER_BAN', targetType: 'USER', targetId: id, reason });
    res.json({ user });
  } catch (err) { next(err); }
}

async function unbanUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await prisma.user.update({
      where: { id }, data: { isPlatformBanned: false, platformBanReason: null }, select: ADMIN_USER_FIELDS,
    });
    await logPlatformAction(req, { action: 'USER_UNBAN', targetType: 'USER', targetId: id });
    res.json({ user });
  } catch (err) { next(err); }
}

async function suspendUser(req, res, next) {
  try {
    const { id } = req.params;
    const { hours, reason } = req.body;
    const suspendedUntil = new Date(Date.now() + (Number(hours) || 24) * 60 * 60 * 1000);
    const user = await prisma.user.update({ where: { id }, data: { suspendedUntil }, select: ADMIN_USER_FIELDS });
    await prisma.refreshToken.updateMany({ where: { userId: id, revoked: false }, data: { revoked: true, revokedAt: new Date(), revokedReason: 'ADMIN' } });
    await sessionKeep.markSessionsRevoked(id);
    req.app.get('io')?.kickUser?.(id, 'account:suspended', { suspendedUntil, reason: reason || null });
    await logPlatformAction(req, { action: 'USER_SUSPEND', targetType: 'USER', targetId: id, reason, metadata: { suspendedUntil } });
    res.json({ user });
  } catch (err) { next(err); }
}

async function unsuspendUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await prisma.user.update({ where: { id }, data: { suspendedUntil: null }, select: ADMIN_USER_FIELDS });
    await logPlatformAction(req, { action: 'USER_UNSUSPEND', targetType: 'USER', targetId: id });
    res.json({ user });
  } catch (err) { next(err); }
}

async function setPlatformRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!['USER', 'MODERATOR', 'ADMIN'].includes(role)) return res.status(400).json({ error: 'Cargo administrativo inválido.' });
    const user = await prisma.user.update({ where: { id }, data: { platformRole: role }, select: ADMIN_USER_FIELDS });
    await logPlatformAction(req, { action: 'USER_ROLE_CHANGE', targetType: 'USER', targetId: id, metadata: { role } });

    // Keeps the "Equipe" (STAFF) badge automatically in sync with platform
    // role instead of relying on someone remembering to grant/revoke it by
    // hand every time a role changes — granted the moment someone becomes
    // MODERATOR/ADMIN, revoked the moment they're demoted back to USER.
    const staffBadge = await prisma.badge.findUnique({ where: { key: 'STAFF' } }).catch(() => null);
    if (staffBadge) {
      if (role === 'USER') {
        await prisma.userBadge.deleteMany({ where: { userId: id, badgeId: staffBadge.id } });
      } else {
        await prisma.userBadge.upsert({
          where: { userId_badgeId: { userId: id, badgeId: staffBadge.id } },
          update: {}, create: { userId: id, badgeId: staffBadge.id },
        });
      }
    }
    res.json({ user });
  } catch (err) { next(err); }
}

// --- Badges ---

async function listBadges(req, res, next) {
  try {
    const badges = await prisma.badge.findMany({ orderBy: { priority: 'asc' } });
    res.json({ badges });
  } catch (err) { next(err); }
}

async function grantBadge(req, res, next) {
  try {
    const { id: userId } = req.params;
    const { badgeId } = req.body;
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId } }, update: {}, create: { userId, badgeId },
    });
    await logPlatformAction(req, { action: 'BADGE_GRANT', targetType: 'USER', targetId: userId, metadata: { badgeId } });
    // Merge in awardedAt (lives on the UserBadge row, not the Badge) so the
    // date shows up right away in the admin table and on the user's own
    // badge browser modal — same fix as getUser in userController.js.
    const badges = await prisma.userBadge.findMany({ where: { userId }, include: { badge: true } });
    res.json({ badges: badges.map((b) => ({ ...b.badge, awardedAt: b.awardedAt })) });
  } catch (err) { next(err); }
}

async function revokeBadge(req, res, next) {
  try {
    const { id: userId, badgeId } = req.params;
    await prisma.userBadge.deleteMany({ where: { userId, badgeId } });
    await logPlatformAction(req, { action: 'BADGE_REVOKE', targetType: 'USER', targetId: userId, metadata: { badgeId } });
    const badges = await prisma.userBadge.findMany({ where: { userId }, include: { badge: true } });
    res.json({ badges: badges.map((b) => ({ ...b.badge, awardedAt: b.awardedAt })) });
  } catch (err) { next(err); }
}

// --- Badge catalog management (create/edit/delete the badge *types*
// themselves — distinct from grantBadge/revokeBadge above, which assign an
// existing badge to a specific user). Previously the only way to add a new
// badge was editing prisma/seed.js by hand; this exposes the same thing
// through the admin panel. ---

const BADGE_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

async function createBadgeType(req, res, next) {
  try {
    const { key, description, rarity, ageYears, priority } = req.body;
    const name = String(req.body.name || '').trim();
    // Ícone emoji agora é opcional (padrão 🏅) — a UI permite escolher uma
    // imagem na criação, enviada logo depois com o id da insígnia nova.
    const icon = String(req.body.icon || '').trim() || '🏅';
    if (!name) return res.status(400).json({ error: 'Dê um nome para a insígnia.' });
    // Chave opcional: se vier vazia, gera a partir do nome (sem acentos).
    const rawKey = String(key || '').trim() || name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedKey = rawKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!normalizedKey) return res.status(400).json({ error: 'Chave inválida — use letras, números ou _.' });

    const existing = await prisma.badge.findUnique({ where: { key: normalizedKey } });
    if (existing) return res.status(409).json({ error: 'Já existe uma insígnia com essa chave.' });

    const parsedAgeYears = ageYears !== undefined && ageYears !== null && ageYears !== '' ? parseInt(ageYears, 10) : null;
    const parsedPriority = priority !== undefined && priority !== null && priority !== '' ? parseInt(priority, 10) : 0;
    const badge = await prisma.badge.create({
      data: {
        key: normalizedKey, name: name.slice(0, 60), description: description || null, icon: icon.slice(0, 8),
        rarity: BADGE_RARITIES.includes(rarity) ? rarity : 'COMMON',
        ageYears: Number.isFinite(parsedAgeYears) && parsedAgeYears > 0 ? parsedAgeYears : null,
        priority: Number.isFinite(parsedPriority) ? parsedPriority : 0,
      },
    });
    await logPlatformAction(req, { action: 'BADGE_TYPE_CREATE', targetType: 'BADGE', targetId: badge.id, metadata: { key: badge.key } });
    res.status(201).json({ badge });
  } catch (err) { next(err); }
}

async function updateBadgeType(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.badge.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Insígnia não encontrada.' });

    const data = {};
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description || null;
    if (req.body.icon !== undefined) data.icon = String(req.body.icon || '').trim().slice(0, 8) || '🏅';
    if (req.body.rarity !== undefined && BADGE_RARITIES.includes(req.body.rarity)) data.rarity = req.body.rarity;
    // Explicit null clears a previously-uploaded image icon, reverting to
    // just the emoji (see uploadBadgeIcon below for setting one).
    if (req.body.iconUrl === null) data.iconUrl = null;
    if (req.body.ageYears !== undefined) {
      const parsed = req.body.ageYears === null || req.body.ageYears === '' ? null : parseInt(req.body.ageYears, 10);
      data.ageYears = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (req.body.priority !== undefined) {
      const parsed = parseInt(req.body.priority, 10);
      data.priority = Number.isFinite(parsed) ? parsed : 0;
    }

    const badge = await prisma.badge.update({ where: { id }, data });
    await logPlatformAction(req, { action: 'BADGE_TYPE_UPDATE', targetType: 'BADGE', targetId: id, metadata: data });
    res.json({ badge });
  } catch (err) { next(err); }
}

// POST /admin/badges/:id/icon — an actual uploaded image for the badge,
// shown instead of the plain emoji glyph wherever it's displayed (see
// utils/badgeRarity.js's badgeIcon helper on the client). Same
// upload-after-create pattern as a user's own avatar/banner.
async function uploadBadgeIcon(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const existing = await prisma.badge.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Insígnia não encontrada.' });
    const iconUrl = req.file.url;
    const badge = await prisma.badge.update({ where: { id }, data: { iconUrl } });
    await logPlatformAction(req, { action: 'BADGE_TYPE_UPDATE', targetType: 'BADGE', targetId: id, metadata: { iconUrl } });
    res.json({ badge });
  } catch (err) { next(err); }
}

async function deleteBadgeType(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.badge.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Insígnia não encontrada.' });
    // Protects the badges the platform itself depends on for automatic
    // behavior (see adminBootstrap.js / setPlatformRole above) from being
    // deleted by accident, which would silently break that automation.
    if (['STAFF', 'PLATFORM_OWNER', 'NEWCOMER'].includes(existing.key)) {
      return res.status(400).json({ error: 'Esta insígnia é usada automaticamente pela plataforma e não pode ser excluída.' });
    }
    await prisma.badge.delete({ where: { id } });
    await logPlatformAction(req, { action: 'BADGE_TYPE_DELETE', targetType: 'BADGE', targetId: id, metadata: { key: existing.key } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Stats & logs ---

async function getStats(req, res, next) {
  try {
    const DAY = 24 * 60 * 60 * 1000;
    // Filas de pendências do painel: uma contagem que falhar (ex.: tabela
    // de um sistema desligado) vira 0, sem derrubar o painel inteiro.
    const safe = (p) => p.catch(() => 0);
    const [
      userCount, messageCount, bannedCount, last24h, last7d,
      pendingApplications, pendingReports, pendingAutomodFlags, pendingModReports,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.message.count(),
      prisma.user.count({ where: { isPlatformBanned: true } }),
      prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - DAY) } } }),
      prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * DAY) } } }),
      safe(prisma.membershipApplication.count({ where: { status: 'PENDING' } })),
      safe(prisma.report.count({ where: { status: 'PENDING' } })),
      safe(prisma.automodFlag.count({ where: { status: 'PENDING' } })),
      safe(prisma.modReport.count({ where: { status: 'PENDING' } })),
    ]);
    res.json({
      stats: {
        userCount, messageCount, bannedCount, newUsersLast24h: last24h, newUsersLast7d: last7d,
        pendingApplications, pendingReports, pendingAutomodFlags, pendingModReports,
      },
    });
  } catch (err) { next(err); }
}

// GET /admin/metrics — números da comunidade pro painel da staff.
async function getMetrics(req, res, next) {
  try {
    const { dayKey } = require('../services/activeDays');
    const DAY = 86400000;
    const now = Date.now();
    const days = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now - (29 - i) * DAY)));
    const since30 = new Date(now - 30 * DAY);
    const safe = (p, fb) => p.catch(() => fb);
    const [activeRows, wau, mau, signups, totals, ledger, shopRows, cohort] = await Promise.all([
      safe(prisma.userActiveDay.groupBy({ by: ['day'], where: { day: { gte: days[0] } }, _count: { _all: true } }), []),
      safe(prisma.userActiveDay.groupBy({ by: ['userId'], where: { day: { gte: days[23] } } }), []),
      safe(prisma.userActiveDay.groupBy({ by: ['userId'], where: { day: { gte: days[0] } } }), []),
      prisma.user.findMany({ where: { createdAt: { gte: since30 } }, select: { createdAt: true } }),
      prisma.user.aggregate({ _sum: { gems: true, coins: true } }),
      safe(prisma.economyTransaction.findMany({ where: { createdAt: { gte: since30 } }, select: { gems: true, coins: true } }), []),
      safe(prisma.economyTransaction.groupBy({
        by: ['label'], where: { kind: 'SHOP', createdAt: { gte: since30 } },
        _count: { _all: true }, _sum: { coins: true, gems: true },
        orderBy: { _count: { label: 'desc' } }, take: 10,
      }), []),
      // Retenção: quem entrou 8–14 dias atrás e voltou nos últimos 7 dias.
      prisma.user.findMany({ where: { createdAt: { gte: new Date(now - 14 * DAY), lt: new Date(now - 7 * DAY) } }, select: { id: true } }),
    ]);
    const activeByDay = Object.fromEntries(activeRows.map((r) => [r.day, r._count._all]));
    const signByDay = {};
    signups.forEach((u) => { const k = dayKey(u.createdAt); signByDay[k] = (signByDay[k] || 0) + 1; });
    let retained = 0;
    if (cohort.length) {
      const back = await safe(prisma.userActiveDay.groupBy({ by: ['userId'], where: { userId: { in: cohort.map((c) => c.id) }, day: { gte: days[23] } } }), []);
      retained = back.length;
    }
    const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
    res.json({
      series: days.map((d) => ({ day: d, active: activeByDay[d] || 0, signups: signByDay[d] || 0 })),
      dau: activeByDay[days[29]] || 0, wau: wau.length, mau: mau.length,
      retention: { cohort: cohort.length, retained, pct: cohort.length ? Math.round((retained / cohort.length) * 100) : null },
      economy: {
        gemsInCirculation: totals._sum.gems || 0, coinsInCirculation: totals._sum.coins || 0,
        gemsEarned30d: sum(ledger, (r) => (r.gems > 0 ? r.gems : 0)), gemsSpent30d: -sum(ledger, (r) => (r.gems < 0 ? r.gems : 0)),
        coinsEarned30d: sum(ledger, (r) => (r.coins > 0 ? r.coins : 0)), coinsSpent30d: -sum(ledger, (r) => (r.coins < 0 ? r.coins : 0)),
      },
      topShop: shopRows.map((r) => ({
        name: String(r.label || '').replace(/^Loja:\s*/, ''), sales: r._count._all,
        coins: -(r._sum.coins || 0), gems: -(r._sum.gems || 0),
      })),
    });
  } catch (err) { next(err); }
}

// GET /admin/audit-log?q=&action=&before= — com filtro e "carregar mais".
async function listAuditLog(req, res, next) {
  try {
    const where = {};
    const action = String(req.query.action || '').trim().slice(0, 60);
    if (action) where.action = { contains: action.toUpperCase() };
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) {
      const actors = await prisma.user.findMany({ where: { OR: [{ username: { contains: q } }, { displayName: { contains: q } }] }, select: { id: true }, take: 50 });
      where.OR = [{ actorId: { in: actors.map((a) => a.id) } }, { targetId: q }, { reason: { contains: q } }];
    }
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
    const logs = await prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    const actorIds = [...new Set(logs.map((l) => l.actorId))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, username: true } });
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    res.json({
      hasMore: logs.length === 100,
      logs: logs.map((l) => ({ ...l, metadata: l.metadata ? JSON.parse(l.metadata) : null, actor: actorMap.get(l.actorId) || null })),
    });
  } catch (err) { next(err); }
}

// POST /admin/maintenance — "Em reforma": toggled live, no restart needed
// (see middleware/auth.js's requireAuth, which is what actually enforces
// this on every request). ADMIN only, not MODERATOR — this is disruptive
// enough platform-wide that it stays reserved for the top role.
async function setMaintenanceMode(req, res, next) {
  try {
    if (req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
    const { enabled, message } = req.body;
    const settings = await prisma.platformSettings.upsert({
      where: { id: 'singleton' },
      update: { maintenanceMode: !!enabled, maintenanceMessage: message ?? undefined },
      create: { id: 'singleton', maintenanceMode: !!enabled, maintenanceMessage: message || null },
    });
    await logPlatformAction(req, { action: enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', targetType: 'PLATFORM', targetId: 'singleton' });
    res.json({ maintenanceMode: settings.maintenanceMode, maintenanceMessage: settings.maintenanceMessage });
  } catch (err) { next(err); }
}

// GET /admin/users/:id/security-info — confidential, ADMIN-only (this whole
// router is already gated that way — see routes/admin.js). Not shown to
// the account owner themselves or anyone else: IP addresses in particular
// are sensitive enough that even the person they belong to doesn't see
// this view of their own account, only platform staff investigating abuse
// (ban evasion via alts sharing an IP, etc).
async function getUserSecurityInfo(req, res, next) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, publicId: true, username: true, displayName: true, email: true, emailVerified: true,
        createdAt: true, twoFactorEnabled: true, isPlatformBanned: true, platformBanReason: true, suspendedUntil: true,
        failedLoginAttempts: true, loginLockedUntil: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    // Every session (active or expired/revoked) this account has ever had
    // — each one is a distinct login, with whatever IP/device made it.
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, revoked: true },
    });

    // Distinct IPs this account has logged in from — the actual "for
    // investigating alts/ban evasion" payoff: a staff member can cross-
    // reference this against another account's list and see any overlap.
    const distinctIps = [...new Set(sessions.map((s) => s.ipAddress).filter(Boolean))];

    // Other accounts that have EVER logged in from any of those same IPs —
    // the direct "is this the same person as that other banned account"
    // check, without needing to manually compare lists by hand.
    let sharedIpAccounts = [];
    if (distinctIps.length > 0) {
      const others = await prisma.refreshToken.findMany({
        where: { ipAddress: { in: distinctIps }, userId: { not: id } },
        select: { ipAddress: true, user: { select: { id: true, publicId: true, username: true, displayName: true, isPlatformBanned: true } } },
        distinct: ['userId'],
      });
      sharedIpAccounts = others.map((o) => ({ ...o.user, sharedIp: o.ipAddress }));
    }

    res.json({ user, sessions, distinctIps, sharedIpAccounts });
  } catch (err) { next(err); }
}

// --- Nível/XP (adaptado dos comandos !add_xp e !set_level do bot Robbie) ---

async function setUserLevel(req, res, next) {
  try {
    const { id } = req.params;
    const { level } = req.body;
    const { LEVELS } = require('../data/levelsCatalog');
    const target = Math.max(1, Math.min(200, parseInt(level, 10) || 1));
    const tier = [...LEVELS].reverse().find((l) => l.level <= target) || LEVELS[0];

    const user = await prisma.user.update({
      where: { id }, data: { accountLevel: tier.level, accountXp: tier.minXp },
      select: { id: true, accountLevel: true, accountXp: true },
    });
    await logPlatformAction(req, { action: 'USER_SET_LEVEL', targetType: 'USER', targetId: id, metadata: { level: tier.level } });
    req.app.get('io')?.to('community').emit('user:update', { id: user.id, accountLevel: user.accountLevel });
    require('../services/achievements').checkAndUnlock(id, req.app.get('io')); // veterano / lenda_viva
    res.json({ user });
  } catch (err) { next(err); }
}

async function addUserXp(req, res, next) {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    const { calculateLevel } = require('../data/levelsCatalog');
    const delta = parseInt(amount, 10) || 0;

    const existing = await prisma.user.findUnique({ where: { id }, select: { accountXp: true } });
    const newXp = Math.max(0, existing.accountXp + delta);
    const newLevelData = calculateLevel(newXp);

    const user = await prisma.user.update({
      where: { id }, data: { accountXp: newXp, accountLevel: newLevelData.level },
      select: { id: true, accountLevel: true, accountXp: true },
    });
    await logPlatformAction(req, { action: 'USER_ADD_XP', targetType: 'USER', targetId: id, metadata: { amount: delta } });
    req.app.get('io')?.to('community').emit('user:update', { id: user.id, accountLevel: user.accountLevel });
    require('../services/achievements').checkAndUnlock(id, req.app.get('io')); // veterano / lenda_viva
    res.json({ user });
  } catch (err) { next(err); }
}

// --- Moedas/Gemas (staff pode ajustar saldo manualmente, ex: correção de
// erro ou recompensa avulsa — mesmo padrão do addUserXp acima) ---

async function addUserCurrency(req, res, next) {
  try {
    const { id } = req.params;
    const coinsDelta = parseInt(req.body.coins, 10) || 0;
    const gemsDelta = parseInt(req.body.gems, 10) || 0;
    if (coinsDelta === 0 && gemsDelta === 0) return res.status(400).json({ error: 'Informe um valor de moedas ou gemas.' });

    const existing = await prisma.user.findUnique({ where: { id }, select: { coins: true, gems: true } });
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const newCoins = Math.max(0, existing.coins + coinsDelta);
    const newGems = Math.max(0, existing.gems + gemsDelta);

    const user = await prisma.user.update({
      where: { id }, data: { coins: newCoins, gems: newGems },
      select: { id: true, coins: true, gems: true },
    });
    await logPlatformAction(req, { action: 'USER_ADD_CURRENCY', targetType: 'USER', targetId: id, metadata: { coinsDelta, gemsDelta } });
    require('../services/economyLedger').recordTransaction(id, { kind: 'ADMIN', label: 'Ajuste da equipe', coins: newCoins - existing.coins, gems: newGems - existing.gems });
    req.app.get('io')?.to('community').emit('user:update', { id: user.id, coins: user.coins, gems: user.gems });
    const { checkAndUnlock } = require('../services/achievements');
    await checkAndUnlock(id, req.app.get('io'));
    res.json({ user });
  } catch (err) { next(err); }
}

async function listAutomodFlags(req, res, next) {
  try {
    const { status } = req.query;
    const flags = await prisma.automodFlag.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        message: { select: { id: true, createdAt: true } },
      },
    });
    // Junta os nomes de quem mandou/recebeu — não precisa expor mais nada
    // do perfil deles aqui, só o suficiente pra staff identificar o caso.
    const userIds = Array.from(new Set(flags.flatMap((f) => [f.senderId, f.recipientId])));
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true } });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    res.json({
      flags: flags.map((f) => ({ ...f, sender: userMap[f.senderId], recipient: userMap[f.recipientId] })),
    });
  } catch (err) { next(err); }
}

// Visualização SECRETA da conversa inteira entre os dois envolvidos num
// caso sinalizado. Deliberadamente reusa só a query de leitura de
// mensagens (messageInclude do messageController) sem passar por
// assertAccess (a staff não é membro da conversa) e sem chamar markRead
// nem entrar na sala do socket da conversa — os dois usuários nunca ficam
// sabendo que a staff está olhando. Fica só um registro no log de
// auditoria (visível apenas pra outra staff, nunca pros dois usuários),
// como salvaguarda contra abuso.
async function getFlaggedConversation(req, res, next) {
  try {
    const { id } = req.params;
    const flag = await prisma.automodFlag.findUnique({ where: { id } });
    if (!flag) return res.status(404).json({ error: 'Sinalização não encontrada.' });

    const { messageInclude } = require('./messageController');
    const messages = await prisma.message.findMany({
      where: { conversationId: flag.conversationId, deleted: false },
      include: messageInclude,
      orderBy: { createdAt: 'asc' },
    });

    await logPlatformAction(req, {
      action: 'AUTOMOD_FLAG_REVIEW', targetType: 'AUTOMOD_FLAG', targetId: id,
      metadata: { conversationId: flag.conversationId },
    });

    res.json({ flag, messages });
  } catch (err) { next(err); }
}

async function resolveAutomodFlag(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIONED' | 'DISMISSED'
    if (!['ACTIONED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });

    const flag = await prisma.automodFlag.update({
      where: { id },
      data: { status, reviewedById: req.user.id, reviewedAt: new Date() },
    });
    await logPlatformAction(req, { action: 'AUTOMOD_FLAG_RESOLVE', targetType: 'AUTOMOD_FLAG', targetId: id, metadata: { status } });
    res.json({ flag });
  } catch (err) { next(err); }
}

// --- Denúncias manuais (ver controllers/reportController.js pra criação)
// — mesmo padrão de 3 funções acima (listar/ver caso/resolver), só que
// pra denúncia feita por usuário em vez de detecção automática.

async function listReports(req, res, next) {
  try {
    const { status } = req.query;
    const reports = await prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const userIds = Array.from(new Set(reports.flatMap((r) => [r.reporterId, r.reportedUserId])));
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true } });
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    res.json({
      reports: reports.map((r) => ({ ...r, reporter: userMap[r.reporterId], reportedUser: userMap[r.reportedUserId] })),
    });
  } catch (err) { next(err); }
}

// Mesmo cuidado de privacidade do getFlaggedConversation acima quando a
// denúncia é de uma DM (a staff normalmente não tem acesso a mensagens
// privadas — só passa a ter aqui, e só porque foi denunciada). Quando a
// denúncia é de canal público, a staff já teria acesso de qualquer forma
// (ver documento de privacidade), então não precisa do mesmo cuidado —
// mas ainda mostra o contexto ao redor pra facilitar a análise.
async function getReportedContext(req, res, next) {
  try {
    const { id } = req.params;
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ error: 'Denúncia não encontrada.' });

    // Denúncia de PERFIL: não tem conversa/canal — devolve o perfil atual
    // da pessoa denunciada (o snippet já guarda como ele estava na hora).
    // Sem esse desvio, a busca abaixo caía em `channelId: null` e listava
    // mensagens aleatórias.
    if (report.kind === 'PROFILE' || (!report.conversationId && !report.channelId)) {
      const { PUBLIC_USER_FIELDS } = require('./authController');
      const profile = await prisma.user.findUnique({ where: { id: report.reportedUserId }, select: PUBLIC_USER_FIELDS });
      return res.json({ report, messages: [], profile });
    }

    const { messageInclude } = require('./messageController');
    const where = report.conversationId
      ? { conversationId: report.conversationId, deleted: false }
      : { channelId: report.channelId, deleted: false };
    const messages = await prisma.message.findMany({
      where, include: messageInclude, orderBy: { createdAt: 'desc' }, take: 50,
    });
    messages.reverse();

    if (report.conversationId) {
      // Só registra no log de auditoria (visível só pra outra staff, nunca
      // pros usuários) quando é acesso a uma DM — mesma salvaguarda contra
      // abuso já usada em getFlaggedConversation.
      await logPlatformAction(req, {
        action: 'REPORT_REVIEW', targetType: 'REPORT', targetId: id,
        metadata: { conversationId: report.conversationId },
      });
    }

    res.json({ report, messages });
  } catch (err) { next(err); }
}

async function resolveReport(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'ACTIONED' | 'DISMISSED'
    if (!['ACTIONED', 'DISMISSED'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });

    const report = await prisma.report.update({
      where: { id },
      data: { status, reviewedById: req.user.id, reviewedAt: new Date() },
    });
    await logPlatformAction(req, { action: 'REPORT_RESOLVE', targetType: 'REPORT', targetId: id, metadata: { status } });
    res.json({ report });
  } catch (err) { next(err); }
}

// --- Sistema de segurança "isca" (honeypot) — ver middleware/honeypot.js
// pra como as rotas-isca funcionam. Aqui é só a visualização/gestão pela
// staff: quem tentou o quê, e desbloquear um IP manualmente se algum
// falso positivo acontecer (ex: IP compartilhado de uma rede grande).

async function listHoneypotHits(req, res, next) {
  try {
    const hits = await prisma.honeypotHit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ hits });
  } catch (err) { next(err); }
}

async function listBlockedIps(req, res, next) {
  try {
    const blocked = await prisma.blockedIp.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ blocked });
  } catch (err) { next(err); }
}

async function unblockIp(req, res, next) {
  try {
    const { ip } = req.params;
    await prisma.blockedIp.deleteMany({ where: { ip } });
    // Zera também a contagem recente (senão um único hit novo já
    // re-bloqueava na hora) e o cache em memória do blockedIpGuard.
    await prisma.honeypotHit.deleteMany({ where: { ip, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
    require('../middleware/honeypot').invalidateBlockedIpCache(ip);
    await logPlatformAction(req, { action: 'HONEYPOT_UNBLOCK_IP', targetType: 'IP', targetId: ip });
    res.json({ unblocked: true });
  } catch (err) { next(err); }
}

// "Reload User" (painel de staff → Reload) — ver o comentário completo em
// presenceStore.clearAll() e io.reloadAllUserPresence (sockets/index.js).
// ADMIN-only (mesmo padrão de setMaintenanceMode acima): afeta a
// experiência de TODO MUNDO conectado de uma vez, então fica reservado
// pro cargo mais alto. Só mexe em presença — nenhuma sessão, token ou
// dado de conta é tocado.
async function reloadUserPresence(req, res, next) {
  try {
    if (req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
    const cleared = await req.app.get('io')?.reloadAllUserPresence?.();
    await logPlatformAction(req, { action: 'RELOAD_USER_PRESENCE', targetType: 'PLATFORM', targetId: 'singleton', metadata: { cleared } });
    res.json({ ok: true, cleared: cleared || 0 });
  } catch (err) { next(err); }
}

// Excluir conta (item pedido) — apaga o usuário e TUDO que depende dele
// via onDelete: Cascade no schema (mensagens, posts, comentários, DMs,
// amizades, sessões, conquistas, votos, casas, figurinhas, etc — o
// schema inteiro já foi desenhado com cascade em cada relação que
// pertence de verdade a um usuário). Ação irreversível, por isso:
//   - Só ADMIN (o cargo mais alto), nunca MODERATOR.
//   - Não dá pra excluir a própria conta por aqui (evita se trancar fora
//     sem querer).
//   - Exige digitar o @usuário exato como confirmação (ver
//     UserActionsMenu.jsx no client) — não é só um "tem certeza?".
//   - Fica registrado no log de auditoria com o nome de quem tinha antes
//     de apagar (pra o registro continuar fazendo sentido mesmo depois
//     da conta não existir mais).
// A pessoa é desconectada de qualquer sessão ativa DEPOIS dos dados já
// terem sumido do banco — nunca antes, pra não ter uma janela onde ela
// ainda está "logada" com dados que já não existem mais.
async function deleteUserAccount(req, res, next) {
  try {
    if (req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Apenas administradores podem fazer isso.' });
    const { id } = req.params;
    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta por aqui.' });

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, displayName: true } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const { confirmUsername } = req.body;
    if (confirmUsername !== target.username) {
      return res.status(400).json({ error: 'O nome de usuário digitado não confere — exclusão cancelada por segurança.' });
    }

    await prisma.user.delete({ where: { id } });
    await logPlatformAction(req, {
      action: 'USER_DELETE_ACCOUNT', targetType: 'USER', targetId: id,
      metadata: { username: target.username, displayName: target.displayName },
    });

    const io = req.app.get('io');
    io?.notifyUser?.(id, 'account:deleted', {});
    await io?.disconnectUser?.(id);

    res.json({ deleted: true });
  } catch (err) { next(err); }
}

// ============================================================
// Staff: aba "Saúde" e busca rápida de usuário (painel da equipe)
// ============================================================
const os = require('os');
const presenceStore = require('../services/presenceStore');
const voiceStore = require('../services/voiceRoomStore');
const { recentErrors, errorStats } = require('../services/errorRing');

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => { setTimeout(() => reject(new Error(`sem resposta em ${ms}ms`)), ms).unref?.(); }),
  ]);
}

async function timed(fn, ms = 3000) {
  const start = process.hrtime.bigint();
  try {
    await withTimeout(Promise.resolve().then(fn), ms);
    return { ok: true, ms: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100 };
  } catch (err) {
    return { ok: false, ms: null, error: String(err?.message || err).slice(0, 160) };
  }
}

// GET /admin/health — números ao vivo do servidor. Tudo com tempo-limite
// e tolerante a falha: o Redis/banco fora do ar aparece como "falhou"
// na tela em vez de derrubar a resposta inteira.
async function getHealth(req, res, next) {
  try {
    const { redis } = require('../config/redis');
    const io = req.app.get('io');

    const [db, redisPing, onlineIds, statusRows, calls, voiceUsage, pushCounts] = await Promise.all([
      timed(() => prisma.$queryRaw`SELECT 1`),
      timed(() => redis.ping()),
      withTimeout(presenceStore.listOnlineUserIds(), 3000).catch(() => null),
      prisma.user.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []),
      withTimeout((async () => {
        const out = { channels: 0, dms: 0, clans: 0, participants: 0 };
        for (const roomId of await voiceStore.getActiveRoomIds()) {
          // eslint-disable-next-line no-await-in-loop
          const n = Object.keys((await voiceStore.getRoom(roomId)) || {}).length;
          if (!n) continue;
          out.participants += n;
          if (roomId.startsWith('dm:')) out.dms += 1;
          else if (roomId.startsWith('clan:')) out.clans += 1;
          else out.channels += 1;
        }
        return out;
      })(), 3000).catch(() => null),
      // Minutos de voz do mês por provedor (mesma fonte do painel de provedores).
      withTimeout((async () => {
        const providers = require('../services/voiceProviders');
        const usage = await require('../services/voiceUsage').getAllUsage();
        return providers.PROVIDER_ORDER.map((id) => {
          const meta = providers.PROVIDERS[id] || {};
          const limit = meta.unlimited ? null : providers.getDisplayLimit(id);
          return { id, label: meta.label || id, minutes: Math.round(usage[id] || 0), limit, unlimited: !!meta.unlimited };
        });
      })(), 3000).catch(() => null),
      withTimeout((async () => ({
        android: await prisma.pushToken.count(),
        web: await prisma.webPushSubscription.count().catch(() => 0),
      }))(), 3000).catch(() => null),
    ]);

    const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r._count._all]));
    const mem = process.memoryUsage();
    const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;

    res.json({
      at: new Date().toISOString(),
      presence: {
        online: onlineIds ? onlineIds.length : null,
        byStatus,
      },
      sockets: {
        // Conexões deste processo (hoje a plataforma roda numa instância só).
        connected: io ? io.of('/').sockets.size : 0,
        engineClients: io?.engine?.clientsCount ?? null,
      },
      calls,
      voiceUsage,
      push: pushCounts,
      db,
      redis: { ...redisPing, status: redis.status },
      process: {
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        rssMb: mb(mem.rss),
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
        externalMb: mb(mem.external),
        loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
        cpus: os.cpus()?.length || null,
        systemFreeMb: mb(os.freemem()),
        systemTotalMb: mb(os.totalmem()),
      },
      errors: { ...errorStats(), recent: recentErrors(20) },
    });
  } catch (err) { next(err); }
}

const STAFF_SEARCH_FIELDS = {
  id: true, publicId: true, username: true, displayName: true, email: true,
  avatarUrl: true, status: true, platformRole: true, createdAt: true,
  isPlatformBanned: true, suspendedUntil: true, timeoutUntil: true,
};

// GET /admin/staff/users/search?q= — busca rápida por nome, @usuário, id
// (interno ou público) ou e-mail. O roteador inteiro já é só pra ADMIN
// (ver middleware/platformAdmin.js), por isso o e-mail entra na busca.
async function staffSearchUsers(req, res, next) {
  try {
    const raw = String(req.query.q || '').trim().slice(0, 100);
    if (!raw) return res.json({ users: [] });
    const q = raw.replace(/^@/, '');
    const OR = [
      { username: { contains: q } },
      { displayName: { contains: q } },
      { email: { contains: q } },
      { id: raw },
      { publicId: q },
    ];
    const found = await prisma.user.findMany({ where: { OR }, select: STAFF_SEARCH_FIELDS, take: 25 });
    const lower = q.toLowerCase();
    const rank = (u) => {
      if (u.id === raw || u.publicId === q || u.username?.toLowerCase() === lower || u.email?.toLowerCase() === lower) return 0;
      if (u.username?.toLowerCase().startsWith(lower) || u.displayName?.toLowerCase().startsWith(lower)) return 1;
      return 2;
    };
    found.sort((a, b) => rank(a) - rank(b) || String(a.displayName).localeCompare(String(b.displayName)));
    const online = await Promise.all(found.map((u) => presenceStore.isOnline(u.id).catch(() => false)));
    res.json({ users: found.map((u, i) => ({ ...u, online: online[i] })) });
  } catch (err) { next(err); }
}

// GET /admin/staff/users/:id — ficha completa pra gaveta de detalhes:
// conta, punições (advertências, banimento da comunidade, silêncio,
// banimento/suspensão da plataforma), ações da equipe sobre a conta e
// denúncias recebidas. Cada parte falha sozinha sem derrubar as outras.
async function staffUserDetail(req, res, next) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { ...ADMIN_USER_FIELDS, ...STAFF_SEARCH_FIELDS, emailVerified: true, accountDisabledAt: true },
    });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const safe = (p, fallback) => p.catch(() => fallback);
    const [online, warnings, communityBan, platformLog, modLog, reports, reportCount, messageCount] = await Promise.all([
      presenceStore.isOnline(id).catch(() => false),
      safe(prisma.warning.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }), []),
      safe(prisma.ban.findUnique({ where: { userId: id } }), null),
      safe(prisma.platformAuditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: 'desc' }, take: 50 }), []),
      safe(prisma.auditLogEntry.findMany({ where: { targetId: id }, orderBy: { createdAt: 'desc' }, take: 50 }), []),
      safe(prisma.report.findMany({
        where: { reportedUserId: id }, orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, reason: true, snippet: true, status: true, createdAt: true, reporterId: true },
      }), []),
      safe(prisma.report.count({ where: { reportedUserId: id } }), 0),
      safe(prisma.message.count({ where: { authorId: id } }), null),
    ]);

    // Nomes de quem aplicou cada ação ("system" = filtro automático).
    const actorIds = new Set();
    warnings.forEach((w) => actorIds.add(w.moderatorId));
    if (communityBan) actorIds.add(communityBan.moderatorId);
    platformLog.forEach((l) => actorIds.add(l.actorId));
    modLog.forEach((l) => actorIds.add(l.actorId));
    actorIds.delete('system');
    const actors = actorIds.size
      ? await safe(prisma.user.findMany({ where: { id: { in: [...actorIds] } }, select: { id: true, displayName: true, username: true } }), [])
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    const by = (actorId) => (actorId === 'system' ? { id: 'system', displayName: 'Filtro automático' } : actorMap.get(actorId) || { id: actorId, displayName: 'Conta removida' });
    const parse = (m) => { try { return m ? JSON.parse(m) : null; } catch { return null; } };

    const history = [
      ...warnings.map((w) => ({ id: `w:${w.id}`, kind: 'warning', action: 'MEMBER_WARN', reason: w.reason, at: w.createdAt, by: by(w.moderatorId), warningId: w.id })),
      ...(communityBan ? [{ id: `b:${communityBan.id}`, kind: 'ban', action: 'MEMBER_BAN', reason: communityBan.reason, at: communityBan.createdAt, by: by(communityBan.moderatorId), active: true }] : []),
      ...modLog.filter((l) => l.action !== 'MEMBER_WARN' && l.action !== 'MEMBER_BAN').map((l) => ({ id: `m:${l.id}`, kind: 'community', action: l.action, reason: l.reason, at: l.createdAt, by: by(l.actorId), metadata: parse(l.metadata) })),
      ...platformLog.map((l) => ({ id: `p:${l.id}`, kind: 'platform', action: l.action, reason: l.reason, at: l.createdAt, by: by(l.actorId), metadata: parse(l.metadata) })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    res.json({
      user: { ...user, online },
      communityBan: communityBan ? { reason: communityBan.reason, at: communityBan.createdAt, by: by(communityBan.moderatorId) } : null,
      warningsCount: warnings.length,
      history,
      reports: { total: reportCount, recent: reports },
      messageCount,
    });
  } catch (err) { next(err); }
}

module.exports = {
  getCommunitySettings, updateCommunitySettings, uploadCommunityIcon, uploadCommunityBanner,
  listUsers, updateUserAdmin, banUser, unbanUser, suspendUser, unsuspendUser, setPlatformRole,
  listBadges, grantBadge, revokeBadge, createBadgeType, updateBadgeType, deleteBadgeType, uploadBadgeIcon,
  getStats, getMetrics, listAuditLog, setMaintenanceMode, getUserSecurityInfo,
  setUserLevel, addUserXp, addUserCurrency,
  getSystemToggles, adminUpdateSystemToggles,
  listAutomodFlags, getFlaggedConversation, resolveAutomodFlag,
  listReports, getReportedContext, resolveReport,
  listHoneypotHits, listBlockedIps, unblockIp,
  reloadUserPresence, deleteUserAccount,
  getHealth, staffSearchUsers, staffUserDetail,
  logPlatformAction,
};
