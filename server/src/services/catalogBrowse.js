// Cinema → "Lançamentos": catálogo de filmes, séries e anime recentes.
// Só metadados e trailers (nada de vídeo pirata): capa, sinopse, nota,
// elenco, trailers e ONDE ASSISTIR legalmente no Brasil.
//
// Fontes (todas públicas):
//   - TMDB (opcional, chave grátis em TMDB_API_KEY: chave v3 ou token v4)
//     → filmes/séries em pt-BR, trailers e provedores no Brasil (JustWatch).
//   - Jikan / MyAnimeList (sem chave) → anime da temporada, populares, trailers
//     e links oficiais de streaming.
//   - TVmaze (sem chave) → séries passando agora nos streamings.
//   - iTunes Store BR (sem chave) → filmes em alta, sinopse em português e
//     trailer em vídeo (previewUrl).
//   - YouTube (serviço já existente) → trailer de reserva quando a fonte não tem.
// Parsers puros testados em test/catalog-browse.test.js.

const yt = require('./youtubeBrowse');

const TIMEOUT_MS = 9000;
const TMDB = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const JIKAN = 'https://api.jikan.moe/v4';
const TVMAZE = 'https://api.tvmaze.com';
const ITUNES = 'https://itunes.apple.com';

const tmdbKey = () => (process.env.TMDB_API_KEY || process.env.TMDB_READ_TOKEN || '').trim();
const hasTmdb = () => !!tmdbKey();

