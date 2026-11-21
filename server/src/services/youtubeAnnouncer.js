// YouTube → Novidades (item "Integração com YouTube"): de tempos em tempos
// lê o feed RSS público do canal (sem chave de API) e, para cada vídeo novo,
// publica um anúncio em Novidades com a capa e o link — com a bolinha "novo"
// e o aviso pra todo mundo, igual a um anúncio feito pela equipe.
// A equipe liga/desliga e escolhe o canal em Painel → Integrações.
// Na primeira vez (ou ao trocar de canal) só marca os vídeos atuais como
// vistos: nunca despeja vídeos antigos em Novidades.
const KEY = 'youtube';
const DEFAULT = { enabled: false, channelId: null, channelTitle: null, seen: [], byUserId: null };
const POLL_MS = 15 * 60 * 1000;
const SEEN_MAX = 60;
const SHORTS_MAX_SECONDS = 60;
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

const getPrisma = () => require('../config/prisma');

function parseFeed(xml) {
  const title = (String(xml).match(/<title>([^<]*)<\/title>/) || [])[1] || null;
  const videos = String(xml).split('<entry>').slice(1).map((entry) => {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const t = entry.match(/<title>([^<]*)<\/title>/)?.[1];
    if (!videoId || !t) return null;
    const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { videoId, title: decode(t).slice(0, 150), publishedAt: entry.match(/<published>([^<]+)<\/published>/)?.[1] || null };
  }).filter(Boolean);
  return { title: title ? title.replace(/&amp;/g, '&') : null, videos };
}

/** Aceita "UC…", URL do canal (/channel/UC…) ou @handle; devolve o id "UC…". */
async function resolveChannelId(input, { fetchImpl = fetch } = {}) {
  const s = String(input || '').trim();
  if (CHANNEL_ID_RE.test(s)) return s;
  const m = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/i);
  if (m) return m[1];
  const handle = (s.match(/youtube\.com\/(@[\w.-]{3,40})/i) || [])[1] || (/^@[\w.-]{3,40}$/.test(s) ? s : null);
  if (!handle) return null;
  try {
    const r = await fetchImpl(`https://www.youtube.com/${handle}`, { signal: AbortSignal.timeout(10_000), headers: { 'Accept-Language': 'pt-BR' } });
    if (!r.ok) return null;
    const html = await r.text();
    const id = (html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1];
    return id || null;
  } catch { return null; }
}

async function fetchFeed(channelId, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  return parseFeed(await r.text());
}

async function isShort(videoId, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`https://www.youtube.com/shorts/${videoId}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (r.status === 200) return true; // /shorts/<id> só abre (200) quando é Short; vídeo comum redireciona
  } catch { /* não sei */ }
  return false;
}

/** Uma rodada: devolve os vídeos publicados agora. */
async function tick(io, {
  db = getPrisma(), config = require('./integrationConfig'), fetchImpl = fetch, publish = defaultPublish, shortCheck = isShort,
} = {}) {
  const cfg = await config.getConfig(KEY, DEFAULT, { db });
  if (!cfg.enabled || !cfg.channelId) return [];
  const feed = await fetchFeed(cfg.channelId, { fetchImpl });
  const seen = new Set(cfg.seen || []);
  const fresh = cfg.primed ? feed.videos.filter((v) => !seen.has(v.videoId)) : [];
  const posted = [];
  // Mais antigo primeiro (fica na ordem certa em Novidades). No máximo 3 por rodada.
  for (const v of fresh.reverse().slice(0, 3)) {
    // eslint-disable-next-line no-await-in-loop
    if (await shortCheck(v.videoId, { fetchImpl })) { seen.add(v.videoId); continue; }
    // eslint-disable-next-line no-await-in-loop
    await publish(io, { video: v, channelTitle: cfg.channelTitle || feed.title, authorId: cfg.byUserId, db });
    seen.add(v.videoId);
    posted.push(v.videoId);
  }
  for (const v of feed.videos) seen.add(v.videoId);
  await config.setConfig(KEY, { ...cfg, primed: true, channelTitle: cfg.channelTitle || feed.title, seen: [...seen].slice(-SEEN_MAX) }, cfg.byUserId, { db });
  return posted;
}

async function defaultPublish(io, { video, channelTitle, authorId, db }) {
  let author = authorId;
  if (!author) author = (await db.user.findFirst({ where: { platformRole: 'ADMIN' }, select: { id: true } }))?.id;
  if (!author) return;
  const row = await db.staffAnnouncement.create({
    data: {
      title: `🎬 Vídeo novo: ${video.title}`.slice(0, 160),
      body: `Saiu vídeo novo no canal ${channelTitle || 'do YouTube'}! Clique para assistir.`,
      bannerUrl: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
      linkUrl: `https://www.youtube.com/watch?v=${video.videoId}`, linkLabel: 'Assistir no YouTube',
      createdById: author, published: true,
    },
  });
  io?.to?.('community').emit('announcements:update', { id: row.id });
  require('../controllers/staffAnnouncementsController').announceNew(io, row);
}

let timer = null;
function startYoutubeAnnouncer(io) {
  if (timer) return timer;
  const run = () => tick(io).catch((e) => console.error('[youtube→novidades]', e?.message || e));
  setTimeout(run, 90 * 1000).unref?.();
  timer = setInterval(run, POLL_MS);
  timer.unref?.();
  return timer;
}

module.exports = { KEY, DEFAULT, parseFeed, resolveChannelId, fetchFeed, tick, startYoutubeAnnouncer, CHANNEL_ID_RE, SHORTS_MAX_SECONDS };
