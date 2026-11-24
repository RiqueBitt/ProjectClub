const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Call modo RPG (sockets/rpgTable.js): ficha do BLACKOUT, lugares e histórico.
const src = (p) => path.resolve(__dirname, '../src', p);
function stub(rel, exports) { const id = src(rel); require.cache[id] = { id, filename: id, loaded: true, exports }; }

const store = new Map();
const redis = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); return 'OK'; } };
let room = { ana: {}, bia: {}, caio: {} };
stub('config/redis.js', { redis });
stub('config/prisma.js', { channel: { findUnique: async ({ where }) => (where.id === 'mesa' ? { id: 'mesa', type: 'VOICE', rpgMode: true } : { id: where.id, type: 'VOICE', rpgMode: false }) } });
stub('services/voiceRoomStore.js', { getRoom: async () => room, hasParticipant: async (_c, u) => !!room[u] });
stub('services/authz.js', { getEffectivePermissions: async () => 0n });
stub('services/permissions.js', { has: () => false });
const rpg = require(src('sockets/rpgTable.js'));

function fakeSocket() {
  const handlers = {}; const sent = [];
  return { handlers, sent, on: (e, fn) => { handlers[e] = fn; }, emit: (e, p) => sent.push([e, p]) };
}
const io = { emitted: [], to() { return { emit: (e, p) => io.emitted.push([e, p]) }; } };
const call = (s, ev, payload) => new Promise((resolve) => s.handlers[ev](payload, resolve));

test('ficha: limites do BLACKOUT (PV ≤ máximo, estresse 0–6, PA 0–3, AR 0–1)', () => {
  const c = rpg.cleanChar(null, { name: '  Zé da Lua  ', pvMax: 12, pv: 50, stress: 9, pa: 7, ar: 3 });
  assert.deepStrictEqual(c, { name: 'Zé da Lua', pv: 12, pvMax: 12, stress: 6, pa: 3, ar: 1 });
  assert.deepStrictEqual(rpg.defaultChar(), { name: '', pv: 10, pvMax: 10, stress: 0, pa: 3, ar: 1 });
  assert.strictEqual(rpg.RPG_LIMIT, 5);
});

test('lugares: 1 mestre, 4 jogadores; ficha só a própria (ou o mestre)', async () => {
  const ana = fakeSocket(); const bia = fakeSocket(); const caio = fakeSocket();
  rpg.register(io, ana, 'ana'); rpg.register(io, bia, 'bia'); rpg.register(io, caio, 'caio');
  assert.ok((await call(ana, 'rpg:sit', { channelId: 'mesa', seat: 'master' })).ok);
  assert.match((await call(bia, 'rpg:sit', { channelId: 'mesa', seat: 'master' })).error, /já tem um mestre/);
  assert.ok((await call(bia, 'rpg:sit', { channelId: 'mesa', seat: 0 })).ok);
  assert.match((await call(caio, 'rpg:sit', { channelId: 'mesa', seat: 0 })).error, /ocupado/);
  assert.ok((await call(caio, 'rpg:sit', { channelId: 'mesa', seat: 2 })).ok);
  // Caio não mexe na ficha da Bia; o mestre (Ana) mexe.
  assert.match((await call(caio, 'rpg:char', { channelId: 'mesa', userId: 'bia', patch: { pv: 1 } })).error, /Só o mestre/);
  assert.ok((await call(ana, 'rpg:char', { channelId: 'mesa', userId: 'bia', patch: { pv: 4, stress: 2 } })).ok);
  assert.ok((await call(bia, 'rpg:char', { channelId: 'mesa', patch: { name: 'Raposa' } })).ok);
  const state = io.emitted.filter(([e]) => e === 'rpg:state').at(-1)[1];
  assert.strictEqual(state.master, 'ana');
  assert.deepStrictEqual(state.players, ['bia', null, 'caio', null]);
  assert.strictEqual(state.chars.bia.name, 'Raposa');
  assert.strictEqual(state.chars.bia.pv, 4);
  assert.strictEqual(state.chars.bia.stress, 2);
  // Canal sem modo RPG recusa.
  assert.match((await call(ana, 'rpg:get', { channelId: 'outro' })).error, /modo RPG/);
});

test('rolagem entra no histórico com o nome do personagem; quem saiu da call perde o lugar', async () => {
  await rpg.onRoll(io, 'mesa', { at: 1, user: { id: 'bia', displayName: 'Bia' }, notation: '2d6', total: 7, groups: [{ sides: 6, count: 2, results: [3, 4] }], modifier: 0 });
  const log = io.emitted.filter(([e]) => e === 'rpg:log').at(-1)[1].entry;
  assert.strictEqual(log.character, 'Raposa');
  assert.strictEqual(log.total, 7);
  room = { ana: {}, bia: {} }; // Caio saiu
  const s = fakeSocket(); rpg.register(io, s, 'ana');
  await call(s, 'rpg:get', { channelId: 'mesa' });
  const st = s.sent.find(([e]) => e === 'rpg:state')[1];
  assert.deepStrictEqual(st.players, ['bia', null, null, null]);
  assert.strictEqual(st.log.length, 1);
});
