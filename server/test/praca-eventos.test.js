// Eventos da Praça (services/waddle/events.js): quests, moeda do evento, loja,
// códigos e limpeza da configuração — com um Prisma de mentira em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (rel) => path.join(__dirname, '..', 'src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

// ---- Prisma falso: só o que o serviço usa ----
function fakePrisma() {
  const db = { events: [], progress: [], wallets: [], purchases: [], codes: [], codeUses: [], visits: [], meets: [], donations: [], advent: [], users: new Map([['u1', { id: 'u1', coins: 500 }]]) };
  const where = (row, w) => Object.entries(w || {}).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) ? true : row[k] === v));
  const table = (rows, uniq) => ({
    findMany: async ({ where: w } = {}) => rows.filter((r) => where(r, w)),
    findUnique: async ({ where: w }) => { const key = Object.keys(w)[0]; const val = w[key]; if (typeof val === 'object') return rows.find((r) => Object.entries(val).every(([k, v]) => r[k] === v)) || null; return rows.find((r) => r[key] === val) || null; },
    create: async ({ data }) => { if (uniq && rows.some((r) => uniq.every((k) => r[k] === data[k]))) { const e = new Error('unique'); e.code = 'P2002'; throw e; } const row = { id: `id${rows.length + 1}`, ...data }; rows.push(row); return row; },
    update: async ({ where: w, data }) => { const row = rows.find((r) => where(r, w)); for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v && typeof v === 'object' && 'decrement' in v ? row[k] - v.decrement : v; return row; },
    updateMany: async ({ where: w, data }) => { const hit = rows.filter((r) => Object.entries(w).every(([k, v]) => (v === null ? r[k] == null : r[k] === v))); for (const r of hit) Object.assign(r, data); return { count: hit.length }; },
    upsert: async ({ where: w, create, update }) => { const key = Object.keys(w)[0]; const val = w[key]; const row = rows.find((r) => Object.entries(val).every(([k, v]) => r[k] === v)); if (row) { for (const [k, v] of Object.entries(update)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v; return row; } const n = { id: `id${rows.length + 1}`, ...create }; rows.push(n); return n; },
    count: async ({ where: w }) => rows.filter((r) => where(r, w)).length,
    aggregate: async ({ where: w }) => ({ _sum: { amount: rows.filter((r) => where(r, w)).reduce((s, r) => s + r.amount, 0) } }),
    groupBy: async ({ where: w }) => [...new Set(rows.filter((r) => where(r, w)).map((r) => r.userId))].map((userId) => ({ userId })),
    delete: async () => {},
  });
  const prisma = {
    plazaEvent: table(db.events), plazaQuestProgress: table(db.progress, ['userId', 'eventId', 'questKey']), plazaEventWallet: table(db.wallets), plazaEventPurchase: table(db.purchases, ['userId', 'eventId', 'shopKey']),
    plazaCode: table(db.codes), plazaCodeUse: table(db.codeUses, ['codeId', 'userId']), plazaMascotVisit: table(db.visits), plazaMascotMeet: table(db.meets, ['visitId', 'userId']), plazaDonation: table(db.donations), plazaAdventClaim: table(db.advent, ['userId', 'year', 'day']),
    friendship: { findMany: async () => [] }, user: { findUnique: async ({ where: w }) => db.users.get(w.id) || null },
    $transaction: async (fn) => fn(prisma),
  };
  return { prisma, db };
}

const { prisma, db } = fakePrisma();
stub('config/prisma.js', prisma);
const events = require(src('services/waddle/events.js'));

// mundo de mentira: presença + pinguins vivos
const presence = []; // { id, name, room, x, y }
const live = new Map(); // penguinId -> { inventory: {...} }
const w = { world: { getPresence: () => presence, getOnline: (id) => live.get(id) } };
const store = {
  coins: new Map([['u1', 500]]),
  addUserCoins: async (uid, d) => { store.coins.set(uid, (store.coins.get(uid) || 0) + d); return store.coins.get(uid); },
  userCoins: async (uid) => store.coins.get(uid) ?? null,
  idForUser: async (uid) => (uid === 'u1' ? 1000 : null),
};
const granted = [];
const admin = { updatePenguin: async (_w, _s, pid, ops) => { granted.push({ pid, ops }); return { changes: ['+item'] }; } };
const listeners = [];
const waddle = { roomPlayers: (room) => presence.filter((p) => p.room === room), onRoomChange: (fn) => listeners.push(fn), userOfPenguin: (id) => (id === 1000 ? 'u1' : null), roomOfUser: () => null };
events.attach(w, { store, waddle, admin });

