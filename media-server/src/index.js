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
const crypto = require('crypto');
const { config, validate } = require('./config');
const rooms = require('./rooms');
const signaling = require('./signaling');

const errors = validate();
if (errors.length) {
  console.error('[media] configuração inválida:\n - ' + errors.join('\n - '));
  process.exit(1);
}

const startedAt = Date.now();
let shuttingDown = false;

// Comparação em tempo constante (não vaza o segredo por tempo de resposta).
function secretOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(config.secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Promessa rejeitada sem catch NÃO derruba mais o processo (o padrão do Node
// ≥ 15 é encerrar): registra e segue — uma chamada com erro não pode levar
// as outras salas junto.
process.on('unhandledRejection', (err) => { console.error('[media] promessa rejeitada sem tratamento:', err); });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') {
    // 503 sem nenhum worker vivo: o healthcheck do docker e o backend do
    // Project Club (que testa esta rota) param de mandar gente pra cá.
    const st = rooms.stats();
    const ok = st.workers > 0 && !shuttingDown;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok, uptime: Math.round((Date.now() - startedAt) / 1000), ...st }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/stats') {
    if (!secretOk(req.headers['x-media-secret'])) { res.writeHead(401); res.end(); return; }
    // ?deep=1: estado de cada transporte (ICE/DTLS) e bytes enviados por
    // consumer — diagnóstico de "eu falo mas não escuto".
    const deep = url.searchParams.get('deep') === '1';
    (async () => {
      const detail = [];
      for (const r of rooms.rooms.values()) {
        const peers = [];
        for (const p of r.peers.values()) {
          const row = { id: p.id, name: p.name, producers: p.producers.size, consumers: p.consumers.size };
          if (deep) {
            row.transports = [...p.transports.values()].map((t) => ({ id: t.id.slice(0, 6), ice: t.iceState, dtls: t.dtlsState, tuple: t.iceSelectedTuple ? `${t.iceSelectedTuple.protocol}:${t.iceSelectedTuple.remoteIp}` : null, dir: t.appData?.direction }));
            row.consumersDetail = [];
            for (const c of p.consumers.values()) {
              let bytes = null; try { const st = await c.getStats(); bytes = st.find((x) => x.type === 'outbound-rtp')?.byteCount ?? null; } catch { /* ok */ }
              row.consumersDetail.push({ kind: c.kind, of: c.appData?.peerId, paused: c.paused, producerPaused: c.producerPaused, score: c.score?.score, bytes });
            }
            row.producersDetail = [];
            for (const pr of p.producers.values()) {
              let bytes = null; try { const st = await pr.getStats(); bytes = st[0]?.byteCount ?? null; } catch { /* ok */ }
              row.producersDetail.push({ kind: pr.kind, paused: pr.paused, bytes });
            }
          }
          peers.push(row);
        }
        detail.push({ room: r.name, peers });
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ...rooms.stats(), rooms: detail }));
    })().catch((err) => { res.writeHead(500); res.end(String(err?.message || err)); });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Project Club media server');
});

let wss = null;
(async () => {
  await rooms.startWorkers();
  wss = signaling.attach(server);
  server.listen(config.port, config.host, () => {
    console.log(`[media] sinalização em http://${config.host}:${config.port}/ws · IP público anunciado: ${config.publicIp}`);
  });
})().catch((err) => { console.error('[media] falha ao iniciar:', err); process.exit(1); });

// Encerramento limpo (docker stop / systemd): fecha as salas avisando os
// clientes com 1012 (reconectam assim que o servidor voltar, em vez de
// esperar o batimento perceber) e sai.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[media] ${sig} — encerrando`);
    try { rooms.shutdown(); } catch { /* ok */ }
    if (wss) { for (const s of wss.clients) { try { s.close(1012, 'shutdown'); } catch { /* ok */ } } }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
