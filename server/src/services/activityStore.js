// Item pedido: "identificar o jogo que a pessoa está jogando (Steam,
// Epic, etc) e mostrar nome/logo/tempo jogando, igual o Spotify no
// Discord" — a peça de detecção de verdade roda no APP DE DESKTOP
// (Electron, ver desktop/main.js), que é o único lugar com acesso ao
// sistema operacional pra saber quais programas estão rodando de
// verdade. Aqui é só onde essa informação FICA guardada uma vez que
// chega — mesmo padrão do presenceStore.js (Redis, com expiração
// automática), pra sobreviver a reinício do servidor sem deixar
// atividade "presa" pra sempre em alguém que já fechou o jogo antes do
// próximo aviso.
const { redis } = require('../config/redis');

const keyFor = (userId) => `activity:${userId}`;
// Se o app de desktop não confirmar de novo dentro desse tempo (ele
// reenvia a cada ~2s enquanto o jogo/música continuar tocando), a
// atividade expira sozinha — evita ficar "jogando Valorant" pra sempre
// se o app fechar de repente sem avisar (queda de luz, crash etc).
const ACTIVITY_TTL_SECONDS = 8;

async function setActivity(userId, activity) {
  const key = keyFor(userId);
  if (!activity) {
    await redis.del(key);
    return;
  }
  await redis.set(key, JSON.stringify(activity), 'EX', ACTIVITY_TTL_SECONDS);
}

async function getActivity(userId) {
  const raw = await redis.get(keyFor(userId));
  return raw ? JSON.parse(raw) : null;
}

// Várias de uma vez num único MGET. Antes, cada conexão fazia um GET por
// pessoa online — depois de um deploy (N pessoas reconectando juntas)
// isso virava N×N idas ao Redis.
async function getActivities(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  const out = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const raws = await redis.mget(chunk.map(keyFor));
    raws.forEach((raw, j) => {
      if (!raw) return;
      try { out[chunk[j]] = JSON.parse(raw); } catch { /* entrada corrompida: ignora */ }
    });
  }
  return out;
}

async function clearActivity(userId) {
  await redis.del(keyFor(userId));
}

module.exports = { setActivity, getActivity, getActivities, clearActivity, ACTIVITY_TTL_SECONDS };
