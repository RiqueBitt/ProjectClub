// Fase 4: Bora Jogar, Post da semana, retrospectiva mensal, temporadas
// temáticas e conquistas secretas.
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const spTime = require('../src/utils/spTime');
const common = require('../src/services/community/common');
const playGroups = require('../src/services/community/playGroups');
const postOfWeek = require('../src/services/community/postOfWeek');
const recap = require('../src/services/community/monthlyRecap');
const seasons = require('../src/services/community/seasons');
const secrets = require('../src/services/community/secretAchievements');

const NOW = new Date('2026-11-02T18:00:00Z');
const MIN = 60_000;
const reset = () => { common._resetSettled(); common.resetEconomyCache(); secrets._reset(); };

// ---------------- Bora Jogar ----------------
test('Bora Jogar: validação na criação', async () => {
  const db = fase4Db();
  const o = { db, now: NOW };
  const ana = { id: 'ana' };
  await assert.rejects(playGroups.create(ana, { game: 'x', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 4 }, o), /jogo/);
  await assert.rejects(playGroups.create(ana, { game: 'Valorant', startsAt: new Date(NOW.getTime() + MIN), slots: 4 }, o), /5 minutos/);
  await assert.rejects(playGroups.create(ana, { game: 'Valorant', startsAt: new Date(NOW.getTime() + 30 * 86400000), slots: 4 }, o), /dias pra frente/);
  await assert.rejects(playGroups.create(ana, { game: 'Valorant', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 1 }, o), /vagas/);
  await assert.rejects(playGroups.create(ana, { game: 'Valorant', startsAt: 'ontem', slots: 4 }, o), /inválidas/);
  for (let i = 0; i < playGroups.MAX_ACTIVE_PER_USER; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await playGroups.create(ana, { game: `Jogo ${i}`, startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 3, description: 'bora\u0000!' }, o);
  }
  await assert.rejects(playGroups.create(ana, { game: 'Mais um', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 3 }, o), (e) => e.status === 429);
  assert.equal(db._store.playGroup[0].description, 'bora !', 'caracteres de controle saem');
});

test('Bora Jogar: entra/sai, completa avisa todo mundo, lembrete 15 min antes e expira', async () => {
  const s = spies();
  const db = fase4Db({ user: [{ id: 'ana' }, { id: 'bia' }, { id: 'caio' }] });
  const o = { db, now: NOW, notify: s.notify };
  const g = await playGroups.create({ id: 'ana' }, { game: 'Minecraft', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 2 }, o);
  await assert.rejects(playGroups.join({ id: 'ana' }, g.id, o), /já está/);
  await playGroups.join({ id: 'bia' }, g.id, o);
  assert.equal(db._store.playGroup[0].status, 'FULL');
  assert.equal(s.notices.length, 2, 'as duas pessoas do grupo');
  await assert.rejects(playGroups.join({ id: 'caio' }, g.id, o), /completo/);
  await playGroups.leave({ id: 'bia' }, g.id, o);
  assert.equal(db._store.playGroup[0].status, 'OPEN', 'vaga abriu de novo');
  await playGroups.join({ id: 'caio' }, g.id, o);
  const list = await playGroups.list('caio', o);
  assert.equal(list[0].joined, true);
  assert.equal(list[0].count, 2);
  // Lembrete: 10 min antes, uma vez só.
  s.notices.length = 0;
  const soon = { ...o, now: new Date(NOW.getTime() + 50 * MIN) };
  assert.equal((await playGroups.tick(soon)).reminded, 2);
  assert.equal((await playGroups.tick(soon)).reminded, 0);
  assert.match(s.notices[0].body, /10 minutos/);
  // Duas horas depois do horário: expira.
  const later = { ...o, now: new Date(NOW.getTime() + 60 * MIN + playGroups.EXPIRE_AFTER_MS + MIN) };
  assert.equal((await playGroups.tick(later)).expired, 1);
  assert.equal((await playGroups.list('ana', later)).length, 0);
});

test('Bora Jogar: só quem criou (ou a staff) cancela; quem criou sair = cancelar', async () => {
  const s = spies();
  const db = fase4Db({ user: [{ id: 'ana' }, { id: 'bia' }] });
  const o = { db, now: NOW, notify: s.notify };
  const g = await playGroups.create({ id: 'ana' }, { game: 'CS2', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 5 }, o);
  await playGroups.join({ id: 'bia' }, g.id, o);
  await assert.rejects(playGroups.cancel({ id: 'bia' }, g.id, o), (e) => e.status === 403);
  const r = await playGroups.leave({ id: 'ana' }, g.id, o);
  assert.equal(r.cancelled, true);
  assert.equal(s.notices[0].userId, 'bia');
  const g2 = await playGroups.create({ id: 'ana' }, { game: 'CS2', startsAt: new Date(NOW.getTime() + 60 * MIN), slots: 5 }, o);
  await playGroups.cancel({ id: 'mod', platformRole: 'MODERATOR' }, g2.id, o);
});

// ---------------- Post da semana ----------------
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
test('retrospectiva: gera no dia 1º para quem teve atividade, com conquistas do mês e um aviso', async () => {
  reset();
  const s = spies();
  const firstOfDec = new Date('2026-12-01T12:00:00Z');
  const db = fase4Db({
    activityCounter: [
      { scope: 'USER_MONTH', scopeId: 'ana', periodKey: '2026-11', messages: 120, voiceMinutes: 45, forumPosts: 2, reactions: 10, xp: 900, points: 185 },
      { scope: 'USER_MONTH', scopeId: 'bia', periodKey: '2026-11', messages: 3, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 50, points: 3 },
      { scope: 'USER_MONTH', scopeId: 'caio', periodKey: '2026-10', messages: 999, points: 999 },
    ],
    achievement: [{ id: 'a1', key: 'primeiro_post', name: 'Primeiro Post', rarity: 'COMMON' }, { id: 'a2', key: 'secreta_coruja', name: 'Coruja', rarity: 'RARE' }],
    userAchievement: [
      { id: 'u1', userId: 'ana', achievementId: 'primeiro_post', unlockedAt: new Date('2026-11-10T12:00:00Z') },
      { id: 'u2', userId: 'ana', achievementId: 'secreta_coruja', unlockedAt: new Date('2026-11-11T06:00:00Z') },
      { id: 'u3', userId: 'ana', achievementId: 'velha', unlockedAt: new Date('2026-09-11T06:00:00Z') },
    ],
  });
  const o = { db, now: firstOfDec, notify: s.notify };
  const r = await recap.runIfDue(o);
  assert.deepEqual(r, { created: 2, total: 2 });
  assert.equal(s.notices.length, 2);
  assert.equal(s.notices[0].title, 'Sua retrospectiva de novembro chegou!');
  const mine = await recap.getRecap('ana', '2026-11', o);
  assert.equal(mine.recap.messages, 120);
  assert.equal(mine.recap.achievementsCount, 2);
  assert.equal(mine.recap.achievements[0].key, 'secreta_coruja', 'mais rara primeiro');
  assert.equal(mine.recap.topPercent, 50);
  common._resetSettled(); db._store.jobRun = [];
  assert.deepEqual(await recap.runIfDue(o), { created: 0, total: 2 }, 'cartão já gravado não é refeito');
  assert.equal(await recap.runIfDue({ ...o, now: new Date('2026-12-15T12:00:00Z') }), null, 'só nos primeiros dias');
});

// ---------------- Temporadas ----------------
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
