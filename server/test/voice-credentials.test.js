// Chaves do servidor de voz próprio salvas pelo painel: criptografadas no
// Redis, aplicadas em process.env e nunca devolvidas em texto puro.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const store = new Map();
const fakeRedis = {
  hgetall: async (k) => Object.fromEntries(store.get(k) || new Map()),
  multi() {
    const ops = [];
    const m = {
      hset: (k, f, v) => { ops.push(() => { if (!store.has(k)) store.set(k, new Map()); store.get(k).set(f, v); }); return m; },
      hdel: (k, f) => { ops.push(() => store.get(k)?.delete(f)); return m; },
      exec: async () => ops.forEach((o) => o()),
    };
    return m;
  },
};
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = { exports: { redis: fakeRedis }, loaded: true, id: 'redis' };

process.env.TURN_URLS = 'turn:hospedagem.example:3478';
delete process.env.MEDIA_SERVER_SECRET;
delete process.env.LIVEKIT_API_SECRET;
delete process.env.LIVEKIT_URL;
const creds = require('../src/services/voiceCredentials');

test('salva criptografado, aplica na hora e mascara o segredo', async () => {
  const fields = await creds.save('projectclub', { MEDIA_SERVER_URL: 'wss://midia.example/ws', MEDIA_SERVER_SECRET: 'segredo-muito-secreto' });
  assert.equal(process.env.MEDIA_SERVER_SECRET, 'segredo-muito-secreto');
  const stored = store.get('voice:credentials').get('MEDIA_SERVER_SECRET');
  assert.ok(!stored.includes('segredo'), 'não fica em texto puro no Redis');
  const secret = fields.find((f) => f.env === 'MEDIA_SERVER_SECRET');
  assert.equal(secret.value, '••••reto');
  assert.equal(secret.source, 'painel');
});

test('campo apagado volta pro valor da hospedagem', async () => {
  await creds.save('projectclub', { TURN_URLS: 'turn:novo.example:3478' });
  assert.equal(process.env.TURN_URLS, 'turn:novo.example:3478');
  await creds.save('projectclub', { TURN_URLS: '' });
  assert.equal(process.env.TURN_URLS, 'turn:hospedagem.example:3478');
});

test('só existem as chaves do servidor próprio; provedores removidos são inválidos', async () => {
  await creds.save('projectclub', { LIVEKIT_API_SECRET: 'x' });
  assert.equal(process.env.LIVEKIT_API_SECRET, undefined);
  for (const p of ['nada', 'livekit', 'daily', 'trtc', 'jitsi', 'agora', 'getstream']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(() => creds.save(p, {}), /inválid/);
  }
  assert.deepEqual(Object.keys(creds.FIELDS), ['projectclub']);
});

test('recarrega do Redis na subida (e ignora chaves antigas de provedores removidos)', async () => {
  store.get('voice:credentials').set('LIVEKIT_URL', creds._encrypt('wss://x.livekit.cloud'));
  delete process.env.MEDIA_SERVER_URL;
  const quiet = console.log; console.log = () => {};
  await creds.load();
  console.log = quiet;
  assert.equal(process.env.MEDIA_SERVER_URL, 'wss://midia.example/ws');
  assert.equal(process.env.LIVEKIT_URL, undefined);
});
