// Canal AFK (igual ao Discord) — configuração da comunidade
// (PlatformSettings.afkChannelId + afkTimeoutSeconds) e a varredura que move
// quem está parado na voz pro canal AFK.
//
// "Parado" (definição usada aqui):
//   última atividade = o MAIOR entre `lastActiveAt` (gravado ao entrar, ao
//   reconectar e a cada `voice:speaking` com speaking:true — ou seja, quando
//   a pessoa REALMENTE transmitiu voz, já descontado mudo/PTT solto/portão
//   fechado no cliente) e `joinedAt`. Se agora − última atividade ≥ tempo
//   configurado, a pessoa é movida.
// Não entram na varredura: quem já está no canal AFK; chamadas de DM/clã
// (ids `dm:`/`clan:`); canais de PALCO (plateia é passiva por definição);
// quem está com câmera ou tela ligada (está "fazendo algo" sem falar).
//
// No canal AFK a pessoa fica sempre muda (claims canSpeak:false no token de
// mídia, participante com `afk:true`, `voice:state muted:false` ignorado).
//
// Puro onde dá (pickIdle, normalizeTimeout) — testado em
// server/test/voice-afk.test.js.

const AFK_TIMEOUTS = Object.freeze([60, 300, 900, 1800, 3600]); // 1/5/15/30/60 min
const DEFAULT_AFK_TIMEOUT = 300;
const SWEEP_MS = 30 * 1000;
const LOCK_KEY = 'voice:afk:sweep-lock';
const SETTINGS_TTL_MS = 15 * 1000;

function normalizeTimeout(v) {
  const n = Number(v);
  return AFK_TIMEOUTS.includes(n) ? n : DEFAULT_AFK_TIMEOUT;
}

function isCommunityVoiceRoom(channelId) {
  return typeof channelId === 'string' && !!channelId && !channelId.startsWith('dm:') && !channelId.startsWith('clan:');
}

function lastActivity(p) {
  const a = Number(p && p.lastActiveAt) || 0;
  const j = Number(p && p.joinedAt) || 0;
  return Math.max(a, j);
}

// rooms: { [channelId]: { [userId]: participant } }
// channelTypes: { [channelId]: 'VOICE'|'STAGE'|... } (ausente = desconhecido → ignora)
// Devolve [{ userId, fromChannelId, idleMs }].
function pickIdle({ rooms, afkChannelId, timeoutSeconds, now = Date.now(), channelTypes = {} }) {
  if (!afkChannelId) return [];
  const limitMs = normalizeTimeout(timeoutSeconds) * 1000;
  const out = [];
  for (const [channelId, room] of Object.entries(rooms || {})) {
    if (channelId === afkChannelId || !isCommunityVoiceRoom(channelId)) continue;
    if (channelTypes[channelId] !== 'VOICE') continue;
    for (const [userId, p] of Object.entries(room || {})) {
      if (!p || p.video || p.screenSharing) continue;
      const last = lastActivity(p);
      if (!last) continue; // sem marca nenhuma: registro antigo, não arrisca
      const idleMs = now - last;
      if (idleMs >= limitMs) out.push({ userId, fromChannelId: channelId, idleMs });
    }
  }
  return out;
}