// ---------- utilidades ----------
const first = (v) => (Array.isArray(v) ? v[0] : v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const yearOf = (d) => { const m = String(d || '').match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '');
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const ytIdFrom = (s) => String(s || '').match(/(?:embed\/|v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] || null;
const isYtId = (s) => /^[A-Za-z0-9_-]{11}$/.test(String(s || ''));
const safeText = (q) => String(q || '').normalize('NFC').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

// Ids: "tmdb:movie:603" | "tmdb:tv:1399" | "mal:5114" | "tvm:82" | "itn:1234567"
const ID_RE = /^(tmdb:(movie|tv):\d{1,9}|mal:\d{1,9}|tvm:\d{1,9}|itn:\d{1,12})$/;

const TMDB_GENRES = {
  28: 'Ação', 12: 'Aventura', 16: 'Animação', 35: 'Comédia', 80: 'Crime', 99: 'Documentário', 18: 'Drama', 10751: 'Família',
  14: 'Fantasia', 36: 'História', 27: 'Terror', 10402: 'Música', 9648: 'Mistério', 10749: 'Romance', 878: 'Ficção científica',
  10770: 'Filme de TV', 53: 'Suspense', 10752: 'Guerra', 37: 'Faroeste', 10759: 'Ação e aventura', 10762: 'Infantil',
  10763: 'Notícias', 10764: 'Reality', 10765: 'Ficção e fantasia', 10766: 'Novela', 10767: 'Talk show', 10768: 'Guerra e política',
};
const isAnimeTmdb = (r) => (r.genre_ids || (r.genres || []).map((g) => g.id) || []).includes(16) && (r.original_language === 'ja' || (r.origin_country || []).includes('JP'));

// ---------- TMDB ----------
const img = (path, size) => (path ? `${TMDB_IMG}/${size}${path}` : null);

function tmdbCard(r, forceType) {
  if (!r || !r.id) return null;
  const type = forceType || r.media_type;
  if (type !== 'movie' && type !== 'tv') return null;
  const title = r.title || r.name;
  if (!title) return null;
  return {
    id: `tmdb:${type}:${r.id}`,
    source: 'tmdb',
    kind: isAnimeTmdb(r) ? 'anime' : (type === 'movie' ? 'filme' : 'serie'),
    title,
    original: (r.original_title || r.original_name) !== title ? (r.original_title || r.original_name) : '',
    year: yearOf(r.release_date || r.first_air_date),
    date: r.release_date || r.first_air_date || null,
    poster: img(r.poster_path, 'w500'),
    backdrop: img(r.backdrop_path, 'w1280'),
    rating: r.vote_average ? round1(r.vote_average) : null,
    votes: r.vote_count || 0,
    overview: clip(stripHtml(r.overview), 300),
    genres: (r.genre_ids || []).map((g) => TMDB_GENRES[g]).filter(Boolean).slice(0, 3),
  };
}

function tmdbList(json, forceType) {
  const seen = new Set();
  const items = (json?.results || []).map((r) => tmdbCard(r, forceType))
    .filter((c) => c && c.poster && !seen.has(c.id) && seen.add(c.id));
  return { items, page: json?.page || 1, hasMore: (json?.page || 1) < Math.min(json?.total_pages || 1, 50) };
}

function pickTrailers(videos) {
  const list = (videos?.results || []).filter((v) => v.site === 'YouTube' && isYtId(v.key) && /Trailer|Teaser/i.test(v.type));
  const lang = (v) => (v.iso_639_1 === 'pt' ? 0 : v.iso_639_1 === 'en' ? 1 : 2);
  const kind = (v) => (v.type === 'Trailer' ? 0 : 1);
  list.sort((a, b) => lang(a) - lang(b) || kind(a) - kind(b) || (b.official ? 1 : 0) - (a.official ? 1 : 0));
  return list.slice(0, 6).map((v) => ({
    youtubeId: v.key,
    title: v.name || 'Trailer',
    lang: v.iso_639_1 === 'pt' ? (/dub/i.test(v.name) ? 'Dublado' : /leg/i.test(v.name) ? 'Legendado' : 'Português') : v.iso_639_1 === 'en' ? 'Inglês' : '',
  }));
}

function pickProviders(wp) {
  const br = wp?.results?.BR;
  if (!br) return null;
  const map = (arr) => (arr || []).map((p) => ({ name: p.provider_name, logo: img(p.logo_path, 'w92') }))
    .filter((p, i, a) => a.findIndex((x) => x.name === p.name) === i).slice(0, 12);
  const out = { link: br.link || null, stream: map(br.flatrate), free: map([...(br.free || []), ...(br.ads || [])]), rent: map(br.rent), buy: map(br.buy), attribution: 'JustWatch' };
  out.pluto = [...out.free, ...out.stream].some((p) => /pluto/i.test(p.name));
  return out.stream.length || out.free.length || out.rent.length || out.buy.length ? out : null;
}

function tmdbDetail(d, type) {
  const card = tmdbCard(d, type);
  if (!card) return null;
  const credits = d.aggregate_credits || d.credits;
  const cast = (credits?.cast || []).slice(0, 14).map((c) => ({
    name: c.name, role: c.character || c.roles?.[0]?.character || '', photo: img(c.profile_path, 'w185'),
  }));
  const crew = credits?.crew || [];
  const directors = type === 'movie' ? crew.filter((c) => c.job === 'Director').map((c) => c.name) : (d.created_by || []).map((c) => c.name);
  const cert = type === 'movie'
    ? d.release_dates?.results?.find((r) => r.iso_3166_1 === 'BR')?.release_dates?.find((x) => x.certification)?.certification
    : d.content_ratings?.results?.find((r) => r.iso_3166_1 === 'BR')?.rating;
  return {
    ...card,
    genres: (d.genres || []).map((g) => g.name),
    overview: stripHtml(d.overview),
    tagline: d.tagline || '',
    runtime: type === 'movie' ? (d.runtime || null) : (first(d.episode_run_time) || null),
    seasons: type === 'tv' ? (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({
      number: s.season_number, name: s.name, episodes: s.episode_count, year: yearOf(s.air_date), poster: img(s.poster_path, 'w185'),
    })) : [],
    episodes: type === 'tv' ? d.number_of_episodes || null : null,
    status: d.status || '',
    network: (d.networks || []).map((n) => n.name).slice(0, 2).join(', ') || (d.production_companies || []).map((n) => n.name).slice(0, 2).join(', '),
    creators: directors.slice(0, 3),
    certification: cert || '',
    cast,
    trailers: pickTrailers(d.videos),
    providers: pickProviders(d['watch/providers']),
    links: [d.homepage ? { name: 'Site oficial', url: d.homepage } : null, d.imdb_id || d.external_ids?.imdb_id ? { name: 'IMDb', url: `https://www.imdb.com/title/${d.imdb_id || d.external_ids.imdb_id}/` } : null,
      { name: 'TMDB', url: `https://www.themoviedb.org/${type}/${d.id}` }].filter(Boolean),
    recommendations: tmdbList(d.recommendations?.results?.length ? d.recommendations : d.similar, type).items.slice(0, 16),
  };
}

// ---------- Jikan (MyAnimeList) ----------
function malCard(a) {
  if (!a?.mal_id) return null;
  const poster = a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null;
  return {
    id: `mal:${a.mal_id}`,
    source: 'mal',
    kind: 'anime',
    title: a.title_english || a.title || '',
    original: a.title_english && a.title && a.title !== a.title_english ? a.title : '',
    year: a.year || yearOf(a.aired?.from),
    date: a.aired?.from ? String(a.aired.from).slice(0, 10) : null,
    poster,
    backdrop: null,
    rating: a.score ? round1(a.score) : null,
    votes: a.scored_by || 0,
    overview: clip(stripHtml(a.synopsis).replace(/\[Written by MAL Rewrite\]/i, '').trim(), 300),
    genres: (a.genres || []).map((g) => g.name).slice(0, 3),
    format: a.type || '',
  };
}

function malList(json) {
  const seen = new Set();
  const items = (json?.data || []).map(malCard).filter((c) => c && c.poster && c.title && !seen.has(c.id) && seen.add(c.id));
  return { items, page: json?.pagination?.current_page || 1, hasMore: !!json?.pagination?.has_next_page };
}

function malDetail(a, recs) {
  const card = malCard(a);
  if (!card) return null;
  const ytId = (isYtId(a.trailer?.youtube_id) && a.trailer.youtube_id) || ytIdFrom(a.trailer?.embed_url) || ytIdFrom(a.trailer?.url);
  const streams = (a.streaming || []).filter((s) => /^https:\/\//.test(s.url || '')).map((s) => ({ name: s.name, url: s.url }));
  return {
    ...card,
    overview: stripHtml(a.synopsis).replace(/\[Written by MAL Rewrite\]/i, '').trim(),
    overviewLang: 'en',
    genres: [...(a.genres || []), ...(a.themes || []), ...(a.demographics || [])].map((g) => g.name).slice(0, 8),
    runtime: num(String(a.duration || '').match(/(\d+)\s*min/)?.[1]),
    episodes: a.episodes || null,
    seasons: [],
    status: ({ 'Currently Airing': 'Em exibição', 'Finished Airing': 'Finalizado', 'Not yet aired': 'Em breve' })[a.status] || a.status || '',
    network: (a.studios || []).map((s) => s.name).join(', '),
    creators: [],
    certification: a.rating || '',
    season: a.season && a.year ? `${({ winter: 'Inverno', spring: 'Primavera', summer: 'Verão', fall: 'Outono' })[a.season] || a.season} ${a.year}` : '',
    cast: [],
    trailers: ytId ? [{ youtubeId: ytId, title: 'Trailer', lang: '' }] : [],
    providers: streams.length ? { link: null, stream: streams.map((s) => ({ name: s.name, logo: null, url: s.url })), free: [], rent: [], buy: [], attribution: 'MyAnimeList' } : null,
    links: [{ name: 'MyAnimeList', url: a.url || `https://myanimelist.net/anime/${a.mal_id}` }],
    recommendations: (recs?.data || []).slice(0, 16).map((r) => malCard({ ...r.entry, type: '' })).filter((c) => c && c.poster),
  };
}

// ---------- TVmaze ----------
function tvmCard(s) {
  if (!s?.id || !s.name) return null;
  const isAnime = s.type === 'Animation' && (s.language === 'Japanese' || s.network?.country?.code === 'JP');
  return {
    id: `tvm:${s.id}`,
    source: 'tvm',
    kind: isAnime ? 'anime' : 'serie',
    title: s.name,
    original: '',
    year: yearOf(s.premiered),
    date: s.premiered || null,
    poster: s.image?.original || s.image?.medium || null,
    backdrop: null,
    rating: s.rating?.average ? round1(s.rating.average) : null,
    votes: s.weight || 0,
    overview: clip(stripHtml(s.summary), 300),
    genres: (s.genres || []).slice(0, 3),
    network: s.webChannel?.name || s.network?.name || '',
  };
}

// Programação dos streamings de hoje → séries únicas, mais populares primeiro.
function tvmSchedule(list) {
  const seen = new Map();
  for (const ep of Array.isArray(list) ? list : []) {
    const s = ep?._embedded?.show || ep?.show;
    if (!s || seen.has(s.id)) continue;
    const c = tvmCard(s);
    if (c?.poster) seen.set(s.id, { ...c, weight: s.weight || 0 });
  }
  return [...seen.values()].sort((a, b) => b.weight - a.weight || (b.rating || 0) - (a.rating || 0)).map(({ weight, ...c }) => c);
}

function tvmDetail(s) {
  const card = tvmCard(s);
  if (!card) return null;
  const emb = s._embedded || {};
  const seasons = (emb.seasons || []).filter((x) => x.number > 0).map((x) => ({
    number: x.number, name: x.name || `Temporada ${x.number}`, episodes: x.episodeOrder || null, year: yearOf(x.premiereDate), poster: x.image?.medium || null,
  }));
  return {
    ...card,
    overview: stripHtml(s.summary),
    overviewLang: s.language === 'Portuguese' ? 'pt' : 'en',
    genres: s.genres || [],
    runtime: s.averageRuntime || s.runtime || null,
    episodes: null,
    seasons,
    status: ({ Running: 'Em exibição', Ended: 'Finalizada', 'To Be Determined': 'Indefinido', 'In Development': 'Em produção' })[s.status] || s.status || '',
    creators: [],
    certification: '',
    cast: (emb.cast || []).slice(0, 14).map((c) => ({ name: c.person?.name || '', role: c.character?.name || '', photo: c.person?.image?.medium || null })),
    trailers: [],
    providers: s.webChannel?.name ? { link: s.webChannel.officialSite || s.officialSite || null, stream: [{ name: s.webChannel.name, logo: null, url: s.webChannel.officialSite || s.officialSite || null }], free: [], rent: [], buy: [], attribution: 'TVmaze' } : null,
    links: [s.officialSite ? { name: 'Site oficial', url: s.officialSite } : null, s.externals?.imdb ? { name: 'IMDb', url: `https://www.imdb.com/title/${s.externals.imdb}/` } : null, { name: 'TVmaze', url: s.url || `https://www.tvmaze.com/shows/${s.id}` }].filter(Boolean),
    recommendations: [],
  };
}

// ---------- iTunes ----------
const bigArt = (u) => (u ? String(u).replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png)$/i, '/600x900bb.jpg') : null);

function itnCard(r) {
  const id = r?.trackId;
  if (!id || !r.trackName) return null;
  return {
    id: `itn:${id}`,
    source: 'itn',
    kind: 'filme',
    title: r.trackName,
    original: '',
    year: yearOf(r.releaseDate),
    date: r.releaseDate ? String(r.releaseDate).slice(0, 10) : null,
    poster: bigArt(r.artworkUrl100 || r.artworkUrl60),
    backdrop: null,
    rating: null,
    votes: 0,
    overview: clip(stripHtml(r.longDescription || r.shortDescription), 300),
    genres: r.primaryGenreName ? [r.primaryGenreName] : [],
  };
}

// RSS "topmovies" (formato legado do iTunes).
function itnRss(json) {
  const entries = json?.feed?.entry ? (Array.isArray(json.feed.entry) ? json.feed.entry : [json.feed.entry]) : [];
  return entries.map((e) => {
    const id = num(e?.id?.attributes?.['im:id']);
    const name = e?.['im:name']?.label;
    if (!id || !name) return null;
    const imgs = e['im:image'] || [];
    return {
      id: `itn:${id}`, source: 'itn', kind: 'filme', title: name, original: '',
      year: yearOf(e['im:releaseDate']?.label), date: String(e['im:releaseDate']?.label || '').slice(0, 10) || null,
      poster: bigArt(imgs[imgs.length - 1]?.label), backdrop: null, rating: null, votes: 0,
      overview: clip(stripHtml(e.summary?.label), 300), genres: e.category?.attributes?.label ? [e.category.attributes.label] : [],
    };
  }).filter((c) => c && c.poster);
}

function itnDetail(r) {
  const card = itnCard(r);
  if (!card) return null;
  return {
    ...card,
    overview: stripHtml(r.longDescription || r.shortDescription),
    overviewLang: 'pt',
    runtime: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : null,
    episodes: null,
    seasons: [],
    status: '',
    network: '',
    creators: r.artistName ? [r.artistName] : [],
    certification: r.contentAdvisoryRating || '',
    cast: [],
    trailers: /^https:\/\//.test(r.previewUrl || '') ? [{ url: r.previewUrl, title: 'Trailer', lang: 'Apple TV' }] : [],
    providers: r.trackViewUrl ? {
      link: r.trackViewUrl, stream: [],
      free: [], rent: r.trackRentalPrice ? [{ name: 'Apple TV', logo: null, url: r.trackViewUrl }] : [],
      buy: [{ name: 'Apple TV', logo: null, url: r.trackViewUrl }], attribution: 'Apple',
    } : null,
    links: r.trackViewUrl ? [{ name: 'Apple TV', url: r.trackViewUrl }] : [],
    recommendations: [],
  };
}

// ---------- rede + cache ----------
const cache = new Map();
const MAX_CACHE = 600;
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.promise;
  // Vencido mas com valor: entrega o antigo na hora e renova em segundo
  // plano (ninguém espera a fonte externa por causa de cache vencido).
  if (hit && hit.value !== undefined && !hit.refreshing) {
    hit.refreshing = true;
    fn().then((value) => cache.set(key, { at: Date.now(), promise: Promise.resolve(value), value }))
      .catch(() => { hit.at = Date.now() - ttl + 5 * 60 * 1000; }) // tenta de novo em 5 min
      .finally(() => { hit.refreshing = false; });
    return Promise.resolve(hit.value);
  }
  const promise = fn().catch((e) => { if (hit?.value !== undefined) return hit.value; cache.delete(key); throw e; });
  promise.then((value) => { const c = cache.get(key); if (c) c.value = value; }).catch(() => {});
  cache.set(key, { at: now, promise, value: hit?.value });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return promise;
}

