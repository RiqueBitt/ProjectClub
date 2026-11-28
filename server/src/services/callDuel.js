// Duelo de dados na call: uma pessoa desafia outra da mesma call valendo
// algumas moedas; se a outra aceitar, o servidor rola um d20 pra cada uma e
// quem tirar mais leva a aposta da outra. Empate devolve tudo. Só moedas do
// Project Club (que não se compram com dinheiro), sempre opcional:
//
// - valores fixos (STAKES), os dois na mesma sala, desafio vale DUEL_TTL_MS;
// - cada pessoa movimenta no máximo DAILY_CAP moedas em duelos por dia
//   (ganhando ou perdendo) — sem virar jeito de passar moedas entre contas;
// - conta nova (menos de 7 dias) não desafia nem aceita;
// - respeita a Economia desligada.
// Os desafios ficam em memória (instância única); a moeda muda numa transação.
const crypto = require('crypto');
const { DAY_MS } = require('../utils/spTime');
const { dayStart, MIN_ACCOUNT_DAYS } = require('./callTips');

const STAKES = [10, 25, 50];
const DAILY_CAP = 200;
const DUEL_TTL_MS = 30_000;

const pending = new Map(); // duelId -> { id, channelId, fromId, toId, stake, expiresAt, timer }

const pub = (u) => (u ? { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } : null);
const busyWith = (uid) => [...pending.values()].some((d) => d.fromId === uid || d.toId === uid);
const fail = (reason) => Object.assign(new Error(reason), { duelReason: reason });

function d20(rand = Math.random) { return 1 + Math.floor(rand() * 20); }

async function movedToday(tx, userId, now) {
  const r = await tx.economyTransaction.findMany({ where: { userId, kind: 'CALL_DUEL', createdAt: { gte: dayStart(now) } }, select: { coins: true } });
  return r.reduce((n, x) => n + Math.abs(x.coins || 0), 0);
}

function deps(over = {}) {
  return {
    prisma: over.prisma || require('../config/prisma'),
    voiceStore: over.voiceStore || require('./voiceRoomStore'),
    economyDisabled: over.economyDisabled || require('./voiceRewards').economyDisabled,
    now: over.now ?? Date.now(),
    rand: over.rand || Math.random,
  };
}

async function challenge(io, { channelId, fromId, toId, stake }, over = {}) {
  const d = deps(over);
  const value = Number(stake);
  if (!STAKES.includes(value)) return { ok: false, reason: 'Valor de aposta inválido.' };
  if (!toId || toId === fromId) return { ok: false, reason: 'Escolha outra pessoa da call.' };
  if (String(channelId || '').startsWith('praca:')) return { ok: false, reason: 'Sem duelo aqui.' };
  if (await d.economyDisabled(d.prisma)) return { ok: false, reason: 'A Economia está desligada agora.' };
  const [inA, inB] = await Promise.all([d.voiceStore.hasParticipant(channelId, fromId), d.voiceStore.hasParticipant(channelId, toId)]);
  if (!inA || !inB) return { ok: false, reason: 'Vocês dois precisam estar na mesma call.' };
  if (busyWith(fromId) || busyWith(toId)) return { ok: false, reason: 'Já tem um duelo esperando resposta.' };
  const [from, to] = await Promise.all([
    d.prisma.user.findUnique({ where: { id: fromId }, select: { id: true, username: true, displayName: true, avatarUrl: true, createdAt: true, coins: true } }),
    d.prisma.user.findUnique({ where: { id: toId }, select: { id: true, username: true, displayName: true, avatarUrl: true } }),
  ]);
  if (!from || !to) return { ok: false, reason: 'Pessoa não encontrada.' };
  if (d.now - new Date(from.createdAt).getTime() < MIN_ACCOUNT_DAYS * DAY_MS) return { ok: false, reason: `Contas com menos de ${MIN_ACCOUNT_DAYS} dias ainda não duelam valendo moedas.` };
  if ((from.coins || 0) < value) return { ok: false, reason: 'Moedas insuficientes pra essa aposta.' };

  const duel = { id: crypto.randomUUID(), channelId, fromId, toId, stake: value, expiresAt: d.now + DUEL_TTL_MS, from: pub(from), to: pub(to) };
  duel.timer = setTimeout(() => {
    if (!pending.delete(duel.id)) return;
    io?.to?.(`voice:${channelId}`).emit('voice:duel-gone', { channelId, id: duel.id, reason: 'expired' });
  }, DUEL_TTL_MS);
  duel.timer.unref?.();
  pending.set(duel.id, duel);
  const { timer, ...shown } = duel;
  io?.to?.(`voice:${channelId}`).emit('voice:duel', shown);
  return { ok: true, duel: shown };
}

function drop(id) {
  const duel = pending.get(id);
  if (duel?.timer) clearTimeout(duel.timer);
  pending.delete(id);
  return duel;
}

