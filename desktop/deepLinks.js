// Links projectclub:// → endereço do site (ver o comentário em main.js).
// Separado do main.js pra dar pra testar sem o Electron (test/deepLinks.test.js).
const DEEP_LINK_SCHEME = 'projectclub';
const DEEP_ID_RE = /^(?!\.+$)[A-Za-z0-9._-]{1,64}$/;
const DEEP_INVITE_RE = /^[A-Za-z0-9]{3,12}$/;
const DEEP_ROUTES = {
  canal: '/canal', channel: '/canal',
  dm: '/dm', conversation: '/dm',
  perfil: '/perfil', user: '/perfil',
  forum: '/forum', post: '/forum',
  evento: '/evento', event: '/evento',
};
function parseDeepLink(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  // projectclub://post/123 → host "post", pathname "/123" (e também aceita
  // projectclub:///post/123 ou projectclub:post/123).
  const parts = `${u.host}/${u.pathname}`.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  if (parts.length !== 2) return null;
  const [kind, id] = [parts[0].toLowerCase(), parts[1]];
  if (kind === 'invite' && DEEP_INVITE_RE.test(id)) return `/cartas?sala=${encodeURIComponent(id.toUpperCase())}`;
  if (!DEEP_ID_RE.test(id)) return null;
  const base = Object.prototype.hasOwnProperty.call(DEEP_ROUTES, kind) ? DEEP_ROUTES[kind] : null;
  return base ? `${base}/${encodeURIComponent(id)}` : null;
}

module.exports = { DEEP_LINK_SCHEME, parseDeepLink };
