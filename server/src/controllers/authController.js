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
const sessionKeep = require('../services/sessionKeep');
const {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  generateNumericCode,
  generateOpaqueToken,
  generateRecoveryCode,
  normalizeRecoveryCode,
} = require('../services/tokens');
const { sendVerificationCode, sendPasswordReset, sendNewLoginAlert } = require('../services/email');
const { clearIfExpired } = require('../services/customStatus');
const { maybePromoteToPlatformAdmin } = require('../services/adminBootstrap');
const { grantDueAgeBadges } = require('../services/ageBadges');

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
  id: true, publicId: true, username: true, displayName: true, avatarUrl: true, avatarDecoration: true,
  profileEffect: true, // efeito de perfil da loja (perfil/miniperfil)
  profileFont: true, profileStyle: true, // fonte do nome e estilo de perfil da Loja
  bannerUrl: true, miniProfileBannerUrl: true, bannerFraming: true, miniProfileBannerFraming: true, bio: true, pronouns: true, profileColor: true, status: true,
  customStatus: true, customStatusEmoji: true, customStatusExpiresAt: true,
  createdAt: true, platformRole: true,
  supporterTier: true, // Assinante / Super Assinante (reconhecimento visual)
  tagEmoji: true, tagText: true,
  youtubeUrl: true, steamUrl: true, robloxUrl: true, xUrl: true,
  profileNameFont: true, profileNameEffect: true, profileNameColor: true, profileNameColor2: true, profileNameColors: true,
  accountLevel: true, accountXp: true,
  // Conquistas escolhidas pra mostrar — públicas de propósito (é o que
  // aparece no perfil/miniperfil de qualquer pessoa que a gente veja).
  displayedAchievements: true, displayedAchievementsMini: true,
  // "Placa de identificação" (see schema.prisma's User.idCardUrl) — shown
  // as the background behind this user's own row in the members list
  // (MembersList.jsx), so it needs to be visible to everyone who can see
  // that member, not just the account owner.
  idCardUrl: true,
  idCardFraming: true, // enquadramento da placa (ver schema.prisma)
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
  profileSectionOpacity: true,
  miniProfileColor: true,
  miniProfileButtonColor: true,
  // Item pedido: "escolher a cor de fundo da bolha que mostra os
  // status (Preto/Cinza/Branco)" — pública pelo mesmo motivo de
  // miniProfileColor/miniProfileButtonColor acima: é a bolha de
  // status que aparece no mini perfil de QUALQUER pessoa que a gente
  // visite, não só o próprio dono da conta.
  statusBubbleColor: true,
  // Item pedido: "quando crio a tag não aparece em tag da comunidade"
  // — a tag de clã que a pessoa escolheu usar (ver TagBadge.jsx e o
  // novo ClanTagBadge, mostrado nos mesmos lugares que a tag de
  // comunidade já era).
  clanTag: { select: { tag: true, clan: { select: { icon: true, iconColor: true } } } },
  // Item pedido: "pingentes... mini imagens ao lado do seu nome" —
  // aparece pra qualquer visitante do perfil (mini/completo/chat),
  // então precisa estar público aqui, não só em SELF_USER_FIELDS.
  selectedPendant: { select: { id: true, name: true, iconUrl: true } },
  customPendantUrl: true,
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
  // Item pedido: "Status da conta... Status: Ativa... Restrições:
  // Nenhuma" — BUG CORRIGIDO: nenhum destes 4 campos estava aqui, só
  // em queries internas separadas (ex: login) — a tela nova de
  // Status da conta (UserSettingsModal.jsx) lê esses valores direto
  // de `user` (que vem daqui, de /auth/me), então sempre mostrava
  // "Ativa"/"Nenhuma" pra QUALQUER conta, mesmo uma banida, suspensa,
  // silenciada ou desativada — os campos reais nunca chegavam no
  // frontend pra essa tela específica ler.
  isPlatformBanned: true, platformBanReason: true, suspendedUntil: true, timeoutUntil: true, accountDisabledAt: true,
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
  layoutStyle: true,
  chatZoom: true,
  interfaceZoom: true,
  emojiStyle: true,
  // Idem pra privacidade de pedidos de amizade — cada um só vê/edita a
  // própria configuração.
  friendRequestPrivacy: true,
  // Pra tela de Configurações mostrar o cooldown de troca de @ antes
  // mesmo da pessoa tentar (ver updateUsername em userController.js).
  usernameChangedAt: true,
};

