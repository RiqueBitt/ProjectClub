// Cartão da carteira: estilo por categoria de apoio e "Mostrar cartão".
const test = require('node:test');
const assert = require('node:assert');
const card = require('../src/services/walletCard');

function stubDb(users) {
  const shares = [];
  return {
    shares,
    user: {
      findUnique: async ({ where }) => users.find((u) => u.id === where.id) || null,
      update: async ({ where, data }) => Object.assign(users.find((u) => u.id === where.id), data),
    },
    walletCardShare: {
      findFirst: async ({ where }) => [...shares].reverse().find((s) => s.userId === where.userId) || null,
      findUnique: async ({ where }) => shares.find((s) => s.id === where.id) || null,
      create: async ({ data }) => { const row = { id: `s${shares.length + 1}`, createdAt: new Date(), ...data }; shares.push(row); return row; },
    },
  };
}

test('cartão: estilo padrão de cada categoria e escolha limitada pela categoria', async () => {
  assert.equal(card.styleFor({ supporterTier: 'NONE' }), 'DEFAULT');
  assert.equal(card.styleFor({ supporterTier: 'SUBSCRIBER' }), 'GOLD');
  assert.equal(card.styleFor({ supporterTier: 'SUPER' }), 'RAINBOW');
  assert.equal(card.styleFor({ supporterTier: 'SUPER', walletCardStyle: 'GOLD' }), 'GOLD');
  // Assinatura venceu: volta pro que ainda pode usar.
  assert.equal(card.styleFor({ supporterTier: 'SUPER', supporterUntil: new Date(Date.now() - 1000), walletCardStyle: 'RAINBOW' }), 'DEFAULT');
  // Assinante não usa o arco-íris.
  assert.equal(card.styleFor({ supporterTier: 'SUBSCRIBER', walletCardStyle: 'RAINBOW' }), 'GOLD');

  const db = stubDb([{ id: 'ana', supporterTier: 'SUBSCRIBER' }, { id: 'bia', supporterTier: 'NONE' }]);
  assert.deepEqual(await card.setStyle(db, 'ana', 'default'), { style: 'DEFAULT', styles: ['DEFAULT', 'GOLD'] });
  await assert.rejects(card.setStyle(db, 'ana', 'RAINBOW'), (e) => e.status === 403);
  await assert.rejects(card.setStyle(db, 'bia', 'GOLD'), (e) => e.status === 403);
  await assert.rejects(card.setStyle(db, 'bia', 'roxo'), (e) => e.status === 400);
});

test('cartão: "Mostrar cartão" grava a foto do saldo e não deixa repetir em seguida', async () => {
  const db = stubDb([{ id: 'ana', coins: 1861, gems: 19, accountLevel: 7, supporterTier: 'SUPER', displayName: 'Ana', createdAt: new Date() }]);
  const { id } = await card.share(db, 'ana');
  db.user.findUnique = async () => ({ id: 'ana', displayName: 'Ana' });
  const got = await card.getShared(db, id);
  assert.equal(got.card.coins, 1861);
  assert.equal(got.card.gems, 19);
  assert.equal(got.card.style, 'RAINBOW');
  assert.equal(got.user.displayName, 'Ana');
  await assert.rejects(card.share(db, 'ana'), (e) => e.status === 429);
  await assert.rejects(card.getShared(db, 'nada'), (e) => e.status === 404);
});
