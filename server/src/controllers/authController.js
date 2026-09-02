const bcrypt = require('bcryptjs');
const { generateSecret, verify, generateURI, createGuardrails } = require('otplib');

// BUG CORRIGIDO — CAUSA RAIZ CONFIRMADA (erro 500 no login pra quem já
// tinha 2FA configurado): a migração pro otplib v13 passou a EXIGIR um
// segredo de pelo menos 16 bytes — mas contas configuradas com a v12
// antiga (o padrão de lá gerava só 10 bytes) têm segredos mais curtos
// que isso, então TODA verificação delas passou a estourar
// SecretTooShortError em vez de simplesmente validar o código, travando
// o login por completo pra quem já tinha 2FA ativo. "guardrails" é a
// forma oficial e documentada do próprio otplib de aceitar esses
// segredos mais antigos e mais curtos sem abrir mão da validação em si
// — só relaxa o TAMANHO mínimo aceito, não pula a checagem do código.
// generateSecret() (usado só quando alguém ativa 2FA pela primeira vez
// a partir de agora) continua gerando no padrão novo e mais seguro,
// sem precisar de nenhum guardrail — só afeta a VERIFICAÇÃO de
// segredos que já existem.
const legacyGuardrails = createGuardrails({ MIN_SECRET_BYTES: 10 });
const qrcode = require('qrcode');
const prisma = require('../config/prisma');
const env = require('../config/env');
const {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  generateNumericCode,
  generateOpaqueToken,
} = require('../services/tokens');
const { sendVerificationCode, sendPasswordReset } = require('../services/email');
const { clearIfExpired } = require('../services/customStatus');
const { maybePromoteToPlatformAdmin } = require('../services/adminBootstrap');
const { grantDueAgeBadges } = require('../services/ageBadges');
const { verifyRecaptcha } = require('../services/recaptcha');
const { getEveryoneRole } = require('../services/authz');
const { recordJoinAndCheck } = require('../services/antiraid');
const { grantStarterHouse } = require('../services/starterHouse');

// Shared by register and resetPassword — same floor either way, so it's
// not possible to register with a real password then "reset" into a weak
// one. Not full complexity rules (no forced special chars, that mostly
// just pushes people toward predictable "Password1!" patterns) — just
// enough to rule out the weakest all-digit/all-letter passwords a
// brute-force dictionary would try first.
function isPasswordStrongEnough(password) {
  return typeof password === 'string' && password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

// Used only to give bcrypt.compare real work to do when no matching user
// exists (see login's timing-attack fix below) — not a real account's
// hash, just a valid-format bcrypt hash so the comparison takes
// comparable time either way.
const DUMMY_PASSWORD_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8k5xBLwtQD8lWy4EXd0f3wnPPh4GX2';

// A human-friendly numeric account ID (see schema.prisma's comment on
// User.publicId) — 9 digits, retried on the astronomically unlikely
// collision. Called both at registration and lazily (see ensurePublicId
// below) for any account created before this field existed.
function generatePublicId() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}
async function ensurePublicId(userId, existingPublicId) {
  if (existingPublicId) return existingPublicId;
  for (let i = 0; i < 5; i += 1) {
    const candidate = generatePublicId();
    try {
      await prisma.user.update({ where: { id: userId }, data: { publicId: candidate } });
      return candidate;
    } catch (err) {
      if (err.code !== 'P2002') throw err; // unique clash on publicId — extremely unlikely, just retry
    }
  }
  return null;
}

