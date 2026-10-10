// Links INTERNOS do Project Club (post, modpack, mod, perfil, evento,
// canal, Tema) — reconhecidos no texto das mensagens pra virar um cartão
// com imagem, título e um botão de ação (ver InternalLinkCard.jsx), e
// pra abrir dentro do app em vez do aviso de "link externo".
//
// Formatos aceitos (no próprio domínio do app, no domínio público ou em
// localhost):
//   /posts/<id>                 post do Feed
//   /modpack/<id>               modpack público
//   /mod/<jogoId>/<modId>       mod
//   /u/<userId>                 perfil
//   /eventos/<id>               evento (também /comunidade/eventos?evento=<id>)
//   /channels/<id>              canal
//   /comunidades/<slug>         Tema do Feed
import { getPost, getModpack, getMod, getUserProfile, listEvents } from '../api/endpoints';
import { useStore } from '../store/useStore';

const KNOWN_HOSTS = [/(^|\.)projectclub\.squareweb\.app$/i, /^localhost(:\d+)?$/i, /^127\.0\.0\.1(:\d+)?$/];

function isOwnHost(host) {
  if (typeof window !== 'undefined' && host === window.location.host) return true;
  return KNOWN_HOSTS.some((re) => re.test(host));
}

// Devolve { kind, id, extra?, path } ou null quando não é link interno.
export function parseInternalLink(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !isOwnHost(u.host)) return null;
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const path = `${u.pathname}${u.search}`;
  const id = parts[1];
  switch (parts[0]) {
    case 'posts': return id ? { kind: 'post', id, path } : null;
    case 'modpack':
    case 'modpacks': return id ? { kind: 'modpack', id, path } : null;
    case 'mod': return id && parts[2] ? { kind: 'mod', id: parts[2], extra: id, path } : null;
    case 'u':
    case 'perfil': return id ? { kind: 'user', id, path } : null;
    case 'eventos': return id ? { kind: 'event', id, path } : null;
    case 'comunidade': {
      const ev = parts[1] === 'eventos' && u.searchParams.get('evento');
      return ev ? { kind: 'event', id: ev, path } : null;
    }
    case 'channels': return id ? { kind: 'channel', id, path } : null;
    case 'comunidades': return id ? { kind: 'club', id, path } : null;
    default: return null;
  }
}

// Mesma regex de link do richTextRender (sem pontuação final).
const LINK_RE = /https?:\/\/[^\s<]+[^\s<.,!?)\]]/g;