// ---------------------------------------------------------------------
// Sessões (refresh tokens) — motivos de revogação. Só um token revogado
// por ROTAÇÃO normal que aparece de novo (fora da janelinha de corrida
// abaixo) é tratado como possível roubo. Qualquer revogação EXPLÍCITA
// (sair, encerrar sessão, trocar senha, ban...) só faz o refresh daquele
// token falhar com 401 — antes elas não marcavam revokedAt e o próximo
// refresh do aparelho encerrado caía no caminho de "roubo", derrubando
// TODAS as sessões da conta (inclusive a de quem clicou em "encerrar").
const REVOKE_REASONS = {
  ROTATED: 'ROTATED',
  LOGOUT: 'LOGOUT',
  REVOKED: 'REVOKED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ADMIN: 'ADMIN',
  THEFT: 'THEFT',
  // Token novo que o aparelho nunca chegou a gravar (voltou com o anterior
  // e a sessão foi recuperada a partir dele): morto de vez, sem "roubo".
  ABANDONED: 'ABANDONED',
};

function revokeRefreshTokens(where, reason) {
  return prisma.refreshToken.updateMany({
    where: { ...where, revoked: false },
    data: { revoked: true, revokedAt: new Date(), revokedReason: reason },
  });
}

function currentRefreshHash(req) {
  const raw = req.cookies?.refreshToken;
  return raw ? hashToken(raw) : null;
}

// "Chrome no Windows", "Safari no iPhone", "App desktop"... — só pra
// mostrar na lista de sessões e no e-mail de novo acesso. Heurística
// simples de propósito (sem dependência nova).
function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Dispositivo desconhecido';
  let browser = 'Navegador';
  if (/Electron\//i.test(ua)) browser = 'App desktop';
  else if (/Edg(e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = '';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  if (/ProjectClub|Capacitor|wv\)/i.test(ua) && os === 'Android') browser = 'App';
  return os ? `${browser} no ${os}` : browser;
}

// IP mascarado pra lista de sessões — o suficiente pra pessoa reconhecer
// "essa é minha rede de casa", sem expor o endereço inteiro na tela.
function maskIp(ip) {
  if (!ip) return null;
  const clean = String(ip).replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (clean.includes(':')) {
    const groups = clean.split(':').filter(Boolean);
    return `${groups.slice(0, 2).join(':')}:…`;
  }
  return null;
}

async function issueSession(res, user, userAgent, ipAddress, { sessionStartedAt } = {}) {
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();
  const created = await prisma.refreshToken.create({
    data: {
      tokenHash: hash, userId: user.id, userAgent, ipAddress, expiresAt,
      sessionStartedAt: sessionStartedAt || new Date(), lastUsedAt: new Date(),
    },
  });
  res.locals.refreshTokenId = created.id;
  res.cookie('refreshToken', raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  });
  await sessionKeep.setKeepCookie(res, user.id);
  return accessToken;
}

// SECURITY: o cadastro direto antigo (POST /api/auth/register) criava a
// conta na hora, sem passar pela fila de aprovação da staff — qualquer um
// com um script pulava o processo de inscrição inteiro. O cliente já usa
// só o fluxo de inscrição (POST /api/applications, ver RegisterPage.jsx),
// então essa rota agora só responde 410 (Gone) apontando pra ele.
async function register(req, res) {
  return res.status(410).json({
    error: 'O cadastro direto foi desativado. Para entrar no Project Club, faça sua inscrição pela página "Fazer inscrição" — ela será analisada pela equipe.',
    useApplications: true,
  });
}

// Conta uma tentativa errada (senha OU código 2FA/recuperação) no
// bloqueio por conta — 10 erros seguidos travam a conta por 15 minutos.
// Antes só a senha errada contava: com a senha certa em mãos, dava pra
// ficar chutando códigos 2FA à vontade (só o limitador por IP segurava).
async function registerFailedLogin(user) {
  // Incremento atômico — várias tentativas em paralelo não "perdem" erros.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });
  if (updated.failedLoginAttempts >= 10) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginLockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
    });
  }
}

// Verifica um código TOTP com proteção contra reuso: o mesmo código (o
// mesmo "passo" de 30s) só é aceito UMA vez. O passo aceito fica em
// User.twoFactorLastUsedStep; o updateMany condicional garante isso até
// com duas requisições simultâneas usando o mesmo código.
async function verifyTotpOnce(user, code) {
  if (!user.twoFactorSecret || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false;
  const lastStep = user.twoFactorLastUsedStep;
  // otplib v13: authenticator.check() virou verify({secret, token}),
  // assíncrono e devolvendo { valid, timeStep } em vez de um boolean.
  const result = await verify({
    secret: user.twoFactorSecret, token: code.trim(), guardrails: legacyGuardrails,
    ...(Number.isInteger(lastStep) ? { afterTimeStep: lastStep } : {}),
  });
  if (!result.valid) return false;
  const step = result.timeStep;
  if (!Number.isInteger(step)) return true;
  const claimed = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [{ twoFactorLastUsedStep: null }, { twoFactorLastUsedStep: { lt: step } }],
    },
    data: { twoFactorLastUsedStep: step },
  });
  return claimed.count === 1;
}