// Safe to show to ANY other user (member lists, message authors, profile
// cards, moderation targets, DM participants...) — this is what gets sent
// over the wire to people who are NOT the account owner. Deliberately does
// NOT include email/emailVerified/twoFactorEnabled: those used to be in
// here and were leaking to every member of every shared server via
// broadcastUserUpdate and every member-list/message payload — see
// SELF_USER_FIELDS below for the account-owner-only superset.
const PUBLIC_USER_FIELDS = {
  id: true, publicId: true, username: true, displayName: true, avatarUrl: true,
  bannerUrl: true, miniProfileBannerUrl: true, bio: true, pronouns: true, profileColor: true, status: true,
  customStatus: true, customStatusEmoji: true, customStatusExpiresAt: true,
  createdAt: true, platformRole: true,
  tagEmoji: true, tagText: true,
  youtubeUrl: true, steamUrl: true, robloxUrl: true, xUrl: true,
  profileNameFont: true, profileNameEffect: true, profileNameColor: true, profileNameColor2: true,
  accountLevel: true, accountXp: true,
  // Conquistas escolhidas pra mostrar — públicas de propósito (é o que
  // aparece no perfil/miniperfil de qualquer pessoa que a gente veja).
  displayedAchievements: true, displayedAchievementsMini: true,
  // "Placa de identificação" (see schema.prisma's User.idCardUrl) — shown
  // as the background behind this user's own row in the members list
  // (MembersList.jsx), so it needs to be visible to everyone who can see
  // that member, not just the account owner.
  idCardUrl: true,
  // Item pedido: status de relacionamento (estilo Orkut) — só o ID
  // aqui (não um objeto aninhado, pra não pesar as centenas de lugares
  // que já usam esse mesmo select) — o perfil completo (getUser, em
  // userController.js) busca os dados do parceiro à parte, só quando
  // precisa.
  relationshipPartnerId: true,
  profileSectionOrder: true,
  // Item pedido: cor da barra de nível personalizável — pública (todo
  // visitante do perfil vê essa barra), por isso fica aqui junto com
  // profileColor, não em SELF_USER_FIELDS.
  levelBarColor: true,
};

// Everything PUBLIC_USER_FIELDS has, plus the account-owner-only fields
// (email, verification state, 2FA state) needed by your own Account/
// Security settings tabs. Only ever select this for a response going back
// to the account's own owner: login/register/refresh/me, and any
// self-service mutation (profile edit, avatar/banner upload, username
// change, tag pick...) whose result gets stored via AuthContext's setUser —
// that's a full-object replace client-side, so if one of those endpoints
// used PUBLIC_USER_FIELDS instead, the user's own email would silently
// vanish from their own session until their next login.
const SELF_USER_FIELDS = {
  ...PUBLIC_USER_FIELDS,
  email: true, emailVerified: true, twoFactorEnabled: true,
  // Item pedido: aniversário editável em "Editar Perfil" — a data
  // COMPLETA (com ano) só é exposta aqui, no seletor que a própria
  // pessoa usa pra ver os PRÓPRIOS dados (rota /auth/me). Em qualquer
  // lugar que mostra dados de OUTRA pessoa (recados, depoimentos,
  // perfil de visitante), continua usando PUBLIC_USER_FIELDS — que não
  // tem esse campo — só o booleano isBirthdayToday (ver getUser em
  // userController.js), sem revelar a idade de ninguém.
  birthDate: true,
  // Só a própria pessoa precisa saber o próprio tema escolhido — não faz
  // sentido expor isso no perfil público de ninguém.
  preferredTheme: true,
  // Idem pra privacidade de pedidos de amizade — cada um só vê/edita a
  // própria configuração.
  friendRequestPrivacy: true,
};

async function issueSession(res, user, userAgent, ipAddress) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { tokenHash: hash, userId: user.id, userAgent, ipAddress, expiresAt },
  });
  res.cookie('refreshToken', raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
  return accessToken;
}

