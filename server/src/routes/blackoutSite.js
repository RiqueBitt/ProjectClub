// Compêndio BLACKOUT (site estático em sites/blackout) dentro do Project
// Club — só pra quem tem acesso à instância BLACKOUT (Painel da Equipe →
// Instâncias; ADMIN da plataforma entra em todas).
//
// O site abre num <iframe>, que não manda o "Authorization: Bearer" do app.
// Então: o app chama POST /api/blackout/session (logado) → se a pessoa tem
// acesso, ganha um cookie httpOnly só do caminho /blackout, assinado com
// uma chave PRÓPRIA (derivada da do access token, mas diferente: esse
// cookie não serve como login no resto da API). Cada arquivo do site
// confere o cookie E o acesso de novo (tirou da instância = perdeu o site).
//
// App Android (WebView, sem o login do site): a mesma chamada devolve um
// "passe" de uso único (2 min); o app abre /blackout/?t=<passe> e o servidor
// troca pelo cookie e tira o passe do endereço.
//
// Os arquivos NÃO ficam neste repositório (público): services/blackoutSync.js
// baixa do repo privado do BLACKOUT pra server/data/blackout-site.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = () => require('../config/prisma');
const { requireAuth } = require('../middleware/auth');

const INSTANCE_ID = 'blackout';
const sync = require('../services/blackoutSync');
const COOKIE = 'pc_site_blackout';
const COOKIE_PATH = '/blackout';
const TTL_S = 12 * 60 * 60;
const TICKET_S = 120;
const usedTickets = new Map(); // jti -> expira (ms): passe vale uma vez só

const siteSecret = () => crypto.createHmac('sha256', String(env.JWT_ACCESS_SECRET)).update('site:blackout:v1').digest();

function readCookie(req, name) {
  if (req.cookies && req.cookies[name]) return req.cookies[name];
  const header = req.headers.cookie || '';
  const m = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  if (!m) return null;
  try { return decodeURIComponent(m.slice(name.length + 1)); } catch { return null; }
}

// Quem pode: conta ativa + acesso à instância. Guardado uns segundos (o site
// pede dezenas de arquivos de uma vez ao abrir).
const ALLOW_MS = 30_000;
const allowCache = new Map(); // userId -> { at, ok }
async function userMayOpen(userId) {
  const hit = allowCache.get(userId);
  if (hit && Date.now() - hit.at < ALLOW_MS) return hit.ok;
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, platformRole: true, isPlatformBanned: true, accountDisabledAt: true, suspendedUntil: true },
  }).catch(() => null);
  const ok = !!user && !user.isPlatformBanned && !user.accountDisabledAt
    && !(user.suspendedUntil && new Date(user.suspendedUntil) > new Date());
  // Nov/2026: o BLACKOUT ficou público (canal em destaque Jogos) — não
  // depende mais da instância BLACKOUT; basta estar logado e sem bloqueio.
  allowCache.set(userId, { at: Date.now(), ok });
  if (allowCache.size > 2000) allowCache.clear();
  return ok;
}

// O site é um arquivo só com scripts embutidos e usa three.js/cannon.js do
// cdnjs e fontes do Google: política de segurança própria (a do app
// bloquearia tudo isso). Só pode abrir dentro do próprio Project Club.
const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const DENIED_HTML = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>BLACKOUT</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#ddd;font:15px system-ui,sans-serif;text-align:center}
b{display:block;font-size:22px;letter-spacing:.2em;color:#fff;margin-bottom:8px}</style></head>
<body><div><b>BLACKOUT</b>Sem acesso. Abra pelo Project Club, na instância BLACKOUT.</div></body></html>`;

const NOT_READY_HTML = DENIED_HTML.replace('Sem acesso. Abra pelo Project Club, na instância BLACKOUT.', 'O compêndio ainda está sendo baixado. Tente de novo em alguns instantes.');

const api = express.Router();
api.post('/session', requireAuth, async (req, res) => {
  allowCache.delete(req.user.id);
  if (!(await userMayOpen(req.user.id))) return res.status(403).json({ error: 'Você não tem acesso à instância BLACKOUT.' });
  setSiteCookie(res, req.user.id);
  const ticket = jwt.sign({ sub: req.user.id, typ: 'ticket', jti: crypto.randomBytes(12).toString('hex') }, siteSecret(), { algorithm: 'HS256', expiresIn: TICKET_S });
  res.json({ ok: true, url: `${COOKIE_PATH}/`, ticket, ready: sync.hasSite() });
});
// Baixa a versão nova do compêndio agora (a administração pede quando quiser).
api.post('/sync', requireAuth, async (req, res) => {
  if (req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Só a administração.' });
  res.json(await sync.sync());
});
// Pra equipe conferir se o download do GitHub está funcionando.
api.get('/status', requireAuth, (req, res) => {
  if (req.user.platformRole !== 'ADMIN') return res.status(403).json({ error: 'Só a administração.' });
  res.json(sync.getStatus());
});

function setSiteCookie(res, userId) {
  const token = jwt.sign({ sub: userId, typ: 'site' }, siteSecret(), { algorithm: 'HS256', expiresIn: TTL_S });
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: COOKIE_PATH, maxAge: TTL_S * 1000,
  });
}

function useTicket(raw) {
  let p;
  try { p = jwt.verify(String(raw), siteSecret(), { algorithms: ['HS256'] }); } catch { return null; }
  if (p.typ !== 'ticket' || !p.jti || usedTickets.has(p.jti)) return null;
  const now = Date.now();
  for (const [k, exp] of usedTickets) if (exp < now) usedTickets.delete(k);
  usedTickets.set(p.jti, (p.exp || 0) * 1000);
  return p.sub;
}

async function gate(req, res, next) {
  res.setHeader('Content-Security-Policy', SITE_CSP);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Robots-Tag', 'noindex');
  // Passe do app: vira cookie e sai do endereço.
  if (req.query && req.query.t) {
    const fromTicket = useTicket(req.query.t);
    if (fromTicket && (await userMayOpen(fromTicket))) {
      setSiteCookie(res, fromTicket);
      return res.redirect(302, `${COOKIE_PATH}${req.path === '/' ? '/' : req.path}`);
    }
  }
  const raw = readCookie(req, COOKIE);
  let userId = null;
  if (raw) {
    try {
      const p = jwt.verify(raw, siteSecret(), { algorithms: ['HS256'] });
      userId = p.typ === 'site' ? p.sub : null;
    } catch { userId = null; }
  }
  if (!userId || !(await userMayOpen(userId))) {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    return res.status(403).type('html').send(DENIED_HTML);
  }
  next();
}

const site = express.Router();
// /blackout → /blackout/ (o site usa caminhos relativos: vendor/, _blob/).
site.use((req, res, next) => {
  if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, `${COOKIE_PATH}/`);
  next();
});
site.use(gate);
site.use((req, res, next) => (sync.hasSite() ? next() : res.status(503).type('html').send(NOT_READY_HTML)));
site.use(express.static(sync.SITE_DIR, { index: 'index.html', dotfiles: 'ignore', redirect: true, extensions: false }));
site.use((req, res) => res.status(404).type('text/plain').send('Não encontrado.'));

module.exports = { api, site, gate, siteSecret, COOKIE, COOKIE_PATH, INSTANCE_ID, _allowCache: allowCache };
