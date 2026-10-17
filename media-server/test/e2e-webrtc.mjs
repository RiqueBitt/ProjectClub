// Teste ponta a ponta com WebRTC DE VERDADE: sobe o servidor de mídia, compila
// a página-teste do engine (client/e2e/harness/mediasoup) com o Vite, abre
// DUAS páginas no Chromium (microfone/câmera falsos) e confere que:
//   - as duas entram, cada uma recebe o áudio da outra (stream ativo)
//   - bytes RTP realmente trafegam pelo SFU (inbound/outbound-rtp > 0)
//   - câmera ligada numa aparece como vídeo na outra
//   - mudo/desmudo espelha o estado; quem sai some da outra
//   - o áudio remoto TOCA de verdade num <audio> próprio (caminho principal do
//     app, voice/audioPlayback.js), com reforço por Web Audio, mudo e auto-cura
//   - microfone negado → entra só ouvindo e ouve os outros
//   - ICE restart (restartIce) sem refazer a sessão; token vencido (4401) é
//     renovado na reconexão; autoplay bloqueado toca no 1º clique
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
// RNNoise (worklet + wasm) é servido estático em /rnnoise/, igual em produção.
fs.cpSync(path.join(ROOT, 'client/public/rnnoise'), path.join(outDir, 'rnnoise'), { recursive: true });
console.log('harness compilado');

