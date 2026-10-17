// Links bonitos — parte "pura" (sem store, sem React; testada em
// test/links-bonitos.test.js). O resto (ler do store, hooks) fica em
// prettyLinks.js.
//
//   antes                               depois
//   /channels/<uuid>                    /canal/chat-geral
//   /conversations/<uuid>               /dm/fulano  ·  /dm/grupo-amigos
//   /u/<uuid>                           /perfil/fulano
//   /eventos/<uuid>                     /evento/noite-de-jogos
//   /posts/<uuid>                       /forum/como-instalar-mods
//   /jogos/biblioteca/<uuid>            /jogos/biblioteca/fulano
//
// O slug vem do servidor (coluna `slug`, único: repetido ganha -2, -3).
// Sem slug ainda, o endereço bonito usa o id (/canal/<id>) — e a página
// troca pelo nome assim que descobre (ver prettyLinks.js).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mesma regra do servidor (server/src/services/slugs.js).
export function slugify(input, max = 60) {
  let s = String(input == null ? '' : input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > max) {
    s = s.slice(0, max);
    const cut = s.lastIndexOf('-');
    if (cut >= Math.floor(max / 2)) s = s.slice(0, cut);
    s = s.replace(/-+$/g, '');
  }
  return s;
}

const enc = (s) => encodeURIComponent(String(s));
const lower = (s) => String(s || '').toLowerCase();
const same = (a, b) => a != null && b != null && lower(a) === lower(b);

export const isChannelPath = (p) => /^\/(canal|channels)\/[^/]+/.test(p || '');
export const isDmPath = (p) => /^\/(dm|conversations)\/[^/]+/.test(p || '');
export const isChatPath = (p) => isChannelPath(p) || isDmPath(p);
export const isPostPath = (p) => /^\/(forum|posts)\/[^/]+/.test(p || '');

// ---------- achar no que o app já tem carregado ----------

export function allChannels(state) {
  return [...(state?.channels || []), ...(state?.categories || []).flatMap((c) => c.channels || [])];
}

export function findChannel(state, ref) {
  if (ref == null || ref === '') return null;
  const r = String(ref);
  const list = allChannels(state);
  return list.find((c) => String(c.id) === r) || list.find((c) => c.slug && same(c.slug, r)) || null;
}

export function otherMember(conv, meId) {
  if (!conv || conv.isGroup) return null;
  const ms = conv.members || [];
  return ms.find((m) => m && m.id !== meId) || null;
}

export function findConversation(state, ref, meId) {
  if (ref == null || ref === '') return null;
  const r = String(ref);
  const list = state?.conversations || [];
  return list.find((c) => String(c.id) === r)
    || list.find((c) => c.isGroup && c.slug && same(c.slug, r))
    || list.find((c) => !c.isGroup && same(otherMember(c, meId)?.username, r))
    || null;
}

export function findMemberUser(state, ref) {
  if (ref == null || ref === '') return null;
  const r = String(ref);
  const users = (state?.members || []).map((m) => m.user).filter(Boolean);
  return users.find((u) => String(u.id) === r) || users.find((u) => same(u.username, r)) || null;
}

// ---------- montar endereços ----------
// Aceitam o objeto (com slug/username) OU só o id — com só o id, procuram
// no state; sem achar, usam o id (a página resolve e troca pelo nome).

export function channelPathFrom(state, chOrId) {
  if (!chOrId) return '/';
  const ch = typeof chOrId === 'object' ? (chOrId.slug ? chOrId : findChannel(state, chOrId.id) || chOrId) : findChannel(state, chOrId) || { id: chOrId };
  return `/canal/${enc(ch.slug || ch.id)}`;
}

export function conversationPathFrom(state, convOrId, meId) {
  if (!convOrId) return '/dms';
  const conv = typeof convOrId === 'object'
    ? (convOrId.members || convOrId.slug ? convOrId : findConversation(state, convOrId.id, meId) || convOrId)
    : findConversation(state, convOrId, meId) || { id: convOrId };
  if (!conv.isGroup) {
    const other = otherMember(conv, meId);
    if (other?.username) return `/dm/${enc(lower(other.username))}`;
  } else if (conv.slug) return `/dm/${enc(conv.slug)}`;
  return `/dm/${enc(conv.id)}`;
}

