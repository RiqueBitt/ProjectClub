// Primeiros passos (resgate idempotente e validado no servidor), rotas da
// staff (só ADMIN/MODERATOR; backup só ADMIN) e backup do banco (rotação,
// lock, dump em Node, falha com aviso). Prisma e Redis falsos em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const http = require('node:http');
const { Writable } = require('node:stream');

const src = (rel) => path.resolve(__dirname, '../src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

// ---------- Banco falso ----------
const db = {
  users: new Map(),
  steps: new Map(), // `${userId}|${step}` -> row
  messages: [],
  reactions: [],
  webPush: [],
  pushTokens: [],
  backups: [],
  notices: [],
  ledger: [],
  errorLogs: [],
  tableRows: [],
};
const stepKey = (u, s) => `${u}|${s}`;
let seq = 0;
function matchBackup(r, where = {}) {
  if (where.status && r.status !== where.status) return false;
  if (where.startedAt?.lt && !(r.startedAt < where.startedAt.lt)) return false;
  if (where.startedAt?.gte && !(r.startedAt >= where.startedAt.gte)) return false;
  return true;
}
const fakePrisma = {
  user: {
    findUnique: async ({ where }) => { const u = db.users.get(where.id); return u ? { ...u } : null; },
    findMany: async ({ where } = {}) => [...db.users.values()].filter((u) => !where?.platformRole?.in || where.platformRole.in.includes(u.platformRole)).map((u) => ({ id: u.id })),
    update: async ({ where, data }) => {
      const u = db.users.get(where.id);
      if (data.coins?.increment) u.coins += data.coins.increment;
      return { coins: u.coins, gems: u.gems || 0 };
    },
  },
  userOnboardingStep: {
    findMany: async ({ where }) => [...db.steps.values()].filter((r) => r.userId === where.userId).map((r) => ({ ...r })),
    findUnique: async ({ where }) => { const r = db.steps.get(stepKey(where.userId_step.userId, where.userId_step.step)); return r ? { ...r } : null; },
    create: async ({ data }) => {
      const k = stepKey(data.userId, data.step);
      if (db.steps.has(k)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
      const row = { completedAt: null, claimedAt: null, coins: 0, createdAt: new Date(), ...data };
      db.steps.set(k, row);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const r = db.steps.get(stepKey(where.userId, where.step));
      if (!r) return { count: 0 };
      if ('claimedAt' in where && r.claimedAt !== where.claimedAt) return { count: 0 };
      if ('completedAt' in where && r.completedAt !== where.completedAt) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    },
    upsert: async ({ where, create, update }) => {
      const k = stepKey(where.userId_step.userId, where.userId_step.step);
      const r = db.steps.get(k);
      if (r) { Object.assign(r, update); return { ...r }; }
      const row = { completedAt: null, claimedAt: null, coins: 0, ...create };
      db.steps.set(k, row);
      return { ...row };
    },
    deleteMany: async ({ where }) => { db.steps.delete(stepKey(where.userId, where.step)); return { count: 1 }; },
  },
  message: {
    findMany: async ({ where }) => db.messages.filter((m) => m.authorId === where.authorId).map((m) => ({ content: m.content })),
  },
  reaction: {
    findFirst: async ({ where }) => {
      const r = db.reactions.find((x) => x.userId === where.userId && (!where.message?.authorId?.not || x.messageAuthorId !== where.message.authorId.not));
      return r ? { id: r.id } : null;
    },
  },
  webPushSubscription: { count: async ({ where }) => db.webPush.filter((x) => x.userId === where.userId).length },
  pushToken: { count: async ({ where }) => db.pushTokens.filter((x) => x.userId === where.userId).length },
  economyTransaction: { create: async ({ data }) => { db.ledger.push(data); return data; } },
  userNotice: { create: async ({ data }) => { const n = { id: `n${++seq}`, createdAt: new Date(), readAt: null, ...data }; db.notices.push(n); return n; } },
  errorLog: {
    upsert: async ({ create }) => { db.errorLogs.push(create); return { id: `e${++seq}` }; },
    findMany: async () => [], count: async () => 0,
  },
  dbBackup: {
    create: async ({ data }) => { const r = { id: `b${++seq}`, startedAt: new Date(Date.now() + seq), finishedAt: null, ...data }; db.backups.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = db.backups.find((b) => b.id === where.id); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }) => { let count = 0; for (const r of db.backups) if (matchBackup(r, where)) { Object.assign(r, data); count += 1; } return { count }; },
    findMany: async () => [...db.backups].sort((a, b) => b.startedAt - a.startedAt).slice(0, 10),
    findFirst: async ({ where }) => [...db.backups].sort((a, b) => b.startedAt - a.startedAt).find((r) => matchBackup(r, where)) || null,
  },
  platformAuditLog: { create: async () => ({}) },
  channel: { findMany: async () => [] },
  // Dump em Node: uma tabela "User" com PK id.
  $queryRawUnsafe: async (sql, ...params) => {
    if (sql.includes('information_schema.TABLES')) return [{ name: 'User' }];
    if (sql.startsWith('SHOW CREATE TABLE')) return [{ Table: 'User', 'Create Table': 'CREATE TABLE `User` (`id` varchar(36) NOT NULL, PRIMARY KEY (`id`))' }];
    if (sql.includes('KEY_COLUMN_USAGE')) return [{ col: 'id' }];
    if (sql.startsWith('SELECT * FROM `User`')) {
      const limit = Number(/LIMIT (\d+)/.exec(sql)[1]);
      const after = params[0];
      return db.tableRows.filter((r) => after === undefined || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limit);
    }
    throw new Error(`sql inesperado: ${sql}`);
  },
  $queryRaw: async () => [{ 1: 1 }],
  $transaction: async (fn) => fn(fakePrisma),
};

// ---------- Redis falso ----------
function makeRedis() {
  const store = new Map();
  return {
    status: 'ready',
    store,
    async set(k, v, ...args) {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    async eval(_lua, _n, key, token) { if (store.get(key) === token) { store.delete(key); return 1; } return 0; },
    async ping() { return 'PONG'; },
  };
}
const fakeRedis = makeRedis();

stub('config/prisma.js', fakePrisma);
stub('config/redis.js', { redis: fakeRedis });
stub('services/pushNotifications.js', { sendPushToUser: async () => null });
stub('services/voiceRoomStore.js', {
  getActiveRoomIds: async () => ['ch1'],
  getRoom: async () => ({ u1: { muted: true, deafened: false, provider: 'own', joinedAt: Date.now() } }),
  getStartedAt: async () => Date.now() - 60000,
});

process.env.NODE_ENV = 'test';
const onboarding = require(src('services/onboarding.js'));
const backup = require(src('services/dbBackup.js'));

const DAY = 24 * 3600 * 1000;
function resetUser(id, extra = {}) {
  db.users.set(id, { id, createdAt: new Date(Date.now() - DAY), coins: 0, gems: 0, avatarUrl: null, profileColor: '#1877F2', profileNameFont: 'NORMAL', profileNameEffect: 'SOLID', profileNameColor: '#1877F2', bannerUrl: null, platformRole: 'USER', ...extra });
  for (const k of [...db.steps.keys()]) if (k.startsWith(`${id}|`)) db.steps.delete(k);
}

// ============ Primeiros passos ============
test('primeiros passos: passo não concluído não paga (validação no servidor)', async () => {
  onboarding._resetForTests();
  resetUser('a1');
  await assert.rejects(onboarding.claimStep('a1', 'PROFILE', { prisma: fakePrisma }), (e) => e.status === 400 && e.code === 'not-done');
  await assert.rejects(onboarding.claimStep('a1', 'FIRST_MESSAGE', { prisma: fakePrisma }), (e) => e.status === 400);
  await assert.rejects(onboarding.claimStep('a1', 'NADA', { prisma: fakePrisma }), (e) => e.status === 404);
  assert.equal(db.users.get('a1').coins, 0);
});

test('primeiros passos: resgate paga uma vez só (idempotente, inclusive em paralelo)', async () => {
  onboarding._resetForTests();
  resetUser('a2', { avatarUrl: '/uploads/a.png' });
  const results = await Promise.allSettled([
    onboarding.claimStep('a2', 'PROFILE', { prisma: fakePrisma }),
    onboarding.claimStep('a2', 'PROFILE', { prisma: fakePrisma }),
    onboarding.claimStep('a2', 'PROFILE', { prisma: fakePrisma }),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.equal(ok.length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
  assert.equal(db.users.get('a2').coins, 50);
  await assert.rejects(onboarding.claimStep('a2', 'PROFILE', { prisma: fakePrisma }), (e) => e.status === 409);
  assert.equal(db.users.get('a2').coins, 50);
  assert.equal(db.ledger.filter((l) => l.userId === 'a2' && l.kind === 'ONBOARDING').length, 1);
  const state = await onboarding.getState('a2', { prisma: fakePrisma });
  assert.equal(state.steps.find((s) => s.key === 'PROFILE').claimed, true);
  assert.equal(state.earnedCoins, 50);
});

test('primeiros passos: reação só vale em mensagem de outra pessoa; mensagem precisa de texto', async () => {
  onboarding._resetForTests();
  resetUser('a3');
  db.reactions.push({ id: 'r1', userId: 'a3', messageAuthorId: 'a3' });
  db.messages.push({ authorId: 'a3', content: ' ' });
  await assert.rejects(onboarding.claimStep('a3', 'REACT', { prisma: fakePrisma }), (e) => e.status === 400);
  await assert.rejects(onboarding.claimStep('a3', 'FIRST_MESSAGE', { prisma: fakePrisma }), (e) => e.status === 400);
  db.reactions.push({ id: 'r2', userId: 'a3', messageAuthorId: 'outra' });
  db.messages.push({ authorId: 'a3', content: 'oi gente' });
  await onboarding.claimStep('a3', 'REACT', { prisma: fakePrisma });
  await onboarding.claimStep('a3', 'FIRST_MESSAGE', { prisma: fakePrisma });
  assert.equal(db.users.get('a3').coins, 50);
});

test('primeiros passos: voz só conta com evento do servidor (markEvent), tema e notificações pelo banco', async () => {
  onboarding._resetForTests();
  resetUser('a4');
  await assert.rejects(onboarding.claimStep('a4', 'JOIN_VOICE', { prisma: fakePrisma }), (e) => e.status === 400);
  const notified = [];
  const io = { notifyUser: (...a) => notified.push(a) };
  assert.equal(await onboarding.markEvent('a4', 'JOIN_VOICE', io, { prisma: fakePrisma }), true);
  assert.equal(await onboarding.markEvent('a4', 'JOIN_VOICE', io, { prisma: fakePrisma }), false); // só uma vez
  assert.equal(await onboarding.markEvent('a4', 'PROFILE', io, { prisma: fakePrisma }), false); // não é passo de evento
  assert.equal(notified.length, 1);
  await onboarding.claimStep('a4', 'JOIN_VOICE', { prisma: fakePrisma });
  db.users.get('a4').profileNameEffect = 'RAINBOW';
  await onboarding.claimStep('a4', 'PROFILE_THEME', { prisma: fakePrisma });
  await assert.rejects(onboarding.claimStep('a4', 'NOTIFICATIONS', { prisma: fakePrisma }), (e) => e.status === 400);
  db.webPush.push({ userId: 'a4' });
  await onboarding.claimStep('a4', 'NOTIFICATIONS', { prisma: fakePrisma });
  assert.equal(db.users.get('a4').coins, 40 + 30 + 30);
});

test('primeiros passos: conta antiga não resgata (anti-abuso) e ritmo de resgates é limitado', async () => {
  onboarding._resetForTests();
  resetUser('a5', { avatarUrl: '/x.png', createdAt: new Date(Date.now() - 90 * DAY) });
  await assert.rejects(onboarding.claimStep('a5', 'PROFILE', { prisma: fakePrisma }), (e) => e.status === 403);
  assert.equal(db.users.get('a5').coins, 0);
  assert.equal(onboarding.isEligible({ createdAt: new Date(Date.now() - 10 * DAY) }, Date.now(), { ONBOARDING_MAX_ACCOUNT_AGE_DAYS: '5' }), false);
  resetUser('a6');
  const hits = [];
  for (let i = 0; i < 12; i += 1) hits.push(await onboarding.claimStep('a6', 'PROFILE', { prisma: fakePrisma }).catch((e) => e.status));
  assert.ok(hits.includes(429));
});

test('primeiros passos: tour/dispensar são estado sem moedas', async () => {
  onboarding._resetForTests();
  resetUser('a7');
  await onboarding.setMeta('a7', 'TOUR', true, { prisma: fakePrisma });
  let s = await onboarding.getState('a7', { prisma: fakePrisma });
  assert.ok(s.tourSeenAt);
  assert.equal(db.users.get('a7').coins, 0);
  await onboarding.setMeta('a7', 'TOUR', false, { prisma: fakePrisma });
  s = await onboarding.getState('a7', { prisma: fakePrisma });
  assert.equal(s.tourSeenAt, null);
  await assert.rejects(onboarding.setMeta('a7', 'PROFILE', true, { prisma: fakePrisma }), (e) => e.status === 400);
});

// ============ Rotas da staff ============
function startApp(roleByToken) {
  stub('middleware/auth.js', {
    requireAuth: (req, res, next) => {
      const role = roleByToken[req.headers.authorization];
      if (!role) return res.status(401).json({ error: 'Não autenticado.' });
      req.user = { id: `u-${role}`, platformRole: role };
      return next();
    },
  });
  const calls = [];
  stub('services/dbBackup.js', {
    ...backup,
    runBackup: async (opts) => { calls.push(opts); return { id: 'b-x', status: 'OK' }; },
    getStatus: async () => ({ recent: [], lastOk: null, config: { enabled: true } }),
  });
  delete require.cache[src('services/staffOps.js')];
  delete require.cache[src('routes/staffOps.js')];
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.set('io', null);
  app.use('/api/staff-ops', require(src('routes/staffOps.js')));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port, calls }));
  });
}
function req(port, method, p, token) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: token ? { authorization: token } : {} }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    r.on('error', reject);
    r.end();
  });
}

