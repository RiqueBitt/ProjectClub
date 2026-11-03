// Soundboard (services/soundboard.js): limites anti-spam e limpeza de nome.
const test = require('node:test');
const assert = require('node:assert');
const sb = require('../src/services/soundboard');

test('nome e emoji limpos', () => {
  assert.equal(sb.cleanName('  Risada   alta '), 'Risada alta');
  assert.equal(sb.cleanName('x'), null);
  assert.equal(sb.cleanName('<script>oi</script>'), 'scriptoi/script');
  assert.equal(sb.cleanName('a'.repeat(50)).length, 32);
  assert.equal(sb.cleanEmoji('😂🔥💀'), '😂🔥');
  assert.equal(sb.cleanEmoji(''), null);
});

test('uma pessoa: 1 som a cada 3 s', () => {
  sb._resetForTests();
  const t = 1_000_000;
  assert.equal(sb.allow('ana', 'c1', t).ok, true);
  assert.equal(sb.allow('ana', 'c1', t + 1000).ok, false);
  assert.equal(sb.allow('ana', 'c1', t + sb.USER_COOLDOWN_MS).ok, true);
});

test('sala: no máximo 4 sons a cada 10 s somando todo mundo', () => {
  sb._resetForTests();
  const t = 2_000_000;
  for (let i = 0; i < sb.ROOM_BURST; i += 1) assert.equal(sb.allow(`u${i}`, 'c1', t + i).ok, true);
  assert.equal(sb.allow('u9', 'c1', t + 10).ok, false);
  assert.equal(sb.allow('u9', 'c2', t + 10).ok, true); // outra sala não conta
  assert.equal(sb.allow('u8', 'c1', t + 10_011).ok, true);
});

test('acha o som pelo id (com cache)', async () => {
  sb._resetForTests();
  let calls = 0;
  const prisma = { soundboardSound: { findMany: async () => { calls += 1; return [{ id: 's1', name: 'Uau', url: '/u/s1.mp3' }]; } } };
  assert.equal((await sb.findSound('s1', { prisma })).name, 'Uau');
  assert.equal(await sb.findSound('nada', { prisma }), null);
  assert.equal(calls, 1);
});
