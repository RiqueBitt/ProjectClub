// Rodada perf3: gravações idempotentes (P2002), Server-Timing/[lento],
// cache compartilhado, máscara do "invisível", ErrorLog, faxina diária e
// permissões em lote. Sem banco nem Redis: tudo trocado por versões falsas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };
const p2002 = () => Object.assign(new Error('Unique constraint failed on the constraint: `PushToken_token_key`'), { code: 'P2002' });
const p2025 = () => Object.assign(new Error('Record to update not found.'), { code: 'P2025' });

// Redis falso em memória (cacheGetOrSet/cacheInvalidate iguais aos reais).
const fakeStore = new Map();
stub('config/redis.js', {
  redis: { set: async () => 'OK' },
  cacheGetOrSet: async (key, ttl, compute) => {
    if (fakeStore.has(key)) return JSON.parse(fakeStore.get(key));
    const v = await compute();
    fakeStore.set(key, JSON.stringify(v));
    return v;
  },
  cacheInvalidate: async (key) => { fakeStore.delete(key); },
});

// ---------- safeUpsert / createIgnoreDuplicate ----------
test('safeUpsert: perdeu a corrida (P2002) => aplica o update na linha existente', async () => {
  const { safeUpsert } = require(src('utils/prismaSafe.js'));
  const calls = [];
  const delegate = {
    upsert: async () => { calls.push('upsert'); throw p2002(); },
    update: async (args) => { calls.push('update'); return { ...args.where, ...args.data }; },
  };
  const row = await safeUpsert(delegate, { where: { token: 't' }, update: { userId: 'u2' }, create: { token: 't', userId: 'u2' } });
  assert.deepEqual(calls, ['upsert', 'update']);
  assert.deepEqual(row, { token: 't', userId: 'u2' });
});

test('safeUpsert: linha apagada no meio (P2025) => tenta o upsert de novo; outros erros sobem', async () => {
  const { safeUpsert } = require(src('utils/prismaSafe.js'));
  let n = 0;
  const delegate = {
    upsert: async () => { n += 1; if (n === 1) throw p2002(); return { ok: true }; },
    update: async () => { throw p2025(); },
  };
  assert.deepEqual(await safeUpsert(delegate, { where: { id: 1 }, update: {}, create: {} }), { ok: true });
  assert.equal(n, 2);
  const boom = { upsert: async () => { throw new Error('banco caiu'); }, update: async () => ({}) };
  await assert.rejects(safeUpsert(boom, { where: {}, update: {}, create: {} }), /banco caiu/);
});

test('createIgnoreDuplicate: duplicado vira null, outro erro sobe', async () => {
  const { createIgnoreDuplicate } = require(src('utils/prismaSafe.js'));
  assert.equal(await createIgnoreDuplicate({ create: async () => { throw p2002(); } }, { data: {} }), null);
  assert.deepEqual(await createIgnoreDuplicate({ create: async (a) => a.data }, { data: { x: 1 } }), { x: 1 });
  await assert.rejects(createIgnoreDuplicate({ create: async () => { throw new Error('x'); } }, { data: {} }), /x/);
});

// ---------- POST /api/push/register ----------
test('push/register: corrida/token de outra conta não dá 500 — passa pra conta atual', async () => {
  const rows = new Map([['tok-A', { token: 'tok-A', userId: 'outra-conta', platform: 'android' }]]);
  let upserts = 0;
  stub('config/prisma.js', {
    pushToken: {
      // Simula o upsert não-atômico do Prisma no MySQL perdendo a corrida.
      upsert: async () => { upserts += 1; throw p2002(); },
      update: async ({ where, data }) => {
        const r = rows.get(where.token);
        if (!r) throw p2025();
        Object.assign(r, data);
        return r;
      },
    },
  });
  delete require.cache[src('controllers/pushController.js')];
  const { registerToken } = require(src('controllers/pushController.js'));
  const call = (body) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    registerToken({ user: { id: 'eu' }, body }, res, reject);
  });
  const r = await call({ token: '  tok-A  ', platform: 'android' });
  assert.equal(r.status, 201);
  assert.equal(upserts, 1);
  assert.equal(rows.get('tok-A').userId, 'eu');
  // repetido: continua 201 (idempotente)
  assert.equal((await call({ token: 'tok-A' })).status, 201);
  assert.equal((await call({ token: '   ' })).status, 400);
  assert.equal((await call({ token: 'x'.repeat(300) })).status, 400);
});

// ---------- Server-Timing + [lento] ----------
function fakeRes() {
  const res = new EventEmitter();
  const headers = {};
  res.headersSent = false;
  res.statusCode = 200;
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };
  res.writeHead = function writeHead() { this.headersSent = true; return this; };
  res.headers = headers;
  return res;
}

