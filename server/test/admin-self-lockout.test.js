const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Admin não consegue banir, suspender nem rebaixar a própria conta
// (controllers/adminController.js). Com outra conta, segue funcionando.
const src = (p) => path.resolve(__dirname, '../src', p);
function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const writes = [];
const rec = (name) => async (args) => { writes.push(name); return { id: args?.where?.id }; };
stub('config/prisma.js', {
  user: { update: rec('user.update'), findUnique: async () => ({ id: 'outro', platformRole: 'USER' }) },
  refreshToken: { updateMany: rec('refreshToken.updateMany') },
  platformAuditLog: { create: rec('audit') },
  badge: { findUnique: async () => null },
});
stub('services/sessionKeep.js', { markSessionsRevoked: async () => {} });
stub('controllers/authController.js', { SELF_USER_FIELDS: {} });
stub('services/presenceStore.js', {});
stub('services/voiceRoomStore.js', {});
stub('services/errorRing.js', { recentErrors: () => [], errorStats: () => ({}) });
const ctrl = require(src('controllers/adminController.js'));

function call(fn, { id, body = {} }) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    const req = { params: { id }, body, user: { id: 'eu', platformRole: 'ADMIN' }, app: { get: () => null } };
    Promise.resolve(fn(req, res, (err) => (err ? reject(err) : resolve({ status: 'next' })))).catch(reject);
  });
}

for (const [nome, fn, body] of [
  ['banir', 'banUser', { reason: 'x' }],
  ['suspender', 'suspendUser', { hours: 1 }],
  ['rebaixar para USER', 'setPlatformRole', { role: 'USER' }],
  ['rebaixar para MODERATOR', 'setPlatformRole', { role: 'MODERATOR' }],
]) {
  test(`admin não consegue ${nome} a própria conta`, async () => {
    writes.length = 0;
    const r = await call(ctrl[fn], { id: 'eu', body });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(writes, [], 'nada pode ser gravado');
  });
}

test('admin continua conseguindo banir outra conta', async () => {
  writes.length = 0;
  await call(ctrl.banUser, { id: 'outro', body: { reason: 'spam' } });
  assert.ok(writes.includes('user.update'));
});

test('admin continua conseguindo mudar o cargo de outra conta', async () => {
  writes.length = 0;
  await call(ctrl.setPlatformRole, { id: 'outro', body: { role: 'MODERATOR' } });
  assert.ok(writes.includes('user.update'));
});
