// Tempo de resposta: cabeçalho Server-Timing (aparece na aba Rede do
// DevTools, em "Timing") + log de requisição lenta no console:
//   [lento] GET /api/bootstrap 812ms
// Serve pra achar o que pesa no carregamento sem precisar de APM.
const SLOW_MS = Number(process.env.SLOW_REQUEST_MS) || 500;

function msSince(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

// Só a rota sem a query string (pode ter token/código em ?x=) e cortada.
function cleanPath(url) {
  const raw = String(url || '');
  const q = raw.indexOf('?');
  return (q === -1 ? raw : raw.slice(0, q)).slice(0, 160);
}

function timingMiddleware({ slowMs = SLOW_MS, log = console.warn } = {}) {
  return function serverTiming(req, res, next) {
    const start = process.hrtime.bigint();
    const origWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithTiming(...args) {
      if (!res.headersSent) {
        try {
          const prev = res.getHeader('Server-Timing');
          const mine = `app;dur=${msSince(start).toFixed(1)}`;
          res.setHeader('Server-Timing', prev ? `${prev}, ${mine}` : mine);
        } catch { /* cabeçalho já enviado por outro caminho */ }
      }
      return origWriteHead.apply(this, args);
    };
    res.on('finish', () => {
      const ms = msSince(start);
      if (ms <= slowMs) return;
      // Socket.IO não passa pelo Express; o que sobra de "lento esperado"
      // é download de arquivo grande — só loga a API e o /media.
      const p = cleanPath(req.originalUrl || req.url);
      if (!p.startsWith('/api') && !p.startsWith('/media')) return;
      log(`[lento] ${req.method} ${p} ${Math.round(ms)}ms`);
    });
    next();
  };
}

module.exports = { timingMiddleware, cleanPath, SLOW_MS };
