// Ranking semanal dos Mini-Jogos: janela da semana (Brasília), melhor placar
// por pessoa, fechamento idempotente com prêmios e resgate único com
// crédito de moedas + extrato. Prisma falso em memória.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const db = { scores: [], prizes: [], users: { u1: { coins: 0 }, u2: { coins: 0 }, u3: { coins: 0 }, u4: { coins: 0 } }, ledger: [] };
const inWin = (r, w) => (!w.game || r.game === w.game) && (!w.userId || r.userId === w.userId)
  && (!w.createdAt || (r.createdAt >= w.createdAt.gte && r.createdAt < w.createdAt.lt))
  && (!w.score || r.score > w.score.gt);
const fakePrisma = {
  minigameScore: {
    groupBy: async ({ by, where, take }) => {
      const rows = db.scores.filter((r) => inWin(r, where));
      const map = new Map();
      for (const r of rows) { const k = r[by[0]]; const cur = map.get(k); if (!cur || r.score > cur) map.set(k, r.score); }
      let out = [...map.entries()].map(([k, s]) => ({ [by[0]]: k, _max: { score: s } }));
      out.sort((a, b) => b._max.score - a._max.score);
      return take ? out.slice(0, take) : out;
    },
    aggregate: async ({ where }) => { const rows = db.scores.filter((r) => inWin(r, where)); return { _max: { score: rows.length ? Math.max(...rows.map((r) => r.score)) : null }, _count: { _all: rows.length } }; },
  },
  minigameWeeklyPrize: {
    create: async ({ data }) => {
      if (db.prizes.some((p) => p.weekKey === data.weekKey && p.game === data.game && p.userId === data.userId)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
      const row = { id: `p${db.prizes.length + 1}`, claimedAt: null, ...data }; db.prizes.push(row); return row;
    },
    findUnique: async ({ where }) => {
      if (where.id) return db.prizes.find((p) => p.id === where.id) || null;
      const k = where.weekKey_game_userId; return db.prizes.find((p) => p.weekKey === k.weekKey && p.game === k.game && p.userId === k.userId) || null;
    },
    findFirst: async ({ where }) => db.prizes.find((p) => p.weekKey === where.weekKey) || null,
    findMany: async ({ where }) => db.prizes.filter((p) => p.userId === where.userId && p.claimedAt === null),
    updateMany: async ({ where, data }) => { let n = 0; for (const p of db.prizes) { if (p.id === where.id && p.userId === where.userId && p.claimedAt === null) { Object.assign(p, data); n += 1; } } return { count: n }; },
  },
  user: { update: async ({ where, data }) => { db.users[where.id].coins += data.coins.increment; } },
};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };
require.cache[path.resolve(__dirname, '../src/services/economyLedger.js')] = { exports: { recordTransaction: async (uid, t) => db.ledger.push({ uid, ...t }) }, loaded: true, id: 'ledger' };

const weekly = require('../src/services/minigameWeekly');

// Terça 13/10/2026 12:00 Brasília
const NOW = Date.UTC(2026, 9, 13, 15, 0);
const sc = (userId, game, score, at) => db.scores.push({ userId, game, score, createdAt: new Date(at) });

beforeEach(() => { db.scores = []; db.prizes = []; db.ledger = []; for (const u of Object.values(db.users)) u.coins = 0; });

test('weekBounds: segunda 00:00 Brasília até a próxima segunda, chave ISO', () => {
  const w = weekly.weekBounds(NOW);
  assert.equal(w.start.toISOString(), '2026-10-12T03:00:00.000Z'); // seg 12/10 00:00 BRT
  assert.equal(w.end.toISOString(), '2026-10-19T03:00:00.000Z');
  assert.equal(w.key, '2026-W42');
  // Domingo 23:30 BRT ainda é a mesma semana; segunda 00:30 BRT já é a próxima.
  assert.equal(weekly.weekBounds(Date.UTC(2026, 9, 19, 2, 30)).key, '2026-W42');
  assert.equal(weekly.weekBounds(Date.UTC(2026, 9, 19, 3, 30)).key, '2026-W43');
  assert.equal(weekly.previousWeekBounds(NOW).key, '2026-W41');
});

