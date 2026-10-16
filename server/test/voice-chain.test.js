// Testes da cadeia de provedores de voz: servidor próprio → Agora → Stream.
// Decisão (limite, override, desativar), painel e a ESTRUTURA dos tokens —
// sem Redis nem rede: as funções testadas são puras.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const providers = require('../src/services/voiceProviders');
const usage = require('../src/services/voiceUsage');
const decision = require('../src/services/voiceDecision');
const tokens = require('../src/services/voiceTokens');

const FULL_ENV = {
  AGORA_APP_ID: 'a', AGORA_APP_CERTIFICATE: 'b',
  GETSTREAM_API_KEY: 'gs', GETSTREAM_API_SECRET: 'gssecret',
  AGORA_MONTHLY_MINUTES: '1000', GETSTREAM_MONTHLY_MINUTES: '1000',
  VOICE_USAGE_MARGIN: '1',
};

test('cadeia: só servidor próprio, Agora e Stream, nessa ordem', () => {
  assert.deepEqual(providers.PROVIDER_ORDER, ['projectclub', 'agora', 'getstream']);
  assert.equal(providers.PRIMARY_PROVIDER, 'agora');
});

test('provedor sem envs não é configurado nem disponível', () => {
  assert.equal(providers.isConfigured('getstream', {}), false);
  assert.equal(providers.isAvailable('getstream', {}), false);
  assert.equal(providers.isAvailable('getstream', FULL_ENV), true);
});

// ---------------- usage: puro + virada de mês ----------------

test('usage: monthKey é UTC e vira no mês certo', () => {
  assert.equal(usage.monthKey(new Date('2026-01-31T23:59:59Z')), '2026-01');
  assert.equal(usage.monthKey(new Date('2026-02-01T00:00:00Z')), '2026-02');
  assert.equal(usage.usageRedisKey('agora', new Date('2026-02-01T00:00:00Z')), 'voiceusage:2026-02:agora');
});

test('usage: percentOf e isOverLimit', () => {
  assert.equal(usage.percentOf(500, 1000), 50);
  assert.equal(usage.percentOf(2000, 1000), 100); // limitado a 100
  assert.equal(usage.percentOf(10, Infinity), 0);
  assert.equal(usage.isOverLimit(999, 1000), false);
  assert.equal(usage.isOverLimit(1000, 1000), true);
  assert.equal(usage.isOverLimit(99999, Infinity), false);
});

test('decisão: tudo zerado → agora (primário)', () => {
  const d = decision.decideProvider({ usageByProvider: {}, env: FULL_ENV });
  assert.equal(d.provider, 'agora');
  assert.equal(d.reason, 'primary');
});

test('decisão: agora estourado → stream', () => {
  const d = decision.decideProvider({ usageByProvider: { agora: 1000 }, env: FULL_ENV });
  assert.equal(d.provider, 'getstream');
});

test('decisão: todos estourados → continua no primeiro disponível (nunca fica sem voz)', () => {
  const d = decision.decideProvider({ usageByProvider: { agora: 1000, getstream: 1000 }, env: FULL_ENV });
  assert.equal(d.provider, 'agora');
  assert.equal(d.reason, 'over-limit');
});

test('decisão: nada configurado → provider null', () => {
  const d = decision.decideProvider({ usageByProvider: {}, env: {} });
  assert.equal(d.provider, null);
  assert.equal(d.reason, 'none');
});

test('override: força o stream ignorando o limite', () => {
  const d = decision.decideProvider({ usageByProvider: { getstream: 5000 }, override: 'getstream', env: FULL_ENV });
  assert.equal(d.provider, 'getstream');
  assert.equal(d.overridden, true);
});

test('override: provedor removido/indisponível é ignorado', () => {
  for (const o of ['jitsi', 'livekit', 'daily']) {
    const d = decision.decideProvider({ usageByProvider: {}, override: o, env: FULL_ENV });
    assert.equal(d.provider, 'agora');
    assert.equal(d.overridden, false);
  }
});

test('desativar: agora desativado → stream', () => {
  const d = decision.decideProvider({ usageByProvider: {}, disabled: ['agora'], env: FULL_ENV });
  assert.equal(d.provider, 'getstream');
});

test('painel: 3 provedores, ativo e modo reserva', () => {
  const panel = decision.buildPanel({ usageByProvider: { agora: 500 }, env: FULL_ENV });
  assert.equal(panel.providers.length, 3);
  assert.equal(panel.active, 'agora');
  assert.equal(panel.reserveMode, false);
  assert.equal(panel.providers.find((p) => p.id === 'agora').percent, 50);
  const p2 = decision.buildPanel({ usageByProvider: { agora: 1000 }, env: FULL_ENV });
  assert.equal(p2.active, 'getstream');
  assert.equal(p2.reserveMode, true);
  assert.equal(p2.providers.find((p) => p.id === 'agora').status, 'esgotado');
});

