// Loja + Apoio: preço calculado no servidor, desconto (Assinante 10%, Super 20%)
// que não acumula, exclusivos liberados pelo status (sem virar posse),
// confirmação de preço, saldo insuficiente, compra única e Gerenciamento
// de Apoio com auditoria. Usa um prisma falso em memória.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const sup = require('../src/services/supporters');

// ---------- prisma falso ----------
let db;
function reset() {
  db = {
    users: new Map([
      ['u1', { id: 'u1', coins: 1000, gems: 10, supporterTier: 'NONE', avatarDecoration: null, profileEffect: null, displayName: 'Ana' }],
      ['u2', { id: 'u2', coins: 1000, gems: 10, supporterTier: 'SUBSCRIBER', avatarDecoration: null, profileEffect: null, displayName: 'Bia' }],
      ['u3', { id: 'u3', coins: 1000, gems: 10, supporterTier: 'SUPER', avatarDecoration: null, profileEffect: null, displayName: 'Caio' }],
      ['admin', { id: 'admin', coins: 0, gems: 0, supporterTier: 'NONE', platformRole: 'ADMIN', displayName: 'Staff' }],
    ]),
    decos: new Map([
      ['d1', { id: 'd1', name: 'Neon', active: true, priceCoins: 200, priceGems: null, discountEligible: true, exclusiveTier: null, imageUrl: 'x', scale: 1, offsetX: 0, offsetY: 0 }],
      ['d2', { id: 'd2', name: 'Sem desconto', active: true, priceCoins: 100, priceGems: null, discountEligible: false, exclusiveTier: null, imageUrl: 'x', scale: 1, offsetX: 0, offsetY: 0 }],
      ['dx', { id: 'dx', name: 'Moldura Apoiador', active: true, priceCoins: null, priceGems: null, discountEligible: true, exclusiveTier: 'SUBSCRIBER', imageUrl: 'x', scale: 1, offsetX: 0, offsetY: 0 }],
    ]),
    effects: new Map(),
    cols: new Map([['cOculta', { id: 'cOculta', showInShop: false }], ['cLoja', { id: 'cLoja', showInShop: true }]]),
    ownD: new Map(), // `${userId}|${id}`
    audit: [],
    ledger: [],
  };
}
reset();
const key = (u, i) => `${u}|${i}`;
const matchUserWhere = (u, where) => Object.entries(where).every(([k, v]) => {
  if (k === 'id') return u.id === v;
  if (v && typeof v === 'object' && 'gte' in v) return (u[k] || 0) >= v.gte;
  return u[k] === v;
});
const pick = (o, select) => (select ? Object.fromEntries(Object.keys(select).filter((k) => k in o).map((k) => [k, o[k]])) : { ...o });
const fake = {
  user: {
    findUnique: async ({ where, select }) => { const u = db.users.get(where.id); return u ? pick(u, select) : null; },
    updateMany: async ({ where, data }) => {
      const u = db.users.get(where.id);
      if (!u || !matchUserWhere(u, where)) return { count: 0 };
      for (const [k, v] of Object.entries(data)) u[k] = v && typeof v === 'object' && 'decrement' in v ? u[k] - v.decrement : v;
      return { count: 1 };
    },
    update: async ({ where, data }) => { const u = db.users.get(where.id); Object.assign(u, data); return { ...u }; },
  },
  avatarDecoration: { findUnique: async ({ where }) => db.decos.get(where.id) || null },
  profileEffect: { findUnique: async ({ where }) => db.effects.get(where.id) || null },
  shopCollection: { findUnique: async ({ where }) => db.cols.get(where.id) || null },
  userAvatarDecoration: {
    findUnique: async ({ where, include }) => {
      const w = where.userId_decorationId; const row = db.ownD.get(key(w.userId, w.decorationId));
      return row ? { ...row, ...(include ? { decoration: db.decos.get(w.decorationId) } : {}) } : null;
    },
    create: async ({ data }) => {
      const k = key(data.userId, data.decorationId);
      if (db.ownD.has(k)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      db.ownD.set(k, { ...data }); return data;
    },
  },
  userProfileEffect: { findUnique: async () => null },
  supporterAuditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  // Transação: copia o estado e só confirma se não der erro (rollback de verdade).
  $transaction: async (fn) => {
    const snap = structuredClone({ users: [...db.users], ownD: [...db.ownD], audit: db.audit });
    try { return await fn(fake); } catch (e) {
      db.users = new Map(snap.users); db.ownD = new Map(snap.ownD); db.audit = snap.audit; throw e;
    }
  },
};
const stub = (rel, exports) => { require.cache[path.resolve(__dirname, rel)] = { exports, loaded: true, id: rel }; };
stub('../src/config/prisma.js', fake);
stub('../src/services/economyLedger.js', { recordTransaction: (userId, t) => db.ledger.push({ userId, ...t }) });
stub('../src/controllers/authController.js', { SELF_USER_FIELDS: { id: true, supporterTier: true }, PUBLIC_USER_FIELDS: {} });
stub('../src/controllers/userController.js', { broadcastUserUpdate: async () => {} });

const shop = require('../src/controllers/shopController');
const supporters = require('../src/controllers/supportersController');

function call(handler, { user = 'u1', params = {}, body = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    handler({ user: { id: user }, params, body, query, app: { get: () => null } }, res, reject);
  });
}

