// Game Hub → Clipes: o vídeo fica no PC de quem gravou (pasta de clipes do
// app) ou num site de vídeo; aqui só o link, o título e o jogo. Aceita
// YouTube, Twitch, Medal e Streamable — o link é conferido e guardado
// "limpo" (sem rastreio), e o embed é montado a partir do id.
const getPrisma = () => require('../../config/prisma');
const { gameKeyFor } = require('../../utils/gameKeys');

const USER_SELECT = { id: true, displayName: true, username: true, avatarUrl: true };
const PAGE = 24;

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
const isStaff = (user) => ['ADMIN', 'MODERATOR'].includes(user?.platformRole);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const host = (u) => u.hostname.toLowerCase().replace(/^(www|m)\./, '');

// Link → { provider, embedId, url } ou null.
function parseClipUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = host(u);
  const parts = u.pathname.split('/').filter(Boolean);
  const YT = /^[A-Za-z0-9_-]{11}$/;
  if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
    let id = u.searchParams.get('v');
    if (!id && ['shorts', 'live', 'embed'].includes(parts[0])) id = parts[1];
    if (id && YT.test(id)) return { provider: 'youtube', embedId: id, url: `https://www.youtube.com/watch?v=${id}` };
    return null;
  }
  if (h === 'youtu.be') {
    const id = parts[0];
    return id && YT.test(id) ? { provider: 'youtube', embedId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  const SLUG = /^[A-Za-z0-9_-]{3,100}$/;
  if (h === 'clips.twitch.tv') {
    const slug = parts[0] === 'embed' ? u.searchParams.get('clip') : parts[0];
    return slug && SLUG.test(slug) ? { provider: 'twitch', embedId: slug, url: `https://clips.twitch.tv/${slug}` } : null;
  }
  if (h === 'twitch.tv') {
    const i = parts.indexOf('clip');
    const slug = i >= 0 ? parts[i + 1] : null;
    return slug && SLUG.test(slug) ? { provider: 'twitch', embedId: slug, url: `https://clips.twitch.tv/${slug}` } : null;
  }
  if (h === 'medal.tv') {
    const i = parts.findIndex((p) => p === 'clips' || p === 'clip');
    const id = i >= 0 ? parts[i + 1] : null;
    if (!id || !/^[A-Za-z0-9_-]{4,60}$/.test(id)) return null;
    return { provider: 'medal', embedId: id, url: `https://medal.tv/${parts.slice(0, i + 2 + (parts[i + 2] ? 1 : 0)).join('/')}` };
  }
  if (h === 'streamable.com') {
    const id = ['e', 'o', 's'].includes(parts[0]) ? parts[1] : parts[0];
    return id && /^[a-z0-9]{3,16}$/i.test(id) ? { provider: 'streamable', embedId: id, url: `https://streamable.com/${id}` } : null;
  }
  return null;
}

function thumbOf(provider, embedId) {
  if (provider === 'youtube') return `https://i.ytimg.com/vi/${embedId}/hqdefault.jpg`;
  return null; // Twitch/Medal/Streamable: a tela usa a capa do jogo
}

function shapeClip(c, viewerId) {
  return {
    id: c.id, title: c.title, url: c.url, provider: c.provider, embedId: c.embedId, thumb: thumbOf(c.provider, c.embedId),
    game: c.gameName ? { key: c.gameKey, name: c.gameName, steamAppId: c.steamAppId } : null,
    author: c.user || null, likesCount: c.likesCount, liked: !!(c.likes && c.likes.some((l) => l.userId === viewerId)),
    mine: c.userId === viewerId, createdAt: c.createdAt,
  };
}

async function list(viewerId, { db = getPrisma(), gameKey = null, mine = false, before = null } = {}) {
  const where = {
    ...(gameKey ? { gameKey: String(gameKey).slice(0, 120) } : {}),
    ...(mine ? { userId: viewerId } : {}),
    ...(before && Number.isFinite(new Date(before).getTime()) ? { createdAt: { lt: new Date(before) } } : {}),
  };
  const rows = await db.gameClip.findMany({
    where, orderBy: { createdAt: 'desc' }, take: PAGE,
    include: { user: { select: USER_SELECT }, likes: { where: { userId: viewerId }, select: { userId: true } } },
  });
  return { clips: rows.map((c) => shapeClip(c, viewerId)), more: rows.length === PAGE };
}

async function create(user, body = {}, { db = getPrisma() } = {}) {
  const parsed = parseClipUrl(body.url);
  if (!parsed) throw httpError(400, 'Cole o link de um clipe do YouTube, Twitch, Medal ou Streamable.');
  const title = clean(body.title, 100);
  if (title.length < 2) throw httpError(400, 'Dê um título pro clipe.');
  const gameName = clean(body.gameName || body.game?.name, 100) || null;
  const appId = Number(body.steamAppId ?? body.game?.steamAppId);
  const dup = await db.gameClip.findFirst({ where: { userId: user.id, provider: parsed.provider, embedId: parsed.embedId }, select: { id: true } });
  if (dup) throw httpError(409, 'Você já compartilhou esse clipe.');
  const c = await db.gameClip.create({
    data: {
      userId: user.id, title, url: parsed.url, provider: parsed.provider, embedId: parsed.embedId,
      gameName, gameKey: gameName ? gameKeyFor(gameName) || null : null,
      steamAppId: Number.isInteger(appId) && appId > 0 ? appId : null,
    },
    include: { user: { select: USER_SELECT } },
  });
  return shapeClip(c, user.id);
}

async function remove(user, id, { db = getPrisma() } = {}) {
  const c = await db.gameClip.findUnique({ where: { id: String(id) }, select: { id: true, userId: true } });
  if (!c) throw httpError(404, 'Clipe não encontrado.');
  if (c.userId !== user.id && !isStaff(user)) throw httpError(403, 'Só quem compartilhou pode apagar.');
  await db.gameClip.delete({ where: { id: c.id } });
  return { ok: true };
}

async function toggleLike(user, id, { db = getPrisma() } = {}) {
  const c = await db.gameClip.findUnique({ where: { id: String(id) }, select: { id: true } });
  if (!c) throw httpError(404, 'Clipe não encontrado.');
  const had = await db.gameClipLike.findUnique({ where: { clipId_userId: { clipId: c.id, userId: user.id } } });
  if (had) {
    await db.$transaction([db.gameClipLike.delete({ where: { id: had.id } }), db.gameClip.update({ where: { id: c.id }, data: { likesCount: { decrement: 1 } } })]);
  } else {
    await db.$transaction([db.gameClipLike.create({ data: { clipId: c.id, userId: user.id } }), db.gameClip.update({ where: { id: c.id }, data: { likesCount: { increment: 1 } } })]);
  }
  const now = await db.gameClip.findUnique({ where: { id: c.id }, select: { likesCount: true } });
  return { liked: !had, likesCount: Math.max(0, now?.likesCount || 0) };
}

module.exports = { parseClipUrl, thumbOf, shapeClip, list, create, remove, toggleLike };
