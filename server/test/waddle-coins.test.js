'use strict';
// Moeda única: o saldo do Club Penguin é o saldo de moedas do Project Club.
const test = require('node:test');
const assert = require('node:assert');
const { PrismaPenguinStore } = require('../src/services/waddle/penguinStore');

function fakePrisma({ coins = 500, penguinCoins = 9999 } = {}) {
  const users = new Map([['u1', { id: 'u1', coins }]]);
  const penguins = new Map([[1000, { id: 1000, userId: 'u1', name: 'Pingu', data: JSON.stringify({ name: 'Pingu', coins: penguinCoins }) }]]);
  return {
    users,
    penguins,
    user: {
      findUnique: async ({ where }) => { const u = users.get(where.id); return u ? { coins: u.coins } : null; },
      update: async ({ where, data }) => { const u = users.get(where.id); u.coins = Math.max(0, u.coins + data.coins.increment); return u; },
    },
    waddlePenguin: {
      findUnique: async ({ where }) => penguins.get(where.id) || null,
      update: async ({ where, data }) => { Object.assign(penguins.get(where.id), data); return penguins.get(where.id); },
    },
  };
}

test('moedas: o pinguim carrega com o saldo do Project Club (as do jogo somem)', async () => {
  const prisma = fakePrisma({ coins: 500, penguinCoins: 9999 });
  const store = new PrismaPenguinStore(prisma);
  const json = await store.get(1000);
  assert.strictEqual(json.coins, 500);
});

test('moedas: ganhar/gastar no jogo muda o saldo da conta', async () => {
  const prisma = fakePrisma({ coins: 500 });
  const store = new PrismaPenguinStore(prisma);
  const seen = [];
  store.onUserCoins = (userId, coins) => seen.push([userId, coins]);
  const json = await store.get(1000);
  await store.write(1000, { ...json, coins: 650 }); // minijogo: +150
  assert.strictEqual(prisma.users.get('u1').coins, 650);
  await store.write(1000, { ...json, coins: 400 }); // comprou: -250
  assert.strictEqual(prisma.users.get('u1').coins, 400);
  assert.strictEqual(JSON.parse(prisma.penguins.get(1000).data).coins, 400);
  assert.deepStrictEqual(seen, [['u1', 650], ['u1', 400]]);
});

test('moedas: o que muda no site chega no pinguim online (sem contar duas vezes)', async () => {
  const prisma = fakePrisma({ coins: 500 });
  const store = new PrismaPenguinStore(prisma);
  const diffs = [];
  store.onCoins = (id, diff) => diffs.push(diff);
  await store.get(1000);
  prisma.users.get('u1').coins = 800; // baú diário no site: +300
  await store.refreshCoins(1000, { force: true });
  assert.deepStrictEqual(diffs, [300]);
  // o jogo grava o saldo dele (já com os +300) e mais +20 de um minijogo
  await store.write(1000, { name: 'Pingu', coins: 820 });
  assert.strictEqual(prisma.users.get('u1').coins, 820);
  await store.refreshCoins(1000, { force: true });
  assert.deepStrictEqual(diffs, [300]);
});

test('moedas: gastou no site enquanto jogava — o saldo nunca fica negativo nem duplica', async () => {
  const prisma = fakePrisma({ coins: 100 });
  const store = new PrismaPenguinStore(prisma);
  const diffs = [];
  store.onCoins = (id, diff) => diffs.push(diff);
  await store.get(1000);
  prisma.users.get('u1').coins = 0; // gastou tudo na loja do site
  await store.write(1000, { name: 'Pingu', coins: 50 }); // o jogo ainda achava que tinha 100 e gastou 50
  assert.strictEqual(prisma.users.get('u1').coins, 0);
  assert.strictEqual(JSON.parse(prisma.penguins.get(1000).data).coins, 0);
  assert.deepStrictEqual(diffs, [-50]); // o pinguim online é corrigido pra 0
});

test('moedas: o jogo paga no máximo o limite do dia (o resto volta)', async () => {
  const prisma = fakePrisma({ coins: 100 });
  const ledger = [];
  prisma.economyTransaction = {
    aggregate: async () => ({ _sum: { coins: ledger.filter((t) => t.kind === 'GAME' && t.coins > 0).reduce((n, t) => n + t.coins, 0) } }),
  };
  const store = new PrismaPenguinStore(prisma);
  store.dailyCap = 300;
  // sem o histórico real: registra direto
  const realWrite = store.addUserCoins.bind(store);
  store.addUserCoins = async (userId, delta) => { ledger.push({ kind: 'GAME', coins: delta }); return realWrite(userId, delta); };
  const caps = []; const diffs = [];
  store.onCoinCap = (u, cap) => caps.push(cap);
  store.onCoins = (id, d) => diffs.push(d);
  await store.get(1000);
  await store.write(1000, { name: 'Pingu', coins: 350 }); // +250 (cabe)
  assert.strictEqual(prisma.users.get('u1').coins, 350);
  await store.write(1000, { name: 'Pingu', coins: 550 }); // +200, só cabem 50
  assert.strictEqual(prisma.users.get('u1').coins, 400);
  assert.deepStrictEqual(caps, [300]);
  assert.deepStrictEqual(diffs, [-150]);
  await store.write(1000, { name: 'Pingu', coins: 500 }); // +100, limite batido
  assert.strictEqual(prisma.users.get('u1').coins, 400);
  // gastar continua valendo
  await store.write(1000, { name: 'Pingu', coins: 300 });
  assert.strictEqual(prisma.users.get('u1').coins, 300);
  // moedas da equipe não contam no limite
  store.allowUncapped(1000);
  await store.write(1000, { name: 'Pingu', coins: 1300 });
  assert.strictEqual(prisma.users.get('u1').coins, 1300);
});

test('amigos: os amigos do Project Club entram na lista de amigos do jogo', async () => {
  const prisma = fakePrisma({ coins: 10 });
  prisma.penguins.get(1000).data = JSON.stringify({ name: 'Pingu', coins: 10, buddies: [1005], ignored: [1003] });
  prisma.friendship = {
    findMany: async () => [
      { requesterId: 'u1', addresseeId: 'u2' }, // aceito
      { requesterId: 'u3', addresseeId: 'u1' }, // aceito, mas ignorado no jogo
      { requesterId: 'u4', addresseeId: 'u1' }, // conta sem pinguim
    ],
  };
  const penguinOf = { u2: { id: 1002, name: 'Amiga' }, u3: { id: 1003, name: 'Chato' } };
  prisma.waddlePenguin.findMany = async ({ where }) => where.userId.in.map((u) => penguinOf[u]).filter(Boolean);
  const store = new PrismaPenguinStore(prisma);
  const json = await store.get(1000);
  assert.deepStrictEqual(json.buddies.sort(), [1002, 1005]); // amigo do jogo fica, ignorado não entra
});
