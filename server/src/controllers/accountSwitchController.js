const crypto = require('crypto');
const prisma = require('../config/prisma');

// "Trocar de conta" (até 5 contas por aparelho). O aparelho guarda um token
// por conta (criado depois de um login normal, com senha/2FA). Trocar usa o
// token pra abrir uma sessão nova daquela conta e encerra a sessão atual.
// Trocar a senha, desativar ou apagar a conta invalida esses tokens.
const TTL_DAYS = 90;
const hash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

// POST /auth/switch/remember — guarda a conta logada neste aparelho.
async function remember(req, res, next) {
  try {
    const raw = crypto.randomBytes(32).toString('base64url');
    // No máximo 10 tokens por conta (vários aparelhos); apaga os mais velhos.
    const old = await prisma.accountSwitchToken.findMany({ where: { userId: req.user.id }, orderBy: { lastUsedAt: 'desc' }, skip: 9, select: { id: true } });
    if (old.length) await prisma.accountSwitchToken.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    await prisma.accountSwitchToken.create({
      data: {
        userId: req.user.id, tokenHash: hash(raw), userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        expiresAt: new Date(Date.now() + TTL_DAYS * 86400000),
      },
    });
    res.json({ token: raw });
  } catch (err) { next(err); }
}

// POST /auth/switch { token } — entra na conta guardada.
async function switchAccount(req, res, next) {
  try {
    const raw = String(req.body?.token || '');
    if (raw.length < 20) return res.status(400).json({ error: 'Conta salva inválida.' });
    const row = await prisma.accountSwitchToken.findUnique({ where: { tokenHash: hash(raw) } });
    if (!row || row.expiresAt < new Date()) return res.status(401).json({ error: 'Essa conta saiu deste aparelho. Entre de novo com a senha.', code: 'SWITCH_EXPIRED' });
    const user = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.accountDisabledAt || user.isPlatformBanned) {
      await prisma.accountSwitchToken.delete({ where: { id: row.id } }).catch(() => {});
      return res.status(401).json({ error: 'Essa conta não está disponível.', code: 'SWITCH_EXPIRED' });
    }
    // Encerra a sessão atual deste aparelho antes de abrir a nova.
    await require('./authController').logoutCurrentSession?.(req);
    await prisma.accountSwitchToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + TTL_DAYS * 86400000) } });
    const session = await require('./authController').completeLogin(req, res, user);
    res.json(session);
  } catch (err) { next(err); }
}

// POST /auth/switch/forget { token } — tira a conta da lista do aparelho.
async function forget(req, res, next) {
  try {
    const raw = String(req.body?.token || '');
    if (raw) await prisma.accountSwitchToken.deleteMany({ where: { tokenHash: hash(raw) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function revokeAllFor(userId) {
  await prisma.accountSwitchToken.deleteMany({ where: { userId } }).catch(() => {});
}

module.exports = { remember, switchAccount, forget, revokeAllFor };
