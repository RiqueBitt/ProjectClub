// Disjuntor de saúde dos provedores de voz + "todo mundo do canal no MESMO
// provedor" (voz à prova de falhas). Sem Redis/rede de verdade: um Redis
// falso em memória e o controller chamado direto.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------- Redis falso (só os comandos usados pela voz) ----------------
const kv = new Map(); const sets = new Map(); const hashes = new Map(); const zsets = new Map();
let clock = Date.parse('2026-10-16T20:00:00Z');
const now = () => clock;
const expOf = (args) => {
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]).toUpperCase();
    if (a === 'EX') return now() + Number(args[i + 1]) * 1000;
    if (a === 'PX') return now() + Number(args[i + 1]);
  }
  return 0;
};
const live = (k) => { const e = kv.get(k); if (!e) return null; if (e.exp && e.exp <= now()) { kv.delete(k); return null; } return e; };
const fakeRedis = {
  async get(k) { return live(k)?.v ?? null; },
  async set(k, v, ...args) {
    if (args.map((a) => String(a).toUpperCase()).includes('NX') && live(k)) return null;
    kv.set(k, { v: String(v), exp: expOf(args) }); return 'OK';
  },
  async del(...ks) { for (const k of ks) { kv.delete(k); sets.delete(k); hashes.delete(k); zsets.delete(k); } return 1; },
  async incr(k) { const n = Number(live(k)?.v || 0) + 1; kv.set(k, { v: String(n), exp: live(k)?.exp || 0 }); return n; },
  async expire(k, s) { const e = live(k); if (e) e.exp = now() + s * 1000; return 1; },
  async pexpire(k, ms) { const e = live(k); if (e) e.exp = now() + ms; return 1; },
  async smembers(k) { return [...(sets.get(k) || [])]; },
  async sismember(k, m) { return sets.get(k)?.has(m) ? 1 : 0; },
  async sadd(k, m) { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return 1; },
  async srem(k, m) { sets.get(k)?.delete(m); return 1; },
  async hlen(k) { return hashes.get(k)?.size || 0; },
  async hgetall(k) { return Object.fromEntries(hashes.get(k) || []); },
  async zadd(k, score, m) { if (!zsets.has(k)) zsets.set(k, new Map()); zsets.get(k).set(m, Number(score)); return 1; },
  async zremrangebyscore(k, min, max) {
    const lim = Number(String(max).replace('(', '')); const excl = String(max).startsWith('(');
    const z = zsets.get(k); if (!z) return 0;
    for (const [m, s] of z) if (excl ? s < lim : s <= lim) z.delete(m);
    return 1;
  },
  async zrange(k) { const z = zsets.get(k); if (!z) return []; return [...z.entries()].flatMap(([m, s]) => [m, String(s)]); },
  multi() { return { hset() { return this; }, hdel() { return this; }, exec: async () => [] }; },
  on() {},
};
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = { exports: { redis: fakeRedis }, loaded: true, id: 'redis' };
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {}, loaded: true, id: 'prisma' };

process.env.NODE_ENV = 'test';
process.env.MEDIA_SERVER_URL = 'wss://media.example/ws';
process.env.MEDIA_SERVER_SECRET = 'segredo-midia-0123456789';
process.env.AGORA_APP_ID = 'a'.repeat(32);
process.env.AGORA_APP_CERTIFICATE = 'b'.repeat(32);
process.env.TURN_URLS = 'turns:media.example:5349?transport=tcp,turn:media.example:3478?transport=tcp,turn:media.example:3478?transport=udp';
process.env.TURN_SECRET = 'turnsecret';
for (const k of ['LIVEKIT_URL', 'GETSTREAM_API_KEY', 'TRTC_SDK_APP_ID', 'DAILY_DOMAIN']) delete process.env[k];

const voiceHealth = require('../src/services/voiceHealth');
const decision = require('../src/services/voiceDecision');
const tokens = require('../src/services/voiceTokens');
const overrideStore = require('../src/services/voiceOverrideStore');

const quietLog = { warn() {} };
const newTracker = (env = {}) => voiceHealth.createTracker({ store: voiceHealth.memoryStore(now), now, env, log: quietLog });

beforeEach(() => { kv.clear(); sets.clear(); hashes.clear(); zsets.clear(); });

// ---------------- disjuntor (puro + tracker) ----------------

