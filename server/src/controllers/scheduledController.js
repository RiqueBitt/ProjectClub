// Mensagens agendadas (ver services/scheduledMessages.js).
const prisma = require('../config/prisma');
const { assertAccess } = require('./messageController');
const { validateSchedule, MAX_PENDING_PER_USER } = require('../services/scheduledMessages');

const shape = (r) => ({
  id: r.id, channelId: r.channelId, conversationId: r.conversationId, content: r.content, replyToId: r.replyToId,
  sendAt: r.sendAt, status: r.status, error: r.error, createdAt: r.createdAt, sentMessageId: r.sentMessageId,
});

// POST /api/messages/scheduled { channelId | conversationId, content, sendAt, replyToId? }
async function create(req, res, next) {
  try {
    const v = validateSchedule(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });
    const { channelId, conversationId } = req.body;
    // Mesma checagem de acesso/envio do envio normal (a de verdade acontece
    // de novo na hora de enviar).
    await assertAccess(req, { conversationId, channelId }, true);
    const pending = await prisma.scheduledMessage.count({ where: { authorId: req.user.id, status: 'PENDING' } });
    if (pending >= MAX_PENDING_PER_USER) return res.status(400).json({ error: `Você já tem ${MAX_PENDING_PER_USER} mensagens agendadas. Cancele alguma antes.` });
    const row = await prisma.scheduledMessage.create({
      data: {
        authorId: req.user.id, channelId: channelId || null, conversationId: conversationId || null,
        content: v.content, sendAt: v.sendAt, replyToId: typeof req.body.replyToId === 'string' ? req.body.replyToId.slice(0, 64) : null,
      },
    });
    res.status(201).json({ scheduled: shape(row) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// GET /api/messages/scheduled?channelId=|conversationId=  (só as minhas)
async function listMine(req, res, next) {
  try {
    const { channelId, conversationId } = req.query;
    const rows = await prisma.scheduledMessage.findMany({
      where: {
        authorId: req.user.id, status: 'PENDING',
        channelId: channelId || undefined, conversationId: conversationId || undefined,
      },
      orderBy: { sendAt: 'asc' }, take: 100,
    });
    res.json({ scheduled: rows.map(shape) });
  } catch (err) { next(err); }
}

// DELETE /api/messages/scheduled/:id — cancela (só se ainda não foi enviada)
async function cancel(req, res, next) {
  try {
    const r = await prisma.scheduledMessage.updateMany({ where: { id: req.params.id, authorId: req.user.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (!r.count) return res.status(404).json({ error: 'Agendamento não encontrado (ou já foi enviado).' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// PATCH /api/messages/scheduled/:id { content?, sendAt? }
async function update(req, res, next) {
  try {
    const existing = await prisma.scheduledMessage.findFirst({ where: { id: req.params.id, authorId: req.user.id, status: 'PENDING' } });
    if (!existing) return res.status(404).json({ error: 'Agendamento não encontrado (ou já foi enviado).' });
    const v = validateSchedule({
      content: req.body.content ?? existing.content, sendAt: req.body.sendAt ?? existing.sendAt,
      channelId: existing.channelId, conversationId: existing.conversationId,
    });
    if (v.error) return res.status(400).json({ error: v.error });
    const row = await prisma.scheduledMessage.update({ where: { id: existing.id }, data: { content: v.content, sendAt: v.sendAt } });
    res.json({ scheduled: shape(row) });
  } catch (err) { next(err); }
}

module.exports = { create, listMine, cancel, update, shape };
