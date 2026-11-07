// Login com Google, Discord e GitHub (OAuth 2.0 "authorization code").
//
// Este arquivo tem só a parte "pura" (sem Express, sem Prisma fixo):
// configuração dos provedores, assinatura dos cookies de estado, troca do
// código pelo perfil e a DECISÃO do que fazer no callback. O controller
// (controllers/oauthController.js) liga isso às rotas — e os testes
// (test/oauth.test.js) exercitam tudo aqui com um fetch/prisma falsos.
//
// Regras de segurança que moram aqui:
// - `state` aleatório por tentativa, conferido (comparação de tempo
//   constante) contra o que foi guardado num cookie httpOnly ASSINADO
//   (HMAC) que vale 10 minutos. Sem cookie, assinatura errada, provedor
//   trocado ou expirado = recusa.
// - PKCE (S256) no Google.
// - A troca do código acontece SÓ no servidor; o token de acesso do
//   provedor é usado uma vez pra ler o perfil e descartado — nunca vai pro
//   banco, pro log nem pro navegador.
// - Conta não vinculada cujo e-mail (verificado pelo provedor) já existe
//   aqui NÃO é vinculada sozinha: a pessoa entra com a senha e conecta em
//   Configurações → Segurança. Senão, quem controlasse um e-mail antigo
//   num provedor tomaria a conta.
const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;
const PENDING_2FA_TTL_MS = 10 * 60 * 1000;
const SIGNUP_TTL_MS = 30 * 60 * 1000;

const COOKIE_STATE = 'pc_oauth_state';
const COOKIE_2FA = 'pc_oauth_2fa';
const COOKIE_SIGNUP = 'pc_oauth_signup';

