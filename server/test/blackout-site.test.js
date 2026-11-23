const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Compêndio BLACKOUT (routes/blackoutSite.js): só abre com o cookie do site
// E acesso à instância BLACKOUT; o cookie não vale como login na API.
const src = (p) => path.resolve(__dirname, '../src', p);
function stub(rel, exports) {
  const id = src(rel);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'segredo-de-teste-blackout';
// Site falso numa pasta temporária (o de verdade vem do GitHub: services/blackoutSync.js).
const fs = require('node:fs');
const os = require('node:os');
const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bo-site-'));
process.env.BLACKOUT_SITE_DIR = siteDir;
process.env.BLACKOUT_SYNC = '0';
fs.mkdirSync(path.join(siteDir, 'vendor'));
fs.writeFileSync(path.join(siteDir, 'index.html'), '<!DOCTYPE html><title>BLACKOUT</title>');
fs.writeFileSync(path.join(siteDir, 'vendor', 'pdf-lib.min.js'), '// js');
fs.writeFileSync(path.join(siteDir, '.pc-sha'), 'abc');
const env = require(src('config/env.js'));

const members = new Set(['ana']);
stub('config/prisma.js', {
  user: { findUnique: async ({ where }) => (['ana', 'bia'].includes(where.id) ? { id: where.id, platformRole: 'USER' } : null) },
});
stub('services/instances.js', { canAccess: async (u, id) => id === 'blackout' && members.has(u.id) });
stub('middleware/auth.js', {
  requireAuth: (req, res, next) => { const u = req.headers['x-test-user']; if (!u) return res.status(401).end(); req.user = { id: u }; next(); },
});
delete require.cache[src('routes/blackoutSite.js')];
delete require.cache[src('services/blackoutSync.js')];
const site = require(src('routes/blackoutSite.js'));
const express = require('express');
const jwt = require('jsonwebtoken');

async function withServer(fn) {
  const app = express();
  app.use('/api/blackout', site.api);
  app.use('/blackout', site.site);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('sem cookie: 403 com a página de "sem acesso"', async () => withServer(async (base) => {
  const r = await fetch(`${base}/blackout/`);
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Sem acesso/);
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
}));

test('quem tem a instância ganha o cookie e abre o site; /blackout redireciona pra /blackout/', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  assert.equal(s.status, 200);
  const cookie = (s.headers.get('set-cookie') || '').split(';')[0];
  assert.match(s.headers.get('set-cookie'), /Path=\/blackout/);
  assert.match(s.headers.get('set-cookie'), /HttpOnly/);
  const r = await fetch(`${base}/blackout/`, { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /BLACKOUT/);
  const img = await fetch(`${base}/blackout/vendor/pdf-lib.min.js`, { headers: { cookie } });
  assert.equal(img.status, 200);
  const red = await fetch(`${base}/blackout`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(red.status, 301);
  assert.equal(red.headers.get('location'), '/blackout/');
}));

test('sem a instância: nem ganha cookie; e perder o acesso derruba o cookie', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'bia' } });
  assert.equal(s.status, 403);
  const token = jwt.sign({ sub: 'bia', typ: 'site' }, site.siteSecret(), { algorithm: 'HS256', expiresIn: 60 });
  const r = await fetch(`${base}/blackout/`, { headers: { cookie: `${site.COOKIE}=${token}` } });
  assert.equal(r.status, 403);
}));

test('cookie do site não serve como access token (chave diferente)', () => {
  const token = jwt.sign({ sub: 'ana' }, site.siteSecret(), { algorithm: 'HS256', expiresIn: 60 });
  assert.throws(() => jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }));
  const forged = jwt.sign({ sub: 'ana' }, env.JWT_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: 60 });
  return withServer(async (base) => {
    const r = await fetch(`${base}/blackout/`, { headers: { cookie: `${site.COOKIE}=${forged}` } });
    assert.equal(r.status, 403);
  });
});

test('arquivo escondido (.pc-sha) não é servido', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  const cookie = (s.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch(`${base}/blackout/.pc-sha`, { headers: { cookie } });
  assert.notEqual(r.status, 200);
}));

test('site ainda não baixado: 503 com aviso', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  const cookie = (s.headers.get('set-cookie') || '').split(';')[0];
  fs.renameSync(path.join(siteDir, 'index.html'), path.join(siteDir, 'x.html'));
  try {
    const r = await fetch(`${base}/blackout/`, { headers: { cookie } });
    assert.equal(r.status, 503);
    assert.match(await r.text(), /sendo baixado/);
  } finally { fs.renameSync(path.join(siteDir, 'x.html'), path.join(siteDir, 'index.html')); }
}));

test('passe do app: vale uma vez, vira cookie e sai do endereço', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  const { ticket } = await s.json();
  assert.ok(ticket);
  const r = await fetch(`${base}/blackout/?t=${encodeURIComponent(ticket)}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/blackout/');
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await fetch(`${base}/blackout/`, { headers: { cookie } })).status, 200);
  // de novo: o passe já foi usado
  assert.equal((await fetch(`${base}/blackout/?t=${encodeURIComponent(ticket)}`, { redirect: 'manual' })).status, 403);
}));

test('passe não serve como cookie (nem o cookie como passe)', async () => withServer(async (base) => {
  const s = await fetch(`${base}/api/blackout/session`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  const { ticket } = await s.json();
  assert.equal((await fetch(`${base}/blackout/`, { headers: { cookie: `${site.COOKIE}=${ticket}` } })).status, 403);
  const cookieTok = jwt.sign({ sub: 'ana', typ: 'site' }, site.siteSecret(), { algorithm: 'HS256', expiresIn: 60 });
  assert.equal((await fetch(`${base}/blackout/?t=${cookieTok}`, { redirect: 'manual' })).status, 403);
}));

test('atualizar o compêndio: só ADMIN', async () => withServer(async (base) => {
  const r = await fetch(`${base}/api/blackout/sync`, { method: 'POST', headers: { 'x-test-user': 'ana' } });
  assert.equal(r.status, 403);
}));
