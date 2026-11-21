// Cinema do Project Club: filmes, séries e desenhos do Internet Archive
// (archive.org). Usa só APIs públicas, sem chave:
//   - Advanced Search  https://archive.org/advancedsearch.php?q=...&output=json
//   - Metadata         https://archive.org/metadata/{identifier}
//   - Arquivos         https://archive.org/download/{identifier}/{arquivo}
//   - Capa             https://archive.org/services/img/{identifier}
// Para não virar vitrine de upload pirata, as buscas ficam presas a
// coleções curadas de domínio público / licença aberta do próprio Archive
// (feature_films, classic_tv, classic_cartoons...). As funções de parse são
// puras e testadas em test/archive-browse.test.js.

const BASE = 'https://archive.org';
const TIMEOUT_MS = 10000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Coleções permitidas (nome real da coleção no archive.org).
const COLLECTIONS = [
  'feature_films', 'classic_tv', 'classic_cartoons', 'animationandcartoons',
  'SciFi_Horror', 'Film_Noir', 'Comedy_Films', 'silent_films',
  'classic_tv_shows', 'television_inbox_classic', 'cartoonsandanimation',
];
const IN_ALLOWED = `collection:(${COLLECTIONS.join(' OR ')})`;

// Categorias da tela inicial / chips. q = filtro extra dentro das coleções.
const CATEGORIES = {
  populares: { label: 'Em alta', q: '' },
  filmes: { label: 'Filmes', q: 'collection:(feature_films OR SciFi_Horror OR Film_Noir OR Comedy_Films)' },
  series: { label: 'Séries e TV', q: 'collection:(classic_tv OR classic_tv_shows OR television_inbox_classic)' },
  desenhos: { label: 'Desenhos', q: 'collection:(classic_cartoons OR animationandcartoons OR cartoonsandanimation)' },
  anime: { label: 'Anime', q: 'subject:(anime OR "japanese animation" OR "japan animation" OR manga OR "animação japonesa")' },
  terror: { label: 'Terror', q: '(collection:SciFi_Horror OR subject:(horror OR terror OR zombie OR vampire OR monster))' },
  ficcao: { label: 'Ficção científica', q: 'subject:("science fiction" OR "sci-fi" OR scifi OR space OR aliens)' },
  comedia: { label: 'Comédia', q: '(collection:Comedy_Films OR subject:(comedy OR comédia OR slapstick))' },
  noir: { label: 'Policial e noir', q: '(collection:Film_Noir OR subject:(noir OR crime OR mystery OR detective))' },
  faroeste: { label: 'Faroeste', q: 'subject:(western OR westerns OR cowboy OR faroeste)' },
  aventura: { label: 'Ação e aventura', q: 'subject:(adventure OR action OR swashbuckler OR war OR aventura)' },
  mudos: { label: 'Cinema mudo', q: '(collection:silent_films OR subject:(silent OR "silent film"))' },
  brasil: { label: 'Em português', q: '(language:(por OR portuguese OR "português") OR subject:(brasil OR brazil OR dublado OR legendado))' },
};
const HOME_ROWS = ['populares', 'filmes', 'series', 'desenhos', 'anime', 'terror', 'comedia', 'faroeste', 'mudos'];

const SORTS = {
  populares: 'downloads desc',
  recentes: 'addeddate desc',
  novos: 'year desc',
  antigos: 'year asc',
  titulo: 'titleSorter asc',
};

const FIELDS = ['identifier', 'title', 'year', 'date', 'downloads', 'description', 'subject', 'runtime', 'collection', 'language', 'creator'];

// ---------- utilidades ----------

const first = (v) => (Array.isArray(v) ? v[0] : v);
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function stripHtml(s) {
  if (!s) return '';
  return String(Array.isArray(s) ? s.join('\n') : s)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function yearOf(doc) {
  const y = Number(first(doc.year));
  if (y > 1800 && y < 2100) return y;
  const m = String(first(doc.date) || '').match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

// "1:23:45" | "83 min" | "5025.3" -> segundos
function parseLength(v) {
  if (v == null || v === '') return null;
  const s = String(first(v)).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const hms = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?/);
  if (hms) return hms[3] != null ? (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]) : (+hms[1]) * 60 + (+hms[2]);
  const min = s.match(/(\d+)\s*min/i);
  if (min) return Number(min[1]) * 60;
  return null;
}

