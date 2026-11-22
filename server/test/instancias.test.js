const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Instâncias: quem entra em cada uma (services/instances.js) e o bloqueio
// dos canais delas na checagem de permissão (services/authz.js).
const src = (p) => path.resolve(__dirname, '../src', p);
function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const prefs = new Map();
const fakePrisma = {
  instance: { findMany: async () => [{ id: 'amigos', name: 'Amigos' }, { id: 'empresarial', name: 'Empresarial' }] },
  instanceMember: { findMany: async () => [{ instanceId: 'amigos', userId: 'ana' }] },
  userInstancePref: {
    findUnique: async ({ where }) => (prefs.has(where.userId) ? { userId: where.userId, instanceId: prefs.get(where.userId) } : null),
    upsert: async ({ where, create }) => { prefs.set(where.userId, create.instanceId); },
    deleteMany: async ({ where }) => { prefs.delete(where.userId); },
  },
  user: { findUnique: async ({ where }) => ({ id: where.userId || where.id, platformRole: where.id === 'adm' ? 'ADMIN' : 'USER' }) },
  userRole: { findMany: async () => [] },
  role: { findFirst: async () => ({ id: 'everyone', isDefault: true, permissions: '1099511627775' }) },
  permissionOverwrite: { findMany: async () => [] },
  channel: { findUnique: async ({ where }) => ({ id: where.id, instanceId: where.id === 'c-amg' ? 'amigos' : null, categoryId: null }) },
};
stub('config/prisma.js', fakePrisma);
delete require.cache[src('services/instances.js')];
delete require.cache[src('services/authz.js')];
const inst = require(src('services/instances.js'));
const { getEffectivePermissions } = require(src('services/authz.js'));

const ana = { id: 'ana', platformRole: 'USER' };
const bia = { id: 'bia', platformRole: 'USER' };
const adm = { id: 'adm', platformRole: 'ADMIN' };

test('Pública é de todo mundo; privadas só de quem foi liberado (e administradores)', async () => {
  assert.equal(await inst.canAccess(bia, null), true);
  assert.equal(await inst.canAccess(bia, 'publica'), true);
  assert.equal(await inst.canAccess(ana, 'amigos'), true);
  assert.equal(await inst.canAccess(bia, 'amigos'), false);
  assert.equal(await inst.canAccess(adm, 'empresarial'), true);
  assert.equal(await inst.canAccess(adm, 'nao-existe'), false);
  assert.deepEqual((await inst.listForUser(ana)).map((i) => i.id), ['publica', 'amigos']);
  assert.deepEqual((await inst.listForUser(bia)).map((i) => i.id), ['publica']);
  assert.deepEqual((await inst.listForUser(adm)).map((i) => i.id), ['publica', 'amigos', 'empresarial']);
});

test('trocar de instância: sem acesso dá 403; Pública apaga a escolha', async () => {
  assert.equal(await inst.setCurrent(ana, 'amigos'), 'amigos');
  assert.equal(await inst.currentFor(ana), 'amigos');
  await assert.rejects(inst.setCurrent(bia, 'amigos'), (e) => e.status === 403);
  assert.equal(await inst.setCurrent(ana, 'publica'), null);
  assert.equal(await inst.currentFor(ana), null);
});

test('canal de instância privada: sem acesso, nenhuma permissão', async () => {
  assert.equal(await getEffectivePermissions('bia', 'c-amg'), 0n);
  assert.notEqual(await getEffectivePermissions('ana', 'c-amg'), 0n);
  assert.notEqual(await getEffectivePermissions('bia', 'c-pub'), 0n);
});

test('slug de instância nova', () => {
  assert.equal(inst.slugify('Time de Criação!'), 'time-de-criacao');
  assert.equal(inst.normalizeId(' Publica '), null);
});
