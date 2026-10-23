// Biblioteca de jogos (tempo de jogo, estilo Steam).
//
// De onde vem: o app de desktop já manda 'activity:update' pelo socket
// enquanto um jogo roda (reconfirma a cada ~6s — ver
// client/src/utils/nativeActivity.js). Cada aviso vira um "batimento"
// aqui: soma o tempo desde o batimento anterior (com teto, pra um buraco
// grande — PC suspenso, queda de rede — nunca virar horas fantasmas).
//
// Robustez:
//  - Estado da sessão em andamento fica no Redis (sobrevive a reinício do
//    servidor); se o Redis cair, usa um Map em memória.
//  - O tempo acumulado vai pro banco em lotes (a cada ~60s de jogo) e
//    sempre no fim da sessão — nunca uma escrita a cada batimento.
//  - Uma varredura a cada 30s fecha sessões sem batimento há mais de
//    STALE_MS (app fechou de repente, servidor reiniciou etc).
//  - Batimentos do mesmo usuário são processados em fila (sem corrida).
const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { redis } = require('../config/redis');
const steamArt = require('./steamArtService');

const MAX_GAP_MS = 30 * 1000; // maior intervalo creditado entre dois batimentos
const STALE_MS = 45 * 1000; // sem batimento há mais que isso = sessão encerrada
const NEW_SESSION_GAP_MS = 10 * 60 * 1000; // mesmo jogo depois de 10min parado = sessão nova
const FLUSH_EVERY_S = 60;
const ACTIVE_SET = 'gameplay:active';
const keyFor = (userId) => `gameplay:${userId}`;

const memory = new Map(); // fallback se o Redis falhar
async function loadState(userId) {
  try {
    const raw = await redis.get(keyFor(userId));
    return raw ? JSON.parse(raw) : (memory.get(userId) || null);
  } catch { return memory.get(userId) || null; }
}
async function saveState(userId, state) {
  memory.set(userId, state);
  try {
    // Expira sozinho bem depois do STALE_MS — a varredura fecha antes.
    await redis.set(keyFor(userId), JSON.stringify(state), 'EX', 6 * 60 * 60);
    await redis.sadd(ACTIVE_SET, userId);
  } catch { /* fica só em memória */ }
}
async function dropState(userId) {
  memory.delete(userId);
  try { await redis.del(keyFor(userId)); await redis.srem(ACTIVE_SET, userId); } catch { /* ignora */ }
}

