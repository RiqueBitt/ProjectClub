// Robustez do servidor de mídia ("voz à prova de falhas"): corrida na
// criação da sala, sala fechando durante a entrada, transport criado pra
// quem já saiu (vazamento), worker do mediasoup morrendo (recria sem
// derrubar o processo), sessões substituídas (ping-pong de 2 aparelhos),
// token vencido e limites. Sobe o servidor de verdade (worker + WS).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

process.env.MEDIA_SERVER_SECRET = 'segredo-de-teste-robustez-0123456789';
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '42100';
process.env.MEDIA_RTC_MAX_PORT = '42200';
process.env.MEDIA_LOG_LEVEL = 'error';
process.env.MEDIA_MAX_REPLACEMENTS_PER_MINUTE = '3';
process.env.MEDIA_MSG_RATE = '5';
process.env.MEDIA_MSG_BURST = '10';

const rooms = require('../src/rooms');
const signaling = require('../src/signaling');

let server; let port;
const SECRET = process.env.MEDIA_SERVER_SECRET;
let jtiSeq = 0;
const tokenFor = (sub, room, extra = {}) => jwt.sign({ sub, room, name: sub, jti: extra.jti || `j${++jtiSeq}`, ...extra }, SECRET, { algorithm: 'HS256', expiresIn: extra.exp ? undefined : '5m' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const events = []; const waiters = []; const pending = new Map(); let seq = 0;
    const client = {
      ws, events, closedWith: null, closed: null,
      request: (method, data = {}) => new Promise((res, rej) => {
        const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, data }));
      }),
      waitEvent: (name, timeout = 3000) => new Promise((res, rej) => {
        const i = events.findIndex((e) => e.event === name);
        if (i !== -1) return res(events.splice(i, 1)[0].data);
        const t = setTimeout(() => rej(new Error(`timeout esperando ${name}`)), timeout);
        waiters.push({ name, res: (d) => { clearTimeout(t); res(d); } });
        return undefined;
      }),
      close: () => ws.close(),
    };
    client.closed = new Promise((r) => ws.on('close', (code) => { client.closedWith = code; r(code); }));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); return m.ok ? p.res(m.data) : p.rej(new Error(m.error)); }
      if (m.event) {
        const w = waiters.findIndex((x) => x.name === m.event);
        if (w !== -1) return waiters.splice(w, 1)[0].res(m.data);
        events.push(m);
      }
      return undefined;
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

