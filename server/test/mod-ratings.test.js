// Avaliações de mods (Fase 7): validação da nota/texto, upsert (uma por
// pessoa), remoção, resumo e a ordenação "Mais bem avaliados" — tudo com um
// banco falso em memória (sem Prisma/MySQL).
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/services/modRatings');

// Banco falso: só o que o serviço usa de prisma.modRating.
function fakeDb() {
  let seq = 0;
  const rows = [];
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (k === 'userId_modioModId') return row.userId === v.userId && row.modioModId === v.modioModId;
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
    if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
    return row[k] === v;
  });
  const group = (list, by) => {
    const map = new Map();
    for (const row of list) {
      const key = by.map((b) => row[b]).join('|');
      if (!map.has(key)) map.set(key, { ...Object.fromEntries(by.map((b) => [b, row[b]])), list: [] });
      map.get(key).list.push(row);
    }
    return [...map.values()].map((g) => ({
      ...Object.fromEntries(by.map((b) => [b, g[b]])),
      _count: { stars: g.list.length },
      _avg: { stars: g.list.reduce((a, x) => a + x.stars, 0) / g.list.length },
    }));
  };
  const modRating = {
    async upsert({ where, create, update }) {
      const found = rows.find((row) => match(row, where));
      if (found) { Object.assign(found, update, { updatedAt: new Date() }); return found; }
      const row = { id: `r${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
    async update({ where, data }) { const f = rows.find((row) => match(row, where)); Object.assign(f, data); return f; },
    async deleteMany({ where }) {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    },
    async delete({ where }) { const i = rows.findIndex((row) => row.id === where.id); rows.splice(i, 1); },
    async findUnique({ where }) { return rows.find((row) => match(row, where)) || null; },
    async findMany({ where, take }) {
      return rows.filter((row) => match(row, where)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, take)
        .map((row) => ({ ...row, user: { id: row.userId, displayName: row.userId.toUpperCase() } }));
    },
    async aggregate({ where }) {
      const list = rows.filter((row) => match(row, where));
      return { _count: { stars: list.length }, _avg: { stars: list.length ? list.reduce((a, x) => a + x.stars, 0) / list.length : null } };
    },
    async groupBy({ by, where }) { return group(rows.filter((row) => match(row, where)), by); },
  };
  return { modRating, rows };
}

test('nota: só inteiros de 1 a 5 (aceita "4" vindo de formulário)', () => {
  assert.equal(r.normalizeStars(1), 1);
  assert.equal(r.normalizeStars(5), 5);
  assert.equal(r.normalizeStars('4'), 4);
  for (const bad of [0, 6, 3.5, -1, '', 'cinco', null, undefined, NaN, true]) {
    assert.throws(() => r.normalizeStars(bad), r.RatingError, `deveria recusar ${String(bad)}`);
  }
});

test('texto: opcional, sem caracteres de controle, máximo 500 (conta emoji como 1)', () => {
  assert.equal(r.normalizeReview(undefined), null);
  assert.equal(r.normalizeReview('   '), null);
  assert.equal(r.normalizeReview('  Muito bom\u0007!  '), 'Muito bom!');
  assert.equal(r.normalizeReview('a\r\n\n\n\nb'), 'a\n\nb');
  assert.equal(r.normalizeReview('😀'.repeat(500)).length, 1000); // 500 emojis = 500 caracteres
  assert.throws(() => r.normalizeReview('x'.repeat(501)), /500/);
  assert.throws(() => r.normalizeReview(42), r.RatingError);
});

test('avaliar de novo troca a nota (uma linha por pessoa) e remover funciona', async () => {
  const db = fakeDb();
  await r.upsertRating({ userId: 'ana', modioModId: 10, modioGameId: 1, stars: 5, review: 'Top' }, { db });
  await r.upsertRating({ userId: 'ana', modioModId: '10', modioGameId: 1, stars: 3 }, { db });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].stars, 3);
  assert.equal(db.rows[0].review, null, 'sem texto na troca = tira o texto antigo');
  assert.deepEqual(await r.myRating('ana', 10, { db }).then((m) => m.stars), 3);
  assert.deepEqual(await r.removeRating({ userId: 'ana', modioModId: 10 }, { db }), { removed: true });
  assert.deepEqual(await r.removeRating({ userId: 'ana', modioModId: 10 }, { db }), { removed: false });
  assert.equal(await r.myRating('ana', 10, { db }), null);
});

test('upsert: recusa sem login, mod inválido e autoavaliação (quando dá pra saber)', async () => {
  const db = fakeDb();
  await assert.rejects(r.upsertRating({ userId: null, modioModId: 1, modioGameId: 1, stars: 4 }, { db }), (e) => e.status === 401);
  await assert.rejects(r.upsertRating({ userId: 'a', modioModId: 'x', modioGameId: 1, stars: 4 }, { db }), /Mod inválido/);
  await assert.rejects(r.upsertRating({ userId: 'a', modioModId: 1, modioGameId: 1, stars: 4, isSelf: async () => true }, { db }), (e) => e.status === 403);
  assert.equal(db.rows.length, 0);
});

test('corrida de UNIQUE (P2002) vira update em vez de erro 500', async () => {
  const db = fakeDb();
  await r.upsertRating({ userId: 'a', modioModId: 7, modioGameId: 1, stars: 2 }, { db });
  const upsert = db.modRating.upsert;
  db.modRating.upsert = async () => { const e = new Error('dup'); e.code = 'P2002'; throw e; };
  const saved = await r.upsertRating({ userId: 'a', modioModId: 7, modioGameId: 1, stars: 4 }, { db });
  assert.equal(saved.stars, 4);
  db.modRating.upsert = upsert;
});

test('resumo: média com 1 casa, quantidade e distribuição por estrela', async () => {
  const db = fakeDb();
  for (const [u, s] of [['a', 5], ['b', 4], ['c', 4]]) await r.upsertRating({ userId: u, modioModId: 3, modioGameId: 1, stars: s }, { db });
  const sum = await r.summaryFor(3, { db });
  assert.equal(sum.average, 4.3);
  assert.equal(sum.count, 3);
  assert.deepEqual(sum.distribution, { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
  assert.deepEqual(await r.summaryFor(99, { db }), { average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  const many = await r.summariesFor([3, 99, 'lixo'], { db });
  assert.deepEqual(many, { 3: { average: 4.3, count: 3 } });
});

test('reviews: só as que têm texto, com a pessoa junto', async () => {
  const db = fakeDb();
  await r.upsertRating({ userId: 'a', modioModId: 3, modioGameId: 1, stars: 5, review: 'Excelente' }, { db });
  await r.upsertRating({ userId: 'b', modioModId: 3, modioGameId: 1, stars: 2 }, { db });
  const list = await r.listReviews(3, { db });
  assert.equal(list.length, 1);
  assert.equal(list[0].review, 'Excelente');
  assert.equal(list[0].user.id, 'a');
});

test('apagar por id: dona ou ADMIN; outra pessoa não', async () => {
  const db = fakeDb();
  const row = await r.upsertRating({ userId: 'a', modioModId: 3, modioGameId: 1, stars: 5, review: 'x' }, { db });
  await assert.rejects(r.deleteRatingById({ ratingId: row.id, actor: { id: 'b', platformRole: 'USER' } }, { db }), (e) => e.status === 403);
  assert.deepEqual(await r.deleteRatingById({ ratingId: row.id, actor: { id: 'z', platformRole: 'ADMIN' } }, { db }), { removed: true });
  await assert.rejects(r.deleteRatingById({ ratingId: row.id, actor: { id: 'a' } }, { db }), (e) => e.status === 404);
});

test('"Mais bem avaliados": média bayesiana — uma nota 5 sozinha não passa 50 notas 4,8', async () => {
  const ranked = r.rankRated([
    { modioModId: 1, average: 5, count: 1 },
    { modioModId: 2, average: 4.8, count: 50 },
    { modioModId: 3, average: 2, count: 30 },
    { modioModId: 4, average: null, count: 0 },
  ]);
  assert.deepEqual(ranked.map((x) => x.modioModId), [2, 1, 3]);
  // Empate de média: mais avaliações primeiro; depois id menor (estável).
  assert.deepEqual(r.rankRated([
    { modioModId: 9, average: 4, count: 10 }, { modioModId: 8, average: 4, count: 20 }, { modioModId: 7, average: 4, count: 20 },
  ]).map((x) => x.modioModId), [7, 8, 9]);
});

test('topRatedIds: pagina na ordem do ranking, só do jogo pedido', async () => {
  const db = fakeDb();
  const add = (u, mod, game, s) => r.upsertRating({ userId: u, modioModId: mod, modioGameId: game, stars: s }, { db });
  for (const u of ['a', 'b', 'c', 'd']) await add(u, 100, 1, 5);
  for (const u of ['a', 'b']) await add(u, 200, 1, 3);
  await add('a', 300, 1, 4);
  await add('a', 999, 2, 5); // outro jogo
  const first = await r.topRatedIds(1, { db, limit: 2 });
  assert.deepEqual(first.ids, [100, 300]);
  assert.equal(first.total, 3);
  const second = await r.topRatedIds(1, { db, offset: 2, limit: 2 });
  assert.deepEqual(second.ids, [200]);
});