/** Quem foi desafiado recusa (ou quem desafiou cancela). */
function decline(io, { duelId, userId }) {
  const duel = pending.get(duelId);
  if (!duel || (duel.toId !== userId && duel.fromId !== userId)) return { ok: false, reason: 'Esse duelo já acabou.' };
  drop(duelId);
  io?.to?.(`voice:${duel.channelId}`).emit('voice:duel-gone', { channelId: duel.channelId, id: duelId, reason: duel.toId === userId ? 'declined' : 'cancelled' });
  return { ok: true };
}

async function accept(io, { duelId, userId }, over = {}) {
  const d = deps(over);
  const duel = pending.get(duelId);
  if (!duel || duel.expiresAt <= d.now) return { ok: false, reason: 'Esse duelo já acabou.' };
  if (duel.toId !== userId) return { ok: false, reason: 'Esse duelo não é pra você.' };
  drop(duelId); // tira antes de qualquer await: só um aceite vale
  if (await d.economyDisabled(d.prisma)) return { ok: false, reason: 'A Economia está desligada agora.' };
  const [inA, inB] = await Promise.all([d.voiceStore.hasParticipant(duel.channelId, duel.fromId), d.voiceStore.hasParticipant(duel.channelId, duel.toId)]);
  if (!inA || !inB) {
    io?.to?.(`voice:${duel.channelId}`).emit('voice:duel-gone', { channelId: duel.channelId, id: duelId, reason: 'left' });
    return { ok: false, reason: 'Alguém saiu da call.' };
  }
  const me = await d.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!me || d.now - new Date(me.createdAt).getTime() < MIN_ACCOUNT_DAYS * DAY_MS) {
    io?.to?.(`voice:${duel.channelId}`).emit('voice:duel-gone', { channelId: duel.channelId, id: duelId, reason: 'declined' });
    return { ok: false, reason: `Contas com menos de ${MIN_ACCOUNT_DAYS} dias ainda não duelam valendo moedas.` };
  }

  const rolls = { [duel.fromId]: d20(d.rand), [duel.toId]: d20(d.rand) };
  const tie = rolls[duel.fromId] === rolls[duel.toId];
  const winnerId = tie ? null : rolls[duel.fromId] > rolls[duel.toId] ? duel.fromId : duel.toId;
  const loserId = tie ? null : winnerId === duel.fromId ? duel.toId : duel.fromId;
  const { stake } = duel;
  try {
    await d.prisma.$transaction(async (tx) => {
      for (const uid of [duel.fromId, duel.toId]) {
        // eslint-disable-next-line no-await-in-loop
        const moved = await movedToday(tx, uid, d.now);
        if (moved + stake > DAILY_CAP) throw fail(`${uid === userId ? 'Você' : (duel.from?.displayName || 'Quem desafiou')} já chegou no limite de ${DAILY_CAP} moedas em duelos hoje.`);
        // eslint-disable-next-line no-await-in-loop
        const u = await tx.user.findUnique({ where: { id: uid }, select: { coins: true } });
        if (!u || u.coins < stake) throw fail(uid === userId ? 'Moedas insuficientes pra essa aposta.' : 'Quem desafiou não tem mais moedas pra essa aposta.');
      }
      if (tie) return;
      const r = await tx.user.updateMany({ where: { id: loserId, coins: { gte: stake } }, data: { coins: { decrement: stake } } });
      if (r.count === 0) throw fail('Saldo mudou no meio do duelo. Tente de novo.');
      await tx.user.update({ where: { id: winnerId }, data: { coins: { increment: stake } } });
      const nameOf = (id) => (id === duel.fromId ? duel.from : duel.to)?.displayName || 'alguém';
      await tx.economyTransaction.create({ data: { userId: winnerId, kind: 'CALL_DUEL', label: `Duelo de dados com ${nameOf(loserId)} (ganhou)`.slice(0, 180), coins: stake } });
      await tx.economyTransaction.create({ data: { userId: loserId, kind: 'CALL_DUEL', label: `Duelo de dados com ${nameOf(winnerId)} (perdeu)`.slice(0, 180), coins: -stake } });
    });
  } catch (e) {
    if (!e.duelReason) throw e;
    io?.to?.(`voice:${duel.channelId}`).emit('voice:duel-gone', { channelId: duel.channelId, id: duelId, reason: 'failed' });
    return { ok: false, reason: e.duelReason };
  }
  const result = { channelId: duel.channelId, id: duelId, from: duel.from, to: duel.to, stake, rolls, winnerId, tie, at: d.now };
  io?.to?.(`voice:${duel.channelId}`).emit('voice:duel-result', result);
  return { ok: true, result };
}

module.exports = {
  challenge, accept, decline, d20, STAKES, DAILY_CAP, DUEL_TTL_MS,
  _test: { reset: () => { for (const id of [...pending.keys()]) drop(id); }, pending },
};