test('token getstream: JWT HS256 com user_id; sem envs → null', () => {
  const out = tokens.mintGetStream({ userId: 'user-123', callId: 'pc_v1' }, FULL_ENV);
  assert.equal(out.apiKey, 'gs');
  assert.equal(out.callId, 'pc_v1');
  assert.equal(jwt.verify(out.token, 'gssecret').user_id, 'user-123');
  assert.equal(tokens.mintGetStream({ userId: 'u', callId: 'c' }, {}), null);
});

test('token agora: usa o minter existente; sem envs → null', () => {
  // Sem AGORA_* no process.env real do teste, o minter devolve null.
  const saved = { id: process.env.AGORA_APP_ID, cert: process.env.AGORA_APP_CERTIFICATE };
  delete process.env.AGORA_APP_ID; delete process.env.AGORA_APP_CERTIFICATE;
  assert.equal(tokens.mintAgora('v1', 'u1'), null);
  if (saved.id) process.env.AGORA_APP_ID = saved.id;
  if (saved.cert) process.env.AGORA_APP_CERTIFICATE = saved.cert;
});

// ---------------- servidor de mídia PRÓPRIO (projectclub) ----------------

const OWN_ENV = {
  ...FULL_ENV,
  MEDIA_SERVER_URL: 'wss://media.example/ws', MEDIA_SERVER_SECRET: 'segredo-do-servidor-de-midia-123',
  TURN_URLS: 'turn:media.example:3478?transport=udp,turn:media.example:3478?transport=tcp', TURN_SECRET: 'turnsecret',
};

test('próprio: sem MEDIA_SERVER_URL/SECRET não é configurado e a cadeia começa no agora', () => {
  assert.equal(providers.isConfigured('projectclub', FULL_ENV), false);
  const d = decision.decideProvider({ usageByProvider: {}, override: null, disabled: [], env: FULL_ENV });
  assert.equal(d.provider, 'agora');
});

test('próprio: configurado → é o primeiro da cadeia, ilimitado, e NÃO é modo reserva', () => {
  assert.equal(providers.isConfigured('projectclub', OWN_ENV), true);
  assert.equal(providers.getMonthlyLimit('projectclub', OWN_ENV), Infinity);
  const d = decision.decideProvider({ usageByProvider: { projectclub: 999999, agora: 0 }, override: null, disabled: [], env: OWN_ENV });
  assert.equal(d.provider, 'projectclub');
  assert.equal(providers.isReserve('projectclub'), false);
  assert.equal(providers.isReserve('agora'), false);
  assert.equal(providers.isReserve('getstream'), true);
  const panel = decision.buildPanel({ usageByProvider: {}, override: null, disabled: [], env: OWN_ENV });
  assert.equal(panel.active, 'projectclub');
  assert.equal(panel.reserveMode, false);
  assert.equal(panel.providers.find((p) => p.id === 'projectclub').unlimited, true);
});

test('próprio: desativado na cadeia → cai pro agora', () => {
  const d = decision.decideProvider({ usageByProvider: {}, override: null, disabled: ['projectclub'], env: OWN_ENV });
  assert.equal(d.provider, 'agora');
});

test('token próprio: JWT HS256 com sub/room/name e exp curto; url e ICE (STUN + TURN temporário)', () => {
  const now = Date.now();
  const c = tokens.mintProjectClub({ room: 'pc_abc', userId: 'u1', name: 'Ana' }, OWN_ENV, now);
  assert.equal(c.url, 'wss://media.example/ws');
  const payload = jwt.verify(c.token, OWN_ENV.MEDIA_SERVER_SECRET, { algorithms: ['HS256'] });
  assert.equal(payload.sub, 'u1'); assert.equal(payload.room, 'pc_abc'); assert.equal(payload.name, 'Ana');
  assert.equal(payload.exp - payload.iat, tokens.MEDIA_TOKEN_TTL_SECONDS);
  // ICE: STUN público (sem STUN_URLS) + TURN com credencial HMAC-SHA1 do coturn
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
  assert.equal(tokens.mintProjectClub({ room: 'r', userId: 'u' }, FULL_ENV), null);
  const noTurn = { ...OWN_ENV, TURN_URLS: '', TURN_SECRET: '' };
  const c = tokens.mintProjectClub({ room: 'r', userId: 'u' }, noTurn);
  assert.equal(c.iceServers.length, 1);
  assert.ok(!c.iceServers[0].username);
});
