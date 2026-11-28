// Avaliações de mods (Fase 7): nota de 1 a 5 estrelas por pessoa e por mod,
// com um texto curto opcional ("review", até 500 caracteres) que aparece
// junto dos comentários na página do mod.
//
// - Uma avaliação por pessoa por mod (@@unique([userId, modioModId])):
//   avaliar de novo só troca a nota/o texto; dá pra remover.
// - Média e quantidade calculadas no banco (aggregate/groupBy), nunca
//   guardadas soltas — não tem como "desencontrar" da lista real.
// - "Mais bem avaliados" usa a média bayesiana (puxa as notas de quem tem
//   poucas avaliações pra perto da média geral), pra um mod com UMA nota 5
//   não passar na frente de outro com 200 notas 4,8.
//
// Prisma só é carregado quando precisa (os testes injetam um `db` falso).
const getPrisma = () => require('../config/prisma');

const MIN_STARS = 1;
const MAX_STARS = 5;
const REVIEW_MAX = 500;
// Peso da "nota de partida" da média bayesiana: equivale a fingir que todo
// mod já começa com PRIOR_COUNT avaliações na média geral.
const PRIOR_COUNT = 5;
const PRIOR_MEAN = 3.5;
// Teto de grupos lidos pra montar o ranking de um jogo (proteção — um jogo
// com milhares de mods avaliados ainda cabe folgado nisso).
const MAX_RANKED = 2000;

class RatingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Nota inteira de 1 a 5 — qualquer outra coisa é recusada (não "arredonda"
// silenciosamente um 7 pra 5).
function normalizeStars(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_STARS || n > MAX_STARS) {
    throw new RatingError('A nota precisa ser de 1 a 5 estrelas.');
  }
  return n;
}

// Texto opcional: tira espaços extras e caracteres de controle (menos a
// quebra de linha), vazio vira null. Acima do limite é recusado — cortar
// no meio mudaria o que a pessoa escreveu sem ela saber.
function normalizeReview(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new RatingError('Texto da avaliação inválido.');
  const clean = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return null;
  if ([...clean].length > REVIEW_MAX) throw new RatingError(`Avaliação muito longa (máximo ${REVIEW_MAX} caracteres).`);
  return clean;
}

function toModId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new RatingError('Mod inválido.');
  return n;
}

const round1 = (n) => Math.round(n * 10) / 10;

// { average, count } a partir do resultado de aggregate/groupBy.
function summaryOf(row) {
  const count = Number(row?._count?.stars ?? row?._count?._all ?? 0) || 0;
  const avg = row?._avg?.stars;
  return { average: count > 0 && avg != null ? round1(Number(avg)) : null, count };
}

// Média bayesiana (ver comentário do topo).
function weightedScore({ average, count }, { priorMean = PRIOR_MEAN, priorCount = PRIOR_COUNT } = {}) {
  if (!count || average == null) return 0;
  return (average * count + priorMean * priorCount) / (count + priorCount);
}

// Ordena os grupos { modioModId, average, count } do melhor pro pior:
// média ponderada ↓, depois mais avaliações ↓, depois id ↑ (estável).
function rankRated(groups, opts) {
  return [...groups]
    .filter((g) => g && g.count > 0)
    .map((g) => ({ ...g, score: weightedScore(g, opts) }))
    .sort((a, b) => (b.score - a.score) || (b.count - a.count) || (a.modioModId - b.modioModId));
}

const USER_SELECT = { id: true, displayName: true, username: true, avatarUrl: true, avatarDecoration: true };

// Cria ou troca a avaliação da pessoa. `isSelf` (opcional) responde se a
// pessoa é a autora do mod — hoje os mods vêm do mod.io e não têm conta do
// Project Club ligada, então o controller não passa nada; fica pronto pra
// quando existirem mods publicados por gente da plataforma.
async function upsertRating({ userId, modioModId, modioGameId, stars, review, isSelf }, { db = getPrisma() } = {}) {
  if (!userId) throw new RatingError('Faça login para avaliar.', 401);
  const modId = toModId(modioModId);
  const gameId = toModId(modioGameId);
  const s = normalizeStars(stars);
  const text = normalizeReview(review);
  if (typeof isSelf === 'function' && await isSelf()) throw new RatingError('Você não pode avaliar o próprio mod.', 403);
  const where = { userId_modioModId: { userId, modioModId: modId } };
  const data = { stars: s, review: text };
  try {
    return await db.modRating.upsert({ where, create: { userId, modioModId: modId, modioGameId: gameId, ...data }, update: data });
  } catch (err) {
    // Corrida de UNIQUE (dois cliques ao mesmo tempo): aplica como update.
    if (err?.code !== 'P2002') throw err;
    return db.modRating.update({ where, data });
  }
}

