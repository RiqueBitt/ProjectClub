// Faxina (uma vez por boot) das chaves do Redis da antiga CADEIA de
// provedores de voz (LiveKit/Daily/TRTC/Jitsi, removidos — a voz usa só o
// servidor de mídia próprio). Ninguém mais lê nem grava essas chaves; aqui só
// apagamos o lixo que ficou. Nunca lança e nunca toca em chaves em uso
// (voice:room:*, voice:credentials com as chaves do servidor próprio,
// voiceusage:*:projectclub).
const LEGACY_KEYS = ['voice:override', 'voice:disabled', 'voice:epoch'];
const LEGACY_PATTERNS = ['voice:roomprov:*', 'voice:lastjoin:*', 'voice:health:*'];
// Campos de chaves dos provedores removidos dentro do hash voice:credentials.
const LEGACY_CREDENTIAL_FIELDS = [
  'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_MONTHLY_MINUTES',
  'DAILY_DOMAIN', 'DAILY_ROOM_URL', 'DAILY_API_KEY',
  'TRTC_SDK_APP_ID', 'TRTC_SECRET_KEY',
  'JITSI_DOMAIN', 'JITSI_APP_ID', 'JITSI_APP_SECRET',
];

async function scanDel(redis, pattern) {
  let cursor = '0';
  let n = 0;
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = String(next);
    if (keys && keys.length) {
      // eslint-disable-next-line no-await-in-loop
      await redis.del(...keys);
      n += keys.length;
    }
  } while (cursor !== '0');
  return n;
}

async function cleanupLegacyVoiceKeys(redis = require('../config/redis').redis, log = console) {
  let removed = 0;
  try {
    removed += Number(await redis.del(...LEGACY_KEYS)) || 0;
    for (const p of LEGACY_PATTERNS) {
      // eslint-disable-next-line no-await-in-loop
      removed += await scanDel(redis, p);
    }
    removed += Number(await redis.hdel('voice:credentials', ...LEGACY_CREDENTIAL_FIELDS)) || 0;
    if (removed) log.log?.(`[voz] ${removed} chave(s) antiga(s) da cadeia de provedores removida(s) do Redis.`);
  } catch (err) {
    log.warn?.('[voz] faxina das chaves antigas de provedores falhou (ignorado):', err?.message || err);
  }
  return removed;
}

module.exports = { cleanupLegacyVoiceKeys, LEGACY_KEYS, LEGACY_PATTERNS, LEGACY_CREDENTIAL_FIELDS };
