// Voz só com o servidor de mídia PRÓPRIO (media-server/): estrutura do token
// (JWT + ICE), /api/voice/join de ponta a ponta (sempre provider
// "projectclub", inclusive pra clientes antigos que mandam clientReady com
// provedores removidos), /api/voice/report (só telemetria), painel "Servidor
// de voz" e a faxina das chaves antigas da cadeia no Redis. `node --test`,
// sem Redis/rede de verdade.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

// ---------------- Redis falso (só os comandos usados aqui) ----------------
const kv = new Map(); const hashes = new Map();
const fakeRedis = {
  async get(k) { return kv.get(k) ?? null; },
  async set(k, v) { kv.set(k, String(v)); return 'OK'; },
  async del(...ks) { let n = 0; for (const k of ks) { if (kv.delete(k)) n += 1; if (hashes.delete(k)) n += 1; } return n; },
  async incrby(k, n) { const v = Number(kv.get(k) || 0) + n; kv.set(k, String(v)); return v; },
  async expire() { return 1; },
  async smembers() { return []; },
  async hlen(k) { return hashes.get(k)?.size || 0; },
  async hgetall(k) { return Object.fromEntries(hashes.get(k) || []); },
  async hdel(k, ...fs) { let n = 0; for (const f of fs) if (hashes.get(k)?.delete(f)) n += 1; return n; },
  async scan(cursor, _m, pattern) {
    const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return ['0', [...kv.keys(), ...hashes.keys()].filter((k) => re.test(k))];
  },
  multi() {
    const ops = [];
    const m = {
      hset: (k, f, v) => { ops.push(() => { if (!hashes.has(k)) hashes.set(k, new Map()); hashes.get(k).set(f, v); }); return m; },
      hdel: (k, f) => { ops.push(() => hashes.get(k)?.delete(f)); return m; },
      exec: async () => ops.forEach((o) => o()),
    };
    return m;
  },
  on() {},
};
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = { exports: { redis: fakeRedis }, loaded: true, id: 'redis' };
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {}, loaded: true, id: 'prisma' };

process.env.NODE_ENV = 'test';
process.env.MEDIA_SERVER_URL = 'wss://media.example/ws';
process.env.MEDIA_SERVER_SECRET = 'segredo-midia-0123456789';
process.env.TURN_URLS = 'turns:media.example:5349?transport=tcp,turn:media.example:3478?transport=tcp,turn:media.example:3478?transport=udp';
process.env.TURN_SECRET = 'turnsecret';

const tokens = require('../src/services/voiceTokens');

beforeEach(() => { kv.clear(); hashes.clear(); });

// ---------------- tokens ----------------

const OWN_ENV = {
  MEDIA_SERVER_URL: 'wss://media.example/ws', MEDIA_SERVER_SECRET: 'segredo-do-servidor-de-midia-123',
  TURN_URLS: 'turn:media.example:3478?transport=udp,turn:media.example:3478?transport=tcp', TURN_SECRET: 'turnsecret',
};
const NO_OWN_ENV = { ...OWN_ENV, MEDIA_SERVER_URL: '', MEDIA_SERVER_SECRET: '' };

test('servidor próprio: configurado só com URL + segredo', () => {
  assert.equal(tokens.isConfigured(OWN_ENV), true);
  assert.equal(tokens.isConfigured(NO_OWN_ENV), false);
  assert.equal(tokens.isConfigured({ MEDIA_SERVER_URL: 'wss://x' }), false);
});

test('token próprio: JWT HS256 com sub/room/name e exp curto; url e ICE (STUN + TURN temporário)', () => {
  const now = Date.now();
  const c = tokens.mintProjectClub({ room: 'pc_abc', userId: 'u1', name: 'Ana' }, OWN_ENV, now);
  assert.equal(c.url, 'wss://media.example/ws');
  const payload = jwt.verify(c.token, OWN_ENV.MEDIA_SERVER_SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, 'u1'); assert.equal(payload.room, 'pc_abc'); assert.equal(payload.name, 'Ana');
  assert.equal(payload.exp - payload.iat, tokens.MEDIA_TOKEN_TTL_SECONDS);
  const turn = c.iceServers.find((s) => s.username);
  assert.ok(turn && turn.urls.length === 2);
  const [exp, uid] = turn.username.split(':');
  assert.equal(uid, 'u1');
  assert.equal(Number(exp), Math.floor(now / 1000) + 12 * 60 * 60);
  const expected = require('crypto').createHmac('sha1', 'turnsecret').update(turn.username).digest('base64');
  assert.equal(turn.credential, expected);
  assert.ok(c.iceServers[0].urls[0].startsWith('stun:'));
});