async function register(req, res, next) {
  try {
    const { email, username, password, displayName, recaptchaToken } = req.body;
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'E-mail, usuário e senha são obrigatórios.' });
    }
    const captcha = await verifyRecaptcha(recaptchaToken);
    if (!captcha.ok) return res.status(400).json({ error: captcha.reason });
    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    }
    if (!isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: 'A senha deve conter letras e números.' });
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { username }] },
    });
    if (existing) {
      return res.status(409).json({ error: 'E-mail ou nome de usuário já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        username,
        displayName: displayName || username,
        passwordHash,
        publicId: generatePublicId(),
      },
    });

    // Toda conta nova entra automaticamente na comunidade (cargo @todos) —
    // não existe mais "criar/entrar em servidor" separado.
    const everyoneRole = await getEveryoneRole();
    if (everyoneRole) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: everyoneRole.id } }).catch(() => {});
    }
    await grantStarterHouse(user.id);
    // Conta nova já aparece na barra lateral/lista de membros de todo
    // mundo na hora, sem precisar recarregar a página.
    req.app.get('io')?.to('community').emit('community:update');
    // Anti-raid: observa ondas de cadastro (ver services/antiraid.js) — não
    // bloqueia o registro em si, só sinaliza/pune de forma assíncrona.
    recordJoinAndCheck(req.app.get('io'), user.id).catch(() => {});

    // Casa inicial de graça (adaptado do bot Robbie — fase 3): toda conta
    // nova já ganha a casa mais barata do catálogo (preço 0) automaticamente.
    prisma.houseCatalog.findFirst({ where: { price: 0 }, orderBy: { createdAt: 'asc' } })
      .then((starterHouse) => {
        if (!starterHouse) return;
        return prisma.userHouse.create({ data: { userId: user.id, houseId: starterHouse.id, isActive: true } });
      })
      .catch(() => {});

    const code = generateNumericCode(6);
    await prisma.emailVerificationCode.create({
      data: { userId: user.id, code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    });
    // Best-effort: the account is already created and usable at this point
    // (verification only gates a "verified" badge/features, not login — see
    // requireAuth). A transient SMTP hiccup shouldn't turn into a 500 that
    // leaves the user stuck on a half-created account they can't retry
    // registering (email/username already taken). They can always hit
    // "Reenviar código" on the verify-email screen once SMTP is healthy.
    try {
      await sendVerificationCode(user.email, code);
    } catch (err) {
      console.error(`[register] falha ao enviar e-mail de verificação para ${user.email}:`, err.message);
    }

    // Best-effort: the NEWCOMER badge is seeded by prisma/seed.js. If a
    // deployment hasn't run the seed yet, this silently no-ops rather than
    // failing the whole signup over a cosmetic badge.
    const newcomerBadge = await prisma.badge.findUnique({ where: { key: 'NEWCOMER' } }).catch(() => null);
    if (newcomerBadge) {
      await prisma.userBadge.create({ data: { userId: user.id, badgeId: newcomerBadge.id } }).catch(() => {});
    }

    const accessToken = await issueSession(res, user, req.headers['user-agent'], req.ip);
    const { passwordHash: _omit, twoFactorSecret: _omit2, ...publicUser } = user;
    res.status(201).json({ user: publicUser, accessToken });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { emailOrUsername, password, twoFactorCode } = req.body;
    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'Informe usuário/e-mail e senha.' });
    }
    // Item pedido: verificação de "não sou um robô" removida do login —
    // não roda mais nem no front nem aqui no back (o registro continua
    // com a verificação normal, só o login que não usa mais isso).

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailOrUsername.toLowerCase() }, { username: emailOrUsername }],
      },
    });

    // Per-account lockout check — see schema.prisma's comment on
    // User.failedLoginAttempts. Checked before even touching the password,
    // so a locked account can't be used to keep probing passwords during
    // its own cooldown.
    if (user?.loginLockedUntil && new Date(user.loginLockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(user.loginLockedUntil) - Date.now()) / 60000);
      return res.status(429).json({ error: `Muitas tentativas de login para esta conta. Tente novamente em ${mins} minuto(s).` });
    }

    // Security: bcrypt.compare always runs, even when no such account
    // exists, against a dummy hash — otherwise a missing user returns
    // instantly while a real one takes bcrypt's ~100ms, and that timing
    // difference alone is enough to enumerate which emails/usernames have
    // accounts without ever needing a correct password.
    const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      if (user) {
        const attempts = user.failedLoginAttempts + 1;
        // 10 consecutive misses locks the account for 15 minutes. Doesn't
        // reset on a correct-password-wrong-2FA-code attempt below — only
        // a fully successful login clears it — since a wrong password is
        // what actually matters for a credential-stuffing attempt.
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: attempts,
            loginLockedUntil: attempts >= 10 ? new Date(Date.now() + 15 * 60 * 1000) : undefined,
          },
        });
      }
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.isPlatformBanned) {
      return res.status(403).json({ error: 'Esta conta foi banida da plataforma.', platformBanned: true, reason: user.platformBanReason || undefined });
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return res.status(403).json({ error: `Esta conta está suspensa até ${new Date(user.suspendedUntil).toLocaleString('pt-BR')}.`, suspendedUntil: user.suspendedUntil });
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) {
        return res.status(206).json({ requiresTwoFactor: true });
      }
      // otplib v13 (atualizado — a v12 antiga estava depreciada):
      // authenticator.check() virou verify({secret, token}), agora
      // assíncrono e devolvendo { valid } em vez de um boolean direto.
      const { valid: isValid } = await verify({ secret: user.twoFactorSecret, token: twoFactorCode, guardrails: legacyGuardrails });
      if (!isValid) return res.status(401).json({ error: 'Código 2FA inválido.' });
    }

    await maybePromoteToPlatformAdmin(user);
    if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, loginLockedUntil: null } });
    }
    const accessToken = await issueSession(res, user, req.headers['user-agent'], req.ip);
    const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
    res.json({ user: selfUser, accessToken });
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    if (!raw) return res.status(401).json({ error: 'Sessão expirada.' });

    const hash = hashToken(raw);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    // Reuso de um token já rotacionado normalmente é sinal de roubo — mas
    // um caso benigno acontece com frequência: duas requisições quase
    // simultâneas usando o MESMO cookie (duas abas abrindo ao mesmo tempo,
    // ou o efeito de montagem duplicado do React em desenvolvimento) —
    // ambas chegam ao servidor antes do navegador processar o novo cookie
    // da primeira resposta. Por isso, um reuso dentro de uma margem curta
    // (10s) apenas emite uma sessão nova pro mesmo usuário, sem derrubar
    // nada; só um reuso REALMENTE tardio (token replay de verdade) aciona
    // a resposta nuclear de derrubar todas as sessões da conta.
    const GRACE_MS = 10 * 1000;
    if (stored?.revoked) {
      const withinGrace = stored.revokedAt && (Date.now() - stored.revokedAt.getTime()) < GRACE_MS;
      if (withinGrace) {
        const user = await prisma.user.findUnique({ where: { id: stored.userId } });
        if (user) {
          await maybePromoteToPlatformAdmin(user);
          const accessToken = await issueSession(res, user, req.headers['user-agent'], req.ip);
          const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
          return res.json({ user: selfUser, accessToken });
        }
      }
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revoked: false }, data: { revoked: true, revokedAt: new Date() } });
    }
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Sessão expirada.' });
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });

    // Rotate refresh token.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true, revokedAt: new Date() } });
    await maybePromoteToPlatformAdmin(user);
    const accessToken = await issueSession(res, user, req.headers['user-agent'], req.ip);
    const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
    res.json({ user: selfUser, accessToken });
  } catch (err) { next(err); }
}