function kindOf(collections, subjects) {
  const c = collections.map((x) => String(x).toLowerCase());
  const s = subjects.join(' ').toLowerCase();
  if (/anime|japanese animation|manga/.test(s)) return 'anime';
  if (c.some((x) => /cartoon|animation/.test(x)) || /cartoon|animat/.test(s)) return 'desenho';
  if (c.some((x) => /tv|television/.test(x)) || /television|tv series|tv show|episode/.test(s)) return 'serie';
  return 'filme';
}

const thumbUrl = (id) => `${BASE}/services/img/${encodeURIComponent(id)}`;
const fileUrl = (id, name) => `${BASE}/download/${encodeURIComponent(id)}/${String(name).split('/').map(encodeURIComponent).join('/')}`;

function safeQuery(q) {
  // Texto livre do usuário: tira a sintaxe Lucene que mudaria o filtro de
  // coleções (parênteses, dois-pontos, aspas soltas, operadores).
  return String(q || '').normalize('NFC').replace(/[(){}[\]:"\\^~*?!/]+/g, ' ')
    .replace(/\b(AND|OR|NOT|TO)\b/g, (w) => w.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function buildQuery({ q, cat }) {
  const parts = ['mediatype:movies', IN_ALLOWED, 'NOT access-restricted-item:true'];
  const c = CATEGORIES[cat];
  if (c?.q) parts.push(c.q);
  const text = safeQuery(q);
  if (text) {
    const words = text.split(' ').filter(Boolean).slice(0, 8).map((w) => w.replace(/[-+]/g, '')).filter(Boolean);
    if (words.length) parts.push(`(${words.map((w) => `(title:${w}* OR subject:${w} OR description:${w})`).join(' AND ')})`);
  }
  return parts.join(' AND ');
}

function searchUrl({ q, cat, sort, page = 1, rows = 24 }) {
  const u = new URL(`${BASE}/advancedsearch.php`);
  u.searchParams.set('q', buildQuery({ q, cat }));
  FIELDS.forEach((f) => u.searchParams.append('fl[]', f));
  u.searchParams.append('sort[]', SORTS[sort] || SORTS.populares);
  u.searchParams.set('rows', String(Math.min(Math.max(rows, 1), 50)));
  u.searchParams.set('page', String(Math.min(Math.max(page, 1), 200)));
  u.searchParams.set('output', 'json');
  return u.toString();
}

// ---------- parse ----------

function parseDoc(doc) {
  if (!doc || !ID_RE.test(String(doc.identifier || ''))) return null;
  const collections = arr(doc.collection).map(String);
  const subjects = arr(doc.subject).flatMap((s) => String(s).split(/[;,]/)).map((s) => s.trim()).filter(Boolean);
  return {
    id: doc.identifier,
    title: stripHtml(first(doc.title)) || doc.identifier,
    year: yearOf(doc),
    description: clip(stripHtml(doc.description), 280),
    downloads: Number(doc.downloads) || 0,
    duration: parseLength(doc.runtime),
    creator: stripHtml(first(doc.creator)) || '',
    kind: kindOf(collections, subjects),
    thumbnail: thumbUrl(doc.identifier),
  };
}

function parseSearch(json, page = 1, rows = 24) {
  const r = json?.response;
  const docs = Array.isArray(r?.docs) ? r.docs : [];
  const total = Number(r?.numFound) || 0;
  const seen = new Set();
  const items = [];
  for (const d of docs) {
    const it = parseDoc(d);
    if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); }
  }
  return { items, total, page, hasMore: page * rows < total };
}

const VIDEO_EXT = /\.(mp4|m4v|webm|ogv)$/i;
const SUB_EXT = /\.(srt|vtt)$/i;

const LANGS = [
  [/(^|[._ -])(pt[-_]?br|ptbr|pob)([._ -]|$)|portugu[eê]s[ _-]?br|brazil/i, 'pt-BR', 'Português (Brasil)'],
  [/(^|[._ -])(pt|por)([._ -]|$)|portug/i, 'pt', 'Português'],
  [/(^|[._ -])(es|spa)([._ -]|$)|spanish|espa[nñ]ol/i, 'es', 'Español'],
  [/(^|[._ -])(fr|fre|fra)([._ -]|$)|french|fran[cç]ais/i, 'fr', 'Français'],
  [/(^|[._ -])(de|ger|deu)([._ -]|$)|german|deutsch/i, 'de', 'Deutsch'],
  [/(^|[._ -])(it|ita)([._ -]|$)|italian/i, 'it', 'Italiano'],
  [/(^|[._ -])(ja|jpn)([._ -]|$)|japanese/i, 'ja', '日本語'],
  [/(^|[._ -])(en|eng)([._ -]|$)|english/i, 'en', 'English'],
];
function subLang(name) {
  const base = name.replace(SUB_EXT, '');
  for (const [re, code, label] of LANGS) if (re.test(base)) return { lang: code, label };
  return { lang: 'und', label: 'Legenda' };
}

function qualityOf(f) {
  const h = Number(f.height) || 0;
  const fmt = String(f.format || '');
  let label;
  if (h >= 1000) label = '1080p';
  else if (h >= 700) label = '720p';
  else if (h >= 470) label = '480p';
  else if (h >= 350) label = '360p';
  else if (h > 0) label = `${h}p`;
  else if (/512Kb/i.test(fmt)) label = '360p (leve)';
  else if (/HiRes|HD/i.test(fmt)) label = 'HD';
  else label = fmt || 'Original';
  return { label, height: h, size: Number(f.size) || 0, format: fmt };
}

// "Episode 01 - Title.mp4" -> "Episode 01 - Title"
function prettyName(name) {
  return String(name).split('/').pop().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\.(ia|512kb|h264)$/i, '')
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const naturalCmp = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

function parseItem(json) {
  const m = json?.metadata;
  if (!m || !ID_RE.test(String(m.identifier || ''))) return null;
  const id = m.identifier;
  const restricted = String(m['access-restricted-item'] || '').toLowerCase() === 'true' || json.is_dark === true;
  const files = Array.isArray(json.files) ? json.files : [];
  const collections = arr(m.collection).map(String);
  const subjects = arr(m.subject).flatMap((s) => String(s).split(/[;,]/)).map((s) => s.trim()).filter(Boolean);

  // Agrupa vídeos tocáveis pelo arquivo de origem: cada original = 1 episódio,
  // cada derivado (h.264, 512Kb, webm...) = 1 opção de qualidade.
  const byName = new Map(files.map((f) => [f.name, f]));
  const groups = new Map();
  for (const f of files) {
    if (!f?.name || !VIDEO_EXT.test(f.name) || /thumb|sample|trailer\.ia/i.test(f.format || '') || f.private === 'true') continue;
    let key = f.source === 'derivative' && f.original ? f.original : f.name;
    // Derivado de derivado (raro): sobe até o original.
    for (let i = 0; i < 3 && byName.get(key)?.source === 'derivative' && byName.get(key)?.original; i++) key = byName.get(key).original;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  const subs = files.filter((f) => f?.name && SUB_EXT.test(f.name)).map((f) => ({ file: f.name, ...subLang(f.name) }));

  const episodes = [...groups.entries()].map(([key, list]) => {
    const orig = byName.get(key) || list[0];
    const sources = list
      .map((f) => ({ url: fileUrl(id, f.name), type: /\.webm$/i.test(f.name) ? 'video/webm' : /\.ogv$/i.test(f.name) ? 'video/ogg' : 'video/mp4', ...qualityOf(f) }))
      // mp4 primeiro (toca em tudo, inclusive iPhone), depois maior altura.
      .sort((a, b) => (a.type === 'video/mp4' ? 0 : 1) - (b.type === 'video/mp4' ? 0 : 1) || b.height - a.height || b.size - a.size);
    // Remove rótulos repetidos (fica o primeiro = melhor).
    const seenL = new Set();
    const uniq = sources.filter((s) => (seenL.has(s.label) ? false : (seenL.add(s.label), true)));
    const stem = key.replace(/\.[a-z0-9]{2,4}$/i, '').toLowerCase();
    const mySubs = subs.filter((s) => s.file.toLowerCase().startsWith(stem));
    return {
      key,
      title: stripHtml(orig.title) || prettyName(key),
      duration: parseLength(orig.length) || parseLength(list.find((f) => f.length)?.length),
      sources: uniq,
      subtitles: mySubs,
    };
  }).filter((e) => e.sources.length).sort((a, b) => naturalCmp(a.key, b.key));

  // Legendas sem episódio certo: se for um filme só, valem para ele.
  if (episodes.length === 1 && !episodes[0].subtitles.length) episodes[0].subtitles = subs;

  return {
    id,
    title: stripHtml(first(m.title)) || id,
    year: yearOf(m),
    description: clip(stripHtml(m.description), 4000),
    creator: stripHtml(first(m.creator)) || '',
    language: stripHtml(first(m.language)) || '',
    subjects: subjects.slice(0, 12),
    kind: episodes.length > 1 && kindOf(collections, subjects) === 'filme' ? 'serie' : kindOf(collections, subjects),
    license: String(first(m.licenseurl) || '') || null,
    thumbnail: thumbUrl(id),
    pageUrl: `${BASE}/details/${encodeURIComponent(id)}`,
    restricted,
    allowed: collections.some((c) => COLLECTIONS.includes(c)),
    episodes: restricted ? [] : episodes,
  };
}

// SRT -> WebVTT (também normaliza VTT já pronto).
function srtToVtt(text) {
  let t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t;
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, (_, a, ms) => `${a.padStart(8, '0')}.${ms.padEnd(3, '0')}`);
  // Remove os números soltos das falas (linha só com número antes do tempo).
  t = t.replace(/(^|\n)\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3}\s+-->)/g, '$1');
  return `WEBVTT\n\n${t.trim()}\n`;
}

