// Rádio do Project Club (item "Rádio do Project Club").
//
// A equipe marca um canal de voz como rádio e cola os links do YouTube.
// Quando a primeira pessoa entra, a rádio começa a tocar (modo música do
// "Assistir juntos", sincronizado pra todo mundo); ao acabar a lista, volta
// do começo (embaralhando de novo se "aleatório" estiver ligado). Na rádio só
// quem gerencia o canal pode pular/pausar.
const MAX_TRACKS = 200;
const getPrisma = () => require('../config/prisma');

function parsePlaylist(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((t) => t && typeof t.videoId === 'string') : [];
  } catch { return []; }
}

function shuffled(list, rnd = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Ordem de uma volta da rádio. `avoidFirst` evita repetir a música que acabou de tocar. */
function nextRound(station, { avoidFirst = null, rnd = Math.random } = {}) {
  const list = parsePlaylist(station?.playlist);
  if (!list.length) return [];
  let order = station.shuffle ? shuffled(list, rnd) : list.slice();
  if (avoidFirst && order.length > 1 && order[0].videoId === avoidFirst) order = [...order.slice(1), order[0]];
  return order.map((t) => ({ videoId: t.videoId, title: t.title || null, addedBy: null }));
}

async function getStation(channelId, { db = getPrisma() } = {}) {
  if (!channelId || String(channelId).includes(':')) return null;
  return db.radioStation.findUnique({ where: { channelId: String(channelId) } }).catch(() => null);
}

async function fetchTitle(videoId, { fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.title === 'string' ? j.title.slice(0, 200) : null;
  } catch { return null; }
}

/** Salva a rádio a partir do texto (um link por linha). */
async function saveStation(channelId, { links, enabled = true, shuffle = true }, userId, { db = getPrisma(), parseVideoId, fetchImpl } = {}) {
  const seen = new Set();
  const ids = [];
  for (const line of String(links || '').split(/[\s,]+/)) {
    const id = parseVideoId(line);
    if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    if (ids.length >= MAX_TRACKS) break;
  }
  const old = parsePlaylist((await getStation(channelId, { db }))?.playlist);
  const known = new Map(old.map((t) => [t.videoId, t.title]));
  const playlist = [];
  for (const videoId of ids) {
    // eslint-disable-next-line no-await-in-loop
    playlist.push({ videoId, title: known.get(videoId) || await fetchTitle(videoId, { fetchImpl }) });
  }
  const data = { enabled: !!enabled && playlist.length > 0, shuffle: !!shuffle, playlist: JSON.stringify(playlist), updatedBy: userId || null };
  return db.radioStation.upsert({ where: { channelId }, create: { channelId, ...data }, update: data });
}

module.exports = { parsePlaylist, nextRound, shuffled, getStation, saveStation, fetchTitle, MAX_TRACKS };
