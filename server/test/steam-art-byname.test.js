// Biblioteca de jogos: App ID da Steam pelo nome (capa de jogo sem App ID).
// Redis falso em memória (não conecta em nada).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const store = new Map();
const fakeRedis = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  set: async (k, v) => { store.set(k, v); return 'OK'; },
};
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = {
  exports: { redis: fakeRedis, cacheGetOrSet: async (k, t, fn) => fn(), cacheInvalidate: async () => {} }, loaded: true, id: 'redis',
};

const steamArt = require('../src/services/steamArtService');

test('normaliza nome (acentos, ®, ™, pontuação)', () => {
  assert.equal(steamArt.normalizeGameName('Overwatch® 2'), 'overwatch 2');
  assert.equal(steamArt.normalizeGameName("Baldur's Gate 3"), 'baldur s gate 3');
  assert.equal(steamArt.normalizeGameName('PUBG: BATTLEGROUNDS™'), 'pubg battlegrounds');
});

test('só aceita nome igual e guarda no cache', async () => {
  let calls = 0;
  const search = async () => { calls += 1; return [{ type: 'app', id: 999, name: 'Overwatch Legacy' }, { type: 'app', id: 2357570, name: 'Overwatch® 2' }]; };
  assert.equal(await steamArt.findAppIdByName('Overwatch 2', search), 2357570);
  assert.equal(await steamArt.findAppIdByName('overwatch 2', search), 2357570);
  assert.equal(calls, 1, 'segunda vez vem do cache');
  assert.equal(store.get('cache:steamart:byname:overwatch 2'), '2357570');
});

test('nome parecido não vira outro jogo; Steam fora não grava "não tem" longo', async () => {
  const search = async () => [{ type: 'app', id: 1, name: 'Minecraft Dungeons' }];
  assert.equal(await steamArt.findAppIdByName('Minecraft', search), null);
  steamArt._test.byNameMemory.clear();
  store.clear();
  assert.equal(await steamArt.findAppIdByName('Algum Jogo', async () => null), null);
  assert.equal(store.get('cache:steamart:byname:algum jogo'), '');
});
