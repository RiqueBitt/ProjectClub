const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const {
  channelKey, categoryKey, parseOverrideBody, isEmptyOverride,
} = require('../services/notificationPrefs');

// Configurações de notificação por canal/categoria (silenciar + nível).
// Sempre da própria pessoa logada (req.user.id) — nunca aceita userId de fora.

const PUBLIC_FIELDS = {
  id: true, targetKey: true, channelId: true, categoryId: true, level: true, mutedUntil: true, muteForever: true, updatedAt: true,
};

// GET /api/notification-overrides — só as que ainda fazem efeito.
async function list(req, res, next) {
  try {
    const rows = await prisma.notificationOverride.findMany({ where: { userId: req.user.id }, select: PUBLIC_FIELDS });
    const now = Date.now();
    const alive = rows.filter((o) => !isEmptyOverride(o, now));
    // Silêncios que já expiraram e não têm mais nada: limpeza preguiçosa.
    const dead = rows.filter((o) => isEmptyOverride(o, now)).map((o) => o.id);
    if (dead.length) prisma.notificationOverride.deleteMany({ where: { id: { in: dead }, userId: req.user.id } }).catch(() => {});
    res.json({ overrides: alive });
  } catch (err) { next(err); }
}

// PUT /api/notification-overrides/:type/:id  { level?, mute? }
//   type: channel | category
//   level: 'ALL' | 'MENTIONS' | 'NONE' | null (herdar)
//   mute: { minutes: 15|60|480|1440 } | { forever: true } | null (reativar)
async function update(req, res, next) {
  try {
    const { type, id } = req.params;
    if (!['channel', 'category'].includes(type) || typeof id !== 'string' || id.length > 64) {
      return res.status(400).json({ error: 'Alvo inválido.' });
    }
    const parsed = parseOverrideBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    let targetKey;
    let link;
    if (type === 'channel') {
      const channel = await prisma.channel.findUnique({ where: { id } });
      if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
      const perms = await getEffectivePermissions(req.user.id, channel.id, channel).catch(() => null);
      if (!perms || !has(perms, 'VIEW_CHANNEL')) return res.status(404).json({ error: 'Canal não encontrado.' });
      targetKey = channelKey(id);
      link = { channelId: id };
    } else {
      const category = await prisma.category.findUnique({ where: { id }, select: { id: true } });
      if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
      targetKey = categoryKey(id);
      link = { categoryId: id };
    }

    const where = { userId_targetKey: { userId: req.user.id, targetKey } };
    const existing = await prisma.notificationOverride.findUnique({ where });
    const merged = { level: null, mutedUntil: null, muteForever: false, ...(existing || {}), ...parsed.data };

    let override = null;
    if (isEmptyOverride(merged)) {
      // Voltou tudo pro padrão: não guarda linha à toa.
      if (existing) await prisma.notificationOverride.deleteMany({ where: { userId: req.user.id, targetKey } });
    } else {
      override = await safeUpsert(prisma.notificationOverride, {
        where,
        update: parsed.data,
        create: {
          userId: req.user.id, targetKey, ...link,
          level: merged.level, mutedUntil: merged.mutedUntil, muteForever: merged.muteForever,
        },
        select: PUBLIC_FIELDS,
      });
    }

    const payload = { targetKey, override };
    // Sincroniza os outros aparelhos/abas da mesma conta na hora.
    req.app.get('io')?.to(`user:${req.user.id}`).emit('notification-override:update', payload);
    res.json(payload);
  } catch (err) { next(err); }
}

module.exports = { list, update };