function decodeText(buf) {
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!utf.includes('\uFFFD')) return utf;
  return new TextDecoder('windows-1252').decode(buf); // legendas antigas em latin1
}

// ---------- rede + cache ----------

const cache = new Map();
const MAX_CACHE = 400;
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.promise;
  const promise = fn().catch((e) => { cache.delete(key); if (hit?.value) return hit.value; throw e; });
  promise.then((value) => { const c = cache.get(key); if (c) c.value = value; }).catch(() => {});
  cache.set(key, { at: now, promise, value: hit?.value });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return promise;
}

async function getJson(url) {
  const resp = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ProjectClub/1.0 (+cinema)' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!resp.ok) throw Object.assign(new Error(`archive.org ${resp.status}`), { status: 502 });
  return resp.json();
}

function search({ q = '', cat = 'populares', sort = 'populares', page = 1, rows = 24 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const r = Math.min(50, Math.max(1, Number(rows) || 24));
  const c = CATEGORIES[cat] ? cat : 'populares';
  const s = SORTS[sort] ? sort : 'populares';
  const url = searchUrl({ q, cat: c, sort: s, page: p, rows: r });
  return cached(`s:${url}`, 15 * 60 * 1000, async () => parseSearch(await getJson(url), p, r));
}

function home() {
  return cached('home', 60 * 60 * 1000, async () => {
    const rows = await Promise.all(HOME_ROWS.map(async (cat) => {
      try { const r = await search({ cat, rows: 18 }); return { cat, label: CATEGORIES[cat].label, items: r.items }; } catch { return { cat, label: CATEGORIES[cat].label, items: [] }; }
    }));
    const ok = rows.filter((r) => r.items.length);
    if (!ok.length) throw Object.assign(new Error('archive.org indisponível'), { status: 502 });
    return { rows: ok };
  });
}

function item(id) {
  if (!ID_RE.test(String(id || ''))) return Promise.reject(Object.assign(new Error('id inválido'), { status: 400 }));
  return cached(`i:${id}`, 60 * 60 * 1000, async () => {
    const it = parseItem(await getJson(`${BASE}/metadata/${encodeURIComponent(id)}`));
    if (!it) throw Object.assign(new Error('Não encontrado'), { status: 404 });
    return it;
  });
}

async function subtitle(id, file) {
  const it = await item(id);
  const known = it.episodes.some((e) => e.subtitles.some((s) => s.file === file));
  if (!known) throw Object.assign(new Error('Legenda não encontrada'), { status: 404 });
  return cached(`sub:${id}/${file}`, 6 * 60 * 60 * 1000, async () => {
    const resp = await fetch(fileUrl(id, file), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!resp.ok) throw Object.assign(new Error(`archive.org ${resp.status}`), { status: 502 });
    const len = Number(resp.headers.get('content-length')) || 0;
    if (len > 3 * 1024 * 1024) throw Object.assign(new Error('Legenda grande demais'), { status: 413 });
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength > 3 * 1024 * 1024) throw Object.assign(new Error('Legenda grande demais'), { status: 413 });
    return srtToVtt(decodeText(buf));
  });
}

const categories = () => Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label }));

module.exports = {
  search, home, item, subtitle, categories,
  // puros (testes)
  buildQuery, searchUrl, parseSearch, parseItem, srtToVtt, parseLength, safeQuery, subLang, decodeText,
  CATEGORIES, SORTS, COLLECTIONS,
};