const err = (status, msg) => Object.assign(new Error(msg), { status });

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ProjectClub/1.0 (+cinema)', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (resp.status === 404) throw err(404, 'Não encontrado');
  if (!resp.ok) throw err(502, `fonte ${resp.status}`);
  return resp.json();
}

function tmdbGet(path, params = {}) {
  const key = tmdbKey();
  if (!key) return Promise.reject(err(503, 'TMDB não configurado'));
  const u = new URL(TMDB + path);
  const bearer = key.startsWith('eyJ');
  if (!bearer) u.searchParams.set('api_key', key);
  u.searchParams.set('language', 'pt-BR');
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  return getJson(u.toString(), bearer ? { authorization: `Bearer ${key}` } : {});
}

// Jikan: 3 req/s e 60/min → fila com espaçamento mínimo.
let jikanChain = Promise.resolve();
let jikanLast = 0;
function jikanGet(path, params = {}) {
  const u = new URL(JIKAN + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const run = jikanChain.then(async () => {
    const wait = Math.max(0, jikanLast + 420 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    jikanLast = Date.now();
    return getJson(u.toString());
  });
  jikanChain = run.catch(() => {});
  return run;
}

const tvmGet = (path) => getJson(TVMAZE + path);
const itnGet = (path) => getJson(ITUNES + path);
const today = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // dia em Brasília

const H = 3600 * 1000;

// ---------- listas ----------
// Cada lista = uma fileira na tela inicial e uma grade em "Ver tudo".
const LISTS = {
  // TMDB (com chave)
  em_alta: { label: 'Em alta hoje', tmdb: true, fetch: (p) => tmdbGet('/trending/all/day', { page: p }).then((j) => tmdbList(j)) },
  cinema: { label: 'Nos cinemas', tmdb: true, fetch: (p) => tmdbGet('/movie/now_playing', { page: p, region: 'BR' }).then((j) => tmdbList(j, 'movie')) },
  filmes_populares: { label: 'Filmes populares', tmdb: true, fetch: (p) => tmdbGet('/movie/popular', { page: p, region: 'BR' }).then((j) => tmdbList(j, 'movie')) },
  series_populares: { label: 'Séries populares', tmdb: true, fetch: (p) => tmdbGet('/tv/popular', { page: p }).then((j) => tmdbList(j, 'tv')) },
  em_breve: { label: 'Em breve', tmdb: true, fetch: (p) => tmdbGet('/movie/upcoming', { page: p, region: 'BR' }).then((j) => tmdbList(j, 'movie')) },
  aclamados: { label: 'Aclamados desde 2020', tmdb: true, fetch: (p) => tmdbGet('/discover/movie', { page: p, sort_by: 'vote_average.desc', 'vote_count.gte': 1500, 'primary_release_date.gte': '2020-01-01' }).then((j) => tmdbList(j, 'movie')) },
  // Sem chave
  anime_temporada: { label: 'Anime da temporada', fetch: (p) => jikanGet('/seasons/now', { sfw: 'true', page: p, limit: 24 }).then(malList) },
  anime_populares: { label: 'Anime mais populares', fetch: (p) => jikanGet('/top/anime', { filter: 'bypopularity', sfw: 'true', page: p, limit: 24 }).then(malList) },
  anime_recentes: { label: 'Anime aclamados desde 2020', fetch: (p) => jikanGet('/anime', { sfw: 'true', start_date: '2020-01-01', order_by: 'score', sort: 'desc', min_score: 7.5, page: p, limit: 24 }).then(malList) },
  anime_filmes: { label: 'Filmes de anime', fetch: (p) => jikanGet('/anime', { sfw: 'true', type: 'movie', start_date: '2016-01-01', order_by: 'members', sort: 'desc', page: p, limit: 24 }).then(malList) },
  series_agora: {
    label: 'Séries passando agora nos streamings',
    fetch: async (p) => {
      const all = tvmSchedule(await tvmGet(`/schedule/web?date=${today()}`));
      const per = 24;
      return { items: all.slice((p - 1) * per, p * per), page: p, hasMore: all.length > p * per };
    },
  },
  filmes_itunes: {
    label: 'Filmes em alta no Brasil',
    fetch: async (p) => {
      const all = itnRss(await itnGet('/br/rss/topmovies/limit=100/json'));
      const per = 24;
      return { items: all.slice((p - 1) * per, p * per), page: p, hasMore: all.length > p * per };
    },
  },
};

const HOME_WITH_TMDB = ['em_alta', 'cinema', 'filmes_populares', 'series_populares', 'anime_temporada', 'em_breve', 'aclamados', 'anime_populares', 'series_agora', 'anime_filmes'];
const HOME_NO_TMDB = ['filmes_itunes', 'anime_temporada', 'series_agora', 'anime_populares', 'anime_recentes', 'anime_filmes'];

function list(name, page = 1) {
  const L = LISTS[name];
  if (!L) return Promise.reject(err(404, 'Lista não encontrada'));
  if (L.tmdb && !hasTmdb()) return Promise.reject(err(503, 'TMDB não configurado'));
  const p = Math.min(Math.max(1, Number(page) || 1), 20);
  return cached(`l:${name}:${p}`, (name.startsWith('series_agora') ? 2 : 3) * H, () => L.fetch(p));
}

function home() {
  return cached(`home:${hasTmdb() ? 1 : 0}`, 1 * H, async () => {
    const names = hasTmdb() ? HOME_WITH_TMDB : HOME_NO_TMDB;
    // Em paralelo (o Jikan tem fila própria com espaçamento); cada fonte tem
    // até 8 s — uma fonte lenta não segura as outras.
    const within = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(err(504, 'lento')), ms))]);
    const results = await Promise.allSettled(names.map((name) => within(list(name, 1), 8000)));
    const rows = results.map((r, i) => (r.status === 'fulfilled' && r.value.items.length
      ? { list: names[i], label: LISTS[names[i]].label, items: r.value.items.slice(0, 20) } : null)).filter(Boolean);
    if (!rows.length) throw err(502, 'Fontes indisponíveis');
    return { rows, tmdb: hasTmdb() };
  });
}

