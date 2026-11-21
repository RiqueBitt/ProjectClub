// Rotas internas: só o servidor Rust (o mesmo processo/servidor) chama,
// pra pedir ao Node o que ainda não foi pro Rust (e-mail, notificações,
// tempo real). Ver rust/PLANO.md.
//
// SEGURANÇA: exige o cabeçalho X-PC-Internal com um segredo derivado do
// JWT_ACCESS_SECRET (HMAC 'pc-internal-v1') — quem não tem o segredo do
// servidor recebe 404, como se a rota nem existisse. O Rust também
// responde 404 pra /api/internal vindo de fora.
const crypto = require('crypto');
const express = require('express');
const prisma = require('../config/prisma');
const env = require('../config/env');

function internalSecret() {
  return crypto.createHmac('sha256', String(env.JWT_ACCESS_SECRET)).update('pc-internal-v1').digest('hex');
}

function requireInternal(req, res, next) {
  const given = Buffer.from(String(req.get('x-pc-internal') || ''));
  const wanted = Buffer.from(internalSecret());
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    return res.status(404).json({ error: 'Rota não encontrada.' });
  }
  next();
}

const router = express.Router();
router.use(requireInternal);

// Login feito no Rust num aparelho novo → e-mail + aviso em Notificações.
router.post('/login-alert', async (req, res, next) => {
  try {
    const { userId, userAgent, ip, sessionId } = req.body || {};
    if (typeof userId !== 'string') return res.status(400).json({ error: 'userId obrigatório.' });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    require('../controllers/authController').notifyNewLogin(
      req.app, user, typeof userAgent === 'string' ? userAgent : undefined,
      typeof ip === 'string' ? ip : undefined, typeof sessionId === 'string' ? sessionId : undefined,
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// E-mails que o Rust pede (verificação de e-mail e "esqueci a senha").
// Espera o envio terminar (como o Node fazia na própria rota); falha de
// envio vira { ok: false } — quem chamou segue respondendo 200 à pessoa.
router.post('/email', async (req, res, next) => {
  try {
    const { kind, to, code, url } = req.body || {};
    if (typeof to !== 'string' || !to.includes('@')) return res.status(400).json({ error: 'to obrigatório.' });
    const email = require('../services/email');
    try {
      if (kind === 'verification' && typeof code === 'string') await email.sendVerificationCode(to, code);
      else if (kind === 'password-reset' && typeof url === 'string') await email.sendPasswordReset(to, url);
      else return res.status(400).json({ error: 'kind inválido.' });
    } catch (err) {
      console.error(`[internal/email] falha ao enviar (${kind}) para ${to}:`, err.message);
      return res.json({ ok: false });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Derruba os sockets de uma pessoa (conta desativada/excluída pelo Rust):
// o mesmo io.kickUser que o Node usa — avisa o evento e desconecta.
router.post('/kick', (req, res) => {
  const { userId, event, payload } = req.body || {};
  if (typeof userId !== 'string' || typeof event !== 'string') return res.status(400).json({ error: 'userId e event obrigatórios.' });
  req.app.get('io')?.kickUser?.(userId, event, payload && typeof payload === 'object' ? payload : {});
  res.json({ ok: true });
});

module.exports = { router, internalSecret };
