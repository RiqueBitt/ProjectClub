// Ofertas da Loja: oferta da semana e primeira compra (services/shopDeals.js).
const test = require('node:test');
const assert = require('node:assert');
const deals = require('../src/services/shopDeals');

const item = (id, priceCoins, extra = {}) => ({ id, kind: 'FONT', active: true, priceCoins, priceGems: null, stock: null, exclusiveTier: null, discountEligible: true, ...extra });

test('semana começa na segunda (Brasília) e troca na outra segunda', () => {
  // Domingo 23h em Brasília (= segunda 02h UTC) ainda é a semana anterior.
  assert.equal(deals.weekKey(new Date('2026-11-30T02:00:00Z')), '2026-11-23');
  assert.equal(deals.weekKey(new Date('2026-11-30T03:00:00Z')), '2026-11-30');
  assert.equal(deals.weekEndsAt(new Date('2026-11-25T12:00:00Z')), '2026-11-30T03:00:00.000Z');
});

test('escolhe 3 itens baratos, iguais pra todo mundo na semana', () => {
  const pool = [
    item('a', 400), item('b', 800), item('c', 1100), item('d', 600), item('e', 900),
    item('caro', 5000), item('barato-demais', 100), item('limitado', 500, { stock: 10 }),
    item('vip', 500, { exclusiveTier: 'SUPER' }), item('moldura', 500, { kind: 'DECO' }),
  ];
  const a = deals.pickWeekly(pool, '2026-11-23');
  assert.equal(a.length, 3);
  assert.deepEqual(deals.pickWeekly([...pool].reverse(), '2026-11-23'), a, 'ordem não importa');
  for (const id of a) assert.ok(['a', 'b', 'c', 'd', 'e'].includes(id));
  const weeks = new Set(['2026-11-30', '2026-12-07', '2026-12-14'].map((w) => deals.pickWeekly(pool, w).join()));
  assert.ok(weeks.size > 1, 'muda de semana pra semana');
});

test('oferta da semana: metade do preço em moedas; gemas não mudam', () => {
  const ctx = { dealIds: new Set(['a']), first: false };
  const p = deals.pricing(item('a', 801, { priceGems: 10 }), 'NONE', ctx);
  assert.deepEqual(p.coins, { base: 801, discount: 50, final: 401, source: 'DEAL' });
  assert.equal(p.gems.final, 10);
  // Fora da oferta: preço normal.
  assert.equal(deals.priceFor(item('z', 800), 'coins', 'NONE', ctx).final, 800);
});

test('primeira compra: metade; não acumula com Assinante (fica o menor)', () => {
  const ctx = { dealIds: new Set(), first: true };
  assert.equal(deals.priceFor(item('z', 600), 'coins', 'SUPER', ctx).final, 300);
  assert.equal(deals.priceFor(item('z', 600), 'coins', 'SUPER', ctx).source, 'FIRST');
  assert.equal(deals.priceFor(item('z', 600), 'coins', 'NONE', { dealIds: new Set(), first: false }).final, 600);
  assert.match(deals.discountLabel({ discount: 50, source: 'FIRST' }), /primeira compra/);
});

test('banco com erro: segue sem oferta (a compra não trava)', async () => {
  deals._test.reset();
  const broken = { shopCollection: { findMany: async () => { throw new Error('fora'); } }, economyTransaction: { count: async () => { throw new Error('fora'); } } };
  const ctx = await deals.context(broken, 'u1');
  assert.equal(ctx.dealIds.size, 0);
  assert.equal(ctx.first, false);
});

test('contexto lê os itens e o histórico de compras', async () => {
  deals._test.reset();
  const db = {
    shopCollection: { findMany: async () => [{ id: 'oculta' }] },
    shopItem: { findMany: async () => [item('a', 400), item('b', 500, { collectionId: 'oculta' })] },
    economyTransaction: { count: async () => 0 },
  };
  const ctx = await deals.context(db, 'u1');
  assert.deepEqual([...ctx.dealIds], ['a']);
  assert.equal(ctx.first, true);
  assert.equal(deals.summary(ctx).firstPurchase, true);
});
