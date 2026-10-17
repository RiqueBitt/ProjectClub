// Contador mensal de minutos POR PROVEDOR de voz (item pedido).
//
// Cada provedor da cadeia tem o seu próprio contador, numa chave por mês: `voiceusage:YYYY-MM:<id>`.
// O valor é a soma de MINUTOS-PARTICIPANTE do mês — a cada minuto,
// somamos quantas pessoas estavam numa chamada (em salas com 2+ gente,
// sem contar quem está ensurdecido), e esse total vai pro provedor que
// está ATIVO naquele minuto. É exatamente como os serviços gerenciados
// (LiveKit, Daily, etc) cobram o nível gratuito deles, então é a
// métrica certa pra saber quando um estourou e passar pro próximo.
//
// Vive no Redis (rápido, com TTL automático). Se o Redis cair, a
// contagem degrada graciosamente (volta 0 / não incrementa) sem nunca
// derrubar nada — a voz continua funcionando, só a troca automática por
// limite fica temporariamente "cega" (e o fallback final Jitsi está
// sempre lá de qualquer jeito).
const providers = require('./voiceProviders');

// Redis carregado de forma preguiçosa: importar este módulo só pelas
// funções PURAS (monthKey, percentOf, isOverLimit — usadas na decisão e
// nos testes) não deve abrir conexão nenhuma com o Redis.
function getRedis() {
  return require('../config/redis').redis;
}

// Guarda a chave do mês por ~70 dias — o suficiente pra consultar o mês
// atual e o anterior, sem acumular chaves pra sempre.
const USAGE_TTL_SECONDS = 70 * 24 * 60 * 60;

// --- Puros (testáveis sem Redis) ---

// 'YYYY-MM' no fuso UTC (o "mês" do limite gratuito dos provedores é
// sempre em UTC — evita virar o mês em hora diferente do que eles contam).
function monthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function usageRedisKey(provider, date = new Date()) {
  return `voiceusage:${monthKey(date)}:${provider}`;
}

// "Uso inicial" definido pela STAFF: o nosso contador começa do zero a cada
// mês e NÃO sabe quanto o provedor (ex.: LiveKit) já gastou antes — então o
// painel mostrava ~0% enquanto o provedor, na real, já estava a 80%+, e a
// cadeia não trocava. Aqui a staff informa o uso real do mês; a partir daí o
// total = base informada + o que a gente contar daqui pra frente, e a troca
// automática passa a valer. Guardado numa chave por mês.
function baselineRedisKey(provider, date = new Date()) {
  return `voiceusage:base:${monthKey(date)}:${provider}`;
}

// Porcentagem usada (0–100, limitada), tratando limite infinito como 0%.
function percentOf(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  const pct = Math.round((used / limit) * 100);
  return Math.max(0, Math.min(100, pct));
}

// Está ESTOURADO? (usou >= limite com margem). Infinito nunca estoura.
function isOverLimit(used, limit) {
  if (!Number.isFinite(limit)) return false;
  return used >= limit;
}

// --- Redis ---

async function addMinutes(provider, minutes, date = new Date()) {
  if (!provider || !Number.isFinite(minutes) || minutes <= 0) return 0;
  try {
    const key = usageRedisKey(provider, date);
    const total = await getRedis().incrby(key, Math.round(minutes));
    await getRedis().expire(key, USAGE_TTL_SECONDS);
    return total;
  } catch {
    return 0; // Redis fora do ar — não trava nada
  }
}

