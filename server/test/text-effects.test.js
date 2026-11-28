// Efeitos de texto da Loja (TEXTFX): valor gravado no nome, equipar só com o
// item na mão, e efeitos de perfil desativados. Prisma falso em memória.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let db;
function reset() {
  db = {
    users: new Map([['u1', { id: 'u1', coins: 5000, gems: 0, supporterTier: 'NONE', profileNameEffect: 'NEON' }]]),
    items: new Map([
      ['fxA', { id: 'fxA', kind: 'TEXTFX', key: 'textfx:aurora', name: 'Aurora', active: true, priceCoins: 2500, priceGems: null, discountEligible: true, exclusiveTier: null, stock: null, collectionId: null }],
      ['fxX', { id: 'fxX', kind: 'TEXTFX', key: 'textfx:inventado', name: 'Inventado', active: true, priceCoins: 10, priceGems: null, discountEligible: true, exclusiveTier: null, stock: null, collectionId: null }],
      ['st1', { id: 'st1', kind: 'STYLE', key: 'style:anime', name: 'Anime', active: true }],
    ]),
    own: new Set(),
    effects: [{ id: 'e1', active: true }, { id: 'e2', active: true }],
  };
}
reset();
const pick = (o, select) => (select ? Object.fromEntries(Object.keys(select).filter((k) => k in o).map((k) => [k, o[k]])) : { ...o });
const fake = {
  user: {
    findUnique: async ({ where, select }) => { const u = db.users.get(where.id); return u ? pick(u, select) : null; },
    update: async ({ where, data }) => { const u = db.users.get(where.id); Object.assign(u, data); return { ...u }; },
  },
  shopItem: { findUnique: async ({ where }) => db.items.get(where.id) || null },
  userShopItem: {
    findUnique: async ({ where, include }) => {
      const w = where.userId_itemId;
      if (!db.own.has(`${w.userId}|${w.itemId}`)) return null;
      return { userId: w.userId, itemId: w.itemId, ...(include ? { item: db.items.get(w.itemId) } : {}) };
    },
  },
  profileEffect: {
    updateMany: async ({ where, data }) => {
      let count = 0;
      db.effects.forEach((e) => { if (e.active === where.active) { Object.assign(e, data); count += 1; } });
      return { count };
    },
  },
};
const stub = (rel, exports) => { require.cache[path.resolve(__dirname, rel)] = { exports, loaded: true, id: rel }; };
stub('../src/config/prisma.js', fake);
stub('../src/services/economyLedger.js', { recordTransaction: () => {} });
stub('../src/controllers/authController.js', { SELF_USER_FIELDS: { id: true, profileNameEffect: true }, PUBLIC_USER_FIELDS: {} });
stub('../src/controllers/userController.js', { broadcastUserUpdate: async () => {} });

const shop = require('../src/controllers/shopController');
const fx = require('../src/services/textEffects');

function call(handler, { user = 'u1', body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler({ user: { id: user }, params: {}, body, query: {}, app: { get: () => null } }, res, reject);
  });
}
beforeEach(reset);

test('valor no nome: FX_<CHAVE> só para efeitos conhecidos', () => {
  assert.equal(fx.fxValueOf({ key: 'textfx:aurora' }), 'FX_AURORA');
  assert.equal(fx.fxValueOf({ key: 'textfx:ouro' }), 'FX_OURO');
  assert.equal(fx.fxValueOf({ key: 'textfx:inventado' }), null);
  assert.equal(fx.fxValueOf({ key: null }), null);
  assert.equal(fx.BUILTIN_TEXT_EFFECTS.length >= 8, true);
  assert.equal(new Set(fx.TEXT_EFFECT_KEYS).size, fx.TEXT_EFFECT_KEYS.length, 'chaves repetidas');
});

test('loja: efeito de texto é um tipo próprio, separado dos estilos', () => {
  assert.equal(shop.KINDS.textfx.type, 'TEXTFX');
  assert.equal(shop.KINDS.textfx.item, 'shopItem');
});

test('equipar sem ter: recusa e não mexe no nome', async () => {
  const r = await call(shop.equipTextEffect, { body: { id: 'fxA' } });
  assert.equal(r.status, 403);
  assert.equal(db.users.get('u1').profileNameEffect, 'NEON');
});

test('equipar com o item: grava FX_AURORA; tirar volta pro Sólido', async () => {
  db.own.add('u1|fxA');
  let r = await call(shop.equipTextEffect, { body: { id: 'fxA' } });
  assert.equal(r.status, 200);
  assert.equal(db.users.get('u1').profileNameEffect, 'FX_AURORA');
  r = await call(shop.equipTextEffect, { body: { id: null } });
  assert.equal(db.users.get('u1').profileNameEffect, 'SOLID');
});

test('equipar estilo de perfil como efeito de texto: recusa (tipo errado)', async () => {
  db.own.add('u1|st1');
  const r = await call(shop.equipTextEffect, { body: { id: 'st1' } });
  assert.equal(r.status, 403);
});

test('item TEXTFX com chave desconhecida não vira efeito', async () => {
  db.own.add('u1|fxX');
  const r = await call(shop.equipTextEffect, { body: { id: 'fxX' } });
  assert.equal(r.status, 403);
});

test('efeitos de perfil saem da Loja (desativados)', async () => {
  await fx.disableProfileEffects();
  assert.deepEqual(db.effects.map((e) => e.active), [false, false]);
});
