// App Android nativo → página do site dentro do app (WebView), já logado.
//
// O jogo da Praça (Club Penguin, Flash via Ruffle) só roda numa página web.
// O app nativo não pode emprestar o cookie de sessão dele pro WebView: o
// refresh token é rotativo e de uso único — se o WebView o usasse, a sessão
// do app morreria. Então:
//   POST /api/auth/app-handoff            (app, logado + cookie de sessão vivo)
//        → { code } de uso único, 2 minutos
//   GET  /api/auth/app-handoff/:code?to=/praca/app
//        → cria uma sessão NOVA (cookie) pro WebView e redireciona pra `to`
// A sessão do WebView aparece na lista de sessões como o mesmo aparelho (o
// WebView usa o mesmo User-Agent do app) e vive sozinha dali em diante.
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { hashToken } = require('../services/tokens');
const auth = require('./authController');

const TTL_MS = 2 * 60 * 1000;
const codes = new Map(); // hash → { userId, expiresAt }

function sweep() {
  const now = Date.now();
  for (const [k, v] of codes) if (v.expiresAt <= now) codes.delete(k);
}

// Só com uma sessão viva (cookie de refresh) desta conta — um token de
// acesso roubado (15 min) não vira sessão de 90 dias.
async function hasLiveSession(req) {
  const raw = req.cookies?.refreshToken;
  if (typeof raw !== 'string' || !raw) return false;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!row || row.userId !== req.user.id) return false;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return false;
  // rotação normal muito recente (o app acabou de renovar) ainda conta como viva
  if (row.revoked && !(row.revokedReason === 'ROTATED' && row.revokedAt && Date.now() - new Date(row.revokedAt).getTime() < 60_000)) return false;
  return true;
}

async function create(req, res, next) {
  try {
    if (!(await hasLiveSession(req))) return res.status(403).json({ error: 'Entre de novo no app para abrir o jogo.' });
    sweep();
    const code = crypto.randomBytes(24).toString('base64url');
    codes.set(hashToken(code), { userId: req.user.id, expiresAt: Date.now() + TTL_MS });
    res.set('Cache-Control', 'no-store');
    return res.json({ code, expiresIn: TTL_MS / 1000 });
  } catch (err) { return next(err); }
}

function safePath(to) {
  const p = typeof to === 'string' ? to : '';
  return p.startsWith('/') && !p.startsWith('//') ? p : '/praca/app';
}

async function consume(req, res, next) {
  try {
    sweep();
    const key = hashToken(String(req.params.code || ''));
    const entry = codes.get(key);
    codes.delete(key);
    if (!entry) return res.status(410).type('text').send('Este link de entrada expirou. Abra o jogo de novo pelo app.');
    const user = await prisma.user.findUnique({ where: { id: entry.userId } });
    if (!user || auth.isAccountBlocked(user)) return res.status(403).type('text').send('Esta conta não pode entrar agora.');
    await auth.completeLogin(req, res, user);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, safePath(req.query.to));
  } catch (err) { return next(err); }
}

module.exports = { create, consume };
