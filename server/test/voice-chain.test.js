// Testes da cadeia de provedores de voz (item pedido): uso por provedor,
// decisão/cadeia (abaixo/acima do limite, pular não configurado, override,
// virada de mês) e a ESTRUTURA dos tokens (próprio/livekit/trtc/jitsi —
// sem bater nos serviços ao vivo). `node --test`. Nada de Redis/rede aqui:
// todas as funções testadas são puras e recebem env/uso por parâmetro.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const jwt = require('jsonwebtoken');

const providers = require('../src/services/voiceProviders');
const usage = require('../src/services/voiceUsage');
const decision = require('../src/services/voiceDecision');
const tokens = require('../src/services/voiceTokens');

// Ambiente "tudo configurado" (menos o gate do Daily, de propósito), com o
// servidor de mídia PRÓPRIO (principal) e as reservas externas.
const FULL_ENV = {
  MEDIA_SERVER_URL: 'wss://media.example/ws', MEDIA_SERVER_SECRET: 'segredo-do-servidor-de-midia-123',
  LIVEKIT_URL: 'wss://lk.example', LIVEKIT_API_KEY: 'lk', LIVEKIT_API_SECRET: 'lksecret',
  DAILY_DOMAIN: 'club.daily.co', DAILY_ROOM_URL: 'https://club.daily.co/sala', // sem DAILY_API_KEY
  TRTC_SDK_APP_ID: '140000000', TRTC_SECRET_KEY: 'trtcsecret',
  // limites pequenos pra facilitar o teste de estouro
  LIVEKIT_MONTHLY_MINUTES: '1000', DAILY_MONTHLY_MINUTES: '1000', TRTC_MONTHLY_MINUTES: '1000',
  VOICE_USAGE_MARGIN: '1', // sem margem pra contas redondas no teste
};

// ---------------- providers / config ----------------

test('cadeia: ordem e primário corretos (servidor próprio é o principal)', () => {
  assert.deepEqual(providers.PROVIDER_ORDER, ['projectclub', 'livekit', 'daily', 'trtc', 'jitsi']);
  assert.equal(providers.PRIMARY_PROVIDER, 'projectclub');
});

test('Agora e Stream (GetStream) foram removidos: ids antigos são desconhecidos', () => {
  for (const id of ['agora', 'getstream']) {
    assert.equal(providers.getMeta(id), null);
    assert.equal(providers.isConfigured(id, { AGORA_APP_ID: 'a', AGORA_APP_CERTIFICATE: 'b', GETSTREAM_API_KEY: 'k', GETSTREAM_API_SECRET: 's' }), false);
    assert.equal(providers.isReserve(id), false);
  }
  assert.equal(typeof tokens.mintAgora, 'undefined');
  assert.equal(typeof tokens.mintGetStream, 'undefined');
});

test('configured x available: Daily configurado mas indisponível sem DAILY_API_KEY; com a chave fica disponível', () => {
  assert.equal(providers.isConfigured('daily', FULL_ENV), true);
  assert.equal(providers.isAvailable('daily', FULL_ENV), false); // falta o gate
  const withKey = { ...FULL_ENV, DAILY_API_KEY: 'k' };
  assert.equal(providers.isAvailable('daily', withKey), true);
});

test('provedor sem envs não é configurado; Jitsi é sempre disponível', () => {
  assert.equal(providers.isConfigured('livekit', {}), false);
  assert.equal(providers.isConfigured('jitsi', {}), true);
  assert.equal(providers.isAvailable('jitsi', {}), true);
  assert.equal(providers.getMonthlyLimit('jitsi', {}), Infinity);
});

// ---------------- usage: puro + virada de mês ----------------

test('usage: monthKey é UTC e vira no mês certo', () => {
  assert.equal(usage.monthKey(new Date('2026-01-31T23:59:59Z')), '2026-01');
  assert.equal(usage.monthKey(new Date('2026-02-01T00:00:00Z')), '2026-02');
  assert.equal(usage.usageRedisKey('livekit', new Date('2026-02-01T00:00:00Z')), 'voiceusage:2026-02:livekit');
});

