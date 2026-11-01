const prisma = require('../config/prisma');

// Meta de doações: barrinha verde que todo mundo vê no topo da barra
// lateral. Só administradores mudam a meta ou lançam doações. Valores em
// centavos no banco; o cliente mostra em reais.
const ID = 'singleton';
const MAX_CENTS = 100_000_000; // R$ 1.000.000

async function getGoal() {
  return (await prisma.donationGoal.findUnique({ where: { id: ID } })) || {
    id: ID, enabled: false, title: 'Meta do mês', description: null, target: 0, raised: 0, showDonors: true, updatedAt: null,
  };
}

async function publicShape(goal) {
  const recent = goal.showDonors
    ? await prisma.donationEntry.findMany({
      where: { amount: { gt: 0 }, donorName: { not: null } },
      orderBy: { createdAt: 'desc' }, take: 3, select: { donorName: true, amount: true, createdAt: true },
    })
    : [];
  return {
    enabled: goal.enabled, title: goal.title, description: goal.description,
    target: goal.target, raised: Math.max(0, goal.raised), showDonors: goal.showDonors, recent, updatedAt: goal.updatedAt,
  };
}

async function broadcast(req) {
  const data = await publicShape(await getGoal());
  req.app.get('io')?.emit('donation-goal:update', data);
  return data;
}

const toCents = (v) => {
  const n = Math.round(Number(v) * 100);
  return Number.isFinite(n) ? n : NaN;
};
const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

async function getPublic(req, res, next) {
  try { res.json(await publicShape(await getGoal())); } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const data = {};
    if (req.body.enabled !== undefined) data.enabled = !!req.body.enabled;
    if (req.body.showDonors !== undefined) data.showDonors = !!req.body.showDonors;
    if (req.body.title !== undefined) data.title = cleanText(req.body.title, 80) || 'Meta do mês';
    if (req.body.description !== undefined) data.description = cleanText(req.body.description, 200);
    if (req.body.target !== undefined) {
      const t = toCents(req.body.target);
      if (!(t > 0 && t <= MAX_CENTS)) return res.status(400).json({ error: 'Valor da meta inválido.' });
      data.target = t;
    }
    if (req.body.resetRaised) data.raised = 0;
    await prisma.donationGoal.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
    res.json(await broadcast(req));
  } catch (err) { next(err); }
}

async function addEntry(req, res, next) {
  try {
    const amount = toCents(req.body.amount);
    if (!amount || Math.abs(amount) > MAX_CENTS) return res.status(400).json({ error: 'Valor inválido.' });
    const donorName = cleanText(req.body.donorName, 60);
    const note = cleanText(req.body.note, 200);
    await prisma.$transaction([
      prisma.donationEntry.create({ data: { amount, donorName, note, actorId: req.user.id } }),
      prisma.donationGoal.upsert({ where: { id: ID }, create: { id: ID, raised: Math.max(0, amount) }, update: { raised: { increment: amount } } }),
    ]);
    res.json(await broadcast(req));
  } catch (err) { next(err); }
}

async function listEntries(req, res, next) {
  try {
    const entries = await prisma.donationEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const actorIds = [...new Set(entries.map((e) => e.actorId))];
    const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
    const byId = Object.fromEntries(actors.map((a) => [a.id, a.displayName]));
    res.json({ entries: entries.map((e) => ({ ...e, actorName: byId[e.actorId] || null })) });
  } catch (err) { next(err); }
}

// Desfaz um lançamento errado (tira o valor do total).
async function removeEntry(req, res, next) {
  try {
    const entry = await prisma.donationEntry.findUnique({ where: { id: req.params.id } });
    if (!entry) return res.status(404).json({ error: 'Lançamento não encontrado.' });
    await prisma.$transaction([
      prisma.donationEntry.delete({ where: { id: entry.id } }),
      prisma.donationGoal.update({ where: { id: ID }, data: { raised: { decrement: entry.amount } } }),
    ]);
    res.json(await broadcast(req));
  } catch (err) { next(err); }
}

module.exports = { getPublic, update, addEntry, listEntries, removeEntry };
