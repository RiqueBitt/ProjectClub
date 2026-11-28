// Fase 4: Bora Jogar, Post da semana, retrospectiva mensal, temporadas
// temáticas e conquistas secretas.
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const spTime = require('../src/utils/spTime');
const common = require('../src/services/community/common');
const postOfWeek = require('../src/services/community/postOfWeek');
const seasons = require('../src/services/community/seasons');
const secrets = require('../src/services/community/secretAchievements');

const NOW = new Date('2026-11-02T18:00:00Z');
const MIN = 60_000;
const reset = () => { common._resetSettled(); common.resetEconomyCache(); secrets._reset(); };

// ---------------- Bora Jogar ----------------
test('Post da semana: mais votado da semana anterior, desempate por comentários, paga uma vez', async () => {
  reset();
  const s = spies();
  const prev = spTime.previousWeekBounds(NOW);
  const inWeek = new Date(prev.start.getTime() + 86400000);
  const db = fase4Db({
    user: [{ id: 'ana', coins: 0 }, { id: 'bia', coins: 0 }],
    post: [
      { id: 'p1', authorId: 'ana', title: 'A', score: 12, commentCount: 1, createdAt: inWeek },
      { id: 'p2', authorId: 'bia', title: 'B', score: 12, commentCount: 5, createdAt: inWeek },
      { id: 'p3', authorId: 'ana', title: 'Antigo', score: 99, commentCount: 0, createdAt: new Date(prev.start.getTime() - 86400000) },
    ],
  });
  const o = { db, now: NOW, notify: s.notify, ledger: s.ledgerFn };
  const r = await postOfWeek.pickIfDue(o);
  assert.equal(r.post.id, 'p2');
  assert.equal(db._store.user.find((u) => u.id === 'bia').coins, postOfWeek.REWARD_COINS);
  assert.ok(postOfWeek.isPostOfWeek('p2'));
  assert.equal((await postOfWeek.latest(o)).postId, 'p2');
  common._resetSettled();
  assert.equal(await postOfWeek.pickIfDue(o), null);
  assert.equal(db._store.user.find((u) => u.id === 'bia').coins, postOfWeek.REWARD_COINS);
});

test('Post da semana: semana fraca (pontuação mínima) não escolhe ninguém', async () => {
  reset();
  const prev = spTime.previousWeekBounds(NOW);
  const db = fase4Db({ post: [{ id: 'p1', authorId: 'ana', title: 'A', score: postOfWeek.MIN_SCORE - 1, createdAt: new Date(prev.start.getTime() + 1000) }] });
  const r = await postOfWeek.pickIfDue({ db, now: NOW });
  assert.equal(r.post, null);
});

// ---------------- Retrospectiva ----------------
test('temporadas: datas iguais às do cliente (+ Festa Junina) no horário de Brasília', () => {
  assert.equal(seasons.seasonForDate(new Date('2026-12-10T12:00:00Z')), 'natal');
  assert.equal(seasons.seasonForDate(new Date('2027-01-03T12:00:00Z')), 'anonovo');
  assert.equal(seasons.seasonForDate(new Date('2026-10-25T12:00:00Z')), 'halloween');
  assert.equal(seasons.seasonForDate(new Date('2026-06-15T12:00:00Z')), 'festajunina');
  assert.equal(seasons.seasonForDate(new Date('2026-09-21T12:00:00Z')), 'aniversario');
  assert.equal(seasons.seasonForDate(new Date('2026-02-16T12:00:00Z')), 'carnaval'); // segunda de Carnaval 2026
  assert.equal(seasons.seasonForDate(NOW), null);
  // 1º/12 00:30 em Brasília (03:30 UTC) já é Natal; 30/11 23:30 (02:30 UTC de 1º/12) ainda não.
  assert.equal(seasons.seasonForDate(new Date('2026-12-01T03:30:00Z')), 'natal');
  assert.equal(seasons.seasonForDate(new Date('2026-12-01T02:30:00Z')), null);
});

test('temporadas: presente diário uma vez por dia + conquista da temporada', async () => {
  reset();
  const s = spies();
  const xmas = new Date('2026-12-10T15:00:00Z');
  const db = fase4Db({ user: [{ id: 'ana', coins: 0 }] });
  const unlocked = [];
  const o = { db, now: xmas, ledger: s.ledgerFn, unlock: async (uid, key) => { unlocked.push(key); return true; } };
  const r = await seasons.claimDaily('ana', o);
  assert.equal(r.coins, seasons.SEASONS.natal.dailyCoins);
  assert.deepEqual(unlocked, ['temporada_natal']);
  await assert.rejects(seasons.claimDaily('ana', o), (e) => e.status === 409);
  assert.equal(db._store.user[0].coins, seasons.SEASONS.natal.dailyCoins);
  const st = await seasons.status('ana', o);
  assert.equal(st.claimedToday, true);
  assert.equal(st.daysClaimed, 1);
  await assert.rejects(seasons.claimDaily('ana', { ...o, now: NOW }), /Nenhuma temporada/);
});

// ---------------- Conquistas secretas ----------------
test('conquistas secretas: desbloqueio por ação escondida, uma vez só', async () => {
  reset();
  const emitted = [];
  const io = { to: () => ({ emit: (ev) => emitted.push(ev) }) };
  const db = fase4Db({ achievement: secrets.SECRET_ACHIEVEMENTS.map((a, i) => ({ id: `a${i}`, enabled: true, ...a })) });
  const at3am = new Date('2026-11-02T06:10:00Z'); // 03:10 em Brasília
  assert.equal(await secrets.onActivity('ana', 'MESSAGES', io, at3am, { db }), true);
  assert.equal(await secrets.onActivity('ana', 'MESSAGES', io, at3am, { db }), false);
  assert.equal(await secrets.onActivity('bia', 'MESSAGES', io, NOW, { db }), false, 'fora das 3h');
  assert.deepEqual(emitted, ['achievement:unlocked']);
  assert.equal(await secrets.unlock('ana', 'nao_existe', io, { db }), false);
  assert.ok(secrets.SECRET_ACHIEVEMENTS.every((a) => a.hidden));
  assert.ok(secrets.SEASON_ACHIEVEMENTS.every((a) => !a.hidden));
});

test('catálogo seed inclui as secretas e as de temporada', () => {
  const { ACHIEVEMENTS } = require('../src/data/achievementsCatalog');
  const keys = new Set(ACHIEVEMENTS.map((a) => a.key));
  for (const a of [...secrets.SECRET_ACHIEVEMENTS, ...secrets.SEASON_ACHIEVEMENTS]) assert.ok(keys.has(a.key), a.key);
  assert.equal(keys.size, ACHIEVEMENTS.length, 'sem chave repetida');
  for (const s of Object.values(seasons.SEASONS)) assert.ok(keys.has(s.achievement), s.achievement);
});
