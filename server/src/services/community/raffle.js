// Sorteio semanal.
//
// Bilhetes custam TICKET_PRICE moedas (até MAX_TICKETS_PER_WEEK por pessoa
// por semana). Na virada da semana (segunda, Brasília) um bilhete é sorteado
// com crypto.randomInt (aleatoriedade segura, sem viés): quanto mais
// bilhetes, mais chance. O prêmio é BASE_PRIZE + POT_SHARE do que foi gasto
// em bilhetes. Com menos de MIN_PARTICIPANTS pessoas não tem sorteio: todo
// mundo recebe as moedas de volta. Todos os participantes recebem aviso.
const { randomInt } = require('node:crypto');
const { weekBounds, previousWeekBounds } = require('../../utils/spTime');
const { deps, httpError, claimJob, finishJob, jobDone, grantOnce, intIn, PUBLIC_MINI } = require('./common');

const TICKET_PRICE = 25;
const MAX_TICKETS_PER_WEEK = 20;
const MAX_PER_PURCHASE = 10;
const BASE_PRIZE = 100;
const POT_SHARE = 0.8;
const MIN_PARTICIPANTS = 2;
const DRAW_DELAY_MS = 2 * 60 * 1000;

const prizeFor = (totalSpent) => BASE_PRIZE + Math.floor(Math.max(0, totalSpent) * POT_SHARE);

/** Sorteia um bilhete: `r` é um inteiro em [0, total). Devolve o userId. */
function pickWinner(rows, r) {
  let acc = 0;
  for (const row of rows) {
    acc += row.count;
    if (r < acc) return row.userId;
  }
  return null;
}

async function buyTickets(userId, quantity, over = {}) {
  const d = deps(over);
  const n = intIn(quantity, 1, MAX_PER_PURCHASE);
  if (!n) throw httpError(400, `Escolha de 1 a ${MAX_PER_PURCHASE} bilhetes por compra.`);
  const week = weekBounds(d.now).key;
  const cost = n * TICKET_PRICE;
  const result = await d.db.$transaction(async (tx) => {
    let row = await tx.raffleTicket.findUnique({ where: { weekKey_userId: { weekKey: week, userId } } });
    if (!row) {
      try { row = await tx.raffleTicket.create({ data: { weekKey: week, userId, count: 0, spent: 0 } }); } catch (err) {
        if (err?.code !== 'P2002') throw err;
        row = await tx.raffleTicket.findUnique({ where: { weekKey_userId: { weekKey: week, userId } } });
      }
    }
    // Limite por semana conferido na própria gravação (duas abas não furam).
    const up = await tx.raffleTicket.updateMany({
      where: { id: row.id, count: { lte: MAX_TICKETS_PER_WEEK - n } },
      data: { count: { increment: n }, spent: { increment: cost } },
    });
    if (up.count !== 1) {
      const left = Math.max(0, MAX_TICKETS_PER_WEEK - row.count);
      throw httpError(400, left ? `Você só pode comprar mais ${left} bilhete(s) nesta semana.` : 'Você já comprou o máximo de bilhetes desta semana.');
    }
    const paid = await tx.user.updateMany({ where: { id: userId, coins: { gte: cost } }, data: { coins: { decrement: cost } } });
    if (paid.count !== 1) throw httpError(402, `Saldo insuficiente: ${n} bilhete(s) custam ${cost} moedas.`, { code: 'NO_FUNDS' });
    const me = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
    const mine = await tx.raffleTicket.findUnique({ where: { weekKey_userId: { weekKey: week, userId } } });
    return { coins: me.coins, myTickets: mine.count };
  });
  try { d.ledger(userId, { kind: 'RAFFLE', label: `Sorteio da semana: ${n} bilhete(s)`, coins: -cost }); } catch { /* só registro */ }
  return { ...result, bought: n, cost };
}

async function overview(userId, over = {}) {
  const d = deps(over);
  const cur = weekBounds(d.now);
  const prev = previousWeekBounds(d.now);
  const [rows, last] = await Promise.all([
    d.db.raffleTicket.findMany({ where: { weekKey: cur.key }, select: { userId: true, count: true, spent: true } }),
    d.db.raffleDraw.findFirst({ where: { weekKey: { lte: prev.key } }, orderBy: { weekKey: 'desc' } }),
  ]);
  const total = rows.reduce((a, r) => a + r.count, 0);
  const spent = rows.reduce((a, r) => a + r.spent, 0);
  const mine = rows.find((r) => r.userId === userId)?.count || 0;
  let lastWinner = null;
  if (last?.winnerId) {
    const u = await d.db.user.findUnique({ where: { id: last.winnerId }, select: PUBLIC_MINI });
    lastWinner = { weekKey: last.weekKey, prize: last.prize, tickets: last.tickets, participants: last.participants, user: u };
  }
  return {
    weekKey: cur.key, endsAt: cur.end,
    myTickets: mine, totalTickets: total, participants: rows.length,
    prize: prizeFor(spent), chance: total ? mine / total : 0,
    lastDraw: last ? { weekKey: last.weekKey, prize: last.prize, participants: last.participants, refunded: !last.winnerId && last.participants > 0 } : null,
    lastWinner,
    rules: { ticketPrice: TICKET_PRICE, maxPerWeek: MAX_TICKETS_PER_WEEK, maxPerPurchase: MAX_PER_PURCHASE, basePrize: BASE_PRIZE, potShare: POT_SHARE, minParticipants: MIN_PARTICIPANTS },
  };
}

