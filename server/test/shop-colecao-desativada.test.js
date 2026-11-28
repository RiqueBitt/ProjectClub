// Coleção desativada (ou item desativado): some da vitrine, mas quem já tem
// continua vendo no inventário e pode equipar. Prisma falso em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const decos = [
  { id: 'dAtiva', name: 'Ativa', active: true, collectionId: null, priceCoins: 10, exclusiveTier: null, stock: null },
  { id: 'dColOff', name: 'Da coleção desligada', active: true, collectionId: 'cOff', priceCoins: 10, exclusiveTier: null, stock: null },
  { id: 'dColOff2', name: 'Da coleção desligada (não tenho)', active: true, collectionId: 'cOff', priceCoins: 10, exclusiveTier: null, stock: null },
  { id: 'dOff', name: 'Item desligado', active: false, collectionId: null, priceCoins: 10, exclusiveTier: null, stock: null },
  { id: 'dOff2', name: 'Item desligado (não tenho)', active: false, collectionId: null, priceCoins: 10, exclusiveTier: null, stock: null },
];
const cols = [{ id: 'cOff', name: 'Velha', active: false, showInShop: true }];
const owned = [{ decorationId: 'dColOff', serial: 1, expiresAt: null }, { decorationId: 'dOff', serial: 2, expiresAt: null }];

// where simples: { active }, { id: { in } }, { OR: [...] }, { showInShop }.
const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => {
  if (k === 'OR') return v.some((w) => matches(row, w));
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
  return row[k] === v;
});
const withCount = (r) => ({ ...r, _count: { owners: 0 } });
const fake = {
  avatarDecoration: { findMany: async ({ where }) => decos.filter((d) => matches(d, where)).map(withCount) },
  profileEffect: { findMany: async () => [], groupBy: async () => [] },
  shopItem: { findMany: async () => [] },
  shopCollection: { findMany: async ({ where }) => cols.filter((c) => matches(c, where)) },
  shopBanner: { findMany: async () => [] },
  userAvatarDecoration: { findMany: async () => owned, groupBy: async () => [] },
  userProfileEffect: { findMany: async () => [], groupBy: async () => [] },
  userShopItem: { findMany: async () => [], groupBy: async () => [] },
  user: { findUnique: async () => ({ id: 'u1', coins: 0, gems: 0, supporterTier: 'NONE' }) },
};
const stub = (rel, exports) => { require.cache[path.resolve(__dirname, rel)] = { exports, loaded: true, id: rel }; };
stub('../src/config/prisma.js', fake);
stub('../src/services/economyLedger.js', { recordTransaction: () => {} });
stub('../src/controllers/authController.js', { SELF_USER_FIELDS: { id: true }, PUBLIC_USER_FIELDS: {} });
stub('../src/controllers/userController.js', { broadcastUserUpdate: async () => {} });

const shop = require('../src/controllers/shopController');
const decorations = require('../src/controllers/decorationsController');

const call = (handler) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
  handler({ user: { id: 'u1' }, params: {}, body: {}, query: {}, app: { get: () => null } }, res, reject);
});

test('Loja: itens de coleção ou item desativado só aparecem pra quem tem, fora da vitrine', async () => {
  const { body } = await call(shop.shop);
  const byId = Object.fromEntries(body.decorations.map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(byId).sort(), ['dAtiva', 'dColOff', 'dOff']);
  assert.equal(byId.dAtiva.inShop, true);
  assert.equal(byId.dColOff.inShop, false);
  assert.equal(byId.dColOff.owned, true);
  assert.equal(byId.dOff.inShop, false);
  assert.equal(byId.dOff.owned, true);
  assert.equal(body.collections.length, 0, 'coleção desativada não vai pra vitrine');
});

test('inventário de molduras: inclui a desativada que a pessoa tem', async () => {
  const { body } = await call(decorations.list);
  const ids = body.items.map((d) => d.id).sort();
  assert.deepEqual(ids, ['dAtiva', 'dColOff', 'dColOff2', 'dOff']);
  assert.equal(body.items.find((d) => d.id === 'dOff').owned, true);
});
