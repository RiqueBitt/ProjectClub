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
const fs = require('fs');
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
// Fichas guardadas na conta: a própria pessoa sempre; o mestre de uma mesa
// de RPG vê as de quem está sentado na mesa dele (?channel=<canal>).
api.get('/fichas/:userId', requireAuth, async (req, res) => {
  const target = req.params.userId === 'me' ? req.user.id : String(req.params.userId);
  if (target !== req.user.id) {
    const channelId = String(req.query.channel || '');
    let ok = false;
    if (channelId) {
      try {
        const t = await require('../sockets/rpgTable').getTable(channelId);
        // Quem está sentado à mesa (mestre ou jogador) vê a ficha de quem também está.
        const seated = [t.master, ...t.players].filter(Boolean);
        ok = seated.includes(req.user.id) && seated.includes(target);
      } catch { ok = false; }
    }
    if (!ok) return res.status(403).json({ error: 'Só o mestre da mesa vê a ficha dos jogadores.' });
  }
  res.json(await sheetsFor(target));
});

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
  req.blackoutUserId = userId;
  next();
}

// ===== Fichas na conta (nov/2026) =====
// O index.html do site ganha um <script src="__conta.js"> logo no <head>:
// antes do site ler o localStorage, ele busca as fichas da conta; depois,
// toda vez que o site grava as fichas, manda pra conta.
const SHEETS_MAX = 1_500_000; // ~1,5 MB de fichas por conta
const CONTA_JS = `(function(){
// Modo "rolador" (?pc=dados): só o rolador 3D do capítulo Rolagem, dentro da
// call do Project Club; cada resultado vai pro app (postMessage).
if(location.search.indexOf('pc=dados')>=0){
  var st=document.createElement('style');
  st.textContent='body>*:not(#rolagem):not(script):not(style){display:none!important}#rolagem{display:block!important}#rolagem .cap,#rolagem .roleta{display:none!important}#rolagem .wrap{padding-top:6px!important}html,body{background:#0b0b0d!important;margin:0}';
  document.head.appendChild(st);
  document.addEventListener('DOMContentLoaded',function(){
    var r=document.getElementById('rolagem');if(!r)return;
    r.hidden=false;r.removeAttribute('aria-hidden');if(r.parentNode!==document.body)document.body.appendChild(r);
    setTimeout(function(){window.dispatchEvent(new Event('resize'))},60);
    var v=document.getElementById('veredito'),ult='';
    function g(id){var e=document.getElementById(id);return e?e.textContent:''}
    function dado(t,val){var p=t.split(' · D');return {name:p[0]||'',sides:parseInt(p[1],10)||0,value:parseInt(val,10)||0}}
    if(v)new MutationObserver(function(){var t=(v.textContent||'').trim();if(!t)return;var k=t+g('r1')+g('r2')+g('n1')+Date.now();if(k===ult)return;ult=k;
      try{parent.postMessage({type:'bo-roll',dice:[dado(g('n1'),g('r1')),dado(g('n2'),g('r2'))],dif:parseInt((document.getElementById('dif')||{}).value,10)||4,verdict:t},location.origin)}catch(e){}
    }).observe(v,{childList:true,characterData:true,subtree:true});
  });
}
var K='bo_gh_fichas',A='bo_gh_atual',D='bo_gh_dono',ls=window.localStorage,set=Storage.prototype.setItem,rm=Storage.prototype.removeItem;
function req(m,b){var x=new XMLHttpRequest();x.open(m,'__fichas',false);x.setRequestHeader('Content-Type','application/json');x.send(b||null);return x.status===200?JSON.parse(x.responseText||'null'):null}
var me=null;try{me=req('GET')}catch(e){}
if(me&&me.userId){
  var dono=ls.getItem(D);
  if(me.fichas!=null){set.call(ls,K,me.fichas);if(me.atual)set.call(ls,A,me.atual);else rm.call(ls,A)}
  else if(!dono||dono===me.userId){var lf=ls.getItem(K);if(lf&&lf!=='[]'){try{req('PUT',JSON.stringify({fichas:lf,atual:ls.getItem(A)}))}catch(e){}}}
  else{rm.call(ls,K);rm.call(ls,A)}
  set.call(ls,D,me.userId);
  function resumo(f){var r=[];try{JSON.parse(f).forEach(function(x){var pv=null;try{pv=typeof window.pvPadrao==='function'?window.pvPadrao(x):null}catch(e){}r.push({id:x.id,nome:x.nome||'',classe:(x.classe&&x.classe[0])||null,pv:pv,lv:(x.mesaP&&x.mesaP.lv)||1})})}catch(e){}return r}
  var t=null;function enviar(){t=null;var f=ls.getItem(K)||'[]';try{fetch('__fichas',{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({fichas:f,atual:ls.getItem(A),resumo:resumo(f)})})}catch(e){}}
  window.addEventListener('load',function(){setTimeout(enviar,1500)});
  function mudou(k){if((k===K||k===A)&&this===ls){clearTimeout(t);t=setTimeout(enviar,700)}}
  Storage.prototype.setItem=function(k,v){set.call(this,k,v);mudou.call(this,k)};
  Storage.prototype.removeItem=function(k){rm.call(this,k);mudou.call(this,k)};
  window.addEventListener('pagehide',function(){if(t){clearTimeout(t);enviar()}});
}
})();`;

