const prisma = require('../config/prisma');
const { requireCommunityPermission, getEffectivePermissions, ForbiddenError } = require('../services/authz');
const { has } = require('../services/permissions');
const { logAction, shapeAuditEntry } = require('../services/audit');
const { PUBLIC_USER_FIELDS } = require('./authController');

async function withUsers(records) {
  const ids = [...new Set(records.map((r) => r.userId))];
  if (ids.length === 0) return records.map((r) => ({ ...r, user: null }));
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER_FIELDS });
  const byId = new Map(users.map((u) => [u.id, u]));
  return records.map((r) => ({ ...r, user: byId.get(r.userId) || null }));
}

// --- Bans (agora da plataforma inteira, já que só existe uma comunidade) ---

async function listBans(req, res, next) {
  try {
    await requireCommunityPermission(req.user.id, 'BAN_MEMBERS');
    const bans = await prisma.ban.findMany({ orderBy: { createdAt: 'desc' } });
    const hydrated = await withUsers(bans);
    const moderatorIds = [...new Set(bans.map((b) => b.moderatorId))];
    const moderators = moderatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: moderatorIds } }, select: PUBLIC_USER_FIELDS })
      : [];
    const modById = new Map(moderators.map((m) => [m.id, m]));
    res.json({ bans: hydrated.map((b) => ({ ...b, moderator: modById.get(b.moderatorId) || null })) });
  } catch (err) { next(err); }
}

async function banMember(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason, deleteRecentMessages } = req.body || {};
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.platformRole === 'ADMIN') return res.status(400).json({ error: 'Não é possível banir um administrador.' });
    await requireCommunityPermission(req.user.id, 'BAN_MEMBERS');

    await prisma.ban.upsert({
      where: { userId },
      update: { reason: reason || null, moderatorId: req.user.id },
      create: { userId, reason: reason || null, moderatorId: req.user.id },
    });
    await prisma.user.update({ where: { id: userId }, data: { isPlatformBanned: true, platformBanReason: reason || null } });

    if (deleteRecentMessages) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.message.updateMany({
        where: { authorId: userId, createdAt: { gte: cutoff } },
        data: { deleted: true, content: null },
      });
    }

    const io = req.app.get('io');
    io?.notifyUser?.(userId, 'account:banned', { reason: reason || null });
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_BAN', targetType: 'MEMBER', targetId: userId, reason });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function unbanMember(req, res, next) {
  try {
    const { userId } = req.params;
    await requireCommunityPermission(req.user.id, 'BAN_MEMBERS');
    await prisma.ban.deleteMany({ where: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { isPlatformBanned: false, platformBanReason: null } });
    const io = req.app.get('io');
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_UNBAN', targetType: 'MEMBER', targetId: userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Timeouts ---

async function timeoutMember(req, res, next) {
  try {
    const { userId } = req.params;
    const { minutes, reason } = req.body || {};
    const mins = Math.min(Math.max(parseInt(minutes, 10) || 0, 1), 28 * 24 * 60);
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.platformRole === 'ADMIN') return res.status(400).json({ error: 'Não é possível silenciar um administrador.' });
    await requireCommunityPermission(req.user.id, 'MODERATE_MEMBERS');

    const timeoutUntil = new Date(Date.now() + mins * 60 * 1000);
    await prisma.user.update({ where: { id: userId }, data: { timeoutUntil } });
    const io = req.app.get('io');
    io?.notifyUser?.(userId, 'moderation:timeout', { timeoutUntil, reason: reason || null });
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_TIMEOUT', targetType: 'MEMBER', targetId: userId, reason, metadata: { minutes: mins } });
    res.json({ ok: true, timeoutUntil });
  } catch (err) { next(err); }
}

async function removeTimeout(req, res, next) {
  try {
    const { userId } = req.params;
    await requireCommunityPermission(req.user.id, 'MODERATE_MEMBERS');
    await prisma.user.update({ where: { id: userId }, data: { timeoutUntil: null } });
    const io = req.app.get('io');
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_TIMEOUT_REMOVE', targetType: 'MEMBER', targetId: userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Warnings ---

async function listWarnings(req, res, next) {
  try {
    const { userId } = req.params;
    await requireCommunityPermission(req.user.id, 'MODERATE_MEMBERS');
    const where = userId ? { userId } : {};
    const warnings = await prisma.warning.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ warnings: await withUsers(warnings) });
  } catch (err) { next(err); }
}

async function warnMember(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason } = req.body || {};
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Informe um motivo para a advertência.' });
    await requireCommunityPermission(req.user.id, 'MODERATE_MEMBERS');

    const warning = await prisma.warning.create({
      data: { userId, reason: reason.trim(), moderatorId: req.user.id },
    });
    const io = req.app.get('io');
    io?.notifyUser?.(userId, 'moderation:warning', { reason: reason.trim() });
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_WARN', targetType: 'MEMBER', targetId: userId, reason });
    res.status(201).json({ warning });
  } catch (err) { next(err); }
}

async function deleteWarning(req, res, next) {
  try {
    const { warningId } = req.params;
    await requireCommunityPermission(req.user.id, 'MODERATE_MEMBERS');
    const warning = await prisma.warning.findUnique({ where: { id: warningId } });
    if (!warning) return res.status(404).json({ error: 'Advertência não encontrada.' });

    await prisma.warning.delete({ where: { id: warningId } });
    const io = req.app.get('io');
    await logAction(io, { actorId: req.user.id, action: 'MEMBER_WARN_CLEAR', targetType: 'MEMBER', targetId: warning.userId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// --- Audit log (agora um único mural para a comunidade inteira) ---

async function listAuditLog(req, res, next) {
  try {
    const { cursor } = req.query;
    const perms = await getEffectivePermissions(req.user.id);
    if (!has(perms, 'MANAGE_COMMUNITY') && !has(perms, 'VIEW_AUDIT_LOG')) {
      throw new ForbiddenError();
    }
    const entries = await prisma.auditLogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const shaped = await withUsers(entries.map((e) => ({ ...shapeAuditEntry(e), userId: e.actorId })));
    res.json({
      entries: shaped.map(({ userId, user, ...rest }) => ({ ...rest, actor: user })),
      nextCursor: entries.length === 50 ? entries[entries.length - 1].id : null,
    });
  } catch (err) { next(err); }
}

module.exports = {
  listBans, banMember, unbanMember,
  timeoutMember, removeTimeout, listWarnings, warnMember, deleteWarning,
  listAuditLog,
};
