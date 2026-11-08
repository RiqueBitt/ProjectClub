// Voz "igual ao Discord" no backend: claims de permissão no token de mídia,
// limite de usuários (com MOVER MEMBROS furando), entrada atômica no Redis
// (script Lua) e trava por pessoa+canal, moderação (hierarquia de cargos),
// controle do servidor de mídia (POST /control, nunca lança) e o limite do
// "está falando".
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');

const { PERMISSIONS } = require('../src/services/permissions');
const policy = require('../src/services/voiceJoinPolicy');
const moderation = require('../src/services/voiceModeration');
const mediaControl = require('../src/services/mediaControl');
const tokens = require('../src/services/voiceTokens');
const { createSpeakingRelay } = require('../src/utils/speakingRelay');

const bits = (...keys) => keys.reduce((acc, k) => acc | PERMISSIONS[k], 0n);

// ---------- Redis de verdade (redis-server local numa porta livre) ----------
let redisProc = null; let redis = null; let store = null;
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
before(async () => {
  const port = await freePort();
  try {
    redisProc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    redisProc.on('error', () => { redisProc = null; });
    redis = new Redis({ port, host: '127.0.0.1', lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
    redis.on('error', () => { /* enquanto o redis-server sobe */ });
    for (let i = 0; i < 40; i += 1) {
      try { await redis.connect(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await redis.ping();
  } catch { redis = null; }
  if (redis) {
    require.cache[path.resolve(__dirname, '../src/config/redis.js')] = { exports: { redis }, loaded: true, id: 'redis' };
    store = require('../src/services/voiceRoomStore');
  }
});
after(async () => {
  try { await redis?.quit(); } catch { /* ok */ }
  try { redisProc?.kill('SIGKILL'); } catch { /* ok */ }
});

// ---------- claims e limite ----------
test('claims: SPEAK/VIDEO viram canSpeak/canVideo; plateia do palco não fala; mudo da moderação vai junto', () => {
  const all = bits('CONNECT', 'SPEAK', 'VIDEO');
  assert.deepEqual(policy.claimsFor({ perms: all, channel: { type: 'VOICE' } }), { canSpeak: true, canVideo: true, role: 'speaker', serverMuted: false, serverDeafened: false });
  assert.equal(policy.claimsFor({ perms: bits('CONNECT', 'VIDEO'), channel: { type: 'VOICE' } }).canSpeak, false);
  assert.equal(policy.claimsFor({ perms: bits('CONNECT', 'SPEAK'), channel: { type: 'VOICE' } }).canVideo, false);
  const stage = policy.claimsFor({ perms: all, channel: { type: 'STAGE' } });
  assert.equal(stage.role, 'audience'); assert.equal(stage.canSpeak, false); assert.equal(stage.canVideo, false);
  const mod = policy.claimsFor({ perms: all | bits('MUTE_MEMBERS'), channel: { type: 'STAGE' } });
  assert.equal(mod.role, 'speaker'); assert.equal(mod.canSpeak, true);
  const promoted = policy.claimsFor({ perms: all, channel: { type: 'STAGE' }, participant: { role: 'speaker' } });
  assert.equal(promoted.canSpeak, true, 'promovido no palco fala');
  const deaf = policy.claimsFor({ perms: all, channel: { type: 'VOICE' }, modState: { serverDeafened: true } });
  assert.equal(deaf.serverMuted, true, 'ensurdecido pela moderação também não fala');
});

test('mintProjectClub leva as claims no JWT (e sem claims sai como antes)', () => {
  const env = { MEDIA_SERVER_URL: 'wss://m.exemplo/ws', MEDIA_SERVER_SECRET: 'segredo-0123456789abcdef' };
  const c = tokens.mintProjectClub({ room: 'pc_x', userId: 'u1', name: 'U', claims: { canSpeak: false, canVideo: true, role: 'audience', serverMuted: true, lixo: 1 } }, env);
  const p = jwt.verify(c.token, env.MEDIA_SERVER_SECRET);
  assert.equal(p.canSpeak, false); assert.equal(p.canVideo, true); assert.equal(p.role, 'audience'); assert.equal(p.serverMuted, true);
  assert.equal(p.lixo, undefined, 'só campos conhecidos');
  const old = jwt.verify(tokens.mintProjectClub({ room: 'pc_x', userId: 'u1' }, env).token, env.MEDIA_SERVER_SECRET);
  assert.equal(old.canSpeak, undefined);
});

function fakeDeps({ channel, perms, participant = null, size = 0, ticket = false, mod = null }) {
  return {
    prisma: { channel: { findUnique: async () => channel } },
    getEffectivePermissions: async () => perms,
    voiceStore: {
      getParticipant: async () => participant,
      getModState: async () => mod || { serverMuted: false, serverDeafened: false },
      hasMoveTicket: async () => ticket,
      roomSize: async () => size,
    },
  };
}

test('limite de usuários no getJoin: cheio → 403 channel-full "Canal cheio"; MOVER MEMBROS, quem já está e quem foi movido furam', async () => {
  const channel = { id: 'c1', type: 'VOICE', userLimit: 2 };
  const user = { id: 'u1' };
  const base = bits('VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'VIDEO');
  const full = await policy.evaluate(user, 'c1', fakeDeps({ channel, perms: base, size: 2 }));
  assert.deepEqual(full.error, { status: 403, code: 'channel-full', message: 'Canal cheio' });
  assert.equal((await policy.evaluate(user, 'c1', fakeDeps({ channel, perms: base, size: 1 }))).error, undefined);
  assert.equal((await policy.evaluate(user, 'c1', fakeDeps({ channel, perms: base | bits('MOVE_MEMBERS'), size: 5 }))).error, undefined, 'MOVER MEMBROS fura');
  assert.equal((await policy.evaluate(user, 'c1', fakeDeps({ channel, perms: base, size: 2, participant: { role: 'speaker' } }))).error, undefined, 'já na sala (reconexão)');
  assert.equal((await policy.evaluate(user, 'c1', fakeDeps({ channel, perms: base, size: 2, ticket: true }))).error, undefined, 'movido por moderador');
  assert.equal((await policy.evaluate(user, 'dm:abc', fakeDeps({ channel: null, perms: 0n }))).claims.canSpeak, true, 'DM sem limite/moderação');
  assert.equal(policy.isFull({ userLimit: 0, size: 99 }), false, 'sem limite');
});

// ---------- entrada atômica + trava ----------
test('decideAdd (regra pura do Lua)', (t) => {
  if (!store) { t.skip('redis-server indisponível'); return; }
  const { decideAdd } = store;
  assert.equal(decideAdd({ exists: true, size: 9, limit: 2 }), 'exists');
  assert.equal(decideAdd({ exists: false, size: 2, limit: 2 }), 'full');
  assert.equal(decideAdd({ exists: false, size: 1, limit: 2 }), 'added');
  assert.equal(decideAdd({ exists: false, size: 50, limit: 0 }), 'added');
});

test('addParticipantIfRoom é atômico: 10 pessoas ao mesmo tempo num canal de 3 → entram exatamente 3', async (t) => {
  if (!store) { t.skip('redis-server indisponível'); return; }
  const ch = `lim-${Date.now()}`;
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.addParticipantIfRoom(ch, `u${i}`, { muted: false }, 3)));
  assert.equal(results.filter((r) => r.status === 'added').length, 3);
  assert.equal(results.filter((r) => r.status === 'full').length, 7);
  assert.equal(await store.roomSize(ch), 3);
  const again = await store.addParticipantIfRoom(ch, 'u0', { muted: true }, 3);
  assert.equal(again.status, 'exists', 'quem já está não é regravado nem barrado');
  assert.equal((await store.getParticipant(ch, 'u0')).muted, false);
  const bypass = await store.addParticipantIfRoom(ch, 'moderador', {}, 0);
  assert.equal(bypass.status, 'added', 'limite 0 (MOVER MEMBROS) fura');
  assert.ok((await store.getActiveRoomIds()).includes(ch));
});

test('withLock serializa voice:join duplicado (o segundo vira reconciliação, user-joined uma vez só)', async (t) => {
  if (!store) { t.skip('redis-server indisponível'); return; }
  const ch = `dup-${Date.now()}`;
  let userJoined = 0;
  const join = () => store.withLock(`join:u1:${ch}`, async () => {
    if (await store.getParticipant(ch, 'u1')) return 'reconciliou';
    await new Promise((r) => setTimeout(r, 30)); // janela de corrida de verdade
    const r = await store.addParticipantIfRoom(ch, 'u1', {}, 0);
    if (r.status === 'added') userJoined += 1;
    return r.status;
  });
  const out = await Promise.all([join(), join(), join()]);
  assert.equal(userJoined, 1);
  assert.deepEqual(out.sort(), ['added', 'reconciliou', 'reconciliou']);
  assert.equal(await redis.exists(`voice:lock:join:u1:${ch}`), 0, 'a trava foi solta');
});

test('estado de moderação persiste por pessoa e o ticket de "mover" expira sozinho', async (t) => {
  if (!store) { t.skip('redis-server indisponível'); return; }
  assert.deepEqual(await store.getModState('m1'), { serverMuted: false, serverDeafened: false });
  await store.setModState('m1', { serverMuted: true });
  await store.setModState('m1', { serverDeafened: true });
  assert.deepEqual(await store.getModState('m1'), { serverMuted: true, serverDeafened: true });
  await store.setModState('m1', { serverMuted: false, serverDeafened: false });
  assert.equal(await redis.exists('voice:mod:m1'), 0, 'sem mudo nem ensurdecer: a chave some');
  await store.grantMoveTicket('m1', 'c9', 60);
  assert.equal(await store.hasMoveTicket('m1', 'c9'), true);
  assert.equal(await store.hasMoveTicket('m1', 'outro'), false);
});

// ---------- moderação ----------
test('checkModeration: permissão certa por ação e hierarquia de cargos', () => {
  const mute = bits('MUTE_MEMBERS');
  assert.equal(moderation.checkModeration({ action: 'server-mute', actorPerms: mute, actorCeiling: 5, targetCeiling: 2 }), null);
  assert.match(moderation.checkModeration({ action: 'server-deafen', actorPerms: mute, actorCeiling: 5, targetCeiling: 2 }), /permissão/);
  assert.match(moderation.checkModeration({ action: 'server-mute', actorPerms: mute, actorCeiling: 2, targetCeiling: 2 }), /cargo igual ou maior/);
  assert.equal(moderation.checkModeration({ action: 'server-mute', actorPerms: mute, actorCeiling: 0, targetCeiling: 9, self: true }), null, 'a si mesmo');
  assert.equal(moderation.checkModeration({ action: 'move', actorPerms: bits('MOVE_MEMBERS'), actorCeiling: Infinity, targetCeiling: 50 }), null, 'ADMIN modera todo mundo');
  assert.match(moderation.checkModeration({ action: 'disconnect', actorPerms: mute, actorCeiling: 9, targetCeiling: 1 }), /permissão/, 'desconectar é MOVER MEMBROS');
  assert.equal(moderation.checkModeration({ action: 'disconnect', actorPerms: bits('ADMINISTRATOR'), actorCeiling: 9, targetCeiling: 1 }), null, 'Administrador tem tudo');
});

test('authorize: alvo precisa estar no canal; mover exige destino de voz com acesso; DM não tem moderação', async () => {
  const channels = { c1: { id: 'c1', type: 'VOICE' }, c2: { id: 'c2', type: 'VOICE' }, txt: { id: 'txt', type: 'TEXT' } };
  const deps = (over = {}) => ({
    prisma: { channel: { findUnique: async ({ where }) => channels[where.id] || null } },
    getEffectivePermissions: async (uid, chId) => (over.perms ? over.perms(uid, chId) : bits('VIEW_CHANNEL', 'CONNECT', 'MOVE_MEMBERS', 'MUTE_MEMBERS')),
    getRoleCeiling: async (uid) => (uid === 'mod' ? 10 : 1),
    voiceStore: { getParticipant: async (ch, uid) => (uid === 'alvo' && ch === 'c1' ? { role: 'speaker' } : null) },
  });
  assert.equal((await moderation.authorize({ actorId: 'mod', channelId: 'c1', targetId: 'alvo', action: 'server-mute' }, deps())).ok, true);
  assert.match((await moderation.authorize({ actorId: 'mod', channelId: 'c1', targetId: 'fora', action: 'server-mute' }, deps())).error, /não está/);
  assert.match((await moderation.authorize({ actorId: 'mod', channelId: 'dm:x', targetId: 'alvo', action: 'server-mute' }, deps())).error, /Não disponível/);
  assert.equal((await moderation.authorize({ actorId: 'mod', channelId: 'c1', targetId: 'alvo', action: 'move', toChannelId: 'c2' }, deps())).ok, true);
  assert.match((await moderation.authorize({ actorId: 'mod', channelId: 'c1', targetId: 'alvo', action: 'move', toChannelId: 'txt' }, deps())).error, /destino inválido/);
  const noDest = deps({ perms: (uid, ch) => (ch === 'c2' ? bits('VIEW_CHANNEL') : bits('VIEW_CHANNEL', 'CONNECT', 'MOVE_MEMBERS')) });
  assert.match((await moderation.authorize({ actorId: 'mod', channelId: 'c1', targetId: 'alvo', action: 'move', toChannelId: 'c2' }, noDest)).error, /acesso ao canal de destino/);
});

// ---------- controle do servidor de mídia ----------
test('mediaControl: URL /control, header do segredo, nome da sala e ordem certa', async () => {
  const env = { MEDIA_SERVER_URL: 'wss://midia.exemplo.com/ws', MEDIA_SERVER_SECRET: 's3gr3do', JWT_ACCESS_SECRET: 'jwt' };
  assert.equal(mediaControl.controlUrl(env), 'https://midia.exemplo.com/control');
  assert.equal(mediaControl.controlUrl({ MEDIA_SERVER_URL: 'ws://127.0.0.1:4443/ws' }), 'http://127.0.0.1:4443/control');
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ ok: true, found: true }) }; };
  const r = await mediaControl.sendControl({ channelId: 'canal-1', peerId: 'u1', action: 'pause-audio', perms: { serverMuted: true } }, { env, fetchImpl });
  assert.deepEqual({ ok: r.ok, found: r.found }, { ok: true, found: true });
  assert.equal(seen.opts.headers['x-media-secret'], 's3gr3do');
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.room, mediaControl.mediaRoomName('canal-1', env));
  assert.equal(body.action, 'pause-audio');
  assert.deepEqual(mediaControl.moderationOrder({ serverMuted: false, serverDeafened: true }), { action: 'pause-audio', perms: { serverMuted: true, serverDeafened: true } });
  assert.deepEqual(mediaControl.moderationOrder({}), { action: 'resume-allowed', perms: { serverMuted: false, serverDeafened: false } });
});

