// Navegador de YouTube do "Assistir juntos" (busca, em alta, a seguir,
// vídeos de canal). Sem API key: lê o ytInitialData embutido no HTML
// público do youtube.com. Se existir YOUTUBE_API_KEY no ambiente, usa a
// Data API v3 oficial pra busca/em alta (a "a seguir" continua pelo HTML,
// a API não tem mais relatedToVideoId). Funções de parse são puras e
// testadas em test/youtube-browse.test.js com um HTML de exemplo.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const FALLBACK_CLIENT_VERSION = '2.20250101.00.00';
let clientVersion = FALLBACK_CLIENT_VERSION;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// ---------- parse ----------

// Acha "ytInitialData = {...}" e corta o JSON contando chaves (respeitando
// strings), o que é mais robusto que regex até "};".
function extractJsonAfter(html, marker) {
  let i = html.indexOf(marker);
  if (i < 0) return null;
  i = html.indexOf('{', i + marker.length);
  if (i < 0) return null;
  let depth = 0; let inStr = false; let esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function extractInitialData(html) {
  if (typeof html !== 'string') return null;
  const v = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  if (v) clientVersion = v;
  return extractJsonAfter(html, 'var ytInitialData =')
    || extractJsonAfter(html, 'window["ytInitialData"] =')
    || extractJsonAfter(html, 'ytInitialData =');
}

// Texto do YouTube vem como {simpleText} ou {runs:[{text}]} ou {content}.
function txt(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
  if (typeof t.content === 'string') return t.content;
  return '';
}

function bestThumb(list, videoId) {
  const arr = Array.isArray(list) ? list : [];
  const pick = arr.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  let url = pick?.url || '';
  if (url.startsWith('//')) url = `https:${url}`;
  // Só aceita imagens do i.ytimg (CSP img-src) — senão usa a padrão.
  if (!/^https:\/\/i\d?\.ytimg\.com\/vi/.test(url)) return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  return url;
}

function clean(s, max = 200) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// videoRenderer / gridVideoRenderer / compactVideoRenderer
function fromRenderer(r) {
  const videoId = r?.videoId;
  if (!ID_RE.test(videoId || '')) return null;
  const owner = r.ownerText || r.longBylineText || r.shortBylineText;
  const badges = (r.badges || []).concat(r.ownerBadges || []);
  const live = badges.some((b) => /LIVE/.test(b?.metadataBadgeRenderer?.style || ''))
    || (r.thumbnailOverlays || []).some((o) => o?.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE');
  const durOverlay = (r.thumbnailOverlays || []).map((o) => o?.thumbnailOverlayTimeStatusRenderer).find(Boolean);
  return {
    videoId,
    title: clean(txt(r.title) || txt(r.headline)),
    channel: clean(txt(owner), 100),
    channelId: owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || null,
    duration: clean(txt(r.lengthText) || (durOverlay && durOverlay.style !== 'LIVE' ? txt(durOverlay.text) : ''), 12),
    views: clean(txt(r.shortViewCountText) || txt(r.viewCountText), 40),
    published: clean(txt(r.publishedTimeText), 40),
    thumbnail: bestThumb(r.thumbnail?.thumbnails, videoId),
    live: !!live,
  };
}

// lockupViewModel (formato novo da "a seguir"/home)
function fromLockup(l) {
  if (!l || (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
  const videoId = l.contentId;
  if (!ID_RE.test(videoId || '')) return null;
  const meta = l.metadata?.lockupMetadataViewModel;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const parts = rows.map((row) => (row.metadataParts || []).map((p) => txt(p.text)).filter(Boolean));
  const channel = parts[0]?.[0] || '';
  const second = parts[1] || [];
  const views = second.find((s) => /visualiza|views|assistindo|watching/i.test(s)) || second[0] || '';
  const published = second.find((s) => s !== views) || '';
  const tv = l.contentImage?.thumbnailViewModel;
  let duration = ''; let live = false;
  for (const ov of tv?.overlays || []) {
    const badges = ov?.thumbnailOverlayBadgeViewModel?.thumbnailBadges
      || ov?.thumbnailBottomOverlayViewModel?.badges || [];
    for (const b of badges) {
      const bt = b?.thumbnailBadgeViewModel?.text || '';
      if (/ao vivo|live/i.test(bt) || /LIVE/.test(b?.thumbnailBadgeViewModel?.badgeStyle || '')) live = true;
      else if (/^\d+(:\d{2}){1,2}$/.test(bt)) duration = bt;
    }
  }
  return {
    videoId,
    title: clean(txt(meta?.title)),
    channel: clean(channel, 100),
    channelId: null,
    duration,
    views: clean(views, 40),
    published: clean(published, 40),
    thumbnail: bestThumb(tv?.image?.sources, videoId),
    live,
  };
}

// Anda no objeto todo e junta vídeos + o token de continuação.
function collectVideos(root, { exclude } = {}) {
  const out = []; const seen = new Set(exclude ? [exclude] : []);
  let continuation = null;
  const stack = [root]; let guard = 0;
  while (stack.length && guard++ < 400000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]); continue; }
    let v = null;
    if (node.videoRenderer) v = fromRenderer(node.videoRenderer);
    else if (node.gridVideoRenderer) v = fromRenderer(node.gridVideoRenderer);
    else if (node.compactVideoRenderer) v = fromRenderer(node.compactVideoRenderer);
    else if (node.lockupViewModel) v = fromLockup(node.lockupViewModel);
    if (v) {
      if (!seen.has(v.videoId) && v.title) { seen.add(v.videoId); out.push(v); }
      continue;
    }
    if (node.continuationItemRenderer) {
      const tok = node.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token
        || node.continuationItemRenderer.button?.buttonRenderer?.command?.continuationCommand?.token;
      if (tok && !continuation) continuation = tok;
      continue;
    }
    // Não desce em Shorts (reelShelfRenderer etc.) — o player é 16:9.
    for (const k of Object.keys(node)) {
      if (k === 'reelShelfRenderer' || k === 'shortsLockupViewModel' || k === 'reelItemRenderer') continue;
      const c = node[k];
      if (c && typeof c === 'object') stack.push(c);
    }
  }
  return { videos: out, continuation };
}

function parseSearchHtml(html) {
  const data = extractInitialData(html);
  if (!data) return { videos: [], continuation: null };
  return collectVideos(data.contents || data);
}

function parseWatchHtml(html, videoId) {
  const data = extractInitialData(html);
  if (!data) return { videos: [], continuation: null };
  const secondary = data.contents?.twoColumnWatchNextResults?.secondaryResults || data.contents || data;
  return collectVideos(secondary, { exclude: videoId });
}

// Sugestões: suggestqueries devolve ["q",["s1","s2",...]] (client=firefox)
// ou JSONP window.google.ac.h([...]) (client=youtube).
function parseSuggest(body) {
  if (typeof body !== 'string') return [];
  let s = body.trim();
  const m = s.match(/^[\w.]+\(([\s\S]*)\)\s*;?$/);
  if (m) s = m[1];
  try {
    const arr = JSON.parse(s);
    const list = Array.isArray(arr?.[1]) ? arr[1] : [];
    return list.map((x) => (Array.isArray(x) ? x[0] : x)).filter((x) => typeof x === 'string').map((x) => clean(x, 100)).slice(0, 10);
  } catch { return []; }
}

// ---------- rede ----------

async function get(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`youtube ${resp.status}`);
  return resp.text();
}

