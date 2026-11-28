// Fase 8 — mascote pinguim do perfil (services/pet.js).
const test = require('node:test');
const assert = require('node:assert');
const pet = require('../src/services/pet');

// Banco falso em memória com só o que o serviço usa.
function fakeDb({ coins = 500, accountLevel = 1 } = {}) {
  const state = { pets: new Map(), owned: [], user: { id: 'u1', coins, accountLevel } };
  const db = {
    state,
    user: {
      findUnique: async () => ({ ...state.user }),
      updateMany: async ({ where, data }) => {
        if (where.coins?.gte !== undefined && state.user.coins < where.coins.gte) return { count: 0 };
        if (data.coins?.decrement) state.user.coins -= data.coins.decrement;
        return { count: 1 };
      },
    },
    petPenguin: {
      findUnique: async ({ where }) => (state.pets.has(where.userId) ? { ...state.pets.get(where.userId) } : null),
      upsert: async ({ where, create }) => {
        if (!state.pets.has(where.userId)) state.pets.set(where.userId, { name: 'Pingo', color: 'blue', stage: 0, xp: 0, streak: 0, bestStreak: 0, careCount: 0, lastCareDay: null, lastCaredAt: null, equipped: null, ...create });
        return { ...state.pets.get(where.userId) };
      },
      update: async ({ where, data }) => { Object.assign(state.pets.get(where.userId), data); return { ...state.pets.get(where.userId) }; },
      updateMany: async ({ where, data }) => {
        const row = state.pets.get(where.userId);
        const today = where.OR[1].lastCareDay.not;
        if (!row || row.lastCareDay === today) return { count: 0 };
        for (const [k, v] of Object.entries(data)) row[k] = v?.increment !== undefined ? (row[k] || 0) + v.increment : v;
        return { count: 1 };
      },
    },
    petAccessoryOwned: {
      findMany: async ({ where }) => state.owned.filter((o) => o.userId === where.userId),
      findUnique: async ({ where }) => state.owned.find((o) => o.userId === where.userId_accessoryId.userId && o.accessoryId === where.userId_accessoryId.accessoryId) || null,
      create: async ({ data }) => { state.owned.push(data); return data; },
    },
    $transaction: async (fn) => fn(db),
  };
  return db;
}
const noLedger = () => ({ recordTransaction: () => null });

test('estágios evoluem pela pontuação (XP do pinguim + nível × 20)', () => {
  assert.equal(pet.petScore(100, 3), 160);
  assert.equal(pet.stageForScore(0).key, 'filhote');
  assert.equal(pet.stageForScore(149).key, 'filhote');
  assert.equal(pet.stageForScore(150).key, 'jovem');
  assert.equal(pet.stageForScore(500).key, 'adulto');
  assert.equal(pet.stageForScore(5000).key, 'lendario');
  // Nunca regride: estágio guardado maior que o calculado vale.
  assert.equal(pet.resolveStage(2, 10), 2);
  assert.equal(pet.resolveStage(0, 600), 2);
  const next = pet.nextStageInfo(0, 75);
  assert.equal(next.key, 'jovem');
  assert.equal(next.missing, 75);
  assert.equal(next.progress, 50);
  assert.equal(pet.nextStageInfo(3, 9999), null);
});

test('cuidado diário: uma vez por dia, sequência e bônus', () => {
  const d1 = new Date('2026-11-02T15:00:00Z');
  const d2 = new Date('2026-11-03T15:00:00Z');
  const d4 = new Date('2026-11-05T15:00:00Z');
  const first = pet.computeCare({ lastCareDay: null, streak: 0 }, d1);
  assert.equal(first.already, false);
  assert.equal(first.streak, 1);
  assert.equal(first.petXp, pet.CARE_PET_XP);
  assert.equal(pet.computeCare({ lastCareDay: first.today, streak: 1 }, d1).already, true);
  const second = pet.computeCare({ lastCareDay: first.today, streak: 1, bestStreak: 1 }, d2);
  assert.equal(second.streak, 2);
  assert.equal(second.petXp, pet.CARE_PET_XP + pet.CARE_STREAK_BONUS);
  assert.equal(second.bestStreak, 2);
  // Pulou um dia: sequência volta pra 1.
  assert.equal(pet.computeCare({ lastCareDay: second.today, streak: 2, bestStreak: 2 }, d4).streak, 1);
  // Bônus tem teto.
  assert.equal(pet.computeCare({ lastCareDay: pet.previousDayKey(d1), streak: 40 }, d1).petXp, pet.CARE_PET_XP + pet.CARE_STREAK_CAP * pet.CARE_STREAK_BONUS);
});