// 3) serve a página
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
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

  console.log('\n[3b] Reprodução: o áudio do Beto TOCA num <audio> próprio na Ana (caminho principal)');
  {
    const okPlaying = async (page, uid, msg, timeout = 10000) => {
      const t0 = Date.now(); let st = null;
      while (Date.now() - t0 < timeout) {
        st = await page.evaluate((u) => window.playback(u), uid);
        if (st.length && st.every((s) => !s.paused && s.trackLive)) { console.log('  ✓', msg); return st; }
        await sleep(200);
      }
      throw new Error(`FALHOU (timeout): ${msg} ${JSON.stringify(st)}`);
    };
    const st = await okPlaying(A, 'beto', 'Ana: <audio> do Beto tocando (paused=false, faixa viva)');
    assert(st[0].mode === 'element' && st[0].muted === false && st[0].volume === 1, `modo elemento, sem mudo, volume 100% (${JSON.stringify(st[0])})`);
    const t1 = (await A.evaluate(() => window.playback('beto')))[0].currentTime;
    await sleep(1500);
    const t2 = (await A.evaluate(() => window.playback('beto')))[0].currentTime;
    assert(t2 > t1, `o tempo do <audio> anda (${t1.toFixed(2)} → ${t2.toFixed(2)})`);
    assert((await A.evaluate(() => window.audioElements())) >= 1, 'elemento <audio data-voice-uid> no DOM');
    await A.evaluate(() => window.setVolume('beto', 1.6));
    const boosted = (await A.evaluate(() => window.playback('beto')))[0];
    assert(boosted.mode === 'webaudio' && boosted.muted === true && !boosted.paused && boosted.ctx === 'running', `volume 160% → Web Audio com o contexto rodando, elemento mudo mas tocando (${JSON.stringify(boosted)})`);
    await A.evaluate(() => window.setVolume('beto', 0));
    const silent = (await A.evaluate(() => window.playback('beto')))[0];
    assert(silent.mode === 'element' && silent.muted === true, 'volume 0 (ensurdecer) → elemento mudo');
    await A.evaluate(() => window.setVolume('beto', 1));
    const back = (await A.evaluate(() => window.playback('beto')))[0];
    assert(back.mode === 'element' && back.muted === false && !back.paused, 'volume 100% → volta pro elemento, com som');
    const bytesB = await A.evaluate(() => window.engine.getInboundAudioBytes('beto'));
    assert(bytesB > 0, `getInboundAudioBytes(beto) = ${bytesB} B (auto-cura/diagnóstico)`);
    // Auto-cura: algo pausou o <audio> (troca de saída, extensão, SO) com os
    // bytes chegando → o player volta a tocar sozinho.
    await A.evaluate(() => document.querySelector('audio[data-voice-uid="beto"]').pause());
    const t0 = Date.now(); let healed = null;
    while (Date.now() - t0 < 8000) { healed = (await A.evaluate(() => window.playback('beto')))[0]; if (!healed.paused && healed.heals > 0) break; await sleep(250); }
    assert(healed && !healed.paused && healed.heals > 0, `<audio> pausado por fora volta a tocar sozinho (heals=${healed?.heals})`);
  }

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

  console.log('\n[6b] Tela a partir de uma faixa pronta (captura nativa do app Android) + qualidade ao vivo');
  const scr = await A.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    window.__scrTimer = setInterval(() => { g.fillStyle = `hsl(${Date.now() % 360},80%,50%)`; g.fillRect(0, 0, 640, 360); }, 50);
    const track = c.captureStream(12).getVideoTracks()[0];
    const stream = await window.engine.setScreen(true, { track, audio: false });
    const q = await window.engine.setScreenQuality({ quality: '720p', frameRate: 15 });
    return { ok: !!stream, same: window.engine.localTracks.screen === track, quality: q };
  });
  assert(scr.ok && scr.same, 'setScreen(true, { track }) publica a faixa pronta como tela');
  assert(scr.quality === true, 'setScreenQuality troca resolução/fps ao vivo');
  await waitFor(B, (ev) => ev.some((e) => e.type === 'remoteVideo' && e.a[0] === 'ana' && e.a[2] === 'screen' && e.a[1].active), 'Beto recebe a TELA da Ana');
  await A.evaluate(async () => { await window.engine.setScreen(false); clearInterval(window.__scrTimer); });
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'selfScreen').at(-1)?.a[0] === false, 'Ana: onSelfScreen(false)');

  console.log('\n[7] Mudo / desmudo');
  await A.evaluate(() => window.engine.setMicEnabled(false));
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'selfMute').at(-1)?.a[0] === true, 'Ana: onSelfMute(true)');
  await A.evaluate(() => window.engine.setMicEnabled(true));
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'selfMute').at(-1)?.a[0] === false, 'Ana: onSelfMute(false)');

  console.log('\n[7a] Portão do microfone (apertar-pra-falar): silêncio sem mudar o mudo');
  const gate = await A.evaluate(async () => {
    const e = window.engine;
    const muteEvents = () => window.events.filter((x) => x.type === 'selfMute').length;
    const m0 = muteEvents();
    e.setMicGate(false);
    const closed = e.localTracks.mic.enabled;
    // Mudar e desmutar com o portão fechado: o resume() não pode reabrir a faixa.
    await e.setMicEnabled(false);
    await e.setMicEnabled(true);
    const afterUnmute = e.localTracks.mic.enabled;
    e.setMicGate(true);
    const opened = e.localTracks.mic.enabled;
    const raw = e.getLocalMicTrack({ raw: true });
    return { closed, afterUnmute, opened, raw: !!raw && raw.readyState === 'live', muteDelta: muteEvents() - m0, paused: e.producers.mic.paused };
  });
  assert(gate.closed === false, 'portão fechado: faixa do mic desabilitada');
  assert(gate.afterUnmute === false, 'desmutar com o portão fechado continua em silêncio');
  assert(gate.opened === true && gate.paused === false, 'portão aberto: faixa volta e o producer está no ar');
  assert(gate.raw, 'getLocalMicTrack({ raw: true }) devolve a captura viva (pro medidor de nível)');
  assert(gate.muteDelta === 2, 'o portão não dispara onSelfMute (só o mudo/desmudo manual)');

  console.log('\n[7b] Qualidade da conexão e ping (getStats de verdade)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'netQuality' && e.a[0].ana >= 1 && e.a[0].beto >= 1), 'Ana: onNetQuality com ela e o Beto (1..6)', 8000);
  await waitFor(A, (ev) => ev.some((e) => e.type === 'rtt' && Number.isFinite(e.a[0]) && e.a[0] >= 0), 'Ana: onRtt(ms)', 8000);
  const qA = (await A.evaluate(() => window.events)).filter((e) => e.type === 'netQuality').at(-1).a[0];
  assert(qA.ana <= 2 && qA.beto <= 2, `em rede local a qualidade é excelente/boa (ana=${qA.ana}, beto=${qA.beto})`);

  console.log('\n[7c] Queda da conexão → reconecta sozinho sem sair da sala');
  const before = await B.evaluate(() => window.events.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'ana').length);
  // Simula a queda: o SERVIDOR mata o socket da Ana (como se o wi-fi tivesse caído).
  for (const r of rooms.rooms.values()) { const p = r.peers.get('ana'); if (p) p.socket.terminate(); }
  await waitFor(A, (ev) => ev.some((e) => e.type === 'reconnecting' && e.a[0] === 1), 'Ana: onReconnecting(1)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'reconnected'), 'Ana: onReconnected()', 15000);
  await waitFor(A, (ev) => ev.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'beto').length >= 2, 'Ana volta a receber o áudio do Beto', 10000);
  await waitFor(B, (ev) => ev.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'ana').length > before, 'Beto volta a receber o áudio da Ana', 10000);
  assert(!(await A.evaluate(() => window.events.some((e) => e.type === 'left'))), 'Ana NÃO foi derrubada (sem onLeft)');
  await sleep(2000);
  const txA2 = await A.evaluate(() => window.bytesSent());
  assert(txA2 > 0, 'Ana envia RTP de novo depois de reconectar');

  console.log('\n[7d] Redutor de ruído (RNNoise no AudioWorklet)');
  const ctxC = await browser.newContext(); const C = await ctxC.newPage();
  C.on('pageerror', (e) => console.error('[C pageerror]', e.message));
  await C.goto(PAGE);
  await C.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId, noiseSuppression: true }), { url: WS, token: token('caio', 'Caio'), userId: 'caio' });
  await waitFor(C, (ev) => ev.some((e) => e.type === 'selfMute' && e.a[0] === false), 'Caio: microfone publicado com o redutor');
  const noiseOn = await C.evaluate(() => !!window.engine.noise && window.engine.localTracks.mic === window.engine.noise.track);
  assert(noiseOn, 'a faixa publicada é a saída do RNNoise (não o mic cru)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'caio' && e.a[1].active), 'Ana recebe o áudio processado do Caio');
  await sleep(2000);
  const txC = await C.evaluate(() => window.bytesSent());
  assert(txC > 0, 'Caio envia RTP com o redutor ligado');
  await C.evaluate(() => window.engine.setNoiseSuppression(false));
  await C.evaluate(() => window.engine.dispose());
  await ctxC.close();

  console.log('\n[7e] Worker do mediasoup morre → servidor segue vivo, os dois reconectam e voltam a se ouvir');
  {
    const aBefore = await A.evaluate(() => window.events.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'beto').length);
    const bBefore = await B.evaluate(() => window.events.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'ana').length);
    const recA = await A.evaluate(() => window.events.filter((e) => e.type === 'reconnected').length);
    const oldPid = rooms.aliveWorkers()[0].worker.pid;
    process.kill(oldPid, 'SIGKILL');
    await waitFor(A, (ev) => ev.filter((e) => e.type === 'reconnected').length > recA, 'Ana: reconectou depois da queda do worker', 20000);
    await waitFor(A, (ev) => ev.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'beto').length > aBefore, 'Ana volta a receber o áudio do Beto', 15000);
    await waitFor(B, (ev) => ev.filter((e) => e.type === 'remoteAudio' && e.a[0] === 'ana').length > bBefore, 'Beto volta a receber o áudio da Ana', 15000);
    assert(rooms.aliveWorkers().length === 1 && rooms.aliveWorkers()[0].worker.pid !== oldPid, 'worker novo no lugar do morto');
    await sleep(2500);
    const rx1 = await A.evaluate(() => window.bytesReceived());
    await sleep(1500);
    const rx2 = await A.evaluate(() => window.bytesReceived());
    assert(rx2 > rx1, `RTP voltou a chegar pela sala nova (${rx1} → ${rx2} B)`);
    assert(!(await A.evaluate(() => window.events.some((e) => e.type === 'left'))), 'Ana NÃO foi derrubada (sem onLeft)');
  }

  console.log('\n[7f] Mesma pessoa em 2 aparelhos → o antigo sai de vez, sem ping-pong');
  {
    const ctxD1 = await browser.newContext(); const D1 = await ctxD1.newPage();
    const ctxD2 = await browser.newContext(); const D2 = await ctxD2.newPage();
    await D1.goto(PAGE); await D2.goto(PAGE);
    await D1.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('duda', 'Duda'), userId: 'duda' });
    await waitFor(D1, (ev) => ev.some((e) => e.type === 'joined'), 'Duda (aparelho 1) entrou');
    const tokD2 = jwt.sign({ sub: 'duda', room: 'pc_e2e', name: 'Duda', jti: 'aparelho-2' }, SECRET, { algorithm: 'HS256', expiresIn: '10m' });
    await D2.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: tokD2, userId: 'duda' });
    await waitFor(D2, (ev) => ev.some((e) => e.type === 'joined'), 'Duda (aparelho 2) entrou');
    await waitFor(D1, (ev) => ev.some((e) => e.type === 'left' && e.a[0]?.reason === 'replaced'), 'aparelho 1 recebeu onLeft({ reason: "replaced" }) e não reconecta');
    await sleep(3000);
    const peerDuda = rooms.rooms.get('pc_e2e')?.peers.get('duda');
    assert(peerDuda && peerDuda.session === 'aparelho-2', 'a vaga continua com o aparelho 2 depois de 3s');
    assert(!(await D2.evaluate(() => window.events.some((e) => e.type === 'left'))), 'aparelho 2 não foi derrubado');
    await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'duda' && e.a[1].active), 'Ana ouve a Duda (aparelho 2)');
    await D2.evaluate(() => window.engine.dispose());
    await ctxD1.close(); await ctxD2.close();
    await waitFor(A, (ev) => ev.some((e) => e.type === 'mediaUser' && e.a[0] === 'duda' && e.a[1] === false), 'Duda saiu da sala');
  }

  console.log('\n[7g] Microfone NEGADO → entra só ouvindo e ouve os outros');
  {
    const ctxE = await browser.newContext();
    await ctxE.addInitScript(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => (c && c.audio ? Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) : orig(c));
    });
    const E = await ctxE.newPage();
    E.on('pageerror', (e) => console.error('[E pageerror]', e.message));
    await E.goto(PAGE);
    await E.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('eva', 'Eva'), userId: 'eva' });
    await waitFor(E, (ev) => ev.some((e) => e.type === 'joined'), 'Eva entrou mesmo sem microfone');
    await waitFor(E, (ev) => ev.some((e) => e.type === 'micUnavailable' && e.a[0].reason === 'denied'), 'Eva: onMicUnavailable({ reason: "denied" })');
    await waitFor(E, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'ana' && e.a[1].active), 'Eva recebe o áudio da Ana');
    const t0 = Date.now(); let st = [];
    while (Date.now() - t0 < 10000) { st = await E.evaluate(() => window.playback('ana')); if (st.length && !st[0].paused) break; await sleep(200); }
    assert(st.length && !st[0].paused && st[0].trackLive, `Eva: <audio> da Ana tocando (${JSON.stringify(st[0])})`);
    await sleep(2000);
    const rxE = await E.evaluate(() => window.bytesReceived());
    assert(rxE > 0, `Eva recebe RTP (${rxE} B) sem publicar nada`);
    assert((await E.evaluate(() => window.engine.producers.mic)) === null, 'Eva não tem producer de microfone');
    assert(!(await E.evaluate(() => window.events.some((e) => e.type === 'left' || e.type === 'error'))), 'Eva: sem onLeft/onError');
    await E.evaluate(() => window.engine.dispose());
    await ctxE.close();
  }

  console.log('\n[7h] ICE restart (restartIce) no transport de recepção da Ana — sem reconectar a sessão');
  {
    const recBefore = await A.evaluate(() => window.events.filter((e) => e.type === 'reconnecting').length);
    const recvIdOld = await A.evaluate(() => window.engine.recvTransport.id);
    await A.evaluate(() => window.engine._restartIce(window.engine.recvTransport, 'recv'));
    const t0 = Date.now(); let state = '';
    while (Date.now() - t0 < 10000) { state = await A.evaluate(() => window.engine.recvTransport?.connectionState); if (state === 'connected') break; await sleep(200); }
    assert(state === 'connected', 'transport de recepção conectado depois do ICE restart');
    assert((await A.evaluate(() => window.engine.recvTransport.id)) === recvIdOld, 'mesmo transport (não refez a sessão)');
    const rx1 = await A.evaluate(() => window.bytesReceived());
    await sleep(1500);
    const rx2 = await A.evaluate(() => window.bytesReceived());
    assert(rx2 > rx1, `RTP continua chegando depois do ICE restart (${rx1} → ${rx2} B)`);
    const recAfter = await A.evaluate(() => window.events.filter((e) => e.type === 'reconnecting').length);
    assert(recAfter === recBefore, 'nenhuma reconexão completa foi necessária');
  }

  console.log('\n[7i] Token vencido (4401 expired) na reconexão → pede token novo e volta');
  {
    const ctxG = await browser.newContext(); const G = await ctxG.newPage();
    G.on('pageerror', (e) => console.error('[G pageerror]', e.message));
    await G.goto(PAGE);
    await G.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('gabi', 'Gabi'), userId: 'gabi' });
    await waitFor(G, (ev) => ev.some((e) => e.type === 'joined'), 'Gabi entrou');
    const expired = jwt.sign({ sub: 'gabi', room: 'pc_e2e', name: 'Gabi', exp: Math.floor(Date.now() / 1000) - 600 }, SECRET, { algorithm: 'HS256' });
    const fresh = jwt.sign({ sub: 'gabi', room: 'pc_e2e', name: 'Gabi', jti: 'renovado' }, SECRET, { algorithm: 'HS256', expiresIn: '10m' });
    await G.evaluate(({ expired, fresh }) => { window.engine.joinOpts.token = expired; window.nextToken = fresh; }, { expired, fresh });
    for (const r of rooms.rooms.values()) { const p = r.peers.get('gabi'); if (p) p.socket.terminate(); }
    await waitFor(G, (ev) => ev.some((e) => e.type === 'reconnecting'), 'Gabi: reconectando');
    await waitFor(G, (ev) => ev.some((e) => e.type === 'reconnected'), 'Gabi: reconectou com o token novo', 20000);
    assert((await G.evaluate(() => window.refreshCalls)) === 1, 'refreshCredentials chamado 1 vez');
    assert(rooms.rooms.get('pc_e2e')?.peers.get('gabi')?.session === 'renovado', 'servidor aceitou a sessão do token novo');
    assert(!(await G.evaluate(() => window.events.some((e) => e.type === 'left'))), 'Gabi NÃO foi derrubada');
    await G.evaluate(() => window.engine.dispose());
    await ctxG.close();
  }

  console.log('\n[7j] Autoplay bloqueado (simulado) → avisa e toca sozinho no 1º clique de verdade');
  {
    // O Playwright dá "ativação de usuário" a todo evaluate(), então a política
    // real do Chrome nunca bloqueia aqui. Simula o navegador que bloqueia:
    // play() recusa com NotAllowedError até um pointerdown CONFIÁVEL (isTrusted).
    const ctxH = await browser.newContext();
    await ctxH.addInitScript(() => {
      let unlocked = false;
      document.addEventListener('pointerdown', (e) => { if (e.isTrusted) unlocked = true; }, true);
      const orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function play() {
        if (!unlocked) return Promise.reject(new DOMException("play() failed because the user didn't interact with the document first.", 'NotAllowedError'));
        return orig.call(this);
      };
      Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', { configurable: true, get() { return false; }, set() { /* ignora */ } });
    });
    const H = await ctxH.newPage();
    H.on('pageerror', (e) => console.error('[H pageerror]', e.message));
    await H.goto(PAGE);
    await H.evaluate(({ url, token, userId }) => window.joinRoom({ url, token, userId }), { url: WS, token: token('hugo', 'Hugo'), userId: 'hugo' });
    await waitFor(H, (ev) => ev.some((e) => e.type === 'remoteAudio' && e.a[0] === 'ana'), 'Hugo recebe o áudio da Ana');
    await waitFor(H, (ev) => ev.some((e) => e.type === 'playBlocked' && e.a[0] === 'ana'), 'onBlocked avisou (o app mostra "toque pra ativar o som")');
    const before = (await H.evaluate(() => window.playback('ana')))[0];
    assert(before && before.paused && before.blocked, `bloqueado: paused=${before?.paused} blocked=${before?.blocked}`);
    await H.mouse.click(5, 5);
    const t0 = Date.now(); let st = before;
    while (Date.now() - t0 < 8000) { st = (await H.evaluate(() => window.playback('ana')))[0]; if (st && !st.paused && !st.blocked) break; await sleep(200); }
    assert(st && !st.paused && !st.blocked, `Hugo: <audio> da Ana tocando depois do clique (${JSON.stringify(st)})`);
    await H.evaluate(() => window.engine.dispose());
    await ctxH.close();
  }

  console.log('\n[8] Beto sai → Ana limpa');
  await B.evaluate(() => window.engine.dispose());
  await waitFor(A, (ev) => ev.some((e) => e.type === 'remoteRemove' && e.a[0] === 'beto' && e.a[1] === 'all'), 'Ana: onRemoteRemove(beto, all)');
  await waitFor(A, (ev) => ev.some((e) => e.type === 'mediaUser' && e.a[0] === 'beto' && e.a[1] === false), 'Ana: Beto saiu da sala');
  assert((await A.evaluate(() => document.querySelectorAll('audio[data-voice-uid="beto"]').length)) === 0, 'Ana: <audio> do Beto removido (sem elemento órfão tocando)');
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
