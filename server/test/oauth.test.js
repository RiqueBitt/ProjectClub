// Login com Google/Discord/GitHub — estado assinado, troca do código (com
// fetch falso), decisões do callback (entrar, 2FA, e-mail existente que
// NÃO é vinculado sozinho, inscrição) e a etapa de 2FA pendente. Sem
// banco: o prisma e o authController são trocados por versões falsas.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENV = {
  GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret',
  DISCORD_CLIENT_ID: 'd-id', DISCORD_CLIENT_SECRET: 'd-secret',
};
Object.assign(process.env, ENV);
delete process.env.GITHUB_CLIENT_ID;
delete process.env.GITHUB_CLIENT_SECRET;

const oauth = require('../src/services/oauth');

const SECRET = 'segredo-de-teste';
const ORIGIN = 'https://projectclub.squareweb.app';

// ---------------------------------------------------------------- helpers
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) return jsonResponse(404, { error: 'not_found' });
    return typeof handler === 'function' ? handler(url, init) : handler;
  };
  fn.calls = calls;
  return fn;
}

function fakeDb({ accounts = [], users = [], applications = [] } = {}) {
  const created = [];
  return {
    created,
    oAuthAccount: {
      findUnique: async ({ where }) => {
        const k = where.provider_providerUserId;
        return accounts.find((a) => a.provider === k.provider && a.providerUserId === k.providerUserId) || null;
      },
      findFirst: async ({ where }) => accounts.find((a) => a.userId === where.userId && a.provider === where.provider) || null,
      create: async ({ data }) => {
        if (accounts.some((a) => a.provider === data.provider && a.providerUserId === data.providerUserId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `acc-${accounts.length + 1}`, ...data };
        accounts.push(row); created.push(row);
        return row;
      },
    },
    user: {
      findUnique: async ({ where }) => users.find((u) => u.id === where.id) || null,
      findFirst: async ({ where }) => users.find((u) => u.email === where.email) || null,
    },
    membershipApplication: {
      findFirst: async ({ where }) => applications.find((a) => a.status === where.status
        && a.oauthProvider === where.oauthProvider && a.oauthProviderUserId === where.oauthProviderUserId) || null,
    },
  };
}

const googleIdentity = (over = {}) => ({
  providerUserId: 'google-123', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana', username: null, ...over,
});

// ---------------------------------------------------------------- estado
test('provedores: só os que têm id E segredo aparecem', () => {
  assert.deepEqual(oauth.enabledProviders(ENV), ['google', 'discord']);
  assert.deepEqual(oauth.enabledProviders({ GITHUB_CLIENT_ID: 'x' }), []);
  assert.deepEqual(oauth.enabledProviders({ GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'y' }), ['github']);
});

test('URL de retorno usa a primeira CLIENT_ORIGIN, sem barra no fim', () => {
  assert.equal(oauth.redirectUriFor('google', `${ORIGIN}/, http://localhost:5173`), `${ORIGIN}/api/auth/oauth/google/callback`);
  assert.equal(oauth.redirectUriFor('github', ''), 'http://localhost:5173/api/auth/oauth/github/callback');
});

test('início do fluxo: state aleatório + PKCE S256 no Google', () => {
  const a = oauth.buildAuthorization('google', { clientOrigin: ORIGIN, secret: SECRET, source: ENV });
  const u = new URL(a.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'g-id');
  assert.equal(u.searchParams.get('redirect_uri'), `${ORIGIN}/api/auth/oauth/google/callback`);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(u.searchParams.get('code_challenge'));
  assert.ok(!a.url.includes('g-secret'), 'segredo nunca vai na URL');
  const st = oauth.validateState({ cookie: a.cookie, state: u.searchParams.get('state'), provider: 'google', secret: SECRET });
  assert.equal(st.ok, true);
  assert.ok(st.payload.v, 'verifier do PKCE guardado no cookie assinado');

  const d = oauth.buildAuthorization('discord', { clientOrigin: ORIGIN, secret: SECRET, source: ENV });
  assert.equal(new URL(d.url).searchParams.get('code_challenge'), null);
  assert.equal(oauth.buildAuthorization('github', { clientOrigin: ORIGIN, secret: SECRET, source: ENV }), null);
});

test('state: recusa cookie adulterado, state trocado, outro provedor e expirado', () => {
  const now = Date.now();
  const a = oauth.buildAuthorization('google', { clientOrigin: ORIGIN, secret: SECRET, source: ENV, now });
  const state = new URL(a.url).searchParams.get('state');
  const check = (over) => oauth.validateState({ cookie: a.cookie, state, provider: 'google', secret: SECRET, ...over });

  assert.equal(check({}).ok, true);
  assert.equal(check({ cookie: undefined }).ok, false);
  assert.equal(check({ state: 'outro' }).ok, false);
  assert.equal(check({ state: undefined }).ok, false);
  assert.equal(check({ provider: 'discord' }).reason, 'state_provider');
  assert.equal(check({ secret: 'outro-segredo' }).ok, false);
  assert.equal(check({ now: now + oauth.STATE_TTL_MS + 1000 }).ok, false);

  // Troca o conteúdo (ex.: tenta enfiar um userId de "conectar conta").
  const [body, mac] = a.cookie.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.m = 'link'; forged.u = 'vitima';
  const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`;
  assert.equal(check({ cookie: tampered }).ok, false);

  // Um cookie de 2FA pendente não serve como cookie de estado.
  const other = oauth.signPayload({ p: 'google', n: state, m: 'login', exp: now + 60000 }, { secret: SECRET, purpose: '2fa' });
  assert.equal(check({ cookie: other }).ok, false);
});

test('conectar conta: o id da conta logada fica no estado assinado', () => {
  const a = oauth.buildAuthorization('discord', { clientOrigin: ORIGIN, secret: SECRET, source: ENV, mode: 'link', userId: 'u1' });
  const st = oauth.validateState({ cookie: a.cookie, state: new URL(a.url).searchParams.get('state'), provider: 'discord', secret: SECRET });
  assert.equal(st.payload.m, 'link');
  assert.equal(st.payload.u, 'u1');
});

// ------------------------------------------------------- troca do código
test('troca do código no servidor (Google, com PKCE) e perfil normalizado', async () => {
  const f = fakeFetch({
    'https://oauth2.googleapis.com/token': jsonResponse(200, { access_token: 'tok-google', id_token: 'x' }),
    'https://openidconnect.googleapis.com/v1/userinfo': (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer tok-google');
      return jsonResponse(200, { sub: '42', email: 'Ana@Exemplo.com', email_verified: true, name: 'Ana' });
    },
  });
  const token = await oauth.exchangeCode('google', { code: 'c0de', verifier: 'ver', clientOrigin: ORIGIN, source: ENV, fetchImpl: f });
  const body = new URLSearchParams(f.calls[0].init.body);
  assert.equal(body.get('code_verifier'), 'ver');
  assert.equal(body.get('client_secret'), 'g-secret');
  assert.equal(body.get('redirect_uri'), `${ORIGIN}/api/auth/oauth/google/callback`);
  const profile = await oauth.fetchProfile('google', token, { fetchImpl: f });
  assert.deepEqual(profile, { providerUserId: '42', email: 'ana@exemplo.com', emailVerified: true, name: 'Ana', username: null });
});

test('GitHub: usa o e-mail primário VERIFICADO da lista', async () => {
  const f = fakeFetch({
    'https://api.github.com/user': jsonResponse(200, { id: 7, login: 'octo', name: null, email: 'publico@x.com' }),
    'https://api.github.com/user/emails': jsonResponse(200, [
      { email: 'nao@x.com', primary: false, verified: false },
      { email: 'Octo@X.com', primary: true, verified: true },
    ]),
  });
  const p = await oauth.fetchProfile('github', 'tok', { fetchImpl: f });
  assert.equal(p.providerUserId, '7');
  assert.equal(p.email, 'octo@x.com');
  assert.equal(p.emailVerified, true);
  assert.equal(p.name, 'octo');
});

test('troca do código falhando vira erro sem o corpo da resposta', async () => {
  const f = fakeFetch({ 'https://discord.com/api/oauth2/token': jsonResponse(400, { error: 'invalid_grant', access_token_hint: 'segredo' }) });
  await assert.rejects(
    oauth.exchangeCode('discord', { code: 'x', clientOrigin: ORIGIN, source: ENV, fetchImpl: f }),
    (err) => err.code === 'token_exchange_failed' && !String(err.message).includes('segredo'),
  );
  await assert.rejects(oauth.exchangeCode('google', { code: 'x', clientOrigin: ORIGIN, source: ENV, fetchImpl: f }), { code: 'pkce_missing' });
});

// -------------------------------------------------------------- decisões
test('decisão: conta vinculada entra; banida/suspensa/desativada não', async () => {
  const base = { id: 'u1', email: 'ana@exemplo.com', twoFactorEnabled: false };
  const accounts = [{ provider: 'google', providerUserId: 'google-123', userId: 'u1' }];
  const login = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' }, fakeDb({ accounts, users: [base] }));
  assert.equal(login.action, 'login');
  assert.equal(login.user.id, 'u1');

  for (const [over, kind] of [
    [{ isPlatformBanned: true }, 'banida'],
    [{ suspendedUntil: new Date(Date.now() + 3600e3) }, 'suspensa'],
    [{ accountDisabledAt: new Date() }, 'desativada'],
  ]) {
    const r = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' }, fakeDb({ accounts, users: [{ ...base, ...over }] }));
    assert.deepEqual(r, { action: 'blocked', kind });
  }
  const expired = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' },
    fakeDb({ accounts, users: [{ ...base, suspendedUntil: new Date(Date.now() - 1000) }] }));
  assert.equal(expired.action, 'login');
});

test('decisão: conta vinculada com 2FA exige o código antes da sessão', async () => {
  const db = fakeDb({
    accounts: [{ provider: 'google', providerUserId: 'google-123', userId: 'u1' }],
    users: [{ id: 'u1', email: 'ana@exemplo.com', twoFactorEnabled: true }],
  });
  const r = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' }, db);
  assert.equal(r.action, 'two-factor');
  assert.equal(r.user.id, 'u1');
});

test('decisão: e-mail verificado que já tem conta NÃO é vinculado sozinho', async () => {
  const db = fakeDb({ users: [{ id: 'u1', email: 'ana@exemplo.com' }] });
  const r = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' }, db);
  assert.equal(r.action, 'email-exists');
  assert.equal(db.created.length, 0, 'nenhuma OAuthAccount criada');
});

test('decisão: e-mail NÃO verificado nunca casa com conta existente (vai pra inscrição)', async () => {
  const db = fakeDb({ users: [{ id: 'u1', email: 'ana@exemplo.com' }] });
  const r = await oauth.resolveCallback({ provider: 'discord', identity: googleIdentity({ emailVerified: false }), mode: 'login' }, db);
  assert.equal(r.action, 'signup');
  assert.equal(db.created.length, 0);
});

test('decisão: sem conta → inscrição; inscrição pendente com a mesma identidade → aviso', async () => {
  const r = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' }, fakeDb());
  assert.equal(r.action, 'signup');
  const pending = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'login' },
    fakeDb({ applications: [{ status: 'PENDING', oauthProvider: 'google', oauthProviderUserId: 'google-123' }] }));
  assert.equal(pending.action, 'pending');
});

test('decisão: conectar pelas Configurações', async () => {
  const users = [{ id: 'u1', email: 'ana@exemplo.com' }, { id: 'u2', email: 'bia@exemplo.com' }];
  const db = fakeDb({ users });
  const ok = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'link', linkUserId: 'u1' }, db);
  assert.deepEqual(ok, { action: 'link-ok', already: false });
  assert.equal(db.created[0].userId, 'u1');
  assert.equal(db.created[0].email, 'ana@exemplo.com');

  const again = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'link', linkUserId: 'u1' }, db);
  assert.deepEqual(again, { action: 'link-ok', already: true });

  const other = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity(), mode: 'link', linkUserId: 'u2' }, db);
  assert.deepEqual(other, { action: 'link-error', error: 'ja-vinculada' });

  const second = await oauth.resolveCallback({ provider: 'google', identity: googleIdentity({ providerUserId: 'google-999' }), mode: 'link', linkUserId: 'u1' }, db);
  assert.deepEqual(second, { action: 'link-error', error: 'provedor-ja-vinculado' });
});

test('sugestão de ClubTag a partir do perfil', () => {
  assert.equal(oauth.suggestUsername({ username: 'João Silva!' }), 'Joao_Silva');
  assert.equal(oauth.suggestUsername({ email: 'ab@x.com' }), '');
  assert.equal(oauth.suggestUsername({ name: 'Maria' }), 'Maria');
});

// ----------------------------------------------- controller (ponta a ponta)
// Troca prisma e authController por falsos antes de carregar o controller.
function loadController({ db, auth }) {
  const stub = (rel, exports) => {
    const file = require.resolve(path.join('..', 'src', rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  stub('config/prisma.js', db);
  stub('controllers/authController.js', auth);
  delete require.cache[require.resolve('../src/controllers/oauthController.js')];
  return require('../src/controllers/oauthController.js');
}

function fakeRes() {
  const res = {
    statusCode: 200, cookies: {}, cleared: [], headers: {}, body: undefined, location: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    cookie(name, value, opts) { this.cookies[name] = { value, opts }; return this; },
    clearCookie(name) { this.cleared.push(name); return this; },
    redirect(code, url) { this.statusCode = code; this.location = url; return this; },
  };
  return res;
}

test('callback ponta a ponta: conta com 2FA → cookie pendente; /oauth/2fa só entra com código válido', async () => {
  const env = require('../src/config/env');
  const users = [{ id: 'u1', email: 'ana@exemplo.com', twoFactorEnabled: true }];
  const db = fakeDb({ accounts: [{ provider: 'google', providerUserId: '42', userId: 'u1' }], users });
  const sessions = [];
  const failures = [];
  const ctrl = loadController({
    db,
    auth: {
      completeLogin: async (req, res, user) => { sessions.push(user.id); return { user: { id: user.id }, accessToken: 'at' }; },
      verifyTotpOnce: async (user, code) => code === '123456',
      consumeRecoveryCode: async () => false,
      registerFailedLogin: async (user) => { failures.push(user.id); },
      isAccountBlocked: (u) => !u || !!u.isPlatformBanned,
    },
  });
  ctrl.__fetch = fakeFetch({
    'https://oauth2.googleapis.com/token': jsonResponse(200, { access_token: 'tok' }),
    'https://openidconnect.googleapis.com/v1/userinfo': jsonResponse(200, { sub: '42', email: 'ana@exemplo.com', email_verified: true }),
  });

  // 1) /start grava o cookie de estado e manda pro Google.
  const startRes = fakeRes();
  ctrl.start({ params: { provider: 'google' }, query: {} }, startRes);
  assert.equal(startRes.statusCode, 302);
  assert.ok(startRes.location.startsWith('https://accounts.google.com/'));
  const stateCookie = startRes.cookies[oauth.COOKIE_STATE];
  assert.equal(stateCookie.opts.httpOnly, true);
  assert.equal(stateCookie.opts.maxAge, 10 * 60 * 1000);
  const state = new URL(startRes.location).searchParams.get('state');

  // 2) callback com state errado é recusado sem nem trocar o código.
  const bad = fakeRes();
  await ctrl.callback({ params: { provider: 'google' }, query: { code: 'c', state: 'errado' }, cookies: { [oauth.COOKIE_STATE]: stateCookie.value }, headers: {} }, bad, assert.fail);
  assert.match(bad.location, /^\/login\?oauth_error=estado/);
  assert.equal(ctrl.__fetch.calls.length, 0);

  // 3) callback válido: conta com 2FA → nada de sessão ainda.
  const cb = fakeRes();
  await ctrl.callback({ params: { provider: 'google' }, query: { code: 'c', state }, cookies: { [oauth.COOKIE_STATE]: stateCookie.value }, headers: {} }, cb, assert.fail);
  assert.equal(cb.location, '/login?oauth_2fa=google');
  assert.ok(cb.cleared.includes(oauth.COOKIE_STATE), 'cookie de estado é de uso único');
  assert.equal(sessions.length, 0);
  const pending = cb.cookies[oauth.COOKIE_2FA];
  assert.ok(pending?.value);
  assert.equal(oauth.verifyPayload(pending.value, { secret: env.JWT_ACCESS_SECRET, purpose: '2fa' }).uid, 'u1');

  // 4) /oauth/2fa: sem cookie, sem código e com código errado → recusa.
  const noCookie = fakeRes();
  await ctrl.complete2FA({ cookies: {}, body: { twoFactorCode: '123456' }, headers: {} }, noCookie, assert.fail);
  assert.equal(noCookie.statusCode, 401);
  const noCode = fakeRes();
  await ctrl.complete2FA({ cookies: { [oauth.COOKIE_2FA]: pending.value }, body: {}, headers: {} }, noCode, assert.fail);
  assert.equal(noCode.statusCode, 400);
  const wrong = fakeRes();
  await ctrl.complete2FA({ cookies: { [oauth.COOKIE_2FA]: pending.value }, body: { twoFactorCode: '000000' }, headers: {} }, wrong, assert.fail);
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(failures, ['u1']);
  assert.equal(sessions.length, 0);

  // 5) código certo → mesma emissão de sessão do login com senha.
  const ok = fakeRes();
  await ctrl.complete2FA({ cookies: { [oauth.COOKIE_2FA]: pending.value }, body: { twoFactorCode: '123456' }, headers: {} }, ok, assert.fail);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { user: { id: 'u1' }, accessToken: 'at' });
  assert.deepEqual(sessions, ['u1']);
  assert.ok(ok.cleared.includes(oauth.COOKIE_2FA));
});

test('callback ponta a ponta: e-mail existente não vincula; sem conta vai pra inscrição com cookie assinado', async () => {
  const env = require('../src/config/env');
  const db = fakeDb({ users: [{ id: 'u1', email: 'ana@exemplo.com' }] });
  const sessions = [];
  const ctrl = loadController({
    db,
    auth: {
      completeLogin: async (req, res, user) => { sessions.push(user.id); return {}; },
      verifyTotpOnce: async () => false, consumeRecoveryCode: async () => false,
      registerFailedLogin: async () => {}, isAccountBlocked: () => false,
    },
  });
  const run = async (email) => {
    ctrl.__fetch = fakeFetch({
      'https://discord.com/api/oauth2/token': jsonResponse(200, { access_token: 'tok' }),
      'https://discord.com/api/users/@me': jsonResponse(200, { id: '99', username: 'bia_gamer', global_name: 'Bia', email, verified: true }),
    });
    const s = fakeRes();
    ctrl.start({ params: { provider: 'discord' }, query: { from: 'register' } }, s);
    const state = new URL(s.location).searchParams.get('state');
    const r = fakeRes();
    await ctrl.callback({ params: { provider: 'discord' }, query: { code: 'c', state }, cookies: { [oauth.COOKIE_STATE]: s.cookies[oauth.COOKIE_STATE].value }, headers: {} }, r, assert.fail);
    return r;
  };

  const exists = await run('ana@exemplo.com');
  assert.equal(exists.location, '/login?oauth_error=email_existente&provider=discord');
  assert.equal(db.created.length, 0);
  assert.equal(sessions.length, 0);

  const fresh = await run('bia@exemplo.com');
  assert.equal(fresh.location, '/register?oauth=discord');
  const signup = oauth.verifyPayload(fresh.cookies[oauth.COOKIE_SIGNUP].value, { secret: env.JWT_ACCESS_SECRET, purpose: 'signup' });
  assert.equal(signup.p, 'discord');
  assert.equal(signup.id, '99');
  assert.equal(signup.email, 'bia@exemplo.com');
  assert.equal(signup.username, 'bia_gamer');
  assert.equal(fresh.cookies[oauth.COOKIE_SIGNUP].opts.httpOnly, true);
  assert.equal(sessions.length, 0, 'inscrição nunca cria sessão nem conta');
});