function lists() {
  return Object.entries(LISTS).filter(([, L]) => !L.tmdb || hasTmdb()).map(([id, L]) => ({ id, label: L.label }));
}

// Busca unificada: TMDB (se houver) + anime no MyAnimeList + séries no TVmaze + filmes no iTunes.
function search(q, kind = 'todos') {
  const text = safeText(q);
  if (!text) return Promise.resolve({ items: [] });
  const k = ['todos', 'filme', 'serie', 'anime'].includes(kind) ? kind : 'todos';
  return cached(`s:${k}:${text.toLowerCase()}`, 2 * H, async () => {
    const jobs = [];
    if (hasTmdb()) jobs.push(tmdbGet('/search/multi', { query: text, include_adult: 'false', region: 'BR' }).then((j) => tmdbList(j).items));
    else {
      if (k === 'todos' || k === 'filme') jobs.push(itnGet(`/search?term=${encodeURIComponent(text)}&country=BR&media=movie&entity=movie&limit=20&lang=pt_br`).then((j) => (j.results || []).map(itnCard).filter((c) => c && c.poster)));
      if (k === 'todos' || k === 'serie') jobs.push(tvmGet(`/search/shows?q=${encodeURIComponent(text)}`).then((j) => (j || []).map((x) => tvmCard(x.show)).filter((c) => c && c.poster)));
    }
    if (k === 'todos' || k === 'anime') jobs.push(jikanGet('/anime', { q: text, sfw: 'true', limit: 16, order_by: 'members', sort: 'desc' }).then((j) => malList(j).items));
    const results = await Promise.allSettled(jobs);
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw err(502, 'Fontes indisponíveis');
    // Intercala as fontes (a mais relevante de cada uma primeiro).
    const lists2 = ok.map((r) => r.value);
    const out = []; const seen = new Set();
    for (let i = 0; out.length < 60 && lists2.some((l) => l[i]); i++) {
      for (const l of lists2) { const c = l[i]; if (c && !seen.has(c.id) && (k === 'todos' || c.kind === k)) { seen.add(c.id); out.push(c); } }
    }
    return { items: out };
  });
}