test('staff-ops: só ADMIN/MODERATOR veem a saúde; backup manual só ADMIN', async () => {
  const { server, port, calls } = await startApp({ admin: 'ADMIN', mod: 'MODERATOR', user: 'USER' });
  try {
    assert.equal((await req(port, 'GET', '/api/staff-ops/health')).status, 401);
    assert.equal((await req(port, 'GET', '/api/staff-ops/health', 'user')).status, 403);
    assert.equal((await req(port, 'GET', '/api/staff-ops/backups', 'user')).status, 403);
    assert.equal((await req(port, 'POST', '/api/staff-ops/backups/run', 'user')).status, 403);
    const h = await req(port, 'GET', '/api/staff-ops/health', 'mod');
    assert.equal(h.status, 200);
    assert.equal(h.body.db.ok, true);
    assert.equal(h.body.redis.ok, true);
    assert.equal(h.body.voice.rooms.length, 1);
    assert.equal(h.body.voice.rooms[0].participants[0].userId, 'u1');
    assert.equal(h.body.media.configured, false);
    assert.ok(h.body.process.uptimeSec >= 0);
    assert.equal((await req(port, 'POST', '/api/staff-ops/backups/run', 'mod')).status, 403);
    assert.equal(calls.length, 0);
    const run = await req(port, 'POST', '/api/staff-ops/backups/run', 'admin');
    assert.ok([200, 202].includes(run.status));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].trigger, 'MANUAL');
  } finally {
    server.close();
    stub('services/dbBackup.js', backup);
  }
});

