// Fase 4: indicação de amigos, padrinho de novatos, aniversários,
// reputação ("Agradecer") e cargos por interesse.
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const common = require('../src/services/community/common');
const referrals = require('../src/services/community/referrals');
const mentors = require('../src/services/community/mentors');
const birthdays = require('../src/services/community/birthdays');
const reputation = require('../src/services/community/reputation');
const interestRoles = require('../src/services/community/interestRoles');
const secrets = require('../src/services/community/secretAchievements');

const NOW = new Date('2026-11-02T18:00:00Z');
const DAY = 86400000;
const reset = () => { common._resetSettled(); common.resetEconomyCache(); secrets._reset(); };
const coinsOf = (db, id) => db._store.user.find((u) => u.id === id).coins;

// ---------------- Indicação ----------------
test('indicação: código estável, inscrição com convite, aprovação e pagamento dos dois', async () => {
  reset();
  const s = spies();
  const db = fase4Db({ user: [{ id: 'ana', coins: 0, displayName: 'Ana' }] });
  const code = await referrals.getOrCreateCode('ana', { db });
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(await referrals.getOrCreateCode('ana', { db }), code);
  await referrals.attachToApplication({ code: code.toLowerCase(), applicationId: 'app1', ip: '10.0.0.9' }, { db, now: NOW });
  assert.equal(await referrals.attachToApplication({ code, applicationId: 'app1', ip: 'x' }, { db }), null, 'uma indicação por inscrição');
  assert.equal(await referrals.attachToApplication({ code: 'NAOEXISTE', applicationId: 'app2' }, { db }), null);
  // Aprovada: vira conta nova.
  db._store.user.push({ id: 'novo', coins: 0, displayName: 'Novo', accountLevel: 1, createdAt: new Date(NOW.getTime() - DAY) });
  await referrals.linkInvitee({ applicationId: 'app1', userId: 'novo' }, { db });
  const o = { db, now: NOW, notify: s.notify, ledger: s.ledgerFn };
  // Ainda não qualificou (nível 1, 1 dia de conta).
  assert.equal((await referrals.processPending(o)).rewarded, 0);
  Object.assign(db._store.user.find((u) => u.id === 'novo'), { accountLevel: referrals.MIN_LEVEL, createdAt: new Date(NOW.getTime() - referrals.MIN_DAYS * DAY) });
  assert.equal((await referrals.processPending(o)).rewarded, 1);
  assert.equal(coinsOf(db, 'ana'), referrals.INVITER_COINS);
  assert.equal(coinsOf(db, 'novo'), referrals.INVITEE_COINS);
  assert.equal(s.notices.length, 2);
  // Rodar de novo não paga de novo.
  await referrals.processPending(o);
  assert.equal(coinsOf(db, 'ana'), referrals.INVITER_COINS);
});

test('indicação: mesmo IP de quem convidou fica em análise; autoindicação é recusada', async () => {
  reset();
  const db = fase4Db({
    user: [{ id: 'ana', coins: 0 }],
    refreshToken: [{ id: 'r1', userId: 'ana', ipAddress: '::ffff:200.1.2.3', createdAt: new Date(NOW.getTime() - DAY) }],
  });
  const code = await referrals.getOrCreateCode('ana', { db });
  const ref = await referrals.attachToApplication({ code, applicationId: 'app1', ip: '200.1.2.3' }, { db, now: NOW });
  assert.equal(ref.status, 'SUSPECT');
  await referrals.attachToApplication({ code, applicationId: 'app2', ip: '9.9.9.9' }, { db, now: NOW });
  await referrals.linkInvitee({ applicationId: 'app2', userId: 'ana' }, { db });
  assert.equal(db._store.referral.find((r) => r.applicationId === 'app2').status, 'REJECTED');
  assert.equal(await referrals.attachToUser({ code, userId: 'ana' }, { db }), null, 'não se indica direto também');
});

