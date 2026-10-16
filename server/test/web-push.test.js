// Web Push (navegador/PWA): chaves VAPID persistidas, validação da
// assinatura, envio pra todas as assinaturas da pessoa e limpeza das mortas
// (404/410). Sem rede: o `web-push` é substituído por um fake.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---- fakes ----
const db = { keys: null, subs: [] };
const fakePrisma = {
  webPushKeys: {
    findUnique: async () => db.keys,
    create: async ({ data }) => { if (db.keys) throw new Error('dup'); db.keys = { ...data }; return db.keys; },
  },
  webPushSubscription: {
    findMany: async ({ where }) => db.subs.filter((s) => s.userId === where.userId),
    upsert: async ({ where, update, create }) => {
      const i = db.subs.findIndex((s) => s.endpoint === where.endpoint);
      if (i === -1) db.subs.push({ id: `s${db.subs.length + 1}`, ...create }); else db.subs[i] = { ...db.subs[i], ...update };
    },
    updateMany: async () => {},
    deleteMany: async ({ where }) => {
      if (where.id && where.id.in) db.subs = db.subs.filter((s) => !where.id.in.includes(s.id));
      else db.subs = db.subs.filter((s) => !(s.endpoint === where.endpoint && s.userId === where.userId));
    },
  },
};
const sent = [];
let failWith = null; // endpoint -> statusCode
const fakeWebPush = {
  generateVAPIDKeys: () => ({ publicKey: 'PUB_' + Math.random().toString(36).slice(2), privateKey: 'PRIV' }),
  sendNotification: async (sub, payload, options) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
    if (failWith && failWith[sub.endpoint]) { const e = new Error('gone'); e.statusCode = failWith[sub.endpoint]; throw e; }
    return { statusCode: 201 };
  },
};
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: fakePrisma, loaded: true, id: 'prisma' };
require.cache[require.resolve('web-push')] = { exports: fakeWebPush, loaded: true, id: 'web-push' };

const webPush = require('../src/services/webPush');

const SUB = (endpoint) => ({ endpoint, keys: { p256dh: 'BPp256', auth: 'authkey' } });

beforeEach(() => { sent.length = 0; failWith = null; db.subs = []; });

test('gera as chaves VAPID uma vez e reaproveita (persistidas no banco)', async () => {
  const a = await webPush.getPublicKey();
  const b = await webPush.getPublicKey();
  assert.ok(a && a.startsWith('PUB_'));
  assert.equal(a, b);
  assert.equal(db.keys.publicKey, a, 'guardou no banco');
});

test('valida a assinatura antes de salvar', async () => {
  assert.equal(webPush.isValidSubscription(SUB('https://fcm.googleapis.com/x')), true);
  assert.equal(webPush.isValidSubscription(SUB('http://inseguro')), false);
  assert.equal(webPush.isValidSubscription({ endpoint: 'https://x' }), false);
  await assert.rejects(webPush.saveSubscription('u1', { endpoint: 'nope' }), /inválida/);
  await webPush.saveSubscription('u1', SUB('https://push.example/a'), 'Mozilla/5.0 (Android)');
  assert.equal(db.subs.length, 1);
  assert.equal(db.subs[0].userAgent, 'Mozilla/5.0 (Android)');
});

test('mesmo navegador em outra conta passa a ser da conta nova', async () => {
  await webPush.saveSubscription('u1', SUB('https://push.example/a'));
  await webPush.saveSubscription('u2', SUB('https://push.example/a'));
  assert.equal(db.subs.length, 1);
  assert.equal(db.subs[0].userId, 'u2');
});

test('envia pra todas as assinaturas da pessoa com título/corpo/link e TTL', async () => {
  await webPush.saveSubscription('u1', SUB('https://push.example/a'));
  await webPush.saveSubscription('u1', SUB('https://push.example/b'));
  await webPush.saveSubscription('u2', SUB('https://push.example/c'));
  await webPush.sendWebPushToUser('u1', { title: 'Ana', body: 'oi!', data: { link: '/conversations/1' } });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), ['https://push.example/a', 'https://push.example/b']);
  assert.equal(sent[0].payload.title, 'Ana');
  assert.equal(sent[0].payload.body, 'oi!');
  assert.equal(sent[0].payload.link, '/conversations/1');
  assert.ok(sent[0].options.TTL > 0);
  assert.equal(sent[0].options.vapidDetails.publicKey, db.keys.publicKey);
});

test('assinatura morta (410/404) é apagada; outras falhas ficam', async () => {
  await webPush.saveSubscription('u1', SUB('https://push.example/a'));
  await webPush.saveSubscription('u1', SUB('https://push.example/b'));
  await webPush.saveSubscription('u1', SUB('https://push.example/c'));
  failWith = { 'https://push.example/a': 410, 'https://push.example/b': 500 };
  await webPush.sendWebPushToUser('u1', { title: 'x', body: 'y' });
  assert.deepEqual(db.subs.map((s) => s.endpoint).sort(), ['https://push.example/b', 'https://push.example/c']);
});

test('remover assinatura só apaga a da própria conta', async () => {
  await webPush.saveSubscription('u1', SUB('https://push.example/a'));
  await webPush.removeSubscription('u2', 'https://push.example/a');
  assert.equal(db.subs.length, 1);
  await webPush.removeSubscription('u1', 'https://push.example/a');
  assert.equal(db.subs.length, 0);
});
