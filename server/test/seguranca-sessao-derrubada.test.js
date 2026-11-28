// Segurança: derrubar sessões (troca de senha, "sair dos outros aparelhos",
// staff…) vale NA HORA para o token de acesso e para os sockets — antes, um
// token roubado seguia valendo até vencer (15 min) e um socket aberto seguia
// recebendo DMs sem prazo. Ver services/tokenRevocation.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

const kv = new Map();
let redisDown = false;
stub('config/redis.js', {
  redis: {
    get: async (k) => { if (redisDown) throw new Error('fora'); return kv.get(k) ?? null; },
    mget: async (ks) => ks.map((k) => kv.get(k) ?? null),
    set: async (k, v) => { kv.set(k, v); return 'OK'; },
    on: () => {},
  },
  cacheGetOrSet: async (k, t, f) => f(),
  cacheInvalidate: async () => {},
});
stub('config/prisma.js', {
  user: { findUnique: async ({ where }) => ({ id: where.id, platformRole: 'USER', isPlatformBanned: false }) },
  platformSettings: { findUnique: async () => ({ maintenanceMode: false }) },
});
stub('services/activeDays.js', { markActive: () => {} });

const env = require(src('config/env.js'));
const revocation = require(src('services/tokenRevocation.js'));
const { requireAuth } = require(src('middleware/auth.js'));
const sessionKeep = require(src('services/sessionKeep.js'));

const tokenAt = (sub, iatSec) => jwt.sign({ sub, iat: iatSec }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
async function call(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  let status = 200; let body = null; let passed = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  await requireAuth(req, res, () => { passed = true; });
  return { status, body, passed };
}

beforeEach(() => { kv.clear(); redisDown = false; });

test('token emitido antes da derrubada é recusado (401); o emitido depois passa', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = tokenAt('u1', now - 60);
  assert.equal((await call(old)).passed, true, 'antes de derrubar, vale');
  await sessionKeep.markSessionsRevoked('u1'); // = troca de senha etc.
  const r = await call(old);
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
  const fresh = tokenAt('u1', Math.floor(Date.now() / 1000) + 1);
  assert.equal((await call(fresh)).passed, true, 'token novo (renovado) vale');
  // Outra pessoa não é afetada.
  assert.equal((await call(tokenAt('u2', now - 60))).passed, true);
});

test('token do mesmo segundo da derrubada ainda vale (quem trocou a senha renova sem cair)', () => {
  assert.equal(revocation.isStale(1000, 1_000_500), false);
  assert.equal(revocation.isStale(999, 1_000_500), true);
  assert.equal(revocation.isStale(5, 0), false);
});

test('Redis fora do ar: não derruba ninguém e não trava o pedido', async () => {
  redisDown = true;
  const t0 = Date.now();
  const r = await call(tokenAt('u1', Math.floor(Date.now() / 1000) - 60));
  assert.equal(r.passed, true);
  assert.ok(Date.now() - t0 < 1000);
});

test('derrubada no Node avisa na hora quem cuida dos sockets', async () => {
  const seen = [];
  const off = revocation.onRevoke((uid, at) => seen.push([uid, at]));
  await sessionKeep.markSessionsRevoked('u9');
  off();
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'u9');
  assert.deepEqual(await revocation.revokedAtMany(['u9', 'nada']), [seen[0][1], 0]);
});
