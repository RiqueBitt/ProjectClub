// Contador mensal de minutos de voz do servidor PRÓPRIO (media-server/).
//
// Só telemetria (aparece no Painel de saúde da staff): a cada minuto somamos
// quantas pessoas estavam numa chamada (em salas com 2+ gente, sem contar
// quem está ensurdecido, com socket vivo) numa chave por mês:
// `voiceusage:YYYY-MM:projectclub`. Não decide nada — a voz usa SEMPRE o
// servidor próprio (não existe mais cadeia de provedores).
//
// Vive no Redis (rápido, com TTL automático). Se o Redis cair, a contagem
// degrada graciosamente (volta 0 / não incrementa) sem derrubar nada.

// O único provedor de voz da plataforma (valor guardado em cada participante
// e devolvido por /api/voice/join).
const PROVIDER = 'projectclub';

// Redis carregado de forma preguiçosa: importar este módulo só pelas
// funções puras não deve abrir conexão nenhuma com o Redis.
function getRedis() {
  return require('../config/redis').redis;
}

// Guarda a chave do mês por ~70 dias (mês atual e o anterior).
const USAGE_TTL_SECONDS = 70 * 24 * 60 * 60;

// 'YYYY-MM' no fuso UTC.
function monthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function usageRedisKey(date = new Date()) {
  return `voiceusage:${monthKey(date)}:${PROVIDER}`;
}

async function addMinutes(minutes, date = new Date()) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  try {
    const key = usageRedisKey(date);
    const total = await getRedis().incrby(key, Math.round(minutes));
    await getRedis().expire(key, USAGE_TTL_SECONDS);
    return total;
  } catch {
    return 0; // Redis fora do ar — não trava nada
  }
}

async function getMinutes(date = new Date()) {
  try {
    const raw = await getRedis().get(usageRedisKey(date));
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// ---- Contador de minutos-participante por minuto (ticker) ----
const USAGE_TICK_MS = 60 * 1000;
let usageTimer = null;

function startUsageTicker(io) {
  if (usageTimer) return usageTimer;
  const voiceStore = require('./voiceRoomStore');
  usageTimer = setInterval(async () => {
    try {
      let total = 0;
      for (const channelId of await voiceStore.getActiveRoomIds()) {
        // eslint-disable-next-line no-await-in-loop
        const room = await voiceStore.getRoom(channelId);
        const entries = Object.entries(room);
        if (entries.length < 2) continue;
        for (const [, p] of entries) {
          if (p?.deafened) continue;
          if (io && (!p?.socketId || !io?.sockets?.sockets?.has?.(p.socketId))) continue;
          total += 1;
        }
      }
      if (total > 0) await addMinutes(total);
    } catch (err) {
      console.error('[voz] contagem de minutos falhou:', err?.message || err);
    }
  }, USAGE_TICK_MS);
  usageTimer.unref?.();
  return usageTimer;
}

module.exports = {
  PROVIDER,
  USAGE_TTL_SECONDS,
  monthKey,
  usageRedisKey,
  addMinutes,
  getMinutes,
  startUsageTicker,
};
