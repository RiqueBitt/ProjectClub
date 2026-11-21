// Concursos, Jigsaw Jam e arquivos da Archives (services/waddle/contests.js,
// puzzles.js, assets.js) — com um Prisma de mentira em memória.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (rel) => path.join(__dirname, '..', 'src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

function fakePrisma() {
  const db = { contests: [], entries: [], votes: [], puzzles: [], solves: [], completions: [], settings: [], assets: [] };
  const match = (row, w) => Object.entries(w || {}).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) ? true : row[k] === v));
  const table = (rows, uniq, idKey = 'id', defaults = {}) => ({
    findMany: async ({ where: w } = {}) => rows.filter((r) => match(r, w)),
    findUnique: async ({ where: w }) => { const key = Object.keys(w)[0]; const val = w[key]; if (val && typeof val === 'object') return rows.find((r) => Object.entries(val).every(([k, v]) => r[k] === v)) || null; return rows.find((r) => r[key] === val) || null; },
    count: async ({ where: w }) => rows.filter((r) => match(r, w)).length,
    create: async ({ data }) => { if (uniq && rows.some((r) => uniq.every((k) => r[k] === data[k]))) { const e = new Error('unique'); e.code = 'P2002'; throw e; } const row = { [idKey]: data[idKey] || `id${rows.length + 1}`, ...defaults, ...data }; rows.push(row); return row; },
    update: async ({ where: w, data }) => { const row = rows.find((r) => match(r, w)); for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v && typeof v === 'object' && 'decrement' in v ? row[k] - v.decrement : v; return row; },
    upsert: async ({ where: w, create, update }) => { const key = Object.keys(w)[0]; const val = w[key]; const row = val && typeof val === 'object' ? rows.find((r) => Object.entries(val).every(([k, v]) => r[k] === v)) : rows.find((r) => r[key] === val); if (row) { Object.assign(row, update); return row; } const n = { [idKey]: create[idKey] || `id${rows.length + 1}`, ...defaults, ...create }; rows.push(n); return n; },
    delete: async ({ where: w }) => { const i = rows.findIndex((r) => match(r, w)); if (i >= 0) rows.splice(i, 1); },
  });
  const prisma = {
    plazaContest: table(db.contests), plazaContestEntry: table(db.entries, ['contestId', 'userId'], 'id', { votes: 0, winner: false, hidden: false }), plazaContestVote: table(db.votes, ['contestId', 'userId']),
    plazaPuzzle: table(db.puzzles, null, 'id', { approved: false, active: true, solves: 0 }), plazaPuzzleSolve: table(db.solves, ['puzzleId', 'userId', 'mode']), plazaPuzzleCompletion: table(db.completions, ['userId'], 'userId'), plazaSetting: table(db.settings, ['key'], 'key'),
    plazaAsset: table(db.assets),
    user: { findUnique: async ({ where: w }) => ({ id: w.id, username: w.id, displayName: w.id, avatarUrl: null }) },
    $transaction: async (fn) => fn(prisma),
  };
  return { prisma, db };
}

const { prisma, db } = fakePrisma();
stub('config/prisma.js', prisma);
const grants = [];
stub('services/waddle/events.js', { grant: async (userId, r) => { grants.push({ userId, ...r }); return { coins: r.coins || 0, items: r.items || [] }; } });
const contests = require(src('services/waddle/contests.js'));
const puzzles = require(src('services/waddle/puzzles.js'));
const assets = require(src('services/waddle/assets.js'));
const now = Date.now();

