const crypto = require('crypto');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { redis } = require('../config/redis');

// Chaves de acesso (passkeys): entrar com a digital, o rosto ou o PIN do
// aparelho (Windows Hello, Android, iPhone, chaveiro do Google/Apple).
// Biblioteca: @simplewebauthn/server. O desafio fica no Redis por 5 min.

const CHALLENGE_TTL = 300;
const MAX_KEYS = 10;

function rp(req) {
  // Origem pública do site (CLIENT_ORIGIN); o app do PC abre o mesmo site.
  const origin = String(env.CLIENT_ORIGIN || '').split(',')[0].trim() || `${req.protocol}://${req.get('host')}`;
  const host = new URL(origin).hostname;
  return { rpID: host, origin, rpName: 'Project Club' };
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const deviceName = (ua = '') => {
  if (/Electron/i.test(ua)) return 'App do PC';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Chave de acesso';
};

// GET /auth/passkeys
async function list(req, res, next) {
  try {
    const keys = await prisma.passkey.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, createdAt: true, lastUsedAt: true } });
    res.json({ passkeys: keys });
  } catch (err) { next(err); }
}

// POST /auth/passkeys/register/options
async function registerOptions(req, res, next) {
  try {
    const { generateRegistrationOptions } = require('@simplewebauthn/server');
    const existing = await prisma.passkey.findMany({ where: { userId: req.user.id }, select: { credentialId: true, transports: true } });
    if (existing.length >= MAX_KEYS) return res.status(400).json({ error: `Você já tem ${MAX_KEYS} chaves de acesso. Apague uma antes de criar outra.` });
    const { rpID, rpName } = rp(req);
    const options = await generateRegistrationOptions({
      rpName, rpID,
      userName: req.user.username || req.user.email,
      userDisplayName: req.user.displayName || req.user.username,
      userID: new TextEncoder().encode(req.user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((k) => ({ id: k.credentialId, transports: k.transports ? k.transports.split(',') : undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await redis.set(`passkey:reg:${req.user.id}`, options.challenge, 'EX', CHALLENGE_TTL);
    res.json(options);
  } catch (err) { next(err); }
}

// POST /auth/passkeys/register/verify { response, name? }
async function registerVerify(req, res, next) {
  try {
    const { verifyRegistrationResponse } = require('@simplewebauthn/server');
    const expectedChallenge = await redis.get(`passkey:reg:${req.user.id}`);
    if (!expectedChallenge) return res.status(400).json({ error: 'O pedido expirou. Tente de novo.' });
    await redis.del(`passkey:reg:${req.user.id}`);
    const { rpID, origin } = rp(req);
    let v;
    try {
      v = await verifyRegistrationResponse({ response: req.body?.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    } catch (e) { return res.status(400).json({ error: 'Não deu pra confirmar a chave de acesso.' }); }
    if (!v.verified || !v.registrationInfo) return res.status(400).json({ error: 'Não deu pra confirmar a chave de acesso.' });
    const c = v.registrationInfo.credential;
    const name = String(req.body?.name || '').trim().slice(0, 60) || deviceName(req.headers['user-agent']);
    const key = await prisma.passkey.create({
      data: { userId: req.user.id, credentialId: c.id, publicKey: b64u(c.publicKey), counter: c.counter || 0, transports: (c.transports || []).join(',') || null, name },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    require('../services/securityLog').logSecurityEvent(req, 'PASSKEY_ADDED').catch(() => {});
    res.status(201).json({ passkey: key });
  } catch (err) {
    if (err?.code === 'P2002') return res.status(400).json({ error: 'Essa chave de acesso já está na sua conta.' });
    next(err);
  }
}

// DELETE /auth/passkeys/:id
async function remove(req, res, next) {
  try {
    const r = await prisma.passkey.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!r.count) return res.status(404).json({ error: 'Chave não encontrada.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /auth/passkeys/login/options (sem login)
async function loginOptions(req, res, next) {
  try {
    const { generateAuthenticationOptions } = require('@simplewebauthn/server');
    const { rpID } = rp(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    const flowId = crypto.randomBytes(18).toString('base64url');
    await redis.set(`passkey:auth:${flowId}`, options.challenge, 'EX', CHALLENGE_TTL);
    res.json({ options, flowId });
  } catch (err) { next(err); }
}

// POST /auth/passkeys/login/verify { flowId, response } (sem login)
async function loginVerify(req, res, next) {
  try {
    const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
    const flowId = String(req.body?.flowId || '');
    const response = req.body?.response;
    const expectedChallenge = flowId ? await redis.get(`passkey:auth:${flowId}`) : null;
    if (!expectedChallenge || !response?.id) return res.status(400).json({ error: 'O pedido expirou. Tente de novo.' });
    await redis.del(`passkey:auth:${flowId}`);
    const key = await prisma.passkey.findUnique({ where: { credentialId: String(response.id) } });
    if (!key) return res.status(401).json({ error: 'Essa chave de acesso não está ligada a nenhuma conta.' });
    const { rpID, origin } = rp(req);
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: key.credentialId, publicKey: fromB64u(key.publicKey), counter: key.counter, transports: key.transports ? key.transports.split(',') : undefined },
      });
    } catch (e) { return res.status(401).json({ error: 'Não deu pra confirmar a chave de acesso.' }); }
    if (!v.verified) return res.status(401).json({ error: 'Não deu pra confirmar a chave de acesso.' });
    await prisma.passkey.update({ where: { id: key.id }, data: { counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() } });

    const auth = require('./authController');
    const user = await prisma.user.findUnique({ where: { id: key.userId } });
    if (!user) return res.status(401).json({ error: 'Conta não encontrada.' });
    if (user.isPlatformBanned) return res.status(403).json({ error: 'Esta conta foi banida da plataforma.', platformBanned: true, reason: user.platformBanReason || undefined });
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) return res.status(403).json({ error: `Esta conta está suspensa até ${new Date(user.suspendedUntil).toLocaleString('pt-BR')}.`, suspendedUntil: user.suspendedUntil });
    if (user.accountDisabledAt) return res.status(403).json({ error: 'Esta conta foi desativada. Se você quer reativá-la, entre em contato com a equipe do Project Club.', accountDisabled: true });
    // A chave de acesso já é um segundo fator (aparelho + digital/PIN): não pede 2FA.
    const session = await auth.completeLogin(req, res, user);
    res.json(session);
  } catch (err) { next(err); }
}

module.exports = { list, registerOptions, registerVerify, remove, loginOptions, loginVerify };