// Nome -> chave estável ("Counter-Strike 2" -> "counter-strike-2").
function gameKeyFor(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// App ID da Steam a partir do link da capa que o desktop manda
// (cdn.../steam/apps/<id>/header.jpg) ou do nosso proxy (/api/proxy/steam/<id>/...).
function steamAppIdFrom(url) {
  const m = /\/steam\/apps\/(\d{1,9})\//.exec(url || '') || /\/api\/proxy\/steam\/(\d{1,9})\//.exec(url || '');
  const id = m ? Number(m[1]) : null;
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Só aceita jogo: { name, imageUrl? }. Spotify/apps nunca chegam aqui.
function normalizeGame(game) {
  if (!game || typeof game !== 'object') return null;
  const name = String(game.name || '').trim().slice(0, 120);
  const gameKey = gameKeyFor(name);
  if (!name || !gameKey) return null;
  const img = typeof game.imageUrl === 'string' && /^https?:\/\//.test(game.imageUrl) && game.imageUrl.length <= 500 ? game.imageUrl : null;
  const direct = Number(game.steamAppId);
  const steamAppId = Number.isInteger(direct) && direct > 0 && direct < 100000000 ? direct : steamAppIdFrom(game.imageUrl);
  return { gameKey, name, steamAppId, iconUrl: img };
}

// Jogo sem App ID: descobre pelo nome (cacheado) e grava na linha da
// pessoa — a capa passa a aparecer na biblioteca/perfil. Nunca lança.
async function fillSteamAppId(userId, gameKey, name) {
  try {
    const appId = await steamArt.findAppIdByName(name);
    if (!appId) return null;
    await prisma.gamePlaytime.updateMany({ where: { userId, gameKey, steamAppId: null }, data: { steamAppId: appId } });
    return appId;
  } catch { return null; }
}

async function startSession(userId, game, now) {
  if (!game.steamAppId) fillSteamAppId(userId, game.gameKey, game.name);
  await safeUpsert(prisma.gamePlaytime, {
    where: { userId_gameKey: { userId, gameKey: game.gameKey } },
    create: { userId, gameKey: game.gameKey, name: game.name, steamAppId: game.steamAppId, iconUrl: game.iconUrl, sessions: 1, firstPlayedAt: new Date(now), lastPlayedAt: new Date(now) },
    update: {
      name: game.name, sessions: { increment: 1 }, lastPlayedAt: new Date(now),
      ...(game.steamAppId ? { steamAppId: game.steamAppId } : {}),
      ...(game.iconUrl ? { iconUrl: game.iconUrl } : {}),
    },
  });
}

// Gráfico "horas por semana": soma os segundos também por dia (fuso de
// Brasília). Best-effort — se falhar, o total do jogo já foi gravado.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function dayKey(ms) { return DAY_FMT.format(new Date(ms)); }
function addDaySeconds(userId, gameKey, seconds, now) {
  if (!(seconds > 0)) return;
  const day = dayKey(now);
  safeUpsert(prisma.gamePlayDay, {
    where: { userId_gameKey_day: { userId, gameKey, day } },
    create: { userId, gameKey, day, seconds },
    update: { seconds: { increment: seconds } },
  }).catch(() => {});
}

async function flush(userId, state, now) {
  const seconds = Math.floor(state.pendingMs / 1000);
  if (seconds <= 0) return;
  await prisma.gamePlaytime.updateMany({
    where: { userId, gameKey: state.gameKey },
    data: { totalSeconds: { increment: seconds }, lastPlayedAt: new Date(now) },
  });
  state.pendingMs -= seconds * 1000;
  addDaySeconds(userId, state.gameKey, seconds, now);
}

async function endSession(userId, state, now) {
  state.pendingMs += Math.max(0, Math.min(now - state.lastBeatAt, MAX_GAP_MS));
  state.lastBeatAt = now;
  await flush(userId, state, now);
  await dropState(userId);
}

async function handleBeat(userId, rawGame, now = Date.now()) {
  const game = normalizeGame(rawGame);
  let state = await loadState(userId);

  if (state && (!game || state.gameKey !== game.gameKey || now - state.lastBeatAt > NEW_SESSION_GAP_MS)) {
    // Parou de jogar, trocou de jogo, ou ficou tempo demais sem aviso.
    const credit = now - state.lastBeatAt > STALE_MS ? state.lastBeatAt : now;
    await endSession(userId, state, credit);
    state = null;
  }
  if (!game) return;

  if (!state) {
    await startSession(userId, game, now);
    await saveState(userId, { ...game, startedAt: now, lastBeatAt: now, pendingMs: 0 });
    return;
  }
  state.pendingMs += Math.max(0, Math.min(now - state.lastBeatAt, MAX_GAP_MS));
  state.lastBeatAt = now;
  if (state.pendingMs >= FLUSH_EVERY_S * 1000) await flush(userId, state, now);
  await saveState(userId, state);
}

// Fila por usuário — dois avisos quase juntos nunca leem o mesmo estado.
const queues = new Map();
function enqueue(userId, fn) {
  const prev = queues.get(userId) || Promise.resolve();
  const next = prev.then(fn).catch((err) => console.error('[gamePlaytime] falhou:', err.message));
  queues.set(userId, next);
  next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); });
  return next;
}

// Chamado pelo socket a cada 'activity:update' (game = jogo rodando, ou null).
function recordBeat(userId, game) {
  if (!userId) return Promise.resolve();
  return enqueue(userId, () => handleBeat(userId, game));
}

// Socket caiu (último dispositivo): grava o que já foi acumulado, mas não
// fecha a sessão — se o app reconectar logo, continua a mesma sessão; se
// não, a varredura fecha.
function flushUser(userId) {
  return enqueue(userId, async () => {
    const state = await loadState(userId);
    if (!state) return;
    await flush(userId, state, state.lastBeatAt);
    await saveState(userId, state);
  });
}

async function sweep(now = Date.now()) {
  let ids = [];
  try { ids = await redis.smembers(ACTIVE_SET); } catch { /* sem Redis */ }
  ids = Array.from(new Set([...ids, ...memory.keys()]));
  for (const userId of ids) {
    await enqueue(userId, async () => {
      const state = await loadState(userId);
      if (!state) { await dropState(userId); return; }
      if (now - state.lastBeatAt > STALE_MS) await endSession(userId, state, state.lastBeatAt);
    });
  }
}

let sweepTimer = null;
function startSweeper() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => { sweep().catch(() => {}); }, 30 * 1000);
  sweepTimer.unref?.();
  sweep().catch(() => {}); // fecha o que ficou aberto antes de um reinício
}

// Sessão em andamento (pra "Jogando agora" e somar o tempo ainda não gravado).
async function getLiveSession(userId, now = Date.now()) {
  const state = await loadState(userId);
  if (!state || now - state.lastBeatAt > STALE_MS) return null;
  return state;
}

module.exports = { dayKey, recordBeat, flushUser, sweep, startSweeper, getLiveSession, gameKeyFor, steamAppIdFrom, normalizeGame, fillSteamAppId, MAX_GAP_MS, STALE_MS };
