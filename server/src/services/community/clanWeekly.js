// Competição semanal entre Clubes.
//
// Os pontos vêm de services/community/activity.js (mensagens, minutos em
// call e posts no Fórum dos membros, com teto semanal por pessoa). Na virada
// da semana (segunda, horário de Brasília) o Clube com mais pontos vence:
// cada membro que contribuiu pelo menos MIN_MEMBER_POINTS na semana ganha
// WINNER_COINS_PER_MEMBER moedas + aviso. Pago uma vez só por pessoa
// (RewardGrant), mesmo se a tarefa rodar de novo.
const { weekBounds, previousWeekBounds } = require('../../utils/spTime');
const { deps, claimJob, finishJob, grantOnce, economyDisabled } = require('./common');

const WINNER_COINS_PER_MEMBER = 150;
const MIN_MEMBER_POINTS = 10;      // precisa ter ajudado o Clube na semana
const MIN_POINTS_TO_WIN = 50;      // semana parada não tem vencedor
const CLOSE_DELAY_MS = 5 * 60 * 1000; // espera o último lote de contadores
const STANDINGS_SIZE = 10;

async function standings(weekKey, over = {}) {
  const d = deps(over);
  const rows = await d.db.activityCounter.findMany({
    where: { scope: 'CLAN_WEEK', periodKey: weekKey, points: { gt: 0 } },
    orderBy: { points: 'desc' }, take: STANDINGS_SIZE,
  });
  if (!rows.length) return [];
  const clans = await d.db.clan.findMany({
    where: { id: { in: rows.map((r) => r.scopeId) } },
    select: { id: true, name: true, iconColor: true, iconId: true },
  });
  const byId = new Map(clans.map((c) => [c.id, c]));
  return rows
    .filter((r) => byId.has(r.scopeId))
    .map((r, i) => ({
      rank: i + 1, clanId: r.scopeId, name: byId.get(r.scopeId).name, iconColor: byId.get(r.scopeId).iconColor,
      iconId: byId.get(r.scopeId).iconId, points: r.points, messages: r.messages, voiceMinutes: r.voiceMinutes, forumPosts: r.forumPosts,
    }));
}

/** Tudo que a aba "Competição" do Clube mostra. */
async function overview(user, over = {}) {
  const d = deps(over);
  const cur = weekBounds(d.now);
  const prev = previousWeekBounds(d.now);
  const [list, last, mine] = await Promise.all([
    standings(cur.key, d),
    d.db.clanWeekResult.findUnique({ where: { weekKey: prev.key } }),
    d.db.activityCounter.findUnique({ where: { scope_scopeId_periodKey: { scope: 'USER_WEEK', scopeId: user.id, periodKey: cur.key } } }),
  ]);
  let myClan = null;
  if (user.clanId) {
    const row = await d.db.activityCounter.findUnique({ where: { scope_scopeId_periodKey: { scope: 'CLAN_WEEK', scopeId: user.clanId, periodKey: cur.key } } });
    const above = row ? await d.db.activityCounter.count({ where: { scope: 'CLAN_WEEK', periodKey: cur.key, points: { gt: row.points } } }) : null;
    myClan = { clanId: user.clanId, points: row?.points || 0, rank: row && row.points > 0 ? above + 1 : null };
  }
  return {
    weekKey: cur.key, endsAt: cur.end, standings: list, myClan,
    myContribution: Math.min(mine?.points || 0, require('./activity').CLAN_POINTS_WEEKLY_CAP_PER_MEMBER),
    lastWinner: last && last.clanId ? { weekKey: last.weekKey, clanId: last.clanId, name: last.clanName, points: last.points, rewardCoins: last.rewardCoins } : null,
    rules: {
      winnerCoinsPerMember: WINNER_COINS_PER_MEMBER, minMemberPoints: MIN_MEMBER_POINTS,
      memberWeeklyCap: require('./activity').CLAN_POINTS_WEEKLY_CAP_PER_MEMBER, points: require('./activity').POINTS,
    },
  };
}

/**
 * Fecha a semana anterior (idempotente). Chamada a cada minuto pelo
 * agendador; só faz algo depois de CLOSE_DELAY_MS da virada.
 */
async function closeWeekIfDue(over = {}) {
  const d = deps(over);
  const prev = previousWeekBounds(d.now);
  if (d.now.getTime() < prev.end.getTime() + CLOSE_DELAY_MS) return null;
  const done = await d.db.clanWeekResult.findUnique({ where: { weekKey: prev.key } });
  if (done) return null;
  const jobKey = `clube-semana:${prev.key}`;
  if (!await claimJob(d.db, jobKey, { now: d.now })) return null;
  try {
    const top = await standings(prev.key, d);
    const winner = top[0] && top[0].points >= MIN_POINTS_TO_WIN ? top[0] : null;
    let paid = 0;
    let coins = 0;
    if (winner) {
      const off = await economyDisabled(d.db);
      coins = off ? 0 : WINNER_COINS_PER_MEMBER;
      const members = await d.db.user.findMany({ where: { clanId: winner.clanId }, select: { id: true } });
      const contrib = await d.db.activityCounter.findMany({
        where: { scope: 'USER_WEEK', periodKey: prev.key, scopeId: { in: members.map((m) => m.id) }, points: { gte: MIN_MEMBER_POINTS } },
        select: { scopeId: true },
      });
      for (const { scopeId: uid } of contrib) {
        // eslint-disable-next-line no-await-in-loop
        const got = coins ? await grantOnce(d, `clube-semana:${prev.key}`, uid, coins, { kind: 'CLAN_WEEK', label: `Clube campeão da semana: ${winner.name}` }) : 0;
        if (got > 0 || !coins) {
          paid += 1;
          // eslint-disable-next-line no-await-in-loop
          await d.notify(d.io, uid, {
            kind: 'CLAN_WEEK', title: `Seu Clube venceu a semana! ${winner.name}`,
            body: coins ? `Vocês fizeram ${winner.points} pontos. Você ganhou ${coins} moedas por ajudar.` : `Vocês fizeram ${winner.points} pontos.`,
            link: '/clans/mine?aba=competicao', data: { weekKey: prev.key, clanId: winner.clanId, coins },
          });
        }
      }
    }
    await d.db.clanWeekResult.create({
      data: {
        weekKey: prev.key, clanId: winner?.clanId || null, clanName: winner?.name?.slice(0, 100) || null,
        points: winner?.points || 0, rewardCoins: coins, membersRewarded: paid,
        standings: JSON.stringify(top.map(({ rank, clanId, name, points }) => ({ rank, clanId, name, points }))),
      },
    }).catch((err) => { if (err?.code !== 'P2002') throw err; });
    await finishJob(d.db, jobKey, winner ? `${winner.name}: ${paid} membros` : 'sem vencedor');
    if (winner) d.io?.to?.('community')?.emit?.('clan:week-winner', { weekKey: prev.key, clanId: winner.clanId, name: winner.name, points: winner.points });
    return { weekKey: prev.key, winner, paid, coins };
  } catch (err) {
    console.error('[clubes] fechamento da semana falhou:', err?.message || err);
    return null;
  }
}

module.exports = {
  standings, overview, closeWeekIfDue,
  WINNER_COINS_PER_MEMBER, MIN_MEMBER_POINTS, MIN_POINTS_TO_WIN, CLOSE_DELAY_MS,
};