test('token próprio: sem envs → null; sem TURN → só STUN', () => {
  assert.equal(tokens.mintProjectClub({ room: 'r', userId: 'u' }, NO_OWN_ENV), null);
  const noTurn = { ...OWN_ENV, TURN_URLS: '', TURN_SECRET: '' };
  const c = tokens.mintProjectClub({ room: 'r', userId: 'u' }, noTurn);
  assert.equal(c.iceServers.length, 1);
  assert.ok(!c.iceServers[0].username);
});

test('token próprio: tem jti único (sessão) e ICE na ordem UDP → TCP → TLS', () => {
  const a = tokens.mintProjectClub({ room: 'pc_x', userId: 'u1', name: 'U' });
  const b = tokens.mintProjectClub({ room: 'pc_x', userId: 'u1', name: 'U' });
  const pa = jwt.verify(a.token, process.env.MEDIA_SERVER_SECRET);
  assert.ok(pa.jti && pa.jti !== jwt.decode(b.token).jti);
  assert.ok(pa.exp - pa.iat >= 8 * 3600, 'token vale pra reconexões numa call longa');
  const turn = a.iceServers.find((s) => s.username);
  assert.deepEqual(turn.urls, ['turn:media.example:3478?transport=udp', 'turn:media.example:3478?transport=tcp', 'turns:media.example:5349?transport=tcp']);
  assert.ok(a.iceServers.length <= 2);
});

test('provedores removidos não existem mais no módulo de tokens', () => {
  for (const fn of ['mintLiveKit', 'mintJitsi', 'mintDaily', 'mintTRTCUserSig']) assert.equal(tokens[fn], undefined, fn);
});

// ---------------- /api/voice/join de ponta a ponta ----------------

function call(handler, { user, query = {}, body = {}, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(v) { resolve({ status: this.statusCode, body: v }); return this; },
    };
    const req = { user, query, body, headers, app: { get: () => undefined } };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}
const userA = { id: 'ua', clanId: 'c1', username: 'ana' };

