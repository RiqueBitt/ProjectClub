// Fase 5 — "Entrar com o celular" (login por QR Code). A lógica de estados
// e as proteções moram em services/qrLogin.js; aqui só a parte HTTP.
//
// PC (sem login):   POST /api/auth/qr/start     → { secret, qrDataUrl, expiresAt }
//                   POST /api/auth/qr/poll      { secret } → { status }
//                   POST /api/auth/qr/exchange  { secret } → sessão (igual ao login)
// Celular (logado): POST /api/auth/qr/scan      { code } → quem está pedindo
//                   POST /api/auth/qr/approve   { code }
//                   POST /api/auth/qr/deny      { code }
const qrcode = require('qrcode');
const prisma = require('../config/prisma');
const env = require('../config/env');
const qr = require('../services/qrLogin');
const { describeDevice, maskIp } = require('../services/sessionSecurity');
const auth = require('./authController');

function sendError(res, next, err) {
  if (err instanceof qr.QrLoginError) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
}

const bodyToken = (req, key) => (typeof req.body?.[key] === 'string' ? req.body[key].trim() : '');

async function start(req, res, next) {
  try {
    const pairing = await qr.createPairing({ ip: req.ip, userAgent: req.headers['user-agent'] });
    const link = `${String(env.CLIENT_ORIGIN).replace(/\/+$/, '')}/entrar-qr?c=${encodeURIComponent(pairing.code)}`;
    // QR gerado aqui (biblioteca `qrcode` que o 2FA já usa) — o cliente só
    // mostra a imagem, sem dependência nova. O link em si não vai solto na
    // resposta: não tem botão de "copiar link" pra não virar isca de golpe.
    const qrDataUrl = await qrcode.toDataURL(link, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
    res.set('Cache-Control', 'no-store');
    res.json({ secret: pairing.secret, qrDataUrl, expiresAt: pairing.expiresAt, ttlSeconds: Math.round(qr.TTL_MS / 1000) });
  } catch (err) { next(err); }
}

async function poll(req, res, next) {
  try {
    const result = await qr.pollPairing(bodyToken(req, 'secret'));
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) { sendError(res, next, err); }
}

async function exchange(req, res, next) {
  try {
    const { userId } = await qr.consumePairing(bodyToken(req, 'secret'), { userAgent: req.headers['user-agent'] });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // Conta banida/suspensa/desativada entre a aprovação e a troca: nada de sessão.
    if (!user || auth.isAccountBlocked(user)) {
      return res.status(403).json({ error: 'Esta conta não pode entrar agora (banida, suspensa ou desativada).', code: 'blocked' });
    }
    // Aprovar a partir de uma sessão JÁ autenticada (que já passou pela
    // senha + 2FA quando foi criada) conta como autenticação completa.
    const session = await auth.completeLogin(req, res, user);
    res.set('Cache-Control', 'no-store');
    res.json({ ...session, via: 'qr' });
  } catch (err) { sendError(res, next, err); }
}

// Só quem já tem a conta verificada aprova acesso pra outro aparelho.
function requireVerified(req, res) {
  if (!req.user?.emailVerified) {
    res.status(403).json({ error: 'Confirme seu e-mail antes de aprovar acessos pelo celular.', code: 'unverified' });
    return false;
  }
  return true;
}

async function scan(req, res, next) {
  try {
    if (!requireVerified(req, res)) return;
    const row = await qr.scanPairing(bodyToken(req, 'code'), req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({
      device: describeDevice(row.requesterUa),
      network: maskIp(row.requesterIp),
      requestedAt: row.createdAt,
      expiresAt: row.expiresAt,
      account: { username: req.user.username, displayName: req.user.displayName },
    });
  } catch (err) { sendError(res, next, err); }
}

function decide(approve) {
  return async (req, res, next) => {
    try {
      if (!requireVerified(req, res)) return;
      await qr.decidePairing(bodyToken(req, 'code'), req.user.id, approve);
      require('../services/securityLog').logSecurityEvent(req, approve ? 'QR_LOGIN_APPROVED' : 'QR_LOGIN_DENIED').catch(() => {});
      res.json({ ok: true, status: approve ? 'APPROVED' : 'DENIED' });
    } catch (err) { sendError(res, next, err); }
  };
}

module.exports = { start, poll, exchange, scan, approve: decide(true), deny: decide(false) };