test('usage: percentOf e isOverLimit', () => {
  assert.equal(usage.percentOf(500, 1000), 50);
  assert.equal(usage.percentOf(2000, 1000), 100); // limitado a 100
  assert.equal(usage.percentOf(10, Infinity), 0);
  assert.equal(usage.isOverLimit(999, 1000), false);
  assert.equal(usage.isOverLimit(1000, 1000), true);
  assert.equal(usage.isOverLimit(99999, Infinity), false);
});

// ---------------- decisão / cadeia ----------------

test('decisão: tudo zerado → usa o primário (servidor próprio)', () => {
  const d = decision.decideProvider({ usageByProvider: {}, env: FULL_ENV });
  assert.equal(d.provider, 'projectclub');
  assert.equal(d.reason, 'primary');
});

test('decisão: servidor próprio fora (desativado) → passa pro livekit (próximo da cadeia)', () => {
  const d = decision.decideProvider({ usageByProvider: {}, disabled: ['projectclub'], env: FULL_ENV });
  assert.equal(d.provider, 'livekit');
  assert.equal(d.reason, 'chain');
});

test('decisão: próprio fora + livekit estourado, Daily pulado (sem chave) → vai pro trtc', () => {
  const d = decision.decideProvider({ usageByProvider: { livekit: 1000 }, disabled: ['projectclub'], env: FULL_ENV });
  assert.equal(d.provider, 'trtc'); // daily é pulado por falta do gate
});

test('decisão: próprio desarmado e reservas estouradas → cai no Jitsi (fallback final)', () => {
  const d = decision.decideProvider({ usageByProvider: { livekit: 1000, trtc: 1000 }, unhealthy: ['projectclub'], env: FULL_ENV });
  // o Jitsi saudável vence antes do modo "degradado".
  assert.equal(d.provider, 'jitsi');
});

test('decisão: sem NENHUM provedor configurado → fallback explícito pro Jitsi', () => {
  const d = decision.decideProvider({ usageByProvider: {}, disabled: ['jitsi'], env: {} });
  // Mesmo "desativando" o jitsi (que o store proíbe, mas a função pura
  // aceita), a decisão nunca fica sem provedor: cai no fallback final.
  assert.equal(d.provider, 'jitsi');
  assert.equal(d.reason, 'fallback');
});

test('decisão: só o servidor próprio configurado → projectclub; desarmado e sem reserva → Jitsi', () => {
  const env = { MEDIA_SERVER_URL: 'wss://m/ws', MEDIA_SERVER_SECRET: 'x'.repeat(20) };
  assert.equal(decision.decideProvider({ usageByProvider: {}, env }).provider, 'projectclub');
  assert.equal(decision.decideProvider({ usageByProvider: {}, unhealthy: ['projectclub'], env }).provider, 'jitsi');
});

