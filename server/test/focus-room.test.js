// Sala de estudos (sockets/focusRoom.js).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// voiceRoomStore falso (o de verdade abre conexão com o Redis).
const fakeStore = { getRoom: async () => ({}), roomSize: async () => 0, hasParticipant: async () => true };
const storePath = path.resolve(__dirname, '../src/services/voiceRoomStore.js');
require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: fakeStore };

test('minutos de foco e pausa ficam dentro do limite', () => {
  const fr = require('../src/sockets/focusRoom');
  assert.deepEqual(fr.clampMinutes(1, 0), [5, 5]);
  assert.deepEqual(fr.clampMinutes(500, 99), [90, 30]);
  assert.deepEqual(fr.clampMinutes(40, 8), [40, 8]);
  assert.deepEqual(fr.PRESETS['25-5'], [25, 5]);
  assert.equal(fr.dayKey(new Date(Date.UTC(2026, 10, 3, 2))), '2026-11-02'); // 23h em Brasília
});

test('fim do foco: credita os minutos de quem está na sala e vira pausa', async () => {
  const voiceStore = fakeStore;
  const orig = { getRoom: voiceStore.getRoom, roomSize: voiceStore.roomSize };
  voiceStore.getRoom = async () => ({ ana: { socketId: 's1' }, bia: { socketId: 's2' } });
  voiceStore.roomSize = async () => 2;
  try {
    const fr = require('../src/sockets/focusRoom');
    const { rooms, advance, stop, creditFocus } = fr._test();
    const ups = [];
    const prisma = { focusDay: { upsert: async (q) => { ups.push(q); return q; } } };
    const got = await creditFocus('c1', 25, { prisma });
    assert.deepEqual(got.sort(), ['ana', 'bia']);
    assert.equal(ups[0].create.minutes, 25);
    assert.deepEqual(ups[0].update.minutes, { increment: 25 });

    const events = [];
    const io = { to: () => ({ emit: (e, d) => events.push([e, d]) }), sockets: { sockets: { has: () => true } } };
    rooms.set('c2', { phase: 'break', endsAt: Date.now(), focusMin: 25, breakMin: 5, round: 1, startedBy: 'ana', timer: null });
    await advance(io, 'c2');
    assert.equal(rooms.get('c2').phase, 'focus');
    assert.equal(rooms.get('c2').round, 2);
    assert.equal(events.at(-1)[0], 'focus:state');
    voiceStore.roomSize = async () => 0; // sala vazia → para sozinho
    await advance(io, 'c2');
    assert.equal(rooms.has('c2'), false);
    assert.equal(events.at(-1)[1].state, null);
    stop(io, 'c2');
  } finally { Object.assign(voiceStore, orig); }
});
