'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createJukebox, parseVideoId, parseClock } = require('../src/services/waddle/jukebox');
const { parsePlayerResponse } = require('../src/services/youtubeBrowse');

function setup({ infoMap = {}, staff = [] } = {}) {
  let t = 1_000_000;
  const where = new Map(); // userId -> room
  const names = { a: 'Ana', b: 'Bia', c: 'Caio', d: 'Duda' };
  const sent = [];
  const timers = [];
  const jb = createJukebox({
    players: (room) => [...where].filter(([, r]) => r === room).map(([u]) => ({ userId: u, name: names[u] })),
    roomOfUser: (u) => (where.has(u) ? where.get(u) : null),
    emit: (u, ev, p) => sent.push({ u, ev, p }),
    info: async (id) => infoMap[id] || { videoId: id, title: `T-${id}`, durationSec: 180, playable: true },
    isStaff: async (u) => staff.includes(u),
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, live: true }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.live = false; },
    limits: { addCooldownMs: 1000 },
  });
  const enter = (u, room = 120) => { const from = where.get(u) ?? null; where.set(u, room); jb.onRoomChange(u, from, room); };
  const leave = (u) => { const from = where.get(u); where.delete(u); jb.onRoomChange(u, from, null); };
  const tick = (ms) => {
    t += ms;
    for (const h of timers) if (h.live && h.at <= t) { h.live = false; h.fn(); }
  };
  const last = (u) => [...sent].reverse().find((x) => x.u === u && x.ev === 'cpjb:state')?.p;
  const lastErr = (u) => [...sent].reverse().find((x) => x.u === u && x.ev === 'cpjb:error')?.p;
  return { jb, enter, leave, tick, last, lastErr, sent };
}

const V = (n) => `vid${String(n).padStart(8, '0')}`; // 11 chars

test('link do YouTube e duração em texto', () => {
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseClock('3:45'), 225);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.equal(parseClock('ao vivo'), null);
});

test('colocar música: toca pra todo mundo da sala e troca sozinha quando acaba', async () => {
  const s = setup();
  s.enter('a'); s.enter('b');
  const r1 = await s.jb.add('a', { videoId: V(1) });
  assert.equal(r1.ok, true);
  assert.equal(s.last('b').current.videoId, V(1));
  assert.equal(s.last('b').current.by.name, 'Ana');
  assert.match(s.last('b').notice.text, /Ana colocou/);
  await s.jb.add('b', { videoId: V(2) });
  assert.equal(s.last('a').queue.length, 1);
  s.tick(183_000); // 180 s + folga
  assert.equal(s.last('a').current.videoId, V(2));
  assert.equal(s.last('a').queue.length, 0);
  s.tick(183_000);
  assert.equal(s.last('a').current, null);
});

test('quem chega no meio recebe a música com o instante em que começou', async () => {
  const s = setup();
  s.enter('a');
  await s.jb.add('a', { videoId: V(1) });
  const started = s.last('a').current.startedAt;
  s.tick(60_000);
  s.enter('c');
  const st = s.last('c');
  assert.equal(st.current.startedAt, started);
  assert.equal(st.serverNow - started, 60_000);
  assert.equal(st.listeners, 2);
});

test('fora da Danceteria não coloca música', async () => {
  const s = setup();
  s.enter('a', 100);
  const r = await s.jb.add('a', { videoId: V(1) });
  assert.equal(r.ok, false);
  assert.match(s.lastErr('a').text, /Danceteria/);
});

test('limites: repetida, intervalo, 3 por pessoa, longa demais, sem embed, ao vivo', async () => {
  const s = setup({
    infoMap: {
      [V(9)]: { videoId: V(9), title: 'longa', durationSec: 3600, playable: true },
      [V(8)]: { videoId: V(8), title: 'x', playable: false, reason: 'O dono do vídeo não deixa tocar fora do YouTube.' },
      [V(7)]: { videoId: V(7), title: 'live', live: true, playable: true },
    },
  });
  s.enter('a'); s.enter('b');
  assert.equal((await s.jb.add('a', { videoId: V(1) })).ok, true);
  s.tick(2000);
  assert.equal((await s.jb.add('b', { videoId: V(1) })).ok, false); // já tocando
  assert.equal((await s.jb.add('a', { videoId: V(2) })).ok, true);
  assert.equal((await s.jb.add('a', { videoId: V(3) })).ok, false); // intervalo
  for (const n of [3, 4]) { s.tick(2000); assert.equal((await s.jb.add('a', { videoId: V(n) })).ok, true); }
  s.tick(2000);
  assert.equal((await s.jb.add('a', { videoId: V(5) })).ok, false); // 3 na fila
  assert.match(s.lastErr('a').text, /3 músicas/);
  s.tick(2000);
  assert.equal((await s.jb.add('b', { videoId: V(9) })).ok, false);
  assert.match(s.lastErr('b').text, /longa/);
  s.tick(2000);
  assert.equal((await s.jb.add('b', { videoId: V(8) })).ok, false);
  s.tick(2000);
  assert.equal((await s.jb.add('b', { videoId: V(7) })).ok, false);
  assert.match(s.lastErr('b').text, /ao vivo/i);
});