// Trailer de reserva pelo YouTube (busca "<título> <ano> trailer").
async function ytTrailer(title, year, kind) {
  try {
    const q = `${title} ${year || ''} ${kind === 'anime' ? 'trailer' : 'trailer oficial'}`.replace(/\s+/g, ' ').trim();
    const r = await yt.search(q);
    const v = (r.videos || []).find((x) => !x.live && /trailer|teaser|tráiler|pv|promo/i.test(x.title || '')) || null;
    return v ? [{ youtubeId: v.videoId, title: v.title, lang: '', fromSearch: true }] : [];
  } catch { return []; }
}

function item(id) {
  if (!ID_RE.test(String(id || ''))) return Promise.reject(err(400, 'id inválido'));
  return cached(`i:${id}`, 6 * H, async () => {
    const [src, a, b] = id.split(':');
    let d = null;
    if (src === 'tmdb') {
      const type = a;
      const append = type === 'movie' ? 'videos,credits,watch/providers,recommendations,similar,release_dates' : 'videos,aggregate_credits,watch/providers,recommendations,similar,content_ratings,external_ids';
      d = tmdbDetail(await tmdbGet(`/${type}/${b}`, { append_to_response: append, include_video_language: 'pt,en,null' }), type);
    } else if (src === 'mal') {
      const full = await jikanGet(`/anime/${a}/full`);
      const recs = await jikanGet(`/anime/${a}/recommendations`).catch(() => null);
      d = malDetail(full?.data, recs);
    } else if (src === 'tvm') {
      d = tvmDetail(await tvmGet(`/shows/${a}?embed[]=cast&embed[]=seasons`));
    } else if (src === 'itn') {
      d = itnDetail((await itnGet(`/lookup?id=${a}&country=BR&lang=pt_br`))?.results?.[0]);
    }
    if (!d) throw err(404, 'Não encontrado');
    if (!d.trailers.length) d.trailers = await ytTrailer(d.original || d.title, d.year, d.kind);
    return d;
  });
}

