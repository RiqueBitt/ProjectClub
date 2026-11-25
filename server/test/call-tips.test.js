// Gorjeta na call (services/callTips.js).
const test = require('node:test');
const assert = require('node:assert');
const tips = require('../src/services/callTips');

function fakeDb({ coins = { a: 100, b: 0 }, createdDaysAgo = 30 } = {}) {
  const rows = [];
  const users = {
    a: { id: 'a', username: 'ana', displayName: 'Ana', createdAt: new Date(Date.now() - createdDaysAgo * 86400000) },
    b: { id: 'b', username: 'bia', displayName: 'Bia' },
  };
  const db = {
    rows, coins,
    user: {
      findUnique: async ({ where }) => (users[where.id] ? { ...users[where.id], coins: coins[where.id] } : null),
      updateMany: async ({ where, data }) => {
        if (coins[where.id] < where.coins.gte) return { count: 0 };
        coins[where.id] -= data.coins.decrement; return { count: 1 };
      },
      update: async ({ where, data }) => { coins[where.id] += data.coins.increment; return {}; },
    },
    economyTransaction: {
      create: async ({ data }) => { rows.push({ ...data, createdAt: new Date() }); return data; },
      aggregate: async ({ where }) => {
        const sum = rows.filter((r) => r.userId === where.userId && r.kind === where.kind
          && (where.coins.lt !== undefined ? r.coins < 0 : r.coins > 0)).reduce((n, r) => n + r.coins, 0);
        return { _sum: { coins: sum } };
      },
    },
  };
  db.$transaction = async (fn) => fn(db);
  return db;
}
const both = { hasParticipant: async () => true };
const io = () => { const sent = []; return { sent, to: (r) => ({ emit: (e, d) => sent.push([r, e, d]) }) }; };
const opts = (prisma, extra = {}) => ({ prisma, voiceStore: both, economyDisabled: async () => false, ...extra });

test('manda a gorjeta: tira de um, dá pro outro e avisa a call', async () => {
  const db = fakeDb();
  const sock = io();
  const r = await tips.tip(sock, { channelId: 'c1', fromId: 'a', toId: 'b', amount: 25 }, opts(db));
  assert.equal(r.ok, true);
  assert.deepEqual(db.coins, { a: 75, b: 25 });
  assert.deepEqual(db.rows.map((x) => [x.userId, x.coins, x.kind]), [['a', -25, 'CALL_TIP'], ['b', 25, 'CALL_TIP']]);
  assert.equal(sock.sent[0][1], 'voice:tip');
});

test('valor fora da lista, pra si mesmo ou fora da call: recusa', async () => {
  const db = fakeDb();
  assert.equal((await tips.tip(io(), { channelId: 'c1', fromId: 'a', toId: 'b', amount: 1000 }, opts(db))).ok, false);
  assert.equal((await tips.tip(io(), { channelId: 'c1', fromId: 'a', toId: 'a', amount: 10 }, opts(db))).ok, false);
  const r = await tips.tip(io(), { channelId: 'c1', fromId: 'a', toId: 'b', amount: 10 }, opts(db, { voiceStore: { hasParticipant: async (c, u) => u === 'a' } }));
  assert.equal(r.ok, false);
  assert.deepEqual(db.coins, { a: 100, b: 0 });
});

test('limite diário de envio e saldo', async () => {
  const db = fakeDb({ coins: { a: 1000, b: 0 } });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await tips.tip(io(), { channelId: 'c', fromId: 'a', toId: 'b', amount: 50 }, opts(db))).ok, true);
  }
  const r = await tips.tip(io(), { channelId: 'c', fromId: 'a', toId: 'b', amount: 10 }, opts(db));
  assert.equal(r.ok, false);
  assert.match(r.reason, /150/);
  const poor = fakeDb({ coins: { a: 5, b: 0 } });
  assert.match((await tips.tip(io(), { channelId: 'c', fromId: 'a', toId: 'b', amount: 10 }, opts(poor))).reason, /insuficientes/);
});

test('conta nova e Economia desligada não mandam', async () => {
  assert.equal((await tips.tip(io(), { channelId: 'c', fromId: 'a', toId: 'b', amount: 10 }, opts(fakeDb({ createdDaysAgo: 1 })))).ok, false);
  assert.equal((await tips.tip(io(), { channelId: 'c', fromId: 'a', toId: 'b', amount: 10 }, opts(fakeDb(), { economyDisabled: async () => true }))).ok, false);
});

test('o dia começa à meia-noite de Brasília', () => {
  assert.equal(tips.dayStart(Date.parse('2026-11-25T02:00:00Z')).toISOString(), '2026-11-24T03:00:00.000Z');
  assert.equal(tips.dayStart(Date.parse('2026-11-25T03:30:00Z')).toISOString(), '2026-11-25T03:00:00.000Z');
});
