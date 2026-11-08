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
const waddle = { roomPlayers: (room) => presence.filter((p) => p.room === room), onRoomChange: (fn) => listeners.push(fn), userOfPenguin: (id) => (id === 1000 ? 'u1' : null), roomOfUser: (uid) => presence.find((p) => waddle.userOfPenguin(p.id) === uid)?.room ?? null };
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

test('trivia (TourBot), Party Pass, loja com limite e rodízio semanal', async () => {
  const start = new Date(now - 8 * 86400000); // começou há 8 dias → 2º ciclo do rodízio
  db.events.push({ id: 'ev3', slug: 'anv', name: 'Aniversário', currencyName: 'Fatias', active: true, startsAt: start, endsAt: new Date(now + 86400000), config: JSON.stringify(events.cleanConfig({
    quests: [
      { key: 'bot', title: 'TourBot', type: 'trivia', difficulty: 'media', rooms: [100], question: 'Mascote?', options: ['Rockhopper', 'Pingu'], answer: 1 },
      { key: 'chapeu', title: 'Chapéu', type: 'wear', difficulty: 'facil', items: [413], hint: 'Na loja.' },
    ],
    pass: { levels: [{ points: 100, label: 'N1', coins: 10 }, { points: 170, label: 'N2', items: [171] }] },
    shopMax: 1,
    shop: [{ key: 'balao', label: 'Balão', itemIds: [554], price: 1, limit: 2 }, { key: 'lei', label: 'Colar', itemIds: [171], price: 1 }],
    rotation: { everyDays: 7, quests: [{ key: 'pin-a', title: 'Pin A', type: 'visit', rooms: [110], reward: { items: [550] } }, { key: 'pin-b', title: 'Pin B', type: 'visit', rooms: [120], reward: { items: [551] } }] },
  })) });
  const ev = (await events.activeEvents(true)).find((e) => e.slug === 'anv');
  // rodízio: ciclo 1 → pin-b, chave própria por ciclo
  const rot = ev.cfg.quests.find((q) => q.rotated);
  assert.equal(rot.key, 'pin-b-r1'); assert.deepEqual(rot.rooms, [120]);
  // trivia: precisa estar na sala do bot; errar não conclui; acertar conclui
  presence.length = 0; presence.push({ id: 1000, name: 'Rique', room: 300, x: 0, y: 0 });
  await assert.rejects(() => events.answerTrivia('u1', 'anv', 'bot', 1), /TourBot/);
  presence[0].room = 100;
  assert.equal((await events.answerTrivia('u1', 'anv', 'bot', 0)).correct, false);
  assert.equal((await events.answerTrivia('u1', 'anv', 'bot', 1)).correct, true);
  await assert.rejects(() => events.answerTrivia('u1', 'anv', 'bot', 1), /já respondeu/);
  // passe: trivia média = 120 pontos → nível 1 sim, nível 2 (170) não
  let st = await events.playerState('u1');
  let e3 = st.events.find((e) => e.slug === 'anv');
  assert.equal(e3.pass.points, 120); assert.equal(e3.pass.levels[0].reached, true); assert.equal(e3.pass.levels[1].reached, false);
  assert.equal(e3.quests.find((q) => q.key === 'chapeu').hint, 'Na loja.');
  assert.equal(e3.quests.find((q) => q.key === 'bot').options.length, 2); assert.equal(e3.quests.find((q) => q.key === 'bot').answer, undefined, 'resposta não vaza');
  const n1 = await events.claimPass('u1', 'anv', 0); assert.equal(n1.coins, 10);
  await assert.rejects(() => events.claimPass('u1', 'anv', 0), /já pegou/);
  await assert.rejects(() => events.claimPass('u1', 'anv', 1), /Faltam 50 pontos/);
  // o rodízio não conta pro prêmio final/passe, e a quest fixa 'chapeu' soma depois
  live.get(1000).inventory.head = 413;
  await events._test.evaluate('u1', 100, live.get(1000), [ev]);
  st = await events.playerState('u1'); e3 = st.events.find((e) => e.slug === 'anv');
  assert.equal(e3.pass.points, 170); assert.equal(e3.pass.levels[1].reached, true);
  // loja: limite 2 no balão; shopMax 1 → o colar não entra
  await events._test.grant('u1', { eventCoins: 10, eventId: 'ev3' });
  await events.buy('u1', 'anv', 'balao'); await events.buy('u1', 'anv', 'balao');
  await assert.rejects(() => events.buy('u1', 'anv', 'balao'), /2 vezes/);
  await assert.rejects(() => events.buy('u1', 'anv', 'lei'), /no máximo 1 itens/);
  st = await events.playerState('u1'); e3 = st.events.find((e) => e.slug === 'anv');
  assert.equal(e3.shop[0].qty, 2); assert.equal(e3.shop[0].bought, true); assert.equal(e3.shopBought, 1);
  // cleanConfig recusa trivia sem opções
  assert.throws(() => events.cleanConfig({ quests: [{ key: 't', type: 'trivia', question: 'x', options: ['a'] }] }), /2 opções/);
});