/** Sorteia a semana anterior (idempotente). */
async function drawIfDue(over = {}) {
  const d = deps(over);
  const prev = previousWeekBounds(d.now);
  if (d.now.getTime() < prev.end.getTime() + DRAW_DELAY_MS) return null;
  const jobKey = `sorteio:${prev.key}`;
  if (await jobDone(d.db, jobKey)) return null;
  if (!await claimJob(d.db, jobKey, { now: d.now })) return null;
  try {
    const rows = (await d.db.raffleTicket.findMany({ where: { weekKey: prev.key, count: { gt: 0 } }, orderBy: { userId: 'asc' } }));
    const total = rows.reduce((a, r) => a + r.count, 0);
    const spent = rows.reduce((a, r) => a + r.spent, 0);
    // O resultado é gravado ANTES de pagar: se a tarefa cair no meio e for
    // retomada, paga o MESMO vencedor (nunca sorteia de novo).
    let draw = await d.db.raffleDraw.findUnique({ where: { weekKey: prev.key } });
    if (!draw) {
      const winner = rows.length >= MIN_PARTICIPANTS ? pickWinner(rows, (d.random || randomInt)(total)) : null;
      try {
        draw = await d.db.raffleDraw.create({ data: { weekKey: prev.key, winnerId: winner, prize: winner ? prizeFor(spent) : 0, tickets: total, participants: rows.length } });
      } catch (err) {
        if (err?.code !== 'P2002') throw err;
        draw = await d.db.raffleDraw.findUnique({ where: { weekKey: prev.key } });
      }
    }
    const { winnerId, prize } = draw;
    if (winnerId) {
      await grantOnce(d, jobKey, winnerId, prize, { kind: 'RAFFLE', label: `Prêmio do sorteio da semana (${prev.key})` });
      const winner = await d.db.user.findUnique({ where: { id: winnerId }, select: { displayName: true } });
      for (const row of rows) {
        const won = row.userId === winnerId;
        // eslint-disable-next-line no-await-in-loop
        await d.notify(d.io, row.userId, {
          kind: 'RAFFLE',
          title: won ? 'Você ganhou o sorteio da semana!' : 'Resultado do sorteio da semana',
          body: won ? `Seu bilhete foi sorteado entre ${total}. Prêmio: ${prize} moedas.` : `${winner?.displayName || 'Alguém'} levou ${prize} moedas. Seus ${row.count} bilhete(s) não foram dessa vez — boa sorte na próxima!`,
          link: '/sorteio', data: { weekKey: prev.key, prize, won },
        });
      }
      await (over.unlock || require('./secretAchievements').unlock)(winnerId, 'secreta_sortudo', d.io, { db: d.db });
    } else {
      // Poucas pessoas: devolve as moedas de todo mundo.
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const back = await grantOnce(d, `${jobKey}:reembolso`, row.userId, row.spent, { kind: 'RAFFLE', label: 'Sorteio cancelado: moedas devolvidas' });
        // eslint-disable-next-line no-await-in-loop
        if (back) await d.notify(d.io, row.userId, { kind: 'RAFFLE', title: 'Sorteio da semana cancelado', body: `Faltou gente (mínimo ${MIN_PARTICIPANTS}). Suas ${row.spent} moedas foram devolvidas.`, link: '/sorteio' });
      }
    }
    await finishJob(d.db, jobKey, winnerId ? `${winnerId} +${prize}` : `sem sorteio (${rows.length})`);
    return { weekKey: prev.key, winnerId, prize, total, participants: rows.length };
  } catch (err) {
    console.error('[sorteio] falhou:', err?.message || err);
    return null;
  }
}

module.exports = {
  buyTickets, overview, drawIfDue, pickWinner, prizeFor,
  TICKET_PRICE, MAX_TICKETS_PER_WEEK, MAX_PER_PURCHASE, BASE_PRIZE, POT_SHARE, MIN_PARTICIPANTS,
};
