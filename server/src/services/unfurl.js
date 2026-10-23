// Prévia de link (GET /api/unfurl?url=) — busca a página e lê as tags
// Open Graph (og:title, og:description, og:image, og:site_name) e a
// theme-color, pra desenhar um cartão compacto embaixo da mensagem.
//
// SEGURANÇA (SSRF): o servidor busca uma URL escolhida por um usuário,
// então:
//  - só http/https, sem usuário/senha na URL, só as portas 80/443;
//  - o IP é checado NA HORA DE CONECTAR (opção `lookup` do http.request),
//    não só antes — um DNS que responde um IP público na checagem e um
//    privado na conexão (DNS rebinding) não passa;
//  - bloqueia loopback, redes privadas, link-local (inclui o
//    169.254.169.254 de metadados de nuvem), CGNAT, multicast e afins,
//    em IPv4 e IPv6 (inclusive IPv4 mapeado em IPv6);
//  - redirecionamento é seguido na mão (no máximo 3), cada salto passando
//    pelas mesmas regras;
//  - 5s de tempo total e no máximo 1MB lido da resposta.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'Mozilla/5.0 (compatible; ProjectClubBot/1.0; +link-preview)';

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, p) => ((acc << 8) + Number(p)) >>> 0, 0);
}
function inV4Range(ip, base, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

// true = endereço que o servidor NUNCA deve acessar a pedido de usuário.
function isBlockedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;
  const family = net.isIP(ip);
  if (family === 4) return BLOCKED_V4.some(([base, bits]) => inV4Range(ip, base, bits));
  if (family !== 6) return true;
  const lower = ip.toLowerCase();
  // IPv4 mapeado/compatível em IPv6 (::ffff:10.0.0.1, ::ffff:a00:1).
  const mapped = lower.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) || lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  const hexMapped = lower.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16); const lo = parseInt(hexMapped[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === '::' || lower === '::1') return true;
  const first = parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)
  if (lower.startsWith('64:ff9b:')) return true; // NAT64 (pode apontar pra IPv4 interno)
  if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return true; // documentação
  return false;
}

// lookup "seguro" pro http.request: resolve e recusa se QUALQUER endereço
// devolvido for proibido.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }];
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      const e = new Error('Endereço não permitido.'); e.code = 'EBLOCKED';
      return callback(e);
    }
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host) && isBlockedIp(host)) return null;
  if (u.toString().length > 2048) return null;
  u.hash = '';
  return u;
}

// Uma requisição GET com o IP checado na conexão e corpo limitado.
function requestOnce(u, { maxBytes, accept, deadline }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const req = lib.request(u, {
      method: 'GET',
      lookup: safeLookup,
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6' },
      timeout: remaining,
      agent: false,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location, status });
      }
      const chunks = [];
      let size = 0;
      let done = false;
      res.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBytes) {
          // Lê só o começo — o <head> com as tags OG vem bem antes disso.
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
          done = true;
          res.destroy();
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => { if (!done) { done = true; resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }); } });
      res.on('error', (err) => { if (!done) { done = true; reject(err); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tempo esgotado.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

async function safeFetch(rawUrl, { maxBytes, accept }) {
  let u = validateUrl(rawUrl);
  if (!u) throw Object.assign(new Error('URL inválida.'), { status: 400 });
  const deadline = Date.now() + TIMEOUT_MS;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await requestOnce(u, { maxBytes, accept, deadline });
    if (!r.redirect) return { ...r, finalUrl: u.toString() };
    let next;
    try { next = new URL(r.redirect, u); } catch { next = null; }
    u = next && validateUrl(next.toString());
    if (!u) throw Object.assign(new Error('Redirecionamento não permitido.'), { status: 400 });
  }
  throw Object.assign(new Error('Redirecionamentos demais.'), { status: 400 });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, code) => {
    const c = code.toLowerCase();
    if (c[0] === '#') {
      const n = c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[c] ?? m;
  });
}
function clean(s, max) {
  const v = decodeEntities(s).replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
}

// Lê as meta tags do HTML (só o <head>, sem parser pesado).
function parseOpenGraph(html, baseUrl) {
  const head = String(html || '').slice(0, 300000);
  const metas = {};
  const tagRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(head))) {
    const tag = m[0];
    const attr = (name) => {
      const r = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return r ? (r[2] ?? r[3] ?? r[4] ?? '') : null;
    };
    const key = (attr('property') || attr('name') || '').toLowerCase();
    const content = attr('content');
    if (key && content != null && metas[key] === undefined) metas[key] = content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const absolutize = (v) => {
    if (!v) return null;
    try {
      const abs = new URL(decodeEntities(v).trim(), baseUrl);
      return ['http:', 'https:'].includes(abs.protocol) ? abs.toString().slice(0, 2048) : null;
    } catch { return null; }
  };
  const color = (metas['theme-color'] || '').trim();
  const out = {
    url: baseUrl,
    title: clean(metas['og:title'] || metas['twitter:title'] || titleTag?.[1], 256),
    description: clean(metas['og:description'] || metas['twitter:description'] || metas.description, 400),
    image: absolutize(metas['og:image:secure_url'] || metas['og:image'] || metas['og:image:url'] || metas['twitter:image'] || metas['twitter:image:src']),
    siteName: clean(metas['og:site_name'], 100),
    themeColor: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color : null,
  };
  try { if (!out.siteName) out.siteName = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { /* ok */ }
  return out;
}

async function fetchPreview(rawUrl) {
  const r = await safeFetch(rawUrl, { maxBytes: MAX_HTML_BYTES, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
  if (r.status < 200 || r.status >= 300) return null;
  const type = String(r.headers?.['content-type'] || '').toLowerCase();
  if (type.startsWith('image/') && !type.includes('svg')) {
    return { url: r.finalUrl, title: null, description: null, image: r.finalUrl, siteName: new URL(r.finalUrl).hostname.replace(/^www\./, ''), themeColor: null };
  }
  if (!type.includes('html')) return null;
  const charset = /charset=([\w-]+)/i.exec(type)?.[1]?.toLowerCase();
  let html;
  try { html = new TextDecoder(charset && charset !== 'utf8' ? charset : 'utf-8').decode(r.body); } catch { html = r.body.toString('utf8'); }
  const preview = parseOpenGraph(html, r.finalUrl);
  if (!preview.title && !preview.description && !preview.image) return null;
  return preview;
}

// Imagem da prévia (og:image), servida pelo nosso domínio — mesmas regras
// de SSRF, só tipos de imagem raster (nunca SVG), até 5MB.
async function fetchPreviewImage(rawUrl) {
  const r = await safeFetch(rawUrl, { maxBytes: MAX_IMAGE_BYTES + 1, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9' });
  if (r.status < 200 || r.status >= 300 || r.truncated) return null;
  const type = String(r.headers?.['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(type)) return null;
  return { buffer: r.body, contentType: type };
}

module.exports = {
  isBlockedIp, validateUrl, parseOpenGraph, fetchPreview, fetchPreviewImage, safeLookup,
};