async function logout(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    if (raw) {
      const hash = hashToken(raw);
      await prisma.refreshToken.updateMany({ where: { tokenHash: hash }, data: { revoked: true } });
    }
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// GET /auth/sessions — "where am I logged in" for the account's own Security
// tab. Every refresh token doubles as one logged-in session/device (a
// fresh one is minted on login AND on every token rotation — see
// issueSession/refresh above), so this is just the not-yet-revoked,
// not-yet-expired rows for this user, newest first, with a flag on
// whichever one matches the actual cookie making this very request (so the
// UI can label it "este dispositivo" and refuse to let it be revoked from
// its own list — that's what the logout button is for instead).
async function listSessions(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    const currentHash = raw ? hashToken(raw) : null;
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user.id, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userAgent: true, createdAt: true, tokenHash: true },
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, isCurrent: s.tokenHash === currentHash,
      })),
    });
  } catch (err) { next(err); }
}

// DELETE /auth/sessions/:id — end one specific session/device remotely
// (e.g. "I left myself logged in on a shared computer"). Can't be used on
// the session making the request itself — that's just a normal logout,
// which also needs to clear this browser's own cookie, not merely mark the
// row revoked server-side.
async function revokeSession(req, res, next) {
  try {
    const { id } = req.params;
    const raw = req.cookies?.refreshToken;
    const currentHash = raw ? hashToken(raw) : null;
    const session = await prisma.refreshToken.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Sessão não encontrada.' });
    if (session.tokenHash === currentHash) return res.status(400).json({ error: 'Use "Sair" para encerrar a sessão atual.' });
    await prisma.refreshToken.update({ where: { id }, data: { revoked: true } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// DELETE /auth/sessions — "log out everywhere else", the actual reinforced
// -security button: one click revokes every OTHER active session, leaving
// only the one making this request untouched (again, use plain logout to
// end that one).
async function revokeOtherSessions(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    const currentHash = raw ? hashToken(raw) : null;
    await prisma.refreshToken.updateMany({
      where: { userId: req.user.id, revoked: false, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) },
      data: { revoked: true },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function sendVerification(req, res, next) {
  try {
    const user = req.user;
    if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    const code = generateNumericCode(6);
    await prisma.emailVerificationCode.create({
      data: { userId: user.id, code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    });
    try {
      await sendVerificationCode(user.email, code);
    } catch (err) {
      console.error(`[verify-email/send] falha ao enviar e-mail para ${user.email}:`, err.message);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function verifyEmail(req, res, next) {
  try {
    const { code } = req.body;
    const user = req.user;
    const record = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, code, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return res.status(400).json({ error: 'Código inválido ou expirado.' });

    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await prisma.emailVerificationCode.deleteMany({ where: { userId: user.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: (email || '').toLowerCase() } });
    // Always respond 200 to avoid user enumeration.
    if (!user) return res.json({ ok: true });

    const token = generateOpaqueToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const resetUrl = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
    try {
      await sendPasswordReset(user.email, resetUrl);
    } catch (err) {
      console.error(`[forgot-password] falha ao enviar e-mail para ${user.email}:`, err.message);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    if (!token || !isPasswordStrongEnough(newPassword)) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres, com letras e números.' });
    }
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { used: true } }),
      prisma.refreshToken.updateMany({ where: { userId: record.userId }, data: { revoked: true } }),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function setup2FA(req, res, next) {
  try {
    // otplib v13: authenticator.generateSecret()/.keyuri() viraram as
    // funções de nível superior generateSecret()/generateURI({...}) —
    // mesmo formato otpauth:// de sempre, só a forma de chamar mudou.
    const secret = generateSecret();
    const otpauth = generateURI({ issuer: 'Project Club', label: req.user.email, secret });
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    await prisma.user.update({ where: { id: req.user.id }, data: { twoFactorSecret: secret } });
    res.json({ secret, qrDataUrl });
  } catch (err) { next(err); }
}

async function confirm2FA(req, res, next) {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user.twoFactorSecret) return res.status(400).json({ error: 'Configure o 2FA primeiro.' });
    const { valid } = await verify({ secret: user.twoFactorSecret, token: code, guardrails: legacyGuardrails });
    if (!valid) return res.status(400).json({ error: 'Código inválido.' });
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// SECURITY: turning off the account's second factor is exactly the kind
// of action that shouldn't be doable with *just* a short-lived access
// token — someone who got hold of one (a leaked/stolen token, an
// unattended logged-in session, etc.) shouldn't be able to permanently
// strip 2FA protection without proving they know the account password,
// same as every other major platform requires here.
async function disable2FA(req, res, next) {
  try {
    const { password } = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function me(req, res, next) {
  try {
    let user = await prisma.user.findUnique({ where: { id: req.user.id }, select: SELF_USER_FIELDS });
    if (!user.publicId) {
      user.publicId = await ensurePublicId(user.id, user.publicId);
    }
    await grantDueAgeBadges(user.id, user.createdAt);
    res.json({ user: clearIfExpired(user) });
  } catch (err) { next(err); }
}

module.exports = {
  register, login, refresh, logout, sendVerification, verifyEmail,
  forgotPassword, resetPassword, setup2FA, confirm2FA, disable2FA, me,
  listSessions, revokeSession, revokeOtherSessions, ensurePublicId,
  PUBLIC_USER_FIELDS, SELF_USER_FIELDS,
  isPasswordStrongEnough, generatePublicId,
};
