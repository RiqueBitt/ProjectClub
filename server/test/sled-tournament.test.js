// Corrida de Trenó — torneio (chaveamento) no namespace /sled, com Socket.IO
// de verdade: 4 inscritos → contagem → 2 baterias de 2 → os 2 melhores de
// cada vão pra final de 4 → pódio (quem não termina é DNF). Também: fila
// normal não mistura com torneio e sair da inscrição limpa o torneio.
// Timers encurtados por env (lidos no require).
process.env.SLED_COUNTDOWN_SECONDS = '1';
process.env.SLED_READY_DELAY_MS = '50';
process.env.SLED_TOURNAMENT_COUNTDOWN_SECONDS = '1';
process.env.SLED_TOURNAMENT_FULL_DELAY_SECONDS = '1';
process.env.SLED_HEAT_COUNTDOWN_SECONDS = '1';
process.env.SLED_HEAT_GRACE_MS = '400';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
// socket.io-client é dependência do client (workspace); no monorepo fica em node_modules da raiz.
const { io: Client } = require(require.resolve('socket.io-client', { paths: [path.resolve(__dirname, '../../client'), path.resolve(__dirname, '../..')] }));

const { initSledRacing } = require('../src/sockets/sledRacing');

let httpServer; let io; let port; let ns;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  httpServer = http.createServer();
  io = new Server(httpServer);
  ns = initSledRacing(io);
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  port = httpServer.address().port;
});
after(() => { io.close(); httpServer.close(); setTimeout(() => process.exit(0), 100).unref(); });

function connect(name) {
  const c = Client(`http://127.0.0.1:${port}/sled`, { transports: ['websocket'], auth: { name }, forceNew: true });
  c.name = name; c.log = [];
  for (const ev of ['confirmed', 'game_connected', 'new_player', 'update_room', 'start_race', 'tournament_update', 'tournament_stage', 'tournament_eliminated', 'tournament_result', 'player_disconnected']) {
    c.on(ev, (...a) => c.log.push({ ev, a }));
  }
  return new Promise((resolve, reject) => { c.on('connect', () => resolve(c)); c.on('connect_error', reject); });
}
async function waitFor(c, pred, msg, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (c.log.some(pred)) return; await sleep(25); }
  throw new Error(`timeout: ${msg}\n${c.name}: ${JSON.stringify(c.log.map((e) => e.ev))}`);
}
const last = (c, ev) => [...c.log].reverse().find((e) => e.ev === ev);
const count = (c, ev) => c.log.filter((e) => e.ev === ev).length;