test('timing: Server-Timing no cabeçalho e log [lento] só da API acima do limite, sem query string', async () => {
  const { timingMiddleware } = require(src('middleware/timing.js'));
  const logs = [];
  const mw = timingMiddleware({ slowMs: 5, log: (m) => logs.push(m) });
  const res = fakeRes();
  mw({ method: 'GET', originalUrl: '/api/bootstrap?token=segredo' }, res, () => {});
  await new Promise((r) => setTimeout(r, 20));
  res.writeHead(200);
  assert.match(res.headers['server-timing'], /^app;dur=\d+(\.\d)?$/);
  res.emit('finish');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[lento\] GET \/api\/bootstrap \d+ms$/);
  assert.ok(!logs[0].includes('segredo'));

  const fast = timingMiddleware({ slowMs: 10_000, log: (m) => logs.push(m) });
  const res2 = fakeRes();
  fast({ method: 'GET', originalUrl: '/api/x' }, res2, () => {});
  res2.emit('finish');
  const slowStatic = timingMiddleware({ slowMs: -1, log: (m) => logs.push(m) });
  const res3 = fakeRes();
  slowStatic({ method: 'GET', originalUrl: '/assets/app.js' }, res3, () => {});
  res3.emit('finish');
  assert.equal(logs.length, 1);
});

// ---------- cache compartilhado ----------
test('sharedCache: escrita 2xx apaga as seções certas; GET e erro não apagam', async () => {
  const { sectionsForPath, invalidateOnWrite, getShared, KEYS } = require(src('services/sharedCache.js'));
  assert.deepEqual(sectionsForPath('/ui-layout/PC'), ['uiLayout']);
  assert.deepEqual(sectionsForPath('/community/channels/1'), ['community']);
  assert.ok(sectionsForPath('/admin/maintenance').includes('status'));
  assert.deepEqual(sectionsForPath('/messages'), []);
  assert.deepEqual(sectionsForPath('/eventsx'), []);

  let computes = 0;
  const compute = async () => { computes += 1; return { v: computes }; };
  assert.deepEqual(await getShared('uiLayout', compute), { v: 1 });
  assert.deepEqual(await getShared('uiLayout', compute), { v: 1 }); // do cache

  const run = (method, p, status) => {
    const res = new EventEmitter();
    res.statusCode = status;
    invalidateOnWrite({ method, path: p }, res, () => {});
    res.emit('finish');
  };
  run('GET', '/ui-layout', 200);
  run('PUT', '/ui-layout/PC', 403);
  await new Promise((r) => setImmediate(r));
  assert.ok(fakeStore.has(`${KEYS.uiLayout}`));
  run('PUT', '/ui-layout/PC', 200);
  await new Promise((r) => setImmediate(r));
  assert.ok(!fakeStore.has(`${KEYS.uiLayout}`));
  assert.deepEqual(await getShared('uiLayout', compute), { v: 2 });
});

// ---------- status invisível ----------
test('maskDeep: INVISIBLE vira OFFLINE pros outros, você continua vendo; original intacto', () => {
  const { maskDeep, viewerFromRooms } = require(src('utils/presenceVisibility.js'));
  const other = { id: 'b', status: 'INVISIBLE', displayName: 'B' };
  const me = { id: 'a', status: 'INVISIBLE' };
  const body = { messages: [{ id: 'm1', status: 'OK', author: other }, { id: 'm2', author: me }], when: new Date(0) };
  const out = maskDeep(body, 'a');
  assert.equal(out.messages[0].author.status, 'OFFLINE');
  assert.equal(out.messages[1].author.status, 'INVISIBLE'); // o próprio
  assert.equal(out.messages[1], body.messages[1]); // sem cópia à toa
  assert.equal(other.status, 'INVISIBLE'); // original não muda
  assert.ok(out.when instanceof Date);
  const untouched = { a: [{ id: 'x', status: 'ONLINE' }] };
  assert.equal(maskDeep(untouched, null), untouched);
  assert.equal(maskDeep(other, null).status, 'OFFLINE'); // sem login: mascara
  assert.equal(viewerFromRooms(new Set(['user:abc'])), 'abc');
  assert.equal(viewerFromRooms(new Set(['community'])), null);
  assert.equal(viewerFromRooms(new Set(['user:a', 'user:b'])), null);
});

test('maskInvisibleResponses: res.json mascara pra quem pediu (e /me continua igual)', () => {
  const { maskInvisibleResponses } = require(src('utils/presenceVisibility.js'));
  let sent = null;
  const res = { json(b) { sent = b; return this; } };
  const req = { user: { id: 'a' } };
  maskInvisibleResponses(req, res, () => {});
  res.json({ user: { id: 'a', status: 'INVISIBLE' }, friends: [{ user: { id: 'b', status: 'INVISIBLE' } }] });
  assert.equal(sent.user.status, 'INVISIBLE');
  assert.equal(sent.friends[0].user.status, 'OFFLINE');
});

