// Parte 5 ("ideias da pesquisa"): denúncia rápida com categorias, duplicar
// cargo e fixar conversas. Sem banco: prisma e authz são trocados por
// versões falsas em memória (mesmo esquema de perf2.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const src = (p) => path.resolve(__dirname, '../src', p);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };
const fresh = (rel) => { delete require.cache[src(rel)]; return require(src(rel)); };

// Chama um handler express e devolve { status, body } (ou o erro do next).
function call(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    handler({ app: { get: () => null }, body: {}, params: {}, ...req }, res, reject);
  });
}

// ---------- denúncia rápida ----------
test('parseReportInput: só aceita as categorias da lista, detalhes opcionais com limite', () => {
  stub('controllers/messageController.js', { assertAccess: async () => {} });
  stub('config/prisma.js', {});
  const { parseReportInput, REPORT_CATEGORIES } = fresh('controllers/reportController.js');

  assert.deepEqual(Object.keys(REPORT_CATEGORIES), ['spam', 'harassment', 'nsfw', 'scam', 'impersonation', 'other']);
  assert.deepEqual(parseReportInput({ category: 'spam' }), { category: 'spam', reason: 'Spam' });
  assert.deepEqual(parseReportInput({ category: 'scam', details: '  link  falso ' }), { category: 'scam', reason: 'Golpe ou phishing: link falso' });
  assert.ok(parseReportInput({ category: 'qualquer' }).error);
  assert.ok(parseReportInput({ category: '__proto__' }).error);
  assert.ok(parseReportInput({ category: ['spam'] }).error);
  assert.ok(parseReportInput({}).error);
  assert.ok(parseReportInput({ category: 'other' }).error); // "Outro" precisa de detalhes
  assert.ok(parseReportInput({ category: 'spam', details: 'x'.repeat(501) }).error);
  assert.ok(parseReportInput({ category: 'spam', details: 42 }).error);
  // Clientes antigos: texto livre vira "Outro"; rótulo antigo vira a categoria certa.
  assert.deepEqual(parseReportInput({ reason: 'me xingou' }), { category: 'other', reason: 'Outro: me xingou' });
  assert.equal(parseReportInput({ reason: 'Assédio ou bullying' }).category, 'harassment');
});

