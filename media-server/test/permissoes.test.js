// Permissões de mídia aplicadas NO servidor de mídia (revisão "igual ao
// Discord"): claims do JWT (canSpeak/canVideo/role/serverMuted), produce
// recusado, microfone que nasce pausado, mudo da moderação por POST
// /control, expulsão e ordens que valem pra reconexão com token antigo.
// Sobe o servidor de verdade (worker mediasoup + WS); produce é feito com
// rtpParameters montados à mão (não precisa de navegador).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

process.env.MEDIA_SERVER_SECRET = 'segredo-de-teste-permissoes-0123456789';
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '42300';
process.env.MEDIA_RTC_MAX_PORT = '42400';
process.env.MEDIA_LOG_LEVEL = 'error';

const perm = require('../src/permissions');
const rooms = require('../src/rooms');
const signaling = require('../src/signaling');

const SECRET = process.env.MEDIA_SERVER_SECRET;
let server; let port;
let jtiSeq = 0;
const tokenFor = (sub, room, claims = {}) => jwt.sign({ sub, room, name: sub, jti: `p${++jtiSeq}`, ...claims }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const events = []; const waiters = []; const pending = new Map(); let seq = 0;
    const client = {
      ws, events, closedWith: null,
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

// rtpParameters mínimos (o transport não precisa estar conectado pra publicar).
let ssrcSeq = 1000;
const audioRtp = () => {
  const ssrc = ++ssrcSeq;
  return {
    mid: String(ssrc), codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2, parameters: { useinbandfec: 1 }, rtcpFeedback: [] }],
    headerExtensions: [], encodings: [{ ssrc }], rtcp: { cname: `a${ssrc}`, reducedSize: true },
  };
};
const videoRtp = () => {
  const ssrc = ++ssrcSeq;
  return {
    mid: String(ssrc), codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
    headerExtensions: [], encodings: [{ ssrc }], rtcp: { cname: `v${ssrc}`, reducedSize: true },
  };
};

async function joinWithSend(sub, room, claims) {
  const c = await connect(tokenFor(sub, room, claims));
  c.welcome = await c.waitEvent('welcome');
  c.send = await c.request('createTransport', { direction: 'send' });
  c.produceMic = (appData = {}) => c.request('produce', { transportId: c.send.id, kind: 'audio', rtpParameters: audioRtp(), appData: { source: 'mic', ...appData } });
  c.produceCam = () => c.request('produce', { transportId: c.send.id, kind: 'video', rtpParameters: videoRtp(), appData: { source: 'camera' } });
  return c;
}
const serverProducer = (room, peerId, producerId) => rooms.rooms.get(room)?.peers.get(peerId)?.producers.get(producerId);

function postControl(body, secret = SECRET) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: '/control', method: 'POST', headers: { 'content-type': 'application/json', 'x-media-secret': secret, 'content-length': Buffer.byteLength(data) } }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject); req.end(data);
  });
}