before(async () => {
  await rooms.startWorkers();
  server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  signaling.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { rooms.shutdown(); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('corrida: várias criações simultâneas da MESMA sala devolvem o mesmo Room (um Router só)', async () => {
  const all = await Promise.all(Array.from({ length: 10 }, () => rooms.getOrCreateRoom('corrida')));
  assert.ok(all.every((r) => r === all[0]));
  assert.equal([...rooms.rooms.keys()].filter((k) => k === 'corrida').length, 1);
  rooms.closeRoomIfEmpty('corrida');
  assert.equal(rooms.rooms.has('corrida'), false);
});

test('corrida: duas pessoas entrando AO MESMO TEMPO numa sala vazia caem na mesma sala e se enxergam', async () => {
  const [a, b] = await Promise.all([connect(tokenFor('ana', 'simul')), connect(tokenFor('beto', 'simul'))]);
  const [wa, wb] = await Promise.all([a.waitEvent('welcome'), b.waitEvent('welcome')]);
  assert.equal(rooms.stats().rooms, 1);
  assert.equal(rooms.rooms.get('simul').size, 2);
  // Cada um enxerga o outro: no welcome ou por peerJoined.
  const sees = async (w, c, other) => w.peers.some((p) => p.id === other) || (await c.waitEvent('peerJoined').then((d) => d.peerId === other).catch(() => false));
  assert.ok(await sees(wa, a, 'beto'), 'Ana enxerga o Beto');
  assert.ok(await sees(wb, b, 'ana'), 'Beto enxerga a Ana');
  a.close(); b.close();
  await Promise.all([a.closed, b.closed]);
  await sleep(50);
  assert.equal(rooms.stats().rooms, 0);
});

test('sala fechada enquanto alguém entrava: joinRoom cria uma sala nova em vez de entrar na morta', async () => {
  const r1 = await rooms.getOrCreateRoom('fecha');
  r1.close(); // fechou "por fora" (worker/último saiu) mas ficou no mapa
  const peer = new rooms.Peer({ id: 'x', name: 'x', socket: null, session: 's' });
  const r2 = await rooms.joinRoom('fecha', peer);
  assert.notEqual(r2, r1);
  assert.equal(r2.closed, false);
  assert.equal(r2.peers.get('x'), peer);
  r2.removePeer('x');
  rooms.closeRoomIfEmpty('fecha');
});

test('transport criado pra quem saiu no meio do await é fechado (sem vazar porta)', async () => {
  const peer = new rooms.Peer({ id: 'vaza', name: 'vaza', socket: null, session: 's' });
  const room = await rooms.joinRoom('vazamento', peer);
  const p = room.createWebRtcTransport(peer, 'send');
  room.removePeer('vaza'); // saiu enquanto o worker criava o transport
  await assert.rejects(p, /saiu/);
  const dump = await room.router.dump();
  assert.equal(dump.transportIds.length, 0, 'nenhum transport sobrou no router');
  rooms.closeRoomIfEmpty('vazamento');
});

test('limite de transports por participante', async () => {
  const a = await connect(tokenFor('lim', 'limites'));
  await a.waitEvent('welcome');
  for (let i = 0; i < 4; i += 1) await a.request('createTransport', { direction: i % 2 ? 'recv' : 'send' }); // eslint-disable-line no-await-in-loop
  await assert.rejects(a.request('createTransport', { direction: 'send' }), /limite de transports/);
  a.close(); await a.closed;
});

test('token vencido → 4401 com detail "expired"', async () => {
  const tok = jwt.sign({ sub: 'u', room: 'r', exp: Math.floor(Date.now() / 1000) - 120 }, SECRET, { algorithm: 'HS256' });
  const c = await connect(tok);
  const err = await c.waitEvent('error');
  assert.equal(err.reason, 'unauthorized');
  assert.equal(err.detail, 'expired');
  assert.equal(await c.closed, 4401);
});

test('2 aparelhos: a sessão substituída NÃO volta com o mesmo token (fim do ping-pong)', async () => {
  const tokA = tokenFor('dup', 'pingpong'); const tokB = tokenFor('dup', 'pingpong');
  const a = await connect(tokA); await a.waitEvent('welcome');
  const b = await connect(tokB); await b.waitEvent('welcome');
  assert.equal((await a.waitEvent('kicked')).reason, 'replaced');
  assert.equal(await a.closed, 4409);
  // O aparelho A "reconecta sozinho" com o token antigo: recusado, B fica.
  const a2 = await connect(tokA);
  assert.equal((await a2.waitEvent('kicked')).reason, 'replaced');
  assert.equal(await a2.closed, 4409);
  assert.equal(b.closedWith, null, 'B continua conectado');
  assert.equal(rooms.rooms.get('pingpong').peers.get('dup').session, jwt.decode(tokB).jti, 'a vaga é da sessão B');
  // A mesma sessão (B) reconectando com o MESMO token é reconexão normal.
  const b2 = await connect(tokB); await b2.waitEvent('welcome');
  assert.equal(await b.closed, 4409);
  b2.close(); await b2.closed;
});

test('2 aparelhos com token novo a cada vez: depois de N trocas/min a troca é recusada e quem está fica', async () => {
  const conns = [];
  let refused = null;
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const c = await connect(tokenFor('flap', 'flapsala'));
    conns.push(c);
    // eslint-disable-next-line no-await-in-loop
    const first = await Promise.race([c.waitEvent('welcome').then(() => 'welcome'), c.waitEvent('kicked').then((d) => d.reason)]);
    if (first === 'flapping') { refused = c; break; }
  }
  assert.ok(refused, 'alguma troca foi recusada por loop');
  assert.equal(await refused.closed, 4409);
  const holder = rooms.rooms.get('flapsala').peers.get('flap');
  assert.ok(holder && !holder.closed, 'a sessão atual continua na sala');
  for (const c of conns) c.close();
  await sleep(100);
});

test('anti-flood: rajada de mensagens recebe "muitas requisições" sem derrubar', async () => {
  const a = await connect(tokenFor('flood', 'floodsala'));
  await a.waitEvent('welcome');
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => a.request('ping')));
  assert.ok(results.some((r) => r.status === 'rejected' && /muitas requisições/.test(r.reason.message)));
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal(a.closedWith, null);
  a.close(); await a.closed;
});

test('worker do mediasoup morre: sala fecha com 1012, processo segue vivo e um worker novo sobe', async () => {
  const a = await connect(tokenFor('w1', 'worker-sala'));
  await a.waitEvent('welcome');
  await a.request('createTransport', { direction: 'send' });
  const oldPid = rooms.aliveWorkers()[0].worker.pid;
  process.kill(oldPid, 'SIGKILL');
  assert.equal(await a.closed, 1012, 'cliente recebe 1012 (reconectar)');
  assert.equal(rooms.rooms.has('worker-sala'), false, 'sala do worker morto saiu do mapa');
  // Espera o worker novo.
  const t0 = Date.now();
  while (rooms.aliveWorkers().length < 1 && Date.now() - t0 < 8000) await sleep(100); // eslint-disable-line no-await-in-loop
  assert.equal(rooms.aliveWorkers().length, 1);
  assert.notEqual(rooms.aliveWorkers()[0].worker.pid, oldPid);
  assert.ok(rooms.aliveWorkers()[0].webRtcServer, 'WebRtcServer recriado na mesma porta');
  // Reconexão (mesmo token) funciona numa sala nova, com mídia.
  const a2 = await connect(tokenFor('w1', 'worker-sala'));
  await a2.waitEvent('welcome');
  const tr = await a2.request('createTransport', { direction: 'recv' });
  assert.ok(tr.iceCandidates.some((c) => c.protocol === 'udp') && tr.iceCandidates.some((c) => c.protocol === 'tcp'), 'candidatos UDP e TCP');
  a2.close(); await a2.closed;
});
