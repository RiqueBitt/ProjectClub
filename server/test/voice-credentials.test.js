// Chaves dos provedores de voz salvas pelo painel: criptografadas no
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

process.env.AGORA_APP_ID = 'id-da-hospedagem';
delete process.env.LIVEKIT_API_SECRET;
const creds = require('../src/services/voiceCredentials');

test('salva criptografado, aplica na hora e mascara o segredo', async () => {
  const fields = await creds.save('livekit', { LIVEKIT_URL: 'wss://x.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'segredo-muito-secreto' });
  assert.equal(process.env.LIVEKIT_API_SECRET, 'segredo-muito-secreto');
  const stored = store.get('voice:credentials').get('LIVEKIT_API_SECRET');
  assert.ok(!stored.includes('segredo'), 'não fica em texto puro no Redis');
  const secret = fields.find((f) => f.env === 'LIVEKIT_API_SECRET');
  assert.equal(secret.value, '••••reto');
  assert.equal(secret.source, 'painel');
});

test('campo apagado volta pro valor da hospedagem', async () => {
  await creds.save('agora', { AGORA_APP_ID: 'novo-id' });
  assert.equal(process.env.AGORA_APP_ID, 'novo-id');
  await creds.save('agora', { AGORA_APP_ID: '' });
  assert.equal(process.env.AGORA_APP_ID, 'id-da-hospedagem');
});

test('não aceita chave de outro provedor nem provedor inválido', async () => {
  await creds.save('agora', { LIVEKIT_API_SECRET: 'x' });
  assert.equal(process.env.LIVEKIT_API_SECRET, 'segredo-muito-secreto');
  await assert.rejects(() => creds.save('nada', {}), /inválido/);
});

test('recarrega do Redis na subida', async () => {
  delete process.env.LIVEKIT_URL;
  await creds.load();
  assert.equal(process.env.LIVEKIT_URL, 'wss://x.livekit.cloud');
});
