// Sorteio semanal — REMOVIDO (nov/2026, pedido do dono).
//
// Não dá mais pra comprar bilhetes nem tem sorteio. Sobrou só isto: quem
// tinha bilhetes de uma semana que ainda não tinha sido sorteada recebe as
// moedas de volta, uma vez só (RewardGrant por semana e pessoa + JobRun —
// rodar de novo não paga duas vezes). As tabelas RaffleTicket/RaffleDraw
// continuam no banco só como registro.
const { deps, claimJob, finishJob, jobDone, grantOnce } = require('./common');

const JOB_KEY = 'sorteio:encerrado';

async function refundOpenTickets(over = {}) {
  const d = deps(over);
  if (await jobDone(d.db, JOB_KEY)) return null;
  if (!await claimJob(d.db, JOB_KEY, { now: d.now })) return null;
  try {
    const drawn = new Set((await d.db.raffleDraw.findMany({ select: { weekKey: true } })).map((r) => r.weekKey));
    const rows = (await d.db.raffleTicket.findMany({ where: { spent: { gt: 0 } }, orderBy: { userId: 'asc' } }))
      .filter((r) => !drawn.has(r.weekKey));
    let refunded = 0;
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      const back = await grantOnce(d, `${JOB_KEY}:${row.weekKey}`, row.userId, row.spent, { kind: 'RAFFLE', label: 'Sorteio encerrado: moedas devolvidas' });
      if (back) {
        refunded += 1;
        // eslint-disable-next-line no-await-in-loop
        await d.notify(d.io, row.userId, { kind: 'RAFFLE', title: 'O sorteio da semana acabou', body: `O sorteio saiu do Project Club. Suas ${row.spent} moedas em bilhetes foram devolvidas.`, link: '/economia' });
      }
    }
    await finishJob(d.db, JOB_KEY, `${refunded} reembolso(s)`);
    return { refunded };
  } catch (err) {
    console.error('[sorteio] reembolso falhou:', err?.message || err);
    return null;
  }
}

module.exports = { refundOpenTickets };
