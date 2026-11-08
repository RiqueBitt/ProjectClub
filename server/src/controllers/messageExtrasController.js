const prisma = require('../config/prisma');

// Extras de mensagens (igual ao Discord): favoritar, marcar como não lida,
// lista de menções (Caixa de Entrada) e ignorar usuários.

const { messageInclude, assertAccess } = require('./messageController');

async function canSee(req, m) {
  try { await assertAccess(req, { conversationId: m.conversationId, channelId: m.channelId }); return true; } catch { return false; }
}
// Contexto curto pra mostrar na Caixa de Entrada.
async function withContext(messages) {
  const chIds = [...new Set(messages.map((m) => m.channelId).filter(Boolean))];
  const chans = chIds.length ? await prisma.channel.findMany({ where: { id: { in: chIds } }, select: { id: true, name: true } }) : [];
  const byId = Object.fromEntries(chans.map((c) => [c.id, c]));
  return messages.map((m) => ({ ...m, channelName: m.channelId ? byId[m.channelId]?.name || null : null }));
}

// POST /messages/:id/save { on? } — favoritar / desfavoritar.
async function toggleSave(req, res, next) {
  try {
    const m = await prisma.message.findUnique({ where: { id: req.params.id }, select: { id: true, channelId: true, conversationId: true, deleted: true } });
    if (!m || m.deleted) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!(await canSee(req, m))) return res.status(403).json({ error: 'Sem acesso a esta mensagem.' });
    const where = { userId_messageId: { userId: req.user.id, messageId: m.id } };
    const has = await prisma.savedMessage.findUnique({ where });
    const want = typeof req.body?.on === 'boolean' ? req.body.on : !has;
    if (want && !has) {
      const count = await prisma.savedMessage.count({ where: { userId: req.user.id } });
      if (count >= 500) return res.status(400).json({ error: 'Você chegou ao limite de 500 mensagens favoritas.' });
      await prisma.savedMessage.create({ data: { userId: req.user.id, messageId: m.id } }).catch(() => null);
    } else if (!want && has) {
      await prisma.savedMessage.deleteMany({ where: { userId: req.user.id, messageId: m.id } });
    }
    res.json({ saved: want, messageId: m.id });
  } catch (err) { next(err); }
}

// GET /messages/saved?before=ISO
async function listSaved(req, res, next) {
  try {
    const before = req.query.before ? new Date(req.query.before) : null;
    const rows = await prisma.savedMessage.findMany({
      where: { userId: req.user.id, ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 30,
    });
    const msgs = rows.length ? await prisma.message.findMany({ where: { id: { in: rows.map((r) => r.messageId) }, deleted: false }, include: messageInclude }) : [];
    const byId = Object.fromEntries(msgs.map((m) => [m.id, m]));
    const out = [];
    for (const r of rows) {
      const m = byId[r.messageId];
      if (m && await canSee(req, m)) out.push({ ...m, savedAt: r.createdAt });
    }
    res.json({ messages: await withContext(out), ids: rows.map((r) => r.messageId), hasMore: rows.length === 30 });
  } catch (err) { next(err); }
}

// GET /messages/saved/ids — só os ids (pro menu mostrar "Desfavoritar").
async function savedIds(req, res, next) {
  try {
    const rows = await prisma.savedMessage.findMany({ where: { userId: req.user.id }, select: { messageId: true }, take: 500 });
    res.json({ ids: rows.map((r) => r.messageId) });
  } catch (err) { next(err); }
}

// POST /messages/:id/unread — "Marcar como não lida" a partir desta mensagem.
async function markUnread(req, res, next) {
  try {
    const m = await prisma.message.findUnique({ where: { id: req.params.id }, select: { id: true, channelId: true, conversationId: true, createdAt: true } });
    if (!m) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (!(await canSee(req, m))) return res.status(403).json({ error: 'Sem acesso a esta mensagem.' });
    const at = new Date(new Date(m.createdAt).getTime() - 1);
    if (m.channelId) {
      await require('./channelController').forceChannelRead(m.channelId, req.user.id, at);
    } else {
      await prisma.conversationMember.updateMany({ where: { conversationId: m.conversationId, userId: req.user.id }, data: { lastReadAt: at } });
    }
    res.json({ ok: true, channelId: m.channelId, conversationId: m.conversationId, lastReadAt: at });
  } catch (err) { next(err); }
}

// GET /messages/mentions?before=ISO — menções e respostas pra mim.
async function listMentions(req, res, next) {
  try {
    const me = req.user.id;
    const before = req.query.before ? new Date(req.query.before) : null;
    const timeFilter = before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {};
    const msgs = await prisma.message.findMany({
      where: {
        deleted: false, authorId: { not: me }, channelId: { not: null }, ...timeFilter,
        OR: [
          { mentions: { some: { targetType: 'USER', targetId: me } } },
          { replyTo: { authorId: me } },
        ],
      },
      include: messageInclude, orderBy: { createdAt: 'desc' }, take: 25,
    });
    const visible = [];
    for (const m of msgs) if (await canSee(req, m)) visible.push(m);
    res.json({ messages: await withContext(visible), hasMore: msgs.length === 25 });
  } catch (err) { next(err); }
}

// GET /messages/replies?before=ISO — respostas de outras pessoas a
// mensagens minhas (canais e DMs), aba "Respostas" da Caixa de Entrada.
async function listReplies(req, res, next) {
  try {
    const me = req.user.id;
    const before = req.query.before ? new Date(req.query.before) : null;
    const timeFilter = before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {};
    const msgs = await prisma.message.findMany({
      where: {
        deleted: false, authorId: { not: me }, ...timeFilter,
        replyTo: { authorId: me },
      },
      include: messageInclude, orderBy: { createdAt: 'desc' }, take: 25,
    });
    const visible = [];
    for (const m of msgs) if (await canSee(req, m)) visible.push(m);
    res.json({ messages: await withContext(visible), hasMore: msgs.length === 25 });
  } catch (err) { next(err); }
}

// ---------- Ignorar ----------
// POST /users/:id/ignore { on? }
async function toggleIgnore(req, res, next) {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'Você não pode se ignorar.' });
    const exists = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const where = { userId_targetId: { userId: req.user.id, targetId } };
    const has = await prisma.userIgnore.findUnique({ where });
    const want = typeof req.body?.on === 'boolean' ? req.body.on : !has;
    if (want && !has) await prisma.userIgnore.create({ data: { userId: req.user.id, targetId } }).catch(() => null);
    if (!want && has) await prisma.userIgnore.deleteMany({ where: { userId: req.user.id, targetId } });
    res.json({ ignored: want, userId: targetId });
  } catch (err) { next(err); }
}

// GET /users/me/ignored
async function listIgnored(req, res, next) {
  try {
    const rows = await prisma.userIgnore.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } });
    const users = rows.length ? await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.targetId) } },
      select: { id: true, displayName: true, username: true, avatarUrl: true },
    }) : [];
    res.json({ ids: rows.map((r) => r.targetId), users });
  } catch (err) { next(err); }
}

module.exports = {
  toggleSave, listSaved, savedIds, markUnread, listMentions, listReplies, toggleIgnore, listIgnored,
};