test('staff-ops: saúde do servidor de mídia usa /stats?deep=1 com x-media-secret', async () => {
  const ops = require(src('services/staffOps.js'));
  assert.equal(ops.mediaStatsUrl({ MEDIA_SERVER_URL: 'wss://midia.exemplo.com/ws' }), 'https://midia.exemplo.com/stats?deep=1');
  let seen = null;
  const fetchImpl = async (url, opts) => {
    seen = { url, secret: opts.headers['x-media-secret'] };
    return { ok: true, status: 200, json: async () => ({ workers: 2, rooms: [{ room: 'pc_x', peers: [{ id: 'p', name: 'Ana', producers: 1, consumers: 2, consumersDetail: [{ paused: false, producerPaused: false, bytes: 0 }] }] }] }) };
  };
  const out = await ops.fetchMediaHealth({ env: { MEDIA_SERVER_URL: 'wss://midia.exemplo.com/ws', MEDIA_SERVER_SECRET: 's3gr3do' }, fetchImpl });
  assert.equal(seen.url, 'https://midia.exemplo.com/stats?deep=1');
  assert.equal(seen.secret, 's3gr3do');
  assert.equal(out.ok, true);
  assert.equal(out.summary.workers, 2);
  assert.equal(out.rooms[0].peers[0].stalled, 1);
  const denied = await ops.fetchMediaHealth({ env: { MEDIA_SERVER_URL: 'wss://m.x/ws', MEDIA_SERVER_SECRET: 'x' }, fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(denied.ok, false);
  assert.match(denied.error, /segredo/);
});

// ============ Backup ============
test('backup: rotação mantém os 7 mais novos (disco) e ignora arquivos estranhos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bkp-'));
  const names = [];
  for (let i = 1; i <= 10; i += 1) {
    const n = backup.fileNameFor(new Date(Date.UTC(2026, 9, i, 7, 30, 0)));
    names.push(n);
    fs.writeFileSync(path.join(dir, n), 'x');
  }
  fs.writeFileSync(path.join(dir, 'leia-me.txt'), 'x');
  const deleted = backup.rotateLocal(dir, 7);
  assert.deepEqual(deleted.sort(), names.slice(0, 3).sort());
  const left = fs.readdirSync(dir).sort();
  assert.equal(left.length, 8);
  assert.ok(left.includes('leia-me.txt'));
  assert.ok(left.includes(names[9]));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backup: lock no Redis impede duas execuções ao mesmo tempo', async () => {
  backup._resetForTests();
  const r = makeRedis();
  assert.equal(await backup.acquireLock(r, 't1'), true);
  assert.equal(await backup.acquireLock(r, 't2'), false); // flag local
  backup._resetForTests();
  assert.equal(await backup.acquireLock(r, 't2'), false); // outra "instância": o Redis segura
  await backup.releaseLock(r, 't2'); // token errado não solta
  assert.equal(r.store.get(backup.LOCK_KEY), 't1');
  await backup.releaseLock(r, 't1');
  assert.equal(r.store.has(backup.LOCK_KEY), false);
  assert.equal(await backup.acquireLock(r, 't3'), true);
  await backup.releaseLock(r, 't3');
});

