const prisma = require('../config/prisma');
const sup = require('../services/supporters');
const { SELF_USER_FIELDS } = require('./authController');
const { broadcastUserUpdate } = require('./userController');

// Gerenciamento de Apoio (staff): concede/remove Assinante e Super
// Assinante. Quem fez a mudança vem SEMPRE de req.user (sessão), nunca do
// corpo. Toda mudança gera uma linha em SupporterAuditLog na mesma
// transação, e itens exclusivos que deixaram de valer são desequipados.

const USER_PICK = { id: true, publicId: true, username: true, displayName: true, avatarUrl: true, supporterTier: true, createdAt: true };
const idOf = (raw) => { try { return raw ? JSON.parse(raw).id || null : null; } catch { return null; } };

// GET /supporters/admin/users?q= — busca por nome, @ ou ID. Sem busca,
// lista quem tem alguma categoria (Super primeiro).
async function adminSearch(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const where = q
      ? { OR: [{ id: q }, { publicId: q }, { username: { contains: q.replace(/^@/, '') } }, { displayName: { contains: q } }] }
      : { supporterTier: { in: ['SUBSCRIBER', 'SUPER'] } };
    const users = await prisma.user.findMany({ where, select: USER_PICK, take: 40, orderBy: [{ supporterTier: 'desc' }, { displayName: 'asc' }] });
    const counts = await prisma.user.groupBy({ by: ['supporterTier'], _count: { _all: true }, where: { supporterTier: { in: ['SUBSCRIBER', 'SUPER'] } } }).catch(() => []);
    const total = Object.fromEntries(counts.map((c) => [c.supporterTier, c._count._all]));
    res.json({ users: users.map((u) => ({ ...u, supporterTier: sup.normalizeTier(u.supporterTier) })), totals: { SUBSCRIBER: total.SUBSCRIBER || 0, SUPER: total.SUPER || 0 } });
  } catch (err) { next(err); }
}

// GET /supporters/admin/history?userId=&before= — histórico (de uma pessoa ou geral).
async function adminHistory(req, res, next) {
  try {
    const where = {};
    if (req.query.userId) where.userId = String(req.query.userId);
    const before = req.query.before ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
    const take = 40;
    const rows = await prisma.supporterAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.actorId]))];
    const people = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true, avatarUrl: true } }) : [];
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    res.json({ entries: rows.map((r) => ({ ...r, user: byId[r.userId] || null, actor: byId[r.actorId] || null })), hasMore: rows.length === take });
  } catch (err) { next(err); }
}

// POST /supporters/admin/:userId { tier, reason }
async function adminSetTier(req, res, next) {
  try {
    const targetId = String(req.params.userId || '');
    const raw = String(req.body?.tier || '');
    if (!sup.TIERS.includes(raw)) return res.status(400).json({ error: 'Categoria inválida.' });
    const toTier = raw;
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (reason.length < 3) return res.status(400).json({ error: 'Escreva o motivo da alteração (fica no histórico).' });
    const actorId = req.user.id; // identidade autenticada — nunca do corpo

    let fromTier; let changed = false;
    await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, supporterTier: true, avatarDecoration: true, profileEffect: true } });
      if (!target) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
      fromTier = sup.normalizeTier(target.supporterTier);
      if (fromTier === toTier) return;
      changed = true;
      // Condicional no próprio update: duas pessoas da staff mexendo ao
      // mesmo tempo não sobrescrevem uma à outra sem perceber.
      const r = await tx.user.updateMany({ where: { id: targetId, supporterTier: target.supporterTier }, data: { supporterTier: toTier } });
      if (r.count === 0) throw Object.assign(new Error('A categoria dessa pessoa acabou de mudar. Atualize e tente de novo.'), { status: 409 });
      await tx.supporterAuditLog.create({ data: { userId: targetId, actorId, fromTier, toTier, reason } });

      // Perdeu categoria: tira do perfil exclusivos que não valem mais
      // (os comprados de verdade continuam; exclusivo nunca vira posse).
      if (sup.tierRank(toTier) < sup.tierRank(fromTier)) {
        const clear = {};
        const decoId = idOf(target.avatarDecoration);
        const fxId = idOf(target.profileEffect);
        if (decoId) {
          const [d, own] = await Promise.all([
            tx.avatarDecoration.findUnique({ where: { id: decoId }, select: { exclusiveTier: true } }),
            tx.userAvatarDecoration.findUnique({ where: { userId_decorationId: { userId: targetId, decorationId: decoId } } }),
          ]);
          if (d && sup.exclusiveOf(d) && !own && !sup.qualifiesFor(toTier, sup.exclusiveOf(d))) clear.avatarDecoration = null;
        }
        if (fxId) {
          const [f, own] = await Promise.all([
            tx.profileEffect.findUnique({ where: { id: fxId }, select: { exclusiveTier: true } }),
            tx.userProfileEffect.findUnique({ where: { userId_effectId: { userId: targetId, effectId: fxId } } }),
          ]);
          if (f && sup.exclusiveOf(f) && !own && !sup.qualifiesFor(toTier, sup.exclusiveOf(f))) clear.profileEffect = null;
        }
        if (Object.keys(clear).length) await tx.user.update({ where: { id: targetId }, data: clear });
      }
    });
    if (changed) {
      const user = await prisma.user.findUnique({ where: { id: targetId }, select: SELF_USER_FIELDS });
      if (user) await broadcastUserUpdate(req, user).catch(() => {});
    }
    res.json({ ok: true, changed, fromTier, toTier, label: sup.TIER_LABEL[toTier] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = { adminSearch, adminHistory, adminSetTier };
