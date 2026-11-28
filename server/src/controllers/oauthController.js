// Rotas de "Entrar com Google / Discord / GitHub" (ver services/oauth.js
// pra regras e docs/oauth.md pra configurar os apps nos provedores).
//
// Fluxos:
// - Entrar: /start → provedor → /callback → sessão (a MESMA de um login
//   com senha, via completeLogin) ou etapa de 2FA pendente.
// - Inscrição: sem conta → cookie assinado com a identidade (30 min) e a
//   tela de inscrição pré-preenchida. A identidade vai junto com a
//   inscrição e só vira OAuthAccount quando a staff aprovar — o fluxo de
//   aprovação continua obrigatório.
// - Conectar (logado, Configurações → Segurança): POST /link devolve a URL
//   do provedor com o id da conta dentro do cookie de estado assinado.
const prisma = require('../config/prisma');
const env = require('../config/env');
const oauth = require('../services/oauth');
const {
  completeLogin, verifyTotpOnce, consumeRecoveryCode, registerFailedLogin, isAccountBlocked,
} = require('./authController');

const secret = () => env.JWT_ACCESS_SECRET;
const fetchImpl = (...args) => (module.exports.__fetch || fetch)(...args);

function cookieOpts(path, maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path, maxAge };
}
const STATE_PATH = '/api/auth/oauth';
// O cookie da inscrição precisa chegar também em /api/applications.
const SIGNUP_PATH = '/api';

function clearCookie(res, name, path) {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path });
}

function back(res, page, params) {
  const qs = new URLSearchParams(params).toString();
  return res.redirect(303, `/${page}${qs ? `?${qs}` : ''}`);
}

// GET /api/auth/oauth/providers
function listProviders(req, res) {
  const providers = oauth.enabledProviders().map((id) => ({ id, label: oauth.PROVIDERS[id].label }));
  res.set('Cache-Control', 'no-store');
  res.json({ providers });
}

// GET /api/auth/oauth/:provider/start?from=login|register
function start(req, res) {
  const { provider } = req.params;
  const from = req.query.from === 'register' ? 'register' : 'login';
  if (!oauth.isKnownProvider(provider)) return back(res, from, { oauth_error: 'indisponivel' });
  const auth = oauth.buildAuthorization(provider, { clientOrigin: env.CLIENT_ORIGIN, secret: secret(), mode: 'login', from });
  if (!auth) return back(res, from, { oauth_error: 'indisponivel', provider });
  res.cookie(oauth.COOKIE_STATE, auth.cookie, cookieOpts(STATE_PATH, oauth.STATE_TTL_MS));
  res.set('Cache-Control', 'no-store');
  return res.redirect(302, auth.url);
}

// POST /api/auth/oauth/:provider/link (logado) → { url }
function link(req, res) {
  const { provider } = req.params;
  if (!oauth.isKnownProvider(provider)) return res.status(404).json({ error: 'Provedor desconhecido.' });
  const auth = oauth.buildAuthorization(provider, {
    clientOrigin: env.CLIENT_ORIGIN, secret: secret(), mode: 'link', userId: req.user.id,
  });
  if (!auth) return res.status(503).json({ error: 'Este provedor não está disponível no momento.' });
  res.cookie(oauth.COOKIE_STATE, auth.cookie, cookieOpts(STATE_PATH, oauth.STATE_TTL_MS));
  res.json({ url: auth.url });
}