// Código de recuperação (uso único). Marcado como usado de forma atômica
// (updateMany com usedAt: null) — o mesmo código nunca entra duas vezes.
async function consumeRecoveryCode(userId, input) {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return false;
  const codeHash = hashToken(normalized);
  const claimed = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1;
}

// Gera 10 códigos novos (apagando os antigos) e devolve os códigos em
// texto puro — a ÚNICA vez que eles existem fora do hash.
async function regenerateRecoveryCodes(userId) {
  const codes = Array.from({ length: 10 }, () => generateRecoveryCode());
  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashToken(code) })),
    }),
  ]);
  return codes;
}

// "Novo acesso à sua conta": só quando a conta já teve alguma sessão
// antes (o primeiro login de todos não é "novo dispositivo", é o único)
// e nenhuma sessão anterior bate com o mesmo navegador + IP.
async function isNewDeviceLogin(userId, userAgent, ipAddress) {
  try {
    const previous = await prisma.refreshToken.findMany({
      where: { userId },
      select: { userAgent: true, ipAddress: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    if (previous.length === 0) return false;
    return !previous.some((s) => (s.userAgent || null) === (userAgent || null) && (s.ipAddress || null) === (ipAddress || null));
  } catch {
    return false;
  }
}

// Nunca bloqueia o login — erro de SMTP aqui só vai pro log.
function sendNewLoginAlertInBackground(user, userAgent, ipAddress) {
  sendNewLoginAlert(user.email, {
    device: describeDevice(userAgent),
    ip: ipAddress ? String(ipAddress).replace(/^::ffff:/i, '') : null,
    when: new Date(),
    appUrl: env.CLIENT_ORIGIN,
  }).catch((err) => console.error('[login] falha ao enviar alerta de novo acesso:', err.message));
}

async function login(req, res, next) {
  try {
    const { emailOrUsername, password, twoFactorCode, recoveryCode } = req.body || {};
    // Tipos validados antes de qualquer uso — um JSON com
    // emailOrUsername: {} (ou um array) estourava .toLowerCase() e virava
    // erro 500 em vez de um 400 normal.
    if (typeof emailOrUsername !== 'string' || typeof password !== 'string' || !emailOrUsername.trim() || !password) {
      return res.status(400).json({ error: 'Informe usuário/e-mail e senha.' });
    }
    if ((twoFactorCode != null && typeof twoFactorCode !== 'string') || (recoveryCode != null && typeof recoveryCode !== 'string')) {
      return res.status(400).json({ error: 'Código 2FA inválido.' });
    }
    const identifier = emailOrUsername.trim();
    // Item pedido: verificação de "não sou um robô" removida do login —
    // não roda mais nem no front nem aqui no back.

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier.toLowerCase() }, { username: identifier }],
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
      if (user) await registerFailedLogin(user);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    if (user.isPlatformBanned) {
      return res.status(403).json({ error: 'Esta conta foi banida da plataforma.', platformBanned: true, reason: user.platformBanReason || undefined });
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return res.status(403).json({ error: `Esta conta está suspensa até ${new Date(user.suspendedUntil).toLocaleString('pt-BR')}.`, suspendedUntil: user.suspendedUntil });
    }
    // Conta desativada pela própria pessoa (Configurações -> "Excluir
    // conta"). Antes o login passava e só o requireAuth barrava depois,
    // deixando a pessoa numa tela quebrada sem explicação nenhuma.
    if (user.accountDisabledAt) {
      return res.status(403).json({
        error: 'Esta conta foi desativada. Se você quer reativá-la, entre em contato com a equipe do Project Club.',
        accountDisabled: true,
      });
    }

    if (user.twoFactorEnabled) {
      const hasTotp = typeof twoFactorCode === 'string' && twoFactorCode.trim();
      const hasRecovery = typeof recoveryCode === 'string' && recoveryCode.trim();
      if (!hasTotp && !hasRecovery) {
        return res.status(206).json({ requiresTwoFactor: true });
      }
      const ok = hasRecovery
        ? await consumeRecoveryCode(user.id, recoveryCode)
        : await verifyTotpOnce(user, twoFactorCode);
      if (!ok) {
        await registerFailedLogin(user);
        return res.status(401).json({ error: hasRecovery ? 'Código de recuperação inválido ou já usado.' : 'Código 2FA inválido.' });
      }
    }

    const session = await completeLogin(req, res, user);
    res.json(session);
  } catch (err) { next(err); }
}

// Fim de um login bem-sucedido (senha + 2FA, ou Google/Discord/GitHub +
// 2FA — ver oauthController.js): zera o contador de erros, emite a sessão
// (refresh em cookie + access token) e avisa por e-mail se for um
// aparelho novo. Um lugar só, pra os dois caminhos nunca divergirem.
async function completeLogin(req, res, user) {
  await maybePromoteToPlatformAdmin(user);
  if (user.failedLoginAttempts > 0 || user.loginLockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, loginLockedUntil: null } });
  }
  const userAgent = req.headers['user-agent'];
  // Checa "aparelho novo" ANTES de criar a sessão deste login (senão a
  // própria sessão nova sempre "bate" consigo mesma).
  const newDevice = await isNewDeviceLogin(user.id, userAgent, req.ip);
  const accessToken = await issueSession(res, user, userAgent, req.ip);
  if (newDevice) sendNewLoginAlertInBackground(user, userAgent, req.ip);
  // Conta desativada temporariamente pela própria pessoa: entrar reativa.
  let reactivated = false;
  if (user.selfDeactivatedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { selfDeactivatedAt: null } });
    reactivated = true;
  }
  const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
  return { user: selfUser, accessToken, ...(reactivated ? { reactivated: true } : {}) };
}

