const prisma = require('../config/prisma');

// Assinatura é só paga (liberada pela staff). O antigo "crédito de
// Assinante" com gemas foi tirado pra ninguém farmar gemas atrás dela;
// aqui só sobrou o vencimento de quem ainda tem crédito com prazo.

// Qualquer tentativa de comprar assinatura com gemas (app antigo, script)
// é recusada no servidor — não basta esconder o botão.
const GEM_SUBSCRIPTION_ERROR = 'A assinatura é só paga — não dá pra comprar com gemas.';
function rejectGemSubscription(req, res) {
  res.status(410).json({ error: GEM_SUBSCRIPTION_ERROR, code: 'SUBSCRIPTION_PAID_ONLY' });
}

// Apoio por crédito que venceu volta pra Membro.
async function expireCredits(io) {
  const due = await prisma.user.findMany({ where: { supporterUntil: { lte: new Date() } }, select: { id: true } });
  for (const { id } of due) {
    await prisma.user.update({ where: { id }, data: { supporterTier: 'NONE', supporterUntil: null } }).catch(() => null);
    await require('./supporterBadges').syncSupporterBadges(id, 'NONE');
    require('./notices').createNotice(io, id, {
      kind: 'SUPPORT', title: 'Seu crédito de Assinante acabou',
      body: 'Obrigado por apoiar! Pra continuar apoiando, fale com a equipe por um ticket.', link: '/loja',
    }).catch(() => {});
  }
  return due.length;
}

module.exports = { expireCredits, rejectGemSubscription, GEM_SUBSCRIPTION_ERROR };