async function innertube(endpoint, body) {
  const resp = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'pt', gl: 'BR' } }, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`youtube ${resp.status}`);
  return resp.json();
}

const apiKey = () => process.env.YOUTUBE_API_KEY || '';

// ---------- Data API v3 (opcional) ----------

function isoDur(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0); const mi = Number(m[3] || 0); const s = Number(m[4] || 0);
  if (!h && !mi && !s) return '';
  return h ? `${h}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${mi}:${String(s).padStart(2, '0')}`;
}
const fmtViews = (n) => {
  n = Number(n); if (!Number.isFinite(n)) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '')} bi de visualizações`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} mi de visualizações`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} mil visualizações`;
  return `${n} visualizações`;
};
function fromApiVideo(v) {
  const sn = v.snippet || {};
  return {
    videoId: v.id,
    title: clean(sn.title),
    channel: clean(sn.channelTitle, 100),
    channelId: sn.channelId || null,
    duration: isoDur(v.contentDetails?.duration),
    views: fmtViews(v.statistics?.viewCount),
    published: sn.publishedAt ? sn.publishedAt.slice(0, 10) : '',
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    live: sn.liveBroadcastContent === 'live',
  };
}
async function apiGet(path, params) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: apiKey() })) if (v != null && v !== '') u.searchParams.set(k, v);
  const resp = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`youtube api ${resp.status}`);
  return resp.json();
}
async function apiVideos(ids) {
  if (!ids.length) return [];
  const d = await apiGet('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: 50 });
  const byId = new Map((d.items || []).map((v) => [v.id, fromApiVideo(v)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
async function apiSearch(q, pageToken, extra = {}) {
  const d = await apiGet('search', { part: 'id', type: 'video', maxResults: 24, q, pageToken, regionCode: 'BR', relevanceLanguage: 'pt', ...extra });
  const ids = (d.items || []).map((i) => i.id?.videoId).filter((x) => ID_RE.test(x || ''));
  return { videos: await apiVideos(ids), continuation: d.nextPageToken || null };
}

// ---------- públicas ----------

const LIVE_FILTER = 'EgJAAQ%3D%3D'; // filtro "Ao vivo" da busca

async function search(q, continuation, { live = false } = {}) {
  if (apiKey()) return apiSearch(q, continuation, live ? { eventType: 'live' } : {});
  if (continuation) {
    const data = await innertube('search', { continuation });
    return collectVideos(data.onResponseReceivedCommands || data);
  }
  const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt&gl=BR${live ? `&sp=${LIVE_FILTER}` : ''}`);
  return parseSearchHtml(html);
}

