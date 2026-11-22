const crypto = require('crypto');
const prisma = require('../config/prisma');
const yt = require('./youtubeBrowse');
const creds = require('./voiceCredentials');

// Música (Atividades → Música): três serviços pra achar música —
// YouTube Music, Spotify e Last.fm. A música SEMPRE toca pelo YouTube (o
// mesmo player sincronizado da call e o player pessoal): Spotify e Last.fm
// servem pra buscar e pra puxar as playlists da pessoa; na hora de tocar o
// servidor acha a mesma música no YouTube (resolve()). Assim funciona pra
// todo mundo da call, sem precisar de Spotify Premium.
//
// Chaves (Painel da Equipe → Música, cofre criptografado de voiceCredentials):
//   SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET  (developer.spotify.com)
//   LASTFM_API_KEY                              (last.fm/api/account/create)
// Sem a chave, o serviço aparece como "não configurado".

const TIMEOUT_MS = 10000;
const PUBLIC_URL = () => (process.env.MUSIC_PUBLIC_URL || process.env.PUBLIC_URL || 'https://projectclub.shardweb.app').replace(/\/+$/, '');
const SPOTIFY_REDIRECT = () => `${PUBLIC_URL()}/api/music/spotify/callback`;
const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
const clean = (s, max = 200) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

function configured() {
  return {
    spotify: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    lastfm: !!process.env.LASTFM_API_KEY,
  };
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await resp.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!resp.ok) {
    const e = fail(resp.status === 401 ? 401 : 502, body?.error?.message || body?.message || `Serviço respondeu ${resp.status}`);
    e.upstream = resp.status;
    throw e;
  }
  return body;
}

// ---------------------------------------------------------------- Spotify

let appToken = null; // { token, exp }
async function spotifyAppToken() {
  if (!configured().spotify) throw fail(503, 'O Spotify ainda não foi configurado pela equipe.');
  if (appToken && appToken.exp > Date.now() + 30000) return appToken.token;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const d = await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  appToken = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return appToken.token;
}

function fromSpotifyTrack(t) {
  if (!t || !t.name) return null;
  const imgs = t.album?.images || [];
  return {
    source: 'spotify', id: t.id,
    title: clean(t.name), artist: clean((t.artists || []).map((a) => a.name).join(', '), 120),
    album: clean(t.album?.name || '', 120),
    thumbnail: (imgs[1] || imgs[0])?.url || null,
    durationSec: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
  };
}

async function spotifySearch(q) {
  const token = await spotifyAppToken();
  const d = await fetchJson(`https://api.spotify.com/v1/search?type=track&limit=25&market=BR&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` } });
  return (d.tracks?.items || []).map(fromSpotifyTrack).filter(Boolean);
}

// state do OAuth: userId + hora, assinado (HMAC) com o segredo do servidor.
function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  const mac = crypto.createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'projectclub-dev').update(`music:${payload}`).digest('base64url');
  return Buffer.from(`${payload}.${mac}`).toString('base64url');
}
function readState(state) {
  try {
    const [userId, ts, mac] = Buffer.from(String(state || ''), 'base64url').toString().split('.');
    const want = crypto.createHmac('sha256', process.env.JWT_ACCESS_SECRET || 'projectclub-dev').update(`music:${userId}.${ts}`).digest('base64url');
    if (!mac || mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    if (Date.now() - Number(ts) > 15 * 60 * 1000) return null;
    return userId;
  } catch { return null; }
}

function spotifyAuthUrl(userId) {
  if (!configured().spotify) throw fail(503, 'O Spotify ainda não foi configurado pela equipe.');
  const p = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT(),
    scope: SPOTIFY_SCOPES, state: signState(userId), show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${p}`;
}

const seal = (obj) => creds._encrypt(JSON.stringify(obj));
const unseal = (blob) => { try { return JSON.parse(creds._decrypt(blob)); } catch { return null; } };

async function spotifyTokenRequest(params) {
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  return fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

/** Volta do login do Spotify: troca o código pelos tokens e guarda. */
async function spotifyCallback(code, state) {
  const userId = readState(state);
  if (!userId) throw fail(400, 'O login do Spotify expirou. Tente conectar de novo.');
  const tok = await spotifyTokenRequest({ grant_type: 'authorization_code', code: String(code || ''), redirect_uri: SPOTIFY_REDIRECT() });
  const me = await fetchJson('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tok.access_token}` } }).catch(() => null);
  const data = seal({ access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 });
  const name = clean(me?.display_name || me?.id || 'Spotify', 120);
  await prisma.musicAccount.upsert({
    where: { userId_service: { userId, service: 'spotify' } },
    update: { externalName: name, data }, create: { userId, service: 'spotify', externalName: name, data },
  });
  return userId;
}

