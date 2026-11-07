/* Servidor "aquecendo" do deploy (só módulos nativos do Node).
 *
 * Num deploy o processo antigo morre e o novo só começa a ouvir a porta
 * depois do `npm ci` + `prisma db push` + espera do banco (~1 min). Nesse
 * meio-tempo ninguém atendia a porta: o proxy da hospedagem devolvia a
 * página de erro 503 dele, o site mostrava "Erro ao carregar" em cada tela
 * e o app Android relatava "[android-conexao] http 503".
 *
 * Agora o scripts/deploy.js abre ESTE servidor mínimo na porta enquanto
 * prepara o novo, e fecha logo antes de subir o servidor de verdade:
 *  - /api/* → 503 JSON { restarting: true } + Retry-After (o site espera e
 *    tenta de novo sozinho — client/src/utils/serverRestart.js);
 *  - /api/health → 503 (de propósito: o guarda de conexão do Android e do
 *    app de PC só consideram "no ar" quando o servidor real responde);
 *  - páginas → um aviso "Atualizando…" que recarrega sozinho quando o
 *    /api/health do servidor real responder.
 * Se a porta não puder ser usada (já ocupada etc.), só registra e segue —
 * o deploy nunca depende disto.
 */
const http = require('http');

const RETRY_AFTER_S = 10;

const PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atualizando o Project Club</title>
<style>
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111214;color:#e3e5e8;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px;box-sizing:border-box}
.card{max-width:380px;text-align:center;background:#1e1f22;border-radius:12px;padding:28px}
h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#b5bac1}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#5865f2;margin-bottom:14px;animation:p 1.2s ease-in-out infinite}
@keyframes p{50%{opacity:.3}}
@media (prefers-color-scheme:light){body{background:#f2f3f5;color:#060607}.card{background:#fff}p{color:#4e5058}}
</style></head>
<body><div class="card"><span class="dot"></span><h1>Atualizando o Project Club</h1>
<p>Estamos colocando a versão nova no ar. Esta página volta sozinha em alguns segundos.</p></div>
<script>
(function(){var d=3000;function t(){fetch('/api/health',{cache:'no-store'}).then(function(r){if(r.ok)location.reload();else s();}).catch(s);}
function s(){d=Math.min(d*1.5,15000);setTimeout(t,d);}setTimeout(t,d);})();
</script></body></html>`;

function handle(req, res) {
  const url = String(req.url || '/');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', String(RETRY_AFTER_S));
  res.setHeader('Connection', 'close');
  if (url.startsWith('/api/') || url === '/api' || url.startsWith('/socket.io')) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'O Project Club está sendo atualizado. Tente de novo em alguns segundos.', restarting: true }));
    return;
  }
  const accept = String(req.headers.accept || '');
  if (req.method === 'GET' && (accept.includes('text/html') || !/\.[a-z0-9]{1,8}$/i.test(url.split('?')[0]))) {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Atualizando');
}

// Abre o servidor. Devolve { close(): Promise<void>, listening: boolean }.
function startWarmupServer(port, { log = console.log } = {}) {
  const server = http.createServer(handle);
  const state = { listening: false };
  const ready = new Promise((resolve) => {
    server.once('error', (err) => {
      log(`[deploy] aviso "atualizando" não abriu na porta ${port}: ${err.code || err.message} (seguindo sem ele)`);
      resolve(false);
    });
    server.listen(port, () => {
      state.listening = true;
      log(`[deploy] aviso "atualizando" respondendo na porta ${port} enquanto o servidor novo sobe`);
      resolve(true);
    });
  });
  async function close() {
    const ok = await ready;
    if (!ok || !state.listening) return;
    await new Promise((resolve) => {
      server.close(() => resolve());
      // Conexões keep-alive seguram o close(); derruba todas na hora.
      server.closeAllConnections?.();
    });
    state.listening = false;
  }
  return { ready, close, get listening() { return state.listening; } };
}

// Mesma porta que o servidor vai usar (server/src/config/env.js): PORT do
// ambiente ou do server/.env; senão 80 em produção e 3000 no resto.
function resolveServerPort(env = process.env, dotenvText = '') {
  const fromFile = (name) => {
    const m = String(dotenvText || '').match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n#]*)`, 'm'));
    return m ? m[1].trim() : undefined;
  };
  const nodeEnv = env.NODE_ENV || fromFile('NODE_ENV') || 'development';
  const port = parseInt(env.PORT || fromFile('PORT') || (nodeEnv === 'production' ? '80' : '3000'), 10);
  return Number.isFinite(port) && port > 0 ? port : null;
}

module.exports = { startWarmupServer, handle, resolveServerPort, RETRY_AFTER_S };
