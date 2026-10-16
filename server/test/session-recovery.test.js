// Sessão que "perde o cookie novo" (app fechado antes de gravar no disco,
// servidor reiniciando no meio da renovação): o aparelho volta com o token
// anterior. Se o substituto nunca foi usado, a sessão é recuperada — não é
// roubo. Se o substituto já foi usado por alguém, continua sendo roubo.
// Também confere a sessão de 90 dias. Prisma falso em memória.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.REFRESH_TOKEN_TTL_DAYS = '30'; // valor antigo da hospedagem: o mínimo agora é 90
const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const UA = 'Mozilla/5.0 (Linux; Android 16; wv)';

let tokens; let users; let seq;
function reset() {
  tokens = new Map(); seq = 0;
  users = new Map([['u1', { id: 'u1', username: 'ana', displayName: 'Ana', platformRole: 'USER' }]]);
}
const byHash = (h) => [...tokens.values()].find((t) => t.tokenHash === h) || null;
const matches = (t, where) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && Array.isArray(v.in) ? v.in.includes(t[k]) : t[k] === v));
const fake = {
  refreshToken: {
    findUnique: async ({ where }) => (where.tokenHash ? byHash(where.tokenHash) : tokens.get(where.id) || null),
    create: async ({ data }) => { const t = { id: `t${++seq}`, revoked: false, revokedAt: null, revokedReason: null, replacedById: null, createdAt: new Date(), ...data }; tokens.set(t.id, t); return t; },
    update: async ({ where, data }) => Object.assign(tokens.get(where.id), data),
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const t of tokens.values()) if (matches(t, where)) { Object.assign(t, data); count++; }
      return { count };
    },
  },
  user: { findUnique: async ({ where }) => users.get(where.id) || null },
};
const stub = (rel, exports) => { require.cache[path.resolve(__dirname, rel)] = { exports, loaded: true, id: rel }; };
stub('../src/config/prisma.js', fake);
const keep = { revokedAll: false };
stub('../src/services/sessionKeep.js', {
  setKeepCookie: async () => {}, clearKeepCookie: () => {}, readKeepCookie: async () => null,
  markSessionsRevoked: async () => { keep.revokedAll = true; },
});
stub('../src/services/adminBootstrap.js', { maybePromoteToPlatformAdmin: async () => {} });
stub('../src/services/email.js', { sendVerificationCode: async () => {}, sendPasswordReset: async () => {}, sendNewLoginAlert: async () => {} });

const auth = require('../src/controllers/authController');
const env = require('../src/config/env');

function refresh(raw, userAgent = UA) {
  return new Promise((resolve, reject) => {
    const cookies = {};
    const res = {
      statusCode: 200, locals: {},
      status(c) { this.statusCode = c; return this; },
      cookie(name, value) { cookies[name] = value; },
      clearCookie(name) { cookies[name] = null; },
      json(body) { resolve({ status: this.statusCode, body, cookies }); },
    };
    auth.refresh({ cookies: raw ? { refreshToken: raw } : {}, headers: { 'user-agent': userAgent }, ip: '1.2.3.4' }, res, reject);
  });
}
async function login(ipAddress = null) {
  const raw = crypto.randomBytes(16).toString('hex');
  await fake.refreshToken.create({ data: { tokenHash: hash(raw), userId: 'u1', userAgent: UA, ipAddress, expiresAt: new Date(Date.now() + 86400000), sessionStartedAt: new Date(), lastUsedAt: new Date() } });
  return raw;
}
// Simula o tempo passando (fora da janela de corrida de 10 s).
const age = () => { for (const t of tokens.values()) if (t.revokedAt) t.revokedAt = new Date(t.revokedAt.getTime() - 60000); };

beforeEach(() => { reset(); keep.revokedAll = false; });

test('sessão dura pelo menos 90 dias, mesmo com 30 configurado', () => {
  assert.equal(env.REFRESH_TOKEN_TTL_DAYS, 90);
});

test('renovação normal troca o cookie', async () => {
  const a = await login();
  const r = await refresh(a);
  assert.equal(r.status, 200);
  assert.ok(r.body.accessToken);
  assert.ok(r.cookies.refreshToken && r.cookies.refreshToken !== a);
});

test('aparelho perdeu o cookie novo: volta com o anterior e a sessão é recuperada', async () => {
  const a = await login();
  const first = await refresh(a); // servidor gera o B, mas o app fecha antes de gravar
  assert.equal(first.status, 200);
  age();
  const again = await refresh(a); // reabre com o A
  assert.equal(again.status, 200, 'não manda pro login');
  assert.ok(again.body.accessToken);
  assert.equal(keep.revokedAll, false, 'não derruba as outras sessões');
  // O B (nunca usado) deixou de valer: só o cookie recuperado continua.
  const b = first.cookies.refreshToken;
  age();
  const usingB = await refresh(b);
  assert.equal(usingB.status, 401);
});

test('substituto já usado por outro: encerra SÓ essa sessão (os outros aparelhos continuam)', async () => {
  const other = await login(); // outro aparelho logado na mesma conta
  const a = await login();
  const first = await refresh(a);
  await refresh(first.cookies.refreshToken); // alguém usou o B
  age();
  const r = await refresh(a);
  assert.equal(r.status, 401);
  assert.equal(keep.revokedAll, false, 'não derruba o "lembrar login" de todo mundo');
  const live = [...tokens.values()].filter((t) => !t.revoked);
  assert.deepEqual(live.map((t) => t.tokenHash), [hash(other)], 'só o outro aparelho continua logado');
  const o = await refresh(other);
  assert.equal(o.status, 200, 'o PC não é deslogado "do nada"');
});

test('renovação atrasada do MESMO aparelho (mesmo app e rede) não é roubo', async () => {
  const a = await login('1.2.3.4');
  const first = await refresh(a);
  await refresh(first.cookies.refreshToken); // o app já renovou de novo
  age(); // a requisição com o A chega bem atrasada
  const r = await refresh(a);
  assert.equal(r.status, 200);
  assert.ok(r.body.accessToken);
  assert.ok([...tokens.values()].some((t) => !t.revoked), 'a sessão continua viva');
});

test('cookie antigo vindo de outro aparelho não recupera nada', async () => {
  const a = await login();
  await refresh(a);
  age();
  const r = await refresh(a, 'curl/8.0');
  assert.equal(r.status, 401);
  assert.ok([...tokens.values()].every((t) => t.revoked), 'a sessão roubada foi encerrada');
});

test('logout continua valendo: cookie de sessão encerrada não volta', async () => {
  const a = await login();
  await fake.refreshToken.updateMany({ where: { tokenHash: hash(a) }, data: { revoked: true, revokedAt: new Date(), revokedReason: 'LOGOUT' } });
  const r = await refresh(a);
  assert.equal(r.status, 401);
});