test('disjuntor: uma pessoa sozinha falhando várias vezes NÃO desarma o provedor', async () => {
  const t = newTracker();
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await t.recordFailure('agora', 'u1', 'CAN_NOT_GET_GATEWAY_SERVER');
    clock += 25000; // passa do limite de 1 falha/20s por pessoa
  }
  assert.deepEqual(await t.getUnhealthy(), []);
});

test('disjuntor: 2 pessoas diferentes em 5 min desarmam; o tempo de espera dobra a cada queda seguida e depois volta', async () => {
  const t = newTracker();
  await t.recordFailure('agora', 'u1');
  const r = await t.recordFailure('agora', 'u2');
  assert.equal(r.tripped, true);
  assert.deepEqual(await t.getUnhealthy(), ['agora']);
  const d1 = await t.getDown('agora');
  assert.equal(d1.until - clock, 10 * 60000, '1ª queda: 10 min');
  clock += 10 * 60000 + 1;
  assert.deepEqual(await t.getUnhealthy(), [], 'passado o tempo, volta a ser tentado (meio-aberto)');
  await t.recordFailure('agora', 'u3');
  await t.recordFailure('agora', 'u4');
  const d2 = await t.getDown('agora');
  assert.equal(d2.until - clock, 20 * 60000, '2ª queda seguida: 20 min');
  await t.reset('agora');
  assert.deepEqual(await t.getUnhealthy(), [], 'a equipe pode zerar na hora');
});

test('disjuntor: falhas fora da janela não somam', async () => {
  const t = newTracker();
  await t.recordFailure('projectclub', 'u1');
  clock += 6 * 60000;
  const r = await t.recordFailure('projectclub', 'u2');
  assert.equal(r.tripped, false);
});

test('disjuntor: provedor inválido é ignorado', async () => {
  const t = newTracker();
  assert.equal((await t.recordFailure('inventado', 'u1')).counted, false);
});

