// Cadeia de provedores de voz: uma CADEIA ordenada de provedores, cada um
// usado até estourar o limite mensal gratuito dele (ou cair), aí passa pro
// próximo automaticamente — sem deslogar ninguém. O PRINCIPAL é o servidor
// de mídia próprio (projectclub, mediasoup); os externos que sobraram
// (LiveKit/Daily/TRTC) só entram se configurados, e o Jitsi é a última rede
// de segurança. (Agora e Stream/GetStream foram removidos da plataforma —
// ids antigos guardados no Redis são ignorados por quem lê, ver
// voiceOverrideStore.js.)
//
// Este arquivo é a FONTE DA VERDADE da cadeia: a ordem, o rótulo, quais
// variáveis de ambiente cada um exige pra ser considerado "configurado",
// e o limite mensal gratuito (em minutos-participante) de cada um. É
// puro (só lê de um objeto `env` que recebe por parâmetro — por padrão
// o process.env), então dá pra testar a decisão da cadeia inteira sem
// Redis nem rede.
//
// NUNCA imprime nem devolve segredo nenhum — só diz se as variáveis
// EXISTEM (configured), nunca o valor delas. As credenciais de verdade
// (tokens) são mintadas em services/voiceTokens.js e só saem na rota
// /api/voice/join, pra quem tem acesso àquela sala.

// Margem de segurança: para de usar um provedor um pouco ANTES do limite
// real (padrão 95%), pra nunca passar do gratuito e começar a cobrar por
// causa de alguns minutos de folga na contagem.
function margin(env = process.env) {
  const raw = Number(env.VOICE_USAGE_MARGIN);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return 0.95;
}

// Metadados de cada provedor. `order` é a posição na cadeia (menor =
// tentado primeiro). `envVars` são as variáveis OBRIGATÓRIAS pra estar
// "configurado". `limitEnv`/`defaultLimit` dão o teto mensal gratuito em
// minutos-participante (soma de participantes ativos por minuto). `gateEnv`
// (só o Daily hoje) é uma variável EXTRA que precisa existir pra ficar
// "disponível/enabled" de verdade mesmo já estando "configurado" — serve
// pro Daily aparecer no painel como "configurado (falta DAILY_API_KEY)"
// e ser PULADO na cadeia enquanto o dono não adiciona a chave da API.
const PROVIDERS = {
  // Servidor de mídia PRÓPRIO (mediasoup + coturn, ver media-server/).
  // PRINCIPAL e primeiro da cadeia, sem teto mensal: quando configurado (URL
  // + segredo do servidor de mídia), é ele que atende; sem as variáveis fica
  // "não configurado" e a cadeia segue pros provedores de reserva.
  projectclub: {
    id: 'projectclub',
    label: 'Project Club (servidor próprio)',
    order: 0,
    envVars: ['MEDIA_SERVER_URL', 'MEDIA_SERVER_SECRET'],
    unlimited: true,
    own: true,
    isPrimary: true,
  },
  livekit: {
    id: 'livekit',
    label: 'LiveKit',
    order: 1,
    envVars: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    limitEnv: 'LIVEKIT_MONTHLY_MINUTES',
    defaultLimit: 5000,
  },
  daily: {
    id: 'daily',
    label: 'Daily',
    order: 2,
    envVars: ['DAILY_DOMAIN', 'DAILY_ROOM_URL'],
    // O dono ainda NÃO tem a DAILY_API_KEY (necessária pra mintar os
    // tokens de reunião via REST do Daily). Enquanto ela não existir, o
    // Daily fica "configurado (falta DAILY_API_KEY)" e é pulado na cadeia.
    gateEnv: 'DAILY_API_KEY',
    gateLabel: 'DAILY_API_KEY',
    limitEnv: 'DAILY_MONTHLY_MINUTES',
    defaultLimit: 10000,
  },
  trtc: {
    id: 'trtc',
    label: 'TRTC (Tencent)',
    order: 3,
    envVars: ['TRTC_SDK_APP_ID', 'TRTC_SECRET_KEY'],
    limitEnv: 'TRTC_MONTHLY_MINUTES',
    defaultLimit: 10000,
  },
  jitsi: {
    id: 'jitsi',
    label: 'Jitsi (meet.jit.si)',
    order: 4,
    // Fallback final e sempre gratuito — não exige segredo nenhum
    // (meet.jit.si público). Por isso está SEMPRE disponível e sem teto.
    envVars: [],
    alwaysAvailable: true,
    unlimited: true,
  },
};

// Ordem da cadeia (ids), do primeiro ao último.
const PROVIDER_ORDER = Object.values(PROVIDERS)
  .sort((a, b) => a.order - b.order)
  .map((p) => p.id);

const PRIMARY_PROVIDER = Object.values(PROVIDERS).find((p) => p.isPrimary)?.id || PROVIDER_ORDER[0];

function getMeta(id) {
  return PROVIDERS[id] || null;
}

// "Modo reserva" = a chamada caiu num provedor DEPOIS do principal (o
// servidor próprio) na cadeia — ele estava indisponível/caído.
function isReserve(id) {
  const meta = PROVIDERS[id];
  const primary = PROVIDERS[PRIMARY_PROVIDER];
  if (!meta || !primary) return false;
  return meta.order > primary.order;
}

// "configurado" = todas as variáveis obrigatórias existem (não-vazias).
// O Jitsi é sempre configurado (não exige nenhuma).
function isConfigured(id, env = process.env) {
  const meta = PROVIDERS[id];
  if (!meta) return false;
  if (meta.alwaysAvailable) return true;
  return meta.envVars.every((name) => !!String(env[name] || '').trim());
}

// "disponível/enabled" = configurado E (se tiver gateEnv) com o gate
// presente. É o que vale pra entrar na cadeia de verdade.
function isAvailable(id, env = process.env) {
  if (!isConfigured(id, env)) return false;
  const meta = PROVIDERS[id];
  if (meta.gateEnv && !String(env[meta.gateEnv] || '').trim()) return false;
  return true;
}

// Teto mensal gratuito (minutos-participante) já com a margem aplicada.
// Jitsi é ilimitado (Infinity). Um valor <= 0 na env também vira ilimitado
// (serve pra "nunca sair deste provedor por limite").
function getMonthlyLimit(id, env = process.env) {
  const meta = PROVIDERS[id];
  if (!meta || meta.unlimited) return Infinity;
  const raw = Number(env[meta.limitEnv]);
  const base = Number.isFinite(raw) ? raw : meta.defaultLimit;
  if (!Number.isFinite(base) || base <= 0) return Infinity;
  return Math.floor(base * margin(env));
}

// Teto BRUTO (sem margem) — só pra mostrar "X / Y min" no painel com o
// número "redondo" que o dono reconhece (ex.: 10000), enquanto a decisão
// usa o teto com margem por baixo.
function getDisplayLimit(id, env = process.env) {
  const meta = PROVIDERS[id];
  if (!meta || meta.unlimited) return Infinity;
  const raw = Number(env[meta.limitEnv]);
  const base = Number.isFinite(raw) ? raw : meta.defaultLimit;
  if (!Number.isFinite(base) || base <= 0) return Infinity;
  return base;
}

module.exports = {
  PROVIDERS,
  PROVIDER_ORDER,
  PRIMARY_PROVIDER,
  margin,
  getMeta,
  isReserve,
  isConfigured,
  isAvailable,
  getMonthlyLimit,
  getDisplayLimit,
};
