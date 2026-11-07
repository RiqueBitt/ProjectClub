// Fase 4: contadores de atividade, competição semanal dos Clubes e metas
// coletivas da semana (banco falso em memória — ver helpers/fake-db.js).
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const spTime = require('../src/utils/spTime');
const common = require('../src/services/community/common');
const activity = require('../src/services/community/activity');
const clanWeekly = require('../src/services/community/clanWeekly');
const goals = require('../src/services/community/communityGoals');

// Segunda, 2 de novembro de 2026, 15h em Brasília.
const MONDAY = new Date('2026-11-02T18:00:00Z');
const LAST_WEEK = new Date('2026-10-28T18:00:00Z'); // quarta da semana anterior

function reset() { activity._reset(); common._resetSettled(); common.resetEconomyCache(); }

test('chaves de semana/mês/dia no horário de Brasília', () => {
  assert.equal(spTime.weekBounds(MONDAY).key, '2026-W45');
  assert.equal(spTime.previousWeekBounds(MONDAY).key, '2026-W44');
  // Domingo 23h30 em Brasília (= segunda 02:30 UTC) ainda é a semana anterior.
  assert.equal(spTime.weekBounds(new Date('2026-11-02T02:30:00Z')).key, '2026-W44');
  assert.equal(spTime.monthBounds(new Date('2026-11-01T02:00:00Z')).key, '2026-10');
  assert.equal(spTime.dayKey(new Date('2026-11-02T02:00:00Z')), '2026-11-01');
  assert.equal(spTime.monthName('2026-10'), 'outubro');
});

test('atividade: soma em memória e grava contadores de pessoa, Clube e comunidade', async () => {
  reset();
  const db = fase4Db({ user: [{ id: 'ana', clanId: 'c1' }, { id: 'bia', clanId: null }] });
  activity.record('ana', 'MESSAGES', 3, MONDAY);
  activity.record('ana', 'FORUM_POSTS', 1, MONDAY);
  activity.record('bia', 'VOICE_MINUTES', 5, MONDAY);
  activity.record('bia', 'CARDS_PLAY', 1, MONDAY); // tipo que não conta
  await activity.flush({ db });
  const week = spTime.weekBounds(MONDAY).key;
  const get = (scope, id, period) => db._store.activityCounter.find((r) => r.scope === scope && r.scopeId === id && r.periodKey === period);
  assert.equal(get('USER_WEEK', 'ana', week).points, 3 + 10);
  assert.equal(get('CLAN_WEEK', 'c1', week).points, 13);
  assert.equal(get('COMMUNITY_WEEK', 'all', week).messages, 3);
  assert.equal(get('COMMUNITY_WEEK', 'all', week).voiceMinutes, 5);
  assert.equal(get('USER_MONTH', 'bia', '2026-11').voiceMinutes, 5);
  assert.equal(activity._peek().length, 0);
});

test('atividade: teto semanal de pontos por membro no Clube (anti-farm)', async () => {
  reset();
  const db = fase4Db({ user: [{ id: 'ana', clanId: 'c1' }] });
  const cap = activity.CLAN_POINTS_WEEKLY_CAP_PER_MEMBER;
  activity.record('ana', 'MESSAGES', cap - 5, MONDAY);
  await activity.flush({ db });
  activity.record('ana', 'MESSAGES', 50, MONDAY);
  await activity.flush({ db });
  const week = spTime.weekBounds(MONDAY).key;
  const clan = db._store.activityCounter.find((r) => r.scope === 'CLAN_WEEK' && r.scopeId === 'c1' && r.periodKey === week);
  const me = db._store.activityCounter.find((r) => r.scope === 'USER_WEEK' && r.scopeId === 'ana' && r.periodKey === week);
  assert.equal(clan.points, cap, 'Clube só recebe até o teto');
  assert.equal(me.points, cap + 45, 'contador pessoal continua contando tudo');
});

function seedWeek(db, weekKey) {
  db._store.clan.push({ id: 'c1', name: 'Lobos', iconColor: '#f00', iconId: null }, { id: 'c2', name: 'Corujas', iconColor: '#0f0', iconId: null });
  db._store.activityCounter.push(
    { scope: 'CLAN_WEEK', scopeId: 'c1', periodKey: weekKey, points: 300, messages: 200, voiceMinutes: 100, forumPosts: 0, reactions: 0, xp: 0 },
    { scope: 'CLAN_WEEK', scopeId: 'c2', periodKey: weekKey, points: 120, messages: 120, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0 },
    { scope: 'USER_WEEK', scopeId: 'ana', periodKey: weekKey, points: 250, messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0 },
    { scope: 'USER_WEEK', scopeId: 'caio', periodKey: weekKey, points: 2, messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0 },
  );
}