test('backup: escapa valores SQL com segurança', () => {
  assert.equal(backup.sqlValue(null), 'NULL');
  assert.equal(backup.sqlValue(true), '1');
  assert.equal(backup.sqlValue(12n), '12');
  assert.equal(backup.sqlValue("O'Neil\\x\n"), "'O\\'Neil\\\\x\\n'");
  assert.equal(backup.sqlValue(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6))), "'2026-01-02 03:04:05.006'");
  assert.equal(backup.sqlValue(Buffer.from([0xde, 0xad])), "X'dead'");
  assert.equal(backup.qid('a`b'), '`a``b`');
  const db1 = backup.parseDatabaseUrl('mysql://us%40r:p%3Ass@host.x:3307/club?sslca=certs/ca.pem');
  assert.deepEqual({ ...db1, params: undefined }, { host: 'host.x', port: 3307, user: 'us@r', password: 'p:ss', database: 'club', params: undefined });
  const args = backup.mysqldumpArgs(db1, { prismaDir: '/srv/prisma' });
  assert.ok(args.includes('--single-transaction') && args.includes('--quick'));
  assert.ok(args.includes('--ssl-ca=/srv/prisma/certs/ca.pem'));
  assert.ok(!args.some((a) => a.includes('p:ss'))); // senha vai por MYSQL_PWD
});