async function removeRating({ userId, modioModId }, { db = getPrisma() } = {}) {
  const modId = toModId(modioModId);
  const r = await db.modRating.deleteMany({ where: { userId, modioModId: modId } });
  return { removed: (r?.count || 0) > 0 };
}

// Apaga por id (dona da avaliação ou ADMIN — mesma regra dos comentários).
async function deleteRatingById({ ratingId, actor }, { db = getPrisma() } = {}) {
  const rating = await db.modRating.findUnique({ where: { id: String(ratingId || '') } });
  if (!rating) throw new RatingError('Avaliação não encontrada.', 404);
  if (rating.userId !== actor?.id && actor?.platformRole !== 'ADMIN') throw new RatingError('Sem permissão.', 403);
  await db.modRating.delete({ where: { id: rating.id } });
  return { removed: true };
}

async function summaryFor(modioModId, { db = getPrisma() } = {}) {
  const modId = toModId(modioModId);
  const [agg, groups] = await Promise.all([
    db.modRating.aggregate({ where: { modioModId: modId }, _avg: { stars: true }, _count: { stars: true } }),
    db.modRating.groupBy({ by: ['stars'], where: { modioModId: modId }, _count: { stars: true } }),
  ]);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const g of groups || []) if (distribution[g.stars] !== undefined) distribution[g.stars] = Number(g._count?.stars || 0);
  return { ...summaryOf(agg), distribution };
}

// { [modioModId]: { average, count } } pra uma lista de mods (cartões).
async function summariesFor(modioModIds, { db = getPrisma() } = {}) {
  const ids = [...new Set((modioModIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  if (ids.length === 0) return {};
  const rows = await db.modRating.groupBy({
    by: ['modioModId'], where: { modioModId: { in: ids } }, _avg: { stars: true }, _count: { stars: true },
  });
  const out = {};
  for (const r of rows || []) out[r.modioModId] = summaryOf(r);
  return out;
}

async function myRating(userId, modioModId, { db = getPrisma() } = {}) {
  if (!userId) return null;
  const r = await db.modRating.findUnique({ where: { userId_modioModId: { userId, modioModId: toModId(modioModId) } } });
  return r ? { id: r.id, stars: r.stars, review: r.review || null, updatedAt: r.updatedAt } : null;
}

// Avaliações com texto (as que aparecem junto dos comentários), mais novas primeiro.
async function listReviews(modioModId, { db = getPrisma(), take = 30 } = {}) {
  const rows = await db.modRating.findMany({
    where: { modioModId: toModId(modioModId), review: { not: null } },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(Number(take) || 30, 1), 50),
    include: { user: { select: USER_SELECT } },
  });
  return rows.map((r) => ({ id: r.id, stars: r.stars, review: r.review, createdAt: r.createdAt, updatedAt: r.updatedAt, user: r.user }));
}

// Ids dos mods mais bem avaliados de um jogo, já na ordem, + total.
async function topRatedIds(modioGameId, { offset = 0, limit = 20, db = getPrisma() } = {}) {
  const gameId = toModId(modioGameId);
  const rows = await db.modRating.groupBy({
    by: ['modioModId'], where: { modioGameId: gameId }, _avg: { stars: true }, _count: { stars: true },
    // groupBy com take exige orderBy (regra do Prisma) — o teto é só proteção.
    orderBy: { modioModId: 'asc' }, take: MAX_RANKED,
  });
  const ranked = rankRated((rows || []).map((r) => ({ modioModId: r.modioModId, ...summaryOf(r) })));
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  return { ids: ranked.slice(start, start + size).map((r) => r.modioModId), total: ranked.length, ranked };
}

module.exports = {
  MIN_STARS, MAX_STARS, REVIEW_MAX, PRIOR_COUNT, PRIOR_MEAN, RatingError,
  normalizeStars, normalizeReview, summaryOf, weightedScore, rankRated,
  upsertRating, removeRating, deleteRatingById, summaryFor, summariesFor, myRating, listReviews, topRatedIds,
};
