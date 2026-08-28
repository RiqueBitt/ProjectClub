const prisma = require('../config/prisma');
const { assertManageChannels } = require('./categoryController');
const { getEveryoneRole } = require('../services/authz');
const { toStringBits, PERMISSIONS } = require('../services/permissions');

const VALID_TYPES = ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'RULES'];
function clampUserLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 99);
}
const SLOW_MODE_SECONDS_OPTIONS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
function clampSlowMode(value, channelType) {
  if (value === undefined || value === null || value === '') return null;
  if (channelType === 'VOICE' || channelType === 'STAGE') return null;
  const n = parseInt(value, 10);
  if (!SLOW_MODE_SECONDS_OPTIONS.includes(n)) return null;
  return n;
}
function clampTopic(value) {
  if (value === undefined || value === null) return value;
  return String(value).slice(0, 500);
}

async function createChannel(req, res, next) {
  try {
    const { name, type, categoryId, topic, isPrivate, userLimit } = req.body;
    await assertManageChannels(req.user.id);
    const count = await prisma.channel.count({ where: { categoryId: categoryId || null } });
    const channel = await prisma.channel.create({
      data: {
        name,
        type: VALID_TYPES.includes(type) ? type : 'TEXT',
        categoryId: categoryId || null,
        topic: clampTopic(topic),
        position: count,
        isPrivate: !!isPrivate,
        userLimit: clampUserLimit(userLimit),
      },
    });

    if (channel.isPrivate) {
      const everyoneRole = await getEveryoneRole();
      const denyView = toStringBits(PERMISSIONS.VIEW_CHANNEL);
      const allowView = toStringBits(PERMISSIONS.VIEW_CHANNEL);
      await prisma.$transaction([
        ...(everyoneRole ? [prisma.permissionOverwrite.create({
          data: { channelId: channel.id, targetType: 'ROLE', targetId: everyoneRole.id, deny: denyView },
        })] : []),
        prisma.permissionOverwrite.create({
          data: { channelId: channel.id, targetType: 'MEMBER', targetId: req.user.id, allow: allowView },
        }),
      ]);
    }

    req.app.get('io')?.to('community').emit('channel:new', { id: channel.id });
    res.status(201).json({ channel });
  } catch (err) { next(err); }
}

async function updateChannel(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const existing = await prisma.channel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Canal não encontrado.' });
    const allowed = ['name', 'topic', 'categoryId', 'rulesContent', 'rulesTitle'];
    const data = {};
    for (const key of allowed) if (req.body[key] !== undefined) data[key] = req.body[key];
    if (data.topic !== undefined) data.topic = clampTopic(data.topic);
    if (req.body.type !== undefined && VALID_TYPES.includes(req.body.type)) data.type = req.body.type;
    if (req.body.userLimit !== undefined) data.userLimit = clampUserLimit(req.body.userLimit);
    if (req.body.slowModeSeconds !== undefined) data.slowModeSeconds = clampSlowMode(req.body.slowModeSeconds, req.body.type || existing.type);

    if (req.body.isPrivate !== undefined) {
      const wasPrivate = existing.isPrivate;
      data.isPrivate = !!req.body.isPrivate;
      if (data.isPrivate && !wasPrivate) {
        const everyoneRole = await getEveryoneRole();
        const denyView = toStringBits(PERMISSIONS.VIEW_CHANNEL);
        const allowView = toStringBits(PERMISSIONS.VIEW_CHANNEL);
        if (everyoneRole) {
          await prisma.permissionOverwrite.upsert({
            where: { channelId_categoryId_targetType_targetId: { channelId: id, categoryId: null, targetType: 'ROLE', targetId: everyoneRole.id } },
            update: { deny: denyView },
            create: { channelId: id, targetType: 'ROLE', targetId: everyoneRole.id, deny: denyView },
          });
        }
        await prisma.permissionOverwrite.upsert({
          where: { channelId_categoryId_targetType_targetId: { channelId: id, categoryId: null, targetType: 'MEMBER', targetId: req.user.id } },
          update: { allow: allowView },
          create: { channelId: id, targetType: 'MEMBER', targetId: req.user.id, allow: allowView },
        });
      } else if (!data.isPrivate && wasPrivate) {
        await prisma.permissionOverwrite.deleteMany({ where: { channelId: id } });
      }
    }

    const channel = await prisma.channel.update({ where: { id }, data });
    req.app.get('io')?.to('community').emit('channel:update', { id: channel.id });
    res.json({ channel });
  } catch (err) { next(err); }
}

