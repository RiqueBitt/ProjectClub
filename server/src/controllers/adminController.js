const prisma = require('../config/prisma');
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

const TOGGLEABLE_SYSTEMS = ['economia', 'rank', 'casas', 'figurinhas', 'cores_perfil', 'cargos'];

// "economia", "casas" e "figurinhas" nascem DESLIGADOS (só "rank" fica
// ativo por padrão) — pedido do dono da comunidade pra simplificar a
// interface sem apagar o código de nenhum dos sistemas. Isso só define o
// valor inicial da linha na primeira vez que ela é criada; a staff pode
// religar qualquer um deles a qualquer momento em /admin → Sistema.
// "cores_perfil" nasce LIGADO — o sistema de cor de perfil já existia e já
// funcionava antes desse toggle existir, então desligar ele por padrão
// tiraria uma opção que ninguém pediu pra tirar; esse toggle serve pra
// staff DESATIVAR quando quiser, não pra já nascer desativado.
const SYSTEMS_ENABLED_BY_DEFAULT = { economia: false, rank: true, casas: false, figurinhas: false, cores_perfil: true };

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
    await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
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
    await prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
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
    const { key, name, description, icon, rarity, ageYears, priority } = req.body;
    if (!key || !name || !icon) return res.status(400).json({ error: 'Chave, nome e ícone são obrigatórios.' });
    const normalizedKey = String(key).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40);
    if (!normalizedKey) return res.status(400).json({ error: 'Chave inválida.' });

    const existing = await prisma.badge.findUnique({ where: { key: normalizedKey } });
    if (existing) return res.status(409).json({ error: 'Já existe uma insígnia com essa chave.' });

    const parsedAgeYears = ageYears !== undefined && ageYears !== null && ageYears !== '' ? parseInt(ageYears, 10) : null;
    const parsedPriority = priority !== undefined && priority !== null && priority !== '' ? parseInt(priority, 10) : 0;
    const badge = await prisma.badge.create({
      data: {
        key: normalizedKey, name, description: description || null, icon: String(icon).slice(0, 8),
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
    if (req.body.icon !== undefined) data.icon = String(req.body.icon).slice(0, 8);
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
    const [userCount, messageCount, bannedCount, last24h] = await Promise.all([
      prisma.user.count(),
      prisma.message.count(),
      prisma.user.count({ where: { isPlatformBanned: true } }),
      prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);
    res.json({ stats: { userCount, messageCount, bannedCount, newUsersLast24h: last24h } });
  } catch (err) { next(err); }
}

async function listAuditLog(req, res, next) {
  try {
    const logs = await prisma.platformAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const actorIds = [...new Set(logs.map((l) => l.actorId))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, username: true } });
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    res.json({
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

module.exports = {
  getCommunitySettings, updateCommunitySettings, uploadCommunityIcon, uploadCommunityBanner,
  listUsers, updateUserAdmin, banUser, unbanUser, suspendUser, unsuspendUser, setPlatformRole,
  listBadges, grantBadge, revokeBadge, createBadgeType, updateBadgeType, deleteBadgeType, uploadBadgeIcon,
  getStats, listAuditLog, setMaintenanceMode, getUserSecurityInfo,
  setUserLevel, addUserXp, addUserCurrency,
  getSystemToggles, adminUpdateSystemToggles,
  listAutomodFlags, getFlaggedConversation, resolveAutomodFlag,
  listHoneypotHits, listBlockedIps, unblockIp,
  reloadUserPresence, deleteUserAccount,
};