before(async () => {
  await rooms.startWorkers();
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/control') {
      signaling.handleControlRequest(req, res, { secretOk: (s) => s === SECRET });
      return;
    }
    res.writeHead(404); res.end();
  });
  signaling.attach(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

// ---------- lógica pura ----------
test('permsFromClaims: token antigo (sem claims) = tudo permitido; plateia não fala nem transmite', () => {
  assert.deepEqual(perm.permsFromClaims({}), { canSpeak: true, canVideo: true, role: null, serverMuted: false, serverDeafened: false });
  const aud = perm.permsFromClaims({ role: 'audience', canSpeak: true, canVideo: true });
  assert.equal(aud.canSpeak, false); assert.equal(aud.canVideo, false); assert.equal(aud.role, 'audience');
  const p = perm.permsFromClaims({ canSpeak: false, canVideo: true, serverMuted: true });
  assert.equal(p.canSpeak, false); assert.equal(p.canVideo, true); assert.equal(p.serverMuted, true);
});

test('checkProduce/checkResume: SPEAK pro mic, VIDEO pra câmera/tela, áudio da tela só com a tela', () => {
  const all = perm.permsFromClaims({});
  assert.equal(perm.checkProduce(all, { kind: 'audio', source: 'mic' }), null);
  assert.equal(perm.checkProduce({ ...all, canSpeak: false }, { kind: 'audio', source: 'mic' }).code, 'speak');
  assert.equal(perm.checkProduce({ ...all, canVideo: false }, { kind: 'video', source: 'camera' }).code, 'video');
  assert.equal(perm.checkProduce({ ...all, canVideo: false }, { kind: 'video', source: 'screen' }).code, 'video');
  assert.equal(perm.checkProduce(all, { kind: 'audio', source: 'screenAudio', hasScreen: false }).code, 'video');
  assert.equal(perm.checkProduce(all, { kind: 'audio', source: 'screenAudio', hasScreen: true }), null);
  assert.equal(perm.normalizeSource('audio', 'qualquer'), 'mic');
  assert.equal(perm.normalizeSource('video', 'x'), 'camera');
  assert.equal(perm.checkResume({ ...all, serverMuted: true }, { kind: 'audio', source: 'mic' }).code, 'server-muted');
  assert.equal(perm.checkResume({ ...all, serverMuted: true }, { kind: 'video', source: 'camera' }), null);
  assert.equal(perm.forcePausedOnProduce({ ...all, serverMuted: true }, { kind: 'audio', source: 'mic' }), true);
  assert.equal(perm.consumerShouldPause({ ...all, serverDeafened: true }, { kind: 'audio', clientPaused: false }), true);
  assert.equal(perm.consumerShouldPause({ ...all, serverDeafened: true }, { kind: 'video', clientPaused: false }), false);
  assert.match(perm.forbiddenError({ code: 'speak', message: 'x' }).message, /^forbidden:speak/);
});

test('permsForAction: pause-audio/resume-allowed/set-perms e plateia sempre sem transmitir', () => {
  const all = perm.permsFromClaims({});
  const muted = perm.permsForAction(all, 'pause-audio', {});
  assert.equal(muted.serverMuted, true);
  const deaf = perm.permsForAction(all, 'pause-audio', { serverDeafened: true });
  assert.equal(deaf.serverDeafened, true);
  const back = perm.permsForAction(deaf, 'resume-allowed', {});
  assert.equal(back.serverMuted, false); assert.equal(back.serverDeafened, false);
  const stage = perm.permsForAction(all, 'set-perms', { role: 'audience', canSpeak: true });
  assert.equal(stage.canSpeak, false);
  const promoted = perm.permsForAction(stage, 'set-perms', { role: 'speaker', canSpeak: true, canVideo: true });
  assert.equal(promoted.canSpeak, true); assert.equal(promoted.role, 'speaker');
});

test('issuedBefore e activeSpeakers (segura do anel de fala)', () => {
  assert.equal(signaling.issuedBefore(100, 102000), true);
  assert.equal(signaling.issuedBefore(100, 100500), false, 'mesmo segundo: não dá pra afirmar que é antigo');
  assert.equal(signaling.issuedBefore(null, 1), true, 'sem iat = antigo');
  const heard = new Map([['a', 1000], ['b', 1300]]);
  const r = rooms.activeSpeakers(heard, 1350, 400);
  assert.deepEqual(r.active.sort(), ['a', 'b']);
  assert.equal(r.nextExpiry, 1400);
  assert.deepEqual(rooms.activeSpeakers(heard, 1500, 400).active, ['b']);
});

// ---------- servidor de verdade ----------
test('produce do microfone SEM canSpeak é recusado; câmera SEM canVideo é recusada; token antigo pode tudo', async () => {
  const mute = await joinWithSend('u-sem-fala', 'perm1', { canSpeak: false, canVideo: true });
  await assert.rejects(mute.produceMic(), /forbidden:speak/);
  const cam = await mute.produceCam();
  assert.ok(cam.producerId, 'com canVideo a câmera passa');
  const novid = await joinWithSend('u-sem-video', 'perm1', { canSpeak: true, canVideo: false });
  await assert.rejects(novid.produceCam(), /forbidden:video/);
  const mic = await novid.produceMic();
  assert.ok(mic.producerId);
  const old = await joinWithSend('u-antigo', 'perm1', {});
  assert.ok((await old.produceMic()).producerId, 'token sem claims publica o mic');
  assert.ok((await old.produceCam()).producerId, 'token sem claims publica a câmera');
  const aud = await joinWithSend('u-plateia', 'perm1', { role: 'audience' });
  await assert.rejects(aud.produceMic(), /forbidden:speak/, 'plateia do palco não fala');
  for (const c of [mute, novid, old, aud]) c.close();
  await sleep(100);
});

test('appData.paused cria o microfone PAUSADO no servidor (sem vazar áudio ao entrar mudo)', async () => {
  const a = await joinWithSend('u-pausado', 'perm2', {});
  const { producerId } = await a.produceMic({ paused: true });
  assert.equal(serverProducer('perm2', 'u-pausado', producerId).paused, true);
  const b = await joinWithSend('u-normal', 'perm2', {});
  const p2 = await b.produceMic();
  assert.equal(serverProducer('perm2', 'u-normal', p2.producerId).paused, false);
  a.close(); b.close();
  await sleep(100);
});

test('serverMuted no token: mic nasce pausado e resumeProducer é recusado', async () => {
  const a = await joinWithSend('u-silenciado', 'perm3', { serverMuted: true });
  assert.equal(a.welcome.serverState.serverMuted, true, 'welcome traz o estado imposto');
  const { producerId } = await a.produceMic();
  assert.equal(serverProducer('perm3', 'u-silenciado', producerId).paused, true);
  await assert.rejects(a.request('resumeProducer', { producerId }), /forbidden:server-muted/);
  a.close();
  await sleep(100);
});

test('POST /control: exige o segredo e valida a ação', async () => {
  const r401 = await postControl({ room: 'x', peerId: 'y', action: 'kick' }, 'errado');
  assert.equal(r401.status, 401);
  const bad = await postControl({ room: 'x', peerId: 'y', action: 'explodir' });
  assert.equal(bad.status, 400);
  const ok = await postControl({ room: 'sala-vazia', peerId: 'ninguem', action: 'pause-audio' });
  assert.equal(ok.status, 200); assert.equal(ok.body.found, false);
});

test('mudo da moderação (pause-audio) pausa o mic no servidor, avisa a pessoa e os outros; resume-allowed libera', async () => {
  const a = await joinWithSend('u-alvo', 'perm4', {});
  const b = await joinWithSend('u-outro', 'perm4', {});
  const { producerId } = await a.produceMic();
  await b.waitEvent('newProducer');
  const r = await postControl({ room: 'perm4', peerId: 'u-alvo', action: 'pause-audio' });
  assert.equal(r.status, 200); assert.equal(r.body.found, true);
  const st = await a.waitEvent('serverState');
  assert.equal(st.serverMuted, true);
  assert.equal(serverProducer('perm4', 'u-alvo', producerId).paused, true);
  const paused = await b.waitEvent('producerPaused');
  assert.equal(paused.producerId, producerId);
  await assert.rejects(a.request('resumeProducer', { producerId }), /forbidden:server-muted/, 'não consegue se desmutar');
  await postControl({ room: 'perm4', peerId: 'u-alvo', action: 'resume-allowed' });
  const st2 = await a.waitEvent('serverState');
  assert.equal(st2.serverMuted, false);
  await a.request('resumeProducer', { producerId });
  assert.equal(serverProducer('perm4', 'u-alvo', producerId).paused, false);
  a.close(); b.close();
  await sleep(100);
});

test('set-perms sem VIDEO fecha a câmera que estava no ar; ensurdecer pausa o áudio recebido', async () => {
  const a = await joinWithSend('u-cam', 'perm5', {});
  const b = await joinWithSend('u-ouvinte', 'perm5', {});
  const cam = await a.produceCam();
  const mic = await a.produceMic();
  const recv = await b.request('createTransport', { direction: 'recv' });
  const caps = rooms.rooms.get('perm5').router.rtpCapabilities;
  const cons = await b.request('consume', { transportId: recv.id, producerId: mic.producerId, rtpCapabilities: caps });
  const r1 = await b.request('resumeConsumer', { consumerId: cons.consumerId });
  assert.equal(r1.paused, false);
  // Ensurdecido pela moderação: o áudio que ele recebe fica pausado no servidor.
  await postControl({ room: 'perm5', peerId: 'u-ouvinte', action: 'set-perms', perms: { serverDeafened: true } });
  await b.waitEvent('serverState');
  const sc = rooms.rooms.get('perm5').peers.get('u-ouvinte').consumers.get(cons.consumerId);
  assert.equal(sc.paused, true);
  const r2 = await b.request('resumeConsumer', { consumerId: cons.consumerId });
  assert.equal(r2.paused, true, 'resumeConsumer não fura o ensurdecer da moderação');
  // Ensurdecer por conta própria (economia de banda): pauseConsumer.
  await postControl({ room: 'perm5', peerId: 'u-ouvinte', action: 'set-perms', perms: { serverDeafened: false } });
  await b.waitEvent('serverState');
  assert.equal(sc.paused, false);
  const r3 = await b.request('pauseConsumer', { consumerId: cons.consumerId });
  assert.equal(r3.paused, true);
  // Sem VIDEO: a câmera da u-cam é fechada.
  await postControl({ room: 'perm5', peerId: 'u-cam', action: 'set-perms', perms: { canVideo: false } });
  const st = await a.waitEvent('serverState');
  assert.deepEqual(st.closedProducerIds, [cam.producerId]);
  assert.equal(serverProducer('perm5', 'u-cam', cam.producerId), undefined);
  await assert.rejects(a.produceCam(), /forbidden:video/);
  a.close(); b.close();
  await sleep(100);
});

test('kick: avisa, fecha com 4403 e o token antigo não volta; token novo entra', async () => {
  const oldIat = Math.floor(Date.now() / 1000) - 30;
  const oldToken = jwt.sign({ sub: 'u-expulso', room: 'perm6', jti: 'velho', iat: oldIat }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const a = await connect(oldToken);
  await a.waitEvent('welcome');
  await postControl({ room: 'perm6', peerId: 'u-expulso', action: 'kick', reason: 'moved' });
  const k = await a.waitEvent('kicked');
  assert.equal(k.reason, 'moved');
  assert.equal(await a.closed, 4403);
  const again = await connect(oldToken);
  assert.equal(await again.closed, 4403, 'token emitido antes da expulsão é recusado');
  await sleep(1100);
  const fresh = await connect(tokenFor('u-expulso', 'perm6'));
  await fresh.waitEvent('welcome');
  fresh.close();
  await sleep(100);
});

test('ordem do backend vale pra reconexão com token ANTIGO (mudo não some ao reconectar)', async () => {
  const oldIat = Math.floor(Date.now() / 1000) - 30;
  await postControl({ room: 'perm7', peerId: 'u-reconecta', action: 'pause-audio' });
  const oldToken = jwt.sign({ sub: 'u-reconecta', room: 'perm7', jti: 'antes', iat: oldIat }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  const a = await connect(oldToken);
  const w = await a.waitEvent('welcome');
  assert.equal(w.serverState.serverMuted, true, 'token velho + ordem nova = continua mudo');
  a.close();
  await sleep(1100);
  // Token novo (o backend já calculou o estado certo — sem mudo) vence a ordem antiga.
  const b = await connect(tokenFor('u-reconecta', 'perm7', { serverMuted: false }));
  const w2 = await b.waitEvent('welcome');
  assert.equal(w2.serverState.serverMuted, false);
  b.close();
  await sleep(100);
});
