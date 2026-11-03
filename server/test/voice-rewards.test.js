// XP e moedas por tempo em call (services/voiceRewards.js).
const test = require('node:test');
const assert = require('node:assert');
const vr = require('../src/services/voiceRewards');

const prisma = (disabled = []) => ({ platformSettings: { findUnique: async () => ({ disabledSystems: JSON.stringify(disabled) }) } });

test('paga a cada 5 minutos e para no teto do dia', () => {
  assert.equal(vr.rewardFor(1), null);
  assert.deepEqual(vr.rewardFor(5), { xp: vr.XP_PER_BLOCK, coins: vr.COINS_PER_BLOCK });
  assert.equal(vr.rewardFor(7), null);
  assert.ok(vr.rewardFor(vr.DAILY_CAP_MIN));
  assert.equal(vr.rewardFor(vr.DAILY_CAP_MIN + vr.BLOCK_MIN), null);
});

test('5 minutos em call: XP + moedas e aviso pra pessoa', async () => {
  vr._resetForTests();
  const paid = [];
  const notes = [];
  const io = { notifyUser: (uid, ev, data) => notes.push([uid, ev, data]) };
  const awardXp = async (uid, xp, o) => { paid.push([uid, xp, o.coins]); return { xp, levelUp: false }; };
  const now = new Date(Date.UTC(2026, 10, 2, 15));
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await vr.tick(new Set(['ana', 'bia']), io, { prisma: prisma(), awardXp, redis: null, now });
  }
  assert.deepEqual(paid, [['ana', vr.XP_PER_BLOCK, vr.COINS_PER_BLOCK], ['bia', vr.XP_PER_BLOCK, vr.COINS_PER_BLOCK]]);
  assert.equal(notes.filter((n) => n[1] === 'economy:voice-reward').length, 2);
  assert.equal(await vr.minutesToday('ana', { redis: null, now }), 5);
  // Dia novo (Brasília) recomeça a contagem.
  assert.equal(await vr.minutesToday('ana', { redis: null, now: new Date(Date.UTC(2026, 10, 3, 15)) }), 0);
});

test('Economia desligada pela staff: não paga nada', async () => {
  vr._resetForTests();
  let called = false;
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await vr.tick(new Set(['ana']), null, { prisma: prisma(['economia']), awardXp: async () => { called = true; }, redis: null });
  }
  assert.equal(called, false);
});