async function readSheets(userId) {
  try { return await db().blackoutSheets.findUnique({ where: { userId } }); } catch { return null; }
}
async function sheetsFor(userId) {
  const row = await readSheets(userId);
  let fichas = [];
  try { fichas = row ? JSON.parse(row.fichas) : []; } catch { fichas = []; }
  let resumo = [];
  try { resumo = row?.resumo ? JSON.parse(row.resumo) : []; } catch { resumo = []; }
  const byId = new Map((Array.isArray(resumo) ? resumo : []).map((r) => [r.id, r]));
  const list = (Array.isArray(fichas) ? fichas : []).map((f) => ({ ...f, _pv: byId.get(f?.id)?.pv ?? null, _classe: byId.get(f?.id)?.classe ?? null }));
  return { fichas: list, atual: row?.atual || null, updatedAt: row?.updatedAt || null };
}

const site = express.Router();
// /blackout → /blackout/ (o site usa caminhos relativos: vendor/, _blob/).
site.use((req, res, next) => {
  if (req.path === '/' && !req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, `${COOKIE_PATH}/`);
  next();
});
site.use(gate);
site.get('/__conta.js', (req, res) => res.type('application/javascript').send(CONTA_JS));
site.get('/__fichas', async (req, res) => {
  const row = await readSheets(req.blackoutUserId);
  res.json({ userId: req.blackoutUserId, fichas: row ? row.fichas : null, atual: row?.atual || null });
});
site.put('/__fichas', express.json({ limit: '2mb' }), async (req, res) => {
  const fichas = typeof req.body?.fichas === 'string' ? req.body.fichas : '[]';
  if (fichas.length > SHEETS_MAX) return res.status(413).json({ error: 'Fichas grandes demais.' });
  try { if (!Array.isArray(JSON.parse(fichas))) throw new Error('x'); } catch { return res.status(400).json({ error: 'Fichas inválidas.' }); }
  const atual = typeof req.body?.atual === 'string' ? req.body.atual.slice(0, 120) : null;
  // Resumo que o site calculou (PV vem da classe: pvPadrao do compêndio).
  const resumo = Array.isArray(req.body?.resumo) ? JSON.stringify(req.body.resumo.slice(0, 200).map((r) => ({
    id: String(r?.id || '').slice(0, 60), nome: String(r?.nome || '').slice(0, 60), classe: r?.classe ? String(r.classe).slice(0, 60) : null,
    pv: Number.isFinite(+r?.pv) && r?.pv !== null ? Math.max(1, Math.min(99, Math.round(+r.pv))) : null, lv: Math.max(1, Math.min(99, Math.round(+r?.lv) || 1)),
  }))) : undefined;
  await db().blackoutSheets.upsert({
    where: { userId: req.blackoutUserId },
    create: { userId: req.blackoutUserId, fichas, atual, resumo: resumo || null },
    update: { fichas, atual, ...(resumo ? { resumo } : {}) },
  });
  res.json({ ok: true });
});
site.use((req, res, next) => (sync.hasSite() ? next() : res.status(503).type('html').send(NOT_READY_HTML)));
// index.html com o script das fichas na conta.
let indexCache = { mtime: 0, html: '' };
site.get(['/', '/index.html'], (req, res, next) => {
  const file = path.join(sync.SITE_DIR, 'index.html');
  fs.stat(file, (err, st) => {
    if (err) return next();
    if (st.mtimeMs !== indexCache.mtime) {
      const raw = fs.readFileSync(file, 'utf8');
      const tag = '<script src="__conta.js"></script>';
      indexCache = { mtime: st.mtimeMs, html: /<head[^>]*>/i.test(raw) ? raw.replace(/<head[^>]*>/i, (h) => h + tag) : tag + raw };
    }
    res.type('html').send(indexCache.html);
  });
});
site.use(express.static(sync.SITE_DIR, { index: 'index.html', dotfiles: 'ignore', redirect: true, extensions: false }));
site.use((req, res) => res.status(404).type('text/plain').send('Não encontrado.'));

module.exports = { sheetsFor, api, site, gate, siteSecret, COOKIE, COOKIE_PATH, INSTANCE_ID, _allowCache: allowCache };