export function userPathFrom(state, userOrId) {
  if (!userOrId) return '/';
  const u = typeof userOrId === 'object' ? (userOrId.username ? userOrId : findMemberUser(state, userOrId.id) || userOrId) : findMemberUser(state, userOrId) || { id: userOrId };
  return `/perfil/${enc(u.username ? lower(u.username) : u.id)}`;
}

export function libraryPathFrom(state, userOrId) {
  if (!userOrId) return '/jogos/biblioteca';
  return userPathFrom(state, userOrId).replace(/^\/perfil\//, '/jogos/biblioteca/');
}

export function eventPath(evOrId) {
  if (!evOrId) return '/comunidade/eventos';
  const ev = typeof evOrId === 'object' ? evOrId : { id: evOrId };
  return `/evento/${enc(ev.slug || ev.id)}`;
}

export function postPath(postOrId) {
  if (!postOrId) return '/comunidades';
  const p = typeof postOrId === 'object' ? postOrId : { id: postOrId };
  return `/forum/${enc(p.slug || p.id)}`;
}

// ---------- entender endereços ----------

const KIND_BY_SEGMENT = {
  canal: ['channel', false], channels: ['channel', true],
  dm: ['dm', false], conversations: ['dm', true],
  perfil: ['user', false], u: ['user', true],
  evento: ['event', false], eventos: ['event', true],
  forum: ['post', false], posts: ['post', true],
};

// "/canal/chat-geral" → { kind: 'channel', ref: 'chat-geral', legacy: false }
export function parseAppPath(pathname) {
  const parts = String(pathname || '').split(/[?#]/)[0].split('/').filter(Boolean)
    .map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const [a, b, c] = parts;
  if (a === 'jogos' && b === 'biblioteca' && c && parts.length === 3) return { kind: 'library', ref: c, legacy: UUID_RE.test(c) };
  const hit = KIND_BY_SEGMENT[a];
  if (!hit || !b || parts.length !== 2) return null;
  return { kind: hit[0], ref: b, legacy: hit[1] };
}

// Sala de chat aberta na URL (canal ou conversa) já com o id de verdade,
// usando só o que está carregado. { channelId } | { conversationId } | null.
export function roomFromPath(pathname, state, meId) {
  const p = parseAppPath(pathname);
  if (!p) return null;
  if (p.kind === 'channel') {
    const ch = findChannel(state, p.ref);
    return { channelId: ch ? String(ch.id) : (p.legacy || UUID_RE.test(p.ref) ? p.ref : null), ref: p.ref };
  }
  if (p.kind === 'dm') {
    const c = findConversation(state, p.ref, meId);
    return { conversationId: c ? String(c.id) : (p.legacy || UUID_RE.test(p.ref) ? p.ref : null), ref: p.ref };
  }
  return null;
}

// Endereço bonito equivalente a um endereço antigo/com id (null = já é
// bonito ou não sabe ainda). Mantém ?query e #hash.
export function prettyPathFor(pathname, state, meId) {
  const full0 = String(pathname || '');
  const cut = full0.search(/[?#]/);
  const path = cut >= 0 ? full0.slice(0, cut) : full0;
  const rest = cut >= 0 ? full0.slice(cut) : '';
  const p = parseAppPath(path);
  if (!p) return null;
  let next = null;
  if (p.kind === 'channel') { const ch = findChannel(state, p.ref); if (ch) next = channelPathFrom(state, ch); }
  else if (p.kind === 'dm') { const c = findConversation(state, p.ref, meId); if (c) next = conversationPathFrom(state, c, meId); }
  else if (p.kind === 'user') { const u = findMemberUser(state, p.ref); if (u) next = userPathFrom(state, u); }
  else if (p.kind === 'library') { const u = findMemberUser(state, p.ref); if (u) next = libraryPathFrom(state, u); }
  else if (p.kind === 'event' && p.legacy) next = eventPath(p.ref);
  else if (p.kind === 'post' && p.legacy) next = postPath(p.ref);
  if (!next) return null;
  const full = next + (rest || '');
  return full === pathname ? null : full;
}