// Janela curtíssima pra corrida de refresh: duas requisições quase
// simultâneas com o MESMO cookie (duas abas abrindo juntas, o efeito
// duplicado do React em dev) chegam antes do navegador guardar o cookie
// novo da primeira resposta. Dentro dela, a segunda requisição recebe só
// um access token novo da MESMA sessão que já substituiu essa — sem criar
// sessão nova nem mexer no cookie (o navegador fica com o cookie que a
// primeira resposta gravou).
//
// SECURITY: antes eram 5 minutos E cada reuso dentro dela criava uma
// sessão novinha — ou seja, um refresh token roubado continuava gerando
// sessões válidas por 5 minutos depois de já ter sido usado. Fora desses
// 10s, reusar um token já rotacionado é tratado como roubo (derruba
// todas as sessões da conta).
const REFRESH_RACE_GRACE_MS = 30 * 1000;

// Segue a corrente de rotação (replacedById) a partir de um token e devolve
// todos os elos — o último é o token "atual" daquela sessão/aparelho.
async function refreshChain(startId, limit = 200) {
  const chain = [];
  let id = startId;
  const seen = new Set();
  while (id && !seen.has(id) && chain.length < limit) {
    seen.add(id);
    const row = await prisma.refreshToken.findUnique({ where: { id } });
    if (!row) break;
    chain.push(row);
    id = row.replacedById;
  }
  return chain;
}

function isAccountBlocked(user) {
  return !user
    || user.isPlatformBanned
    || !!user.accountDisabledAt
    || (user.suspendedUntil && new Date(user.suspendedUntil) > new Date());
}