// GET /api/auth/oauth/:provider/callback?code=…&state=…
async function callback(req, res, next) {
  const { provider } = req.params;
  const rawCookie = req.cookies?.[oauth.COOKIE_STATE];
  // Uso único: o cookie de estado some já na primeira chegada aqui.
  clearCookie(res, oauth.COOKIE_STATE, STATE_PATH);
  try {
    if (!oauth.isKnownProvider(provider)) return back(res, 'login', { oauth_error: 'indisponivel' });
    const checked = oauth.validateState({ cookie: rawCookie, state: req.query.state, provider, secret: secret() });
    if (!checked.ok) return back(res, 'login', { oauth_error: 'estado', provider });
    const st = checked.payload;
    const isLink = st.m === 'link';
    const fail = (code) => (isLink
      ? back(res, 'oauth/retorno', { erro: code, provedor: provider })
      : back(res, st.f, { oauth_error: code, provider }));

    // A pessoa clicou em "Cancelar" no provedor (ou ele recusou).
    if (req.query.error) return fail('cancelado');

    let identity;
    try {
      const accessToken = await oauth.exchangeCode(provider, {
        code: req.query.code, verifier: st.v, clientOrigin: env.CLIENT_ORIGIN, fetchImpl,
      });
      identity = await oauth.fetchProfile(provider, accessToken, { fetchImpl });
    } catch (err) {
      // Só o código do erro — nunca o corpo da resposta (pode ter token).
      console.warn(`[oauth] ${provider}: falha na troca do código (${err.code || 'erro'}).`);
      return fail('falha');
    }

    const decision = await oauth.resolveCallback({ provider, identity, mode: st.m, linkUserId: st.u }, prisma);
    switch (decision.action) {
      case 'link-ok':
        return back(res, 'oauth/retorno', { vinculado: provider });
      case 'link-error':
        return fail(decision.error);
      case 'blocked':
        return fail(decision.kind);
      case 'email-exists':
        return back(res, 'login', { oauth_error: 'email_existente', provider });
      case 'pending':
        return fail('inscricao_pendente');
      case 'two-factor': {
        const token = oauth.signPayload(
          { uid: decision.user.id, p: provider, exp: Date.now() + oauth.PENDING_2FA_TTL_MS },
          { secret: secret(), purpose: '2fa' },
        );
        res.cookie(oauth.COOKIE_2FA, token, cookieOpts(STATE_PATH, oauth.PENDING_2FA_TTL_MS));
        return back(res, 'login', { oauth_2fa: provider });
      }
      case 'login':
        await completeLogin(req, res, decision.user);
        return back(res, 'login', { oauth: 'ok', provider });
      case 'signup': {
        const id = decision.identity;
        const token = oauth.signPayload({
          p: provider,
          id: id.providerUserId,
          // E-mail só vai pré-preenchido quando o provedor confirmou que é
          // da pessoa — evita usar a inscrição pra testar e-mails alheios.
          email: id.emailVerified ? id.email : null,
          name: id.name || null,
          username: oauth.suggestUsername(id) || null,
          exp: Date.now() + oauth.SIGNUP_TTL_MS,
        }, { secret: secret(), purpose: 'signup' });
        res.cookie(oauth.COOKIE_SIGNUP, token, cookieOpts(SIGNUP_PATH, oauth.SIGNUP_TTL_MS));
        return back(res, 'register', { oauth: provider });
      }
      default:
        return fail('falha');
    }
  } catch (err) { return next(err); }
}

