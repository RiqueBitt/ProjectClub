// XP e moedas por tempo em call (item "XP e moedas por tempo em call").
//
// O contador de minutos das missões (missions.startVoiceMinutesTicker) já
// sabe quem está de verdade numa call: sala com 2+ pessoas, sem ensurdecer e
// com a conexão viva. A cada minuto ele passa essa lista pra cá:
//   - a cada BLOCK_MIN minutos seguidos de call no dia → +XP e +moedas;
//   - teto diário (DAILY_CAP_MIN) pra ninguém "farmar" deixando o PC ligado;
//   - nada disso vale se a staff desligou a Economia.
// O total do dia fica no Redis (chave por dia de Brasília, some em 2 dias);
// sem Redis, um Map em memória (uma instância só).
const BLOCK_MIN = 5;
const XP_PER_BLOCK = 15;
const COINS_PER_BLOCK = 3;
const DAILY_CAP_MIN = 180; // 3 h/dia contam → até 540 XP e 108 moedas
const TIME_ZONE = 'America/Sao_Paulo';

const mem = new Map();
let memDay = null;

function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function getRedis() {
  try { const { redis } = require('../config/redis'); return redis && redis.status === 'ready' ? redis : null; } catch { return null; }
}

async function bumpMinute(uid, { redis = getRedis(), now = new Date() } = {}) {
  const day = dayKey(now);
  if (redis) {
    try {
      const key = `voicexp:${day}:${uid}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, 2 * 86400);
      return n;
    } catch { /* cai na memória */ }
  }
  if (memDay !== day) { mem.clear(); memDay = day; }
  const n = (mem.get(uid) || 0) + 1;
  mem.set(uid, n);
  return n;
}

/** Quanto ganha no minuto `n` do dia (0 quando não fecha bloco ou passou do teto). */
function rewardFor(n) {
  if (n <= 0 || n > DAILY_CAP_MIN || n % BLOCK_MIN !== 0) return null;
  return { xp: XP_PER_BLOCK, coins: COINS_PER_BLOCK };
}

let economyOffCache = { at: 0, off: false };
async function economyDisabled(prisma) {
  if (Date.now() - economyOffCache.at < 60_000) return economyOffCache.off;
  let off = false;
  try {
    const s = await prisma.platformSettings.findUnique({ where: { id: 'singleton' }, select: { disabledSystems: true } });
    off = JSON.parse(s?.disabledSystems || '[]').includes('economia');
  } catch { off = false; }
  economyOffCache = { at: Date.now(), off };
  return off;
}

async function tick(uids, io, {
  prisma = require('../config/prisma'), awardXp = require('./xp').awardXp, redis = getRedis(), now = new Date(),
} = {}) {
  if (!uids?.size && !uids?.length) return [];
  if (await economyDisabled(prisma)) return [];
  const paid = [];
  for (const uid of uids) {
    // eslint-disable-next-line no-await-in-loop
    const n = await bumpMinute(uid, { redis, now });
    const r = rewardFor(n);
    if (!r) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await awardXp(uid, r.xp, { coins: r.coins, kind: 'VOICE', label: `${BLOCK_MIN} min em call` });
      paid.push(uid);
      io?.notifyUser?.(uid, 'economy:voice-reward', { xp: res?.xp ?? r.xp, coins: r.coins, minutesToday: n, capMinutes: DAILY_CAP_MIN });
      if (res?.levelUp) io?.notifyUser?.(uid, 'xp:levelup', res);
    } catch (err) {
      console.error('[voz-xp] falhou ao pagar:', err?.message || err);
    }
  }
  return paid;
}

async function minutesToday(uid, { redis = getRedis(), now = new Date() } = {}) {
  const day = dayKey(now);
  if (redis) { try { return Number(await redis.get(`voicexp:${day}:${uid}`)) || 0; } catch { /* memória */ } }
  return memDay === day ? (mem.get(uid) || 0) : 0;
}

function _resetForTests() { mem.clear(); memDay = null; economyOffCache = { at: 0, off: false }; }

module.exports = { tick, rewardFor, minutesToday, dayKey, BLOCK_MIN, XP_PER_BLOCK, COINS_PER_BLOCK, DAILY_CAP_MIN, _resetForTests };