async function refresh(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    const userAgent = req.headers['user-agent'];
    // Sem cookie de refresh (ou inválido mais abaixo): tenta o "lembrar
    // login" selado (iron-session) antes de mandar pra tela de login.
    const restoreFromKeep = async () => {
      const uid = await sessionKeep.readKeepCookie(req);
      if (!uid) return false;
      const user = await prisma.user.findUnique({ where: { id: uid } });
      if (isAccountBlocked(user)) return false;
      await maybePromoteToPlatformAdmin(user);
      const accessToken = await issueSession(res, user, userAgent, req.ip);
      const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
      res.json({ user: selfUser, accessToken });
      return true;
    };
    if (!raw) {
      if (await restoreFromKeep()) return;
      return res.status(401).json({ error: 'Sessão expirada.' });
    }

    const hash = hashToken(raw);
    let stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (stored && !stored.revoked && stored.expiresAt >= new Date()) {
      const user = await prisma.user.findUnique({ where: { id: stored.userId } });
      if (isAccountBlocked(user)) {
        await revokeRefreshTokens({ id: stored.id }, REVOKE_REASONS.ADMIN);
        res.clearCookie('refreshToken', { path: '/api/auth' });
        sessionKeep.clearKeepCookie(res);
        return res.status(401).json({ error: 'Sessão expirada.' });
      }
      // Rotação: só UMA requisição consegue "reivindicar" este token
      // (updateMany condicional) — uma segunda simultânea cai no caminho
      // de token já rotacionado logo abaixo, em vez de também ganhar uma
      // sessão nova.
      const claimed = await prisma.refreshToken.updateMany({
        where: { id: stored.id, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.ROTATED, lastUsedAt: new Date() },
      });
      if (claimed.count === 1) {
        await maybePromoteToPlatformAdmin(user);
        const accessToken = await issueSession(res, user, userAgent, req.ip, {
          sessionStartedAt: stored.sessionStartedAt || stored.createdAt,
        });
        await prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedById: res.locals.refreshTokenId } }).catch(() => {});
        const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
        return res.json({ user: selfUser, accessToken });
      }
      // Perdeu a corrida: relê o estado (agora revogado/rotacionado).
      stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
      // A outra requisição pode ainda não ter gravado replacedById — dá
      // um instante pra ela terminar.
      if (stored?.revoked && stored.revokedReason === REVOKE_REASONS.ROTATED && !stored.replacedById) {
        await new Promise((r) => setTimeout(r, 300));
        stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
      }
    }

    if (stored?.revoked) {
      // Revogação EXPLÍCITA (sair, encerrar sessão, troca/redefinição de
      // senha, ban...) ou linha antiga sem motivo registrado: só esta
      // sessão acabou — nada de derrubar as outras.
      // Apaga também o "lembrar login" deste aparelho — senão, no próximo
      // refresh (já sem cookie de refresh), restoreFromKeep recriaria a
      // sessão que a pessoa acabou de encerrar.
      if (stored.revokedReason !== REVOKE_REASONS.ROTATED) {
        res.clearCookie('refreshToken', { path: '/api/auth' });
        sessionKeep.clearKeepCookie(res);
        return res.status(401).json({ error: 'Sessão expirada.' });
      }

      // Dentro da janela de corrida, vale a ponta ATUAL da corrente (o app
      // pode ter renovado de novo enquanto esta requisição atrasada viajava).
      // Fora da janela, uma requisição atrasada do MESMO aparelho (mesmo
      // navegador/app e mesma rede) também não é roubo — é o app que
      // disparou duas renovações e uma chegou atrasada.
      const sameDevice = (stored.userAgent || null) === (userAgent || null)
        && !!stored.ipAddress && stored.ipAddress === req.ip;
      const withinRace = sameDevice || (stored.revokedAt
        && (Date.now() - stored.revokedAt.getTime()) < REFRESH_RACE_GRACE_MS);
      if (withinRace && stored.replacedById) {
        const chain = await refreshChain(stored.replacedById);
        const head = chain[chain.length - 1];
        const user = head && !head.revoked && head.expiresAt > new Date()
          ? await prisma.user.findUnique({ where: { id: stored.userId } })
          : null;
        if (user && !isAccountBlocked(user)) {
          const accessToken = signAccessToken(user);
          const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
          return res.json({ user: selfUser, accessToken });
        }
      }

      // Aparelho que PERDEU o cookie novo (app fechado antes de gravar o
      // cookie no disco, internet caiu ou o servidor reiniciou num deploy
      // bem no meio da renovação): ele volta com o token anterior, e o
      // substituto NUNCA foi usado por ninguém. Isso não é roubo — é o
      // mesmo aparelho. Recupera a sessão (o substituto não usado é
      // invalidado, então só um dos dois continua valendo).
      // Se o substituto JÁ foi usado, alguém tem o token novo: aí sim é
      // tratado como roubo, logo abaixo.
      if (stored.replacedById && (stored.userAgent || null) === (userAgent || null)) {
        const replacement = await prisma.refreshToken.findUnique({ where: { id: stored.replacedById } });
        const unusedReplacement = replacement && !replacement.revoked && replacement.expiresAt > new Date();
        if (unusedReplacement) {
          const user = await prisma.user.findUnique({ where: { id: stored.userId } });
          if (user && !isAccountBlocked(user)) {
            // Só quem ganhar esta troca recupera (duas abas ao mesmo tempo
            // não geram duas sessões).
            const claimed = await prisma.refreshToken.updateMany({
              where: { id: replacement.id, revoked: false },
              data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.ABANDONED },
            });
            if (claimed.count === 1) {
              await maybePromoteToPlatformAdmin(user);
              const accessToken = await issueSession(res, user, userAgent, req.ip, {
                sessionStartedAt: replacement.sessionStartedAt || stored.sessionStartedAt || stored.createdAt,
              });
              // O anterior passa a apontar pro token novo de verdade.
              await prisma.refreshToken.update({ where: { id: stored.id }, data: { replacedById: res.locals.refreshTokenId } }).catch(() => {});
              console.warn(`[auth] sessão recuperada: o aparelho voltou com o cookie anterior (usuário ${stored.userId}).`);
              const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
              return res.json({ user: selfUser, accessToken });
            }
          }
        }
      }

      // Reuso de token já rotacionado fora da janela = possível roubo.
      // Antes isso derrubava TODAS as sessões da conta — e um app com duas
      // renovações atrasadas (ou o app antigo + o novo no mesmo celular)
      // deslogava também o PC "do nada". Agora encerra só a sessão (a
      // corrente de tokens) deste token: quem tinha o token roubado perde
      // o acesso, e os outros aparelhos continuam logados.
      const chain = await refreshChain(stored.id);
      const ids = chain.map((t) => t.id);
      if (ids.length) await revokeRefreshTokens({ id: { in: ids } }, REVOKE_REASONS.THEFT);
      sessionKeep.clearKeepCookie(res);
      res.clearCookie('refreshToken', { path: '/api/auth' });
      console.warn(`[auth] reuso de refresh token rotacionado detectado (usuário ${stored.userId}) — só essa sessão (${ids.length} token(s)) foi encerrada.`);
      return res.status(401).json({ error: 'Sessão expirada.' });
    }

    if (await restoreFromKeep()) return;
    return res.status(401).json({ error: 'Sessão expirada.' });
  } catch (err) { next(err); }
}