test('mediaControl nunca lança: sem configuração, erro de rede, HTTP 401 e tempo esgotado', async () => {
  const env = { MEDIA_SERVER_URL: 'wss://m/ws', MEDIA_SERVER_SECRET: 'x' };
  const quiet = { warn: () => {} };
  assert.equal((await mediaControl.sendControl({ channelId: 'c', peerId: 'u', action: 'kick' }, { env: {}, log: quiet })).skipped, true);
  assert.equal((await mediaControl.sendControl({ channelId: 'c', peerId: 'u', action: 'kick' }, { env, fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, log: quiet })).ok, false);
  const r401 = await mediaControl.sendControl({ channelId: 'c', peerId: 'u', action: 'kick' }, { env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) }), log: quiet });
  assert.deepEqual({ ok: r401.ok, status: r401.status }, { ok: false, status: 401 });
  const slow = (url, { signal }) => new Promise((_, rej) => { signal.addEventListener('abort', () => { const e = new Error('abort'); e.name = 'AbortError'; rej(e); }); });
  const t0 = Date.now();
  const rt = await mediaControl.sendControl({ channelId: 'c', peerId: 'u', action: 'kick' }, { env, fetchImpl: slow, timeoutMs: 80, log: quiet });
  assert.equal(rt.error, 'tempo esgotado');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal((await mediaControl.sendControl({ channelId: 'c', peerId: 'u', action: 'explodir' }, { env })).ok, false);
});

