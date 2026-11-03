// Metas coletivas da semana (barra de progresso no Início).
//
// Toda semana tem metas da comunidade inteira — N mensagens, N minutos em
// call, N posts no Fórum. Se a staff não definir nenhuma, entram as padrão
// (DEFAULT_GOALS). O progresso vem do contador semanal da comunidade
// (activity.js). Bateu a meta → aviso ao vivo pra todo mundo. Na virada da
// semana, quem participou (pelo menos MIN_CONTRIBUTION_POINTS pontos de
// atividade na semana) ganha a soma das recompensas das metas batidas, uma
// vez só (RewardGrant), com um único aviso.
const { weekBounds, previousWeekBounds } = require('../../utils/spTime');
const { deps, httpError, intIn, claimJob, finishJob, grantOnce, economyDisabled } = require('./common');

const METRICS = {
  MESSAGES: { field: 'messages', label: 'mensagens' },
  VOICE_MINUTES: { field: 'voiceMinutes', label: 'minutos em call' },
  FORUM_POSTS: { field: 'forumPosts', label: 'posts no Fórum' },
};
const DEFAULT_GOALS = [
  { metric: 'MESSAGES', target: 3000, rewardCoins: 40, title: 'Conversa em dia' },
  { metric: 'VOICE_MINUTES', target: 2000, rewardCoins: 40, title: 'Call cheia' },
  { metric: 'FORUM_POSTS', target: 25, rewardCoins: 40, title: 'Fórum movimentado' },
];
const MIN_CONTRIBUTION_POINTS = 5;
const MAX_TARGET = 10_000_000;
const MAX_REWARD = 1000;
const CLOSE_DELAY_MS = 5 * 60 * 1000;

async function ensureWeek(weekKey, over = {}) {
  const d = deps(over);
  const n = await d.db.communityGoal.count({ where: { weekKey } });
  if (n > 0) return false;
  await d.db.communityGoal.createMany({ data: DEFAULT_GOALS.map((g) => ({ ...g, weekKey })), skipDuplicates: true });
  return true;
}

function shapeGoal(g, counter) {
  const field = METRICS[g.metric]?.field;
  const value = field ? counter?.[field] || 0 : 0;
  return {
    id: g.id, metric: g.metric, label: METRICS[g.metric]?.label || g.metric, title: g.title, target: g.target,
    rewardCoins: g.rewardCoins, value: Math.min(value, g.target), rawValue: value,
    percent: g.target ? Math.min(100, Math.floor((value / g.target) * 100)) : 0, reached: !!g.reachedAt || value >= g.target,
  };
}

async function progress(userId, over = {}) {
  const d = deps(over);
  const cur = weekBounds(d.now);
  await ensureWeek(cur.key, d).catch(() => {});
  const [goals, counter, mine] = await Promise.all([
    d.db.communityGoal.findMany({ where: { weekKey: cur.key }, orderBy: { metric: 'asc' } }),
    d.db.activityCounter.findUnique({ where: { scope_scopeId_periodKey: { scope: 'COMMUNITY_WEEK', scopeId: 'all', periodKey: cur.key } } }),
    userId ? d.db.activityCounter.findUnique({ where: { scope_scopeId_periodKey: { scope: 'USER_WEEK', scopeId: userId, periodKey: cur.key } } }) : null,
  ]);
  return {
    weekKey: cur.key, endsAt: cur.end,
    goals: goals.map((g) => shapeGoal(g, counter)),
    myPoints: mine?.points || 0, minContribution: MIN_CONTRIBUTION_POINTS,
  };
}

/** Ouvinte do contador semanal da comunidade: marca metas batidas. */
async function checkReached(counterRow, over = {}) {
  if (!counterRow || counterRow.scope !== 'COMMUNITY_WEEK') return [];
  const d = deps(over);
  const goals = await d.db.communityGoal.findMany({ where: { weekKey: counterRow.periodKey, reachedAt: null } });
  const reached = [];
  for (const g of goals) {
    const field = METRICS[g.metric]?.field;
    if (!field || (counterRow[field] || 0) < g.target) continue;
    // eslint-disable-next-line no-await-in-loop
    const r = await d.db.communityGoal.updateMany({ where: { id: g.id, reachedAt: null }, data: { reachedAt: d.now } });
    if (r.count === 1) {
      reached.push(g);
      d.io?.to?.('community')?.emit?.('goals:reached', { id: g.id, metric: g.metric, title: g.title, target: g.target, rewardCoins: g.rewardCoins });
    }
  }
  return reached;
}