const PROVIDERS = {
  google: {
    label: 'Google',
    envId: 'GOOGLE_CLIENT_ID',
    envSecret: 'GOOGLE_CLIENT_SECRET',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    extraParams: { prompt: 'select_account' },
  },
  discord: {
    label: 'Discord',
    envId: 'DISCORD_CLIENT_ID',
    envSecret: 'DISCORD_CLIENT_SECRET',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    pkce: false,
    extraParams: { prompt: 'none' },
  },
  github: {
    label: 'GitHub',
    envId: 'GITHUB_CLIENT_ID',
    envSecret: 'GITHUB_CLIENT_SECRET',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: false,
    extraParams: { allow_signup: 'true' },
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function isKnownProvider(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, id);
}

function credentialsFor(id, source = process.env) {
  const p = PROVIDERS[id];
  if (!p) return null;
  const clientId = String(source[p.envId] || '').trim();
  const clientSecret = String(source[p.envSecret] || '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

// Só aparece (e só funciona) quem tem as DUAS variáveis configuradas.
function enabledProviders(source = process.env) {
  return PROVIDER_IDS.filter((id) => !!credentialsFor(id, source));
}

// URL pública do site — a mesma CLIENT_ORIGIN que já monta os links dos
// e-mails (redefinição de senha, aprovação). Pode ser uma lista separada
// por vírgula (CORS); a primeira é a "oficial".
function publicBaseUrl(clientOrigin) {
  const first = String(clientOrigin || '').split(',')[0].trim();
  return (first || 'http://localhost:5173').replace(/\/+$/, '');
}

function redirectUriFor(id, clientOrigin) {
  return `${publicBaseUrl(clientOrigin)}/api/auth/oauth/${id}/callback`;
}

// ---------------------------------------------------------------------
// Tokens assinados (HMAC-SHA256). Formato: base64url(json).base64url(mac).
// Cada uso tem o próprio "purpose" — um cookie de estado nunca serve como
// cookie de 2FA pendente e vice-versa.
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function keyFor(secret, purpose) {
  return crypto.createHmac('sha256', String(secret)).update(`project-club-oauth:${purpose}`).digest();
}

function signPayload(payload, { secret, purpose }) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', keyFor(secret, purpose)).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function verifyPayload(token, { secret, purpose, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = b64url(crypto.createHmac('sha256', keyFor(secret, purpose)).update(body).digest());
  if (!safeEqual(mac, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

// ---------------------------------------------------------------------
// Início do fluxo: monta a URL do provedor + o cookie de estado.
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// mode: 'login' (entrar/inscrever) | 'link' (conectar numa conta logada)
// from: 'login' | 'register' — só decide pra qual tela os erros voltam.
function buildAuthorization(id, { clientOrigin, secret, mode = 'login', userId = null, from = 'login', source = process.env, now = Date.now() }) {
  const p = PROVIDERS[id];
  const creds = credentialsFor(id, source);
  if (!p || !creds) return null;
  const nonce = b64url(crypto.randomBytes(24));
  const pkce = p.pkce ? pkcePair() : null;
  const statePayload = {
    p: id, n: nonce, m: mode === 'link' ? 'link' : 'login',
    f: from === 'register' ? 'register' : 'login',
    ...(mode === 'link' && userId ? { u: userId } : {}),
    ...(pkce ? { v: pkce.verifier } : {}),
    exp: now + STATE_TTL_MS,
  };
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUriFor(id, clientOrigin),
    response_type: 'code',
    scope: p.scope,
    state: nonce,
    ...(p.extraParams || {}),
  });
  if (pkce) {
    params.set('code_challenge', pkce.challenge);
    params.set('code_challenge_method', 'S256');
  }
  return {
    url: `${p.authorizeUrl}?${params.toString()}`,
    cookie: signPayload(statePayload, { secret, purpose: 'state' }),
  };
}

// Confere o cookie de estado contra o `state` que voltou na URL.
function validateState({ cookie, state, provider, secret, now = Date.now() }) {
  const payload = verifyPayload(cookie, { secret, purpose: 'state', now });
  if (!payload) return { ok: false, reason: 'state_invalid' };
  if (payload.p !== provider) return { ok: false, reason: 'state_provider' };
  if (typeof state !== 'string' || !state || !safeEqual(state, payload.n)) return { ok: false, reason: 'state_mismatch' };
  if (payload.m === 'link' && !payload.u) return { ok: false, reason: 'state_invalid' };
  return { ok: true, payload };
}

// ---------------------------------------------------------------------
// Troca do código + leitura do perfil. `fetchImpl` é injetável (testes).
class OAuthError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function exchangeCode(id, { code, verifier, clientOrigin, source = process.env, fetchImpl = fetch }) {
  const p = PROVIDERS[id];
  const creds = credentialsFor(id, source);
  if (!p || !creds) throw new OAuthError('provider_disabled');
  if (typeof code !== 'string' || !code || code.length > 2048) throw new OAuthError('code_missing');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUriFor(id, clientOrigin),
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  if (p.pkce) {
    if (!verifier) throw new OAuthError('pkce_missing');
    body.set('code_verifier', verifier);
  }
  const res = await fetchImpl(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await readJson(res);
  // Nunca loga `data` (tem o token) — só o código de erro do provedor.
  if (!res.ok || !data || typeof data.access_token !== 'string') {
    throw new OAuthError('token_exchange_failed', data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data.access_token;
}

const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

async function getJson(url, token, fetchImpl, extraHeaders = {}) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'ProjectClub-OAuth', ...extraHeaders },
  });
  if (!res.ok) throw new OAuthError('profile_failed', `HTTP ${res.status}`);
  const data = await readJson(res);
  if (!data) throw new OAuthError('profile_failed');
  return data;
}

// Perfil normalizado: { providerUserId, email, emailVerified, name, username }.
async function fetchProfile(id, accessToken, { fetchImpl = fetch } = {}) {
  if (id === 'google') {
    const d = await getJson('https://openidconnect.googleapis.com/v1/userinfo', accessToken, fetchImpl);
    if (!d.sub) throw new OAuthError('profile_failed');
    return {
      providerUserId: String(d.sub),
      email: clip(d.email, 254)?.toLowerCase() || null,
      emailVerified: d.email_verified === true || d.email_verified === 'true',
      name: clip(d.name, 64),
      username: null,
    };
  }
  if (id === 'discord') {
    const d = await getJson('https://discord.com/api/users/@me', accessToken, fetchImpl);
    if (!d.id) throw new OAuthError('profile_failed');
    return {
      providerUserId: String(d.id),
      email: clip(d.email, 254)?.toLowerCase() || null,
      emailVerified: d.verified === true,
      name: clip(d.global_name, 64) || clip(d.username, 64),
      username: clip(d.username, 64),
    };
  }
  if (id === 'github') {
    const gh = { 'X-GitHub-Api-Version': '2022-11-28' };
    const d = await getJson('https://api.github.com/user', accessToken, fetchImpl, gh);
    if (d.id == null) throw new OAuthError('profile_failed');
    // O e-mail público do perfil pode estar vazio ou não verificado — o
    // confiável é o "primary + verified" da lista de e-mails.
    let email = null;
    let emailVerified = false;
    try {
      const emails = await getJson('https://api.github.com/user/emails', accessToken, fetchImpl, gh);
      if (Array.isArray(emails)) {
        const primary = emails.find((e) => e && e.primary && e.verified) || emails.find((e) => e && e.verified);
        if (primary?.email) { email = String(primary.email).toLowerCase().slice(0, 254); emailVerified = true; }
      }
    } catch { /* sem permissão de e-mail: segue sem e-mail */ }
    return {
      providerUserId: String(d.id),
      email,
      emailVerified,
      name: clip(d.name, 64) || clip(d.login, 64),
      username: clip(d.login, 64),
    };
  }
  throw new OAuthError('provider_unknown');
}

// ---------------------------------------------------------------------
// A decisão do callback. `db` é o prisma (ou um falso nos testes).
//
// Resultados possíveis (action):
//   link-ok       — conectado (ou já estava) na conta logada
//   link-error    — { error: 'ja-vinculada' | 'provedor-ja-vinculado' | 'conta' }
//   blocked       — { kind: 'banida' | 'suspensa' | 'desativada' }
//   two-factor    — conta com 2FA: precisa do código antes da sessão
//   login         — { user }: emitir a sessão
//   email-exists  — e-mail verificado já tem conta (NÃO vincula sozinho)
//   pending       — já existe inscrição pendente com essa identidade
//   signup        — sem conta: vai pra inscrição com os dados pré-preenchidos
function blockedKind(user, now = Date.now()) {
  if (!user) return null;
  if (user.isPlatformBanned) return 'banida';
  if (user.accountDisabledAt) return 'desativada';
  if (user.suspendedUntil && new Date(user.suspendedUntil).getTime() > now) return 'suspensa';
  return null;
}

async function resolveCallback({ provider, identity, mode, linkUserId }, db, { now = Date.now() } = {}) {
  const existing = await db.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider, providerUserId: identity.providerUserId } },
  });

  if (mode === 'link') {
    const user = await db.user.findUnique({ where: { id: linkUserId } });
    if (!user) return { action: 'link-error', error: 'conta' };
    const kind = blockedKind(user, now);
    if (kind) return { action: 'blocked', kind };
    if (existing) {
      if (existing.userId === user.id) return { action: 'link-ok', already: true };
      return { action: 'link-error', error: 'ja-vinculada' };
    }
    const sameProvider = await db.oAuthAccount.findFirst({ where: { userId: user.id, provider } });
    if (sameProvider) return { action: 'link-error', error: 'provedor-ja-vinculado' };
    try {
      await db.oAuthAccount.create({
        data: {
          userId: user.id, provider, providerUserId: identity.providerUserId,
          email: identity.emailVerified ? identity.email : null,
        },
      });
    } catch (err) {
      if (err && err.code === 'P2002') return { action: 'link-error', error: 'ja-vinculada' };
      throw err;
    }
    return { action: 'link-ok', already: false };
  }

  if (existing) {
    const user = await db.user.findUnique({ where: { id: existing.userId } });
    if (!user) return { action: 'signup', identity };
    const kind = blockedKind(user, now);
    if (kind) return { action: 'blocked', kind };
    if (user.twoFactorEnabled) return { action: 'two-factor', user };
    return { action: 'login', user };
  }

  if (identity.email && identity.emailVerified) {
    const byEmail = await db.user.findFirst({ where: { email: identity.email } });
    if (byEmail) return { action: 'email-exists' };
  }

  const pending = await db.membershipApplication.findFirst({
    where: { status: 'PENDING', oauthProvider: provider, oauthProviderUserId: identity.providerUserId },
  });
  if (pending) return { action: 'pending' };

  return { action: 'signup', identity };
}

// Sugestão de ClubTag a partir do perfil (a pessoa pode trocar).
function suggestUsername(identity) {
  const base = String(identity?.username || identity?.name || identity?.email?.split('@')[0] || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_.]/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 32);
  return base.length >= 3 ? base : '';
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, STATE_TTL_MS, PENDING_2FA_TTL_MS, SIGNUP_TTL_MS,
  COOKIE_STATE, COOKIE_2FA, COOKIE_SIGNUP,
  isKnownProvider, credentialsFor, enabledProviders, publicBaseUrl, redirectUriFor,
  signPayload, verifyPayload, buildAuthorization, validateState,
  exchangeCode, fetchProfile, resolveCallback, blockedKind, suggestUsername, OAuthError,
};