// ---------- Pluto TV (via TMDB / JustWatch) ----------
// A Pluto TV não tem API pública nem player incorporável, e os Termos de
// Uso proíbem robôs nas páginas dela. Por isso o catálogo vem do TMDB
// (dados licenciados do JustWatch: "onde assistir" no Brasil) e o vídeo
// abre no site oficial. Índice leve em memória, renovado a cada 12 h, com
// filtros e busca locais (zero pedidos extras por filtro).
const PLUTO_TTL = 12 * H;
const PLUTO_MAX_PAGES = 60; // ~1.200 títulos por tipo (limite do índice)
const PLUTO_FALLBACK_ID = 300;
const LANG_NAMES = {
  pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', it: 'Italiano', de: 'Alemão', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês', cn: 'Cantonês',
  hi: 'Hindi', ru: 'Russo', tr: 'Turco', sv: 'Sueco', da: 'Dinamarquês', no: 'Norueguês', nl: 'Holandês', pl: 'Polonês', th: 'Tailandês', ar: 'Árabe', he: 'Hebraico', fi: 'Finlandês', tl: 'Filipino', id: 'Indonésio',
};
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const pluto = { movie: [], tv: [], at: 0, building: null, genres: {}, providerId: null };

async function plutoProviderId() {
  if (pluto.providerId) return pluto.providerId;
  try {
    const j = await tmdbGet('/watch/providers/movie', { watch_region: 'BR' });
    const p = (j.results || []).find((x) => /^pluto/i.test(x.provider_name || ''));
    pluto.providerId = p?.provider_id || PLUTO_FALLBACK_ID;
  } catch { return PLUTO_FALLBACK_ID; }
  return pluto.providerId;
}

