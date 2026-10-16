const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { calculateLevel } = require('../data/levelsCatalog');
const { recordTransaction } = require('./economyLedger');

// ============================================================
// Missões diárias e semanais.
// O progresso é contado no servidor a partir de eventos que já existem
// (mensagem enviada, reação, minutos em call, post/comentário no Fórum,
// baú diário, visita à Loja). Cada linha de UserMissionProgress é de UM
// período (periodKey), então "resetar" é só mudar de chave: nada é
// apagado e não precisa de tarefa agendada pra zerar.
// ============================================================

// Fuso fixo da comunidade. O Brasil não tem mais horário de verão desde
// 2019, então meia-noite em São Paulo = 03:00 UTC (usado só pra calcular
// o horário do próximo reset; a DATA vem do Intl com o fuso certo).
const TIME_ZONE = 'America/Sao_Paulo';
const SP_OFFSET_HOURS = 3;

const MISSION_TYPES = {
  MESSAGES: { label: 'Mensagens nos canais', unit: 'mensagens' },
  REACTIONS: { label: 'Reações em mensagens', unit: 'reações' },
  VOICE_MINUTES: { label: 'Minutos em call', unit: 'min' },
  FORUM_POSTS: { label: 'Posts no Fórum', unit: 'posts' },
  FORUM_COMMENTS: { label: 'Comentários no Fórum', unit: 'comentários' },
  SHOP_VISIT: { label: 'Visitar a Loja', unit: 'visita' },
  DAILY_CHEST: { label: 'Resgatar o baú diário', unit: 'baú' },
  CARDS_PLAY: { label: 'Guerra das Cartas: jogar partidas', unit: 'partidas' },
  CARDS_WIN: { label: 'Guerra das Cartas: vencer partidas', unit: 'vitórias' },
  CARDS_PVP_WIN: { label: 'Guerra das Cartas: vencer jogadores (PvP)', unit: 'vitórias' },
  CARDS_PACK: { label: 'Guerra das Cartas: abrir pacotes', unit: 'pacotes' },
  CARDS_TRADE: { label: 'Guerra das Cartas: concluir trocas ou vendas', unit: 'trocas' },
};
const PERIODS = ['DAILY', 'WEEKLY'];
// Únicos tipos que o próprio cliente pode avisar (o resto vem de eventos do servidor).
const CLIENT_TRACKABLE = new Set(['SHOP_VISIT']);

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

