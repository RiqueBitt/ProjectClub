// Canal AFK: quem é considerado parado, validação da configuração e uma
// rodada completa da varredura com dependências falsas (sem banco/Redis).
const test = require('node:test');
const assert = require('node:assert/strict');
const afk = require('../src/services/voiceAfk');

const NOW = 10_000_000;
const min = (n) => n * 60 * 1000;

test('normalizeTimeout aceita só 1/5/15/30/60 min', () => {
  assert.equal(afk.normalizeTimeout(60), 60);
  assert.equal(afk.normalizeTimeout('3600'), 3600);
  assert.equal(afk.normalizeTimeout(42), afk.DEFAULT_AFK_TIMEOUT);
  assert.equal(afk.normalizeTimeout(undefined), 300);
});

test('pickIdle: usa o maior entre lastActiveAt e joinedAt', () => {
  const rooms = {
    v1: {
      parado: { joinedAt: NOW - min(20), lastActiveAt: NOW - min(6) },
      falou: { joinedAt: NOW - min(20), lastActiveAt: NOW - min(1) },
      entrouAgora: { joinedAt: NOW - min(1) },
      tela: { joinedAt: NOW - min(30), screenSharing: true },
      camera: { joinedAt: NOW - min(30), video: true },
      semMarca: {},
    },
  };
  const r = afk.pickIdle({ rooms, afkChannelId: 'afk', timeoutSeconds: 300, now: NOW, channelTypes: { v1: 'VOICE' } });
  assert.deepEqual(r.map((x) => x.userId), ['parado']);
  assert.equal(r[0].fromChannelId, 'v1');
});

test('pickIdle: ignora canal AFK, palco, DM, clã e AFK desligado', () => {
  const old = { joinedAt: NOW - min(90) };
  const rooms = { afk: { a: old }, st: { b: old }, 'dm:x': { c: old }, 'clan:y': { d: old }, v: { e: old } };
  const types = { afk: 'VOICE', st: 'STAGE', v: 'VOICE' };
  assert.deepEqual(afk.pickIdle({ rooms, afkChannelId: 'afk', timeoutSeconds: 3600, now: NOW, channelTypes: types }).map((x) => x.userId), ['e']);
  assert.deepEqual(afk.pickIdle({ rooms, afkChannelId: null, timeoutSeconds: 60, now: NOW, channelTypes: types }), []);
});

test('pickIdle: exatamente no limite já move; 1 ms antes não', () => {
  const rooms = { v: { a: { joinedAt: NOW - min(1) }, b: { joinedAt: NOW - min(1) + 1 } } };
  assert.deepEqual(afk.pickIdle({ rooms, afkChannelId: 'afk', timeoutSeconds: 60, now: NOW, channelTypes: { v: 'VOICE' } }).map((x) => x.userId), ['a']);
});

test('validateAfkPatch', async () => {
  const prisma = { channel: { findUnique: async ({ where }) => ({ v1: { id: 'v1', type: 'VOICE' }, t1: { id: 't1', type: 'TEXT' } })[where.id] || null } };
  assert.deepEqual(await afk.validateAfkPatch({ afkChannelId: 'v1', afkTimeoutSeconds: 900 }, { prisma }), { data: { afkChannelId: 'v1', afkTimeoutSeconds: 900 } });
  assert.deepEqual(await afk.validateAfkPatch({ afkChannelId: null }, { prisma }), { data: { afkChannelId: null } });
  assert.ok((await afk.validateAfkPatch({ afkChannelId: 't1' }, { prisma })).error);
  assert.ok((await afk.validateAfkPatch({ afkChannelId: 'nada' }, { prisma })).error);
  assert.ok((await afk.validateAfkPatch({ afkTimeoutSeconds: 120 }, { prisma })).error);
  assert.deepEqual(await afk.validateAfkPatch({ communityName: 'x' }, { prisma }), { data: {} });
});

function fakeDeps({ lockFree = true, connect = true, settings = { afkChannelId: 'afk', afkTimeoutSeconds: 300 } } = {}) {
  const moves = [];
  const rooms = {
    v1: { u1: { joinedAt: NOW - min(10), lastActiveAt: NOW - min(9) }, u2: { joinedAt: NOW - min(10), lastActiveAt: NOW - 1000 } },
    afk: { u3: { joinedAt: NOW - min(99) } },
  };
  return {
    moves,
    prisma: {
      platformSettings: { findUnique: async () => settings },
      channel: { findMany: async ({ where }) => where.id.in.map((id) => ({ id, type: 'VOICE', name: id === 'afk' ? 'AFK' : id })) },
    },
    redis: { set: async () => (lockFree ? 'OK' : null) },
    voiceStore: { getActiveRoomIds: async () => Object.keys(rooms), getRoom: async (id) => rooms[id] },
    getEffectivePermissions: async () => (connect ? 1n : 0n),
    has: (p) => p === 1n,
    moveToAfk: async (userId, from, ch) => { moves.push([userId, from, ch.id]); },
  };
}

test('runAfkSweep: move só quem está parado e pode entrar no AFK', async () => {
  afk.invalidateAfkSettings();
  const d = fakeDeps();
  const moved = await afk.runAfkSweep(d, NOW);
  assert.deepEqual(d.moves, [['u1', 'v1', 'afk']]);
  assert.equal(moved.length, 1);
});

test('runAfkSweep: trava ocupada (outra instância) não faz nada', async () => {
  afk.invalidateAfkSettings();
  const d = fakeDeps({ lockFree: false });
  assert.deepEqual(await afk.runAfkSweep(d, NOW), []);
  assert.deepEqual(d.moves, []);
});

test('runAfkSweep: sem CONNECT no canal AFK fica onde está', async () => {
  afk.invalidateAfkSettings();
  const d = fakeDeps({ connect: false });
  await afk.runAfkSweep(d, NOW);
  assert.deepEqual(d.moves, []);
});

test('runAfkSweep: AFK desligado', async () => {
  afk.invalidateAfkSettings();
  const d = fakeDeps({ settings: { afkChannelId: null, afkTimeoutSeconds: 300 } });
  assert.deepEqual(await afk.runAfkSweep(d, NOW), []);
  afk.invalidateAfkSettings();
});
