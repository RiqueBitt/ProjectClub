const test = require('node:test');
const assert = require('node:assert');
const { createEventLimiter, limitSocketEvents } = require('../src/sockets/eventRateLimit');

test('limite de eventos: pico de início de call passa inteiro', () => {
  let t = 0;
  const take = createEventLimiter({ now: () => t });
  // 120 eventos no mesmo instante (candidatos ICE + estado da call)
  for (let i = 0; i < 120; i += 1) assert.equal(take(), 'ok');
});

test('limite de eventos: acima do limite descarta e as fichas voltam com o tempo', () => {
  let t = 0;
  const take = createEventLimiter({ burst: 10, rate: 5, now: () => t });
  for (let i = 0; i < 10; i += 1) assert.equal(take(), 'ok');
  assert.equal(take(), 'drop');
  t += 1000; // 1 s depois: 5 fichas novas
  for (let i = 0; i < 5; i += 1) assert.equal(take(), 'ok');
  assert.equal(take(), 'drop');
});

test('limite de eventos: quem insiste sem parar é marcado como abuso', () => {
  let t = 0;
  const take = createEventLimiter({ burst: 5, rate: 1, abuseDrops: 20, abuseWindowMs: 10_000, now: () => t });
  for (let i = 0; i < 5; i += 1) take();
  let last;
  for (let i = 0; i < 20; i += 1) last = take();
  assert.equal(last, 'abuse');
});

test('limite de eventos: no socket, o evento descartado não chega ao handler e o abuso desconecta', () => {
  const mws = [];
  let disconnected = false;
  const socket = { userId: 'u1', use: (fn) => mws.push(fn), disconnect: () => { disconnected = true; } };
  const reports = [];
  limitSocketEvents(socket, { burst: 2, rate: 0, abuseDrops: 3 }, (_s, kind) => reports.push(kind));
  let ran = 0;
  const emit = () => mws[0](['typing:start'], () => { ran += 1; });
  emit(); emit(); emit(); emit();
  assert.equal(ran, 2);
  assert.equal(disconnected, false);
  emit();
  assert.equal(disconnected, true);
  assert.deepEqual(reports, ['drop', 'abuse']);
});

test('limite de eventos: com socket de verdade, só o que cabe no limite chega ao servidor', async (t) => {
  const http = require('node:http');
  const { Server } = require('socket.io');
  const { io: connect } = require('socket.io-client');
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  let got = 0;
  io.on('connection', (socket) => {
    limitSocketEvents(socket, { burst: 3, rate: 0, abuseDrops: 1000 }, () => {});
    socket.on('typing:start', () => { got += 1; });
    socket.on('fim', (ack) => ack(got));
  });
  await new Promise((r) => { httpServer.listen(0, r); });
  const client = connect(`http://127.0.0.1:${httpServer.address().port}`, { transports: ['websocket'] });
  t.after(() => { client.close(); io.close(); });
  await new Promise((r) => { client.once('connect', r); });
  for (let i = 0; i < 10; i += 1) client.emit('typing:start');
  await new Promise((r) => { setTimeout(r, 150); });
  assert.equal(got, 3);
});