test('standings: melhor placar de cada pessoa só dentro da semana', async () => {
  const w = weekly.weekBounds(NOW);
  sc('u1', 'pizzatron', 500, NOW - 3600000);
  sc('u1', 'pizzatron', 900, NOW - 1800000);
  sc('u2', 'pizzatron', 700, NOW - 60000);
  sc('u3', 'pizzatron', 9999, w.start.getTime() - 1000); // semana passada: não conta
  sc('u2', 'sledracing', 50, NOW); // outro jogo
  const top = await weekly.standings('pizzatron', w);
  assert.deepEqual(top, [{ rank: 1, userId: 'u1', score: 900 }, { rank: 2, userId: 'u2', score: 700 }]);
  const me = await weekly.myWeekly('pizzatron', 'u2', w);
  assert.deepEqual(me, { best: 700, plays: 1, rank: 2 });
  assert.deepEqual(await weekly.myWeekly('pizzatron', 'u4', w), { best: 0, plays: 0, rank: null });
});

test('settlePreviousWeek: top 3 de cada jogo ganha prêmio, uma vez só', async () => {
  const prev = weekly.previousWeekBounds(NOW);
  const t = prev.start.getTime() + 3600000;
  sc('u1', 'pizzatron', 900, t); sc('u2', 'pizzatron', 700, t); sc('u3', 'pizzatron', 500, t); sc('u4', 'pizzatron', 100, t);
  sc('u2', 'sledracing', 80, t);
  await weekly.settlePreviousWeek(['pizzatron', 'sledracing'], NOW);
  await weekly.settlePreviousWeek(['pizzatron', 'sledracing'], NOW); // idempotente
  assert.equal(db.prizes.length, 4);
  const pz = db.prizes.filter((p) => p.game === 'pizzatron').sort((a, b) => a.rank - b.rank);
  assert.deepEqual(pz.map((p) => [p.userId, p.rank, p.coins]), [['u1', 1, weekly.PRIZES[0]], ['u2', 2, weekly.PRIZES[1]], ['u3', 3, weekly.PRIZES[2]]]);
  assert.equal(pz[0].weekKey, '2026-W41');
  const sled = db.prizes.find((p) => p.game === 'sledracing');
  assert.equal(sled.userId, 'u2'); assert.equal(sled.rank, 1);
  assert.equal(db.prizes.some((p) => p.userId === 'u4'), false, '4º não ganha');
});

test('claimPrize: credita moedas + extrato uma vez; segunda vez devolve null', async () => {
  const prev = weekly.previousWeekBounds(NOW);
  sc('u1', 'pizzatron', 900, prev.start.getTime() + 1000);
  await weekly.settlePreviousWeek(['pizzatron'], NOW);
  const mine = await weekly.myUnclaimedPrizes('u1');
  assert.equal(mine.length, 1);
  const got = await weekly.claimPrize('u1', mine[0].id);
  assert.equal(got.coins, weekly.PRIZES[0]);
  assert.equal(db.users.u1.coins, weekly.PRIZES[0]);
  assert.equal(db.ledger.length, 1);
  assert.equal(db.ledger[0].kind, 'MINIGAME_WEEKLY');
  assert.match(db.ledger[0].label, /pizzatron.*1º/);
  assert.equal(await weekly.claimPrize('u1', mine[0].id), null);
  assert.equal(await weekly.claimPrize('u2', mine[0].id), null, 'outra pessoa não resgata o meu');
  assert.equal(db.users.u1.coins, weekly.PRIZES[0]);
  assert.equal((await weekly.myUnclaimedPrizes('u1')).length, 0);
});