// ---------- ErrorLog ----------
test('errorLog: agrupa por fingerprint e grava no máximo 1x por 10s, somando as repetições', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const log = require(src('services/errorLog.js'));
  log._resetForTests();
  const writes = [];
  log._setPrismaForTests({
    errorLog: {
      upsert: async (args) => { writes.push(args); return { id: 'x' }; },
      update: async () => ({}),
    },
  });
  const e = { source: 'server', message: 'Falhou user 123', stack: 'Error\n    at fn (/app/src/x.js:1:2)', url: 'GET /api/x?token=abc' };
  await log.persistError(e);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].create.count, 1);
  assert.equal(writes[0].create.url, 'GET /api/x'); // sem query string
  // mesmo erro com outro id => mesmo grupo, dentro da janela => não grava
  log.persistError({ ...e, message: 'Falhou user 456' });
  log.persistError({ ...e, message: 'Falhou user 789' });
  await Promise.resolve();
  assert.equal(writes.length, 1);
  t.mock.timers.tick(log.WRITE_WINDOW_MS);
  await new Promise((r) => setImmediate(r));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].update.count, { increment: 2 });
  assert.equal(writes[0].where.fingerprint, writes[1].where.fingerprint);
  assert.notEqual(log.fingerprintOf({ source: 'client', message: 'Falhou user 1' }), log.fingerprintOf({ source: 'server', message: 'Falhou user 1' }));
  log._resetForTests();
});

// ---------- faxina diária ----------
test('cleanupJobs: apaga em lote com os filtros certos, loga as contagens e respeita o lock', async () => {
  const { runCleanup, buildTasks } = require(src('services/cleanupJobs.js'));
  const now = Date.UTC(2026, 9, 12);
  const tasks = Object.fromEntries(buildTasks(now).map((x) => [x.name, x]));
  assert.equal(tasks.UserNotice.where.readAt.not, null);
  assert.equal(tasks.ActivityEvent.where.createdAt.lt.getTime(), now - 90 * 86400000);
  assert.equal(tasks.ErrorLog.where.lastSeen.lt.getTime(), now - 30 * 86400000);
  assert.equal(tasks.PasswordResetToken.where.expiresAt.lt.getTime(), now - 7 * 86400000);

  const made = (n) => {
    let left = n;
    return {
      findMany: async ({ take }) => { const k = Math.min(left, take); return Array.from({ length: k }, (_, i) => ({ id: `${n}-${left - i}` })); },
      deleteMany: async ({ where }) => { left -= where.id.in.length; return { count: where.id.in.length }; },
    };
  };
  const prisma = {
    refreshToken: made(3), passwordResetToken: made(0), emailVerificationCode: made(1),
    twoFactorRecoveryCode: made(0), activityEvent: made(5001), userNotice: made(2),
    // errorLog ausente (client antigo) => pulado sem erro
  };
  const logs = [];
  const r = await runCleanup({ prisma, redis: { set: async () => 'OK' }, now, log: (m) => logs.push(m) });
  assert.equal(r.counts.RefreshToken, 3);
  assert.equal(r.counts.ActivityEvent, 5001);
  assert.equal(r.counts.ErrorLog, undefined);
  assert.match(logs[0], /^\[limpeza\] RefreshToken=3 .*ActivityEvent=5001/);
  const locked = await runCleanup({ prisma, redis: { set: async () => null }, now, log: () => {} });
  assert.deepEqual(locked, { skipped: true });
});

// ---------- permissões em lote ----------
test('getEffectivePermissionsForChannels: mesmo resultado do cálculo por canal, em poucas consultas', async () => {
  const { PERMISSIONS } = require(src('services/permissions.js'));
  const VIEW = PERMISSIONS.VIEW_CHANNEL;
  let queries = 0;
  const overwrites = [
    { channelId: 'c1', categoryId: null, targetType: 'ROLE', targetId: 'everyone', allow: '0', deny: VIEW.toString() },
    { channelId: 'c1', categoryId: null, targetType: 'MEMBER', targetId: 'u1', allow: VIEW.toString(), deny: '0' },
    { channelId: null, categoryId: 'k1', targetType: 'ROLE', targetId: 'everyone', allow: '0', deny: VIEW.toString() },
  ];
  stub('config/prisma.js', {
    user: { findUnique: async () => { queries += 1; return { id: 'u1', platformRole: 'USER' }; } },
    userRole: { findMany: async () => { queries += 1; return []; } },
    role: { findFirst: async () => { queries += 1; return { id: 'everyone', isDefault: true, permissions: VIEW.toString() }; } },
    permissionOverwrite: { findMany: async () => { queries += 1; return overwrites; } },
  });
  delete require.cache[src('services/authz.js')];
  const { getEffectivePermissionsForChannels } = require(src('services/authz.js'));
  const { has } = require(src('services/permissions.js'));
  const map = await getEffectivePermissionsForChannels('u1', [
    { id: 'c1', categoryId: null }, { id: 'c2', categoryId: 'k1' }, { id: 'c3', categoryId: null },
  ]);
  assert.equal(has(map.get('c1'), 'VIEW_CHANNEL'), true); // liberado pra mim
  assert.equal(has(map.get('c2'), 'VIEW_CHANNEL'), false); // categoria nega
  assert.equal(has(map.get('c3'), 'VIEW_CHANNEL'), true);
  assert.ok(queries <= 4);
});