beforeEach(reset);

// ---------- regra de preço ----------
test('desconto: Assinante 10%, Super 20%, arredondando o desconto pra baixo', () => {
  const item = { priceCoins: 199, priceGems: null, discountEligible: true };
  assert.equal(sup.priceFor(item, 'coins', 'NONE').final, 199);
  assert.equal(sup.priceFor(item, 'coins', 'SUBSCRIBER').final, 199 - 19);
  assert.equal(sup.priceFor(item, 'coins', 'SUPER').final, 199 - 39);
  assert.equal(sup.priceFor(item, 'gems', 'SUPER').final, null);
  assert.equal(sup.priceFor({ ...item, discountEligible: false }, 'coins', 'SUPER').final, 199);
  assert.equal(sup.priceFor(item, 'coins', 'HACKER').final, 199, 'categoria desconhecida = sem benefício');
});

test('coleção em oferta: vale o maior desconto, nunca os dois juntos', () => {
  const col = { bundlePriceCoins: 1000, discountEligible: true };
  const offer5 = { active: true, discount: 5 };
  const offer40 = { active: true, discount: 40 };
  assert.deepEqual(sup.bundlePriceFor(col, 'coins', 'SUBSCRIBER', offer5), { base: 1000, discount: 10, final: 900, source: 'SUBSCRIBER' });
  assert.deepEqual(sup.bundlePriceFor(col, 'coins', 'SUPER', offer5), { base: 1000, discount: 20, final: 800, source: 'SUBSCRIBER' });
  assert.deepEqual(sup.bundlePriceFor(col, 'coins', 'SUBSCRIBER', offer40), { base: 1000, discount: 40, final: 600, source: 'OFFER' });
  assert.equal(sup.bundlePriceFor(col, 'coins', 'NONE', null).final, 1000);
});

test('exclusivos: Super libera itens de Assinante, Assinante não libera itens de Super', () => {
  assert.equal(sup.qualifiesFor('SUPER', 'SUBSCRIBER'), true);
  assert.equal(sup.qualifiesFor('SUBSCRIBER', 'SUPER'), false);
  assert.equal(sup.qualifiesFor('NONE', null), true);
});

