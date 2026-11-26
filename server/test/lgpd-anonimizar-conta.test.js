// LGPD: anonimizar a conta (já excluída) de quem pediu a remoção dos dados.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { anonymizeUser, ERASED_NAME } = require('../src/services/accountErasure');

function fakeDb(user) {
  const calls = [];
  const tbl = (name) => new Proxy({}, { get: (_, op) => (args) => { calls.push([name, op, args]); return { count: 1 }; } });
  const db = {
    calls,
    user: {
      findUnique: async () => user,
      update: (args) => { calls.push(['user', 'update', args]); return args; },
    },
    $transaction: async (ops) => ops,
  };
  for (const t of ['refreshToken', 'pushToken', 'passkey', 'oAuthAccount', 'twoFactorRecoveryCode', 'passwordResetToken', 'emailVerificationCode', 'accountSwitchToken', 'membershipApplication']) db[t] = tbl(t);
  return db;
}
const deps = (db, extra = {}) => ({ prisma: db, logAction: async (io, e) => { db.calls.push(['audit', e.action, e]); }, markSessionsRevoked: async () => { db.calls.push(['revoked']); }, ...extra });

test('conta excluída: apaga os dados pessoais, derruba sessões e registra na auditoria', async () => {
  const db = fakeDb({ id: 'u1', email: 'ana@x.com', username: 'ana', accountDisabledAt: new Date(), platformRole: 'USER' });
  const out = await anonymizeUser('u1', { actorId: 'staff1' }, deps(db));
  assert.equal(out.ok, true);
  const upd = db.calls.find((c) => c[0] === 'user' && c[1] === 'update')[2].data;
  assert.equal(upd.displayName, ERASED_NAME);
  assert.match(upd.email, /@conta-excluida\.invalid$/);
  assert.ok(!upd.email.includes('ana'));
  for (const k of ['avatarUrl', 'bio', 'birthDate', 'twoFactorSecret', 'bannerUrl', 'youtubeUrl']) assert.equal(upd[k], null, k);
  assert.match(upd.passwordHash, /^\$2[aby]\$/);
  for (const t of ['refreshToken', 'pushToken', 'passkey', 'oAuthAccount', 'twoFactorRecoveryCode']) {
    assert.ok(db.calls.some((c) => c[0] === t && c[1] === 'deleteMany' && c[2].where.userId === 'u1'), t);
  }
  const app = db.calls.find((c) => c[0] === 'membershipApplication');
  assert.equal(app[2].where.status, 'APPROVED');
  assert.equal(app[2].data.birthDate, null);
  assert.ok(db.calls.some((c) => c[0] === 'revoked'));
  assert.ok(db.calls.some((c) => c[0] === 'audit' && c[1] === 'USER_ANONYMIZED' && c[2].actorId === 'staff1'));
});

test('conta ativa, admin ou já anonimizada: recusa sem mexer em nada', async () => {
  for (const user of [
    { id: 'u2', email: 'b@x.com', username: 'b', accountDisabledAt: null, platformRole: 'USER' },
    { id: 'u3', email: 'c@x.com', username: 'c', accountDisabledAt: new Date(), platformRole: 'ADMIN' },
    { id: 'u4', email: 'excluido+ab@conta-excluida.invalid', username: 'excluido_ab', accountDisabledAt: new Date(), platformRole: 'USER' },
  ]) {
    const db = fakeDb(user);
    await assert.rejects(anonymizeUser(user.id, { actorId: 's' }, deps(db)), (e) => e.status === 409);
    assert.equal(db.calls.length, 0, user.id);
  }
  await assert.rejects(anonymizeUser('x', { actorId: 's' }, deps(fakeDb(null))), (e) => e.status === 404);
});
