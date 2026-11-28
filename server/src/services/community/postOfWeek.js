// Post da semana no Fórum.
//
// Na virada da semana (segunda, Brasília) escolhe o post com mais pontos
// (Ups − Downs) publicado na semana anterior — desempate por comentários e,
// depois, por quem publicou primeiro. O post ganha o selo "Post da semana",
// aparece no Início e o autor ganha REWARD_COINS moedas + aviso.
const { previousWeekBounds } = require('../../utils/spTime');
const { deps, claimJob, finishJob, grantOnce, economyDisabled } = require('./common');

const REWARD_COINS = 200;
const MIN_SCORE = 3;            // semana fraca não tem post da semana
const PICK_DELAY_MS = 5 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;

// Ids dos posts que já foram "post da semana" (pro selo nas listas, sem
// consulta extra por post).
let cache = { at: 0, ids: new Set() };

function isPostOfWeek(postId) { return cache.ids.has(postId); }

async function refreshCache(over = {}) {
  const d = deps(over);
  try {
    const rows = await d.db.postOfWeek.findMany({ select: { postId: true }, orderBy: { weekKey: 'desc' }, take: 520 });
    cache = { at: Date.now(), ids: new Set(rows.map((r) => r.postId)) };
  } catch { /* tabela ainda não existe: sem selo */ }
  return cache.ids;
}
function refreshCacheIfStale() {
  if (Date.now() - cache.at > CACHE_MS) refreshCache().catch(() => {});
}

function better(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  if ((a.commentCount || 0) !== (b.commentCount || 0)) return (a.commentCount || 0) > (b.commentCount || 0);
  return new Date(a.createdAt) < new Date(b.createdAt);
}

async function pickIfDue(over = {}) {
  const d = deps(over);
  const prev = previousWeekBounds(d.now);
  if (d.now.getTime() < prev.end.getTime() + PICK_DELAY_MS) return null;
  if (await d.db.postOfWeek.findUnique({ where: { weekKey: prev.key } })) return null;
  const jobKey = `post-semana:${prev.key}`;
  if (!await claimJob(d.db, jobKey, { now: d.now })) return null;
  try {
    const candidates = await d.db.post.findMany({
      where: { createdAt: { gte: prev.start, lt: prev.end }, score: { gte: MIN_SCORE } },
      orderBy: { score: 'desc' }, take: 20,
      select: { id: true, title: true, authorId: true, score: true, commentCount: true, createdAt: true, slug: true },
    });
    const best = candidates.reduce((acc, p) => (!acc || better(p, acc) ? p : acc), null);
    if (!best) { await finishJob(d.db, jobKey, 'sem post'); return { weekKey: prev.key, post: null }; }
    const coins = (await economyDisabled(d.db)) ? 0 : REWARD_COINS;
    const paid = coins ? await grantOnce(d, jobKey, best.authorId, coins, { kind: 'POST_OF_WEEK', label: `Post da semana: ${String(best.title).slice(0, 80)}` }) : 0;
    await d.db.postOfWeek.create({ data: { weekKey: prev.key, postId: best.id, authorId: best.authorId, score: best.score, rewardCoins: coins } })
      .catch((err) => { if (err?.code !== 'P2002') throw err; });
    if (paid || !coins) {
      await d.notify(d.io, best.authorId, {
        kind: 'POST_OF_WEEK', title: 'Seu post é o Post da semana!',
        body: coins ? `"${String(best.title).slice(0, 80)}" foi o mais votado da semana. Você ganhou ${coins} moedas.` : `"${String(best.title).slice(0, 80)}" foi o mais votado da semana.`,
        link: `/posts/${best.id}`, data: { postId: best.id, weekKey: prev.key, coins },
      });
    }
    cache.ids.add(best.id);
    await finishJob(d.db, jobKey, best.id);
    d.io?.to?.('community')?.emit?.('post:of-week', { postId: best.id, weekKey: prev.key });
    return { weekKey: prev.key, post: best, coins };
  } catch (err) {
    console.error('[post da semana] falhou:', err?.message || err);
    return null;
  }
}

/** Post da semana mais recente (seção do Início). */
async function latest(over = {}) {
  const d = deps(over);
  const row = await d.db.postOfWeek.findFirst({ orderBy: { weekKey: 'desc' } });
  if (!row) return null;
  return { weekKey: row.weekKey, postId: row.postId, authorId: row.authorId, score: row.score, rewardCoins: row.rewardCoins };
}

module.exports = { pickIfDue, latest, isPostOfWeek, refreshCache, refreshCacheIfStale, better, REWARD_COINS, MIN_SCORE };
