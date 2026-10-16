const prisma = require('../config/prisma');
const { upsertOverwrite } = require('../services/overwrites');
const { safeUpsert } = require('../utils/prismaSafe');
const { assertManageChannels } = require('./categoryController');
const { getEveryoneRole, getEffectivePermissions, getEffectivePermissionsForChannels } = require('../services/authz');
const { Prisma } = require('@prisma/client');
const { toStringBits, PERMISSIONS, has } = require('../services/permissions');
const { sanitizeName, sanitizeIconEmoji, resolveIconUrl, checkIconUpload } = require('../utils/channelNames');

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
    const { type, categoryId, topic, isPrivate, userLimit } = req.body;
    await assertManageChannels(req.user.id);
    // Nome do jeito que a pessoa escreveu (maiúsculas e espaços valem),
    // só limpo — ver utils/channelNames.js.
    const name = sanitizeName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Dê um nome ao canal.' });
    const iconEmoji = sanitizeIconEmoji(req.body.iconEmoji);
    const iconUrl = await resolveIconUrl(prisma, req.body.iconUrl, null);
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
        iconEmoji: iconEmoji || null,
        iconUrl: iconEmoji ? null : (iconUrl || null),
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
    if (data.name !== undefined) {
      data.name = sanitizeName(data.name);
      if (!data.name) return res.status(400).json({ error: 'Dê um nome ao canal.' });
    }
    // Ícone: emoji OU imagem — escolher um limpa o outro; null nos dois remove.
    const iconEmoji = sanitizeIconEmoji(req.body.iconEmoji);
    const iconUrl = await resolveIconUrl(prisma, req.body.iconUrl, existing.iconUrl);
    if (iconEmoji !== undefined) data.iconEmoji = iconEmoji;
    if (iconUrl !== undefined) data.iconUrl = iconUrl;
    if (iconEmoji) data.iconUrl = null;
    else if (iconUrl) data.iconEmoji = null;
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
          await upsertOverwrite({ channelId: id, categoryId: null, targetType: 'ROLE', targetId: everyoneRole.id }, { deny: denyView });
        }
        await upsertOverwrite({ channelId: id, categoryId: null, targetType: 'MEMBER', targetId: req.user.id }, { allow: allowView });
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

// "Marcar canal como lido" chegava 2-3x por segundo num canal movimentado
// (o cliente marcava a cada mensagem nova). O cliente agora agrupa, mas
// aqui também: no máximo uma gravação por pessoa+canal a cada 2s — a
// chamada que cai dentro da janela não grava na hora, só agenda UMA
// gravação no fim da janela com o horário mais recente (nada se perde).
const READ_WRITE_WINDOW_MS = 2000;
const readWrites = new Map(); // `${userId}:${channelId}` -> { at, pendingAt, timer }
function writeChannelRead(channelId, userId, at) {
  return safeUpsert(prisma.channelReadState, {
    where: { channelId_userId: { channelId, userId } },
    update: { lastReadAt: at },
    create: { channelId, userId, lastReadAt: at },
  });
}
// "Marcar como não lida": grava um horário ANTERIOR e cancela qualquer
// gravação de "lido" que estava esperando a janela de 2s.
async function forceChannelRead(channelId, userId, at) {
  const key = `${userId}:${channelId}`;
  const cur = readWrites.get(key);
  if (cur?.timer) clearTimeout(cur.timer);
  readWrites.delete(key);
  return writeChannelRead(channelId, userId, at);
}

async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const now = new Date();
    const key = `${userId}:${id}`;
    const entry = readWrites.get(key);
    if (entry && now - entry.at < READ_WRITE_WINDOW_MS) {
      entry.pendingAt = now;
      if (!entry.timer) {
        entry.timer = setTimeout(() => {
          const cur = readWrites.get(key);
          if (!cur) return;
          const at = cur.pendingAt;
          cur.timer = null; cur.pendingAt = null; cur.at = Date.now();
          if (at) writeChannelRead(id, userId, at).catch(() => {});
          // Limpa a entrada depois de um tempo parado (o Map não cresce sem fim).
          setTimeout(() => { const c = readWrites.get(key); if (c && !c.timer && Date.now() - c.at >= READ_WRITE_WINDOW_MS) readWrites.delete(key); }, READ_WRITE_WINDOW_MS + 100).unref?.();
        }, Math.max(50, READ_WRITE_WINDOW_MS - (now - entry.at)));
        entry.timer.unref?.();
      }
      return res.json({ ok: true, lastReadAt: now });
    }
    // SEGURANÇA: antes qualquer id de canal (até privado/inexistente)
    // ganhava um ChannelReadState. Só checa aqui, na 1ª chamada da janela —
    // as seguintes caem no caminho acima, que só existe depois disso.
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    const perms = await getEffectivePermissions(userId, id, channel);
    if (!has(perms, 'VIEW_CHANNEL')) return res.status(403).json({ error: 'Sem acesso a este canal.' });
    readWrites.set(key, { at: now.getTime(), pendingAt: null, timer: null });
    await writeChannelRead(id, userId, now);
    setTimeout(() => { const c = readWrites.get(key); if (c && !c.timer && Date.now() - c.at >= READ_WRITE_WINDOW_MS) readWrites.delete(key); }, READ_WRITE_WINDOW_MS + 100).unref?.();
    res.json({ ok: true, lastReadAt: now });
  } catch (err) { next(err); }
}