// ---------- Configuração (com cache curto) ----------
let cache = null; // { at, value }
async function getAfkSettings({ prisma } = {}) {
  if (cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache.value;
  const db = prisma || require('../config/prisma');
  let value = { afkChannelId: null, afkTimeoutSeconds: DEFAULT_AFK_TIMEOUT };
  try {
    const s = await db.platformSettings.findUnique({ where: { id: 'singleton' }, select: { afkChannelId: true, afkTimeoutSeconds: true } });
    if (s) value = { afkChannelId: s.afkChannelId || null, afkTimeoutSeconds: normalizeTimeout(s.afkTimeoutSeconds) };
  } catch { /* coluna ainda não existe (db push pendente) → AFK desligado */ }
  cache = { at: Date.now(), value };
  return value;
}
function invalidateAfkSettings() { cache = null; }
async function isAfkChannel(channelId, deps) {
  if (!isCommunityVoiceRoom(channelId)) return false;
  const s = await getAfkSettings(deps);
  return !!s.afkChannelId && s.afkChannelId === channelId;
}

// Valida o que a staff manda no PATCH /admin/community. Devolve
// { data } ou { error }.
async function validateAfkPatch(body, { prisma } = {}) {
  const data = {};
  if (body.afkTimeoutSeconds !== undefined) {
    const n = Number(body.afkTimeoutSeconds);
    if (!AFK_TIMEOUTS.includes(n)) return { error: 'Tempo de AFK inválido (1, 5, 15, 30 ou 60 minutos).' };
    data.afkTimeoutSeconds = n;
  }
  if (body.afkChannelId !== undefined) {
    if (body.afkChannelId === null || body.afkChannelId === '') data.afkChannelId = null;
    else {
      const db = prisma || require('../config/prisma');
      const ch = await db.channel.findUnique({ where: { id: String(body.afkChannelId) }, select: { id: true, type: true } });
      if (!ch || ch.type !== 'VOICE') return { error: 'O canal AFK precisa ser um canal de voz.' };
      data.afkChannelId = ch.id;
    }
  }
  return { data };
}

// Trava entre instâncias: só UMA roda a varredura por janela. Não solta a
// trava (expira sozinha um pouco antes da próxima rodada).
async function tryAcquireSweepLock(redis, ttlMs = SWEEP_MS - 5000) {
  try {
    const r = await redis.set(LOCK_KEY, `${process.pid}:${Date.now()}`, 'PX', ttlMs, 'NX');
    return r === 'OK';
  } catch { return true; /* Redis fora: instância única, segue */ }
}

// Uma rodada. deps: { prisma, redis, voiceStore, getEffectivePermissions, has, moveToAfk(userId, fromChannelId, afkChannel) }
async function runAfkSweep(deps, now = Date.now()) {
  const settings = await getAfkSettings(deps);
  if (!settings.afkChannelId) return [];
  if (!(await tryAcquireSweepLock(deps.redis))) return [];
  const ids = (await deps.voiceStore.getActiveRoomIds()).filter((id) => isCommunityVoiceRoom(id) && id !== settings.afkChannelId);
  if (!ids.length) return [];
  const rooms = {};
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    rooms[id] = await deps.voiceStore.getRoom(id);
  }
  const chans = await deps.prisma.channel.findMany({ where: { id: { in: [...ids, settings.afkChannelId] } }, select: { id: true, type: true, name: true, userLimit: true } });
  const channelTypes = Object.fromEntries(chans.map((c) => [c.id, c.type]));
  const afkChannel = chans.find((c) => c.id === settings.afkChannelId);
  if (!afkChannel || afkChannel.type !== 'VOICE') return [];
  const idle = pickIdle({ rooms, afkChannelId: settings.afkChannelId, timeoutSeconds: settings.afkTimeoutSeconds, now, channelTypes });
  const moved = [];
  for (const it of idle) {
    // Só move quem pode ENTRAR no canal AFK (CONNECT); quem não pode fica.
    // eslint-disable-next-line no-await-in-loop
    const perms = await deps.getEffectivePermissions(it.userId, afkChannel.id, afkChannel).catch(() => 0n);
    if (!deps.has(perms, 'CONNECT')) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await deps.moveToAfk(it.userId, it.fromChannelId, afkChannel);
      moved.push(it);
    } catch (err) { console.error('[voz] mover pro AFK falhou:', err?.message || err); }
  }
  if (moved.length) console.log(`[voz] AFK: ${moved.length} pessoa(s) movida(s) para "${afkChannel.name}"`);
  return moved;
}

module.exports = {
  AFK_TIMEOUTS, DEFAULT_AFK_TIMEOUT, SWEEP_MS, LOCK_KEY,
  normalizeTimeout, isCommunityVoiceRoom, lastActivity, pickIdle,
  getAfkSettings, invalidateAfkSettings, isAfkChannel, validateAfkPatch,
  tryAcquireSweepLock, runAfkSweep,
};