async function loadGenres() {
  for (const type of ['movie', 'tv']) {
    try {
      const j = await tmdbGet(`/genre/${type}/list`);
      for (const g of j.genres || []) pluto.genres[g.id] = g.name;
    } catch { /* usa a tabela fixa */ }
  }
}

// Linha compacta do índice (só o necessário para cartões e filtros).
function plutoRow(r, type) {
  const c = tmdbCard(r, type);
  if (!c || !c.poster) return null;
  return {
    ...c, overview: clip(c.overview, 220), genreIds: r.genre_ids || [], lang: r.original_language || '',
    pop: r.popularity || 0, n: `${norm(c.title)} ${norm(c.original)}`,
  };
}

async function buildPluto() {
  const id = await plutoProviderId();
  if (!Object.keys(pluto.genres).length) await loadGenres();
  const next = { movie: [], tv: [] };
  for (const type of ['movie', 'tv']) {
    const seen = new Set();
    for (let page = 1; page <= PLUTO_MAX_PAGES; page++) {
      const j = await tmdbGet(`/discover/${type}`, { watch_region: 'BR', with_watch_providers: id, sort_by: 'popularity.desc', include_adult: 'false', page });
      for (const r of j.results || []) {
        const row = plutoRow(r, type);
        if (row && !seen.has(row.id)) { seen.add(row.id); next[type].push(row); }
      }
      // Primeira montagem: já libera o que tiver (carregamento progressivo).
      if (!pluto.at) { pluto[type] = next[type].slice(); pluto.onFirst?.(); }
      if (page >= (j.total_pages || 1)) break;
      await new Promise((r) => setTimeout(r, 120)); // gentil com a API
    }
  }
  pluto.movie = next.movie; pluto.tv = next.tv; pluto.at = Date.now();
}