// Usado ao trocar de conta: revoga a sessão do cookie atual (se houver).
async function logoutCurrentSession(req) {
  const hash = currentRefreshHash(req);
  if (hash) await revokeRefreshTokens({ tokenHash: hash }, REVOKE_REASONS.LOGOUT);
}

async function logout(req, res, next) {
  try {
    const hash = currentRefreshHash(req);
    if (hash) await revokeRefreshTokens({ tokenHash: hash }, REVOKE_REASONS.LOGOUT);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    sessionKeep.clearKeepCookie(res);
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
// Inclui o nome do aparelho (derivado do userAgent), o IP mascarado e o
// último uso — o IP completo nunca sai do servidor.
async function listSessions(req, res, next) {
  try {
    const currentHash = currentRefreshHash(req);
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user.id, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, userAgent: true, ipAddress: true, createdAt: true, tokenHash: true,
        lastUsedAt: true, sessionStartedAt: true,
      },
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        device: describeDevice(s.userAgent),
        ip: maskIp(s.ipAddress),
        createdAt: s.sessionStartedAt || s.createdAt,
        lastUsedAt: s.lastUsedAt || s.createdAt,
        isCurrent: s.tokenHash === currentHash,
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
    const currentHash = currentRefreshHash(req);
    const session = await prisma.refreshToken.findUnique({ where: { id } });
    if (!session || session.userId !== req.user.id) return res.status(404).json({ error: 'Sessão não encontrada.' });
    if (session.tokenHash === currentHash) return res.status(400).json({ error: 'Use "Sair" para encerrar a sessão atual.' });
    await revokeRefreshTokens({ id }, REVOKE_REASONS.REVOKED);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// DELETE /auth/sessions — "log out everywhere else", the actual reinforced
// -security button: one click revokes every OTHER active session, leaving
// only the one making this request untouched (again, use plain logout to
// end that one).
async function revokeOtherSessions(req, res, next) {
  try {
    const currentHash = currentRefreshHash(req);
    await revokeRefreshTokens(
      { userId: req.user.id, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) },
      REVOKE_REASONS.REVOKED,
    );
    // Derruba o "lembrar login" dos outros aparelhos e renova o deste.
    await sessionKeep.markSessionsRevoked(req.user.id);
    await sessionKeep.setKeepCookie(res, req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Cria um código de verificação de e-mail novo, invalidando os anteriores
// (só o último código enviado vale — "Reenviar código" não deixa vários
// códigos válidos ao mesmo tempo, o que multiplicava as chances de chute).
// Reaproveitado por applicationsController.js (código enviado na aprovação
// da inscrição, com validade maior porque a pessoa pode demorar a entrar).
async function createEmailVerificationCode(userId, ttlMs = 15 * 60 * 1000) {
  const code = generateNumericCode(6);
  await prisma.emailVerificationCode.deleteMany({ where: { userId } });
  await prisma.emailVerificationCode.create({
    data: { userId, code, expiresAt: new Date(Date.now() + ttlMs) },
  });
  return code;
}

async function sendVerification(req, res, next) {
  try {
    const user = req.user;
    if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    const code = await createEmailVerificationCode(user.id);
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
    const { code } = req.body || {};
    const user = req.user;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ error: 'Código inválido ou expirado.' });
    }
    const record = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, code: code.trim(), expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return res.status(400).json({ error: 'Código inválido ou expirado.' });

    const updated = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await prisma.emailVerificationCode.deleteMany({ where: { userId: user.id } });
    // A promoção automática por PLATFORM_ADMIN_EMAIL só vale pra e-mail
    // verificado (ver adminBootstrap.js) — confere aqui pra o dono não
    // precisar sair e entrar de novo depois de confirmar o código.
    await maybePromoteToPlatformAdmin(updated);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) return res.json({ ok: true });
    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Always respond 200 to avoid user enumeration.
    if (!user) return res.json({ ok: true });

    // SECURITY: só o hash (sha256) do token vai pro banco — quem ler a
    // tabela (backup vazado, acesso indevido ao banco) não consegue usar
    // os links de redefinição pendentes. Pedir um link novo invalida os
    // anteriores ainda não usados.
    const token = generateOpaqueToken();
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, used: false }, data: { used: true } });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
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
    const { token, newPassword } = req.body || {};
    if (typeof token !== 'string' || !token || !isPasswordStrongEnough(newPassword)) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres, com letras e números.' });
    }
    // Tokens são guardados como sha256 (ver forgotPassword). Links antigos
    // (de antes dessa mudança, salvos em texto puro) simplesmente não batem
    // mais — expiravam em 1h de qualquer forma; basta pedir um novo.
    const record = await prisma.passwordResetToken.findUnique({ where: { token: hashToken(token) } });
    if (!record || record.used || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Link inválido ou expirado.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      // Redefinir a senha também destrava a conta (quem provou ser dono do
      // e-mail não precisa esperar o bloqueio por tentativas erradas) — e,
      // pelo mesmo motivo (o link só chega a quem lê aquela caixa de
      // e-mail), conta como e-mail verificado.
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginAttempts: 0, loginLockedUntil: null, emailVerified: true },
      }),
      // Este link e qualquer outro pendente da conta deixam de valer.
      prisma.passwordResetToken.updateMany({ where: { userId: record.userId, used: false }, data: { used: true } }),
      prisma.refreshToken.updateMany({
        where: { userId: record.userId, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.PASSWORD_RESET },
      }),
    ]);
    await sessionKeep.markSessionsRevoked(record.userId);
    await require('./accountSwitchController').revokeAllFor(record.userId); // contas salvas pra troca também saem
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Senha atual obrigatória em toda ação sensível do 2FA (configurar,
// desativar, gerar códigos novos) — um access token sozinho (sessão
// esquecida aberta, token vazado) não basta pra mexer no segundo fator.
async function checkPassword(userId, password) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || typeof password !== 'string' || !password || !(await bcrypt.compare(password, user.passwordHash))) return null;
  return user;
}