test('Clubes: fecha a semana, paga só quem contribuiu no Clube vencedor e uma vez só', async () => {
  reset();
  const s = spies();
  const prevKey = spTime.previousWeekBounds(MONDAY).key;
  const db = fase4Db({
    user: [{ id: 'ana', clanId: 'c1', coins: 0 }, { id: 'caio', clanId: 'c1', coins: 0 }, { id: 'dani', clanId: 'c1', coins: 0 }, { id: 'eva', clanId: 'c2', coins: 0 }],
  });
  seedWeek(db, prevKey);
  const opts = { db, now: MONDAY, notify: s.notify, ledger: s.ledgerFn };
  const r = await clanWeekly.closeWeekIfDue(opts);
  assert.equal(r.winner.clanId, 'c1');
  const coins = (id) => db._store.user.find((u) => u.id === id).coins;
  assert.equal(coins('ana'), clanWeekly.WINNER_COINS_PER_MEMBER);
  assert.equal(coins('caio'), 0, 'contribuiu menos que o mínimo');
  assert.equal(coins('dani'), 0, 'não contribuiu');
  assert.equal(coins('eva'), 0, 'outro Clube');
  assert.equal(s.notices.filter((n) => n.kind === 'CLAN_WEEK').length, 1);
  // Rodar de novo (outra instância / reinício) não paga em dobro.
  common._resetSettled();
  assert.equal(await clanWeekly.closeWeekIfDue(opts), null);
  db._store.clanWeekResult = []; db._store.jobRun = [];
  await clanWeekly.closeWeekIfDue(opts);
  assert.equal(coins('ana'), clanWeekly.WINNER_COINS_PER_MEMBER, 'RewardGrant impede pagar de novo');
});

test('Clubes: só fecha depois da virada (com folga) e semana parada não tem vencedor', async () => {
  reset();
  const db = fase4Db({ user: [] });
  const justAfter = new Date(spTime.weekBounds(MONDAY).start.getTime() + 60_000);
  assert.equal(await clanWeekly.closeWeekIfDue({ db, now: justAfter }), null);
  const r = await clanWeekly.closeWeekIfDue({ db, now: MONDAY, notify: async () => {} });
  assert.equal(r.winner, null);
  assert.equal(db._store.clanWeekResult.length, 1);
});

test('Clubes: Economia desligada não paga moedas (mas registra o vencedor)', async () => {
  reset();
  const prevKey = spTime.previousWeekBounds(MONDAY).key;
  const db = fase4Db({ user: [{ id: 'ana', clanId: 'c1', coins: 0 }], platformSettings: [{ id: 'singleton', disabledSystems: '["economia"]' }] });
  seedWeek(db, prevKey);
  const r = await clanWeekly.closeWeekIfDue({ db, now: MONDAY, notify: async () => {}, ledger: () => {} });
  assert.equal(r.coins, 0);
  assert.equal(db._store.user[0].coins, 0);
});

test('metas coletivas: padrão da semana, meta batida avisa ao vivo e paga quem participou', async () => {
  reset();
  const s = spies();
  const emitted = [];
  const io = { to: () => ({ emit: (ev, data) => emitted.push([ev, data]) }) };
  const db = fase4Db({ user: [{ id: 'ana', coins: 0 }, { id: 'bia', coins: 0 }] });
  const prev = spTime.previousWeekBounds(MONDAY);
  // Semana anterior: metas padrão + a de mensagens batida.
  await goals.ensureWeek(prev.key, { db });
  assert.equal(db._store.communityGoal.length, goals.DEFAULT_GOALS.length);
  const msgGoal = db._store.communityGoal.find((g) => g.metric === 'MESSAGES');
  const counter = { scope: 'COMMUNITY_WEEK', scopeId: 'all', periodKey: prev.key, messages: msgGoal.target, voiceMinutes: 1, forumPosts: 0 };
  const reached = await goals.checkReached(counter, { db, io, now: LAST_WEEK });
  assert.equal(reached.length, 1);
  assert.equal(emitted[0][0], 'goals:reached');
  assert.equal((await goals.checkReached(counter, { db, io, now: LAST_WEEK })).length, 0, 'não avisa duas vezes');
  db._store.activityCounter.push(
    { scope: 'USER_WEEK', scopeId: 'ana', periodKey: prev.key, points: 40 },
    { scope: 'USER_WEEK', scopeId: 'bia', periodKey: prev.key, points: 1 },
  );
  const r = await goals.closeIfDue({ db, now: MONDAY, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(r.paid, 1);
  assert.equal(db._store.user.find((u) => u.id === 'ana').coins, msgGoal.rewardCoins);
  assert.equal(db._store.user.find((u) => u.id === 'bia').coins, 0, 'abaixo da participação mínima');
  common._resetSettled();
  assert.equal(await goals.closeIfDue({ db, now: MONDAY }), null, 'metas já pagas');
});

test('metas coletivas: staff valida tipo, meta e recompensa', async () => {
  reset();
  const db = fase4Db();
  await assert.rejects(goals.adminSave('staff', { metric: 'NADA', target: 10 }, { db, now: MONDAY }), /Tipo de meta/);
  await assert.rejects(goals.adminSave('staff', { metric: 'MESSAGES', target: 0 }, { db, now: MONDAY }), /Meta inválida/);
  await assert.rejects(goals.adminSave('staff', { metric: 'MESSAGES', target: 10, rewardCoins: 99999 }, { db, now: MONDAY }), /Recompensa/);
  const g = await goals.adminSave('staff', { metric: 'MESSAGES', target: 500, rewardCoins: 20, week: 'next' }, { db, now: MONDAY });
  assert.equal(g.weekKey, '2026-W46');
  const again = await goals.adminSave('staff', { metric: 'MESSAGES', target: 900, rewardCoins: 20, week: 'next' }, { db, now: MONDAY });
  assert.equal(again.id, g.id, 'mesma semana + tipo = edita');
  assert.equal(again.target, 900);
});