function ensurePluto() {
  if (!hasTmdb()) return Promise.reject(err(503, 'TMDB não configurado'));
  const stale = Date.now() - pluto.at > PLUTO_TTL;
  if (stale && !pluto.building) {
    const first = new Promise((r) => { pluto.onFirst = r; });
    pluto.first = first;
    pluto.building = buildPluto().catch((e) => { if (!pluto.at) throw e; }).finally(() => { pluto.building = null; pluto.onFirst?.(); pluto.onFirst = null; });
    pluto.building.catch(() => {});
  }
  // Já tem índice (mesmo velho)? Responde na hora; a renovação segue em segundo plano.
  if (pluto.movie.length || pluto.tv.length) return Promise.resolve();
  // Primeira montagem: responde assim que a 1ª página chega.
  return pluto.building ? Promise.race([pluto.building, pluto.first]) : Promise.resolve();
}

const PLUTO_SORTS = {
  populares: (a, b) => b.pop - a.pop,
  recentes: (a, b) => String(b.date || '').localeCompare(String(a.date || '')),
  nota: (a, b) => (b.votes >= 30 ? b.rating || 0 : 0) - (a.votes >= 30 ? a.rating || 0 : 0) || b.pop - a.pop,
  titulo: (a, b) => a.title.localeCompare(b.title, 'pt-BR'),
};

function filterPluto({ type = 'all', yearFrom = 2001, yearTo, genre, lang, q, sort = 'populares' } = {}) {
  let rows = type === 'movie' ? pluto.movie : type === 'tv' ? pluto.tv : [...pluto.movie, ...pluto.tv];
  const yf = Number(yearFrom) || 0; const yt2 = Number(yearTo) || 0;
  const gName = genre ? pluto.genres[genre] || TMDB_GENRES[genre] : null;
  const words = norm(q).split(' ').filter(Boolean);
  rows = rows.filter((r) => (!yf || (r.year && r.year >= yf)) && (!yt2 || (r.year && r.year <= yt2))
    && (!genre || r.genreIds.includes(Number(genre)) || (gName && r.genreIds.some((g) => (pluto.genres[g] || TMDB_GENRES[g]) === gName)))
    && (!lang || r.lang === lang)
    && (!words.length || words.every((w) => r.n.includes(w))));
  return rows.slice().sort(PLUTO_SORTS[sort] || PLUTO_SORTS.populares);
}

async function plutoSearch(params = {}) {
  await ensurePluto();
  if (!pluto.movie.length && !pluto.tv.length && !pluto.building) throw err(502, 'Fontes indisponíveis');
  const page = Math.min(Math.max(1, Number(params.page) || 1), 200);
  const per = 24;
  const all = filterPluto(params);
  const items = all.slice((page - 1) * per, page * per).map(({ genreIds, lang, pop, n, ...c }) => ({ ...c, lang }));
  return { items, total: all.length, page, hasMore: all.length > page * per, building: !!pluto.building && !pluto.at, updatedAt: pluto.at || null };
}

async function plutoMeta() {
  if (!hasTmdb()) return { enabled: false };
  await ensurePluto();
  const all = [...pluto.movie, ...pluto.tv];
  const gCount = new Map(); const lCount = new Map();
  for (const r of all) {
    for (const g of r.genreIds) { const name = pluto.genres[g] || TMDB_GENRES[g]; if (name) gCount.set(name, { id: gCount.get(name)?.id || g, n: (gCount.get(name)?.n || 0) + 1 }); }
    if (r.lang) lCount.set(r.lang, (lCount.get(r.lang) || 0) + 1);
  }
  return {
    enabled: true,
    building: !!pluto.building && !pluto.at,
    updatedAt: pluto.at || null,
    counts: { movie: pluto.movie.length, tv: pluto.tv.length },
    genres: [...gCount.entries()].sort((a, b) => b[1].n - a[1].n).map(([name, v]) => ({ id: v.id, name, count: v.n })),
    langs: [...lCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([code, n]) => ({ code, name: LANG_NAMES[code] || code.toUpperCase(), count: n })),
  };
}

// Aquece o cache logo depois que o servidor sobe (a primeira pessoa que
// abrir Filmes e Séries não espera as fontes externas).
function warmUp() {
  if (process.env.NODE_ENV === 'test') return;
  const t = setTimeout(() => {
    home().catch(() => {});
    if (hasTmdb()) ensurePluto().catch(() => {});
  }, 15000);
  t.unref?.();
}

module.exports = {
  warmUp,
  home, list, lists, search, item, hasTmdb, plutoSearch, plutoMeta,
  _pluto: pluto, filterPluto, plutoRow,
  // puros (testes)
  tmdbList, tmdbDetail, malList, malDetail, tvmSchedule, tvmDetail, itnRss, itnCard, itnDetail, pickTrailers, pickProviders, ytIdFrom, safeText, ID_RE, LISTS,
};
