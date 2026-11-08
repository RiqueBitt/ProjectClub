// GET /api/messages/:id/reactions/:emoji — "quem reagiu" com um emoji.
// Sem banco: prisma e o cálculo de permissões de canal são trocados por
// versões falsas em memória (mesmo esquema de perf3.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

const { PERMISSIONS } = require(src('services/permissions.js'));
const VIEW = PERMISSIONS.VIEW_CHANNEL;

// ---- dados falsos ----
const messages = {
  'm-pub': { id: 'm-pub', channelId: 'c-pub', conversationId: null, deleted: false },
  'm-priv': { id: 'm-priv', channelId: 'c-priv', conversationId: null, deleted: false },
  'm-dm': { id: 'm-dm', channelId: null, conversationId: 'dm-1', deleted: false },
  'm-group': { id: 'm-group', channelId: null, conversationId: 'g-1', deleted: false },
  'm-gone': { id: 'm-gone', channelId: 'c-pub', conversationId: null, deleted: true },
};
const channels = { 'c-pub': { id: 'c-pub' }, 'c-priv': { id: 'c-priv' } };
// quem enxerga cada canal
const canView = { 'c-pub': new Set(['eu', 'outro']), 'c-priv': new Set(['outro']) };
const convMembers = { 'dm-1': new Set(['eu', 'u1']), 'g-1': new Set(['outro', 'u1', 'u2']) };

const base = Date.parse('2026-01-01T00:00:00.000Z');
const reactions = [];
for (let i = 0; i < 7; i += 1) {
  // dois pares com o mesmo milissegundo, pra testar o desempate por id
  const at = new Date(base + Math.floor(i / 2) * 1000);
  reactions.push({ id: `r${i}`, messageId: 'm-pub', emoji: '😀', createdAt: at, user: { id: `u${i}`, username: `user${i}`, displayName: `Pessoa ${i}`, avatarUrl: null } });
}
reactions.push({ id: 'rx', messageId: 'm-pub', emoji: '👍', createdAt: new Date(base), user: { id: 'u9', username: 'u9', displayName: 'Nove', avatarUrl: null } });
for (const mid of ['m-priv', 'm-dm', 'm-group']) {
  reactions.push({ id: `r-${mid}`, messageId: mid, emoji: '😀', createdAt: new Date(base), user: { id: 'u1', username: 'user1', displayName: 'Pessoa 1', avatarUrl: null } });
}

function matches(row, where) {
  if (where.messageId && row.messageId !== where.messageId) return false;
  if (where.emoji && row.emoji !== where.emoji) return false;
  if (where.OR) {
    return where.OR.some((c) => {
      if (c.createdAt?.gt) return row.createdAt > c.createdAt.gt;
      return row.createdAt.getTime() === c.createdAt.getTime() && row.id > c.id.gt;
    });
  }
  return true;
}

stub('config/prisma.js', {
  message: { findUnique: async ({ where }) => messages[where.id] || null },
  channel: { findUnique: async ({ where }) => channels[where.id] || null },
  conversationMember: {
    findUnique: async ({ where }) => {
      const { conversationId, userId } = where.conversationId_userId;
      return convMembers[conversationId]?.has(userId) ? { conversationId, userId } : null;
    },
  },
  reaction: {
    count: async ({ where }) => reactions.filter((r) => matches(r, where)).length,
    findMany: async ({ where, take }) => reactions
      .filter((r) => matches(r, where))
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, take),
  },
});
// Redis falso: o controller puxa serviços que abrem conexão ao carregar.
stub('config/redis.js', {
  redis: { set: async () => 'OK', get: async () => null, del: async () => 0, on: () => {} },
  cacheGetOrSet: async (key, ttl, compute) => compute(),
  cacheInvalidate: async () => {},
});
stub('services/authz.js', {
  getEffectivePermissions: async (userId, channelId) => (canView[channelId]?.has(userId) ? VIEW : 0n),
  channelHasRestrictions: async () => false,
});

const { listReactors } = require(src('controllers/messageController.js'));

const call = (userId, id, emoji, query = {}) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { resolve({ status: this.statusCode, body: b }); },
  };
  listReactors({ user: { id: userId }, params: { id, emoji }, query }, res, (err) => resolve({ status: err.status || 500, body: { error: err.message } }));
});

test('reações: canal público lista quem reagiu, paginado por cursor estável', async () => {
  const first = await call('eu', 'm-pub', '😀', { limit: '3' });
  assert.equal(first.status, 200);
  assert.equal(first.body.count, 7);
  assert.deepEqual(first.body.users.map((u) => u.id), ['u0', 'u1', 'u2']);
  assert.ok(first.body.nextCursor);
  const seen = [...first.body.users.map((u) => u.id)];
  let cursor = first.body.nextCursor;
  let pages = 1;
  while (cursor) {
    const page = await call('eu', 'm-pub', '😀', { limit: '3', cursor });
    assert.equal(page.status, 200);
    seen.push(...page.body.users.map((u) => u.id));
    cursor = page.body.nextCursor;
    pages += 1;
    assert.ok(pages < 10);
  }
  assert.equal(pages, 3);
  assert.deepEqual(seen, ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6']); // sem repetir nem pular
  // só o emoji pedido
  const thumbs = await call('eu', 'm-pub', '👍');
  assert.deepEqual(thumbs.body.users.map((u) => u.id), ['u9']);
  assert.equal(thumbs.body.nextCursor, null);
  // nada sensível vaza: só os campos do mini usuário + data
  assert.deepEqual(Object.keys(thumbs.body.users[0]).sort(), ['avatarUrl', 'displayName', 'id', 'reactedAt', 'username']);
});

test('reações: limite padrão e teto do tamanho da página', async () => {
  const r = await call('eu', 'm-pub', '😀', { limit: '100000' });
  assert.equal(r.body.users.length, 7);
  const bad = await call('eu', 'm-pub', '😀', { cursor: 'lixo' });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.users.length, 7); // cursor inválido = primeira página
});

test('reações: canal privado sem VIEW_CHANNEL dá 403', async () => {
  assert.equal((await call('eu', 'm-priv', '😀')).status, 403);
  assert.equal((await call('outro', 'm-priv', '😀')).status, 200);
});

test('reações: DM e grupo só pra quem é membro', async () => {
  assert.equal((await call('eu', 'm-dm', '😀')).status, 200);
  assert.equal((await call('estranho', 'm-dm', '😀')).status, 403);
  assert.equal((await call('eu', 'm-group', '😀')).status, 403);
  const g = await call('outro', 'm-group', '😀');
  assert.equal(g.status, 200);
  assert.equal(g.body.count, 1);
});

test('reações: mensagem inexistente/apagada = 404 e emoji inválido = 400', async () => {
  assert.equal((await call('eu', 'nao-existe', '😀')).status, 404);
  assert.equal((await call('eu', 'm-gone', '😀')).status, 404);
  assert.equal((await call('eu', 'm-pub', '<script>')).status, 400);
  assert.equal((await call('eu', 'm-pub', 'abc')).status, 400);
});
