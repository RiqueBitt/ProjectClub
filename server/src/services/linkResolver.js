// Links bonitos: monta e entende os endereços do site.
//
//   antes                               depois
//   /channels/<uuid>                    /canal/chat-geral
//   /conversations/<uuid>               /dm/fulano  (DM 1:1)  ·  /dm/grupo-amigos (grupo)
//   /u/<uuid>                           /perfil/fulano
//   /eventos/<uuid>                     /evento/noite-de-jogos
//   /posts/<uuid>                       /forum/como-instalar-mods
//   /jogos/biblioteca/<uuid>            /jogos/biblioteca/fulano
//
// Os endereços antigos continuam valendo: resolveLink() entende os dois
// formatos e devolve o endereço bonito, SEMPRE respeitando a mesma regra de
// acesso dos ids (canal sem VIEW_CHANNEL e grupo de que a pessoa não
// participa respondem "não encontrado" — nunca vaza que existem).

const { findBySlugOrId, UUID_RE } = require('./slugs');

const enc = (s) => encodeURIComponent(String(s));
const lower = (s) => String(s || '').toLowerCase();

// ---------- montar endereços (servidor: avisos, push, e-mails) ----------

function channelPath(ch) {
  if (!ch) return '/';
  return `/canal/${enc(ch.slug || ch.id)}`;
}

// DM 1:1: o @ da OUTRA pessoa (quem recebe o link é quem vê). Grupo: slug.
function conversationPath(conv, { otherUsername } = {}) {
  if (!conv) return '/dms';
  if (!conv.isGroup && otherUsername) return `/dm/${enc(lower(otherUsername))}`;
  if (conv.isGroup && conv.slug) return `/dm/${enc(conv.slug)}`;
  return `/dm/${enc(conv.id)}`;
}

function userPath(user) {
  if (!user) return '/';
  return `/perfil/${enc(user.username ? lower(user.username) : user.id)}`;
}

function eventPath(ev) {
  if (!ev) return '/comunidade/eventos';
  return `/evento/${enc(ev.slug || ev.id)}`;
}

function postPath(post) {
  if (!post) return '/comunidades';
  return `/forum/${enc(post.slug || post.id)}`;
}

function libraryPath(user) {
  return user ? `/jogos/biblioteca/${enc(user.username ? lower(user.username) : user.id)}` : '/jogos/biblioteca';
}

// ---------- entender endereços ----------

// "/canal/chat-geral?m=1" → { kind: 'channel', ref: 'chat-geral', legacy: false }
function parseAppPath(raw) {
  let pathname = String(raw || '');
  try { pathname = new URL(pathname, 'http://x').pathname; } catch { return null; }
  const parts = pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return ''; } });
  const [a, b, c] = parts;
  if (!a) return null;
  const map = {
    canal: ['channel', false], channels: ['channel', true],
    dm: ['dm', false], conversations: ['dm', true],
    perfil: ['user', false], u: ['user', true],
    evento: ['event', false], eventos: ['event', true],
    forum: ['post', false], posts: ['post', true],
  };
  if (a === 'jogos' && b === 'biblioteca' && c) return { kind: 'library', ref: c, legacy: UUID_RE.test(c) };
  const hit = map[a];
  if (!hit || !b || parts.length !== 2) return null;
  return { kind: hit[0], ref: b, legacy: hit[1] || UUID_RE.test(b) };
}

// ---------- resolver (com checagem de acesso) ----------

function defaultDeps() {
  const prisma = require('../config/prisma');
  return {
    db: prisma,
    canViewChannel: async (userId, channel) => {
      const { getEffectivePermissions } = require('./authz');
      const { has } = require('./permissions');
      const perms = await getEffectivePermissions(userId, channel.id, channel).catch(() => null);
      return !!perms && has(perms, 'VIEW_CHANNEL');
    },
  };
}

async function findUserByRef(db, ref) {
  const raw = String(ref || '').trim();
  if (!raw || raw.length > 64) return null;
  const select = { id: true, username: true };
  // MySQL compara username sem diferenciar maiúsculas (collation _ci).
  return (await db.user.findFirst({ where: { username: raw }, select }))
    || (UUID_RE.test(raw) || !/^[a-z0-9_.]+$/i.test(raw) ? await db.user.findFirst({ where: { id: raw }, select }) : null)
    || (await db.user.findFirst({ where: { publicId: raw }, select }).catch(() => null))
    || (await db.user.findFirst({ where: { id: raw }, select }));
}

// Devolve { kind, id, path, ... } ou null (não existe OU sem acesso).
async function resolveLink({ path, userId }, deps = defaultDeps()) {
  const parsed = parseAppPath(path);
  if (!parsed || !userId) return null;
  const { db } = deps;
  const { kind, ref } = parsed;

  if (kind === 'channel') {
    const ch = await findBySlugOrId('channel', ref, { db });
    if (!ch) return null;
    if (!(await deps.canViewChannel(userId, ch))) return null;
    return { kind, id: ch.id, slug: ch.slug || null, name: ch.name, type: ch.type, path: channelPath(ch) };
  }

  if (kind === 'dm') {
    // 1) @usuário → a DM 1:1 que eu tenho com essa pessoa (ou "ainda não existe")
    if (!/^grupo(-|$)/.test(lower(ref)) && !UUID_RE.test(ref)) {
      const other = await findUserByRef(db, ref);
      if (other && other.id !== userId) {
        const conv = await db.conversation.findFirst({
          where: { isGroup: false, AND: [{ members: { some: { userId } } }, { members: { some: { userId: other.id } } }] },
          select: { id: true },
        });
        return { kind, id: conv?.id || null, userId: other.id, isGroup: false, path: conversationPath({ isGroup: false }, { otherUsername: other.username }) };
      }
    }
    // 2) grupo por slug (atual/antigo) ou qualquer conversa por id — só membro.
    const conv = await findBySlugOrId('conversation', ref, {
      db, select: { id: true, isGroup: true, slug: true, members: { select: { userId: true, user: { select: { username: true } } } } },
    });
    if (!conv || !conv.members.some((m) => m.userId === userId)) return null;
    const other = !conv.isGroup ? conv.members.find((m) => m.userId !== userId) : null;
    return {
      kind, id: conv.id, isGroup: conv.isGroup, userId: other?.userId || null,
      path: conversationPath(conv, { otherUsername: other?.user?.username }),
    };
  }

  if (kind === 'user' || kind === 'library') {
    const u = await findUserByRef(db, ref);
    if (!u) return null;
    return { kind, id: u.id, username: u.username, path: kind === 'user' ? userPath(u) : libraryPath(u) };
  }

  if (kind === 'event') {
    const ev = await findBySlugOrId('event', ref, { db, select: { id: true, slug: true, title: true } });
    return ev ? { kind, id: ev.id, slug: ev.slug || null, path: eventPath(ev) } : null;
  }

  if (kind === 'post') {
    const p = await findBySlugOrId('post', ref, { db, select: { id: true, slug: true, title: true } });
    return p ? { kind, id: p.id, slug: p.slug || null, path: postPath(p) } : null;
  }
  return null;
}

module.exports = {
  channelPath, conversationPath, userPath, eventPath, postPath, libraryPath,
  parseAppPath, resolveLink, findUserByRef,
};
