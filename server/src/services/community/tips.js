// Gorjetas com moedas para quem escreveu uma mensagem.
//
// Transferência atômica: numa transação só, confere o teto diário de quem
// dá (TipDaily, contador por dia de Brasília atualizado com condição),
// desconta o saldo SÓ se tiver moedas (updateMany com coins >= valor),
// credita quem recebe e registra a gorjeta. Se qualquer passo falhar, nada
// muda. Os dois lados ganham lançamento no extrato e quem recebe, um aviso.
const { dayKey } = require('../../utils/spTime');
const { deps, httpError, intIn } = require('./common');
const { messageAuthorVisibleTo } = require('./reputation');

const TIP_MIN = 5;
const TIP_MAX = 500;
const TIP_DAILY_CAP = 1000;
const TIP_MIN_LEVEL = 2; // conta recém-criada não sai distribuindo moedas

async function tip(sender, { messageId, amount }, over = {}) {
  const d = deps(over);
  const authz = over.authz || require('../authz');
  const value = intIn(amount, TIP_MIN, TIP_MAX);
  if (!value) throw httpError(400, `A gorjeta vai de ${TIP_MIN} a ${TIP_MAX} moedas.`);
  if ((sender.accountLevel || 1) < TIP_MIN_LEVEL) throw httpError(403, `Gorjetas liberam a partir do nível ${TIP_MIN_LEVEL}.`);
  const msg = await messageAuthorVisibleTo(d.db, authz, sender.id, messageId);
  if (msg.authorId === sender.id) throw httpError(400, 'Não dá pra dar gorjeta pra si mesmo.');
  const receiver = await d.db.user.findUnique({ where: { id: msg.authorId }, select: { id: true, displayName: true, isPlatformBanned: true, accountDisabledAt: true } });
  if (!receiver || receiver.isPlatformBanned || receiver.accountDisabledAt) throw httpError(404, 'Essa pessoa não pode receber gorjetas.');
  const day = dayKey(d.now);

  const balance = await d.db.$transaction(async (tx) => {
    const where = { userId_dayKey: { userId: sender.id, dayKey: day } };
    const row = await tx.tipDaily.findUnique({ where });
    if (!row) {
      try { await tx.tipDaily.create({ data: { userId: sender.id, dayKey: day, sent: 0 } }); } catch (err) { if (err?.code !== 'P2002') throw err; }
    }
    const capOk = await tx.tipDaily.updateMany({ where: { userId: sender.id, dayKey: day, sent: { lte: TIP_DAILY_CAP - value } }, data: { sent: { increment: value } } });
    if (capOk.count !== 1) {
      const cur = await tx.tipDaily.findUnique({ where });
      const left = Math.max(0, TIP_DAILY_CAP - (cur?.sent || 0));
      throw httpError(429, left ? `Hoje você ainda pode dar ${left} moedas em gorjetas.` : `Você já chegou ao limite de ${TIP_DAILY_CAP} moedas em gorjetas hoje.`, { code: 'TIP_DAILY_CAP' });
    }
    const debit = await tx.user.updateMany({ where: { id: sender.id, coins: { gte: value } }, data: { coins: { decrement: value } } });
    if (debit.count !== 1) throw httpError(402, 'Moedas insuficientes pra essa gorjeta.', { code: 'NO_FUNDS' });
    await tx.user.update({ where: { id: receiver.id }, data: { coins: { increment: value } } });
    await tx.coinTip.create({ data: { fromId: sender.id, toId: receiver.id, amount: value, messageId: msg.id } });
    const me = await tx.user.findUnique({ where: { id: sender.id }, select: { coins: true } });
    return me.coins;
  });

  try {
    d.ledger(sender.id, { kind: 'TIP', label: `Gorjeta para ${receiver.displayName}`, coins: -value });
    d.ledger(receiver.id, { kind: 'TIP', label: `Gorjeta de ${sender.displayName || 'alguém'}`, coins: value });
  } catch { /* só registro */ }
  await d.notify(d.io, receiver.id, {
    kind: 'TIP', title: `${sender.displayName || 'Alguém'} te deu ${value} moedas de gorjeta!`,
    body: 'Por uma mensagem sua. Que tal agradecer?', link: '/economia?aba=historico', data: { from: sender.id, amount: value, messageId: msg.id },
  });
  d.io?.notifyUser?.(receiver.id, 'economy:balance', { delta: value });
  (over.unlock || require('./secretAchievements').unlock)(sender.id, 'secreta_generoso', d.io, { db: d.db });
  return { ok: true, amount: value, coins: balance, receiverId: receiver.id };
}

async function todayStatus(userId, over = {}) {
  const d = deps(over);
  const row = await d.db.tipDaily.findUnique({ where: { userId_dayKey: { userId, dayKey: dayKey(d.now) } } });
  return { sentToday: row?.sent || 0, dailyCap: TIP_DAILY_CAP, min: TIP_MIN, max: TIP_MAX, minLevel: TIP_MIN_LEVEL };
}

module.exports = { tip, todayStatus, TIP_MIN, TIP_MAX, TIP_DAILY_CAP, TIP_MIN_LEVEL };
