// Baú da call (engajamento): de vez em quando, numa call com 2+ pessoas de
// verdade, aparece um baú. Quem abrir primeiro leva moedas (e às vezes
// gemas). Nada é obrigatório: quem não liga pra economia só ignora.
//
// - Sorteio feito pelo contador de minutos (missions.startVoiceMinutesTicker),
//   uma vez por minuto por sala, com a mesma lista de "quem está mesmo na call".
// - Em média um baú a cada ~25 min de call por sala, nunca dois em menos de
//   COOLDOWN_MS, e cada pessoa abre no máximo DAILY_CLAIMS por dia.
// - O baú fica aberto por TTL_MS; depois some sozinho.
// - Respeita a Economia desligada pela staff.
// Fica em memória: o app roda numa instância só, e um baú perdido num
// reinício não faz falta a ninguém.
const crypto = require('crypto');

const SPAWN_CHANCE = 1 / 25;
const COOLDOWN_MS = 12 * 60_000;
const TTL_MS = 60_000;
const DAILY_CLAIMS = 6;
const COINS_MIN = 15;
const COINS_MAX = 40;
const GEM_CHANCE = 0.12;
const TIME_ZONE = 'America/Sao_Paulo';

const active = new Map(); // channelId -> { id, channelId, expiresAt, timer }
const lastSpawn = new Map(); // channelId -> timestamp
const claimsToday = new Map(); // `${day}:${userId}` -> n
let claimsDay = null;

function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function rollReward(rand = Math.random) {
  const coins = COINS_MIN + Math.floor(rand() * (COINS_MAX - COINS_MIN + 1));
  const gems = rand() < GEM_CHANCE ? 1 + Math.floor(rand() * 2) : 0;
  return { coins, gems };
}

function publicChest(c) {
  return c ? { id: c.id, channelId: c.channelId, expiresAt: c.expiresAt } : null;
}

function get(channelId) {
  const c = active.get(channelId);
  if (!c) return null;
  if (c.expiresAt <= Date.now()) { clear(channelId); return null; }
  return publicChest(c);
}

function clear(channelId) {
  const c = active.get(channelId);
  if (c?.timer) clearTimeout(c.timer);
  active.delete(channelId);
}

function spawn(io, channelId, { now = Date.now() } = {}) {
  const chest = { id: crypto.randomUUID(), channelId, expiresAt: now + TTL_MS };
  chest.timer = setTimeout(() => {
    if (active.get(channelId)?.id !== chest.id) return;
    active.delete(channelId);
    io?.to?.(`voice:${channelId}`).emit('voice:chest-gone', { channelId, id: chest.id });
  }, TTL_MS);
  chest.timer.unref?.();
  active.set(channelId, chest);
  lastSpawn.set(channelId, now);
  io?.to?.(`voice:${channelId}`).emit('voice:chest', publicChest(chest));
  return publicChest(chest);
}

/**
 * Chamado a cada minuto pelo contador de voz. `rooms` = Map(channelId ->
 * quantas pessoas contam de verdade naquela sala).
 */
async function tick(rooms, io, { prisma = require('../config/prisma'), rand = Math.random, now = Date.now() } = {}) {
  if (!rooms?.size) return [];
  if (await require('./voiceRewards').economyDisabled(prisma)) return [];
  const spawned = [];
  for (const [channelId, count] of rooms) {
    if (count < 2) continue;
    if (String(channelId).startsWith('praca:')) continue;
    if (get(channelId)) continue;
    if (now - (lastSpawn.get(channelId) || 0) < COOLDOWN_MS) continue;
    if (rand() >= SPAWN_CHANCE) continue;
    spawned.push(spawn(io, channelId, { now }));
  }
  return spawned;
}

function claimsLeft(userId, now = new Date()) {
  const day = dayKey(now);
  if (claimsDay !== day) { claimsToday.clear(); claimsDay = day; }
  return DAILY_CLAIMS - (claimsToday.get(`${day}:${userId}`) || 0);
}

/**
 * Tenta abrir o baú. O primeiro leva; o JS roda um evento por vez, então
 * "tirar do Map e só depois pagar" já garante que ninguém recebe duas vezes.
 */
async function claim(io, { channelId, chestId, userId }, {
  prisma = require('../config/prisma'), awardXp = require('./xp').awardXp, rand = Math.random, now = new Date(),
  ledger = null,
} = {}) {
  const c = active.get(channelId);
  if (!c || c.id !== chestId || c.expiresAt <= now.getTime()) return { ok: false, reason: 'Esse baú já foi aberto ou sumiu.' };
  if (claimsLeft(userId, now) <= 0) return { ok: false, reason: `Você já abriu ${DAILY_CLAIMS} baús hoje. Deixe esse pra galera!` };
  clear(channelId);
  const day = dayKey(now);
  claimsToday.set(`${day}:${userId}`, (claimsToday.get(`${day}:${userId}`) || 0) + 1);
  const reward = rollReward(rand);
  await awardXp(userId, 0, { coins: reward.coins, kind: 'CALL_CHEST', label: 'Baú da call' });
  if (reward.gems) {
    await prisma.user.update({ where: { id: userId }, data: { gems: { increment: reward.gems } } });
    (ledger || require('./economyLedger')).recordTransaction(userId, { kind: 'CALL_CHEST', label: 'Baú da call (gemas)', gems: reward.gems });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, displayName: true, avatarUrl: true } }).catch(() => null);
  io?.to?.(`voice:${channelId}`).emit('voice:chest-claimed', { channelId, id: chestId, user, ...reward });
  return { ok: true, ...reward, claimsLeft: claimsLeft(userId, now) };
}

module.exports = {
  tick, claim, get, spawn, rollReward,
  SPAWN_CHANCE, COOLDOWN_MS, TTL_MS, DAILY_CLAIMS,
  _test: { reset: () => { for (const id of [...active.keys()]) clear(id); lastSpawn.clear(); claimsToday.clear(); claimsDay = null; } },
};
