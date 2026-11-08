// Segurança do app de desktop: quem pode falar com o processo principal.
//
// O site hospedado roda dentro da janela com acesso a uma ponte (preload.js)
// que mexe em disco, instala mods, abre programas... Se, por qualquer motivo,
// uma página de FORA (outro domínio, um iframe de terceiro) conseguisse
// chamar essa ponte, ela teria esses mesmos poderes. Aqui fica a regra única
// usada por todos os handlers de IPC: só aceita pedidos vindos da origem
// exata do Project Club (ou das páginas locais do próprio app).
//
// Comparação por ORIGEM (protocolo + domínio + porta), nunca por
// "começa com": `https://projectclub.squareweb.app.evil.com` começa com a
// URL do app, mas é outro site.

let appOrigin = null;
const localOrigins = new Set();

function originOf(url) {
  try {
    const u = new URL(String(url));
    if (u.origin && u.origin !== 'null') return u.origin;
    // No Node, esquemas próprios (pcapp://app) devolvem origin "null" mesmo
    // sendo "standard" no Electron — monta protocolo + host na mão. file:,
    // data:, blob:, about: etc. nunca contam como origem confiável.
    if (['file:', 'data:', 'blob:', 'about:', 'javascript:'].includes(u.protocol) || !u.host) return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function configure({ appUrl, trustedLocalOrigins = [] }) {
  appOrigin = originOf(appUrl);
  localOrigins.clear();
  for (const o of trustedLocalOrigins) { const n = originOf(o); if (n) localOrigins.add(n); }
}

// URL é do site do Project Club (mesma origem de APP_URL)?
function isAppUrl(url) {
  const o = originOf(url);
  return !!o && !!appOrigin && o === appOrigin;
}

// Site do Project Club ou página local do próprio app (cópia offline).
function isTrustedUrl(url) {
  if (isAppUrl(url)) return true;
  const o = originOf(url);
  return !!o && localOrigins.has(o);
}

// Pedido de IPC veio de um frame confiável? senderFrame pode ser null se o
// frame já navegou/foi destruído — nesse caso recusa.
function isTrustedEvent(event) {
  try {
    const frame = event && event.senderFrame;
    if (!frame) return false;
    return isTrustedUrl(frame.url);
  } catch {
    return false;
  }
}

module.exports = { configure, originOf, isAppUrl, isTrustedUrl, isTrustedEvent };
