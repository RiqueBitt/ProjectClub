// Contabilidade de uso do Agora + decisão de provedor (Agora ⇆ Jitsi) +
// nome de sala do Jitsi com hash. As funções puras são testadas direto; o
// contador é testado com um Redis em memória injetado via require.cache
// (mesma técnica de perf3.test.js).
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---------- Redis em memória (stub) ANTES de carregar o serviço ----------
const src = (rel) => path.join(__dirname, '..', 'src', rel);
const mem = new Map();
const fakeRedis = {
  async incrby(key, n) { const v = (parseInt(mem.get(key) || '0', 10) || 0) + n; mem.set(key, String(v)); return v; },
  async expire() { return 1; },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
};
require.cache[src('config/redis.js')] = {
  id: src('config/redis.js'), filename: src('config/redis.js'), loaded: true,
  exports: { redis: fakeRedis, cacheGetOrSet: async (_k, _t, f) => f(), cacheInvalidate: async () => {} },
};

const voiceUsage = require(src('services/voiceUsage.js'));

function resetEnv() {
  delete process.env.AGORA_MONTHLY_MINUTES;
  delete process.env.AGORA_SWITCH_MARGIN;
  delete process.env.JITSI_ROOM_SALT;
}

// ---------- monthKey (virada de mês, UTC) ----------
test('monthKey: YYYY-MM em UTC e muda na virada do mês', () => {
  assert.equal(voiceUsage.monthKey(new Date('2026-01-15T10:00:00Z')), '2026-01');
  assert.equal(voiceUsage.monthKey(new Date('2026-01-31T23:59:59Z')), '2026-01');
  assert.equal(voiceUsage.monthKey(new Date('2026-02-01T00:00:00Z')), '2026-02');
  assert.equal(voiceUsage.monthKey(new Date('2026-12-31T23:59:59Z')), '2026-12');
});

// ---------- decideProvider: abaixo/acima do limite + margem ----------
test('decideProvider: abaixo da margem fica no Agora', () => {
  const d = voiceUsage.decideProvider({ minutesUsed: 9000, limit: 10000, margin: 0.95 });
  assert.equal(d.provider, 'agora');
  assert.equal(d.reason, 'ok');
  assert.equal(d.threshold, 9500);
});

test('decideProvider: ao atingir a margem (95%) troca pro Jitsi', () => {
  const exact = voiceUsage.decideProvider({ minutesUsed: 9500, limit: 10000, margin: 0.95 });
  assert.equal(exact.provider, 'jitsi');
  assert.equal(exact.reason, 'limite-mensal-agora');
  const over = voiceUsage.decideProvider({ minutesUsed: 12000, limit: 10000, margin: 0.95 });
  assert.equal(over.provider, 'jitsi');
});

test('decideProvider: logo abaixo da margem ainda é Agora', () => {
  const d = voiceUsage.decideProvider({ minutesUsed: 9499, limit: 10000, margin: 0.95 });
  assert.equal(d.provider, 'agora');
});

test('decideProvider: margem configurável muda o ponto de troca', () => {
  // Com margem 0.8, 8000/10000 já troca.
  assert.equal(voiceUsage.decideProvider({ minutesUsed: 8000, limit: 10000, margin: 0.8 }).provider, 'jitsi');
  assert.equal(voiceUsage.decideProvider({ minutesUsed: 7999, limit: 10000, margin: 0.8 }).provider, 'agora');
});

test('decideProvider: sem Agora configurado força Jitsi mesmo com uso zero', () => {
  const d = voiceUsage.decideProvider({ minutesUsed: 0, limit: 10000, agoraConfigured: false });
  assert.equal(d.provider, 'jitsi');
  assert.equal(d.reason, 'agora-nao-configurado');
});

test('decideProvider: valores inválidos caem nos padrões seguros', () => {
  const d = voiceUsage.decideProvider({ minutesUsed: NaN, limit: -5, margin: 9 });
  assert.equal(d.provider, 'agora');
  assert.equal(d.limit, voiceUsage.DEFAULT_MONTHLY_MINUTES);
  assert.equal(d.threshold, Math.floor(voiceUsage.DEFAULT_MONTHLY_MINUTES * voiceUsage.DEFAULT_SWITCH_MARGIN));
});

