// Fase 4: sorteio semanal, gorjetas (transferência atômica) e cupons da Loja.
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const spTime = require('../src/utils/spTime');
const common = require('../src/services/community/common');
const raffle = require('../src/services/community/raffle');
const tips = require('../src/services/community/tips');
const coupons = require('../src/services/community/coupons');

const MONDAY = new Date('2026-11-02T18:00:00Z');
const LAST_WEEK = new Date('2026-10-28T18:00:00Z');
const reset = () => { common._resetSettled(); common.resetEconomyCache(); };
const coinsOf = (db, id) => db._store.user.find((u) => u.id === id).coins;

// ---------------- Sorteio ----------------
test('sorteio: compra desconta moedas, respeita limite semanal e saldo', async () => {
  reset();
  const s = spies();
  const db = fase4Db({ user: [{ id: 'ana', coins: 1000 }, { id: 'pobre', coins: 10 }] });
  const o = { db, now: LAST_WEEK, ledger: s.ledgerFn };
  const r = await raffle.buyTickets('ana', 4, o);
  assert.equal(r.myTickets, 4);
  assert.equal(coinsOf(db, 'ana'), 1000 - 4 * raffle.TICKET_PRICE);
  assert.equal(s.ledger[0].coins, -4 * raffle.TICKET_PRICE);
  await assert.rejects(raffle.buyTickets('ana', 0, o), /1 a/);
  await assert.rejects(raffle.buyTickets('ana', raffle.MAX_PER_PURCHASE + 1, o), /1 a/);
  await raffle.buyTickets('ana', 10, o);
  await assert.rejects(raffle.buyTickets('ana', 10, o), /só pode comprar mais 6/);
  const before = coinsOf(db, 'ana');
  await raffle.buyTickets('ana', 6, o);
  await assert.rejects(raffle.buyTickets('ana', 1, o), /máximo de bilhetes/);
  assert.equal(coinsOf(db, 'ana'), before - 6 * raffle.TICKET_PRICE);
  // Sem saldo: nada muda (a transação desfaz o bilhete reservado).
  await assert.rejects(raffle.buyTickets('pobre', 1, o), (e) => e.status === 402);
  assert.equal(coinsOf(db, 'pobre'), 10);
  assert.equal(db._store.raffleTicket.find((t) => t.userId === 'pobre')?.count || 0, 0);
});

test('sorteio: escolha ponderada pelos bilhetes', () => {
  const rows = [{ userId: 'a', count: 1 }, { userId: 'b', count: 3 }];
  assert.equal(raffle.pickWinner(rows, 0), 'a');
  assert.equal(raffle.pickWinner(rows, 1), 'b');
  assert.equal(raffle.pickWinner(rows, 3), 'b');
  assert.equal(raffle.pickWinner(rows, 4), null);
  assert.equal(raffle.prizeFor(100), raffle.BASE_PRIZE + 80);
});

test('sorteio: sorteia com randomInt, paga o prêmio, avisa todo mundo e não repete', async () => {
  reset();
  const s = spies();
  const prev = spTime.previousWeekBounds(MONDAY).key;
  const db = fase4Db({
    user: [{ id: 'ana', coins: 0, displayName: 'Ana' }, { id: 'bia', coins: 0, displayName: 'Bia' }],
    raffleTicket: [
      { id: 't1', weekKey: prev, userId: 'ana', count: 2, spent: 50 },
      { id: 't2', weekKey: prev, userId: 'bia', count: 8, spent: 200 },
    ],
  });
  const asked = [];
  const o = { db, now: MONDAY, notify: s.notify, ledger: s.ledgerFn, random: (n) => { asked.push(n); return 5; } };
  const r = await raffle.drawIfDue(o);
  assert.deepEqual(asked, [10], 'sorteia entre todos os bilhetes');
  assert.equal(r.winnerId, 'bia');
  assert.equal(coinsOf(db, 'bia'), raffle.prizeFor(250));
  assert.equal(s.notices.length, 2);
  assert.ok(s.notices.find((n) => n.userId === 'bia').title.includes('ganhou'));
  common._resetSettled();
  assert.equal(await raffle.drawIfDue(o), null);
  assert.equal(coinsOf(db, 'bia'), raffle.prizeFor(250));
});

test('sorteio: tarefa interrompida retoma pagando o MESMO vencedor', async () => {
  reset();
  const prev = spTime.previousWeekBounds(MONDAY).key;
  const db = fase4Db({
    user: [{ id: 'ana', coins: 0 }, { id: 'bia', coins: 0 }],
    raffleTicket: [{ id: 't1', weekKey: prev, userId: 'ana', count: 1, spent: 25 }, { id: 't2', weekKey: prev, userId: 'bia', count: 1, spent: 25 }],
    // Resultado já gravado, pagamento não aconteceu (queda no meio).
    raffleDraw: [{ weekKey: prev, winnerId: 'ana', prize: 140, tickets: 2, participants: 2 }],
  });
  await raffle.drawIfDue({ db, now: MONDAY, notify: async () => {}, ledger: () => {}, random: () => 1 });
  assert.equal(coinsOf(db, 'ana'), 140);
  assert.equal(coinsOf(db, 'bia'), 0);
});

