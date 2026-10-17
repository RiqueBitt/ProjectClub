// Compatibilidade: engine NOVO do cliente falando com um servidor de mídia
// ANTIGO (a VM é atualizada à parte — pode haver uma janela em que o cliente
// novo chega antes). Um proxy WebSocket na frente do servidor de mídia imita
// o servidor antigo:
//   - métodos novos (pauseConsumer, closeConsumer, setConsumerPreferredLayers,
//     setConsumerPriority) respondem "método desconhecido" (igual ao default
//     do signaling.js antigo);
//   - appData.paused do produce é ignorado (o antigo criava o producer
//     tocando);
//   - welcome sem serverState e nenhum evento serverState.
// Confere que o ÁUDIO continua funcionando: entrar mudo não vaza som,
// desmutar é ouvido, ensurdecer/desensurdecer não quebra a recepção, vídeo
// com recepção sob medida não derruba nada, e o método recusado não é
// repetido em rajada.
// Rodar na raiz do repo:  node media-server/test/e2e-compat-servidor-antigo.mjs
import { createServer } from 'http';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const { WebSocketServer, WebSocket } = require(path.join(ROOT, 'media-server/node_modules/ws'));
const { build } = await import(require.resolve('vite', { paths: [path.join(ROOT, 'client')] }));

const SECRET = 'segredo-e2e-compat-0123456789';
process.env.MEDIA_SERVER_SECRET = SECRET;
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '43200';
process.env.MEDIA_RTC_MAX_PORT = '43300';
process.env.MEDIA_LOG_LEVEL = 'error';
process.env.MEDIA_SPEAKING_THRESHOLD = '-127';
const MEDIA_PORT = 4667;
const ROOM = 'pc_compat';
const NEW_METHODS = new Set(['pauseConsumer', 'closeConsumer', 'setConsumerPreferredLayers', 'setConsumerPriority']);

const assert = (cond, msg) => { if (!cond) throw new Error('FALHOU: ' + msg); console.log('  ✓', msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, msg, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ev = await page.evaluate(() => window.events);
    if (fn(ev)) { console.log('  ✓', msg); return ev; }
    await sleep(200);
  }
  const ev = await page.evaluate(() => window.events);
  throw new Error(`FALHOU (timeout): ${msg}\neventos: ${JSON.stringify(ev)}`);
}

// 1) servidor de mídia (atual) + proxy que imita o ANTIGO
const rooms = require(path.join(ROOT, 'media-server/src/rooms.js'));
const signaling = require(path.join(ROOT, 'media-server/src/signaling.js'));
await rooms.startWorkers();
const mediaHttp = createServer((req, res) => { res.writeHead(404); res.end(); });
signaling.attach(mediaHttp);
await new Promise((r) => mediaHttp.listen(MEDIA_PORT, '127.0.0.1', r));

const refused = {}; // método -> o MAIOR número de pedidos numa mesma conexão
const proxyHttp = createServer((req, res) => { res.writeHead(404); res.end(); });
const pwss = new WebSocketServer({ server: proxyHttp, path: '/ws' });
pwss.on('connection', (client, req) => {
  const up = new WebSocket(`ws://127.0.0.1:${MEDIA_PORT}${req.url}`);
  const mine = {};
  const queue = [];
  up.on('open', () => { while (queue.length) up.send(queue.shift()); });
  up.on('message', (raw) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.event === 'serverState') return; // o antigo não tinha
    if (msg.event === 'welcome' && msg.data) delete msg.data.serverState;
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  });
  up.on('close', (code, reason) => { try { client.close(code, String(reason || '')); } catch { /* ok */ } });
  client.on('message', (raw) => {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (NEW_METHODS.has(msg.method)) {
      mine[msg.method] = (mine[msg.method] || 0) + 1;
      refused[msg.method] = Math.max(refused[msg.method] || 0, mine[msg.method]);
      client.send(JSON.stringify({ id: msg.id, ok: false, error: `método desconhecido: ${msg.method}` }));
      return;
    }
    if (msg.method === 'produce' && msg.data?.appData) delete msg.data.appData.paused;
    const out = JSON.stringify(msg);
    if (up.readyState === WebSocket.OPEN) up.send(out); else queue.push(out);
  });
  client.on('close', () => { try { up.close(); } catch { /* ok */ } });
});
await new Promise((r) => proxyHttp.listen(0, '127.0.0.1', r));
const WS = `ws://127.0.0.1:${proxyHttp.address().port}/ws`;
console.log('servidor de mídia + proxy "antigo" ok');

