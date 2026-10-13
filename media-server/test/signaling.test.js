// Teste de integração da sinalização: sobe o servidor de verdade (worker
// mediasoup + WS) numa porta livre e conversa com ele como um cliente.
// Não precisa de navegador: produce/consume de mídia real ficam pro teste
// e2e no Chromium (client/e2e/voz-propria.spec.mjs).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

process.env.MEDIA_SERVER_SECRET = 'segredo-de-teste-0123456789';
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '42000';
process.env.MEDIA_RTC_MAX_PORT = '42050';
process.env.MEDIA_LOG_LEVEL = 'error';

const rooms = require('../src/rooms');
const signaling = require('../src/signaling');

let server; let port;
const SECRET = process.env.MEDIA_SERVER_SECRET;
const tokenFor = (sub, room, name) => jwt.sign({ sub, room, name }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });

// Cliente mínimo: fila de eventos + request/response por id.
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const events = []; const waiters = []; const pending = new Map(); let seq = 0;
    const client = {
      ws, events,
      request: (method, data = {}) => new Promise((res, rej) => {
        const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, data }));
      }),
      waitEvent: (name, timeout = 3000) => new Promise((res, rej) => {
        const i = events.findIndex((e) => e.event === name);
        if (i !== -1) return res(events.splice(i, 1)[0].data);
        const t = setTimeout(() => rej(new Error(`timeout esperando ${name}`)), timeout);
        waiters.push({ name, res: (d) => { clearTimeout(t); res(d); } });
      }),
      close: () => ws.close(),
    };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); return m.ok ? p.res(m.data) : p.rej(new Error(m.error)); }
      if (m.event) {
        const w = waiters.findIndex((x) => x.name === m.event);
        if (w !== -1) return waiters.splice(w, 1)[0].res(m.data);
        events.push(m);
      }
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
    ws.on('close', (code) => { client.closedWith = code; });
  });
}

before(async () => {
  await rooms.startWorkers();
  server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  signaling.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('recusa conexão sem JWT válido', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=invalido`);
  const code = await new Promise((r) => ws.on('close', r));
  assert.equal(code, 4401);
});

test('entra na sala, recebe welcome com capacidades RTP e cria transports', async () => {
  const a = await connect(tokenFor('u1', 'canal:geral', 'Ana'));
  const w = await a.waitEvent('welcome');
  assert.equal(w.peerId, 'u1');
  assert.ok(Array.isArray(w.routerRtpCapabilities.codecs) && w.routerRtpCapabilities.codecs.length >= 2);
  assert.deepEqual(w.peers, []);
  const send = await a.request('createTransport', { direction: 'send' });
  const recv = await a.request('createTransport', { direction: 'recv' });
  assert.ok(send.id && send.iceParameters && send.iceCandidates.length > 0 && send.dtlsParameters);
  assert.equal(send.direction, 'send'); assert.equal(recv.direction, 'recv');
  assert.ok(send.iceCandidates.every((c) => c.ip === '127.0.0.1'), 'anuncia o MEDIA_PUBLIC_IP');
  assert.equal(rooms.stats().rooms, 1);
  a.close();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(rooms.stats().rooms, 0, 'sala fecha quando o último sai');
});

test('avisa quem já está (peerJoined/peerLeft) e manda o retrato pro recém-chegado', async () => {
  const a = await connect(tokenFor('u1', 'sala2', 'Ana'));
  await a.waitEvent('welcome');
  const b = await connect(tokenFor('u2', 'sala2', 'Beto'));
  const wb = await b.waitEvent('welcome');
  assert.deepEqual(wb.peers, [{ id: 'u1', name: 'Ana' }]);
  const joined = await a.waitEvent('peerJoined');
  assert.deepEqual(joined, { peerId: 'u2', name: 'Beto' });
  b.close();
  const left = await a.waitEvent('peerLeft');
  assert.equal(left.peerId, 'u2');
  a.close();
});

test('mesma pessoa de novo substitui a sessão antiga (identidade única por usuário)', async () => {
  const a1 = await connect(tokenFor('u9', 'sala3', 'Ana'));
  await a1.waitEvent('welcome');
  const a2 = await connect(tokenFor('u9', 'sala3', 'Ana'));
  await a2.waitEvent('welcome');
  const kicked = await a1.waitEvent('kicked');
  assert.equal(kicked.reason, 'replaced');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a1.closedWith, 4409);
  assert.equal(rooms.stats().peers, 1);
  a2.close();
});

test('método desconhecido e transport inexistente respondem erro sem derrubar', async () => {
  const a = await connect(tokenFor('u1', 'sala4', 'Ana'));
  await a.waitEvent('welcome');
  await assert.rejects(a.request('inventado'), /método desconhecido/);
  await assert.rejects(a.request('connectTransport', { transportId: 'x', dtlsParameters: {} }), /transport não encontrado/);
  const pong = await a.request('ping');
  assert.ok(pong.t > 0);
  a.close();
});