test('humor depende do último cuidado', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  assert.equal(pet.moodFor(null, now), 'carente');
  assert.equal(pet.moodFor(new Date(now.getTime() - 3600_000), now), 'feliz');
  assert.equal(pet.moodFor(new Date(now.getTime() - 48 * 3600_000), now), 'tranquilo');
  assert.equal(pet.moodFor(new Date(now.getTime() - 100 * 3600_000), now), 'carente');
});

test('cuidar do pinguim grava XP, dá XP de conta e não conta duas vezes no dia', async () => {
  const db = fakeDb();
  const xpCalls = [];
  const awardXp = async (...a) => { xpCalls.push(a); return { levelUp: false }; };
  const now = new Date('2026-11-02T15:00:00Z');
  const r = await pet.careForPet('u1', { db, now, awardXp });
  assert.equal(r.pet.caredToday, true);
  assert.equal(r.pet.xp, pet.CARE_PET_XP);
  assert.equal(r.gained.streak, 1);
  assert.equal(xpCalls[0][1], pet.CARE_ACCOUNT_XP);
  await assert.rejects(pet.careForPet('u1', { db, now, awardXp }), (e) => e.code === 'ALREADY_CARED');
});

test('nível alto da conta já evolui o pinguim', async () => {
  const db = fakeDb({ accountLevel: 30 }); // 30 × 20 = 600 → adulto
  const { pet: p } = await pet.getOrCreatePet('u1', { db });
  assert.equal(p.stageKey, 'adulto');
  assert.equal(db.state.pets.get('u1').stage, 2);
});

test('compra de acessório: desconta moedas, não compra duas vezes nem sem saldo', async () => {
  const db = fakeDb({ coins: 100 });
  const r = await pet.buyAccessory('u1', 'gorro', { db, ledger: noLedger });
  assert.equal(db.state.user.coins, 40);
  assert.deepEqual(r.pet.owned, ['gorro']);
  await assert.rejects(pet.buyAccessory('u1', 'gorro', { db, ledger: noLedger }), (e) => e.code === 'ALREADY_OWNED');
  await assert.rejects(pet.buyAccessory('u1', 'cartola', { db, ledger: noLedger }), (e) => e.code === 'NO_COINS');
  assert.equal(db.state.user.coins, 40);
  await assert.rejects(pet.buyAccessory('u1', 'nao-existe', { db, ledger: noLedger }), (e) => e.code === 'NOT_FOUND');
});

test('equipar: precisa ter, espaço certo e estágio mínimo', async () => {
  const db = fakeDb({ coins: 2000 });
  await pet.buyAccessory('u1', 'gorro', { db, ledger: noLedger });
  await pet.buyAccessory('u1', 'coroa', { db, ledger: noLedger });
  const r = await pet.equipAccessory('u1', { slot: 'cabeca', accessoryId: 'gorro' }, { db });
  assert.deepEqual(r.pet.equipped, { cabeca: 'gorro' });
  await assert.rejects(pet.equipAccessory('u1', { slot: 'rosto', accessoryId: 'gorro' }, { db }), /espaço/);
  await assert.rejects(pet.equipAccessory('u1', { slot: 'cabeca', accessoryId: 'coroa' }, { db }), (e) => e.code === 'STAGE');
  await assert.rejects(pet.equipAccessory('u1', { slot: 'rosto', accessoryId: 'oculos' }, { db }), (e) => e.code === 'NOT_OWNED');
  const off = await pet.equipAccessory('u1', { slot: 'cabeca', accessoryId: null }, { db });
  assert.deepEqual(off.pet.equipped, {});
});

test('nome e cor do pinguim são validados', async () => {
  assert.equal(pet.sanitizePetName('  Tux <b>!! '), 'Tux b');
  assert.equal(pet.sanitizePetName('a'), null);
  const db = fakeDb();
  const r = await pet.updatePet('u1', { name: 'Gelinho', color: 'pink' }, { db });
  assert.equal(r.pet.name, 'Gelinho');
  assert.equal(r.pet.color, 'pink');
  await assert.rejects(pet.updatePet('u1', { color: 'arco-iris' }, { db }), /Cor/);
  // JSON de equipados inválido/estranho não quebra nada.
  assert.deepEqual(pet.parseEquipped('{"cabeca":"oculos","rosto":"oculos"}'), { rosto: 'oculos' });
  assert.deepEqual(pet.parseEquipped('lixo'), {});
});
