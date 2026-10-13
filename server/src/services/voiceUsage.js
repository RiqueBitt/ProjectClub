// Contabilidade de uso do Agora + decisão de qual provedor de mídia usar
// (Agora ⇆ Jitsi), para a troca automática quando o plano gratuito do
// Agora (~10.000 minutos/mês) está quase no limite.
//
// IDEIA GERAL
//  - O plano gratuito do Agora dá ~10.000 minutos de canal por mês. Se
//    estourar, as chamadas passariam a ser cobradas (ou parariam). Para
//    nunca deixar a comunidade sem voz, quando o uso do MÊS CORRENTE chega
//    perto do limite (margem de segurança padrão de 95%), o servidor passa
//    a mandar o cliente conectar pelo Jitsi (IFrame External API, domínio
//    público meet.jit.si por padrão) em vez do Agora — sem deslogar
//    ninguém, só trocando a camada de MÍDIA.
//  - A contagem é por MÊS CIVIL (chave YYYY-MM em UTC). Quando o mês vira,
//    a chave muda sozinha, o contador do mês novo começa em zero e o
//    provedor volta pro Agora automaticamente — sem nenhuma intervenção.
//  - Só os minutos do AGORA contam contra o limite do Agora. Enquanto a
//    comunidade estiver no Jitsi, o contador do Agora simplesmente para de
//    crescer (ninguém está no Agora), então na virada do mês ele volta.
//
// NADA DE SEGREDO AQUI: este módulo nunca expõe App Certificate do Agora
// nem o App Secret do Jitsi — só números de uso e o nome do provedor.
//
// As funções PURAS (monthKey, decideProvider, jitsiRoomName, limitFromEnv,
// marginFromEnv) não tocam Redis e são testadas isoladamente
// (server/test/voice-usage.test.js). O contador (recordAgoraSeconds /
// getMinutesUsed) usa o Redis compartilhado e degrada em silêncio se o
// Redis estiver fora do ar (a chamada continua funcionando, só a contagem
// fica imprecisa naquele instante).
const crypto = require('crypto');
const { redis } = require('../config/redis');

// Limite mensal (minutos de canal) e margem de segurança — configuráveis
// por variável de ambiente, com padrões sensatos. AGORA_MONTHLY_MINUTES
// ~ 10000 (plano gratuito); a troca acontece ao atingir 95% disso.
const DEFAULT_MONTHLY_MINUTES = 10000;
const DEFAULT_SWITCH_MARGIN = 0.95;

function limitFromEnv() {
  const raw = parseInt(process.env.AGORA_MONTHLY_MINUTES || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_MINUTES;
}

function marginFromEnv() {
  const raw = parseFloat(process.env.AGORA_SWITCH_MARGIN || '');
  // Só aceita uma margem plausível (entre 50% e 100%); fora disso usa o padrão.
  return Number.isFinite(raw) && raw > 0.5 && raw <= 1 ? raw : DEFAULT_SWITCH_MARGIN;
}

// Chave do mês civil em UTC (YYYY-MM). Em UTC de propósito: a virada do mês
// precisa ser determinística e igual em qualquer servidor/fuso.
function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Decisão PURA: dado o uso e o limite, devolve qual provedor usar. Não
// toca rede. `agoraConfigured` = false força o Jitsi (não adianta mandar
// pro Agora se ele nem tem credenciais no servidor).
function decideProvider({ minutesUsed = 0, limit = DEFAULT_MONTHLY_MINUTES, margin = DEFAULT_SWITCH_MARGIN, agoraConfigured = true } = {}) {
  const used = Number.isFinite(minutesUsed) && minutesUsed > 0 ? Math.round(minutesUsed) : 0;
  const lim = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_MONTHLY_MINUTES;
  const marg = Number.isFinite(margin) && margin > 0 && margin <= 1 ? margin : DEFAULT_SWITCH_MARGIN;
  const threshold = Math.floor(lim * marg);

  if (!agoraConfigured) {
    return { provider: 'jitsi', reason: 'agora-nao-configurado', minutesUsed: used, limit: lim, threshold };
  }
  if (used >= threshold) {
    return { provider: 'jitsi', reason: 'limite-mensal-agora', minutesUsed: used, limit: lim, threshold };
  }
  return { provider: 'agora', reason: 'ok', minutesUsed: used, limit: lim, threshold };
}

// Nome de sala do Jitsi: estável (mesma chamada → mesma sala) mas
// IMPOSSÍVEL de adivinhar a partir do id do canal, porque o domínio
// público do Jitsi (meet.jit.si) não tem autenticação — qualquer um que
// soubesse o nome entraria. Por isso o nome é um hash SHA-256 do id da
// chamada + um SALT secreto do servidor (nunca sai daqui). Prefixo fixo
// só pra evitar colisão com salas de outras pessoas no domínio público.
function jitsiRoomName(callId, salt) {
  const base = `${callId}::${salt || ''}`;
  const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 40);
  return `projectclub-${hash}`;
}

// ---------- Contador (Redis) ----------
// Guarda SEGUNDOS acumulados de Agora no mês (inteiro, via INCRBY) e expira
// a chave depois de ~75 dias pra limpar meses velhos sozinho.
const USAGE_TTL_SECONDS = 75 * 24 * 60 * 60;
const usageKey = (date) => `voice:usage:agora:${monthKey(date)}`;

async function recordAgoraSeconds(seconds, date = new Date()) {
  const secs = Math.max(0, Math.round(Number(seconds) || 0));
  if (secs === 0) return;
  try {
    const key = usageKey(date);
    await redis.incrby(key, secs);
    await redis.expire(key, USAGE_TTL_SECONDS);
  } catch { /* Redis fora do ar — contagem só fica imprecisa nesse instante */ }
}

async function getSecondsUsed(date = new Date()) {
  try {
    const raw = await redis.get(usageKey(date));
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

async function getMinutesUsed(date = new Date()) {
  const secs = await getSecondsUsed(date);
  return Math.round(secs / 60);
}

// Decisão COMPLETA (lê o contador do mês). `agoraConfigured` vem do
// controlador (services/agoraToken.isConfigured) pra não duplicar a regra.
async function getDecision({ agoraConfigured = true, date = new Date() } = {}) {
  const minutesUsed = await getMinutesUsed(date);
  return decideProvider({
    minutesUsed,
    limit: limitFromEnv(),
    margin: marginFromEnv(),
    agoraConfigured,
  });
}

module.exports = {
  // puras (testáveis sem rede)
  monthKey,
  decideProvider,
  jitsiRoomName,
  limitFromEnv,
  marginFromEnv,
  DEFAULT_MONTHLY_MINUTES,
  DEFAULT_SWITCH_MARGIN,
  // contador / decisão (Redis)
  recordAgoraSeconds,
  getSecondsUsed,
  getMinutesUsed,
  getDecision,
};
