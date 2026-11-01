// Lembretes pessoais (ver services/reminders.js).
const prisma = require('../config/prisma');
const { parseWhen, validateReminder, MAX_ACTIVE_PER_USER } = require('../services/reminders');

const shape = (r) => ({ id: r.id, text: r.text, link: r.link, messageId: r.messageId, dueAt: r.dueAt, firedAt: r.firedAt, createdAt: r.createdAt });

// POST /api/reminders { text, dueAt? | when?, tzOffset?, link?, messageId? }
// `when` é texto livre ("em 2h", "amanhã 9h", "15/10 14:00"); `tzOffset` é
// o getTimezoneOffset() do navegador (minutos; Brasília = 180).
async function create(req, res, next) {
  try {
    const body = req.body || {};
    let dueAt = body.dueAt;
    if (!dueAt && typeof body.when === 'string') {
      const tz = Number.isFinite(Number(body.tzOffset)) ? -Number(body.tzOffset) : -180;
      dueAt = parseWhen(body.when, Date.now(), tz);
      if (!dueAt) return res.status(400).json({ error: 'Não entendi o horário. Tente "em 2h", "amanhã 9h", "18:30" ou "15/10 14:00".' });
    }
    const v = validateReminder({ text: body.text, dueAt, link: body.link, messageId: body.messageId });
    if (v.error) return res.status(400).json({ error: v.error });
    const active = await prisma.reminder.count({ where: { userId: req.user.id, firedAt: null } });
    if (active >= MAX_ACTIVE_PER_USER) return res.status(400).json({ error: `Você já tem ${MAX_ACTIVE_PER_USER} lembretes ativos.` });
    const row = await prisma.reminder.create({ data: { userId: req.user.id, text: v.text, dueAt: v.dueAt, link: v.link, messageId: v.messageId } });
    res.status(201).json({ reminder: shape(row) });
  } catch (err) { next(err); }
}

// GET /api/reminders — ativos (e os últimos 20 já disparados)
async function list(req, res, next) {
  try {
    const [active, fired] = await Promise.all([
      prisma.reminder.findMany({ where: { userId: req.user.id, firedAt: null }, orderBy: { dueAt: 'asc' }, take: 100 }),
      prisma.reminder.findMany({ where: { userId: req.user.id, firedAt: { not: null } }, orderBy: { firedAt: 'desc' }, take: 20 }),
    ]);
    res.json({ active: active.map(shape), fired: fired.map(shape) });
  } catch (err) { next(err); }
}

// DELETE /api/reminders/:id
async function remove(req, res, next) {
  try {
    const r = await prisma.reminder.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!r.count) return res.status(404).json({ error: 'Lembrete não encontrado.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /api/reminders/preview { when, tzOffset } → { dueAt } (pra UI mostrar
// "vou te lembrar em 14/10 às 09:00" antes de confirmar)
function preview(req, res) {
  const body = req.body || {};
  const tz = Number.isFinite(Number(body.tzOffset)) ? -Number(body.tzOffset) : -180;
  const d = typeof body.when === 'string' ? parseWhen(body.when, Date.now(), tz) : null;
  if (!d) return res.status(400).json({ error: 'Não entendi o horário.' });
  res.json({ dueAt: d });
}

module.exports = { create, list, remove, preview };
