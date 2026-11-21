'use strict';
// Idade do pinguim no cartão: dias reais desde a criação (não a data "virtual" de 2012).
const test = require('node:test');
const assert = require('node:assert');
const { realAgeDays } = require('../waddle/dist/server/socket-server/world/world-penguin');

test('idade: pinguim criado há 2 dias tem 2 dias', () => {
  const now = Date.UTC(2026, 10, 5, 12);
  assert.strictEqual(realAgeDays(Date.UTC(2026, 10, 3, 10), now), 2);
  assert.strictEqual(realAgeDays(now - 1000, now), 0);
});

test('idade: data inválida ou no futuro não vira número estranho', () => {
  assert.strictEqual(realAgeDays(NaN), 0);
  assert.strictEqual(realAgeDays(0), 0);
  assert.strictEqual(realAgeDays(Date.now() + 86400000 * 5), 0);
});
