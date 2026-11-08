// Varredura de erros (out/2026): correções que evitavam erro 500 /
// unhandledRejection. Sem banco: prisma e dependências trocados por
// versões falsas em memória (mesmo padrão de perf2.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

const fakeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

// ---------- auditoria: reason/metadata cabem na coluna ----------
test('auditFields: motivo cortado em 191, metadata em JSON e leitura tolerante', () => {
  const { auditReason, auditMetadata, parseAuditMetadata } = require(src('utils/auditFields.js'));
  assert.equal(auditReason(undefined), null);
  assert.equal(auditReason('   '), null);
  assert.equal(auditReason('  spam  '), 'spam');
  assert.equal(auditReason('x'.repeat(500)).length, 191);
  assert.equal(auditReason(12345), '12345'); // não-texto não quebra mais em .trim()
  assert.equal(auditMetadata(null), null);
  assert.equal(auditMetadata({ a: 1 }), '{"a":1}');
  const circular = {}; circular.self = circular;
  assert.equal(auditMetadata(circular), null);
  assert.ok(auditMetadata({ big: 'y'.repeat(20000) }).includes('"truncated":true'));
  assert.deepEqual(parseAuditMetadata('{"a":1}'), { a: 1 });
  assert.equal(parseAuditMetadata('{quebrado'), null);
});

// ---------- sockets: handler que falha não escapa ----------
test('guardSocketHandler: erro síncrono e promessa rejeitada ficam registrados com o nome do evento', async () => {
  const { guardSocketHandler, guardSocket } = require(src('sockets/guardHandler.js'));
  const seen = [];
  const report = (event, err) => seen.push(`${event}:${err.message}`);

  const sync = guardSocketHandler('voice:state', ({ channelId }) => channelId, report);
  assert.equal(sync(undefined), undefined); // destruturar undefined lançava TypeError
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^voice:state:/);

  const rejected = guardSocketHandler('typing:start', async () => { throw new Error('redis fora'); }, report);
  await rejected({});
  assert.equal(seen[1], 'typing:start:redis fora');

  const ok = guardSocketHandler('x', function handler(a, b) { return [this.id, a + b]; }, report);
  assert.deepEqual(ok.call({ id: 's1' }, 2, 3), ['s1', 5]);
  assert.equal(seen.length, 2);

  // guardSocket embrulha on/once do próprio socket (EventEmitter de verdade).
  const socket = new EventEmitter();
  guardSocket(socket, report);
  guardSocket(socket, report); // idempotente
  socket.on('boom', () => { throw new Error('quebrou'); });
  socket.once('later', async () => { throw new Error('async'); });
  assert.doesNotThrow(() => socket.emit('boom'));
  socket.emit('later');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen.slice(2), ['boom:quebrou', 'later:async']);
});

// ---------- erro de tela: deploy do Android não vira erro ----------
test('client-error: "http 503 — falso alarme" do Android é reinício recuperado, não erro', () => {
  stub('controllers/systemController.js', { publishRelease: () => {} });
  stub('config/redis.js', { cacheGetOrSet: async (k, t, fn) => fn() });
  stub('services/tokens.js', { verifyAccessToken: () => null });
  const { isRecoveredDeployBlip } = require(src('routes/system.js'));
  assert.equal(isRecoveredDeployBlip({ where: 'android-conexao', message: 'http 503 — falso alarme: servidor respondeu, recarregando' }), true);
  assert.equal(isRecoveredDeployBlip({ where: 'android-conexao', message: 'http 502 — falso alarme: servidor respondeu, recarregando' }), true);
  // 500 de verdade, falha repetida ou erro de rede continuam sendo registrados.
  assert.equal(isRecoveredDeployBlip({ where: 'android-conexao', message: 'http 500 — falso alarme: servidor respondeu, recarregando' }), false);
  assert.equal(isRecoveredDeployBlip({ where: 'android-conexao', message: 'http 503 — falhas repetidas com o servidor respondendo' }), false);
  assert.equal(isRecoveredDeployBlip({ where: 'tela', message: 'http 503 — falso alarme' }), false);
  assert.equal(isRecoveredDeployBlip(null), false);
});