async function setup2FA(req, res, next) {
  try {
    const { password } = req.body || {};
    const user = await checkPassword(req.user.id, password);
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    // SECURITY: antes isso sobrescrevia o segredo mesmo com o 2FA já
    // ativo — quem tivesse um access token conseguia trocar o segredo
    // pro próprio app autenticador sem nunca provar o fator atual. Agora
    // é preciso desativar primeiro (o que exige senha + código).
    if (user.twoFactorEnabled) {
      return res.status(409).json({ error: 'A autenticação em dois fatores já está ativa. Desative-a primeiro para configurar de novo.' });
    }
    // otplib v13: authenticator.generateSecret()/.keyuri() viraram as
    // funções de nível superior generateSecret()/generateURI({...}) —
    // mesmo formato otpauth:// de sempre, só a forma de chamar mudou.
    const secret = generateSecret();
    const otpauth = generateURI({ issuer: 'Project Club', label: user.email, secret });
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret, twoFactorLastUsedStep: null } });
    res.json({ secret, qrDataUrl });
  } catch (err) { next(err); }
}

async function confirm2FA(req, res, next) {
  try {
    const { code } = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.twoFactorEnabled) return res.status(409).json({ error: 'A autenticação em dois fatores já está ativa.' });
    if (!user.twoFactorSecret) return res.status(400).json({ error: 'Configure o 2FA primeiro.' });
    if (!(await verifyTotpOnce(user, code))) return res.status(400).json({ error: 'Código inválido.' });
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    // Códigos de recuperação: mostrados UMA vez, agora, pro caso de a
    // pessoa perder o celular com o app autenticador.
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    res.json({ ok: true, recoveryCodes });
  } catch (err) { next(err); }
}

// SECURITY: turning off the account's second factor is exactly the kind
// of action that shouldn't be doable with *just* a short-lived access
// token — exige a senha E um código válido (do app autenticador ou um
// código de recuperação), provando posse dos dois fatores.
async function disable2FA(req, res, next) {
  try {
    const { password, code, recoveryCode } = req.body || {};
    const user = await checkPassword(req.user.id, password);
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    if (!user.twoFactorEnabled) {
      await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: null, twoFactorLastUsedStep: null } });
      return res.json({ ok: true });
    }
    const hasRecovery = typeof recoveryCode === 'string' && recoveryCode.trim();
    const ok = hasRecovery ? await consumeRecoveryCode(user.id, recoveryCode) : await verifyTotpOnce(user, code);
    if (!ok) {
      return res.status(401).json({ error: hasRecovery ? 'Código de recuperação inválido ou já usado.' : 'Código 2FA inválido.' });
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user.id },
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastUsedStep: null },
      }),
      prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: req.user.id } }),
    ]);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// GET /auth/2fa/recovery-codes — só QUANTOS códigos ainda restam (os