test('join: sempre o servidor próprio, com credenciais e sala determinística', async () => {
  const ctrl = require('../src/controllers/voiceController');
  const r = await call(ctrl.getJoin, { user: userA, query: { channelName: 'clan:c1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, 'projectclub');
  assert.equal(r.body.reserveMode, false);
  assert.equal(r.body.projectclub.room, ctrl.roomNameFor('clan:c1'));
  assert.ok(jwt.verify(r.body.projectclub.token, process.env.MEDIA_SERVER_SECRET));
  for (const k of ['livekit', 'jitsi', 'daily', 'trtc']) assert.equal(r.body[k], undefined, k);
});

test('join (compatibilidade): cliente antigo com clientReady de provedores removidos recebe o servidor próprio', async () => {
  const ctrl = require('../src/controllers/voiceController');
  for (const clientReady of ['projectclub,livekit,jitsi', 'livekit,jitsi', 'jitsi', 'agora,getstream']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call(ctrl.getJoin, { user: userA, query: { channelName: 'clan:c1', clientReady }, headers: { 'user-agent': 'ProjectClub/1.27.2 Android' } });
    assert.equal(r.body.provider, 'projectclub', clientReady);
    assert.ok(r.body.projectclub.token);
  }
});

test('join: sem acesso à sala → 403; sem servidor configurado → 503 claro', async () => {
  const ctrl = require('../src/controllers/voiceController');
  let r = await call(ctrl.getJoin, { user: userA, query: { channelName: 'clan:outro' } });
  assert.equal(r.status, 403);
  const saved = process.env.MEDIA_SERVER_SECRET;
  delete process.env.MEDIA_SERVER_SECRET;
  try {
    r = await call(ctrl.getJoin, { user: userA, query: { channelName: 'clan:c1' } });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'voice-unavailable');
  } finally { process.env.MEDIA_SERVER_SECRET = saved; }
});

test('report: só telemetria (ok), com limite por pessoa; não grava nada no Redis', async () => {
  const ctrl = require('../src/controllers/voiceController');
  const quiet = console.warn; console.warn = () => {};
  try {
    let r = await call(ctrl.postReport, { user: { id: 'rep1' }, body: { provider: 'projectclub', code: 'ICE_FAILED' } });
    assert.deepEqual(r.body, { ok: true, counted: true });
    r = await call(ctrl.postReport, { user: { id: 'rep1' }, body: { provider: 'livekit', code: 'x' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.counted, false);
  } finally { console.warn = quiet; }
  assert.equal(kv.size + hashes.size, 0);
});

test('painel "Servidor de voz": status + chaves mascaradas; salvar aplica na hora', async () => {
  const ctrl = require('../src/controllers/voiceController');
  const quiet = console.log; console.log = () => {};
  try {
    let r = await call(ctrl.getServer, { user: userA });
    assert.equal(r.body.configured, true);
    assert.deepEqual(r.body.fields.map((f) => f.env), ['MEDIA_SERVER_URL', 'MEDIA_SERVER_SECRET', 'TURN_URLS', 'TURN_SECRET']);
    assert.ok(!JSON.stringify(r.body).includes(process.env.MEDIA_SERVER_SECRET), 'segredo nunca volta');
    r = await call(ctrl.postServerConfig, { user: userA, body: { values: { TURN_URLS: 'turn:novo.example:3478' } } });
    assert.equal(process.env.TURN_URLS, 'turn:novo.example:3478');
    assert.equal(r.body.fields.find((f) => f.env === 'TURN_URLS').source, 'painel');
    r = await call(ctrl.postServerConfig, { user: userA, body: {} });
    assert.equal(r.status, 400);
  } finally { console.log = quiet; }
});

// ---------------- faxina das chaves antigas ----------------

test('faxina no boot: apaga override/disabled/epoch/roomprov/lastjoin/health e chaves de provedores removidos; mantém o resto', async () => {
  const { cleanupLegacyVoiceKeys } = require('../src/services/voiceLegacyCleanup');
  for (const k of ['voice:override', 'voice:disabled', 'voice:epoch', 'voice:roomprov:0:clan:c1', 'voice:lastjoin:u:clan:c1', 'voice:health:fail:livekit', 'voiceusage:2026-10:projectclub', 'voice:room:clan:c1']) kv.set(k, '1');
  hashes.set('voice:credentials', new Map([['LIVEKIT_API_SECRET', 'x'], ['JITSI_DOMAIN', 'y'], ['MEDIA_SERVER_URL', 'z']]));
  const n = await cleanupLegacyVoiceKeys(fakeRedis, { log() {}, warn() {} });
  assert.equal(n, 8);
  assert.deepEqual([...kv.keys()].sort(), ['voice:room:clan:c1', 'voiceusage:2026-10:projectclub']);
  assert.deepEqual([...hashes.get('voice:credentials').keys()], ['MEDIA_SERVER_URL']);
  // Redis fora do ar: nunca lança.
  assert.equal(await cleanupLegacyVoiceKeys({ del: async () => { throw new Error('down'); } }, { log() {}, warn() {} }), 0);
});

test('minutos do mês: contador só do servidor próprio', async () => {
  const usage = require('../src/services/voiceUsage');
  assert.equal(usage.PROVIDER, 'projectclub');
  assert.equal(usage.monthKey(new Date('2026-10-31T23:59:59Z')), '2026-10');
  assert.equal(usage.usageRedisKey(new Date('2026-11-01T00:00:00Z')), 'voiceusage:2026-11:projectclub');
  await usage.addMinutes(3);
  await usage.addMinutes(2);
  assert.equal(await usage.getMinutes(), 5);
});
