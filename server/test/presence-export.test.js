// Rich presence por HTTP (apps do ecossistema) e exportação de dados (LGPD).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const redisData = new Map();
const fakeRedis = { set: async (k, v) => { redisData.set(k, v); }, get: async (k) => redisData.get(k) || null, del: async (k) => { redisData.delete(k); } };
const broadcasts = [];
require.cache[path.resolve(__dirname, '../src/config/redis.js')] = { exports: { redis: fakeRedis }, loaded: true, id: 'redis' };
require.cache[path.resolve(__dirname, '../src/config/prisma.js')] = { exports: {
  user: { findUnique: async () => ({ id: 'u1', username: 'ana', displayName: 'Ana', email: 'a@x', passwordHash: 'HASH', twoFactorSecret: 'SEC' }), findMany: async () => [{ id: 'u2', displayName: 'Beto', username: 'beto' }] },
  userSettings: { findUnique: async () => ({ theme: 'dark' }) },
  message: { findMany: async () => [{ id: 'm1', content: 'oi' }] },
  post: { findMany: async () => [] }, postComment: { findMany: async () => [] },
  economyTransaction: { findMany: async () => [{ coins: 5 }] },
  friendship: { findMany: async () => [{ requesterId: 'u1', addresseeId: 'u2', createdAt: new Date() }] },
  gamePlaytime: { findMany: async () => [] }, minigameStat: { findMany: async () => [] }, userAchievement: { findMany: async () => [] },
  testimonial: { findMany: async () => { throw new Error('tabela caiu'); } }, reminder: { findMany: async () => [] }, scheduledMessage: { findMany: async () => [] },
}, loaded: true, id: 'prisma' };
require.cache[path.resolve(__dirname, '../src/services/gamePlaytime.js')] = { exports: { recordBeat: () => {} }, loaded: true, id: 'gp' };
require.cache[path.resolve(__dirname, '../src/sockets/index.js')] = { exports: {
  broadcastActivityChange: async (io, uid, a) => broadcasts.push({ uid, a }),
  sameActivity: (a, b) => a && b && a.type === b.type && a.name === b.name && a.detail === b.detail,
}, loaded: true, id: 'sock' };

const presence = require('../src/services/presenceApi');
const { exportData, SECRET_USER_FIELDS } = require('../src/controllers/dataExportController');

test('presença: sanitiza, grava com TTL pedido e só retransmite quando muda', async () => {
  await assert.rejects(presence.setPresence(null, 'u1', { type: 'app' }), /nome/);
  const r = await presence.setPresence(null, 'u1', { type: 'app', name: ' CanvasProject ', detail: 'pintando', imageUrl: 'javascript:alert(1)', ttlSeconds: 9999 });
  assert.equal(r.ttlSeconds, presence.MAX_TTL);
  assert.equal(r.activity.name, 'CanvasProject');
  assert.equal(r.activity.imageUrl, undefined, 'URL inválida cai fora');
  assert.equal(JSON.parse(redisData.get('activity:u1')).name, 'CanvasProject');
  assert.equal(broadcasts.length, 1);
  await presence.setPresence(null, 'u1', { type: 'app', name: 'CanvasProject', detail: 'pintando' });
  assert.equal(broadcasts.length, 1, 'mesma atividade: só renova, não retransmite');
  await presence.setPresence(null, 'u1', { type: 'game', name: 'Minecraft', imageUrl: '/apps/projectmc/icon.png' });
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[1].a.type, 'game');
  await presence.clearPresence(null, 'u1');
  assert.equal(redisData.has('activity:u1'), false);
  assert.equal(broadcasts[2].a, null);
});

test('exportar dados: JSON com anexo, sem segredos, tolerante a tabela com erro', async () => {
  const headers = {}; let body = null;
  const res = { setHeader: (k, v) => { headers[k] = v; }, send: (b) => { body = b; }, status: () => res, json: () => {} };
  await exportData({ user: { id: 'u1' } }, res, (e) => { throw e; });
  assert.match(headers['Content-Disposition'], /attachment; filename="projectclub-dados-ana-\d{4}-\d{2}-\d{2}\.json"/);
  const data = JSON.parse(body);
  for (const k of SECRET_USER_FIELDS) assert.equal(k in data.account, false, `${k} não vai no export`);
  assert.equal(data.account.username, 'ana');
  assert.equal(data.messages.length, 1);
  assert.deepEqual(data.friends.map((f) => f.displayName), ['Beto']);
  assert.equal(data.testimonials.length, 0, 'tabela com erro vira lista vazia');
  assert.equal(data.counts.friends, 1);
});
