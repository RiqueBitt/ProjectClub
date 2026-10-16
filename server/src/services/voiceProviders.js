// Cadeia de provedores de voz: servidor próprio → Agora → Stream (os outros
// — LiveKit, Daily, TRTC e Jitsi — foram removidos a pedido do dono).
// (Histórico: item pedido: transformar o fallback único
// Agora→Jitsi numa CADEIA ordenada de provedores, cada um usado até
// estourar o limite mensal gratuito dele, aí passa pro próximo
// automaticamente — sem deslogar ninguém).
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
  // Servidor de mídia PRÓPRIO (item pedido: "crie o nosso próprio sistema"
  // a partir do PDF — mediasoup + coturn, ver media-server/). Primeiro da
  // cadeia e sem teto mensal: quando configurado (URL + segredo do servidor
  // de mídia), é ele que atende; sem as variáveis fica "não configurado" e
  // a cadeia segue pros provedores externos como antes.
  projectclub: {
    id: 'projectclub',
    label: 'Project Club (servidor próprio)',
    order: 0,
    envVars: ['MEDIA_SERVER_URL', 'MEDIA_SERVER_SECRET'],
    unlimited: true,
    own: true,
  },
  agora: {
    id: 'agora',
    label: 'Agora',
    order: 1,
    envVars: ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE'],
    limitEnv: 'AGORA_MONTHLY_MINUTES',
    defaultLimit: 10000,
    isPrimary: true,
  },
  getstream: {
    id: 'getstream',
    label: 'Stream (GetStream)',
    order: 2,
    envVars: ['GETSTREAM_API_KEY', 'GETSTREAM_API_SECRET'],
    limitEnv: 'GETSTREAM_MONTHLY_MINUTES',
    defaultLimit: 10000,
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

// "Modo reserva" = a chamada caiu num provedor DEPOIS do principal na cadeia
// (estourou o limite / indisponível). O servidor próprio vem ANTES do
// principal, então estar nele não é reserva — é o caminho preferido.
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