// ---------- limite/margem a partir do ambiente ----------
test('limitFromEnv / marginFromEnv: lê env com padrão', () => {
  resetEnv();
  assert.equal(voiceUsage.limitFromEnv(), 10000);
  assert.equal(voiceUsage.marginFromEnv(), 0.95);
  process.env.AGORA_MONTHLY_MINUTES = '5000';
  process.env.AGORA_SWITCH_MARGIN = '0.9';
  assert.equal(voiceUsage.limitFromEnv(), 5000);
  assert.equal(voiceUsage.marginFromEnv(), 0.9);
  // Valores absurdos são ignorados.
  process.env.AGORA_SWITCH_MARGIN = '2';
  assert.equal(voiceUsage.marginFromEnv(), 0.95);
  resetEnv();
});

// ---------- jitsiRoomName (hash estável + imprevisível) ----------
test('jitsiRoomName: estável, prefixado e com hash (não contém o id cru)', () => {
  const a = voiceUsage.jitsiRoomName('ch123', 'segredo');
  const b = voiceUsage.jitsiRoomName('ch123', 'segredo');
  assert.equal(a, b, 'mesma entrada → mesma sala');
  assert.match(a, /^projectclub-[0-9a-f]{40}$/);
  assert.ok(!a.includes('ch123'), 'não vaza o id do canal');
});

test('jitsiRoomName: salt diferente → sala diferente (não adivinhável sem o salt)', () => {
  const comSalt = voiceUsage.jitsiRoomName('dm:42', 'salt-A');
  const outroSalt = voiceUsage.jitsiRoomName('dm:42', 'salt-B');
  const semSalt = voiceUsage.jitsiRoomName('dm:42', '');
  assert.notEqual(comSalt, outroSalt);
  assert.notEqual(comSalt, semSalt);
});

test('jitsiRoomName: canais diferentes → salas diferentes', () => {
  assert.notEqual(voiceUsage.jitsiRoomName('ch1', 's'), voiceUsage.jitsiRoomName('ch2', 's'));
});

// ---------- contador (Redis em memória) + virada de mês ----------
test('contador: soma segundos e converte pra minutos; vira sozinho no mês novo', async () => {
  mem.clear();
  const jan = new Date('2026-01-10T12:00:00Z');
  const feb = new Date('2026-02-02T12:00:00Z');

  await voiceUsage.recordAgoraSeconds(600, jan); // 10 min
  await voiceUsage.recordAgoraSeconds(1800, jan); // +30 min
  assert.equal(await voiceUsage.getMinutesUsed(jan), 40);

  // Mês seguinte começa do zero (chave YYYY-MM diferente).
  assert.equal(await voiceUsage.getMinutesUsed(feb), 0);
  await voiceUsage.recordAgoraSeconds(120, feb);
  assert.equal(await voiceUsage.getMinutesUsed(feb), 2);
  // Janeiro continua intacto.
  assert.equal(await voiceUsage.getMinutesUsed(jan), 40);
});

test('contador: zero/negativo não contam', async () => {
  mem.clear();
  const d = new Date('2026-03-01T00:00:00Z');
  await voiceUsage.recordAgoraSeconds(0, d);
  await voiceUsage.recordAgoraSeconds(-100, d);
  assert.equal(await voiceUsage.getMinutesUsed(d), 0);
});

test('getDecision: usa o contador do mês pra decidir (sobe de agora pra jitsi)', async () => {
  mem.clear();
  resetEnv();
  process.env.AGORA_MONTHLY_MINUTES = '100';
  process.env.AGORA_SWITCH_MARGIN = '0.95';
  const d = new Date('2026-04-15T00:00:00Z');

  let dec = await voiceUsage.getDecision({ agoraConfigured: true, date: d });
  assert.equal(dec.provider, 'agora');

  // 95 min de 100 → atinge a margem.
  await voiceUsage.recordAgoraSeconds(95 * 60, d);
  dec = await voiceUsage.getDecision({ agoraConfigured: true, date: d });
  assert.equal(dec.provider, 'jitsi');
  assert.equal(dec.minutesUsed, 95);
  assert.equal(dec.limit, 100);
  resetEnv();
});