// POST /api/auth/oauth/2fa { twoFactorCode | recoveryCode }
// Segunda etapa de quem entrou pelo provedor mas tem 2FA ligado: mesmas
// regras do login com senha (código de uso único, bloqueio por erros).
async function complete2FA(req, res, next) {
  try {
    const pending = oauth.verifyPayload(req.cookies?.[oauth.COOKIE_2FA], { secret: secret(), purpose: '2fa' });
    if (!pending?.uid) {
      return res.status(401).json({ error: 'A confirmação expirou. Entre de novo com o provedor.', expired: true });
    }
    const { twoFactorCode, recoveryCode } = req.body || {};
    if ((twoFactorCode != null && typeof twoFactorCode !== 'string') || (recoveryCode != null && typeof recoveryCode !== 'string')) {
      return res.status(400).json({ error: 'Código 2FA inválido.' });
    }
    const user = await prisma.user.findUnique({ where: { id: pending.uid } });
    if (!user || isAccountBlocked(user)) {
      clearCookie(res, oauth.COOKIE_2FA, STATE_PATH);
      return res.status(403).json({ error: 'Não foi possível entrar nesta conta.' });
    }
    if (user.loginLockedUntil && new Date(user.loginLockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(user.loginLockedUntil) - Date.now()) / 60000);
      return res.status(429).json({ error: `Muitas tentativas de login para esta conta. Tente novamente em ${mins} minuto(s).` });
    }
    const hasRecovery = typeof recoveryCode === 'string' && recoveryCode.trim();
    const hasTotp = typeof twoFactorCode === 'string' && twoFactorCode.trim();
    if (!hasRecovery && !hasTotp) return res.status(400).json({ error: 'Digite o código de verificação.' });
    if (user.twoFactorEnabled) {
      const ok = hasRecovery ? await consumeRecoveryCode(user.id, recoveryCode) : await verifyTotpOnce(user, twoFactorCode);
      if (!ok) {
        await registerFailedLogin(user);
        return res.status(401).json({ error: hasRecovery ? 'Código de recuperação inválido ou já usado.' : 'Código 2FA inválido.' });
      }
    }
    clearCookie(res, oauth.COOKIE_2FA, STATE_PATH);
    const session = await completeLogin(req, res, user);
    res.json(session);
  } catch (err) { next(err); }
}

// Lê (e valida) a identidade pendente da inscrição — usado aqui e em
// applicationsController.submitApplication.
function readSignupIdentity(req) {
  const p = oauth.verifyPayload(req.cookies?.[oauth.COOKIE_SIGNUP], { secret: secret(), purpose: 'signup' });
  if (!p || !oauth.isKnownProvider(p.p) || typeof p.id !== 'string' || !p.id) return null;
  return p;
}
function clearSignupCookie(res) { clearCookie(res, oauth.COOKIE_SIGNUP, SIGNUP_PATH); }

// GET /api/auth/oauth/signup → dados pra pré-preencher a inscrição.
function signupInfo(req, res) {
  const p = readSignupIdentity(req);
  res.set('Cache-Control', 'no-store');
  if (!p) return res.json({ pending: null });
  res.json({
    pending: {
      provider: p.p, label: oauth.PROVIDERS[p.p].label,
      email: p.email || '', name: p.name || '', username: p.username || '',
    },
  });
}

// DELETE /api/auth/oauth/signup — "não usar a conta X nesta inscrição".
function cancelSignup(req, res) {
  clearSignupCookie(res);
  res.json({ ok: true });
}

// GET /api/auth/oauth/accounts (logado)
async function listAccounts(req, res, next) {
  try {
    const accounts = await prisma.oAuthAccount.findMany({
      where: { userId: req.user.id },
      select: { provider: true, email: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const enabled = oauth.enabledProviders();
    res.json({
      accounts,
      providers: oauth.PROVIDER_IDS
        .filter((id) => enabled.includes(id) || accounts.some((a) => a.provider === id))
        .map((id) => ({ id, label: oauth.PROVIDERS[id].label, enabled: enabled.includes(id) })),
    });
  } catch (err) { next(err); }
}

// DELETE /api/auth/oauth/accounts/:provider (logado)
async function unlinkAccount(req, res, next) {
  try {
    const { provider } = req.params;
    if (!oauth.isKnownProvider(provider)) return res.status(404).json({ error: 'Provedor desconhecido.' });
    const result = await prisma.oAuthAccount.deleteMany({ where: { userId: req.user.id, provider } });
    if (!result.count) return res.status(404).json({ error: 'Nenhuma conta conectada desse provedor.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = {
  listProviders, start, link, callback, complete2FA, signupInfo, cancelSignup,
  listAccounts, unlinkAccount, readSignupIdentity, clearSignupCookie,
  __fetch: null,
};