async function spotifyUserToken(userId) {
  const acc = await prisma.musicAccount.findUnique({ where: { userId_service: { userId, service: 'spotify' } } });
  const t = acc && unseal(acc.data);
  if (!t) throw fail(401, 'Conecte a sua conta do Spotify primeiro.');
  if (t.exp > Date.now() + 30000) return t.access;
  const r = await spotifyTokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  const next = { access: r.access_token, refresh: r.refresh_token || t.refresh, exp: Date.now() + (r.expires_in || 3600) * 1000 };
  await prisma.musicAccount.update({ where: { userId_service: { userId, service: 'spotify' } }, data: { data: seal(next) } });
  return next.access;
}

async function spotifyPlaylists(userId) {
  const token = await spotifyUserToken(userId);
  const d = await fetchJson('https://api.spotify.com/v1/me/playlists?limit=50', { headers: { Authorization: `Bearer ${token}` } });
  return [
    { id: 'liked', title: 'Músicas curtidas', thumbnail: null, count: null },
    ...(d.items || []).filter(Boolean).map((p) => ({ id: p.id, title: clean(p.name, 120), thumbnail: p.images?.[0]?.url || null, count: p.tracks?.total ?? null })),
  ];
}

async function spotifyPlaylistTracks(userId, playlistId) {
  const token = await spotifyUserToken(userId);
  if (playlistId === 'liked') {
    const d = await fetchJson('https://api.spotify.com/v1/me/tracks?limit=50&market=BR', { headers: { Authorization: `Bearer ${token}` } });
    return (d.items || []).map((i) => fromSpotifyTrack(i.track)).filter(Boolean);
  }
  if (!/^[A-Za-z0-9]{10,40}$/.test(playlistId)) throw fail(400, 'Playlist inválida.');
  const d = await fetchJson(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&market=BR`, { headers: { Authorization: `Bearer ${token}` } });
  return (d.items || []).map((i) => fromSpotifyTrack(i.track)).filter(Boolean);
}

// ---------------------------------------------------------------- Last.fm

async function lastfm(method, params = {}) {
  if (!configured().lastfm) throw fail(503, 'O Last.fm ainda não foi configurado pela equipe.');
  const p = new URLSearchParams({ method, api_key: process.env.LASTFM_API_KEY, format: 'json', ...params });
  const d = await fetchJson(`https://ws.audioscrobbler.com/2.0/?${p}`);
  if (d?.error) throw fail(d.error === 6 ? 404 : 502, d.message || 'O Last.fm não respondeu.');
  return d;
}

function fromLastfm(t) {
  if (!t?.name) return null;
  const artist = typeof t.artist === 'string' ? t.artist : (t.artist?.name || t.artist?.['#text'] || '');
  // As imagens do Last.fm costumam vir vazias (estrela cinza): o app usa a capa do YouTube.
  const img = (t.image || []).map((i) => i['#text']).filter((u) => u && !/2a96cbd8b46e442fc41c2b86b821562f/.test(u)).pop() || null;
  return { source: 'lastfm', id: `${artist}::${t.name}`, title: clean(t.name), artist: clean(artist, 120), thumbnail: img, durationSec: Number(t.duration) || null };
}

async function lastfmSearch(q) {
  const d = await lastfm('track.search', { track: q, limit: 25 });
  return (d.results?.trackmatches?.track || []).map(fromLastfm).filter(Boolean);
}
async function lastfmTop() {
  const d = await lastfm('geo.gettoptracks', { country: 'Brazil', limit: 30 });
  return (d.tracks?.track || []).map(fromLastfm).filter(Boolean);
}
async function lastfmConnect(userId, username) {
  const name = clean(String(username || '').replace(/^@/, ''), 60);
  if (!/^[A-Za-z][\w-]{1,30}$/.test(name)) throw fail(400, 'Nome de usuário do Last.fm inválido.');
  const d = await lastfm('user.getinfo', { user: name }).catch((e) => { if (e.status === 404) throw fail(404, 'Não achei esse usuário no Last.fm.'); throw e; });
  const real = clean(d.user?.name || name, 60);
  await prisma.musicAccount.upsert({
    where: { userId_service: { userId, service: 'lastfm' } },
    update: { externalName: real }, create: { userId, service: 'lastfm', externalName: real },
  });
  return real;
}
const LASTFM_LISTS = [
  { id: 'loved', title: 'Músicas amadas' },
  { id: 'top', title: 'Mais ouvidas do mês' },
  { id: 'recent', title: 'Ouvidas recentemente' },
];
async function lastfmList(userId, listId) {
  const acc = await prisma.musicAccount.findUnique({ where: { userId_service: { userId, service: 'lastfm' } } });
  if (!acc?.externalName) throw fail(401, 'Conecte o seu usuário do Last.fm primeiro.');
  const user = acc.externalName;
  if (listId === 'loved') return ((await lastfm('user.getlovedtracks', { user, limit: 50 })).lovedtracks?.track || []).map(fromLastfm).filter(Boolean);
  if (listId === 'top') return ((await lastfm('user.gettoptracks', { user, period: '1month', limit: 50 })).toptracks?.track || []).map(fromLastfm).filter(Boolean);
  if (listId === 'recent') {
    const seen = new Set();
    return ((await lastfm('user.getrecenttracks', { user, limit: 50 })).recenttracks?.track || []).map(fromLastfm).filter((t) => t && !seen.has(t.id) && seen.add(t.id));
  }
  throw fail(404, 'Lista não encontrada.');
}

// ---------------------------------------------------------------- YouTube (playlists coladas)

async function youtubeAccount(userId) {
  const acc = await prisma.musicAccount.findUnique({ where: { userId_service: { userId, service: 'youtube' } } });
  let lists = [];
  try { lists = JSON.parse(acc?.data || '[]'); } catch { lists = []; }
  return Array.isArray(lists) ? lists : [];
}
async function youtubeAddPlaylist(userId, url) {
  const id = yt.parsePlaylistId(url);
  if (!id) throw fail(400, 'Cole o link de uma playlist do YouTube ou do YouTube Music (com "list=" no endereço).');
  const p = await yt.playlist(id).catch(() => null);
  if (!p) throw fail(404, 'Não consegui abrir essa playlist. Ela precisa ser pública ou "não listada".');
  const lists = (await youtubeAccount(userId)).filter((l) => l.id !== id);
  lists.unshift({ id, title: clean(p.title, 120), count: p.videos.length, thumbnail: p.videos[0] ? `https://i.ytimg.com/vi/${p.videos[0].videoId}/mqdefault.jpg` : null });
  const data = JSON.stringify(lists.slice(0, 30));
  await prisma.musicAccount.upsert({ where: { userId_service: { userId, service: 'youtube' } }, update: { data }, create: { userId, service: 'youtube', data } });
  return lists[0];
}
async function youtubeRemovePlaylist(userId, id) {
  const lists = (await youtubeAccount(userId)).filter((l) => l.id !== id);
  await prisma.musicAccount.upsert({ where: { userId_service: { userId, service: 'youtube' } }, update: { data: JSON.stringify(lists) }, create: { userId, service: 'youtube', data: JSON.stringify(lists) } });
}
async function youtubePlaylistTracks(id) {
  const p = await yt.playlist(id);
  if (!p) throw fail(404, 'Playlist não encontrada.');
  return p.videos.map((v) => ({ source: 'youtube', id: v.videoId, videoId: v.videoId, title: v.title, artist: v.channel || '', thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, duration: v.duration || '' }));
}

// ---------------------------------------------------------------- tocar pelo YouTube

const resolveCache = new Map();
/** Acha no YouTube a mesma música (título + artista) pra tocar. */
async function resolve(title, artist) {
  const t = clean(title, 150); const a = clean(artist, 120);
  if (!t) throw fail(400, 'Música sem título.');
  const key = `${a.toLowerCase()}::${t.toLowerCase()}`;
  if (resolveCache.has(key)) return resolveCache.get(key);
  const { videos = [] } = await yt.search(`${a} ${t}`.trim()) || {};
  const pick = videos.find((v) => !v.live && v.videoId) || null;
  if (!pick) throw fail(404, 'Não achei essa música no YouTube.');
  const out = { videoId: pick.videoId, title: pick.title, channel: pick.channel || '', thumbnail: pick.thumbnail || `https://i.ytimg.com/vi/${pick.videoId}/mqdefault.jpg`, duration: pick.duration || '' };
  resolveCache.set(key, out);
  if (resolveCache.size > 3000) resolveCache.delete(resolveCache.keys().next().value);
  return out;
}

async function status(userId) {
  const accs = await prisma.musicAccount.findMany({ where: { userId } });
  const by = Object.fromEntries(accs.map((a) => [a.service, a]));
  const c = configured();
  let ytLists = [];
  try { ytLists = JSON.parse(by.youtube?.data || '[]'); } catch { ytLists = []; }
  return {
    youtube: { configured: true, connected: ytLists.length > 0, playlists: ytLists },
    spotify: { configured: c.spotify, connected: !!by.spotify, name: by.spotify?.externalName || null },
    lastfm: { configured: c.lastfm, connected: !!by.lastfm, name: by.lastfm?.externalName || null, lists: by.lastfm ? LASTFM_LISTS : [] },
  };
}

async function disconnect(userId, service) {
  if (!['spotify', 'lastfm', 'youtube'].includes(service)) throw fail(400, 'Serviço inválido.');
  await prisma.musicAccount.deleteMany({ where: { userId, service } });
}

module.exports = {
  configured, status, disconnect, resolve,
  spotifySearch, spotifyAuthUrl, spotifyCallback, spotifyPlaylists, spotifyPlaylistTracks,
  lastfmSearch, lastfmTop, lastfmConnect, lastfmList, LASTFM_LISTS,
  youtubeAddPlaylist, youtubeRemovePlaylist, youtubePlaylistTracks,
  // testes
  signState, readState, fromSpotifyTrack, fromLastfm, SPOTIFY_REDIRECT,
};