const now = Date.now();
db.events.push({ id: 'ev1', slug: 'teste', name: 'Festa Teste', currencyName: 'Doces', active: true, startsAt: new Date(now - 1000), endsAt: new Date(now + 86400000), config: JSON.stringify({
  quests: [
    { key: 'explorar', title: 'Explorar', type: 'visit', rooms: [100, 110], reward: { coins: 50, eventCoins: 10 } },
    { key: 'reunir', title: 'Reunir', type: 'gather', count: 2, reward: { coins: 20 } },
    { key: 'vestir', title: 'Vestir', type: 'wear', items: [413], reward: { items: [999] } },
  ],
  shop: [{ key: 'chapeu', label: 'Chapéu', itemIds: [413], price: 15 }],
}) });

test('quests: visitar salas, juntar pinguins e vestir item avançam e concluem', async () => {
  const ev = (await events.activeEvents(true))[0];
  assert.equal(ev.slug, 'teste');
  presence.push({ id: 1000, name: 'Rique', room: 100, x: 0, y: 0 });
  live.set(1000, { inventory: { color: 1, head: 0, face: 0, neck: 0, body: 0, feet: 0, hand: 0, pin: 0, background: 0 } });
  await events._test.evaluate('u1', 100, live.get(1000), [ev]);
  let p = await events._test.getProgress('u1', 'ev1', 'explorar');
  assert.equal(p.progress, 1); assert.equal(p.done, false);
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  p = await events._test.getProgress('u1', 'ev1', 'explorar');
  assert.equal(p.done, true, 'duas salas visitadas conclui');
  // juntar: sozinho não conclui; com outro pinguim na sala sim
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev1', 'reunir')).done, false);
  presence[0].room = 110;
  presence.push({ id: 2000, name: 'Outro', room: 110, x: 0, y: 0 });
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev1', 'reunir')).done, true);
  // vestir
  live.get(1000).inventory.head = 413;
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev1', 'vestir')).done, true);
});

test('recompensa: só uma vez, entrega moedas + moeda do evento + itens', async () => {
  const r = await events.claimQuest('u1', 'teste', 'explorar');
  assert.equal(r.coins, 50); assert.equal(r.eventCoins, 10);
  assert.equal(store.coins.get('u1'), 550);
  await assert.rejects(() => events.claimQuest('u1', 'teste', 'explorar'), /já pegou/);
  const r2 = await events.claimQuest('u1', 'teste', 'vestir');
  assert.deepEqual(r2.items, [999]);
  assert.equal(granted.at(-1).pid, 1000);
});

test('loja: compra com a moeda do evento, uma vez, e recusa sem saldo', async () => {
  await assert.rejects(() => events.buy('u1', 'teste', 'chapeu'), /Faltam Doces/);
  await events._test.grant('u1', { eventCoins: 20, eventId: 'ev1' });
  const r = await events.buy('u1', 'teste', 'chapeu');
  assert.equal(r.balance, 15, '10 + 20 - 15');
  assert.deepEqual(r.items, [413]);
  await assert.rejects(() => events.buy('u1', 'teste', 'chapeu'), /já comprou/);
});

test('códigos: valida, conta usos e vale uma vez por pinguim', async () => {
  await events.saveCode({ code: 'pingu 2026!', label: 'Live', coins: 100, items: [5], maxUses: 1 });
  assert.equal(db.codes[0].code, 'PINGU2026');
  await assert.rejects(() => events.redeemCode('u1', 'nada'), /inválido/);
  const r = await events.redeemCode('u1', 'pingu2026');
  assert.equal(r.coins, 100); assert.deepEqual(r.items, [5]);
  await assert.rejects(() => events.redeemCode('u1', 'PINGU2026'), /já usou|máximo/);
  await assert.rejects(() => events.saveCode({ code: 'ab' }), /pelo menos 3/);
});