/** Paga as metas batidas da semana anterior (idempotente). */
async function closeIfDue(over = {}) {
  const d = deps(over);
  const prev = previousWeekBounds(d.now);
  if (d.now.getTime() < prev.end.getTime() + CLOSE_DELAY_MS) return null;
  const pending = await d.db.communityGoal.findMany({ where: { weekKey: prev.key, reachedAt: { not: null }, rewardedAt: null } });
  if (!pending.length) return null;
  const jobKey = `metas:${prev.key}`;
  if (!await claimJob(d.db, jobKey, { now: d.now })) return null;
  try {
    const total = Math.min(MAX_REWARD * 3, pending.reduce((a, g) => a + (g.rewardCoins || 0), 0));
    const coins = (await economyDisabled(d.db)) ? 0 : total;
    let paid = 0;
    if (coins > 0) {
      const people = await d.db.activityCounter.findMany({
        where: { scope: 'USER_WEEK', periodKey: prev.key, points: { gte: MIN_CONTRIBUTION_POINTS } }, select: { scopeId: true },
      });
      const titles = pending.map((g) => g.title || METRICS[g.metric]?.label).join(', ');
      for (const { scopeId } of people) {
        // eslint-disable-next-line no-await-in-loop
        const got = await grantOnce(d, jobKey, scopeId, coins, { kind: 'COMMUNITY_GOAL', label: `Metas coletivas da semana: ${titles}`.slice(0, 180) });
        if (!got) continue;
        paid += 1;
        // eslint-disable-next-line no-await-in-loop
        await d.notify(d.io, scopeId, {
          kind: 'COMMUNITY_GOAL', title: 'A comunidade bateu as metas da semana!',
          body: `${pending.length} meta(s) batida(s): ${titles}. Você participou e ganhou ${coins} moedas.`, link: '/inicio', data: { weekKey: prev.key, coins },
        });
      }
    }
    await d.db.communityGoal.updateMany({ where: { id: { in: pending.map((g) => g.id) }, rewardedAt: null }, data: { rewardedAt: d.now } });
    await finishJob(d.db, jobKey, `${paid} pessoas, ${coins} moedas`);
    return { weekKey: prev.key, paid, coins, goals: pending.length };
  } catch (err) {
    console.error('[metas] fechamento falhou:', err?.message || err);
    return null;
  }
}

// ---------- Staff ----------
function weekChoice(which, now) {
  if (which === 'next') return weekBounds(weekBounds(now).end.getTime() + 3600_000).key;
  return weekBounds(now).key;
}

async function adminList(over = {}) {
  const d = deps(over);
  const cur = weekBounds(d.now).key;
  const next = weekChoice('next', d.now);
  await ensureWeek(cur, d).catch(() => {});
  const goals = await d.db.communityGoal.findMany({ where: { weekKey: { in: [cur, next] } }, orderBy: [{ weekKey: 'asc' }, { metric: 'asc' }] });
  return { current: cur, next, metrics: Object.keys(METRICS), defaults: DEFAULT_GOALS, goals };
}

async function adminSave(staffId, body, over = {}) {
  const d = deps(over);
  const weekKey = weekChoice(body?.week === 'next' ? 'next' : 'current', d.now);
  const metric = String(body?.metric || '');
  if (!METRICS[metric]) throw httpError(400, 'Tipo de meta inválido.');
  const target = intIn(body?.target, 1, MAX_TARGET);
  if (!target) throw httpError(400, 'Meta inválida.');
  const rewardCoins = intIn(body?.rewardCoins ?? 0, 0, MAX_REWARD);
  if (rewardCoins === null) throw httpError(400, `Recompensa de 0 a ${MAX_REWARD} moedas.`);
  const title = String(body?.title || '').trim().slice(0, 120) || null;
  const existing = await d.db.communityGoal.findUnique({ where: { weekKey_metric: { weekKey, metric } } });
  if (existing?.rewardedAt) throw httpError(400, 'Essa meta já foi paga.');
  if (existing) return d.db.communityGoal.update({ where: { id: existing.id }, data: { target, rewardCoins, title } });
  return d.db.communityGoal.create({ data: { weekKey, metric, target, rewardCoins, title, createdById: staffId } });
}

async function adminRemove(id, over = {}) {
  const d = deps(over);
  const g = await d.db.communityGoal.findUnique({ where: { id: String(id || '') } });
  if (!g) throw httpError(404, 'Meta não encontrada.');
  if (g.rewardedAt) throw httpError(400, 'Essa meta já foi paga.');
  await d.db.communityGoal.delete({ where: { id: g.id } });
  return { ok: true };
}

module.exports = {
  ensureWeek, progress, checkReached, closeIfDue, adminList, adminSave, adminRemove, shapeGoal,
  METRICS, DEFAULT_GOALS, MIN_CONTRIBUTION_POINTS,
};
