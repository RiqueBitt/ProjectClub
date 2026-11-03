// Revisão "voz-turbo" do servidor de mídia: escolha de worker pela carga
// REAL (consumers/producers, não nº de salas), "dynacast" (o publicador fica
// sabendo a maior camada de simulcast que alguém assiste — evento
// producerLayers) e versão do protocolo no welcome. Sobe o servidor de
// verdade (worker mediasoup + WS), sem navegador.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

process.env.MEDIA_SERVER_SECRET = 'segredo-de-teste-turbo-0123456789';
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '42500';
process.env.MEDIA_RTC_MAX_PORT = '42600';
process.env.MEDIA_LOG_LEVEL = 'error';
process.env.MEDIA_DYNACAST_DOWN_MS = '150';

const rooms = require('../src/rooms');
const signaling = require('../src/signaling');

const SECRET = process.env.MEDIA_SERVER_SECRET;
let server; let port;
let jtiSeq = 0;
const tokenFor = (sub, room) => jwt.sign({ sub, room, name: sub, jti: `t${++jtiSeq}` }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        return undefined;
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
      return undefined;
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

let ssrcSeq = 5000;
const simulcastRtp = (layers = 2) => {
  const ssrcs = Array.from({ length: layers }, () => ++ssrcSeq);
  return {
    mid: `v${ssrcs[0]}`, codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [], encodings: ssrcs.map((ssrc) => ({ ssrc, scalabilityMode: 'L1T3' })), rtcp: { cname: `v${ssrcs[0]}`, reducedSize: true },
  };
};

before(async () => {
  await rooms.startWorkers();
  server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  signaling.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { rooms.shutdown(); server.close(); setTimeout(() => process.exit(0), 200).unref(); });

// ---------- lógica pura ----------
test('roomLoad: sala grande pesa pelos consumers/producers, não por ser "uma sala"', () => {
  const peer = (producers, consumers) => ({ producers: { size: producers }, consumers: { size: consumers } });
  const big = { peers: new Map(Array.from({ length: 20 }, (_, i) => [`p${i}`, peer(1, 19)])) };
  const small = { peers: new Map([['a', peer(1, 0)]]) };
  assert.equal(rooms.roomLoad(small), 1 + 1 + 1);
  assert.equal(rooms.roomLoad(big), 1 + 20 * (1 + 1 + 19));
  assert.ok(rooms.roomLoad(big) > 20 * rooms.roomLoad(small), 'uma sala de 20 pesa mais que 20 salas de 1');
  assert.equal(rooms.roomLoad(null), 1);
});

test('neededSpatialLayer: maior camada assistida; pausado não conta; sem preferência = a mais alta', () => {
  const n = rooms.neededSpatialLayer;
  assert.equal(n([], 2), -1, 'ninguém assistindo');
  assert.equal(n([{ paused: true, preferredSpatialLayer: 1 }], 2), -1, 'pausado (fora da tela) não conta');
  assert.equal(n([{ closed: true, preferredSpatialLayer: 1 }], 2), -1);
  assert.equal(n([{ paused: false, preferredSpatialLayer: 0 }], 2), 0);
  assert.equal(n([{ paused: false, preferredSpatialLayer: 0 }, { paused: false, preferredSpatialLayer: 1 }], 2), 1);
  assert.equal(n([{ paused: false, preferredSpatialLayer: null }], 3), 2, 'cliente antigo/Android: camada mais alta');
  assert.equal(n([{ paused: false, preferredSpatialLayer: 9 }], 3), 2, 'nunca passa da última camada');
  assert.equal(n([{ paused: false, preferredSpatialLayer: 1 }], 3), 1);
});

// ---------- servidor de verdade ----------
test('welcome traz a versão do protocolo e os recursos do servidor', async () => {
  const c = await connect(tokenFor('u-proto', 'turbo-proto'));
  const w = await c.waitEvent('welcome');
  assert.equal(w.protocol, 2);
  assert.ok(Array.isArray(w.features) && w.features.includes('producerLayers') && w.features.includes('restartIce'));
  assert.ok(w.routerRtpCapabilities && Array.isArray(w.peers), 'campos do protocolo 1 continuam iguais');
  c.close();
  await sleep(50);
});

test('dynacast: o publicador recebe producerLayers conforme o que os outros assistem', async () => {
  const room = 'turbo-dyn';
  const a = await connect(tokenFor('u-pub', room));
  await a.waitEvent('welcome');
  const send = await a.request('createTransport', { direction: 'send' });
  const { producerId } = await a.request('produce', { transportId: send.id, kind: 'video', rtpParameters: simulcastRtp(2), appData: { source: 'screen' } });
  // Sozinho na sala: depois da folga, avisa que ninguém está assistindo.
  assert.deepEqual(await a.waitEvent('producerLayers', 2000), { producerId, maxSpatialLayer: -1 });

  const b = await connect(tokenFor('u-view', room));
  const wb = await b.waitEvent('welcome');
  const recv = await b.request('createTransport', { direction: 'recv' });
  const cons = await b.request('consume', { transportId: recv.id, producerId, rtpCapabilities: wb.routerRtpCapabilities });
  // Consumer novo nasce pausado: ainda ninguém assistindo (sem evento).
  await sleep(250);
  assert.equal(a.events.filter((e) => e.event === 'producerLayers').length, 0);
  // Retomou sem dizer o tamanho → camada mais alta, NA HORA.
  await b.request('resumeConsumer', { consumerId: cons.consumerId });
  assert.deepEqual(await a.waitEvent('producerLayers', 500), { producerId, maxSpatialLayer: 1 });
  // Miniatura → camada baixa, só depois da folga (sem liga-desliga).
  await b.request('setConsumerPreferredLayers', { consumerId: cons.consumerId, spatialLayer: 0 });
  await sleep(60);
  assert.equal(a.events.filter((e) => e.event === 'producerLayers').length, 0, 'descer espera a folga');
  assert.deepEqual(await a.waitEvent('producerLayers', 1000), { producerId, maxSpatialLayer: 0 });
  // Ampliou de novo antes de qualquer coisa → sobe na hora.
  await b.request('setConsumerPreferredLayers', { consumerId: cons.consumerId, spatialLayer: 1 });
  assert.deepEqual(await a.waitEvent('producerLayers', 500), { producerId, maxSpatialLayer: 1 });
  // Sobe e desce rápido (dentro da folga): nenhum aviso de descida perdido nem duplicado.
  await b.request('setConsumerPreferredLayers', { consumerId: cons.consumerId, spatialLayer: 0 });
  await b.request('setConsumerPreferredLayers', { consumerId: cons.consumerId, spatialLayer: 1 });
  await sleep(300);
  assert.equal(a.events.filter((e) => e.event === 'producerLayers').length, 0, 'voltou pra 1 dentro da folga: nada muda');
  // Vídeo fora da tela (pauseConsumer) → ninguém assistindo.
  await b.request('pauseConsumer', { consumerId: cons.consumerId });
  assert.deepEqual(await a.waitEvent('producerLayers', 1000), { producerId, maxSpatialLayer: -1 });
  await b.request('resumeConsumer', { consumerId: cons.consumerId });
  assert.deepEqual(await a.waitEvent('producerLayers', 500), { producerId, maxSpatialLayer: 1 });
  // Quem assistia saiu → volta a "ninguém".
  b.close();
  assert.deepEqual(await a.waitEvent('producerLayers', 1500), { producerId, maxSpatialLayer: -1 });
  // O espectador não recebe producerLayers (é só pro dono).
  assert.equal(b.events.filter((e) => e.event === 'producerLayers').length, 0);
  a.close();
  await sleep(100);
  assert.equal(rooms.rooms.has(room), false, 'sala fechou sem timer pendurado');
});

test('dynacast: producer sem simulcast (Android, 1 camada) não gera aviso', async () => {
  const room = 'turbo-single';
  const a = await connect(tokenFor('u-one', room));
  await a.waitEvent('welcome');
  const send = await a.request('createTransport', { direction: 'send' });
  await a.request('produce', { transportId: send.id, kind: 'video', rtpParameters: simulcastRtp(1), appData: { source: 'screen' } });
  await sleep(400);
  assert.equal(a.events.filter((e) => e.event === 'producerLayers').length, 0);
  a.close();
  await sleep(50);
});