test('cleanConfig: rejeita quest repetida e limpa números/ids', () => {
  assert.throws(() => events.cleanConfig({ quests: [{ key: 'a', type: 'visit' }, { key: 'a', type: 'wear' }] }), /repetida/);
  const c = events.cleanConfig({ quests: [{ key: 'Ok!', type: 'gather', count: 9999, rooms: ['100', 'x'], reward: { coins: -5, eventCoins: 3 } }], shop: [{ key: 'S', itemIds: [], price: 1 }, { key: 'T', itemIds: [1], price: -1 }], advent: [{ day: 30 }, { day: 3, coins: 10 }] });
  assert.equal(c.quests[0].key, 'ok'); assert.equal(c.quests[0].count, 200); assert.deepEqual(c.quests[0].rooms, [100]); assert.equal(c.quests[0].reward.coins, 0);
  assert.equal(c.shop.length, 1); assert.equal(c.shop[0].price, 0);
  assert.deepEqual(c.advent.map((a) => a.day), [3]);
});

test('dificuldade, dançar com item, passear com puffle e prêmio final', async () => {
  db.events.push({ id: 'ev2', slug: 'legacy', name: 'Quests estilo Legacy', currencyName: 'Fichas', active: true, startsAt: new Date(now - 1000), endsAt: new Date(now + 86400000), config: JSON.stringify(events.cleanConfig({
    quests: [
      { key: 'danca', title: 'Dança', type: 'dance', difficulty: 'dificil', rooms: [100, 120], items: [5016] },
      { key: 'puffle', title: 'Puffle', type: 'walk_puffle', difficulty: 'extrema', puffles: [5], rooms: [809] },
    ],
    completion: { label: 'Dragão', items: [795], coins: 800 },
  })) });
  const ev = (await events.activeEvents(true)).find((e) => e.slug === 'legacy');
  const inv = { color: 1, head: 0, face: 0, neck: 0, body: 0, feet: 0, hand: 5016, pin: 0, background: 0 };
  const liveP = { inventory: inv };
  // dançando (frame 26) com boombox no Centro e na Danceteria
  await events._test.evaluate('u1', 100, liveP, [ev], { frame: 1, walking: null });
  assert.equal((await events._test.getProgress('u1', 'ev2', 'danca'))?.progress || 0, 0, 'parado não conta');
  await events._test.evaluate('u1', 100, liveP, [ev], { frame: 26, walking: null });
  await events._test.evaluate('u1', 120, liveP, [ev], { frame: 26, walking: null });
  assert.equal((await events._test.getProgress('u1', 'ev2', 'danca')).done, true);
  // puffle vermelho (5) na Floresta (809); azul não conta
  await events._test.evaluate('u1', 809, liveP, [ev], { frame: 1, walking: 0 });
  assert.equal((await events._test.getProgress('u1', 'ev2', 'puffle'))?.done || false, false);
  await events._test.evaluate('u1', 809, liveP, [ev], { frame: 1, walking: 5 });
  assert.equal((await events._test.getProgress('u1', 'ev2', 'puffle')).done, true);
  // recompensa pela dificuldade (sem coins na quest): difícil = 250, extrema = 500
  const r1 = await events.claimQuest('u1', 'legacy', 'danca');
  assert.equal(r1.coins, events.DIFFICULTY.dificil);
  const r2 = await events.claimQuest('u1', 'legacy', 'puffle');
  assert.equal(r2.coins, events.DIFFICULTY.extrema);
  // prêmio final: uma vez
  const fin = await events.claimCompletion('u1', 'legacy');
  assert.deepEqual(fin.items, [795]); assert.equal(fin.coins, 800);
  await assert.rejects(() => events.claimCompletion('u1', 'legacy'), /já pegou/);
  const st = await events.playerState('u1');
  const e2 = st.events.find((e) => e.slug === 'legacy');
  assert.equal(e2.completion.claimed, true);
  assert.equal(e2.quests[0].difficulty, 'dificil');
});

test('modelos prontos: todos passam na limpeza e têm só ids de itens do catálogo', () => {
  const presets = require(src('services/waddle/eventPresets.js'));
  const list = presets.list();
  assert.ok(list.length >= 8);
  for (const p of list) {
    const body = presets.build(p.key);
    assert.equal(typeof body.slug, 'string');
    events.cleanConfig(body.config); // não pode lançar
  }
});
