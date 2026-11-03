// Fase 8 — Praça virtual 2D (services/plaza.js + sockets/plaza.js).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/services/plaza');
const { createPlaza } = require('../src/sockets/plaza');

test('movimento fica dentro do mapa e anda no máximo MAX_STEP', () => {
  assert.deepEqual(P.validateMove({ x: 10, y: 10 }, { x: -50, y: 5 }), { x: 0, y: 5 });
  assert.deepEqual(P.validateMove({ x: P.MAP_W, y: P.MAP_H }, { x: P.MAP_W + 30, y: P.MAP_H + 1 }), { x: P.MAP_W, y: P.MAP_H });
  const far = P.validateMove({ x: 100, y: 100 }, { x: 1100, y: 100 });
  assert.deepEqual(far, { x: 100 + P.MAX_STEP, y: 100 });
  assert.equal(P.validateMove({ x: 0, y: 0 }, { x: 'abc', y: 1 }), null);
  assert.equal(P.validateMove({ x: 0, y: 0 }, { x: Infinity, y: 1 }), null);
});

test('balde de fichas limita ~15 movimentos por segundo', () => {
  const t0 = 1_000_000;
  const b = P.makeMoveBucket(t0);
  let ok = 0;
  for (let i = 0; i < 40; i += 1) if (P.takeToken(b, t0)) ok += 1;
  assert.equal(ok, P.MOVE_BURST);
  assert.equal(P.takeToken(b, t0 + 30), false); // 30 ms ainda não repõe uma ficha inteira
  assert.equal(P.takeToken(b, t0 + 1000), true); // 1 s depois volta a andar
  const chat = P.makeChatBucket(t0);
  assert.equal([1, 2, 3, 4].filter(() => P.takeToken(chat, t0)).length, P.CHAT_BURST);
  assert.equal(P.takeToken(chat, t0 + P.CHAT_REFILL_MS), true);
});

test('fala é limpa e cortada em 120 caracteres', () => {
  assert.equal(P.sanitizeChat('  oi​\n\n  gente\u0007 '), 'oi gente');
  assert.equal(P.sanitizeChat('   '), null);
  assert.equal(P.sanitizeChat('x'.repeat(500)).length, P.CHAT_MAX);
  assert.equal(P.sanitizeChat('<script>alert(1)</script>'), '<script>alert(1)</script>'); // o cliente mostra como texto
});

test('conversa por proximidade: só quem está perto ouve', () => {
  const speaker = { userId: 'a', x: 100, y: 100 };
  const members = [speaker, { userId: 'b', x: 100 + P.PROXIMITY_RADIUS - 1, y: 100 }, { userId: 'c', x: 100 + P.PROXIMITY_RADIUS + 50, y: 100 }];
  assert.deepEqual(P.listenersFor(speaker, members).map((m) => m.userId), ['a', 'b']);
  assert.equal(P.zoneAt({ x: 1200, y: 700 }).id, 'palco');
  assert.equal(P.zoneAt({ x: 600, y: 300 }), null);
});

test('salas: até 50 por praça, abre Praça 2 quando lota', () => {
  assert.equal(P.pickRoom(new Map()), '1');
  assert.equal(P.pickRoom(new Map([['1', P.ROOM_CAP]])), '2');
  assert.equal(P.pickRoom(new Map([['1', 3]]), '2'), '2');
  assert.equal(P.pickRoom(new Map([['1', 3], ['2', P.ROOM_CAP]]), '2'), '1');
  assert.equal(P.pickRoom(new Map([['1', 3]]), '999'), '1');
  const full = new Map(Array.from({ length: P.MAX_ROOMS }, (_, i) => [String(i + 1), P.ROOM_CAP]));
  assert.equal(P.pickRoom(full), null);
  assert.equal(P.roomLabel('1'), 'Praça');
  assert.equal(P.roomLabel('3'), 'Praça 3');
});

// io/socket falsos.
function fakeIo() {
  const sent = [];
  const sockets = new Map();
  return {
    sent, sockets: { sockets },
    to: (target) => ({ emit: (ev, data) => sent.push({ target, ev, data }) }),
  };
}
function fakeSocket(io, id) {
  const s = {
    id, connected: true, rooms: new Set(), handlers: {}, emitted: [],
    join: (r) => s.rooms.add(r), leave: (r) => s.rooms.delete(r),
    emit: (ev, data) => s.emitted.push({ ev, data }),
    to: (target) => ({ emit: (ev, data) => io.sent.push({ target, ev, data, except: id }) }),
    on: (ev, fn) => { s.handlers[ev] = fn; },
  };
  io.sockets.sockets.set(id, s);
  return s;
}