test('sorteio: com menos de 2 pessoas devolve as moedas', async () => {
  reset();
  const s = spies();
  const prev = spTime.previousWeekBounds(MONDAY).key;
  const db = fase4Db({ user: [{ id: 'ana', coins: 0 }], raffleTicket: [{ id: 't1', weekKey: prev, userId: 'ana', count: 3, spent: 75 }] });
  const r = await raffle.drawIfDue({ db, now: MONDAY, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(r.winnerId, null);
  assert.equal(coinsOf(db, 'ana'), 75);
  assert.match(s.notices[0].title, /cancelado/);
});

// ---------------- Gorjetas ----------------
const allowAll = { requirePermission: async () => true };
function tipDb(extra = {}) {
  return fase4Db({
    user: [
      { id: 'ana', coins: 2000, accountLevel: 5, displayName: 'Ana' },
      { id: 'bia', coins: 0, accountLevel: 5, displayName: 'Bia' },
      { id: 'novo', coins: 500, accountLevel: 1, displayName: 'Novo' },
    ],
    message: [
      { id: 'm-bia', authorId: 'bia', channelId: 'ch1', conversationId: null, deleted: false },
      { id: 'm-ana', authorId: 'ana', channelId: 'ch1', conversationId: null, deleted: false },
      { id: 'm-dm', authorId: 'bia', channelId: null, conversationId: 'cv1', deleted: false },
    ],
    ...extra,
  });
}
const ana = { id: 'ana', displayName: 'Ana', accountLevel: 5 };

test('gorjeta: transfere de um pro outro com extrato e aviso', async () => {
  const s = spies();
  const db = tipDb();
  const r = await tips.tip(ana, { messageId: 'm-bia', amount: 50 }, { db, authz: allowAll, notify: s.notify, ledger: s.ledgerFn, unlock: async () => {} });
  assert.equal(r.amount, 50);
  assert.equal(coinsOf(db, 'ana'), 1950);
  assert.equal(coinsOf(db, 'bia'), 50);
  assert.deepEqual(s.ledger.map((l) => [l.userId, l.coins]), [['ana', -50], ['bia', 50]]);
  assert.equal(s.notices[0].userId, 'bia');
  assert.equal(db._store.coinTip.length, 1);
});

test('gorjeta: valida valor, autogorjeta, nível, acesso e saldo (sem mexer em nada)', async () => {
  const db = tipDb({ user: [{ id: 'ana', coins: 20, accountLevel: 5, displayName: 'Ana' }, { id: 'bia', coins: 0, displayName: 'Bia' }] });
  const o = { db, authz: allowAll, notify: async () => {}, ledger: () => {}, unlock: async () => {} };
  await assert.rejects(tips.tip(ana, { messageId: 'm-bia', amount: tips.TIP_MIN - 1 }, o), /vai de/);
  await assert.rejects(tips.tip(ana, { messageId: 'm-bia', amount: 'muito' }, o), /vai de/);
  await assert.rejects(tips.tip(ana, { messageId: 'm-ana', amount: 10 }, o), /si mesmo/);
  await assert.rejects(tips.tip({ id: 'novo', accountLevel: 1 }, { messageId: 'm-bia', amount: 10 }, o), /nível/);
  await assert.rejects(tips.tip(ana, { messageId: 'm-dm', amount: 10 }, o), /não encontrada/, 'DM da qual não participa');
  await assert.rejects(tips.tip(ana, { messageId: 'm-bia', amount: 50 }, o), (e) => e.status === 402);
  assert.equal(coinsOf(db, 'ana'), 20);
  assert.equal(coinsOf(db, 'bia'), 0);
  assert.equal(db._store.tipDaily[0]?.sent || 0, 0, 'teto diário desfeito junto');
  const denied = { ...o, authz: { requirePermission: async () => { throw new Error('sem acesso'); } } };
  await assert.rejects(tips.tip(ana, { messageId: 'm-bia', amount: 10 }, denied), /não encontrada/, 'canal sem acesso');
});

test('gorjeta: teto diário por pessoa', async () => {
  const db = tipDb();
  const o = { db, authz: allowAll, notify: async () => {}, ledger: () => {}, unlock: async () => {}, now: MONDAY };
  await tips.tip(ana, { messageId: 'm-bia', amount: tips.TIP_MAX }, o);
  await tips.tip(ana, { messageId: 'm-bia', amount: tips.TIP_MAX }, o);
  await assert.rejects(tips.tip(ana, { messageId: 'm-bia', amount: tips.TIP_MIN }, o), (e) => e.status === 429);
  assert.equal(coinsOf(db, 'bia'), tips.TIP_DAILY_CAP);
  // Dia seguinte (Brasília) zera.
  await tips.tip(ana, { messageId: 'm-bia', amount: 10 }, { ...o, now: new Date(MONDAY.getTime() + 86400000) });
  assert.equal(coinsOf(db, 'bia'), tips.TIP_DAILY_CAP + 10);
});

// ---------------- Cupons ----------------
test('cupons: cálculo de desconto e motivos de recusa', () => {
  assert.equal(coupons.discountFor({ kind: 'PERCENT', value: 25 }, 199), 49);
  assert.equal(coupons.discountFor({ kind: 'FIXED', value: 500 }, 120), 120, 'nunca passa do preço');
  const now = new Date();
  assert.match(coupons.problemWith(null, { price: 10 }), /inválido/);
  assert.match(coupons.problemWith({ active: true, kind: 'PERCENT', value: 10, expiresAt: new Date(now - 1000), uses: 0 }, { price: 100, now }), /venceu/);
  assert.match(coupons.problemWith({ active: true, kind: 'PERCENT', value: 10, maxUses: 2, uses: 2 }, { price: 100, now }), /esgotou/);
  assert.match(coupons.problemWith({ active: true, kind: 'PERCENT', value: 10, uses: 0, maxUses: null, minPrice: 500 }, { price: 100, now }), /a partir de 500/);
  assert.equal(coupons.problemWith({ active: true, kind: 'PERCENT', value: 10, uses: 0, maxUses: null }, { price: 100, now }), null);
  assert.equal(coupons.normalizeCode(' natal-10 '), 'NATAL-10');
  assert.equal(coupons.normalizeCode('a'), null);
  assert.equal(coupons.normalizeCode('drop table;'), null);
});

test('cupons: uso único por pessoa, limite total e só moedas', async () => {
  const db = fase4Db({ coupon: [{ id: 'c1', code: 'BEMVINDO', kind: 'PERCENT', value: 50, maxUses: 2, uses: 0, active: true }] });
  const r = await db.$transaction((tx) => coupons.applyInTx(tx, { code: 'bemvindo', userId: 'ana', price: 300 }));
  assert.deepEqual([r.discount, r.final], [150, 150]);
  await assert.rejects(db.$transaction((tx) => coupons.applyInTx(tx, { code: 'BEMVINDO', userId: 'ana', price: 300 })), /já usou/);
  await assert.rejects(db.$transaction((tx) => coupons.applyInTx(tx, { code: 'BEMVINDO', userId: 'bia', price: 300, currency: 'gems' })), /só para compras com moedas/);
  await db.$transaction((tx) => coupons.applyInTx(tx, { code: 'BEMVINDO', userId: 'bia', price: 300 }));
  await assert.rejects(db.$transaction((tx) => coupons.applyInTx(tx, { code: 'BEMVINDO', userId: 'caio', price: 300 })), /esgotou/);
  assert.equal(db._store.coupon[0].uses, 2);
});

test('cupons: compra que falha depois do cupom desfaz o uso', async () => {
  const db = fase4Db({ coupon: [{ id: 'c1', code: 'X10', kind: 'FIXED', value: 10, maxUses: 5, uses: 0, active: true }] });
  await assert.rejects(db.$transaction(async (tx) => {
    await coupons.applyInTx(tx, { code: 'X10', userId: 'ana', price: 100 });
    throw new Error('saldo insuficiente');
  }), /saldo/);
  assert.equal(db._store.coupon[0].uses, 0);
  assert.equal(db._store.couponUse.length, 0);
});

test('cupons: staff cria com validação e pode desativar', async () => {
  const db = fase4Db();
  const o = { db, now: MONDAY };
  await assert.rejects(coupons.adminCreate('s', { code: '!', value: 10 }, o), /Código inválido/);
  await assert.rejects(coupons.adminCreate('s', { code: 'ABC', kind: 'PERCENT', value: 150 }, o), /1 a 100/);
  await assert.rejects(coupons.adminCreate('s', { code: 'ABC', value: 10, expiresAt: '2020-01-01' }, o), /futuro/);
  const { coupon } = await coupons.adminCreate('s', { code: 'abc', kind: 'FIXED', value: 30, maxUses: 10 }, o);
  assert.equal(coupon.code, 'ABC');
  await assert.rejects(coupons.adminCreate('s', { code: 'ABC', value: 5 }, o), /Já existe/);
  await coupons.adminSetActive(coupon.id, false, o);
  await assert.rejects(coupons.preview('ana', { code: 'ABC', price: 100 }, o), /desativado/);
});
