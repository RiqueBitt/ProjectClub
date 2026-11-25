// Duelo de dados na call (services/callDuel.js).
const test = require('node:test');
const assert = require('node:assert');
const duel = require('../src/services/callDuel');

function fakeDb(coins = { a: 100, b: 100 }) {
  const rows = [];
  const old = new Date(Date.now() - 30 * 86400000);
  const users = { a: { id: 'a', username: 'ana', displayName: 'Ana', createdAt: old }, b: { id: 'b', username: 'bia', displayName: 'Bia', createdAt: old } };
  const db = {
    rows, coins,
    user: {
      findUnique: async ({ where }) => (users[where.id] ? { ...users[where.id], coins: coins[where.id] } : null),
      updateMany: async ({ where, data }) => { if (coins[where.id] < where.coins.gte) return { count: 0 }; coins[where.id] -= data.coins.decrement; return { count: 1 }; },
      update: async ({ where, data }) => { coins[where.id] += data.coins.increment; return {}; },
    },
    economyTransaction: {
      create: async ({ data }) => { rows.push({ ...data, createdAt: new Date() }); return data; },
      findMany: async ({ where }) => rows.filter((r) => r.userId === where.userId && r.kind === where.kind),
    },
  };
  db.$transaction = async (fn) => fn(db);
  return db;
}
const io = () => { const sent = []; return { sent, to: () => ({ emit: (e, d) => sent.push([e, d]) }) }; };
const over = (prisma, extra = {}) => ({ prisma, voiceStore: { hasParticipant: async () => true }, economyDisabled: async () => false, ...extra });
// rand: primeiro d20 de quem desafiou, depois de quem aceitou.
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('desafio aceito: quem tira mais leva a aposta', async () => {
  duel._test.reset();
  const db = fakeDb();
  const sock = io();
  const c = await duel.challenge(sock, { channelId: 'c', fromId: 'a', toId: 'b', stake: 25 }, over(db));
  assert.equal(c.ok, true);
  assert.equal(sock.sent[0][0], 'voice:duel');
  const r = await duel.accept(sock, { duelId: c.duel.id, userId: 'b' }, over(db, { rand: seq(0.9, 0.1) }));
  assert.equal(r.ok, true);
  assert.equal(r.result.winnerId, 'a');
  assert.deepEqual(db.coins, { a: 125, b: 75 });
  assert.deepEqual(db.rows.map((x) => [x.userId, x.coins]).sort(), [['a', 25], ['b', -25]]);
  // Não dá pra aceitar duas vezes.
  assert.equal((await duel.accept(sock, { duelId: c.duel.id, userId: 'b' }, over(db))).ok, false);
});

test('empate devolve tudo; só o desafiado aceita; recusar avisa a call', async () => {
  duel._test.reset();
  const db = fakeDb();
  const c = await duel.challenge(io(), { channelId: 'c', fromId: 'a', toId: 'b', stake: 10 }, over(db));
  assert.equal((await duel.accept(io(), { duelId: c.duel.id, userId: 'a' }, over(db))).ok, false);
  const r = await duel.accept(io(), { duelId: c.duel.id, userId: 'b' }, over(db, { rand: seq(0.5, 0.5) }));
  assert.equal(r.result.tie, true);
  assert.deepEqual(db.coins, { a: 100, b: 100 });
  const c2 = await duel.challenge(io(), { channelId: 'c', fromId: 'a', toId: 'b', stake: 10 }, over(db));
  const sock = io();
  assert.equal(duel.decline(sock, { duelId: c2.duel.id, userId: 'b' }).ok, true);
  assert.equal(sock.sent[0][1].reason, 'declined');
});

test('sem saldo, valor estranho ou um desafio por vez', async () => {
  duel._test.reset();
  const db = fakeDb({ a: 5, b: 100 });
  assert.match((await duel.challenge(io(), { channelId: 'c', fromId: 'a', toId: 'b', stake: 10 }, over(db))).reason, /insuficientes/);
  assert.equal((await duel.challenge(io(), { channelId: 'c', fromId: 'b', toId: 'a', stake: 999 }, over(db))).ok, false);
  const ok = await duel.challenge(io(), { channelId: 'c', fromId: 'b', toId: 'a', stake: 10 }, over(db));
  assert.equal(ok.ok, true);
  assert.equal((await duel.challenge(io(), { channelId: 'c', fromId: 'b', toId: 'a', stake: 10 }, over(db))).ok, false);
  // Quem aceita sem saldo: nada muda.
  const r = await duel.accept(io(), { duelId: ok.duel.id, userId: 'a' }, over(db, { rand: seq(0.1, 0.9) }));
  assert.equal(r.ok, false);
  assert.deepEqual(db.coins, { a: 5, b: 100 });
});

test('limite diário de moedas em duelos', async () => {
  duel._test.reset();
  const db = fakeDb({ a: 1000, b: 1000 });
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const c = await duel.challenge(io(), { channelId: 'c', fromId: 'a', toId: 'b', stake: 50 }, over(db));
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await duel.accept(io(), { duelId: c.duel.id, userId: 'b' }, over(db, { rand: seq(0.9, 0.1) }))).ok, true);
  }
  const c = await duel.challenge(io(), { channelId: 'c', fromId: 'a', toId: 'b', stake: 10 }, over(db));
  const r = await duel.accept(io(), { duelId: c.duel.id, userId: 'b' }, over(db, { rand: seq(0.9, 0.1) }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /limite/);
});
