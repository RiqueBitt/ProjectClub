// Teste de voz de verdade contra o servidor de mídia de PRODUÇÃO (roda na VPS
// dentro do container do Playwright). Duas abas com microfone falso entram na
// mesma sala e conferem se o áudio de uma chega na outra (bytes RTP).
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { chromium, firefox } from 'playwright';

const SECRET = process.env.MEDIA_SERVER_SECRET;
const TURN_SECRET = process.env.TURN_SECRET;
const WS = 'wss://38-92-41-54.sslip.io/ws';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(payload) {
  const h = b64u({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const p = b64u({ ...payload, iat: now, exp: now + 600 });
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
function turn(user) {
  const username = `${Math.floor(Date.now() / 1000) + 3600}:${user}`;
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  return [
    { urls: ['stun:38-92-41-54.sslip.io:3478'] },
    { urls: ['turn:38-92-41-54.sslip.io:3478?transport=udp', 'turn:38-92-41-54.sslip.io:3478?transport=tcp'], username, credential },
  ];
}
const DIST = '/work/dist';
const srv = http.createServer((req, res) => {
  const p = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => srv.listen(8799, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FF = process.env.BROWSER === 'firefox';
const browser = FF
  ? await firefox.launch({ firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0 } })
  : await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
console.log('navegador:', FF ? 'firefox' : 'chromium');
const room = `pc_diag_${Date.now()}`;
let ok = true;
try {
  const A = await (await browser.newContext()).newPage();
  const B = await (await browser.newContext()).newPage();
  for (const [n, pg] of [['A', A], ['B', B]]) { pg.on('pageerror', (e) => console.log(n, 'pageerror', e.message)); pg.on('console', (m) => { if (m.type() === 'error') console.log(n, 'console', m.text()); }); }
  await A.goto('http://127.0.0.1:8799/'); await B.goto('http://127.0.0.1:8799/');
  await A.evaluate((a) => window.joinRoom(a), { url: WS, token: jwt({ sub: 'diag-a', room, name: 'A' }), userId: 'diag-a', iceServers: turn('diag-a') });
  await B.evaluate((a) => window.joinRoom(a), { url: WS, token: jwt({ sub: 'diag-b', room, name: 'B' }), userId: 'diag-b', iceServers: turn('diag-b') });
  await sleep(8000);
  const ev = async (pg) => (await pg.evaluate(() => window.events)).map((e) => e.type + (e.type === 'error' ? ':' + e.a[0] : '')).join(',');
  console.log('A eventos:', await ev(A));
  console.log('B eventos:', await ev(B));
  const [rxA, txA, rxB, txB] = await Promise.all([A.evaluate(() => window.bytesReceived()), A.evaluate(() => window.bytesSent()), B.evaluate(() => window.bytesReceived()), B.evaluate(() => window.bytesSent())]);
  console.log(`A enviou ${txA} recebeu ${rxA} | B enviou ${txB} recebeu ${rxB}`);
  ok = txA > 0 && txB > 0 && rxA > 0 && rxB > 0;
  const pair = await A.evaluate(async () => {
    const out = [];
    for (const t of [window.engine.sendTransport, window.engine.recvTransport]) {
      if (!t) continue;
      const s = await t.getStats();
      s.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) out.push(r.localCandidateId + '->' + r.remoteCandidateId); });
      const types = {}; s.forEach((r) => { if (r.type === 'local-candidate' || r.type === 'remote-candidate') types[r.id] = r.candidateType + '/' + r.protocol + '/' + (r.address || r.ip) + ':' + r.port; });
      out.push(JSON.stringify(types));
    }
    return out;
  }).catch((e) => String(e));
  console.log('A ICE:', JSON.stringify(pair).slice(0, 1500));
  await A.evaluate(() => window.engine.dispose()); await B.evaluate(() => window.engine.dispose());
} catch (e) { ok = false; console.log('ERRO', e.message); }
console.log(ok ? 'RESULTADO: AUDIO OK NOS DOIS SENTIDOS' : 'RESULTADO: FALHOU');
await browser.close(); srv.close(); process.exit(ok ? 0 : 1);
