// Navegador do Project Club na versão site (navegadores comuns): antes de
// abrir uma página dentro do app (iframe), o servidor confere se o site
// PERMITE ser aberto dentro de outro site (X-Frame-Options e CSP
// frame-ancestors). Só lê cabeçalhos e o <title> — não repassa a página,
// não guarda nada do usuário e não serve de proxy.
//
// Proteções (SSRF): só http/https nas portas padrão, nada de IP local,
// privado, link-local ou de metadados — a checagem é feita no IP que a
// conexão realmente usa (lookup próprio), então trocar o DNS no meio não
// engana. Redirecionamentos são seguidos um a um com a mesma regra.

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 6000;
const MAX_BODY = 96 * 1024;
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 2000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 ProjectClubBrowserCheck/1.0';

const cache = new Map();

function ipv4Blocked(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local / metadados de nuvem
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && p[2] === 0)
    || (a === 192 && b === 0 && p[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && p[2] === 100)
    || (a === 203 && b === 0 && p[2] === 113);
}

function ipBlocked(ip) {
  if (net.isIPv4(ip)) return ipv4Blocked(ip);
  if (!net.isIPv6(ip)) return true;
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Blocked(mapped[1]);
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v) || v.startsWith('64:ff9b:') || v.startsWith('2001:db8') || v.startsWith('::ffff:');
}

// lookup usado pela conexão: só devolve IPs públicos.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = (list || []).filter((a) => !ipBlocked(a.address));
    if (!ok.length) return cb(Object.assign(new Error('endereço bloqueado'), { code: 'EBLOCKED' }));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function parseTarget(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i.test(host)) return null;
  if (net.isIP(host) && ipBlocked(host)) return null;
  if (!net.isIP(host) && !host.includes('.')) return null;
  u.hash = '';
  return u;
}

function request(u) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method: 'GET',
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6' },
    }, (res) => {
      const isHtml = /html/i.test(String(res.headers['content-type'] || ''));
      if ((res.statusCode >= 300 && res.statusCode < 400) || !isHtml) {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers, body: '' });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (size >= MAX_BODY) res.destroy();
      });
      const done = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.on('end', done);
      res.on('close', done);
      res.on('error', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('tempo esgotado'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

const decodeEntities = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html || '');
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

// O site deixa ser aberto dentro de `appOrigin`?
function framePolicy(headers, appOrigin) {
  const csps = [].concat(headers['content-security-policy'] || []).join(',');
  const fa = /(?:^|[;,])\s*frame-ancestors\s+([^;,]*)/i.exec(csps);
  if (fa) {
    const sources = fa[1].trim().split(/\s+/).filter(Boolean);
    if (!sources.length || sources.includes("'none'")) return { framable: false, reason: 'csp' };
    const app = new URL(appOrigin);
    const ok = sources.some((s) => {
      if (s === '*' || s === 'https:' || (s === 'http:' && app.protocol === 'http:')) return true;
      if (s === "'self'") return false;
      const m = /^(?:(https?):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/i.exec(s);
      if (!m) return false;
      if (m[1] && `${m[1]}:` !== app.protocol) return false;
      const host = m[3].toLowerCase();
      return m[2] ? app.hostname.endsWith(`.${host}`) : app.hostname === host;
    });
    return ok ? { framable: true } : { framable: false, reason: 'csp' };
  }
  const xfo = String([].concat(headers['x-frame-options'] || [])[0] || '').trim().toLowerCase();
  if (xfo === 'deny' || xfo === 'sameorigin' || xfo.startsWith('allow-from')) return { framable: false, reason: 'xfo' };
  return { framable: true };
}

async function check(rawUrl, appOrigin) {
  let u = parseTarget(rawUrl);
  if (!u) return { ok: false, error: 'invalid' };
  const key = `${u.href}|${appOrigin}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  let value;
  try {
    let res;
    for (let i = 0; ; i++) {
      res = await request(u);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (i >= MAX_REDIRECTS) { value = { ok: false, error: 'redirects' }; break; }
        const next = parseTarget(new URL(res.headers.location, u).href);
        if (!next) { value = { ok: false, error: 'blocked' }; break; }
        u = next;
        continue;
      }
      break;
    }
    if (!value) {
      const pol = framePolicy(res.headers, appOrigin);
      value = {
        ok: true,
        status: res.status,
        finalUrl: u.href,
        title: titleOf(res.body),
        framable: pol.framable && u.protocol === 'https:', // http dentro de https é bloqueado pelo navegador
        reason: pol.framable ? (u.protocol === 'https:' ? null : 'insecure') : pol.reason,
      };
    }
  } catch (e) {
    value = { ok: false, error: e.code === 'EBLOCKED' ? 'blocked' : e.code === 'ETIMEDOUT' ? 'timeout' : 'unreachable' };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Sugestões da barra de endereço (DuckDuckGo autocomplete, só o texto digitado).
const suggestCache = new Map();
async function suggest(q) {
  const text = String(q || '').trim().slice(0, 120);
  if (!text) return [];
  const k = text.toLowerCase();
  const hit = suggestCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list;
  try {
    const r = await fetch(`https://duckduckgo.com/ac/?type=list&kl=br-pt&q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(2500), headers: { 'User-Agent': UA } });
    const j = await r.json();
    const list = (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : Array.isArray(j) ? j.map((x) => x?.phrase) : [])
      .filter((s) => typeof s === 'string').slice(0, 8);
    if (suggestCache.size > 3000) suggestCache.delete(suggestCache.keys().next().value);
    suggestCache.set(k, { at: Date.now(), list });
    return list;
  } catch {
    return [];
  }
}

module.exports = { check, suggest, framePolicy, parseTarget, ipBlocked, titleOf };
