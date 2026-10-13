// Servidor de mídia próprio do Project Club — ponto de entrada.
//
//   GET  /health            → { ok, uptime, ...stats }  (público; pro Caddy/monitor)
//   GET  /stats             → stats detalhadas (exige header x-media-secret)
//   WS   /ws?token=<jwt>    → sinalização (ver signaling.js)
//
// A mídia em si (RTP/ICE) NÃO passa por aqui: vai direto do cliente pros
// workers do mediasoup nas portas UDP/TCP MEDIA_RTC_MIN_PORT..MAX_PORT, no
// IP público MEDIA_PUBLIC_IP. Este processo só faz sinalização e controle.
const http = require('http');
const { config, validate } = require('./config');
const rooms = require('./rooms');
const signaling = require('./signaling');

const errors = validate();
if (errors.length) {
  console.error('[media] configuração inválida:\n - ' + errors.join('\n - '));
  process.exit(1);
}

const startedAt = Date.now();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000), ...rooms.stats() }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/stats') {
    if (req.headers['x-media-secret'] !== config.secret) { res.writeHead(401); res.end(); return; }
    const detail = [];
    for (const r of rooms.rooms.values()) {
      detail.push({ room: r.name, peers: [...r.peers.values()].map((p) => ({ id: p.id, name: p.name, producers: p.producers.size, consumers: p.consumers.size })) });
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ...rooms.stats(), rooms: detail }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Project Club media server');
});

(async () => {
  await rooms.startWorkers();
  signaling.attach(server);
  server.listen(config.port, config.host, () => {
    console.log(`[media] sinalização em http://${config.host}:${config.port}/ws · IP público anunciado: ${config.publicIp}`);
  });
})().catch((err) => { console.error('[media] falha ao iniciar:', err); process.exit(1); });

// Encerramento limpo (docker stop / systemd): fecha salas e sai.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[media] ${sig} — encerrando`);
    for (const r of rooms.rooms.values()) { try { r.close(); } catch { /* ok */ } }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
