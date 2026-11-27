// Gastar moedas e tirar do estoque SEM corrida.
//
// O jeito antigo ("lê o saldo, confere, depois desconta") deixava dois
// pedidos simultâneos passarem os dois na conferência: a pessoa comprava
// duas vezes com saldo pra uma e ficava com moedas negativas (e o estoque
// podia ficar abaixo de zero). Aqui a conferência e o desconto são UM
// comando só no banco: `UPDATE … SET coins = coins - ? WHERE coins >= ?`.
// Se nenhuma linha mudou, não tinha saldo (ou estoque) — e nada foi gasto.
// Mesmo padrão de services/callTips.js e services/creatorShop.js.

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Desconta `price` moedas de `userId` dentro da transação `tx`; lança 400 se não tiver saldo. */
async function spendCoins(tx, userId, price) {
  const value = Math.trunc(Number(price));
  if (!Number.isFinite(value) || value < 0) throw fail('Preço inválido.');
  if (value === 0) return;
  const paid = await tx.user.updateMany({ where: { id: userId, coins: { gte: value } }, data: { coins: { decrement: value } } });
  if (paid.count !== 1) throw fail('Moedas insuficientes.');
}

/** Tira 1 do estoque de `model` (ex.: tx.houseCatalog) se ainda houver; lança 400 se acabou. */
async function takeFromStock(model, id, message = 'Fora de estoque.') {
  const took = await model.updateMany({ where: { id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
  if (took.count !== 1) throw fail(message);
}

module.exports = { spendCoins, takeFromStock };