// ---------- compras ----------
test('Assinante paga o preço com desconto calculado no servidor (ignora preço mandado pelo cliente pra cobrar)', async () => {
  const r = await call(shop.buyDecoration, { user: 'u2', params: { id: 'd1' }, body: { currency: 'coins', price: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.paid, 180);
  assert.equal(db.users.get('u2').coins, 820);
  assert.ok(db.ownD.has(key('u2', 'd1')));
  assert.match(db.ledger[0].label, /-10% Assinante/);
});

test('item fora do desconto custa cheio mesmo pra Super', async () => {
  const r = await call(shop.buyDecoration, { user: 'u3', params: { id: 'd2' }, body: { currency: 'coins' } });
  assert.equal(r.body.paid, 100);
});

test('preço confirmado diferente do real: não cobra e devolve o preço novo', async () => {
  // A pessoa confirmou 180 (era Assinante), mas perdeu o status antes de comprar.
  db.users.get('u2').supporterTier = 'NONE';
  const r = await call(shop.buyDecoration, { user: 'u2', params: { id: 'd1' }, body: { currency: 'coins', expectedPrice: 180 } });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'PRICE_CHANGED');
  assert.equal(r.body.price, 200);
  assert.equal(db.users.get('u2').coins, 1000, 'nada foi cobrado');
  assert.equal(db.ownD.size, 0);
});

test('saldo insuficiente não cobra nem entrega', async () => {
  db.users.get('u1').coins = 50;
  const r = await call(shop.buyDecoration, { user: 'u1', params: { id: 'd1' }, body: { currency: 'coins' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'INSUFFICIENT_FUNDS');
  assert.equal(db.users.get('u1').coins, 50);
  assert.equal(db.ownD.size, 0);
});

test('comprar de novo não cobra duas vezes', async () => {
  await call(shop.buyDecoration, { user: 'u1', params: { id: 'd1' }, body: {} });
  const r = await call(shop.buyDecoration, { user: 'u1', params: { id: 'd1' }, body: {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'ALREADY_OWNED');
  assert.equal(db.users.get('u1').coins, 800);
});

test('exclusivo de apoio não é vendido e só equipa com a categoria certa', async () => {
  const buy = await call(shop.buyDecoration, { user: 'u2', params: { id: 'dx' }, body: {} });
  assert.equal(buy.status, 403);
  assert.equal(buy.body.code, 'EXCLUSIVE');
  assert.equal(await shop.usableItem('deco', 'u1', 'dx'), null, 'membro comum não usa');
  assert.ok(await shop.usableItem('deco', 'u2', 'dx'), 'Assinante usa');
  assert.ok(await shop.usableItem('deco', 'u3', 'dx'), 'Super herda');
  assert.equal(db.ownD.size, 0, 'benefício não cria item no inventário');
});

// ---------- Gerenciamento de Apoio ----------
test('staff muda categoria com motivo; ator vem da sessão e fica na auditoria', async () => {
  const r = await call(supporters.adminSetTier, { user: 'admin', params: { userId: 'u1' }, body: { tier: 'SUPER', reason: 'Apoio no evento', actorId: 'u3' } });
  assert.equal(r.status, 200);
  assert.equal(db.users.get('u1').supporterTier, 'SUPER');
  assert.equal(db.audit.length, 1);
  assert.equal(db.audit[0].actorId, 'admin', 'ignora actorId mandado pelo cliente');
  assert.equal(db.audit[0].fromTier, 'NONE');
});

test('sem motivo ou categoria inválida: recusa sem mexer em nada', async () => {
  assert.equal((await call(supporters.adminSetTier, { user: 'admin', params: { userId: 'u1' }, body: { tier: 'SUPER' } })).status, 400);
  assert.equal((await call(supporters.adminSetTier, { user: 'admin', params: { userId: 'u1' }, body: { tier: 'ADMIN', reason: 'tentativa' } })).status, 400);
  assert.equal(db.users.get('u1').supporterTier, 'NONE');
  assert.equal(db.audit.length, 0);
});

test('perder a categoria desequipa a moldura exclusiva, mas mantém o que foi comprado', async () => {
  const u = db.users.get('u2');
  u.avatarDecoration = JSON.stringify({ id: 'dx' });
  u.profileEffect = null;
  await call(supporters.adminSetTier, { user: 'admin', params: { userId: 'u2' }, body: { tier: 'NONE', reason: 'Assinatura encerrada' } });
  assert.equal(db.users.get('u2').avatarDecoration, null);

  // Moldura comprada continua equipada ao perder o status.
  db.users.get('u3').avatarDecoration = JSON.stringify({ id: 'd1' });
  db.ownD.set(key('u3', 'd1'), { userId: 'u3', decorationId: 'd1' });
  await call(supporters.adminSetTier, { user: 'admin', params: { userId: 'u3' }, body: { tier: 'SUBSCRIBER', reason: 'Rebaixado' } });
  assert.equal(JSON.parse(db.users.get('u3').avatarDecoration).id, 'd1');
});

test('rotas de apoio exigem administrador da plataforma', () => {
  const router = require('../src/routes/supporters');
  const { requirePlatformAdmin } = require('../src/middleware/platformAdmin');
  const admin = router.stack.filter((l) => l.route && l.route.path.startsWith('/admin'));
  assert.equal(admin.length, 3);
  for (const l of admin) assert.ok(l.route.stack.some((s) => s.handle === requirePlatformAdmin), `${l.route.path} sem checagem de admin`);
});

test('coleção fora da Loja: item dela não é vendido nem presenteado; coleção visível vende normal', async () => {
  db.decos.set('dh', { id: 'dh', name: 'Oculta', active: true, priceCoins: 50, priceGems: null, discountEligible: true, exclusiveTier: null, imageUrl: 'x', scale: 1, offsetX: 0, offsetY: 0, collectionId: 'cOculta' });
  db.decos.set('dv', { id: 'dv', name: 'Visível', active: true, priceCoins: 50, priceGems: null, discountEligible: true, exclusiveTier: null, imageUrl: 'x', scale: 1, offsetX: 0, offsetY: 0, collectionId: 'cLoja' });
  const r = await call(shop.buyDecoration, { params: { id: 'dh' }, body: { currency: 'coins' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'NOT_FOR_SALE');
  assert.equal(db.users.get('u1').coins, 1000);
  assert.ok(!db.ownD.has(key('u1', 'dh')));
  const ok = await call(shop.buyDecoration, { params: { id: 'dv' }, body: { currency: 'coins' } });
  assert.equal(ok.status, 200);
  assert.ok(db.ownD.has(key('u1', 'dv')));
});

test('bônus de XP: Assinante +5%, Super +15%, nunca menos que o base', () => {
  assert.equal(sup.withXpBonus(100, 'NONE'), 100);
  assert.equal(sup.withXpBonus(100, 'SUBSCRIBER'), 105);
  assert.equal(sup.withXpBonus(100, 'SUPER'), 115);
  assert.equal(sup.withXpBonus(30, 'SUBSCRIBER'), 31);
  assert.equal(sup.withXpBonus(10, 'HACKER'), 10);
});