test('torneio completo: inscrição, 2 baterias, final de 4 e pódio com DNF', async () => {
  const st = ns._state;
  const players = await Promise.all(['Ana', 'Beto', 'Caio', 'Duda'].map(connect));
  for (const c of players) c.emit('tournament_join', c.name);
  await waitFor(players[0], (e) => e.ev === 'tournament_update' && e.a[0].count === 4, 'Ana vê 4/8 inscritos');
  const upd = last(players[0], 'tournament_update').a[0];
  assert.equal(upd.min, 4); assert.equal(upd.max, 8);
  assert.ok(upd.seconds > 0, 'contagem de inscrição abriu com 4');

  // Baterias: cada um recebe stage=heat + game_connected com 2 jogadores.
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'tournament_stage' && e.a[0].stage === 'heat', `${c.name}: bateria`)));
  for (const c of players) {
    const g = last(c, 'game_connected').a[0];
    assert.equal(g.players.length, 2, `${c.name} numa bateria de 2`);
    assert.ok(g.players.some((p) => p.me), 'eu estou na lista');
  }
  assert.equal([...st.rooms.values()].filter((r) => r.tournament).length, 2, '2 salas de bateria');
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'start_race', `${c.name}: largada da bateria`)));

  // Jogadas são repassadas dentro da bateria (não vazam pra outra).
  const [ana] = players;
  const anaRoom = [...st.rooms.values()].find((r) => r.players.some((p) => p.name === 'Ana'));
  const mate = players.find((c) => c.name !== 'Ana' && anaRoom.players.some((p) => p.name === c.name));
  const other = players.find((c) => !anaRoom.players.some((p) => p.name === c.name));
  const got = []; mate.on('player_action', (id, a) => got.push([id, a.type]));
  const leaked = []; other.on('player_action', (id, a) => leaked.push([id, a.type]));
  ana.emit('action', { type: 'turn', dir: 'left' });
  await sleep(150);
  assert.deepEqual(got, [[anaRoom.players.find((p) => p.name === 'Ana').idx + 1, 'turn']]);
  assert.deepEqual(leaked, []);

  // Todo mundo cruza a linha → os 2 de cada bateria passam → final de 4.
  for (const c of players) c.emit('race_finished', { ms: 30000 });
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'tournament_stage' && e.a[0].stage === 'wait', `${c.name}: passou`)));
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'tournament_stage' && e.a[0].stage === 'final', `${c.name}: final`)));
  for (const c of players) assert.equal(last(c, 'game_connected').a[0].players.length, 4, 'final de 4');
  await Promise.all(players.map((c) => waitFor(c, (e) => count(c, 'start_race') >= 2, `${c.name}: largada da final`)));

  // Chegada: Caio, Ana, Duda; Beto não termina (DNF pela graça de 400ms).
  for (const name of ['Caio', 'Ana', 'Duda']) { players.find((c) => c.name === name).emit('race_finished', { ms: 1000 }); await sleep(40); }
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'tournament_result', `${c.name}: resultado`)));
  const res = last(ana, 'tournament_result').a[0];
  assert.deepEqual(res.standings.map((s) => [s.place, s.name, s.dnf]), [[1, 'Caio', false], [2, 'Ana', false], [3, 'Duda', false], [4, 'Beto', true]]);
  assert.equal(st.tournaments.size, 0, 'torneio encerrado');
  assert.equal([...st.rooms.values()].filter((r) => r.tournament).length, 0, 'salas do torneio fechadas');
  for (const c of players) c.close();
});

test('bateria com 3: só os 2 primeiros passam, o 3º é eliminado', async () => {
  const st = ns._state;
  const names = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const players = await Promise.all(names.map(connect));
  for (const c of players) c.emit('tournament_join', c.name);
  await Promise.all(players.map((c) => waitFor(c, (e) => e.ev === 'start_race', `${c.name}: largada`)));
  const heats = [...st.rooms.values()].filter((r) => r.tournament);
  assert.deepEqual(heats.map((h) => h.players.length).sort(), [2, 3], 'divisão 3 + 2');
  const big = heats.find((h) => h.players.length === 3);
  const order = big.players.map((p) => players.find((c) => c.name === p.name));
  for (const c of order) { c.emit('race_finished', { ms: 1 }); await sleep(30); }
  await waitFor(order[2], (e) => e.ev === 'tournament_eliminated', 'o 3º da bateria é eliminado');
  assert.equal(last(order[2], 'tournament_eliminated').a[0].place, 3);
  assert.equal(count(order[0], 'tournament_eliminated'), 0);
  for (const c of players) c.close();
  await sleep(100);
});

test('fila normal não cai em sala de torneio; sair da inscrição limpa o torneio', async () => {
  const st = ns._state;
  const a = await connect('Ana'); const b = await connect('Beto');
  a.emit('tournament_join', 'Ana');
  await waitFor(a, (e) => e.ev === 'tournament_update' && e.a[0].count === 1, 'Ana inscrita');
  b.emit('tag_verify', [], 'Beto');
  await waitFor(b, (e) => e.ev === 'game_connected', 'Beto entra na fila normal');
  assert.equal(last(b, 'game_connected').a[0].players.length, 1, 'Beto sozinho (Ana está no torneio)');
  a.emit('tournament_leave');
  await sleep(100);
  assert.equal(st.tournaments.size, 0, 'torneio vazio some');
  a.close(); b.close();
});
