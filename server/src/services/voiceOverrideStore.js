// Controle manual da cadeia de voz pela equipe (item pedido: painel da
// staff pode FORÇAR um provedor específico, voltar pro automático, e
// LIGAR/DESLIGAR um provedor na cadeia).
//
// Persiste no Redis pra sobreviver a restart/deploy e valer pra todas as
// instâncias do servidor ao mesmo tempo:
//  - `voice:override`  -> id do provedor forçado (ou ausente = automático)
//  - `voice:disabled`  -> Set com os ids tirados da cadeia manualmente
//
// Tudo degrada gracioso se o Redis cair (vira "sem override / nada
// desativado"), nunca derruba a voz.
const { redis } = require('../config/redis');
const providers = require('./voiceProviders');

const OVERRIDE_KEY = 'voice:override';
const DISABLED_KEY = 'voice:disabled';
// Provedor de cada sala em andamento ("todo mundo da mesma call no MESMO
// provedor"). A "época" muda quando a equipe mexe na cadeia, invalidando
// as escolhas antigas de uma vez.
const EPOCH_KEY = 'voice:epoch';
const ROOM_TTL = 6 * 3600;

async function epoch() { try { return (await redis.get(EPOCH_KEY)) || '0'; } catch { return '0'; } }
async function bumpEpoch() { try { await redis.incr(EPOCH_KEY); } catch { /* sem Redis: sem fixação */ } }
// Valor gravado: "<provedor>|<quando>" (ms). O "quando" diz se a fixação é
// recentíssima — alguém acabou de pedir /api/voice/join e ainda não aparece
// na lista da sala; quem chegar nesses segundos vai pro MESMO provedor.
// Valores antigos (só o id) continuam valendo.
function parseRoomProvider(raw) {
  if (!raw) return null;
  const [provider, at] = String(raw).split('|');
  if (!providers.PROVIDERS[provider]) return null;
  return { provider, at: Number(at) || 0 };
}
async function getRoomProviderInfo(room) {
  try { return parseRoomProvider(await redis.get(`voice:roomprov:${await epoch()}:${room}`)); } catch { return null; }
}
async function getRoomProvider(room) {
  const info = await getRoomProviderInfo(room);
  return info ? info.provider : null;
}
async function setRoomProvider(room, provider, now = Date.now()) {
  try { await redis.set(`voice:roomprov:${await epoch()}:${room}`, `${provider}|${now}`, 'EX', ROOM_TTL); } catch { /* opcional */ }
}
// Renova o prazo sem mexer no valor (chamada longa não perde a fixação).
async function touchRoomProvider(room) {
  try { await redis.expire(`voice:roomprov:${await epoch()}:${room}`, ROOM_TTL); } catch { /* opcional */ }
}

async function getOverride() {
  try {
    const v = await redis.get(OVERRIDE_KEY);
    const id = (v || '').trim();
    return id && providers.PROVIDERS[id] ? id : null;
  } catch {
    return null;
  }
}

// provider = id válido pra forçar, ou null/'' pra voltar ao automático.
async function setOverride(provider) {
  try {
    await bumpEpoch();
    if (!provider) {
      await redis.del(OVERRIDE_KEY);
      return null;
    }
    if (!providers.PROVIDERS[provider]) throw new Error('provedor inválido');
    await redis.set(OVERRIDE_KEY, provider);
    return provider;
  } catch (err) {
    if (err?.message === 'provedor inválido') throw err;
    return null;
  }
}

async function getDisabled() {
  try {
    const members = await redis.smembers(DISABLED_KEY);
    return members.filter((id) => providers.PROVIDERS[id]);
  } catch {
    return [];
  }
}

async function isDisabled(provider) {
  try {
    return (await redis.sismember(DISABLED_KEY, provider)) === 1;
  } catch {
    return false;
  }
}

// Liga/desliga um provedor na cadeia. O Jitsi (fallback final) NUNCA pode
// ser desativado — ele é a última rede de segurança gratuita.
async function setDisabled(provider, disabled) {
  if (!providers.PROVIDERS[provider]) throw new Error('provedor inválido');
  if (provider === 'jitsi' && disabled) {
    throw new Error('O Jitsi é o fallback final e não pode ser desativado.');
  }
  await bumpEpoch();
  try {
    if (disabled) await redis.sadd(DISABLED_KEY, provider);
    else await redis.srem(DISABLED_KEY, provider);
    return !!disabled;
  } catch {
    return !!disabled;
  }
}

module.exports = {
  getRoomProvider,
  getRoomProviderInfo,
  parseRoomProvider,
  setRoomProvider,
  touchRoomProvider,
  bumpEpoch,
  OVERRIDE_KEY,
  DISABLED_KEY,
  getOverride,
  setOverride,
  getDisabled,
  isDisabled,
  setDisabled,
};
