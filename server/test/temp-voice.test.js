// Salas de voz temporárias (services/tempVoice.js).
const test = require('node:test');
const assert = require('node:assert');
const tv = require('../src/services/tempVoice');

function fakeDb() {
  const rows = [{ id: 'v1', type: 'VOICE', isPrivate: false, categoryId: 'cat-voz', tempOwnerId: null, position: 0 }];
  let seq = 0;
  const match = (r, w = {}) => Object.entries(w).every(([k, v]) => {
    if (v && typeof v === 'object' && 'not' in v) return r[k] !== v.not;
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k]);
    return r[k] === v;
  });
  return {
    rows,
    channel: {
      findFirst: async ({ where }) => rows.find((r) => match(r, where)) || null,
      findUnique: async ({ where }) => rows.find((r) => r.id === where.id) || null,
      findMany: async ({ where }) => rows.filter((r) => match(r, where)),
      count: async ({ where }) => rows.filter((r) => match(r, where)).length,
      create: async ({ data }) => { const r = { id: `t${++seq}`, ...data }; rows.push(r); return r; },
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
      delete: async ({ where }) => { rows.splice(rows.findIndex((r) => r.id === where.id), 1); },
      deleteMany: async ({ where }) => { const i = rows.findIndex((r) => match(r, where)); if (i < 0) return { count: 0 }; rows.splice(i, 1); return { count: 1 }; },
    },
  };
}
const ana = { id: 'ana', displayName: 'Ana' };

test('cria "Sala de Ana" na categoria de voz e não deixa criar duas', async () => {
  tv._resetForTests();
  const db = fakeDb();
  const events = [];
  const io = { to: () => ({ emit: (e, d) => events.push([e, d]) }) };
  const a = await tv.createRoom(ana, {}, { db, io });
  assert.equal(a.existed, false);
  assert.equal(a.channel.name, 'Sala de Ana');
  assert.equal(a.channel.categoryId, 'cat-voz');
  assert.equal(a.channel.type, 'VOICE');
  assert.deepEqual(events[0], ['channel:new', { id: a.channel.id }]);
  const b = await tv.createRoom(ana, { name: 'Outra' }, { db, io });
  assert.equal(b.existed, true);
  assert.equal(b.channel.id, a.channel.id);
});

test('só o dono renomeia/fecha; limite de pessoas fica entre 1 e 99', async () => {
  tv._resetForTests();
  const db = fakeDb();
  const { channel } = await tv.createRoom(ana, {}, { db });
  await assert.rejects(tv.updateRoom({ id: 'bia' }, channel.id, { name: 'x' }, { db }), (e) => e.status === 403);
  const up = await tv.updateRoom(ana, channel.id, { name: 'Jogatina', userLimit: 500 }, { db });
  assert.equal(up.name, 'Jogatina');
  assert.equal(up.userLimit, 99);
  await assert.rejects(tv.updateRoom(ana, 'v1', { name: 'x' }, { db }), (e) => e.status === 404); // canal normal
  await assert.rejects(tv.closeRoom({ id: 'bia' }, channel.id, { db }), (e) => e.status === 403);
  assert.equal(await tv.closeRoom(ana, channel.id, { db }), true);
});

test('vazia: espera o dono entrar, depois some 1 min após esvaziar', async () => {
  tv._resetForTests();
  const db = fakeDb();
  const { channel } = await tv.createRoom(ana, {}, { db });
  let size = 0;
  const roomSize = async () => size;
  const t0 = Date.now();
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t0 + 30_000 }), []); // recém-criada
  size = 2;
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t0 + tv.NEW_ROOM_GRACE_MS + 1000 }), []);
  size = 0;
  const t1 = t0 + tv.NEW_ROOM_GRACE_MS + 5000;
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t1 }), []); // começou a contar
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t1 + 30_000 }), []);
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t1 + tv.EMPTY_GRACE_MS + 1 }), [channel.id]);
  assert.equal(db.rows.some((r) => r.id === channel.id), false);
  assert.equal(db.rows.some((r) => r.id === 'v1'), true); // canal normal nunca é apagado
});

test('Redis fora do ar: não apaga nada', async () => {
  tv._resetForTests();
  const db = fakeDb();
  await tv.createRoom(ana, {}, { db });
  const roomSize = async () => { throw new Error('redis'); };
  const t = Date.now() + 10 * 60_000;
  await tv.sweep(null, { db, roomSize, now: t });
  assert.deepEqual(await tv.sweep(null, { db, roomSize, now: t + 5 * 60_000 }), []);
});