test('mediaRoomName é igual ao roomNameFor do voiceController (mesma sala no servidor de mídia)', () => {
  const stub = (rel, exports) => { require.cache[path.resolve(__dirname, rel)] = { exports, loaded: true, id: rel }; };
  if (!require.cache[path.resolve(__dirname, '../src/config/redis.js')]) stub('../src/config/redis.js', { redis: {} });
  stub('../src/config/prisma.js', {});
  const { roomNameFor } = require('../src/controllers/voiceController');
  for (const ch of ['abc', 'dm:123', 'clan:x']) assert.equal(mediaControl.mediaRoomName(ch), roomNameFor(ch));
});

// ---------- "está falando" com limite ----------
test('speakingRelay: só quando muda, no máximo 1 a cada 250ms, e o último valor sempre sai', () => {
  let t = 0; const sent = []; const timers = [];
  const relay = createSpeakingRelay({
    minIntervalMs: 250, send: (v) => sent.push([t, v]), now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimer: (h) => { const i = timers.indexOf(h); if (i !== -1) timers.splice(i, 1); },
  });
  const tick = (to) => { t = to; for (const h of [...timers]) if (h.at <= t) { timers.splice(timers.indexOf(h), 1); h.fn(); } };
  relay.push(true); relay.push(true); relay.push(true);
  assert.deepEqual(sent, [[0, true]], 'repetido não sai');
  tick(50); relay.push(false); tick(100); relay.push(true); tick(150); relay.push(false);
  assert.equal(sent.length, 1, 'dentro da janela segura');
  tick(250);
  assert.deepEqual(sent, [[0, true], [250, false]], 'o último valor sai no fim da janela');
  tick(300); relay.push(false);
  assert.equal(sent.length, 2);
  tick(600); relay.push(true);
  assert.deepEqual(sent.at(-1), [600, true]);
  // pisca e volta dentro da janela: nada muda pra quem vê
  tick(650); relay.push(false); tick(700); relay.push(true); tick(900);
  assert.deepEqual(sent.at(-1), [600, true]);
  assert.equal(sent.length, 3);
  relay.dispose();
});
