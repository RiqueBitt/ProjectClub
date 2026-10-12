// Guerra das Cartas desligada temporariamente (config/features.js): toda
// rota /api/cards responde 503 "temporariamente desativado" antes de chegar
// no router do jogo. Baús/Economia não dependem deste interruptor.
const test = require('node:test');
const assert = require('node:assert');
const { FEATURES, isFeatureEnabled, requireFeature, CARDS_WAR_OFF_MSG } = require('../src/config/features');

function run(mw) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body, next: false }); },
    };
    mw({}, res, () => resolve({ next: true }));
  });
}

test('cardsWar está desligado no código', () => {
  assert.equal(FEATURES.cardsWar, false);
  assert.equal(isFeatureEnabled('cardsWar'), false);
});

test('rotas da Guerra das Cartas respondem 503 temporariamente desativado', async () => {
  const r = await run(requireFeature('cardsWar', { status: 503, message: CARDS_WAR_OFF_MSG }));
  assert.equal(r.next, false);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /temporariamente desativado/);
  assert.equal(r.body.featureDisabled, 'cardsWar');
});

test('os outros interruptores continuam com 404 por padrão', async () => {
  const r = await run(requireFeature('houses'));
  assert.equal(r.status, 404);
});