test('pular: quem colocou pula na hora; os outros votam (metade da sala)', async () => {
  const s = setup();
  for (const u of ['a', 'b', 'c', 'd']) s.enter(u);
  await s.jb.add('a', { videoId: V(1) });
  s.tick(2000);
  await s.jb.add('a', { videoId: V(2) });
  await s.jb.skip('b');
  assert.equal(s.last('a').current.videoId, V(1));
  assert.deepEqual(s.last('a').skip, { votes: ['b'], needed: 2 });
  await s.jb.skip('c');
  assert.equal(s.last('a').current.videoId, V(2));
  assert.match(s.last('a').notice.text, /votou/);
  await s.jb.skip('a'); // dona da música
  assert.equal(s.last('b').current, null);
});

test('voto de quem saiu não conta e a saída pode completar a votação', async () => {
  const s = setup();
  for (const u of ['a', 'b', 'c', 'd']) s.enter(u);
  await s.jb.add('a', { videoId: V(1) });
  await s.jb.skip('b'); // 1 de 2
  s.leave('b');
  assert.equal(s.last('a').skip.votes.length, 0);
  s.leave('d'); // 2 pessoas na sala (a, c): precisa de 1
  await s.jb.skip('c');
  assert.equal(s.last('a').current, null);
});

test('equipe pula, tira da fila e desliga', async () => {
  const s = setup({ staff: ['d'] });
  for (const u of ['a', 'b', 'd']) s.enter(u);
  await s.jb.add('a', { videoId: V(1) });
  s.tick(2000);
  await s.jb.add('a', { videoId: V(2) });
  const id = s.last('a').queue[0].id;
  assert.equal((await s.jb.remove('b', id)).ok, false);
  assert.equal((await s.jb.remove('d', id)).ok, true);
  await s.jb.skip('d');
  assert.equal(s.last('a').current, null);
  await s.jb.add('b', { videoId: V(3) });
  assert.equal((await s.jb.clear('b')).ok, false);
  assert.equal((await s.jb.clear('d')).ok, true);
  assert.equal(s.last('a').current, null);
});

test('vídeo que dá erro no player de metade da sala é pulado', async () => {
  const s = setup();
  for (const u of ['a', 'b', 'c']) s.enter(u);
  await s.jb.add('a', { videoId: V(1) });
  s.jb.report('b', { videoId: V(1), kind: 'error' });
  assert.ok(s.last('a').current);
  s.jb.report('c', { videoId: V(1), kind: 'error' });
  assert.equal(s.last('a').current, null);
  assert.match(s.last('a').notice.text, /não toca/);
});

test('sala vazia para a música e limpa a fila', async () => {
  const s = setup();
  s.enter('a');
  await s.jb.add('a', { videoId: V(1) });
  s.tick(2000);
  await s.jb.add('a', { videoId: V(2) });
  s.leave('a');
  s.tick(2 * 60 * 1000 + 10);
  assert.equal(s.jb._snapshot(120).current, null);
  assert.equal(s.jb._snapshot(120).queue.length, 0);
});

test('parsePlayerResponse: ok, sem embed, checagem de robô', () => {
  const ok = parsePlayerResponse({ videoDetails: { videoId: V(1), title: 'Música', author: 'Banda', lengthSeconds: '215' }, playabilityStatus: { status: 'OK', playableInEmbed: true } }, V(1));
  assert.deepEqual([ok.title, ok.channel, ok.durationSec, ok.playable, ok.live], ['Música', 'Banda', 215, true, false]);
  const no = parsePlayerResponse({ videoDetails: { videoId: V(1), lengthSeconds: '215' }, playabilityStatus: { status: 'OK', playableInEmbed: false } }, V(1));
  assert.equal(no.playable, false);
  const bot = parsePlayerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } }, V(1));
  assert.equal(bot.playable, null);
  const live = parsePlayerResponse({ videoDetails: { videoId: V(1), isLiveContent: true, lengthSeconds: '0' }, playabilityStatus: { status: 'OK' } }, V(1));
  assert.equal(live.live, true);
});