// "Em alta" e categorias. A página feed/trending foi descontinuada pelo
// YouTube em 2025 em várias regiões; se vier vazia, cai pra uma busca.
const CATEGORY = {
  now: { api: { chart: 'mostPopular' }, q: 'em alta hoje brasil' },
  music: { api: { chart: 'mostPopular', videoCategoryId: '10' }, q: 'músicas em alta', bp: '4gINGgt5dG1hX2NoYXJ0cw%3D%3D' },
  gaming: { api: { chart: 'mostPopular', videoCategoryId: '20' }, q: 'jogos gameplay', bp: '4gIcGhpnYW1pbmdfY29ycHVzX21vc3RfcG9wdWxhcg%3D%3D' },
  live: { live: true, q: 'ao vivo' },
};

async function trending(category = 'now', continuation) {
  const cat = CATEGORY[category] || CATEGORY.now;
  if (cat.live) return search(cat.q, continuation, { live: true });
  if (apiKey()) {
    const d = await apiGet('videos', { part: 'snippet,contentDetails,statistics', regionCode: 'BR', maxResults: 24, pageToken: continuation, ...cat.api });
    return { videos: (d.items || []).map(fromApiVideo), continuation: d.nextPageToken || null };
  }
  if (continuation) return search(cat.q, continuation);
  try {
    const html = await get(`https://www.youtube.com/feed/trending?hl=pt&gl=BR${cat.bp ? `&bp=${cat.bp}` : ''}`);
    const r = parseSearchHtml(html);
    if (r.videos.length >= 6) return r;
  } catch { /* cai pra busca */ }
  return search(cat.q);
}

async function related(videoId) {
  if (!ID_RE.test(videoId || '')) return { videos: [], continuation: null };
  const html = await get(`https://www.youtube.com/watch?v=${videoId}&hl=pt&gl=BR`);
  const r = parseWatchHtml(html, videoId);
  return { videos: r.videos.slice(0, 30), continuation: null };
}

async function channelVideos(channelId) {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId || '')) return { videos: [], continuation: null };
  const html = await get(`https://www.youtube.com/channel/${channelId}/videos?hl=pt&gl=BR`);
  return parseSearchHtml(html);
}

async function suggest(q) {
  const body = await get(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=pt&gl=br&q=${encodeURIComponent(q)}`);
  return parseSuggest(body);
}

module.exports = {
  search, trending, related, channelVideos, suggest,
  // exportados pros testes
  extractInitialData, collectVideos, parseSearchHtml, parseWatchHtml, parseSuggest, isoDur, CATEGORY,
};
