'use strict';
// Cuidado dos puffles (desgaste com o tempo) e SWID das curtidas de iglu.
const test = require('node:test');
const assert = require('node:assert');
const { refreshPuffleStats } = require('../waddle/dist/server/socket-server/world/world-penguin');
const { swidOf, idOfSwid } = require('../waddle/dist/server/socket-server/handlers/igloo');

test('puffle: status caem 1 ponto a cada 30 min e param em 10', () => {
  const t0 = Date.UTC(2026, 10, 5, 12);
  const p = { id: 1, name: 'Bolinha', type: 0, food: 100, rest: 80, clean: 12, play: 100, careAt: t0 };
  refreshPuffleStats(p, t0 + 3 * 30 * 60 * 1000 + 1000);
  assert.deepStrictEqual([p.food, p.rest, p.clean, p.play], [97, 77, 10, 97]);
  refreshPuffleStats(p, t0 + 1000 * 3600 * 1000);
  assert.deepStrictEqual([p.food, p.rest, p.clean, p.play], [10, 10, 10, 10]);
});

test('puffle antigo (sem campos novos) ganha adoção/brincadeira sem perder status', () => {
  const now = Date.now();
  const p = { id: 2, name: 'Rosa', type: 4, food: 60, rest: 70, clean: 80 };
  refreshPuffleStats(p, now);
  assert.strictEqual(p.play, 100);
  assert.strictEqual(p.hat, 0);
  assert.strictEqual(p.adopted, now);
  assert.deepStrictEqual([p.food, p.rest, p.clean], [60, 70, 80]);
});

test('curtidas: SWID guarda o id do pinguim', () => {
  assert.strictEqual(swidOf(42), '{00000000-0000-0000-0000-000000000042}');
  assert.strictEqual(idOfSwid(swidOf(123456)), 123456);
  assert.strictEqual(idOfSwid('lixo'), null);
});
