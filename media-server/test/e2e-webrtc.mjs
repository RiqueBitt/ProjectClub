// Teste ponta a ponta com WebRTC DE VERDADE: sobe o servidor de mídia, compila
// a página-teste do engine (client/e2e/harness/mediasoup) com o Vite, abre
// DUAS páginas no Chromium (microfone/câmera falsos) e confere que:
//   - as duas entram, cada uma recebe o áudio da outra (stream ativo)
//   - bytes RTP realmente trafegam pelo SFU (inbound/outbound-rtp > 0)
//   - câmera ligada numa aparece como vídeo na outra
//   - mudo/desmudo espelha o estado; quem sai some da outra
// Rodar na raiz do repo:  node media-server/test/e2e-webrtc.mjs
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
const { build } = await import(require.resolve('vite', { paths: [path.join(ROOT, 'client')] }));

const SECRET = 'segredo-e2e-webrtc-0123456789';
process.env.MEDIA_SERVER_SECRET = SECRET;
process.env.MEDIA_PUBLIC_IP = '127.0.0.1';
process.env.MEDIA_WORKERS = '1';
process.env.MEDIA_RTC_MIN_PORT = '43000';
process.env.MEDIA_RTC_MAX_PORT = '43100';
process.env.MEDIA_LOG_LEVEL = 'error';
process.env.MEDIA_SPEAKING_THRESHOLD = '-127'; // mic FAKE do Chromium é quase silêncio (~-105 dBov); em produção fica o padrão -60
const MEDIA_PORT = 4666;

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

// 1) servidor de mídia (em processo)
const rooms = require(path.join(ROOT, 'media-server/src/rooms.js'));
const signaling = require(path.join(ROOT, 'media-server/src/signaling.js'));
await rooms.startWorkers();
const mediaHttp = createServer((req, res) => { res.writeHead(404); res.end(); });
signaling.attach(mediaHttp);
await new Promise((r) => mediaHttp.listen(MEDIA_PORT, '127.0.0.1', r));
console.log('servidor de mídia ok');

// 2) compila a página-teste
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-harness-'));
await build({
  configFile: false, logLevel: 'error',
  root: path.join(ROOT, 'client/e2e/harness/mediasoup'),
  base: './',
  build: { outDir, emptyOutDir: true, target: 'esnext', minify: false },
});
console.log('harness compilado');

// 3) serve a página
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const pageHttp = createServer((req, res) => {
  const p = path.join(outDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!p.startsWith(outDir) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => pageHttp.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${pageHttp.address().port}/`;

// 4) navegador com mídia falsa (tom de áudio + vídeo sintético)
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const token = (sub, name) => jwt.sign({ sub, room: 'pc_e2e', name }, SECRET, { algorithm: 'HS256', expiresIn: '10m' });
const WS = `ws://127.0.0.1:${MEDIA_PORT}/ws`;

let failed = false;
try {
  const ctxA = await browser.newContext(); const A = await ctxA.newPage();
  const ctxB = await browser.newContext(); const B = await ctxB.newPage();
  A.on('pageerror', (e) => console.error('[A pageerror]', e.message));
  B.on('pageerror', (e) => console.error('[B pageerror]', e.message));
  await A.goto(PAGE); await B.goto(PAGE);

  console.log('\n[1] Ana entra');
  await A.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('ana', 'Ana'), userId: 'ana' });
  await waitFor(A, (ev) => ev.some((e) => e.type === 'joined' && e.a[0] === 'ana'), 'Ana: onJoined');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'selfMute' && e.a[0] === false), 'Ana: microfone publicado (não mudo)');

  console.log('\n[2] Beto entra — os dois devem receber o áudio um do outro');
  await B.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('beto', 'Beto'), userId: 'beto' });
  await waitFor(B, (ev) => ev.some((e) => e.type === 'joined'), 'Beto: onJoined');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'mediaUser' && e.a[0] === 'beto' && e.a[1] === true), 'Ana vê Beto na sala');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'beto' && e.a[1].active), 'Ana recebe stream de ÁUDIO do Beto (ativo)');
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'ana' && e.a[1].active), 'Beto recebe stream de ÁUDIO da Ana (ativo)');

  console.log('\n[3] Mídia real passando pelo SFU');
  await sleep(2500);
  const [rxA, txA, rxB, txB] = await Promise.all([A.evaluate(() => window.bytesReceived()), A.evaluate(() => window.bytesSent()), B.evaluate(() => window.bytesReceived()), B.evaluate(() => window.bytesSent())]);
  console.log(`    Ana: enviou ${txA} B, recebeu ${rxA} B · Beto: enviou ${txB} B, recebeu ${rxB} B`);
  assert(txA > 0 && txB > 0, 'os dois ENVIAM RTP (outbound-rtp > 0)');
  assert(rxA > 0 && rxB > 0, 'os dois RECEBEM RTP pelo SFU (inbound-rtp > 0)');

  console.log('\n[4] Quem está falando (AudioLevelObserver)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteSpeaking' && e.a[0] === 'beto' && e.a[1] === true) || ev.some((e) => e.type === 'localSpeaking' && e.a[0] === true), 'indicador de fala chega (local ou remoto)', 10000);

  console.log('\n[5] Ana liga a câmera → Beto recebe vídeo');
  const camOk = await A.evaluate(async () => !!(await window.engine.setCamera(true)));
  assert(camOk, 'Ana: setCamera(true) devolve o stream local');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'selfCamera' && e.a[0] === true), 'Ana: onSelfCamera(true)');
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteVideo' && e.a[0] === 'ana' && e.a[2] === 'camera' && e.a[1].active), 'Beto recebe stream de VÍDEO (câmera) da Ana');

  console.log('\n[6] Ana desliga a câmera → some pro Beto');
  await A.evaluate(() => window.engine.setCamera(false));
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteRemove' && e.a[0] === 'ana' && e.a[1] === 'video'), 'Beto: onRemoteRemove(ana, video)');

  console.log('\n[7] Mudo / desmudo');
  await A.evaluate(() => window.engine.setMicEnabled(false));
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'selfMute').at(-1)?.a[0] === true, 'Ana: onSelfMute(true)');
  await A.evaluate(() => window.engine.setMicEnabled(true));
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'selfMute').at(-1)?.a[0] === false, 'Ana: onSelfMute(false)');

  console.log('\n[8] Beto sai → Ana limpa');
  await B.evaluate(() => window.engine.dispose());
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteRemove' && e.a[0] === 'beto' && e.a[1] === 'all'), 'Ana: onRemoteRemove(beto, all)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'mediaUser' && e.a[0] === 'beto' && e.a[1] === false), 'Ana: Beto saiu da sala');
  const errsA = (await A.evaluate(() => window.events)).filter((e) => e.type === 'error');
  assert(errsA.length === 0, `sem onError na Ana (${JSON.stringify(errsA)})`);
  await A.evaluate(() => window.engine.dispose());
  await sleep(300);
  assert(rooms.stats().rooms === 0, 'sala fechada no servidor depois que todos saíram');
  console.log('\n✅ E2E WebRTC: tudo passou');
} catch (err) {
  failed = true;
  console.error('\n❌', err.message);
} finally {
  await browser.close();
  pageHttp.close(); mediaHttp.close();
  for (const r of rooms.rooms.values()) r.close();
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
