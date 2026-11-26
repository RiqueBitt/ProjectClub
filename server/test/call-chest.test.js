// Baú da call (services/callChest.js).
const test = require('node:test');
const assert = require('node:assert');
const chest = require('../src/services/callChest');

const prismaOn = {
  platformSettings: { findUnique: async () => ({ disabledSystems: '[]' }) },
  user: { update: async () => ({}), findUnique: async ({ where }) => ({ id: where.id, username: where.id }) },
};
const fakeIo = () => {
  const sent = [];
  return { sent, to: (room) => ({ emit: (ev, data) => sent.push([room, ev, data]) }) };
};

test('só aparece em sala com 2+ pessoas e respeita o intervalo', async () => {
  chest._test.reset();
  require('../src/services/voiceRewards')._resetForTests();
  const io = fakeIo();
  const now = Date.now();
  const rooms = new Map([['c1', 1], ['c2', 2]]);
  const out = await chest.tick(rooms, io, { prisma: prismaOn, rand: () => 0, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].channelId, 'c2');
  assert.deepEqual(io.sent.map((s) => s[0] + ' ' + s[1]), ['voice:c2 voice:chest']);
  assert.ok(chest.get('c2'));
  // Já tem baú aberto → não abre outro.
  assert.equal((await chest.tick(rooms, io, { prisma: prismaOn, rand: () => 0, now })).length, 0);
  // Sorteio "perdeu" → nada.
  chest._test.reset();
  assert.equal((await chest.tick(rooms, io, { prisma: prismaOn, rand: () => 0.99, now })).length, 0);
});

test('o primeiro que abre leva; o segundo não', async () => {
  chest._test.reset();
  const io = fakeIo();
  const c = chest.spawn(io, 'c3');
  const paid = [];
  const awardXp = async (uid, xp, o) => { paid.push([uid, o.coins, o.kind]); return {}; };
  const opts = { prisma: prismaOn, awardXp, rand: () => 0.5, ledger: { recordTransaction: () => {} } };
  const [a, b] = await Promise.all([
    chest.claim(io, { channelId: 'c3', chestId: c.id, userId: 'ana' }, opts),
    chest.claim(io, { channelId: 'c3', chestId: c.id, userId: 'bia' }, opts),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(paid.length, 1);
  assert.equal(paid[0][0], 'ana');
  assert.equal(paid[0][2], 'CALL_CHEST');
  assert.ok(paid[0][1] >= 15 && paid[0][1] <= 40);
  assert.ok(io.sent.some((s) => s[1] === 'voice:chest-claimed' && s[2].user.id === 'ana'));
  assert.equal(chest.get('c3'), null);
});

test('limite de baús por dia por pessoa', async () => {
  chest._test.reset();
  const io = fakeIo();
  const opts = { prisma: prismaOn, awardXp: async () => ({}), rand: () => 0.5, ledger: { recordTransaction: () => {} } };
  for (let i = 0; i < chest.DAILY_CLAIMS; i += 1) {
    const c = chest.spawn(io, `d${i}`);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await chest.claim(io, { channelId: `d${i}`, chestId: c.id, userId: 'ana' }, opts)).ok, true);
  }
  const c = chest.spawn(io, 'extra');
  const r = await chest.claim(io, { channelId: 'extra', chestId: c.id, userId: 'ana' }, opts);
  assert.equal(r.ok, false);
  assert.ok(chest.get('extra'), 'o baú continua lá pra outra pessoa');
});

test('às vezes vem gema', () => {
  assert.equal(chest.rollReward(() => 0.5).gems, 0);
  assert.ok(chest.rollReward(() => 0.01).gems >= 1);
});

test('Economia desligada: nenhum baú', async () => {
  chest._test.reset();
  const off = { platformSettings: { findUnique: async () => ({ disabledSystems: '["economia"]' }) } };
  require('../src/services/voiceRewards')._resetForTests(); // zera o cache de 60 s
  const out = await chest.tick(new Map([['c9', 3]]), fakeIo(), { prisma: off, rand: () => 0, now: Date.now() + 3600_000 });
  assert.deepEqual(out, []);
});
