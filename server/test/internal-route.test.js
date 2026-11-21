// Rota interna (Rust → Node): sem o segredo certo é 404, como se não existisse.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

// sem banco nos testes: a rota não chega a consultar (falta o userId)
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {}, loaded: true, id: 'prisma' };

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'segredo-de-teste';
const { internalSecret } = require('../src/routes/internal');

test('segredo interno = HMAC(JWT_ACCESS_SECRET, pc-internal-v1)', () => {
  const env = require('../src/config/env');
  const expected = crypto.createHmac('sha256', String(env.JWT_ACCESS_SECRET)).update('pc-internal-v1').digest('hex');
  assert.strictEqual(internalSecret(), expected);
  assert.strictEqual(internalSecret().length, 64);
});

test('sem o cabeçalho certo responde 404', async () => {
  const express = require('express');
  const { router } = require('../src/routes/internal');
  const app = express();
  app.use(express.json());
  app.use('/api/internal', router);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const none = await fetch(`http://127.0.0.1:${port}/api/internal/login-alert`, { method: 'POST' });
    assert.strictEqual(none.status, 404);
    const wrong = await fetch(`http://127.0.0.1:${port}/api/internal/login-alert`, {
      method: 'POST', headers: { 'x-pc-internal': 'x'.repeat(64), 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(wrong.status, 404);
    const right = await fetch(`http://127.0.0.1:${port}/api/internal/login-alert`, {
      method: 'POST', headers: { 'x-pc-internal': internalSecret(), 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(right.status, 400); // passou do segredo; falta o userId
  } finally {
    server.close();
  }
});
