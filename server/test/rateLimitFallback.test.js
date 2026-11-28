const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Sem Redis de verdade: o módulo só precisa do cliente pra montar o store.
const redisId = path.resolve(__dirname, '../src/config/redis.js');
require.cache[redisId] = { id: redisId, filename: redisId, loaded: true, exports: { redis: { status: 'end', call: async () => { throw new Error('sem redis'); } } } };
const { MemoryStore } = require('express-rate-limit');
const { createFallbackStore } = require('../src/config/rateLimitStore');

const OPTS = { windowMs: 60_000 };

test('limite com Redis fora: conta na memória em vez de dar erro', async () => {
  const fallback = new MemoryStore();
  let warned = 0;
  const store = createFallbackStore({
    primary: { prefix: 'x:', init() {}, increment: async () => { throw new Error('ECONNREFUSED'); } },
    fallback,
    onFallback: () => { warned += 1; },
  });
  store.init(OPTS);
  // (o MemoryStore devolve o mesmo objeto a cada vez: lê o número na hora)
  assert.equal((await store.increment('1.2.3.4')).totalHits, 1);
  assert.equal((await store.increment('1.2.3.4')).totalHits, 2);
  assert.ok(warned >= 1);
  store.shutdown();
});

test('limite com Redis desconectado: nem tenta o Redis (não espera o erro)', async () => {
  let tried = 0;
  const store = createFallbackStore({
    primary: { prefix: 'x:', init() {}, increment: async () => { tried += 1; return { totalHits: 99 }; } },
    fallback: new MemoryStore(),
    isReady: () => false,
  });
  store.init(OPTS);
  const r = await store.increment('k');
  assert.equal(tried, 0);
  assert.equal(r.totalHits, 1);
  store.shutdown();
});

test('limite com Redis no ar: usa o Redis (contagem compartilhada)', async () => {
  const store = createFallbackStore({
    primary: { prefix: 'x:', init() {}, increment: async () => ({ totalHits: 7, resetTime: new Date() }), decrement: async () => {}, resetKey: async () => {} },
    fallback: new MemoryStore(),
  });
  store.init(OPTS);
  assert.equal((await store.increment('k')).totalHits, 7);
  assert.equal(store.localKeys, false);
  assert.equal(store.prefix, 'x:');
  store.shutdown();
});

test('limite com Redis fora, no servidor de verdade: responde normal e ainda barra o excesso (antes era 500 em tudo)', async (t) => {
  const express = require('express');
  const rateLimit = require('express-rate-limit');
  const app = express();
  const store = createFallbackStore({
    primary: { prefix: 'ratelimit:teste:', init() {}, increment: async () => { throw new Error('Connection is closed.'); } },
    fallback: new MemoryStore(),
  });
  app.use(rateLimit({ windowMs: 60_000, max: 2, store, standardHeaders: true, legacyHeaders: false }));
  app.get('/', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  t.after(() => { server.close(); store.shutdown(); });
  await new Promise((r) => { server.once('listening', r); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const codes = [];
  for (let i = 0; i < 3; i += 1) codes.push((await fetch(url)).status); // eslint-disable-line no-await-in-loop
  assert.deepEqual(codes, [200, 200, 429]);
});
