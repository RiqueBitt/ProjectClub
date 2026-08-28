const env = require('../config/env');

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  // Color-code by severity so a scroll of server logs is scannable at a
  // glance: a validation-style 4xx (expected, user-facing) in yellow, an
  // actual 5xx (unexpected, worth investigating) in red.
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const tag = useColor ? (status >= 500 ? '\x1b[31m[erro 5xx]\x1b[0m' : '\x1b[33m[erro 4xx]\x1b[0m') : `[erro ${status}]`;
  console.error(`${tag} ${req.method} ${req.originalUrl} —`, err.message || err);
  if (status >= 500) console.error(err.stack || err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    // Multer's own hard cap (see middleware/upload.js) is now the highest
    // possible per-server ceiling across every Impulsos tier (100MB) — the
    // *actual* limit for this specific server/upload type is enforced (and
    // reported back with its real number) inside the relevant controller,
    // so this generic fallback just covers truly oversized requests that
    // never even reach that check.
    return res.status(413).json({ error: 'Arquivo muito grande para ser enviado.' });
  }
  // Every 4xx thrown in this codebase is a hand-written, already user-safe
  // string (e.g. "Credenciais inválidas.") — fine to show verbatim. A bare
  // 500, though, usually carries a raw driver/library error message (DB
  // errors, stack internals, file paths, etc.) that shouldn't leak to
  // clients in production, so it's swapped for a generic message there. The
  // real message is still logged above either way.
  const message = status === 500 && env.NODE_ENV === 'production'
    ? 'Erro interno do servidor.'
    : (err.message || 'Erro interno do servidor.');
  res.status(status).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