// Minutos CONTADOS pelo ticker (sem a base informada pela staff).
async function getCountedMinutes(provider, date = new Date()) {
  try {
    const raw = await getRedis().get(usageRedisKey(provider, date));
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function getBaseline(provider, date = new Date()) {
  try {
    const raw = await getRedis().get(baselineRedisKey(provider, date));
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Uso TOTAL do provedor no mês = base informada pela staff + contado pelo
// ticker. É esse número que o painel mostra e a decisão da cadeia usa.
async function getMinutes(provider, date = new Date()) {
  const [counted, base] = await Promise.all([
    getCountedMinutes(provider, date), getBaseline(provider, date),
  ]);
  return counted + base;
}

// A staff diz "o provedor X já está em N minutos neste mês". Guardamos a
// base de forma que o total (base + contado) fique igual a N agora, e
// continue crescendo com as próximas chamadas.
async function setCurrentUsage(provider, minutes, date = new Date()) {
  if (!provider || !Number.isFinite(minutes) || minutes < 0) return 0;
  try {
    const counted = await getCountedMinutes(provider, date);
    const base = Math.max(0, Math.round(minutes) - counted);
    const key = baselineRedisKey(provider, date);
    await getRedis().set(key, String(base));
    await getRedis().expire(key, USAGE_TTL_SECONDS);
    return counted + base;
  } catch {
    return 0;
  }
}

// Mapa { id -> minutosUsados } de TODOS os provedores da cadeia no mês.
async function getAllUsage(date = new Date()) {
  const out = {};
  await Promise.all(providers.PROVIDER_ORDER.map(async (id) => {
    out[id] = await getMinutes(id, date);
  }));
  return out;
}

// ---- Contador de minutos-participante por minuto (ticker) ----
// Igual ao ticker de minutos das missões (services/missions.js), mas em
// vez de dar XP por pessoa, soma o TOTAL de pessoas em chamada ao provedor
// que está ATIVO naquele minuto. Assim `voiceusage:YYYY-MM:<ativo>` reflete
// o consumo real do nível gratuito daquele provedor — a decisão da cadeia
// (voiceDecision.js) usa esse número pra saber quando trocar.
const USAGE_TICK_MS = 60 * 1000;
let usageTimer = null;

function startProviderUsageTicker(io) {
  if (usageTimer) return usageTimer;
  const voiceStore = require('./voiceRoomStore');
  const overrideStore = require('./voiceOverrideStore');
  const decision = require('./voiceDecision');
  usageTimer = setInterval(async () => {
    try {
      // Conta participantes ativos (salas com 2+, sem ensurdecidos, com
      // socket vivo) — mesmo critério do ticker de missões.
      // Conta por SALA no provedor em que ela está de verdade (a fixação de
      // /api/voice/join); sem fixação, no ativo da cadeia. Antes somava tudo
      // no ativo global — com salas em provedores diferentes, os minutos
      // iam pro provedor errado (e podiam "esgotar" quem nem estava em uso).
      const perRoom = [];
      for (const channelId of await voiceStore.getActiveRoomIds()) {
        // eslint-disable-next-line no-await-in-loop
        const room = await voiceStore.getRoom(channelId);
        const entries = Object.entries(room);
        if (entries.length < 2) continue;
        let n = 0;
        for (const [, p] of entries) {
          if (p?.deafened) continue;
          if (io && (!p?.socketId || !io?.sockets?.sockets?.has?.(p.socketId))) continue;
          n += 1;
        }
        if (n > 0) perRoom.push({ channelId, n });
      }
      if (!perRoom.length) return;
      const unhealthy = await require('./voiceHealth').tracker().getUnhealthy().catch(() => []);
      const [usageByProvider, override, disabled] = await Promise.all([
        getAllUsage(), overrideStore.getOverride(), overrideStore.getDisabled(),
      ]);
      const globalProvider = decision.decideProvider({ usageByProvider, override, disabled, unhealthy }).provider;
      const byProvider = {};
      for (const { channelId, n } of perRoom) {
        // eslint-disable-next-line no-await-in-loop
        const prov = (await overrideStore.getRoomProvider(channelId)) || globalProvider;
        byProvider[prov] = (byProvider[prov] || 0) + n;
      }
      for (const [prov, n] of Object.entries(byProvider)) {
        // eslint-disable-next-line no-await-in-loop
        await addMinutes(prov, n);
      }
    } catch (err) {
      console.error('[voz] contagem de minutos por provedor falhou:', err?.message || err);
    }
  }, USAGE_TICK_MS);
  usageTimer.unref?.();
  return usageTimer;
}

// Resolve o provedor ATIVO agora (lendo uso + override + desativados do
// Redis e caminhando pela cadeia). Usado pelo sockets/index.js pra guardar,
// em cada participante, por qual provedor de mídia ele entrou — e degrada
// gracioso pro primário/Jitsi se algo falhar (nunca derruba a entrada).
// Lazy-require pra não criar ciclo de import no carregamento do módulo.
// Com `channelId`, prefere o provedor FIXADO naquela sala (é nele que a
// pessoa realmente está — /api/voice/join) pra contar os minutos no lugar
// certo; sem fixação, a decisão global da cadeia (com a saúde dos provedores).
async function resolveActiveProvider(channelId) {
  try {
    const overrideStore = require('./voiceOverrideStore');
    const decision = require('./voiceDecision');
    if (channelId) {
      const sticky = await overrideStore.getRoomProvider(channelId);
      if (sticky) return sticky;
    }
    const unhealthy = await require('./voiceHealth').tracker().getUnhealthy().catch(() => []);
    const [usageByProvider, override, disabled] = await Promise.all([
      getAllUsage(), overrideStore.getOverride(), overrideStore.getDisabled(),
    ]);
    return decision.decideProvider({ usageByProvider, override, disabled, unhealthy }).provider;
  } catch {
    const providers = require('./voiceProviders');
    return providers.PRIMARY_PROVIDER;
  }
}

module.exports = {
  USAGE_TTL_SECONDS,
  monthKey,
  usageRedisKey,
  percentOf,
  isOverLimit,
  addMinutes,
  getCountedMinutes,
  getBaseline,
  setCurrentUsage,
  getMinutes,
  getAllUsage,
  startProviderUsageTicker,
  resolveActiveProvider,
};
