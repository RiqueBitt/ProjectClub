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

test('/kick derruba os sockets da pessoa pelo io do app', async () => {
  const express = require('express');
  const { router } = require('../src/routes/internal');
  const app = express();
  const kicked = [];
  app.set('io', { kickUser: (...args) => kicked.push(args) });
  app.use(express.json());
  app.use('/api/internal', router);
  const server = app.listen(0);
  const port = server.address().port;
  const post = (body) => fetch(`http://127.0.0.1:${port}/api/internal/kick`, {
    method: 'POST', headers: { 'x-pc-internal': internalSecret(), 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.strictEqual((await post({ userId: 'u1' })).status, 400);
    const ok = await post({ userId: 'u1', event: 'account:disabled', payload: { temporary: true } });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(kicked, [['u1', 'account:disabled', { temporary: true }]]);
  } finally {
    server.close();
  }
});

test('/realtime emite na ordem, com salas e exceções, e repassa a presença', async () => {
  const express = require('express');
  const { router } = require('../src/routes/internal');
  const app = express();
  const log = [];
  const chain = (to = [], except = []) => ({
    to: (r) => chain([...to, r], except),
    except: (r) => chain(to, [...except, r]),
    emit: (event, payload) => log.push({ to, except, event, payload }),
  });
  const io = chain();
  io.emitPresenceUpdate = (u) => log.push({ presence: u.id });
  io.onManualStatusChange = (id, st) => log.push({ manual: `${id}:${st}` });
  app.set('io', io);
  app.use(express.json());
  app.use('/api/internal', router);
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/internal/realtime`, {
      method: 'POST', headers: { 'x-pc-internal': internalSecret(), 'content-type': 'application/json' },
      body: JSON.stringify({
        emits: [
          { to: ['user:u1'], event: 'user:update', payload: { id: 'u1' } },
          { to: ['community'], except: ['user:u1'], event: 'user:update', payload: { id: 'u1', p: 1 } },
        ],
        presence: { user: { id: 'u1', status: 'DND' }, manualStatus: 'DND' },
      }),
    });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(log, [
      { to: ['user:u1'], except: [], event: 'user:update', payload: { id: 'u1' } },
      { to: ['community'], except: ['user:u1'], event: 'user:update', payload: { id: 'u1', p: 1 } },
      { presence: 'u1' },
      { manual: 'u1:DND' },
    ]);
  } finally {
    server.close();
  }
});