test('visita surpresa só aparece na agenda quando começa', async () => {
  db.visits.push({ id: 'v1', mascotKey: 'pingu', name: 'Pingu', mascotUserId: null, room: 100, startsAt: new Date(now + 3600000), endsAt: new Date(now + 7200000), itemIds: '[]', coins: 0, eventCoins: 0, surprise: true });
  db.visits.push({ id: 'v2', mascotKey: 'pingu', name: 'Pingu agora', mascotUserId: null, room: 100, startsAt: new Date(now - 60000), endsAt: new Date(now + 7200000), itemIds: '[]', coins: 0, eventCoins: 0, surprise: true });
  const st = await events.playerState('u1');
  assert.deepEqual(st.mascots.map((m) => m.id), ['v2']);
});

test('ações do jogo: emotes (sozinho e em grupo), bola de neve, piada, fala; cadeia de história e juntar com item', async () => {
  db.events.push({ id: 'ev4', slug: 'acoes', name: 'Ações', currencyName: 'Fichas', active: true, startsAt: new Date(now - 1000), endsAt: new Date(now + 86400000), config: JSON.stringify(events.cleanConfig({
    quests: [
      { key: 'sorrir', title: 'Sorria', type: 'emote', emotes: [1], count: 2, rooms: [100] },
      { key: 'feliz', title: 'Sala feliz', type: 'emote', emotes: [1], together: 2 },
      { key: 'neve', title: 'Bolas', type: 'snowball', count: 3 },
      { key: 'piada', title: 'Piadas', type: 'joke', count: 1 },
      { key: 'falar', title: 'Diga oi', type: 'say', text: 'feliz natal', count: 1 },
      { key: 'fim', title: 'Final da história', type: 'visit', rooms: [110], requires: ['sorrir', 'neve'] },
      { key: 'furar', title: 'Virar a Lagoa', type: 'gather', rooms: [805], count: 2, items: [403] },
    ],
  })) });
  assert.throws(() => events.cleanConfig({ quests: [{ key: 'a', type: 'visit', requires: ['zzz'] }] }), /não existe/);
  assert.throws(() => events.cleanConfig({ quests: [{ key: 'a', type: 'visit', requires: 'a' }] }), /dela mesma/);
  const ev = (await events.activeEvents(true)).find((e) => e.slug === 'acoes');
  presence.length = 0; presence.push({ id: 1000, name: 'Rique', room: 100, x: 0, y: 0 }, { id: 2000, name: 'Outro', room: 100, x: 0, y: 0 });
  const act = (kind, value, room = 100, penguinId = 1000) => events._test.onAction({ penguinId, room, kind, value });
  // emote na sala errada não conta; na certa conta; o outro pinguim sorrindo junto fecha a "sala feliz"
  await act('emote', '1', 300);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'sorrir'))?.progress || 0, 0);
  await act('emote', '1');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'sorrir')).progress, 1);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'feliz')).progress, 1);
  await act('emote', '1', 100, 2000); // outro pinguim (sem conta) só alimenta a sala
  await act('emote', '2'); // emote errado não conta pro 'sorrir'
  assert.equal((await events._test.getProgress('u1', 'ev4', 'sorrir')).progress, 1);
  await act('emote', '1');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'sorrir')).done, true);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'feliz')).done, true, '2 pinguins sorrindo em 1 min');
  // cadeia: 'fim' está trancada até sorrir + neve
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'fim'))?.done || false, false, 'trancada');
  let st = await events.playerState('u1');
  assert.equal(st.events.find((e) => e.slug === 'acoes').quests.find((q) => q.key === 'fim').locked, true);
  await act('snowball', '1,2'); await act('snowball', '1,2'); await act('snowball', '1,2');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'neve')).done, true);
  await events._test.evaluate('u1', 110, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'fim')).done, true, 'destrancou');
  // piada e fala (texto, sem diferenciar maiúsculas; mensagem segura também vale)
  await act('joke', '3');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'piada')).done, true);
  await act('message', 'oi gente');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'falar'))?.done || false, false);
  await act('safe', 'FELIZ NATAL pra todos');
  assert.equal((await events._test.getProgress('u1', 'ev4', 'falar')).done, true);
  // juntar com item: só conta quem veste o Capacete de Obra
  presence[0].room = 805; presence[1].room = 805;
  live.get(1000).inventory.head = 403; live.set(2000, { inventory: { head: 0, face: 0, neck: 0, body: 0, feet: 0, hand: 0, pin: 0, background: 0 } });
  await events._test.evaluate('u1', 805, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'furar')).progress, 1);
  live.get(2000).inventory.head = 403;
  await events._test.evaluate('u1', 805, live.get(1000), [ev]);
  assert.equal((await events._test.getProgress('u1', 'ev4', 'furar')).done, true);
});
