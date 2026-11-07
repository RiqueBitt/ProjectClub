// Rich presence pros apps do ecossistema (ProjectMC, CanvasProject...) e
// qualquer integração: em vez de depender do detector de processos do app
// de desktop, o próprio app avisa o que a pessoa está fazendo:
//
//   POST   /api/activity/presence  { type:'app'|'game', name, detail?, imageUrl?, startedAt?, ttlSeconds? }
//   DELETE /api/activity/presence
//
// Mesma sanitização e mesmo broadcast do socket 'activity:update' (quem vê
// é decidido pelas configurações de privacidade da pessoa). O app manda de
// novo antes de `ttlSeconds` (padrão 60s, máx. 300) pra manter — se fechar
// sem avisar, some sozinho.
const { redis } = require('../config/redis');
const activityStore = require('./activityStore');
const gamePlaytime = require('./gamePlaytime');

const DEFAULT_TTL = 60;
const MAX_TTL = 300;

function sanitize(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const name = String(activity.name || '').trim().slice(0, 120);
  if (!name) return null;
  const imageUrl = typeof activity.imageUrl === 'string' && /^(https?:\/\/|\/)/.test(activity.imageUrl) ? activity.imageUrl.slice(0, 2000) : undefined;
  return {
    type: activity.type === 'game' ? 'game' : 'app',
    name,
    detail: activity.detail ? String(activity.detail).slice(0, 120) : undefined,
    imageUrl,
    startedAt: Number.isFinite(Number(activity.startedAt)) ? Number(activity.startedAt) : Date.now(),
    source: 'api',
  };
}

async function setPresence(io, userId, body) {
  const clean = sanitize(body);
  if (!clean) { const e = new Error('Informe pelo menos o nome do app/jogo.'); e.status = 400; throw e; }
  const ttl = Math.max(5, Math.min(MAX_TTL, Number(body.ttlSeconds) || DEFAULT_TTL));
  const { broadcastActivityChange, sameActivity } = require('../sockets');
  const prev = await activityStore.getActivity(userId).catch(() => null);
  if (clean.type === 'game') gamePlaytime.recordBeat(userId, clean);
  // TTL maior que o do socket: grava direto com a validade pedida.
  await redis.set(`activity:${userId}`, JSON.stringify(prev && sameActivity(prev, clean) ? { ...prev, startedAt: prev.startedAt } : clean), 'EX', ttl);
  if (!prev || !sameActivity(prev, clean)) await broadcastActivityChange(io, userId, clean);
  return { ok: true, ttlSeconds: ttl, activity: clean };
}

async function clearPresence(io, userId) {
  const { broadcastActivityChange } = require('../sockets');
  gamePlaytime.recordBeat(userId, null);
  await activityStore.clearActivity(userId);
  await broadcastActivityChange(io, userId, null);
  return { ok: true };
}

module.exports = { sanitize, setPresence, clearPresence, DEFAULT_TTL, MAX_TTL };