test('teste ativo do servidor próprio: 2 falhas seguidas do /health = fora do ar; 1 sucesso = volta', async () => {
  const t = newTracker(process.env);
  assert.equal(t.healthUrl(), 'https://media.example/health');
  const fail = async () => ({ ok: false, status: 503 });
  const ok = async () => ({ ok: true, status: 200 });
  // Backend que NUNCA alcançou a VM (rede da hospedagem): não desarma (falso negativo).
  await t.probeOnce({ fetchImpl: fail });
  await t.probeOnce({ fetchImpl: fail });
  assert.deepEqual(await t.getUnhealthy(), [], 'sem nenhum sucesso antes, o teste ativo é ignorado');
  await t.probeOnce({ fetchImpl: ok });
  await t.probeOnce({ fetchImpl: fail });
  assert.deepEqual(await t.getUnhealthy(), [], 'uma falha só não derruba');
  await t.probeOnce({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(await t.getUnhealthy(), ['projectclub']);
  await t.probeOnce({ fetchImpl: ok });
  assert.deepEqual(await t.getUnhealthy(), []);
});

test('Redis fora do ar: o disjuntor continua funcionando em memória', async () => {
  const broken = new Proxy({}, { get: () => async () => { throw new Error('redis caiu'); } });
  const t = voiceHealth.createTracker({ store: voiceHealth.fallbackStore(voiceHealth.redisStore(broken), voiceHealth.memoryStore(now)), now, env: {}, log: quietLog });
  await t.recordFailure('agora', 'u1');
  await t.recordFailure('agora', 'u2');
  assert.deepEqual(await t.getUnhealthy(), ['agora']);
});

// ---------------- decisão com saúde ----------------

const ENV = { MEDIA_SERVER_URL: 'wss://m/ws', MEDIA_SERVER_SECRET: 's'.repeat(20), AGORA_APP_ID: 'a', AGORA_APP_CERTIFICATE: 'b' };

test('decisão: provedor desarmado é pulado; override apontando pra ele cai no automático', () => {
  assert.equal(decision.decideProvider({ env: ENV, unhealthy: ['projectclub'] }).provider, 'agora');
  const d = decision.decideProvider({ env: ENV, override: 'agora', unhealthy: ['agora'] });
  assert.equal(d.provider, 'projectclub');
  assert.equal(d.overridden, false);
  const panel = decision.buildPanel({ env: ENV, override: 'agora', unhealthy: ['agora'] });
  assert.equal(panel.overrideIgnored, true);
  assert.equal(panel.providers.find((p) => p.id === 'agora').status, 'instavel');
  assert.equal(panel.providers.find((p) => p.id === 'agora').healthy, false);
});

test('decisão: tudo desarmado → usa o primeiro disponível ("degradado"), inclusive pra quem não tem Jitsi (app Android)', () => {
  const all = ['projectclub', 'agora', 'jitsi'];
  assert.equal(decision.decideProvider({ env: ENV, unhealthy: all }).provider, 'projectclub');
  const android = decision.decideProvider({ env: ENV, unhealthy: ['projectclub', 'agora'], disabled: ['jitsi', 'livekit', 'getstream', 'daily', 'trtc'] });
  assert.equal(android.provider, 'projectclub');
  assert.equal(android.reason, 'degraded');
  // Web (tem Jitsi): com os dois desarmados, cai no Jitsi saudável.
  assert.equal(decision.decideProvider({ env: ENV, unhealthy: ['projectclub', 'agora'] }).provider, 'jitsi');
});

test('resolveRoomProvider: sala ativa num provedor bom → todo mundo entra nele', () => {
  const r = decision.resolveRoomProvider({ decided: 'agora', globalProvider: 'agora', sticky: 'projectclub', active: true, stickyForRoom: true, stickyForMe: true });
  assert.deepEqual(r, { provider: 'projectclub', write: false, migrate: false });
});

test('resolveRoomProvider: fixação ficou ruim (desarmada) → a sala migra junto', () => {
  const r = decision.resolveRoomProvider({ decided: 'projectclub', globalProvider: 'projectclub', sticky: 'agora', active: true, stickyForRoom: false, stickyForMe: false });
  assert.deepEqual(r, { provider: 'projectclub', write: true, migrate: true });
});

test('resolveRoomProvider (bug de produção): aparelho que não usa o provedor da sala NÃO regrava a fixação dos outros', () => {
  // Sala no projectclub (escolha geral). Um app que pulou o projectclub cai
  // no agora SOZINHO — a fixação continua projectclub pro próximo que entrar.
  const r = decision.resolveRoomProvider({ decided: 'agora', globalProvider: 'projectclub', sticky: 'projectclub', active: true, stickyForRoom: true, stickyForMe: false });
  assert.deepEqual(r, { provider: 'agora', write: false, migrate: false });
});

test('resolveRoomProvider: sala vazia (fixação velha) → decide de novo e grava', () => {
  const r = decision.resolveRoomProvider({ decided: 'projectclub', globalProvider: 'projectclub', sticky: 'agora', active: false, stickyForRoom: true, stickyForMe: true });
  assert.deepEqual(r, { provider: 'projectclub', write: true, migrate: false });
});

// ---------------- tokens ----------------

test('token próprio: tem jti único (sessão) e ICE na ordem UDP → TCP → TLS', () => {
  const a = tokens.mintProjectClub({ room: 'pc_x', userId: 'u1', name: 'U' });
  const b = tokens.mintProjectClub({ room: 'pc_x', userId: 'u1', name: 'U' });
  const jwt = require('jsonwebtoken');
  const pa = jwt.verify(a.token, process.env.MEDIA_SERVER_SECRET);
  assert.ok(pa.jti && pa.jti !== jwt.decode(b.token).jti);
  assert.ok(pa.exp - pa.iat >= 8 * 3600, 'token vale pra reconexões numa call longa');
  const turn = a.iceServers.find((s) => s.username);
  assert.deepEqual(turn.urls, ['turn:media.example:3478?transport=udp', 'turn:media.example:3478?transport=tcp', 'turns:media.example:5349?transport=tcp']);
  assert.ok(a.iceServers.length <= 2, 'no máximo 2 entradas (STUN + TURN): mais que isso deixa a coleta de ICE lenta');
});

// ---------------- /api/voice/join de ponta a ponta (Redis falso) ----------------

function call(handler, { user, query = {}, body = {}, headers = {}, io } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(v) { resolve({ status: this.statusCode, body: v }); return this; },
    };
    const req = { user, query, body, headers, app: { get: (k) => (k === 'io' ? io : undefined) } };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}
const fakeIo = () => {
  const emitted = [];
  return { emitted, to(room) { return { emit: (ev, data) => emitted.push({ room, ev, data }), to: () => this }; } };
};
const userA = { id: 'ua', clanId: 'c1', username: 'ana' };
const userB = { id: 'ub', clanId: 'c1', username: 'beto' };
const userC = { id: 'uc', clanId: 'c1', username: 'caio' };
const WEB = 'projectclub,agora,jitsi';
const inRoom = (channel, ...ids) => { hashes.set(`voice:room:${channel}`, new Map(ids.map((id) => [id, '{}']))); };

test('join: override "agora" + falha do Agora pra 2 pessoas → Agora desarmado, sala migra e TODO MUNDO cai no mesmo provedor', async () => {
  const ctrl = require('../src/controllers/voiceController');
  await overrideStore.setOverride('agora');
  const io = fakeIo();
  const ch = 'clan:c1';
  // Ana entra: override → agora.
  let r = await call(ctrl.getJoin, { user: userA, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'agora');
  inRoom(ch, 'ua');
  // Beto entra: mesma sala → agora.
  r = await call(ctrl.getJoin, { user: userB, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'agora');
  inRoom(ch, 'ua', 'ub');
  // O Agora falha pra Ana (CAN_NOT_GET_GATEWAY_SERVER): o cliente pede de novo SEM agora.
  clock += 3000;
  r = await call(ctrl.getJoin, { user: userA, query: { channelName: ch, clientReady: 'projectclub,jitsi' }, io });
  assert.equal(r.body.provider, 'projectclub');
  // …e o Beto também (2ª pessoa) — reporta pela rota nova.
  clock += 1000;
  const rep = await call(ctrl.postReport, { user: userB, body: { provider: 'agora', code: 'CAN_NOT_GET_GATEWAY_SERVER' }, io });
  assert.equal(rep.body.providerDown, true);
  // Agora desarmado: quem perguntar (inclusive o poll de quem está na sala) vai pro projectclub.
  r = await call(ctrl.getJoin, { user: userB, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'projectclub');
  assert.ok(io.emitted.some((e) => e.ev === 'voice:provider-changed'), 'avisou os clientes pra migrar');
  // Caio chega depois: mesmo provedor da sala.
  r = await call(ctrl.getJoin, { user: userC, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'projectclub');
  assert.equal(await overrideStore.getRoomProvider(ch), 'projectclub', 'fixação da sala nunca aponta pra provedor desarmado');
  // Painel: agora instável, override ignorado.
  const panel = await call(ctrl.getProviderStatus, { user: userA, io });
  assert.equal(panel.body.active, 'projectclub');
  assert.equal(panel.body.overrideIgnored, true);
  assert.equal(panel.body.providers.find((p) => p.id === 'agora').status, 'instavel');
  await voiceHealth.tracker().reset('agora');
});

test('join: aparelho que não suporta o provedor da sala não "rouba" a fixação (antes: canal dividido)', async () => {
  const ctrl = require('../src/controllers/voiceController');
  await overrideStore.setOverride(null);
  const io = fakeIo();
  const ch = 'clan:c1';
  let r = await call(ctrl.getJoin, { user: userA, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'projectclub');
  inRoom(ch, 'ua');
  // App antigo sem servidor próprio.
  r = await call(ctrl.getJoin, { user: userB, query: { channelName: ch, clientReady: 'agora' }, headers: {}, io });
  assert.equal(r.body.provider, 'agora');
  inRoom(ch, 'ua', 'ub');
  // O próximo do navegador continua indo pro projectclub (onde a Ana está).
  r = await call(ctrl.getJoin, { user: userC, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'projectclub');
  assert.equal(await overrideStore.getRoomProvider(ch), 'projectclub');
});

test('join: duas pessoas entrando quase juntas numa sala vazia caem no mesmo provedor (fixação recente vale)', async () => {
  const ctrl = require('../src/controllers/voiceController');
  await overrideStore.setOverride(null);
  const io = fakeIo();
  const ch = 'clan:c1';
  await overrideStore.setRoomProvider(ch, 'agora'); // alguém acabou de entrar no agora (ainda não aparece na sala)
  const r = await call(ctrl.getJoin, { user: userB, query: { channelName: ch, clientReady: WEB }, io });
  assert.equal(r.body.provider, 'agora');
});