// { y, m, d } da data em São Paulo.
function spDate(now = new Date()) {
  const parts = Object.fromEntries(dateFmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}
const iso = (dt) => dt.toISOString().slice(0, 10);

function dayKey(now = new Date()) {
  const { y, m, d } = spDate(now);
  return `D${iso(new Date(Date.UTC(y, m - 1, d)))}`;
}

// Semana começa na segunda-feira (chave = data da segunda).
function weekKey(now = new Date()) {
  const { y, m, d } = spDate(now);
  const base = new Date(Date.UTC(y, m - 1, d));
  const offset = (base.getUTCDay() + 6) % 7; // seg=0 ... dom=6
  base.setUTCDate(base.getUTCDate() - offset);
  return `W${iso(base)}`;
}

function periodKey(period, now = new Date()) {
  return period === 'WEEKLY' ? weekKey(now) : dayKey(now);
}

// Próximos resets (instantes UTC) — mostrados como contagem regressiva.
function nextResets(now = new Date()) {
  const { y, m, d } = spDate(now);
  const daily = new Date(Date.UTC(y, m - 1, d + 1, SP_OFFSET_HOURS));
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const weekly = new Date(Date.UTC(y, m - 1, d + (7 - wd), SP_OFFSET_HOURS));
  return { daily: daily.toISOString(), weekly: weekly.toISOString() };
}

// Missões padrão — criadas só se a tabela estiver vazia (a staff edita
// tudo depois em Admin → Economia → Missões).
const DEFAULT_MISSIONS = [
  { period: 'DAILY', type: 'MESSAGES', title: 'Bate-papo do dia', description: 'Mande 10 mensagens nos canais da comunidade.', target: 10, rewardCoins: 30, rewardXp: 20 },
  { period: 'DAILY', type: 'REACTIONS', title: 'Deixe sua reação', description: 'Reaja a 5 mensagens.', target: 5, rewardCoins: 15 },
  { period: 'DAILY', type: 'VOICE_MINUTES', title: 'Hora da call', description: 'Fique 15 minutos em call com outras pessoas.', target: 15, rewardCoins: 30, rewardXp: 20 },
  { period: 'DAILY', type: 'DAILY_CHEST', title: 'Baú do dia', description: 'Resgate o baú diário.', target: 1, rewardCoins: 10 },
  { period: 'DAILY', type: 'SHOP_VISIT', title: 'Dar uma olhada', description: 'Visite a Loja.', target: 1, rewardCoins: 10 },
  { period: 'WEEKLY', type: 'MESSAGES', title: 'Conversador da semana', description: 'Mande 100 mensagens nos canais.', target: 100, rewardCoins: 200, rewardGems: 1, rewardXp: 100 },
  { period: 'WEEKLY', type: 'VOICE_MINUTES', title: 'Maratona de call', description: 'Fique 120 minutos em call durante a semana.', target: 120, rewardCoins: 250, rewardGems: 1, rewardXp: 100 },
  { period: 'WEEKLY', type: 'FORUM_POSTS', title: 'Voz no Fórum', description: 'Publique 2 posts no Fórum.', target: 2, rewardCoins: 100, rewardXp: 50 },
  { period: 'WEEKLY', type: 'FORUM_COMMENTS', title: 'Bom de papo', description: 'Comente 5 vezes no Fórum.', target: 5, rewardCoins: 80 },
];

// Missões da Guerra das Cartas — entram uma vez, mesmo em bancos que já
// tinham missões (a staff edita/desativa depois).
const CARDS_MISSIONS = [
  { period: 'DAILY', type: 'CARDS_PLAY', title: 'Duelista do dia', description: 'Jogue 3 partidas na Guerra das Cartas.', target: 3, rewardCoins: 40, rewardXp: 20 },
  { period: 'DAILY', type: 'CARDS_WIN', title: 'Primeira vitória', description: 'Vença 1 partida na Guerra das Cartas.', target: 1, rewardCoins: 30 },
  { period: 'DAILY', type: 'CARDS_PACK', title: 'Novas cartas', description: 'Abra 1 pacote de cartas.', target: 1, rewardCoins: 20 },
  { period: 'WEEKLY', type: 'CARDS_WIN', title: 'Campeão da semana', description: 'Vença 15 partidas na Guerra das Cartas.', target: 15, rewardCoins: 300, rewardGems: 2, rewardXp: 100 },
  { period: 'WEEKLY', type: 'CARDS_PVP_WIN', title: 'Rei da Guerra', description: 'Vença 5 partidas contra outros jogadores.', target: 5, rewardCoins: 250, rewardGems: 2, rewardXp: 80 },
  { period: 'WEEKLY', type: 'CARDS_TRADE', title: 'Negociante', description: 'Conclua 2 trocas ou vendas no mercado.', target: 2, rewardCoins: 120 },
];

async function seedDefaultMissions() {
  const count = await prisma.mission.count();
  if (count === 0) await prisma.mission.createMany({ data: DEFAULT_MISSIONS.map((m, i) => ({ ...m, position: i })) });
  const hasCards = await prisma.mission.count({ where: { type: { in: CARDS_MISSIONS.map((m) => m.type) } } });
  if (hasCards === 0) {
    const base = await prisma.mission.count();
    await prisma.mission.createMany({ data: CARDS_MISSIONS.map((m, i) => ({ ...m, position: base + i })) });
    invalidateCache();
  }
}

// Cache curto das missões ativas — evita ler a tabela a cada mensagem.
let cache = { at: 0, list: null };
const CACHE_MS = 60 * 1000;
function invalidateCache() { cache = { at: 0, list: null }; }
async function getActiveMissions() {
  if (cache.list && Date.now() - cache.at < CACHE_MS) return cache.list;
  let list = await prisma.mission.findMany({ where: { enabled: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  // Guerra das Cartas desligada (config/features.js): missões CARDS_* não
  // dá pra cumprir, então saem da lista (continuam salvas no banco).
  if (!require('../config/features').isFeatureEnabled('cardsWar')) list = list.filter((m) => !String(m.type || '').startsWith('CARDS_'));
  cache = { at: Date.now(), list };
  return list;
}

// Dedupe de "já concluída neste período" e de reações: Redis com TTL até
// o fim do período (vale entre instâncias e sobrevive a restart), com a
// memória local como cache rápido e fallback quando o Redis está fora.
let redisClient; // undefined = ainda não carregado; null = sem Redis
function getRedis() {
  if (redisClient === undefined) {
    try { redisClient = require('../config/redis').redis; } catch { redisClient = null; }
  }
  return redisClient && redisClient.status === 'ready' ? redisClient : null;
}

// Segundos até o fim do período (+1 min de folga), mínimo 60s.
function ttlUntilPeriodEnd(period, now = new Date()) {
  const r = nextResets(now);
  const end = new Date(period === 'WEEKLY' ? r.weekly : r.daily).getTime();
  return Math.max(60, Math.ceil((end - now.getTime()) / 1000) + 60);
}

const doneSet = new Set();
function markDone(key, period) {
  if (doneSet.size > 20000) doneSet.clear();
  doneSet.add(key);
  const rc = getRedis();
  if (rc) rc.set(`missions:done:${key}`, '1', 'EX', ttlUntilPeriodEnd(period)).catch(() => {});
}
async function isDone(key) {
  if (doneSet.has(key)) return true;
  const rc = getRedis();
  if (!rc) return false;
  try {
    if (await rc.exists(`missions:done:${key}`)) { doneSet.add(key); return true; }
  } catch { /* Redis instável — segue pelo banco */ }
  return false;
}

// Conta progresso. Nunca lança erro (quem chama não espera).
async function track(userId, type, amount = 1, io = null) {
  try {
    if (!userId || !MISSION_TYPES[type] || !(amount > 0)) return;
    const missions = (await getActiveMissions()).filter((m) => m.type === type);
    if (missions.length === 0) return;
    const now = new Date();
    for (const m of missions) {
      const key = periodKey(m.period, now);
      const memoKey = `${userId}|${m.id}|${key}`;
      // eslint-disable-next-line no-await-in-loop
      if (await isDone(memoKey)) continue;
      const where = { userId_missionId_periodKey: { userId, missionId: m.id, periodKey: key } };
      // eslint-disable-next-line no-await-in-loop
      const existing = await prisma.userMissionProgress.findUnique({ where });
      if (existing && existing.progress >= m.target) { markDone(memoKey, m.period); continue; }
      const inc = Math.min(amount, m.target - (existing?.progress || 0));
      // eslint-disable-next-line no-await-in-loop
      const row = await safeUpsert(prisma.userMissionProgress, {
        where,
        create: { userId, missionId: m.id, periodKey: key, progress: Math.min(amount, m.target) },
        update: { progress: { increment: inc } },
      });
      const completed = row.progress >= m.target;
      if (completed) {
        markDone(memoKey, m.period);
        if (!row.completedAt) {
          // eslint-disable-next-line no-await-in-loop
          await prisma.userMissionProgress.updateMany({ where: { id: row.id, completedAt: null }, data: { completedAt: now } });
        }
      }
      io?.notifyUser?.(userId, 'missions:progress', {
        missionId: m.id, periodKey: key, progress: Math.min(row.progress, m.target), target: m.target, completed,
        title: m.title,
      });
    }
  } catch (err) {
    console.error('[missões] falha ao contar progresso:', err?.message || err);
  }
}

// Reação: conta só uma vez por mensagem por pessoa no período (tirar e
// pôr de novo não vale de novo) e não conta reação na própria mensagem.
// TTL até o fim da semana — cobre tanto missões diárias quanto semanais.
const reactedSeen = new Map();
async function trackReaction(userId, messageId, authorId, io) {
  if (!userId || !messageId || userId === authorId) return;
  const k = `${userId}|${messageId}`;
  const now = Date.now();
  if (reactedSeen.has(k) && now - reactedSeen.get(k) < 7 * 24 * 3600 * 1000) return;
  if (reactedSeen.size > 50000) reactedSeen.clear();
  reactedSeen.set(k, now);
  const rc = getRedis();
  if (rc) {
    try {
      // NX: só a primeira vez grava; null = outra instância já contou.
      const ok = await rc.set(`missions:react:${k}`, '1', 'EX', ttlUntilPeriodEnd('WEEKLY'), 'NX');
      if (ok === null) return;
    } catch { /* Redis instável — vale a memória local */ }
  }
  track(userId, 'REACTIONS', 1, io);
}

function serializeMission(m, row) {
  const progress = Math.min(row?.progress || 0, m.target);
  return {
    id: m.id, period: m.period, type: m.type, title: m.title, description: m.description,
    target: m.target, progress, completed: progress >= m.target, claimed: !!row?.claimedAt,
    rewardCoins: m.rewardCoins, rewardGems: m.rewardGems, rewardXp: m.rewardXp,
    rewardItem: m.rewardItemKind && m.rewardItemId ? { kind: m.rewardItemKind, id: m.rewardItemId, days: m.rewardItemDays || null } : null,
    unit: MISSION_TYPES[m.type]?.unit || '',
  };
}

// Multiplicador de moedas das missões pra quem apoia (igual ao bônus do
// Nitro nas recompensas de missão): Assinante 1,2x, Super Assinante 1,5x.
const SUPPORTER_MULTIPLIER = { NONE: 1, SUBSCRIBER: 1.2, SUPER: 1.5 };
function missionMultiplier(tier) {
  return SUPPORTER_MULTIPLIER[tier] || 1;
}

async function listForUser(userId, now = new Date()) {
  const missions = await getActiveMissions();
  const keys = [dayKey(now), weekKey(now)];
  const rows = missions.length
    ? await prisma.userMissionProgress.findMany({ where: { userId, periodKey: { in: keys }, missionId: { in: missions.map((m) => m.id) } } })
    : [];
  const byMission = new Map(rows.map((r) => [`${r.missionId}|${r.periodKey}`, r]));
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { supporterTier: true } }).catch(() => null);
  const multiplier = missionMultiplier(require('./supporters').normalizeTier(me?.supporterTier));
  const list = missions.map((m) => serializeMission(m, byMission.get(`${m.id}|${periodKey(m.period, now)}`)));
  // Nome/imagem do item de recompensa (se tiver).
  const withItem = list.filter((m) => m.rewardItem);
  if (withItem.length) {
    const { findItem } = require('../controllers/shopController');
    await Promise.all(withItem.map(async (m) => {
      const it = await findItem(prisma, m.rewardItem.kind, m.rewardItem.id).catch(() => null);
      if (!it) { m.rewardItem = null; return; }
      m.rewardItem = { ...m.rewardItem, name: it.name, previewUrl: it.imageUrl || it.previewUrl || null };
    }));
  }
  return {
    missions: list.map((m) => ({ ...m, finalCoins: Math.round((m.rewardCoins || 0) * multiplier) })),
    multiplier,
    resets: nextResets(now),
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Resgata a recompensa. O updateMany com claimedAt:null garante que dois
// cliques rápidos (ou duas abas) não resgatem duas vezes.
async function claim(userId, missionId, io = null) {
  const m = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!m || !m.enabled) throw httpError(404, 'Missão não encontrada.');
  const key = periodKey(m.period);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.userMissionProgress.updateMany({
      where: { userId, missionId, periodKey: key, claimedAt: null, progress: { gte: m.target } },
      data: { claimedAt: now },
    });
    if (r.count === 0) throw httpError(400, 'Essa missão ainda não foi concluída ou já foi resgatada.');

    const user = await tx.user.findUnique({ where: { id: userId }, select: { accountXp: true, accountLevel: true, supporterTier: true } });
    const mult = missionMultiplier(require('./supporters').normalizeTier(user?.supporterTier));
    const coins = Math.round((m.rewardCoins || 0) * mult);
    const data = {};
    if (coins) data.coins = { increment: coins };
    if (m.rewardGems) data.gems = { increment: m.rewardGems };
    let levelUp = null;
    if (m.rewardXp > 0) {
      const newXp = (user?.accountXp || 0) + m.rewardXp;
      const lvl = calculateLevel(newXp);
      data.accountXp = newXp;
      data.accountLevel = lvl.level;
      if (lvl.level > (user?.accountLevel || 1)) {
        levelUp = { levelUp: true, oldLevel: user?.accountLevel || 1, newLevel: lvl.level, newLevelName: lvl.name, coinsReward: lvl.coinsReward || 0 };
        if (lvl.coinsReward > 0) data.coins = { increment: coins + lvl.coinsReward };
      }
    }
    const balance = Object.keys(data).length
      ? await tx.user.update({ where: { id: userId }, data, select: { coins: true, gems: true, accountXp: true, accountLevel: true } })
      : await tx.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true, accountXp: true, accountLevel: true } });
    // Item da Loja como recompensa (com prazo opcional).
    let item = null;
    if (m.rewardItemKind && m.rewardItemId) {
      const g = await require('./shopTimed').grantTimed(tx, userId, m.rewardItemKind, m.rewardItemId, m.rewardItemDays || null).catch(() => null);
      if (g) item = { kind: m.rewardItemKind, id: g.item.id, name: g.item.name, expiresAt: g.expiresAt, already: !!g.already };
    }
    return { balance, levelUp, coins, mult, item };
  });

  // Pontos da temporada do mês (passe de missões).
  const seasonPoints = await require('./missionSeason').addPoints(userId, m.period).catch(() => 0);
  recordTransaction(userId, { kind: 'MISSION', label: `Missão: ${m.title}${result.mult > 1 ? ` (bônus ${String(result.mult).replace('.', ',')}x de apoio)` : ''}`, coins: result.coins, gems: m.rewardGems, xp: m.rewardXp });
  // Missões da Arena também dão XP no passe da temporada.
  if (String(m.type || '').startsWith('CARDS_')) setImmediate(() => { require('../cards/progress').addPassXpFor(userId, 'mission').catch(() => {}); });
  if (result.levelUp) {
    if (result.levelUp.coinsReward > 0) recordTransaction(userId, { kind: 'LEVEL', label: `Subiu para o nível ${result.levelUp.newLevel}`, coins: result.levelUp.coinsReward });
    io?.notifyUser?.(userId, 'xp:levelup', result.levelUp);
  }
  return {
    reward: { coins: result.coins, baseCoins: m.rewardCoins, multiplier: result.mult, gems: m.rewardGems, xp: m.rewardXp, item: result.item, seasonPoints },
    balance: result.balance, levelUp: result.levelUp,
  };
}

