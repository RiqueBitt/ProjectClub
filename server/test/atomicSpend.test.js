const test = require('node:test');
const assert = require('node:assert');
const { spendCoins, takeFromStock } = require('../src/utils/atomicSpend');

// Banco de mentira que se comporta como o UPDATE condicional do MySQL:
// a conferência (where) e o desconto acontecem juntos, um pedido por vez.
function fakeUser(coins) {
  const row = { coins };
  return {
    row,
    user: {
      async updateMany({ where, data }) {
        await null; // cede a vez, como uma ida ao banco
        if (row.coins < where.coins.gte) return { count: 0 };
        row.coins -= data.coins.decrement;
        return { count: 1 };
      },
    },
  };
}

test('gastar moedas: dois pedidos ao mesmo tempo com saldo pra um só — um passa, o outro é recusado', async () => {
  const tx = fakeUser(100);
  const results = await Promise.allSettled([spendCoins(tx, 'u1', 100), spendCoins(tx, 'u1', 100)]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 400);
  assert.equal(tx.row.coins, 0); // nunca negativo
});

test('gastar moedas: sem saldo recusa e não mexe em nada', async () => {
  const tx = fakeUser(30);
  await assert.rejects(spendCoins(tx, 'u1', 50), /Moedas insuficientes/);
  assert.equal(tx.row.coins, 30);
});

test('gastar moedas: preço negativo ou inválido nunca vira crédito', async () => {
  const tx = fakeUser(10);
  await assert.rejects(spendCoins(tx, 'u1', -500), /Preço inválido/);
  await assert.rejects(spendCoins(tx, 'u1', 'abc'), /Preço inválido/);
  assert.equal(tx.row.coins, 10);
});

test('estoque: a última unidade só sai uma vez', async () => {
  const row = { stock: 1 };
  const model = { async updateMany() { await null; if (row.stock <= 0) return { count: 0 }; row.stock -= 1; return { count: 1 }; } };
  const results = await Promise.allSettled([takeFromStock(model, 'c1'), takeFromStock(model, 'c1')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(row.stock, 0);
});