// GET /community/channels/read-states — estado de leitura de cada canal
// que a pessoa vê: { [channelId]: { lastMessageAt, myReadAt, unreadMentions,
// lastMentionAt } }. Antes o ChannelReadState era gravado mas nunca lido de
// volta — depois de recarregar a página, nenhum canal aparecia como não
// lido. Tudo em 3 consultas agrupadas (nunca uma por canal).
const MENTION_LOOKBACK_DAYS = 30;
async function getChannelStates(req, res, next) {
  try {
    const userId = req.user.id;
    const channels = await prisma.channel.findMany({ select: { id: true, isPrivate: true, categoryId: true, type: true } });
    // Canais privados: permissão calculada em lote (antes: ~5 consultas por
    // canal privado, em sequência — N+1 a cada abertura/refresh).
    const privateChannels = channels.filter((ch) => ch.isPrivate);
    const permsByChannel = privateChannels.length
      ? ((await Promise.resolve().then(() => getEffectivePermissionsForChannels(userId, privateChannels)).catch(() => null)) || new Map())
      : new Map();
    const visible = channels
      .filter((ch) => !ch.isPrivate || has(permsByChannel.get(ch.id) || 0n, 'VIEW_CHANNEL'))
      .map((ch) => ch.id);
    if (!visible.length) return res.json({ states: {} });

    const [reads, lasts, myRoles, me] = await Promise.all([
      prisma.channelReadState.findMany({ where: { userId, channelId: { in: visible } }, select: { channelId: true, lastReadAt: true } }),
      // MAX(createdAt) por canal — usa o índice (channelId, createdAt).
      prisma.message.groupBy({ by: ['channelId'], where: { channelId: { in: visible }, deleted: false }, _max: { createdAt: true } }),
      prisma.userRole.findMany({ where: { userId }, select: { roleId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);

    // Menções não lidas (a mim, a um cargo meu, @everyone/@here) depois da
    // última leitura de cada canal — numa consulta agrupada só. Canal
    // nunca aberto conta a partir de quando a conta foi criada, e nunca
    // olha mais que MENTION_LOOKBACK_DAYS pra trás.
    const floor = new Date(Math.max(Date.now() - MENTION_LOOKBACK_DAYS * 86400000, new Date(me?.createdAt || 0).getTime()));
    const roleIds = myRoles.map((r) => r.roleId);
    const roleClause = roleIds.length
      ? Prisma.sql`OR (mm.targetType = 'ROLE' AND mm.targetId IN (${Prisma.join(roleIds)}))`
      : Prisma.empty;
    const mentionRows = await prisma.$queryRaw`
      SELECT m.channelId AS channelId, COUNT(DISTINCT m.id) AS cnt, MAX(m.createdAt) AS lastAt
      FROM Message m
      JOIN MessageMention mm ON mm.messageId = m.id
      LEFT JOIN ChannelReadState r ON r.channelId = m.channelId AND r.userId = ${userId}
      WHERE m.channelId IN (${Prisma.join(visible)})
        AND m.deleted = false
        AND m.authorId <> ${userId}
        AND m.createdAt > ${floor}
        AND (r.lastReadAt IS NULL OR m.createdAt > r.lastReadAt)
        AND ((mm.targetType = 'USER' AND mm.targetId = ${userId}) OR mm.targetType IN ('EVERYONE', 'HERE') ${roleClause})
      GROUP BY m.channelId`;

    const states = {};
    visible.forEach((id) => { states[id] = { lastMessageAt: null, myReadAt: null, unreadMentions: 0, lastMentionAt: null }; });
    reads.forEach((r) => { if (states[r.channelId]) states[r.channelId].myReadAt = r.lastReadAt; });
    lasts.forEach((l) => { if (l.channelId && states[l.channelId]) states[l.channelId].lastMessageAt = l._max.createdAt; });
    mentionRows.forEach((r) => {
      if (!states[r.channelId]) return;
      states[r.channelId].unreadMentions = Number(r.cnt) || 0;
      states[r.channelId].lastMentionAt = r.lastAt;
    });
    res.set('Cache-Control', 'private, no-cache');
    res.json({ states });
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
    if (!['ROLE', 'MEMBER'].includes(targetType) || !targetId) return res.status(400).json({ error: 'Escolha um cargo ou membro.' });
    if (!Array.isArray(allow) || !Array.isArray(deny)) return res.status(400).json({ error: 'Permissões inválidas.' });
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

    const overwrite = await upsertOverwrite({ channelId: id, categoryId: null, targetType, targetId }, { allow: toStringBits(allowBits), deny: toStringBits(denyBits) });
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

// POST /community/channels/:id/overwrites/sync — "Sincronizar agora" (igual
// ao Discord): apaga as permissões próprias do canal, que volta a seguir só
// as da categoria.
async function syncChannelOverwrites(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
    const { count } = await prisma.permissionOverwrite.deleteMany({ where: { channelId: id } });
    req.app.get('io')?.to('community').emit('overwrite:update', { channelId: id });
    res.json({ ok: true, removed: count });
  } catch (err) { next(err); }
}

// POST /community/channels/:id/icon — imagem pequena como ícone do canal.
async function uploadChannelIcon(req, res, next) {
  try {
    const { id } = req.params;
    await assertManageChannels(req.user.id);
    const problem = checkIconUpload(req.file);
    if (problem) return res.status(400).json({ error: problem });
    const existing = await prisma.channel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Canal não encontrado.' });
    const channel = await prisma.channel.update({ where: { id }, data: { iconUrl: req.file.url, iconEmoji: null } });
    req.app.get('io')?.to('community').emit('channel:update', { id: channel.id });
    res.json({ channel });
  } catch (err) { next(err); }
}

// GET /community/gallery — fotos, vídeos e GIFs já postados na comunidade
// (anexos dos canais que a pessoa pode ver + imagens dos posts do Feed).
// Só lê o que já existe, sem sistema de upload novo. Paginado por data
// (?before=ISO&limit=N).
const GALLERY_MEDIA_RE = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime))$/i;
async function listGallery(req, res, next) {
  try {
    const { getEffectivePermissions } = require('../services/authz');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 48, 1), 96);
    const before = req.query.before ? new Date(req.query.before) : null;
    const beforeFilter = before && !isNaN(before.getTime()) ? { lt: before } : undefined;
    const source = ['channels', 'posts'].includes(req.query.source) ? req.query.source : 'all';

    // Mesmo critério de getCommunity: só canais com VIEW_CHANNEL.
    const channels = await prisma.channel.findMany({ select: { id: true, name: true, type: true, iconEmoji: true, iconUrl: true } });
    const visible = [];
    for (const ch of channels) {
      const perms = await getEffectivePermissions(req.user.id, ch.id);
      if (has(perms, 'VIEW_CHANNEL')) visible.push(ch);
    }
    const byId = Object.fromEntries(visible.map((c) => [c.id, c]));
    const AUTHOR = { select: { id: true, displayName: true, avatarUrl: true, avatarDecoration: true } };

    const [attachments, posts] = await Promise.all([
      source === 'posts' || visible.length === 0 ? [] : prisma.attachment.findMany({
        where: {
          isSpoiler: false,
          OR: [{ mimeType: { startsWith: 'image/' } }, { mimeType: { startsWith: 'video/' } }],
          message: {
            channelId: { in: visible.map((c) => c.id) }, deleted: false,
            ...(beforeFilter ? { createdAt: beforeFilter } : {}),
          },
        },
        include: { message: { select: { id: true, channelId: true, createdAt: true, author: AUTHOR } } },
        orderBy: { message: { createdAt: 'desc' } },
        take: limit,
      }),
      source === 'channels' ? [] : prisma.post.findMany({
        where: { imageUrl: { not: null }, ...(beforeFilter ? { createdAt: beforeFilter } : {}) },
        select: {
          id: true, title: true, imageUrl: true, createdAt: true, author: AUTHOR,
          community: { select: { slug: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const items = [
      ...attachments.filter((a) => GALLERY_MEDIA_RE.test(a.mimeType)).map((a) => ({
        id: `a:${a.id}`,
        kind: a.mimeType.startsWith('video/') ? 'video' : (/gif$/i.test(a.mimeType) ? 'gif' : 'image'),
        url: a.url, filename: a.filename, source: 'channel',
        channel: byId[a.message.channelId] || null, messageId: a.message.id,
        author: a.message.author, createdAt: a.message.createdAt,
      })),
      ...posts.map((p) => ({
        id: `p:${p.id}`,
        kind: /\.gif(\?|$)/i.test(p.imageUrl) ? 'gif' : 'image',
        url: p.imageUrl, source: 'post', postId: p.id, title: p.title, club: p.community,
        author: p.author, createdAt: p.createdAt,
      })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

    const hasMore = attachments.length === limit || posts.length === limit;
    res.json({ items, nextBefore: hasMore && items.length ? items[items.length - 1].createdAt : null });
  } catch (err) { next(err); }
}

module.exports = {
  uploadChannelIcon, listGallery,
  createChannel, updateChannel, reorderChannels, deleteChannel, markRead, getChannelStates, forceChannelRead,
  listChannelOverwrites, setChannelOverwrite, deleteChannelOverwrite, syncChannelOverwrites,
};