test('indicação: teto mensal de quem convida (a conta nova ainda ganha)', async () => {
  reset();
  const s = spies();
  const old = new Date(NOW.getTime() - 30 * DAY);
  const users = [{ id: 'ana', coins: 0, displayName: 'Ana' }];
  const refs = [];
  for (let i = 0; i < referrals.MONTHLY_CAP + 1; i += 1) {
    users.push({ id: `n${i}`, coins: 0, displayName: `N${i}`, accountLevel: 5, createdAt: old });
    refs.push({ id: `r${i}`, inviterId: 'ana', inviteeId: `n${i}`, status: 'PENDING', createdAt: new Date(old.getTime() + i * 1000) });
  }
  const db = fase4Db({ user: users, referral: refs });
  const r = await referrals.processPending({ db, now: NOW, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(r.rewarded, referrals.MONTHLY_CAP);
  assert.equal(r.capped, 1);
  assert.equal(coinsOf(db, 'ana'), referrals.MONTHLY_CAP * referrals.INVITER_COINS);
  assert.equal(coinsOf(db, `n${referrals.MONTHLY_CAP}`), referrals.INVITEE_COINS);
});

test('indicação: conta banida não paga e indicações velhas expiram', async () => {
  reset();
  const db = fase4Db({
    user: [{ id: 'ana', coins: 0 }, { id: 'ban', coins: 0, accountLevel: 9, createdAt: new Date(NOW.getTime() - 20 * DAY), isPlatformBanned: true }],
    referral: [
      { id: 'r1', inviterId: 'ana', inviteeId: 'ban', status: 'PENDING', createdAt: new Date(NOW.getTime() - 10 * DAY) },
      { id: 'r2', inviterId: 'ana', inviteeId: null, applicationId: 'velha', status: 'PENDING', createdAt: new Date(NOW.getTime() - 90 * DAY) },
    ],
  });
  const r = await referrals.processPending({ db, now: NOW, notify: async () => {}, ledger: () => {} });
  assert.equal(r.rejected, 1);
  assert.equal(r.expired, 1);
  assert.equal(coinsOf(db, 'ana'), 0);
});

// ---------------- Padrinho ----------------
test('padrinho: escolhe quem tem menos afilhados e respeita o máximo', () => {
  const loads = new Map([['a', 2], ['b', 0], ['c', mentors.MAX_ACTIVE_MENTEES]]);
  assert.equal(mentors.pickMentor(['a', 'b', 'c'], loads), 'b');
  assert.equal(mentors.pickMentor(['c'], loads), null);
});

test('padrinho: só nível mínimo pode se oferecer; apadrinha conta nova, abre DM e avisa os dois', async () => {
  reset();
  const s = spies();
  const today = new Date(NOW.getTime() - DAY).toISOString().slice(0, 10);
  const db = fase4Db({
    user: [
      { id: 'vet', accountLevel: mentors.MIN_LEVEL, displayName: 'Veterana', coins: 0 },
      { id: 'vet2', accountLevel: 20, displayName: 'Veterano', coins: 0 },
      { id: 'low', accountLevel: 2, displayName: 'Baixo' },
      { id: 'novo', accountLevel: 1, displayName: 'Novo' },
    ],
    userActiveDay: [{ userId: 'vet', day: today }, { userId: 'vet2', day: today }],
    mentorship: [{ id: 'm0', mentorId: 'vet2', menteeId: 'outro', status: 'ACTIVE', createdAt: NOW }],
  });
  await assert.rejects(mentors.setPrefs({ id: 'low' }, { mentorOptIn: true }, { db }), /nível/);
  await mentors.setPrefs({ id: 'vet' }, { mentorOptIn: true }, { db });
  await mentors.setPrefs({ id: 'vet2' }, { mentorOptIn: true }, { db });
  const opened = [];
  const row = await mentors.assignMentor('novo', { db, now: NOW, notify: s.notify, ensureDirectConversation: async (a, b) => { opened.push([a, b]); return { id: 'cv9' }; } });
  assert.equal(row.mentorId, 'vet', 'a que tem menos afilhados');
  assert.deepEqual(opened, [['vet', 'novo']]);
  assert.equal(s.notices.length, 2);
  assert.equal(s.notices[0].link, '/conversations/cv9');
  assert.equal(await mentors.assignMentor('novo', { db, now: NOW }), null, 'um padrinho por conta');
});

test('padrinho: ganha moedas quando o afilhado fica ativo 7 dias; expira depois da janela', async () => {
  reset();
  const s = spies();
  const start = new Date(NOW.getTime() - 10 * DAY);
  const days = Array.from({ length: mentors.MENTEE_ACTIVE_DAYS }, (_, i) => ({ userId: 'novo', day: new Date(start.getTime() + i * DAY).toISOString().slice(0, 10) }));
  const db = fase4Db({
    user: [{ id: 'vet', coins: 0 }, { id: 'novo', displayName: 'Novo' }, { id: 'sumiu', displayName: 'Sumiu' }],
    mentorship: [
      { id: 'm1', mentorId: 'vet', menteeId: 'novo', status: 'ACTIVE', createdAt: start },
      { id: 'm2', mentorId: 'vet', menteeId: 'sumiu', status: 'ACTIVE', createdAt: new Date(NOW.getTime() - 40 * DAY) },
    ],
    userActiveDay: days,
  });
  const r = await mentors.processRewards({ db, now: NOW, notify: s.notify, ledger: s.ledgerFn });
  assert.deepEqual(r, { rewarded: 1, expired: 1 });
  assert.equal(coinsOf(db, 'vet'), mentors.REWARD_COINS);
  await mentors.processRewards({ db, now: NOW, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(coinsOf(db, 'vet'), mentors.REWARD_COINS, 'paga uma vez só');
});

// ---------------- Aniversário ----------------
test('aniversário: só dia/mês em Brasília; 29/02 comemora em 28/02 fora do ano bissexto', () => {
  const at = (iso) => new Date(iso);
  assert.ok(birthdays.isBirthdayToday(at('1999-11-02T00:00:00Z'), NOW));
  assert.ok(!birthdays.isBirthdayToday(at('1999-11-03T00:00:00Z'), NOW));
  assert.ok(birthdays.isBirthdayToday(at('2000-02-29T00:00:00Z'), at('2027-02-28T15:00:00Z')));
  assert.ok(!birthdays.isBirthdayToday(at('2000-02-29T00:00:00Z'), at('2028-02-28T15:00:00Z')));
  assert.ok(!birthdays.isBirthdayToday(null, NOW));
});

test('aniversário: só quem ligou a opção; presente + aviso pros amigos, uma vez por ano', async () => {
  reset();
  const s = spies();
  const db = fase4Db({
    user: [
      { id: 'ana', displayName: 'Ana', birthDate: new Date('1995-11-02T00:00:00Z'), coins: 0 },
      { id: 'bia', displayName: 'Bia', birthDate: new Date('1990-11-02T00:00:00Z'), coins: 0 }, // não ligou
      { id: 'caio', displayName: 'Caio', coins: 0 },
    ],
    communityPrefs: [{ userId: 'ana', birthdayOptIn: true }, { userId: 'bia', birthdayOptIn: false }],
    friendship: [{ id: 'f1', requesterId: 'caio', addresseeId: 'ana', status: 'ACCEPTED' }],
  });
  const early = new Date('2026-11-02T09:00:00Z'); // 6h em Brasília
  assert.equal(await birthdays.runIfDue({ db, now: early }), null);
  const r = await birthdays.runIfDue({ db, now: NOW, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(r.celebrated, 1);
  assert.equal(coinsOf(db, 'ana'), birthdays.BIRTHDAY_COINS);
  assert.equal(coinsOf(db, 'bia'), 0);
  assert.deepEqual(s.notices.map((n) => n.userId).sort(), ['ana', 'caio']);
  // Nada de ano/idade nos textos.
  assert.ok(s.notices.every((n) => !/\b(19|20)\d\d\b|anos/.test(`${n.title} ${n.body}`)));
  common._resetSettled();
  db._store.jobRun = [];
  await birthdays.runIfDue({ db, now: NOW, notify: s.notify, ledger: s.ledgerFn });
  assert.equal(coinsOf(db, 'ana'), birthdays.BIRTHDAY_COINS, 'uma comemoração por ano');
  const list = await birthdays.todayList({ db, now: NOW });
  assert.deepEqual(list.map((u) => u.id), ['ana']);
  assert.ok(!('birthDate' in list[0]), 'a lista nunca leva a data');
});

// ---------------- Reputação ----------------
test('reputação: agradece uma vez por dia por pessoa, nunca a si mesmo; conquista secreta aos 10', async () => {
  reset();
  const s = spies();
  const db = fase4Db({
    message: [{ id: 'm1', authorId: 'bia', channelId: 'ch', conversationId: null, deleted: false }, { id: 'm2', authorId: 'ana', channelId: 'ch', conversationId: null, deleted: false }],
    post: [{ id: 'p1', authorId: 'bia', title: 'Guia' }],
  });
  const unlocked = [];
  const o = { db, now: NOW, notify: s.notify, authz: { requirePermission: async () => true }, unlock: async (uid, key) => { unlocked.push([uid, key]); } };
  const r = await reputation.thank({ id: 'ana', displayName: 'Ana' }, { targetType: 'MESSAGE', targetId: 'm1' }, o);
  assert.equal(r.total, 1);
  await assert.rejects(reputation.thank({ id: 'ana' }, { targetType: 'POST', targetId: 'p1' }, o), (e) => e.status === 409);
  await assert.rejects(reputation.thank({ id: 'ana' }, { targetType: 'MESSAGE', targetId: 'm2' }, o), /si mesmo/);
  await assert.rejects(reputation.thank({ id: 'ana' }, { targetType: 'NADA', targetId: 'x' }, o), /inválido/);
  // Amanhã pode de novo.
  await reputation.thank({ id: 'ana' }, { targetType: 'POST', targetId: 'p1' }, { ...o, now: new Date(NOW.getTime() + DAY) });
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await reputation.thank({ id: `fã${i}` }, { targetType: 'POST', targetId: 'p1' }, o);
  }
  assert.deepEqual(unlocked, [['bia', 'secreta_gente_boa']]);
  assert.equal((await reputation.profile('bia', o)).total, 10);
  db._store.user.push({ id: 'bia', displayName: 'Bia' });
  const rank = await reputation.ranking({ period: 'all' }, o);
  assert.deepEqual(rank.ranking.map((r) => [r.user.id, r.thanks]), [['bia', 10]]);
});

// ---------------- Cargos por interesse ----------------
test('cargos por interesse: só cargos sem permissão; pessoa só mexe nos de interesse', async () => {
  reset();
  const db = fase4Db({
    role: [
      { id: 'mine', name: 'Minecraft', permissions: '0', selfAssignable: true, position: 2 },
      { id: 'mod', name: 'Moderação', permissions: '4', selfAssignable: true, position: 9 }, // marcado errado: tem permissão
      { id: 'vip', name: 'VIP', permissions: '0', selfAssignable: false, position: 3 },
      { id: 'todos', name: '@todos', permissions: '0', isDefault: true, selfAssignable: true, position: 0 },
    ],
    userRole: [{ id: 'ur1', userId: 'ana', roleId: 'vip' }],
  });
  const cat = await interestRoles.catalog('ana', { db });
  assert.deepEqual(cat.roles.map((r) => r.id), ['mine']);
  await assert.rejects(interestRoles.setMine('ana', ['mod'], { db }), /não é um cargo de interesse/);
  await assert.rejects(interestRoles.setMine('ana', ['vip'], { db }), /não é um cargo de interesse/);
  await interestRoles.setMine('ana', ['mine'], { db });
  assert.ok(db._store.userRole.some((r) => r.userId === 'ana' && r.roleId === 'mine'));
  await interestRoles.setMine('ana', [], { db });
  assert.ok(!db._store.userRole.some((r) => r.roleId === 'mine'));
  assert.ok(db._store.userRole.some((r) => r.roleId === 'vip'), 'cargos normais nunca são tirados');

  const authz = { requireCommunityPermission: async () => true, getRoleCeiling: async () => 5 };
  await assert.rejects(interestRoles.setFlag('staff', 'mod', true, { db, authz }), /abaixo/);
  db._store.role.find((r) => r.id === 'mod').position = 4;
  await assert.rejects(interestRoles.setFlag('staff', 'mod', true, { db, authz }), /sem nenhuma permissão/);
  await assert.rejects(interestRoles.setFlag('staff', 'todos', true, { db, authz }), /@todos/);
  const vip = await interestRoles.setFlag('staff', 'vip', true, { db, authz });
  assert.equal(vip.selfAssignable, true);
  const noPerm = { ...authz, requireCommunityPermission: async () => { const e = new Error('Sem permissão'); e.status = 403; throw e; } };
  await assert.rejects(interestRoles.setFlag('alguem', 'vip', false, { db, authz: noPerm }), /Sem permissão/);
});
