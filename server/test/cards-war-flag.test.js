// Guerra das Cartas (config/features.js): religada em out/2026. O
// interruptor continua existindo — com false, toda rota /api/cards
// responde 503 "temporariamente desativado" antes de chegar no router do
// jogo. Baús/Economia não dependem deste interruptor.
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

test('cardsWar está ligado no código', () => {
  assert.equal(FEATURES.cardsWar, true);
  assert.equal(isFeatureEnabled('cardsWar'), true);
});

test('com o jogo ligado, as rotas da Guerra das Cartas passam pelo interruptor', async () => {
  const r = await run(requireFeature('cardsWar', { status: 503, message: CARDS_WAR_OFF_MSG }));
  assert.equal(r.next, true);
});

test('cliente e servidor concordam sobre a Guerra das Cartas', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../../client/src/utils/features.js'), 'utf8');
  assert.match(src, /cardsWar:\s*true/);
});

test('os outros interruptores continuam com 404 por padrão', async () => {
  const r = await run(requireFeature('houses'));
  assert.equal(r.status, 404);
});
