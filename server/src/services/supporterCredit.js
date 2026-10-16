const prisma = require('../config/prisma');

// Crédito de apoio comprado com gemas (igual ao "Crédito Nitro de 3 dias"
// da loja de Orbs do Discord): vira Assinante por alguns dias. Quem já é
// apoiador sem prazo (liberado pela staff) não compra crédito.

const CREDITS = [
  { id: 'sub-3', tier: 'SUBSCRIBER', days: 3, priceGems: 15, name: 'Assinante por 3 dias' },
  { id: 'sub-7', tier: 'SUBSCRIBER', days: 7, priceGems: 30, name: 'Assinante por 7 dias' },
  { id: 'sub-30', tier: 'SUBSCRIBER', days: 30, priceGems: 100, name: 'Assinante por 30 dias' },
];

const fail = (msg, status = 400, extra) => Object.assign(new Error(msg), { status, extra });

async function buyCredit(req, res, next) {
  try {
    const credit = CREDITS.find((c) => c.id === req.params.id);
    if (!credit) return res.status(404).json({ error: 'Crédito não encontrado.' });
    const userId = req.user.id;
    let until;
    try {
      until = await prisma.$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: userId }, select: { supporterTier: true, supporterUntil: true } });
        const tier = u?.supporterTier || 'NONE';
        if (tier !== 'NONE' && !u.supporterUntil) throw fail('Você já é apoiador sem prazo — não precisa de crédito.');
        if (tier === 'SUPER') throw fail('Você já é Super Assinante.');
        const r = await tx.user.updateMany({ where: { id: userId, gems: { gte: credit.priceGems } }, data: { gems: { decrement: credit.priceGems } } });
        if (r.count === 0) throw fail('Gemas insuficientes.', 400, { code: 'INSUFFICIENT_FUNDS' });
        const base = u.supporterUntil && new Date(u.supporterUntil) > new Date() ? new Date(u.supporterUntil).getTime() : Date.now();
        const next = new Date(base + credit.days * 86400000);
        await tx.user.update({ where: { id: userId }, data: { supporterTier: credit.tier, supporterUntil: next } });
        return next;
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
      throw e;
    }
    require('./supporterBadges').syncSupporterBadges(userId, credit.tier).catch(() => {});
    require('./economyLedger').recordTransaction(userId, { kind: 'SHOP', label: `Loja: ${credit.name}`, gems: -credit.priceGems });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, supporterUntil: until, ...me });
  } catch (err) { next(err); }
}

// Apoio por crédito que venceu volta pra Membro.
async function expireCredits(io) {
  const due = await prisma.user.findMany({ where: { supporterUntil: { lte: new Date() } }, select: { id: true } });
  for (const { id } of due) {
    await prisma.user.update({ where: { id }, data: { supporterTier: 'NONE', supporterUntil: null } }).catch(() => null);
    await require('./supporterBadges').syncSupporterBadges(id, 'NONE');
    require('./notices').createNotice(io, id, {
      kind: 'SUPPORT', title: 'Seu crédito de Assinante acabou',
      body: 'Obrigado por apoiar! Dá pra renovar na Loja → Comparar planos.', link: '/loja',
    }).catch(() => {});
  }
  return due.length;
}

module.exports = { CREDITS, buyCredit, expireCredits };
