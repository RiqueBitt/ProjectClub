// Entrega assets PRÉ-COMPRIMIDOS (gerados no build por
// client/scripts/precompress.js): se existir `<arquivo>.br` e o navegador
// aceita brotli, manda ele; senão `<arquivo>.gz` se aceita gzip; senão
// deixa o express.static (e o gzip na hora do `compression`) cuidarem.
//
// Por que: comprimir na hora gasta CPU a cada request do MESMO arquivo. Com
// muita gente entrando ao mesmo tempo, isso vira uma fatia real da CPU do
// container. Do disco já comprimido o custo é só I/O — e brotli (nível 11,
// feito com calma no build) ainda fica ~15–20% menor que o gzip na hora.
//
// Mantém o mesmo Cache-Control/ETag/Last-Modified que o express.static
// daria pro arquivo original, pra o cache do navegador seguir igual.
const fs = require('fs');
const path = require('path');

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

// Cache curto do stat (evita bater no disco a cada request do mesmo asset;
// os arquivos em /assets são imutáveis, então pode ser bem generoso).
const statCache = new Map(); // file -> { st|null, at }
const STAT_TTL = 60 * 1000;
const STAT_MAX = 2000;
function statCached(file) {
  const now = Date.now();
  const hit = statCache.get(file);
  if (hit && now - hit.at < STAT_TTL) return hit.st;
  let st = null;
  try { const s = fs.statSync(file); if (s.isFile()) st = s; } catch { st = null; }
  if (statCache.size >= STAT_MAX) statCache.delete(statCache.keys().next().value);
  statCache.set(file, { st, at: now });
  return st;
}

function servePrecompressed(root, cacheHeaderFor) {
  const rootAbs = path.resolve(root);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ae = String(req.headers['accept-encoding'] || '');
    const wantBr = /\bbr\b/.test(ae);
    const wantGz = /\bgzip\b/.test(ae);
    if (!wantBr && !wantGz) return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    const ext = path.extname(rel).toLowerCase();
    if (!MIME[ext]) return next();
    const abs = path.normalize(path.join(rootAbs, rel));
    if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return next(); // sem ../
    const candidates = wantBr ? [['br', '.br'], ['gzip', '.gz']] : [['gzip', '.gz']];
    for (const [enc, suffix] of candidates) {
      if (enc === 'gzip' && !wantGz) continue;
      const file = abs + suffix;
      const st = statCached(file);
      if (!st) continue;
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      const cc = cacheHeaderFor ? cacheHeaderFor(abs) : null;
      if (cc) res.setHeader('Cache-Control', cc);
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Content-Type', MIME[ext]);
      res.setHeader('Content-Length', st.size);
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(file);
      stream.on('error', () => { if (!res.headersSent) { res.removeHeader('Content-Encoding'); res.removeHeader('Content-Length'); next(); } else res.destroy(); });
      stream.pipe(res);
      return;
    }
    next();
  };
}

module.exports = { servePrecompressed };