test('socket: entrar, andar com limite, falar perto e sair no disconnect', async () => {
  let t = 5_000_000;
  const moderated = [];
  const plaza = createPlaza({
    loadProfile: async (uid) => ({ displayName: uid }),
    moderate: async (uid, text) => { moderated.push(text); return text.includes('proibido') ? { ok: false, reason: 'bloqueado' } : { ok: true }; },
    voiceChannel: async () => null,
    now: () => t,
  });
  const io = fakeIo();
  const sa = fakeSocket(io, 'sa');
  const sb = fakeSocket(io, 'sb');
  const sc = fakeSocket(io, 'sc');
  await plaza.join(io, sa, 'ana');
  await plaza.join(io, sb, 'bia');
  await plaza.join(io, sc, 'caio');
  const state = sa.emitted.find((e) => e.ev === 'plaza:state').data;
  assert.equal(state.room, '1');
  assert.equal(state.map.w, P.MAP_W);

  const { rooms } = plaza._state;
  const members = rooms.get('1');
  Object.assign(members.get('ana'), { x: 100, y: 100 });
  Object.assign(members.get('bia'), { x: 150, y: 120 });
  Object.assign(members.get('caio'), { x: 1500, y: 900 });

  // Rajada de movimentos: só MOVE_BURST passam.
  let ok = 0;
  for (let i = 0; i < 30; i += 1) if (plaza.move(io, sa, 'ana', { x: 9999, y: 100, dir: 'right' })) ok += 1;
  assert.equal(ok, P.MOVE_BURST);
  assert.ok(members.get('ana').x <= P.MAP_W);
  // Socket errado (outra conexão) não move ninguém.
  assert.equal(plaza.move(io, sb, 'ana', { x: 0, y: 0 }), false);

  Object.assign(members.get('ana'), { x: 100, y: 100 });
  t += 1000;
  assert.equal(await plaza.say(io, sa, 'ana', { text: '  olá praça  ' }), true);
  const bubbles = io.sent.filter((s) => s.ev === 'plaza:bubble');
  assert.deepEqual(bubbles.map((b) => b.target).sort(), ['sa', 'sb']); // caio está longe
  assert.equal(bubbles[0].data.text, 'olá praça');
  assert.equal(await plaza.say(io, sa, 'ana', { text: 'algo proibido' }), false);
  assert.equal(sa.emitted.at(-1).ev, 'plaza:error');

  // Snapshot só das salas que mudaram.
  plaza.move(io, sb, 'bia', { x: 160, y: 120 });
  plaza.flush(io);
  const snap = io.sent.filter((s) => s.ev === 'plaza:snapshot').at(-1);
  assert.equal(snap.target, 'plaza:1');
  assert.equal(snap.data.p.length, 3);

  // Abriu em outra aba: a antiga recebe "replaced" e a vaga fica com a nova.
  const sa2 = fakeSocket(io, 'sa2');
  await plaza.join(io, sa2, 'ana');
  assert.ok(io.sent.some((s) => s.ev === 'plaza:replaced' && s.target === 'sa'));
  assert.equal(plaza.leave(io, 'ana', sa), false); // desconectar a aba velha não derruba a nova
  assert.equal(rooms.get('1').get('ana').socketId, 'sa2');

  plaza.register(io, sb, 'bia');
  sb.handlers.disconnect();
  assert.equal(rooms.get('1').has('bia'), false);
  assert.ok(io.sent.some((s) => s.ev === 'plaza:member-left' && s.data.userId === 'bia'));
});

test('socket: praça lotada manda a pessoa pra Praça 2', async () => {
  const plaza = createPlaza({ loadProfile: async (uid) => ({ displayName: uid }), moderate: async () => ({ ok: true }), voiceChannel: async () => null });
  const io = fakeIo();
  for (let i = 0; i < P.ROOM_CAP; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await plaza.join(io, fakeSocket(io, `s${i}`), `u${i}`);
  }
  const extra = fakeSocket(io, 'sx');
  assert.equal(await plaza.join(io, extra, 'ux'), '2');
  assert.equal(plaza.roomList().length, 2);
  assert.equal(plaza.roomList()[0].count, P.ROOM_CAP);
});
