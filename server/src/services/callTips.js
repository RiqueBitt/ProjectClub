// Gorjeta na call: mandar algumas moedas pra quem está na mesma call (contou
// uma piada boa, ajudou no jogo, tocou a música certa). Opcional e pequeno:
//
// - valores fixos (TIP_AMOUNTS), os dois precisam estar na mesma sala;
// - cada pessoa manda no máximo SEND_CAP moedas por dia e recebe no máximo
//   RECEIVE_CAP (dia de Brasília) — pra não virar jeito de juntar moedas de
//   contas secundárias numa só;
// - conta nova (menos de MIN_ACCOUNT_DAYS) não manda;
// - respeita a Economia desligada.
// Tudo numa transação: desconta de um, soma no outro e grava as duas linhas
// do extrato (CALL_TIP), então os limites contam certo mesmo com cliques
// seguidos.
const { DAY_MS } = require('../utils/spTime');

const TIP_AMOUNTS = [10, 25, 50];
const SEND_CAP = 150;
const RECEIVE_CAP = 300;
const MIN_ACCOUNT_DAYS = 7;
const OFFSET_MS = -3 * 3600 * 1000;

/** Início do dia de hoje em Brasília (Date em UTC). */
function dayStart(now = Date.now()) {
  const l = new Date(now + OFFSET_MS);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - OFFSET_MS);
}

const fail = (reason) => Object.assign(new Error(reason), { tipReason: reason });

async function sumToday(tx, where, now) {
  const r = await tx.economyTransaction.aggregate({ where: { ...where, kind: 'CALL_TIP', createdAt: { gte: dayStart(now) } }, _sum: { coins: true } });
  return Math.abs(r?._sum?.coins || 0);
}

async function tip(io, { channelId, fromId, toId, amount }, {
  prisma = require('../config/prisma'),
  voiceStore = require('./voiceRoomStore'),
  economyDisabled = require('./voiceRewards').economyDisabled,
  now = Date.now(),
} = {}) {
  const value = Number(amount);
  if (!TIP_AMOUNTS.includes(value)) return { ok: false, reason: 'Valor de gorjeta inválido.' };
  if (!toId || toId === fromId) return { ok: false, reason: 'Escolha outra pessoa da call.' };
  if (String(channelId || '').startsWith('praca:')) return { ok: false, reason: 'Sem gorjeta aqui.' };
  if (await economyDisabled(prisma)) return { ok: false, reason: 'A Economia está desligada agora.' };
  const [inA, inB] = await Promise.all([voiceStore.hasParticipant(channelId, fromId), voiceStore.hasParticipant(channelId, toId)]);
  if (!inA || !inB) return { ok: false, reason: 'Vocês dois precisam estar na mesma call.' };

  const [from, to] = await Promise.all([
    prisma.user.findUnique({ where: { id: fromId }, select: { id: true, username: true, displayName: true, avatarUrl: true, createdAt: true } }),
    prisma.user.findUnique({ where: { id: toId }, select: { id: true, username: true, displayName: true, avatarUrl: true } }),
  ]);
  if (!from || !to) return { ok: false, reason: 'Pessoa não encontrada.' };
  if (now - new Date(from.createdAt).getTime() < MIN_ACCOUNT_DAYS * DAY_MS) {
    return { ok: false, reason: `Contas com menos de ${MIN_ACCOUNT_DAYS} dias ainda não mandam gorjeta.` };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const sent = await sumToday(tx, { userId: fromId, coins: { lt: 0 } }, now);
      if (sent + value > SEND_CAP) throw fail(`Você já mandou ${sent} de ${SEND_CAP} moedas em gorjetas hoje.`);
      const got = await sumToday(tx, { userId: toId, coins: { gt: 0 } }, now);
      if (got + value > RECEIVE_CAP) throw fail(`${to.displayName || to.username} já recebeu o máximo de gorjetas hoje.`);
      const r = await tx.user.updateMany({ where: { id: fromId, coins: { gte: value } }, data: { coins: { decrement: value } } });
      if (r.count === 0) throw fail('Moedas insuficientes.');
      await tx.user.update({ where: { id: toId }, data: { coins: { increment: value } } });
      await tx.economyTransaction.create({ data: { userId: fromId, kind: 'CALL_TIP', label: `Gorjeta para ${to.displayName || to.username}`.slice(0, 180), coins: -value } });
      await tx.economyTransaction.create({ data: { userId: toId, kind: 'CALL_TIP', label: `Gorjeta de ${from.displayName || from.username}`.slice(0, 180), coins: value } });
    });
  } catch (e) {
    if (e.tipReason) return { ok: false, reason: e.tipReason };
    throw e;
  }
  const pub = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl });
  io?.to?.(`voice:${channelId}`).emit('voice:tip', { channelId, from: pub(from), to: pub(to), amount: value, at: now });
  const me = await prisma.user.findUnique({ where: { id: fromId }, select: { coins: true } }).catch(() => null);
  return { ok: true, amount: value, coins: me?.coins ?? null };
}

module.exports = { tip, dayStart, TIP_AMOUNTS, SEND_CAP, RECEIVE_CAP, MIN_ACCOUNT_DAYS };