export function findInternalLinks(text, max = 3) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(LINK_RE)) {
    const link = parseInternalLink(m[0]);
    if (!link) continue;
    const k = `${link.kind}:${link.extra || ''}:${link.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(link);
    if (out.length >= max) break;
  }
  return out;
}

// Abre um caminho interno sem recarregar a página (o roteador escuta o
// popstate) — usado onde não há useNavigate (ex.: richTextRender).
export function openInternalPath(path) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// Abre um link interno já reconhecido: perfil vira o modal de perfil,
// modpack abre direto no gerenciador de mods; o resto navega.
export function openInternalLink(link) {
  if (link.kind === 'user') { useStore.getState().openProfile(link.id); return; }
  if (link.kind === 'modpack') { openInternalPath(`/modpack/${encodeURIComponent(link.id)}`); return; }
  openInternalPath(link.path);
}

// Cache dos cartões (5 min) — a mesma mensagem re-renderiza muito e o
// mesmo link costuma aparecer várias vezes no chat.
const TTL = 5 * 60 * 1000;
const cache = new Map();

export function peekLinkPreview(link) {
  const hit = cache.get(cacheKey(link));
  return hit && hit.data !== undefined && Date.now() - hit.at < TTL ? hit.data : undefined;
}

function cacheKey(link) { return `${link.kind}:${link.extra || ''}:${link.id}`; }

export function loadLinkPreview(link) {
  const k = cacheKey(link);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const entry = { at: Date.now(), data: undefined, promise: null };
  entry.promise = resolve(link)
    .then((data) => { entry.data = data; return data; })
    .catch(() => { entry.data = null; return null; });
  cache.set(k, entry);
  return entry.promise;
}

const stripText = (s, n = 140) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Normaliza cada tipo pro mesmo formato de cartão.
async function resolve(link) {
  switch (link.kind) {
    case 'post': {
      const { post } = await getPost(link.id);
      return {
        kind: 'post', label: 'Post no Fórum', title: post.title,
        text: stripText(post.content),
        image: post.type === 'IMAGE' ? post.imageUrl : post.community?.iconUrl || null,
        imageShape: post.type === 'IMAGE' ? 'wide' : 'square',
        meta: [post.community?.name, `${post.score} ups`, `${post.commentCount} comentário${post.commentCount === 1 ? '' : 's'}`].filter(Boolean),
        author: post.author,
        action: 'Abrir', path: `/posts/${post.id}`,
      };
    }
    case 'modpack': {
      const { modpack: mp } = await getModpack(link.id);
      return {
        kind: 'modpack', label: `Modpack · ${mp.gameName}`, title: mp.name,
        text: stripText(mp.description),
        image: mp.coverUrl || `/api/proxy/steam/${mp.steamAppId}/header`, imageShape: 'wide',
        meta: [`${mp.itemCount} mod${mp.itemCount === 1 ? '' : 's'}`, `${mp.downloadCount} download${mp.downloadCount === 1 ? '' : 's'}`, `${mp.likeCount} curtida${mp.likeCount === 1 ? '' : 's'}`],
        author: mp.author,
        action: 'Instalar modpack', modpack: { id: mp.id, steamAppId: mp.steamAppId }, path: '/jogos/mods',
      };
    }
    case 'mod': {
      const { mod } = await getMod(link.extra, link.id);
      return {
        kind: 'mod', label: 'Mod', title: mod.name,
        text: stripText(mod.summary),
        image: mod.logo?.thumb_640x360 || mod.logo?.original || null, imageShape: 'wide',
        meta: [mod.stats?.downloads_total != null ? `${Number(mod.stats.downloads_total).toLocaleString('pt-BR')} downloads` : null].filter(Boolean),
        action: 'Abrir', path: '/jogos/mods',
      };
    }
    case 'user': {
      const d = await getUserProfile(link.id);
      const u = d.user;
      return {
        kind: 'user', label: 'Perfil', title: u.displayName,
        text: u.customStatus ? stripText(`${u.customStatusEmoji ? `${u.customStatusEmoji} ` : ''}${u.customStatus}`) : stripText(u.bio, 110),
        user: u, imageShape: 'round',
        meta: [`@${u.username}`, `Nível ${u.accountLevel ?? 1}`],
        action: 'Ver perfil', userId: u.id,
      };
    }
    case 'event': {
      const { events } = await listEvents();
      const ev = (events || []).find((e) => e.id === link.id);
      if (!ev) return null;
      const when = ev.startsAt ? new Date(ev.startsAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
      const going = ev.rsvp?.counts?.GOING || 0;
      return {
        kind: 'event', label: ev.status === 'ACTIVE' ? 'Evento · ao vivo' : ev.status === 'ENDED' ? 'Evento · encerrado' : 'Evento', title: ev.title,
        text: stripText(ev.description),
        image: ev.bannerUrl || ev.iconUrl || null, imageShape: ev.bannerUrl ? 'wide' : 'square',
        meta: [when, going ? `${going} vão` : null].filter(Boolean),
        live: ev.status === 'ACTIVE',
        action: 'Abrir', path: `/comunidade/eventos?evento=${ev.id}`,
      };
    }
    case 'channel': {
      const s = useStore.getState();
      const all = [...(s.channels || []), ...(s.categories || []).flatMap((c) => c.channels || [])];
      const ch = all.find((c) => c.id === link.id);
      if (!ch) return null;
      const cat = (s.categories || []).find((c) => (c.channels || []).some((x) => x.id === ch.id));
      return {
        kind: 'channel', label: ch.type === 'VOICE' ? 'Canal de voz' : 'Canal', title: ch.name,
        text: stripText(ch.topic || ch.description, 110),
        image: ch.iconUrl || null, imageShape: 'square',
        meta: [cat?.name].filter(Boolean),
        action: 'Abrir', path: `/channels/${ch.id}`,
      };
    }
    case 'club': {
      const club = (useStore.getState().clubs || []).find((c) => c.slug === link.id);
      if (!club) return null;
      return {
        kind: 'club', label: 'Tema do Fórum', title: club.name,
        text: stripText(club.description, 110),
        image: club.iconUrl || null, imageShape: 'square',
        meta: [club.postCount != null ? `${club.postCount} posts` : null].filter(Boolean),
        action: 'Abrir', path: `/comunidades/${club.slug}`,
      };
    }
    default: return null;
  }
}
