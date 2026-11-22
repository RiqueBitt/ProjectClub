// Fase 4: indicação de amigos, reputação ("Agradecer") e cargos por interesse.
const test = require('node:test');
const assert = require('node:assert');
const { fase4Db, spies } = require('./helpers/fake-db');
const common = require('../src/services/community/common');
const reputation = require('../src/services/community/reputation');
const secrets = require('../src/services/community/secretAchievements');

const NOW = new Date('2026-11-02T18:00:00Z');
const DAY = 86400000;
const reset = () => { common._resetSettled(); common.resetEconomyCache(); secrets._reset(); };
const coinsOf = (db, id) => db._store.user.find((u) => u.id === id).coins;

// ---------------- Indicação ----------------
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