// códigos em si nunca mais aparecem depois de gerados).
async function recoveryCodesStatus(req, res, next) {
  try {
    const remaining = await prisma.twoFactorRecoveryCode.count({ where: { userId: req.user.id, usedAt: null } });
    res.json({ remaining, enabled: !!req.user.twoFactorEnabled });
  } catch (err) { next(err); }
}

// POST /auth/2fa/recovery-codes — "Gerar novos códigos": invalida todos os
// anteriores (usados ou não) e devolve 10 novos. Exige a senha.
async function regenerateRecoveryCodesHandler(req, res, next) {
  try {
    const { password } = req.body || {};
    const user = await checkPassword(req.user.id, password);
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    if (!user.twoFactorEnabled) return res.status(400).json({ error: 'Ative a autenticação em dois fatores primeiro.' });
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    res.json({ recoveryCodes });
  } catch (err) { next(err); }
}

// Item pedido: "repaginada completa em Configurações..." — trocar a
// própria senha confirmando com a senha ATUAL. Encerra todas as OUTRAS
// sessões (se alguém mais tinha acesso com a senha antiga, perde agora),
// mas mantém ESTA aberta: o cookie de refresh vem junto nesta rota
// (/api/auth/...), então dá pra saber exatamente qual sessão é "esta".
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!isPasswordStrongEnough(newPassword)) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres, com letras e números.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (typeof currentPassword !== 'string' || !currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const currentHash = currentRefreshHash(req);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revoked: false, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) },
        data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.PASSWORD_CHANGE },
      }),
      // Links de "esqueci minha senha" pendentes também deixam de valer.
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, used: false }, data: { used: true } }),
    ]);
    // Derruba o "lembrar login" dos outros aparelhos e renova o deste.
    await sessionKeep.markSessionsRevoked(user.id);
    await require('./accountSwitchController').revokeAllFor(user.id); // contas salvas pra troca também saem
    if (currentHash) await sessionKeep.setKeepCookie(res, user.id);
    res.json({ ok: true, keptCurrentSession: !!currentHash });
  } catch (err) { next(err); }
}

// Item pedido: "excluir conta" — na verdade DESATIVA (accountDisabledAt,
// ver schema.prisma), não apaga nada de verdade — evita quebrar
// referências em cascata (mensagens antigas, posts, etc de outras
// pessoas que citam esse usuário continuam existindo normalmente).
// Confirmado com senha, mesmo padrão de disable2FA acima. Revoga TODAS
// as sessões (inclusive a atual, diferente de changePassword) — a
// pessoa é desconectada na hora (inclusive os sockets abertos).
async function deleteAccount(req, res, next) {
  try {
    const { password } = req.body || {};
    const user = await checkPassword(req.user.id, password);
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { accountDisabledAt: new Date() } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.ACCOUNT_DISABLED },
      }),
    ]);
    await sessionKeep.markSessionsRevoked(user.id);
    await require('./accountSwitchController').revokeAllFor(user.id); // contas salvas pra troca também saem
    res.clearCookie('refreshToken', { path: '/api/auth' });
    sessionKeep.clearKeepCookie(res);
    req.app.get('io')?.kickUser?.(user.id, 'account:disabled', {});
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// POST /auth/deactivate { password } — desativa a conta temporariamente:
// sai de todos os aparelhos, some das buscas e ninguém consegue te mandar
// DM; entrar de novo reativa na hora. Nada é apagado.
async function deactivateAccount(req, res, next) {
  try {
    const { password } = req.body || {};
    const user = await checkPassword(req.user.id, password);
    if (!user) return res.status(401).json({ error: 'Senha incorreta.' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { selfDeactivatedAt: new Date(), status: 'OFFLINE' } }),
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true, revokedAt: new Date(), revokedReason: REVOKE_REASONS.LOGOUT || 'LOGOUT' },
      }),
    ]);
    await sessionKeep.markSessionsRevoked(user.id);
    res.clearCookie('refreshToken', { path: '/api/auth' });
    sessionKeep.clearKeepCookie(res);
    req.app.get('io')?.kickUser?.(user.id, 'account:disabled', { temporary: true });
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
  changePassword, deleteAccount, deactivateAccount, logoutCurrentSession,
  recoveryCodesStatus, regenerateRecoveryCodesHandler,
  createEmailVerificationCode, issueSession, REVOKE_REASONS, describeDevice, maskIp,
  completeLogin, verifyTotpOnce, consumeRecoveryCode, registerFailedLogin, isAccountBlocked,
};