// Minutos em call: a cada minuto, conta +1 pra quem está numa sala de voz
// com pelo menos mais uma pessoa e sem estar ensurdecido. Cada instância
// do servidor só conta os sockets que estão nela (sem contar em dobro se
// um dia rodar em várias instâncias).
const VOICE_TICK_MS = 60 * 1000;
let voiceTimer = null;
function startVoiceMinutesTicker(io) {
  if (voiceTimer) return voiceTimer;
  const voiceStore = require('./voiceRoomStore');
  voiceTimer = setInterval(async () => {
    try {
      const counted = new Set();
      for (const channelId of await voiceStore.getActiveRoomIds()) {
        // eslint-disable-next-line no-await-in-loop
        const room = await voiceStore.getRoom(channelId);
        const entries = Object.entries(room);
        if (entries.length < 2) continue;
        for (const [uid, p] of entries) {
          if (counted.has(uid) || p?.deafened) continue;
          if (!p?.socketId || !io?.sockets?.sockets?.has?.(p.socketId)) continue;
          counted.add(uid);
        }
      }
      for (const uid of counted) track(uid, 'VOICE_MINUTES', 1, io);
    } catch (err) {
      console.error('[missões] contagem de minutos em call falhou:', err?.message || err);
    }
  }, VOICE_TICK_MS);
  voiceTimer.unref?.();
  return voiceTimer;
}

module.exports = {
  missionMultiplier, SUPPORTER_MULTIPLIER,
  MISSION_TYPES, PERIODS, CLIENT_TRACKABLE, DEFAULT_MISSIONS,
  dayKey, weekKey, periodKey, nextResets,
  seedDefaultMissions, invalidateCache, getActiveMissions,
  track, trackReaction, listForUser, claim, startVoiceMinutesTicker,
  _test: { doneSet, reactedSeen, serializeMission, ttlUntilPeriodEnd, setRedis: (r) => { redisClient = r; } },
};