test('decisão: pula provedores NÃO configurados (só livekit e jitsi no env)', () => {
  const env = { LIVEKIT_URL: 'wss://lk', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', LIVEKIT_MONTHLY_MINUTES: '1000', VOICE_USAGE_MARGIN: '1' };
  assert.equal(decision.decideProvider({ usageByProvider: {}, env }).provider, 'livekit');
  assert.equal(decision.decideProvider({ usageByProvider: { livekit: 1000 }, env }).provider, 'jitsi');
});

test('decisão: uso/override/desativado com ids removidos (agora/getstream) não quebra nada', () => {
  const d = decision.decideProvider({ usageByProvider: { agora: 99999, getstream: 5 }, override: 'agora', disabled: ['getstream'], unhealthy: ['agora'], env: FULL_ENV });
  assert.equal(d.provider, 'projectclub');
  assert.equal(d.overridden, false);
  const panel = decision.buildPanel({ usageByProvider: { agora: 10 }, override: 'getstream', env: FULL_ENV });
  assert.equal(panel.active, 'projectclub');
  assert.ok(!panel.providers.some((p) => p.id === 'agora' || p.id === 'getstream'));
});

test('override: força um provedor específico ignorando o limite', () => {
  const d = decision.decideProvider({ usageByProvider: { trtc: 5000 }, override: 'trtc', env: FULL_ENV });
  assert.equal(d.provider, 'trtc');
  assert.equal(d.overridden, true);
  assert.equal(d.reason, 'override');
});

test('override: apontando pra provedor indisponível é ignorado (segue automático)', () => {
  const d = decision.decideProvider({ usageByProvider: {}, override: 'daily', env: FULL_ENV });
  assert.equal(d.provider, 'projectclub'); // daily indisponível (sem chave) → ignora override
  assert.equal(d.overridden, false);
});

test('painel: lista todos com status/percent e marca o ativo e o modo reserva', () => {
  const panel = decision.buildPanel({ usageByProvider: { livekit: 500 }, env: FULL_ENV });
  assert.equal(panel.active, 'projectclub');
  assert.equal(panel.primary, 'projectclub');
  assert.equal(panel.reserveMode, false);
  assert.equal(panel.providers.length, 5);
  const own = panel.providers.find((p) => p.id === 'projectclub');
  assert.equal(own.active, true);
  assert.equal(own.isPrimary, true);
  assert.equal(own.status, 'ativo');
  const livekit = panel.providers.find((p) => p.id === 'livekit');
  assert.equal(livekit.percent, 50);
  assert.equal(livekit.status, 'em_espera');
  const daily = panel.providers.find((p) => p.id === 'daily');
  assert.equal(daily.configured, true);
  assert.equal(daily.enabled, false);
  assert.equal(daily.status, 'falta_chave');
  const jitsi = panel.providers.find((p) => p.id === 'jitsi');
  assert.equal(jitsi.unlimited, true);
  assert.equal(jitsi.limit, null);
});

test('painel: quando o ativo não é o primário, reserveMode = true', () => {
  const panel = decision.buildPanel({ usageByProvider: {}, disabled: ['projectclub'], env: FULL_ENV });
  assert.equal(panel.active, 'livekit');
  assert.equal(panel.reserveMode, true);
  assert.equal(panel.providers.find((p) => p.id === 'livekit').status, 'ativo');
  assert.equal(panel.providers.find((p) => p.id === 'projectclub').status, 'desativado');
});

// ---------------- estrutura dos tokens ----------------

test('token livekit: JWT HS256 com grant video.roomJoin e sala/identidade certas', () => {
  const out = tokens.mintLiveKit({ room: 'pc_v1', identity: 'user-123', name: 'Rique' }, FULL_ENV);
  assert.equal(out.url, 'wss://lk.example');
  assert.equal(out.room, 'pc_v1');
  const decoded = jwt.verify(out.token, FULL_ENV.LIVEKIT_API_SECRET);
  assert.equal(decoded.sub, 'user-123');
  assert.equal(decoded.iss, FULL_ENV.LIVEKIT_API_KEY);
  assert.equal(decoded.video.room, 'pc_v1');
  assert.equal(decoded.video.roomJoin, true);
  assert.equal(decoded.video.canPublish, true);
});

test('token livekit: sem envs → null', () => {
  assert.equal(tokens.mintLiveKit({ room: 'x', identity: 'y' }, {}), null);
});

test('token trtc: UserSig decodifica (zlib) de volta pro objeto TLS assinado', () => {
  const out = tokens.mintTRTCUserSig({ userId: 'user-123', roomId: 'pc_v1' }, FULL_ENV, 1_700_000_000_000);
  assert.equal(out.sdkAppId, 140000000);
  assert.equal(out.userId, 'user-123');
  assert.ok(typeof out.userSig === 'string' && out.userSig.length > 0);
  // desfaz o base64 "URL-safe" da Tencent e o deflate
  const b64 = out.userSig.replace(/\*/g, '+').replace(/-/g, '/').replace(/_/g, '=');
  const json = JSON.parse(zlib.inflateSync(Buffer.from(b64, 'base64')).toString('utf8'));
  assert.equal(json['TLS.identifier'], 'user-123');
  assert.equal(json['TLS.sdkappid'], 140000000);
  assert.ok(json['TLS.sig']);
  assert.equal(json['TLS.ver'], '2.0');
});

test('token trtc: sem secret → null', () => {
  assert.equal(tokens.mintTRTCUserSig({ userId: 'x' }, { TRTC_SDK_APP_ID: '1' }), null);
});

test('token jitsi: sem segredo → jwt null, domínio meet.jit.si', () => {
  const out = tokens.mintJitsi({ room: 'pc_v1', userId: 'user-123', name: 'Rique' }, {});
  assert.equal(out.domain, 'meet.jit.si');
  assert.equal(out.jwt, null);
  assert.equal(out.room, 'pc_v1');
});

test('token jitsi: com JITSI_APP_ID/SECRET → JWT assinado com a sala no payload', () => {
  const env = { JITSI_APP_ID: 'app', JITSI_APP_SECRET: 'sec', JITSI_DOMAIN: 'meet.example' };
  const out = tokens.mintJitsi({ room: 'pc_v1', userId: 'u1', name: 'Rique' }, env);
  assert.equal(out.domain, 'meet.example');
  const decoded = jwt.verify(out.jwt, 'sec');
  assert.equal(decoded.room, 'pc_v1');
  assert.equal(decoded.aud, 'app');
});

// ---------------- servidor de mídia PRÓPRIO (projectclub) ----------------

const OWN_ENV = {
  ...FULL_ENV,
  TURN_URLS: 'turn:media.example:3478?transport=udp,turn:media.example:3478?transport=tcp', TURN_SECRET: 'turnsecret',
};
const NO_OWN_ENV = { ...FULL_ENV, MEDIA_SERVER_URL: '', MEDIA_SERVER_SECRET: '' };

test('próprio: sem MEDIA_SERVER_URL/SECRET não é configurado e a cadeia começa no livekit (modo reserva)', () => {
  assert.equal(providers.isConfigured('projectclub', NO_OWN_ENV), false);
  const d = decision.decideProvider({ usageByProvider: {}, override: null, disabled: [], env: NO_OWN_ENV });
  assert.equal(d.provider, 'livekit');
  assert.equal(providers.isReserve('livekit'), true);
});

test('próprio: configurado → é o primeiro da cadeia, ilimitado, e NÃO é modo reserva', () => {
  assert.equal(providers.isConfigured('projectclub', OWN_ENV), true);
  assert.equal(providers.getMonthlyLimit('projectclub', OWN_ENV), Infinity);
  const d = decision.decideProvider({ usageByProvider: { projectclub: 999999 }, override: null, disabled: [], env: OWN_ENV });
  assert.equal(d.provider, 'projectclub');
  assert.equal(providers.isReserve('projectclub'), false);
  assert.equal(providers.isReserve('livekit'), true);
  assert.equal(providers.isReserve('jitsi'), true);
  const panel = decision.buildPanel({ usageByProvider: {}, override: null, disabled: [], env: OWN_ENV });
  assert.equal(panel.active, 'projectclub');
  assert.equal(panel.reserveMode, false);
  assert.equal(panel.providers.find((p) => p.id === 'projectclub').unlimited, true);
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
  assert.equal(tokens.mintProjectClub({ room: 'r', userId: 'u' }, NO_OWN_ENV), null);
  const noTurn = { ...OWN_ENV, TURN_URLS: '', TURN_SECRET: '' };
  const c = tokens.mintProjectClub({ room: 'r', userId: 'u' }, noTurn);
  assert.equal(c.iceServers.length, 1);
  assert.ok(!c.iceServers[0].username);
});