test('concurso: inscrição só no prazo, um voto por pinguim (pode trocar), vencedores ganham o prêmio uma vez', async () => {
  const c = await contests.save({ kind: 'igloo', title: 'Iglu assombrado', startsAt: new Date(now - 1000), endsAt: new Date(now + 3600000), votingEndsAt: new Date(now + 7200000), prizeItems: [413], prizeCoins: 500, maxWinners: 1 });
  await assert.rejects(() => contests.save({ title: 'x', startsAt: new Date(now), endsAt: new Date(now - 1) }), /Datas/);
  await contests.enter('u1', c.id, { imageUrl: 'https://cdn/x.png', caption: 'meu iglu' });
  await contests.enter('u2', c.id, { imageUrl: 'https://cdn/y.png' });
  await assert.rejects(() => contests.enter('u3', c.id, {}), /imagem/);
  // votação ainda fechada
  await assert.rejects(() => contests.vote('u1', c.id, db.entries[1].id), /votação abre/);
  db.contests[0].endsAt = new Date(now - 10);
  await assert.rejects(() => contests.vote('u1', c.id, db.entries[0].id), /você mesmo/);
  await contests.vote('u1', c.id, db.entries[1].id);
  await assert.rejects(() => contests.vote('u1', c.id, db.entries[1].id), /já votou/);
  await contests.vote('u3', c.id, db.entries[0].id);
  const r = await contests.vote('u3', c.id, db.entries[1].id); // trocou o voto
  assert.equal(r.changed, true);
  assert.equal(db.entries[1].votes, 2); assert.equal(db.entries[0].votes, 0);
  const list = await contests.playerList('u1');
  assert.equal(list[0].phase, 'voting'); assert.equal(list[0].myVote, db.entries[1].id); assert.equal(list[0].entries.find((e) => e.id === db.entries[1].id).votes, 2);
  const w = await contests.pickWinners(c.id, [db.entries[1].id, db.entries[0].id]);
  assert.equal(w.length, 1, 'maxWinners = 1'); assert.equal(grants[0].userId, 'u2'); assert.deepEqual(grants[0].items, [413]);
  assert.deepEqual(await contests.pickWinners(c.id, [db.entries[1].id]), [], 'não premia duas vezes');
});

test('jigsaw: envio com fila, aprovação, moedas por modo uma vez, e prêmio ao terminar todos', async () => {
  await puzzles.saveSettings({ coinsFacil: 10, coinsDificil: 30, completionItems: [557], completionCoins: 100, maxPending: 1 });
  const p1 = await puzzles.submit('u1', { imageUrl: 'https://cdn/a.png', title: 'Arte' });
  assert.equal(p1.approved, false);
  await assert.rejects(() => puzzles.submit('u1', { imageUrl: 'https://cdn/b.png' }), /esperando aprovação/);
  const p2 = await puzzles.submit('staff', { imageUrl: 'https://cdn/s.png', title: 'Da equipe' }, { isStaff: true });
  assert.equal(p2.approved, true);
  await puzzles.review(p1.id, { approved: true });
  let st = await puzzles.playerState('u1');
  assert.equal(st.puzzles.length, 2); assert.equal(st.modes.dificil.size, 5);
  await assert.rejects(() => puzzles.solve('u1', p1.id, { mode: 'facil', seconds: 2 }), /Rápido demais/);
  const s1 = await puzzles.solve('u1', p1.id, { mode: 'facil', seconds: 20 });
  assert.equal(s1.coins, 10);
  assert.equal((await puzzles.solve('u1', p1.id, { mode: 'facil', seconds: 20 })).repeat, true);
  await assert.rejects(() => puzzles.claimCompletion('u1'), /Resolva todos/);
  await puzzles.solve('u1', p2.id, { mode: 'dificil', seconds: 40 });
  st = await puzzles.playerState('u1');
  assert.equal(st.completion.allDone, true);
  const fin = await puzzles.claimCompletion('u1');
  assert.deepEqual(fin.items, [557]);
  await assert.rejects(() => puzzles.claimCompletion('u1'), /já pegou/);
});

test('archives: resolve link da página File:, nome solto e recusa outros sites; valida alvo', () => {
  assert.equal(assets.resolveUrl('https://archives.clubpenguinwiki.info/wiki/File:ArtworkRoomsCoffee6.swf').url, 'https://archives.clubpenguinwiki.info/wiki/Special:FilePath/ArtworkRoomsCoffee6.swf');
  assert.equal(assets.resolveUrl('Party Town 2013.swf').name, 'Party Town 2013.swf');
  assert.equal(assets.resolveUrl('https://archives.clubpenguinwiki.info/static/images/archives/1/1a/Town.swf').name, 'Town.swf');
  assert.throws(() => assets.resolveUrl('https://evil.com/x.swf'), /Só arquivos/);
  assert.equal(assets._cleanTarget('room', ' Town '), 'town');
  assert.equal(assets._cleanTarget('music', '245'), '245');
  assert.equal(assets._cleanTarget('route', '/play/v2/content/global/content/map.swf'), 'play/v2/content/global/content/map.swf');
  assert.throws(() => assets._cleanTarget('route', 'play/v2/../x.swf'), /rota/);
  assert.throws(() => assets._cleanTarget('route', 'etc/passwd'), /rota/);
});