test('createProfileReport grava a categoria e não deixa denunciar o próprio perfil', async () => {
  const created = [];
  stub('controllers/messageController.js', { assertAccess: async () => {} });
  stub('config/prisma.js', {
    user: { findUnique: async () => ({ id: 'u2', username: 'ana', displayName: 'Ana', bio: '', pronouns: null }) },
    report: {
      findFirst: async () => null,
      create: async ({ data }) => { created.push(data); return { id: 'r1', status: 'PENDING', ...data }; },
    },
  });
  const { createProfileReport } = fresh('controllers/reportController.js');
  const self = await call(createProfileReport, { user: { id: 'u1' }, params: { id: 'u1' }, body: { category: 'spam' } });
  assert.equal(self.status, 400);
  const bad = await call(createProfileReport, { user: { id: 'u1' }, params: { id: 'u2' }, body: { category: 'hack' } });
  assert.equal(bad.status, 400);
  const ok = await call(createProfileReport, { user: { id: 'u1' }, params: { id: 'u2' }, body: { category: 'impersonation', details: 'usa minha foto' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { report: { id: 'r1', status: 'PENDING' } });
  assert.equal(created.length, 1);
  assert.equal(created[0].category, 'impersonation');
  assert.equal(created[0].reason, 'Se passando por alguém: usa minha foto');
});

// ---------- duplicar cargo ----------
function roleWorld({ callerBits, ceiling }) {
  const roles = [
    { id: 'everyone', name: '@todos', isDefault: true, position: 0, permissions: '0', color: '#99AAB5', icon: null, hoist: false, mentionable: true },
    { id: 'mod', name: 'Moderador', isDefault: false, position: 1, permissions: String((1n << 2n) | (1n << 0n)), color: '#e91e63', icon: '🛡️', hoist: true, mentionable: false },
    { id: 'admin', name: 'Admin', isDefault: false, position: 2, permissions: String(1n << 3n), color: '#3498db', icon: null, hoist: true, mentionable: true },
    { id: 'top', name: 'Dono', isDefault: false, position: 3, permissions: '8', color: '#fff', icon: null, hoist: true, mentionable: true },
  ];
  const emitted = [];
  const tx = {
    role: {
      updateMany: async ({ where, data }) => {
        roles.forEach((r) => { if (!r.isDefault && r.position >= where.position.gte) r.position += data.position.increment; });
      },
      create: async ({ data }) => { const r = { id: 'copy', isDefault: false, ...data }; roles.push(r); return r; },
    },
  };
  stub('config/prisma.js', {
    role: {
      findUnique: async ({ where }) => roles.find((r) => r.id === where.id) || null,
      findMany: async () => [...roles].sort((a, b) => b.position - a.position),
    },
    $transaction: async (fn) => fn(tx),
  });
  stub('services/authz.js', {
    requireCommunityPermission: async () => {},
    getEffectivePermissions: async () => callerBits,
    getRoleCeiling: async () => ceiling,
  });
  const ctrl = fresh('controllers/roleController.js');
  const io = { to: () => ({ emit: (ev, payload) => emitted.push([ev, payload]) }) };
  const req = (id) => ({ user: { id: 'me' }, params: { id }, app: { get: () => io } });
  return { roles, emitted, ctrl, req };
}

test('duplicateRole copia tudo e coloca a cópia logo abaixo do original', async () => {
  const { roles, emitted, ctrl, req } = roleWorld({ callerBits: (1n << 0n) | (1n << 2n) | (1n << 4n), ceiling: 2 });
  const r = await call(ctrl.duplicateRole, req('mod'));
  assert.equal(r.status, 201);
  const copy = r.body.role;
  assert.equal(copy.name, 'Moderador (cópia)');
  assert.equal(copy.color, '#e91e63');
  assert.equal(copy.icon, '🛡️');
  assert.equal(copy.hoist, true);
  assert.equal(copy.mentionable, false);
  assert.equal(copy.permissions, roles.find((x) => x.id === 'mod').permissions);
  const order = [...roles].filter((x) => !x.isDefault).sort((a, b) => b.position - a.position).map((x) => x.id);
  assert.deepEqual(order, ['top', 'admin', 'mod', 'copy']);
  assert.deepEqual(emitted.map(([ev]) => ev), ['role:reorder', 'role:new']);
  assert.deepEqual(emitted[0][1].order, order);
});

test('duplicateRole respeita hierarquia, @todos e permissões de quem chama', async () => {
  // Cargo no nível do seu cargo mais alto (ou acima): bloqueado.
  let w = roleWorld({ callerBits: 0xffn, ceiling: 2 });
  assert.equal((await call(w.ctrl.duplicateRole, w.req('admin'))).status, 403);
  // @todos não duplica.
  w = roleWorld({ callerBits: 0xffn, ceiling: 9 });
  assert.equal((await call(w.ctrl.duplicateRole, w.req('everyone'))).status, 400);
  // Cargo com permissão que quem duplica não tem (MANAGE_MESSAGES): bloqueado.
  w = roleWorld({ callerBits: (1n << 0n) | (1n << 4n), ceiling: 9 });
  const denied = await call(w.ctrl.duplicateRole, w.req('mod'));
  assert.equal(denied.status, 403);
  assert.equal(w.roles.length, 4); // nada criado
  // Inexistente.
  assert.equal((await call(w.ctrl.duplicateRole, w.req('nope'))).status, 404);
});

test('copyName nunca passa de 100 caracteres', () => {
  const { ctrl } = roleWorld({ callerBits: 0n, ceiling: 0 });
  const long = ctrl.copyName('x'.repeat(100));
  assert.equal(long.length, 100);
  assert.ok(long.endsWith(' (cópia)'));
});

// ---------- fixar conversa ----------
test('setPinned: fixa/desafixa só a própria conversa, no máximo 10', async () => {
  const rows = { m1: { id: 'm1', pinnedAt: null } };
  let pinnedCount = 0;
  const updates = [];
  stub('config/prisma.js', {
    conversationMember: {
      findUnique: async ({ where }) => (where.conversationId_userId.conversationId === 'c1' && where.conversationId_userId.userId === 'u1' ? rows.m1 : null),
      count: async () => pinnedCount,
      update: async ({ where, data }) => { updates.push(data); Object.assign(rows[where.id], data); return rows[where.id]; },
    },
  });
  for (const rel of ['controllers/authController.js', 'services/dmPermissions.js', 'utils/presenceVisibility.js']) {
    stub(rel, new Proxy({ PUBLIC_USER_FIELDS: {}, DM_DENIAL_MESSAGES: {} }, { get: (t, k) => (k in t ? t[k] : () => {}) }));
  }
  const { setPinned, MAX_PINNED_CONVERSATIONS } = fresh('controllers/conversationController.js');
  assert.equal(MAX_PINNED_CONVERSATIONS, 10);

  assert.equal((await call(setPinned, { user: { id: 'u1' }, params: { id: 'c1' }, body: { pinned: 'sim' } })).status, 400);
  assert.equal((await call(setPinned, { user: { id: 'u2' }, params: { id: 'c1' }, body: { pinned: true } })).status, 404);

  pinnedCount = 10;
  assert.equal((await call(setPinned, { user: { id: 'u1' }, params: { id: 'c1' }, body: { pinned: true } })).status, 400);
  assert.equal(updates.length, 0);

  pinnedCount = 3;
  const on = await call(setPinned, { user: { id: 'u1' }, params: { id: 'c1' }, body: { pinned: true } });
  assert.equal(on.status, 200);
  assert.ok(on.body.pinnedAt instanceof Date);
  const off = await call(setPinned, { user: { id: 'u1' }, params: { id: 'c1' }, body: { pinned: false } });
  assert.equal(off.body.pinnedAt, null);
  assert.equal(updates.length, 2);
});