async function reorderChannels(req, res, next) {
  try {
    const { order } = req.body; // [{ id, categoryId, position }]
    await assertManageChannels(req.user.id);
    const ownedCount = await prisma.channel.count({ where: { id: { in: order.map((o) => o.id) } } });
    if (ownedCount !== order.length) return res.status(400).json({ error: 'Lista de reordenação inválida.' });
    await prisma.$transaction(
      order.map((item) => prisma.channel.update({
        where: { id: item.id },
        data: { position: item.position, categoryId: item.categoryId ?? null },
      }))
    );
    req.app.get('io')?.to('community').emit('channel:reorder', { order });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function deleteChannel(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const existing = await prisma.channel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Canal não encontrado.' });
    await prisma.channel.delete({ where: { id } });
    req.app.get('io')?.to('community').emit('channel:delete', { id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const now = new Date();
    await prisma.channelReadState.upsert({
      where: { channelId_userId: { channelId: id, userId: req.user.id } },
      update: { lastReadAt: now },
      create: { channelId: id, userId: req.user.id, lastReadAt: now },
    });
    res.json({ ok: true, lastReadAt: now });
  } catch (err) { next(err); }
}

async function listChannelOverwrites(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    const overwrites = await prisma.permissionOverwrite.findMany({ where: { channelId: id } });
    res.json({ overwrites, availablePermissions: Object.keys(PERMISSIONS) });
  } catch (err) { next(err); }
}

async function setChannelOverwrite(req, res, next) {
  try {
    const { id } = req.params;
    const { targetType, targetId, allow = [], deny = [] } = req.body;
    await assertManageChannels(req.user.id);
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });

    const allowBits = allow.reduce((acc, k) => (PERMISSIONS[k] ? acc | PERMISSIONS[k] : acc), 0n);
    const denyBits = deny.reduce((acc, k) => (PERMISSIONS[k] ? acc | PERMISSIONS[k] : acc), 0n);

    // SECURITY (mesma classe de escalação de privilégio corrigida em
    // roleController.js): sem isso, qualquer um com MANAGE_CHANNELS
    // podia criar uma sobrescrita "allow: ADMINISTRATOR" apontando pra
    // si mesmo (targetType MEMBER, targetId o próprio id) num canal
    // qualquer, e dentro daquele canal passar a ignorar toda e qualquer
    // outra checagem de permissão (ver has() em services/permissions.js).
    // A regra continua a mesma: nunca é possível CONCEDER (allow) uma
    // permissão que você mesmo não possui agora.
    const { getEffectivePermissions } = require('../services/authz');
    const callerBits = await getEffectivePermissions(req.user.id, null);
    if ((allowBits & ~callerBits) !== 0n) {
      return res.status(403).json({ error: 'Você não pode conceder uma permissão que você mesmo não possui.' });
    }

    const overwrite = await prisma.permissionOverwrite.upsert({
      where: { channelId_categoryId_targetType_targetId: { channelId: id, categoryId: null, targetType, targetId } },
      update: { allow: toStringBits(allowBits), deny: toStringBits(denyBits) },
      create: { channelId: id, targetType, targetId, allow: toStringBits(allowBits), deny: toStringBits(denyBits) },
    });
    req.app.get('io')?.to('community').emit('overwrite:update', { channelId: id });
    res.json({ overwrite });
  } catch (err) { next(err); }
}

async function deleteChannelOverwrite(req, res, next) {
  try {
    const { id, overwriteId } = req.params;
    await assertManageChannels(req.user.id);
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    const overwrite = await prisma.permissionOverwrite.findUnique({ where: { id: overwriteId } });
    if (!overwrite || overwrite.channelId !== id) return res.status(404).json({ error: 'Permissão não encontrada.' });
    await prisma.permissionOverwrite.delete({ where: { id: overwriteId } });
    req.app.get('io')?.to('community').emit('overwrite:update', { channelId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  createChannel, updateChannel, reorderChannels, deleteChannel, markRead,
  listChannelOverwrites, setChannelOverwrite, deleteChannelOverwrite,
};