function memoryDestination(store) {
  return (fileName) => {
    const chunks = [];
    const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
    const finished = new Promise((resolve) => sink.on('finish', resolve));
    return {
      sink,
      async done() { await finished; store.files.set(fileName, Buffer.concat(chunks)); return { location: `mem://${fileName}` }; },
      async abort() { store.aborted += 1; },
    };
  };
}

test('backup: dump em Node em lotes pela chave primária, gzip, registro OK', async () => {
  backup._resetForTests();
  db.backups.length = 0;
  db.tableRows = Array.from({ length: 120 }, (_, i) => ({ id: `id${String(i).padStart(3, '0')}`, name: `Nome ${i}'s`, createdAt: new Date(Date.UTC(2026, 0, 1)) }));
  const store = { files: new Map(), aborted: 0 };
  const redis = makeRedis();
  const out = await backup.runBackup({
    trigger: 'MANUAL', prisma: fakePrisma, redis, env: { BACKUP_CHUNK_ROWS: '50', BACKUP_PAUSE_MS: '0', BACKUP_DIR: os.tmpdir() },
    openDestination: memoryDestination(store), methods: ['node'], log: () => {},
  });
  assert.equal(out.status, 'OK');
  assert.equal(out.method, 'node');
  assert.equal(out.rows, 120);
  assert.equal(out.tables, 1);
  const [file] = [...store.files.values()];
  const sql = zlib.gunzipSync(file).toString();
  assert.match(sql, /CREATE TABLE `User`/);
  assert.equal((sql.match(/INSERT INTO `User`/g) || []).length, 3); // 50 + 50 + 20
  assert.match(sql, /'Nome 3\\'s'/);
  assert.equal(redis.store.has(backup.LOCK_KEY), false); // lock solto no fim
  const st = await backup.getStatus({ prisma: fakePrisma, env: {} });
  assert.equal(st.lastOk.id, out.id);
});

test('backup: falha marca FAILED, avisa a staff, grava ErrorLog, solta o lock; 2º em paralelo = 409', async () => {
  backup._resetForTests();
  db.backups.length = 0;
  db.notices.length = 0;
  db.users.set('staff1', { id: 'staff1', platformRole: 'ADMIN', createdAt: new Date() });
  const store = { files: new Map(), aborted: 0 };
  const redis = makeRedis();
  const broken = { ...fakePrisma, $queryRawUnsafe: async () => { throw new Error('banco caiu'); } };
  await assert.rejects(backup.runBackup({
    prisma: broken, redis, env: {}, openDestination: memoryDestination(store), methods: ['node'], log: () => {},
  }), /banco caiu/);
  assert.equal(db.backups[0].status, 'FAILED');
  assert.match(db.backups[0].error, /banco caiu/);
  assert.equal(store.aborted, 1);
  assert.ok(db.notices.some((n) => n.userId === 'staff1' && n.kind === 'BACKUP'));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(db.errorLogs.some((e) => /Backup do banco falhou/.test(e.message)));
  assert.equal(redis.store.has(backup.LOCK_KEY), false);

  // Dois ao mesmo tempo: o segundo recebe 409.
  backup._resetForTests();
  let release;
  const slow = { ...fakePrisma, $queryRawUnsafe: async (...a) => { await new Promise((r) => { release = r; }); return fakePrisma.$queryRawUnsafe(...a); } };
  db.tableRows = [{ id: 'x1' }];
  const first = backup.runBackup({ prisma: slow, redis, env: {}, openDestination: memoryDestination(store), methods: ['node'], log: () => {} });
  await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(backup.runBackup({ prisma: fakePrisma, redis, env: {}, openDestination: memoryDestination(store), methods: ['node'], log: () => {} }), (e) => e.status === 409);
  const relSlow = setInterval(() => release?.(), 5);
  const done = await first;
  clearInterval(relSlow);
  assert.equal(done.status, 'OK');
});

test('backup: agendador roda só na hora marcada e uma vez por dia', async () => {
  backup._resetForTests();
  db.backups.length = 0;
  // 07:10 UTC = 04:10 em São Paulo.
  const at4 = new Date(Date.UTC(2026, 9, 17, 7, 10));
  const at9 = new Date(Date.UTC(2026, 9, 17, 12, 10));
  assert.deepEqual(backup.spClock(at4), { day: '2026-10-17', hour: 4 });
  assert.equal((await backup.tick(null, { prisma: fakePrisma, env: { BACKUP_ENABLED: '0' }, now: at4 })).skipped, 'disabled');
  assert.equal((await backup.tick(null, { prisma: fakePrisma, env: { BACKUP_ENABLED: '1' }, now: at9 })).skipped, 'hour');
  // Já tem backup OK recente → não roda de novo.
  db.backups.push({ id: 'old', status: 'OK', startedAt: new Date(at4.getTime() - 3600 * 1000) });
  assert.equal((await backup.tick(null, { prisma: fakePrisma, env: { BACKUP_ENABLED: '1' }, now: at4 })).skipped, 'done');
  const cfg = backup.getConfig({ BACKUP_S3_BUCKET: 'b', B2_KEY_ID: 'k', B2_APPLICATION_KEY: 's', B2_ENDPOINT: 'https://s3.x' });
  assert.equal(cfg.s3.bucket, 'b');
  assert.equal(cfg.s3.prefix, 'db-backups/');
  assert.equal(backup.getConfig({ BACKUP_S3_BUCKET: 'b' }).s3, null);
  assert.equal(backup.getConfig({ BACKUP_S3_BUCKET: 'b' }).s3Misconfigured, true);
  assert.equal(backup.getConfig({ NODE_ENV: 'production' }).enabled, true);
  assert.equal(backup.getConfig({ NODE_ENV: 'development' }).enabled, false);
});