// 2) página-teste
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-compat-'));
await build({
  configFile: false, logLevel: 'error',
  root: path.join(ROOT, 'client/e2e/harness/mediasoup'),
  base: './',
  build: { outDir, emptyOutDir: true, target: 'esnext', minify: false },
});
fs.cpSync(path.join(ROOT, 'client/public/rnnoise'), path.join(outDir, 'rnnoise'), { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const pageHttp = createServer((req, res) => {
  const p = path.join(outDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(outDir) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => pageHttp.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${pageHttp.address().port}/`;

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const token = (sub, name) => jwt.sign({ sub, room: ROOM, name }, SECRET, { algorithm: 'HS256', expiresIn: '10m' });
// Bytes de áudio recebidos de `uid` (todas as faixas de áudio dele).
const audioFrom = (page, uid) => page.evaluate(async (u) => {
  let total = 0;
  for (const c of window.engine.consumers.values()) {
    if (c.peerId !== u || c.kind !== 'audio') continue;
    const stats = await c.consumer.getStats();
    stats.forEach((r) => { if (r.type === 'inbound-rtp') total += r.bytesReceived || 0; });
  }
  return total;
}, uid);
const serverMic = (uid) => {
  const peer = rooms.rooms.get(ROOM)?.peers.get(uid);
  return peer ? [...peer.producers.values()].find((p) => p.kind === 'audio' && p.appData?.source === 'mic') : null;
};

let failed = false;
try {
  const ctxA = await browser.newContext(); const A = await ctxA.newPage();
  const ctxB = await browser.newContext(); const B = await ctxB.newPage();
  A.on('pageerror', (e) => console.error('[A pageerror]', e.message));
  B.on('pageerror', (e) => console.error('[B pageerror]', e.message));
  await A.goto(PAGE); await B.goto(PAGE);

  console.log('\n[1] Ana entra normal; Beto entra MUDO (servidor antigo ignora appData.paused)');
  await A.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('ana', 'Ana'), userId: 'ana' });
  await waitFor(A, (ev) => ev.some((e) => e.type === 'selfMute' && e.a[0] === false), 'Ana: microfone publicado');
  await B.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId, startMuted: true }), { url: WS, token: token('beto', 'Beto'), userId: 'beto' });
  await waitFor(B, (ev) => ev.some((e) => e.type === 'selfMute' && e.a[0] === true), 'Beto: microfone publicado MUDO');
  await sleep(500);
  assert(serverMic('beto')?.paused === true, 'mic do Beto pausado NO SERVIDOR (pauseProducer explícito — nada vaza)');
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'ana' && e.a[1].active), 'Beto recebe o áudio da Ana');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'beto' && e.a[1].active), 'Ana tem a faixa do Beto');

  console.log('\n[2] Beto desmuta → Ana ouve');
  await B.evaluate(() => window.engine.setMicEnabled(true));
  await waitFor(B, (ev) => ev.filter((e) => e.type === 'selfMute').at(-1)?.a[0] === false, 'Beto: desmutado');
  assert(serverMic('beto')?.paused === false, 'mic do Beto tocando no servidor');
  const b0 = await audioFrom(A, 'beto'); await sleep(2000); const b1 = await audioFrom(A, 'beto');
  assert(b1 > b0, `Ana recebe RTP do Beto (${b0} → ${b1} B)`);

  console.log('\n[3] Ana ensurdece e desensurdece (pauseConsumer recusado pelo servidor antigo)');
  await A.evaluate(() => window.engine.setDeafened(true));
  await A.evaluate(() => window.engine.setDeafened(false));
  await sleep(500);
  const c0 = await audioFrom(A, 'beto'); await sleep(2000); const c1 = await audioFrom(A, 'beto');
  assert(c1 > c0, `depois de desensurdecer a Ana continua recebendo o Beto (${c0} → ${c1} B)`);
  const st = await A.evaluate(() => window.playback('beto'));
  assert(st.length && st.every((s) => !s.paused && s.trackLive), `<audio> do Beto tocando na Ana (${JSON.stringify(st)})`);
  const consumersOk = await A.evaluate(() => [...window.engine.consumers.values()].filter((c) => c.kind === 'audio').every((c) => !c.consumer.paused));
  assert(consumersOk, 'consumers de áudio retomados localmente');

  console.log('\n[4] Vídeo + recepção sob medida (setConsumerPriority/PreferredLayers/pauseConsumer recusados)');
  await A.evaluate(() => window.engine.setCamera(true));
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteVideo' && e.a[0] === 'ana' && e.a[1].active), 'Beto recebe a câmera da Ana');
  await B.evaluate(async () => {
    for (let i = 0; i < 20; i += 1) {
      window.engine.setVideoViewport('ana', 'camera', { visible: true, height: 100 + (i % 2) * 600 }, 'v1');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 20); });
    }
    window.engine.setVideoViewport('ana', 'camera', { visible: false, height: 0 }, 'v1');
    await new Promise((r) => { setTimeout(r, 100); });
    window.engine.setVideoViewport('ana', 'camera', { visible: true, height: 720 }, 'v1');
  });
  await sleep(500);
  assert((refused.setConsumerPreferredLayers || 0) <= 1, `camada preferida pedida no máximo 1 vez por sessão ao servidor antigo (${refused.setConsumerPreferredLayers || 0})`);
  assert((refused.pauseConsumer || 0) <= 1, `pauseConsumer pedido no máximo 1 vez por sessão (${refused.pauseConsumer || 0})`);
  const vidOk = await B.evaluate(() => [...window.engine.consumers.values()].filter((c) => c.kind === 'video').every((c) => !c.consumer.paused && !c.viewPaused));
  assert(vidOk, 'vídeo visível de novo: consumer retomado');
  const d0 = await audioFrom(B, 'ana'); await sleep(1500); const d1 = await audioFrom(B, 'ana');
  assert(d1 > d0, `o áudio da Ana continua chegando no Beto (${d0} → ${d1} B)`);

  console.log('\n[5] Mudo da moderação só pelo backend (servidor de mídia antigo não tem /control)');
  await B.evaluate(() => window.engine.applyModeration({ serverMuted: true, serverDeafened: false }));
  assert(await B.evaluate(() => window.engine.producers.mic.paused === true), 'Beto: mic pausado localmente pelo aviso do backend');
  const blocked = await B.evaluate(async () => { await window.engine.setMicEnabled(true); return window.engine.producers.mic.paused; });
  assert(blocked === true, 'Beto não consegue se desmutar enquanto silenciado');
  await B.evaluate(() => window.engine.applyModeration({ serverMuted: false, serverDeafened: false }));
  await sleep(500);
  assert(await B.evaluate(() => window.engine.producers.mic.paused === false), 'liberou: mic do Beto volta');
  assert(serverMic('beto')?.paused === false, 'mic do Beto tocando no servidor');
  const e0 = await audioFrom(A, 'beto'); await sleep(2000); const e1 = await audioFrom(A, 'beto');
  assert(e1 > e0, `Ana volta a ouvir o Beto (${e0} → ${e1} B)`);

  const errs = [...await A.evaluate(() => window.events), ...await B.evaluate(() => window.events)].filter((e) => e.type === 'error' || e.type === 'left');
  assert(errs.length === 0, `sem onError/onLeft (${JSON.stringify(errs)})`);
  await A.evaluate(() => window.engine.dispose());
  await B.evaluate(() => window.engine.dispose());
  console.log('\n✅ Compat (cliente novo × servidor de mídia antigo): tudo passou');
} catch (err) {
  failed = true;
  console.error('\n❌', err.message);
} finally {
  await browser.close();
  pageHttp.close(); proxyHttp.close(); mediaHttp.close();
  for (const r of rooms.rooms.values()) r.close();
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