// ---------- enquete: título longo / opções longas ----------
test('enquete: título longo ou que não é texto dá 400 (antes 500) e opções são cortadas', async () => {
  const created = [];
  stub('config/prisma.js', {
    message: { create: async (args) => { created.push(args); return { id: 'm1', ...args.data }; } },
  });
  stub('utils/prismaSafe.js', { safeUpsert: async () => ({}) });
  stub('services/permissions.js', { has: () => true });
  stub('controllers/messageController.js', {
    messageInclude: {}, assertAccess: async () => ({ perms: 1n }), roomFor: () => 'channel:c1',
  });
  const poll = require(src('controllers/pollController.js'));
  const call = async (body) => {
    const res = fakeRes();
    let err = null;
    await poll.createPoll({ body, user: { id: 'u1' }, app: { get: () => null } }, res, (e) => { err = e; });
    return { res, err };
  };
  const base = { channelId: 'c1', options: ['a', 'b'], duration: '1h' };

  let r = await call({ ...base, question: 'q'.repeat(poll.MAX_QUESTION_CHARS + 1) });
  assert.equal(r.res.statusCode, 400);
  r = await call({ ...base, question: 42 });
  assert.equal(r.err, null);
  assert.equal(r.res.statusCode, 400);

  r = await call({ ...base, question: '  Qual?  ', options: ['x'.repeat(200), 'y'] });
  assert.equal(r.err, null);
  assert.equal(r.res.statusCode, 201);
  const data = created[0].data;
  assert.equal(data.title, 'Qual?');
  assert.deepEqual(JSON.parse(data.poll.create.options), ['x'.repeat(poll.MAX_OPTION_CHARS), 'y']);
});

// ---------- modpack: modioModId inválido ----------
test('modpack: modioModId que não é número dá 400 em vez de 500 do Prisma', async () => {
  let upserted = null;
  stub('config/prisma.js', { modProfile: { findUnique: async () => ({ id: 'p1', userId: 'u1' }) } });
  stub('utils/prismaSafe.js', { safeUpsert: async (d, args) => { upserted = args; return { id: 'i1' }; }, createIgnoreDuplicate: async () => null });
  stub('services/modioService.js', {});
  const mod = require(src('controllers/modController.js'));
  const call = async (body) => {
    const res = fakeRes();
    await mod.upsertProfileItem({ params: { profileId: 'p1' }, body, user: { id: 'u1' } }, res, (e) => { throw e; });
    return res;
  };
  assert.equal((await call({ modioModId: 'abc' })).statusCode, 400);
  assert.equal((await call({ modioModId: 12, modioModfileId: 'x' })).statusCode, 400);
  const ok = await call({ modioModId: '12', modioModfileId: 0 });
  assert.equal(ok.statusCode, 200);
  assert.equal(upserted.where.profileId_modioModId.modioModId, 12);
  assert.equal(upserted.create.modioModfileId, null);
});

// ---------- aviso "atualizando" do deploy ----------
test('warmupServer: responde 503 calmo durante o deploy e libera a porta ao fechar', async () => {
  const { startWarmupServer, resolveServerPort } = require(path.resolve(__dirname, '../../scripts/warmupServer.js'));
  assert.equal(resolveServerPort({ NODE_ENV: 'production' }), 80);
  assert.equal(resolveServerPort({}, 'PORT=4321\n'), 4321);

  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));

  const warm = startWarmupServer(port, { log: () => {} });
  assert.equal(await warm.ready, true);
  const get = (p, headers = {}) => new Promise((resolve, reject) => {
    http.get({ port, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
  const api = await get('/api/channels');
  assert.equal(api.status, 503);
  assert.equal(api.headers['retry-after'], '10');
  assert.equal(JSON.parse(api.body).restarting, true);
  const page = await get('/channels/abc', { accept: 'text/html' });
  assert.equal(page.status, 503);
  assert.match(page.body, /Atualizando o Project Club/);

  // Porta ocupada: não derruba nada, só segue sem o aviso.
  const second = startWarmupServer(port, { log: () => {} });
  assert.equal(await second.ready, false);
  await second.close();

  await warm.close();
  const real = http.createServer((q, s) => s.end('ok'));
  await new Promise((resolve, reject) => { real.once('error', reject); real.listen(port, resolve); });
  await new Promise((r) => real.close(r));
});

// ---------- moderação: motivo longo ----------
test('advertência: motivo longo é cortado em vez de estourar a coluna (500)', async () => {
  const rows = [];
  stub('config/prisma.js', { warning: { create: async (args) => { rows.push(args.data); return { id: 'w1', ...args.data }; } } });
  stub('services/authz.js', { requireCommunityPermission: async () => true, getEffectivePermissions: async () => 0n, ForbiddenError: class extends Error {} });
  stub('services/permissions.js', { has: () => true });
  stub('services/audit.js', { logAction: async () => ({}), shapeAuditEntry: (e) => e });
  stub('controllers/authController.js', { PUBLIC_USER_FIELDS: {} });
  const mod = require(src('controllers/moderationController.js'));
  const res = fakeRes();
  await mod.warnMember({ params: { userId: 'u2' }, body: { reason: 'r'.repeat(400) }, user: { id: 'u1' }, app: { get: () => null } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  assert.equal(rows[0].reason.length, 191);
  const blank = fakeRes();
  await mod.warnMember({ params: { userId: 'u2' }, body: { reason: '   ' }, user: { id: 'u1' }, app: { get: () => null } }, blank, (e) => { throw e; });
  assert.equal(blank.statusCode, 400);
});
