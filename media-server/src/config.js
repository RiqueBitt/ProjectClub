// Configuração do servidor de mídia (tudo por variável de ambiente).
// Ver README.md — e docker-compose.yml, que já passa as principais.
const os = require('os');

const env = process.env;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const config = {
  // Porta HTTP/WebSocket da sinalização (atrás do Caddy com TLS em produção).
  port: num(env.MEDIA_PORT, 4443),
  host: env.MEDIA_HOST || '0.0.0.0',

  // Segredo COMPARTILHADO com o backend do Project Club (MEDIA_SERVER_SECRET
  // lá também). O backend assina um JWT curto por participante; aqui a gente
  // só aceita conexão com esse JWT válido. Obrigatório.
  secret: env.MEDIA_SERVER_SECRET || '',

  // IP público do VPS (o que os clientes enxergam). Obrigatório em produção:
  // é o endereço anunciado nos candidatos ICE. Em teste local pode ser
  // 127.0.0.1.
  publicIp: env.MEDIA_PUBLIC_IP || '',
  // IP local onde o mediasoup escuta (0.0.0.0 = todas as interfaces).
  listenIp: env.MEDIA_LISTEN_IP || '0.0.0.0',

  // Faixa de portas UDP/TCP de mídia (RTP/ICE). Precisa estar ABERTA no
  // firewall do VPS pra UDP (e TCP, como reserva).
  rtcMinPort: num(env.MEDIA_RTC_MIN_PORT, 40000),
  rtcMaxPort: num(env.MEDIA_RTC_MAX_PORT, 40999),

  // WebRtcServer (mediasoup ≥ 3.11): cada worker escuta UMA porta UDP + TCP
  // (porta-base + índice do worker: 40000, 40001...) e TODOS os transports
  // daquele worker passam por ela — menos portas, e o TCP de reserva (redes
  // que bloqueiam UDP) fica numa porta fixa e previsível. Recomendado pela
  // doc do mediasoup e é o padrão do mediasoup-demo. Desligue com
  // MEDIA_WEBRTC_SERVER=0 pra voltar às portas por transport.
  useWebRtcServer: env.MEDIA_WEBRTC_SERVER !== '0',
  webRtcServerPort: num(env.MEDIA_WEBRTC_SERVER_PORT, num(env.MEDIA_RTC_MIN_PORT, 40000)),

  // Consentimento ICE (RFC 7675): sem resposta do cliente por N segundos, o
  // transport vai pra "disconnected" e o cliente reconecta. 0 = desliga.
  iceConsentTimeout: Math.max(0, num(env.MEDIA_ICE_CONSENT_TIMEOUT, 30)),

  // Quantidade de workers (processos C++ do mediasoup). Um por CPU é o
  // padrão; cada sala vive num worker (round-robin).
  numWorkers: Math.max(1, num(env.MEDIA_WORKERS, os.cpus().length)),
  logLevel: env.MEDIA_LOG_LEVEL || 'warn',

  // Limites de proteção contra abuso (por sala / por participante).
  maxPeersPerRoom: num(env.MEDIA_MAX_PEERS_PER_ROOM, 50),
  maxProducersPerPeer: num(env.MEDIA_MAX_PRODUCERS_PER_PEER, 4), // mic + câmera + tela + áudio da tela
  maxRooms: num(env.MEDIA_MAX_ROOMS, 500),
  // send + recv, com folga pra uma renegociação; cada transport sem
  // WebRtcServer ocupa uma porta UDP/TCP — sem teto um cliente esgotaria a faixa.
  maxTransportsPerPeer: num(env.MEDIA_MAX_TRANSPORTS_PER_PEER, 4),
  maxConsumersPerPeer: num(env.MEDIA_MAX_CONSUMERS_PER_PEER, 200),

  // Worker morto: recria sozinho. Se morrer mais que isso em 1 minuto, algo
  // está muito errado (memória, binário) — aí sai e o docker reinicia tudo.
  maxWorkerDeathsPerMinute: num(env.MEDIA_MAX_WORKER_DEATHS_PER_MINUTE, 5),

  // Sinalização: mensagens por segundo por conexão (balde de fichas) e
  // tentativas de conexão por minuto por IP.
  msgRatePerSec: num(env.MEDIA_MSG_RATE, 40),
  msgBurst: num(env.MEDIA_MSG_BURST, 120),
  connectsPerMinutePerIp: num(env.MEDIA_CONNECTS_PER_MINUTE, 60),
  // Batimento do WebSocket (ping/pong): quem não responde em 2 ciclos cai.
  heartbeatMs: Math.max(1000, num(env.MEDIA_HEARTBEAT_MS, 15000)),
  // Mesma pessoa em 2 aparelhos trocando de lugar sem parar ("saiu/entrou"
  // em loop): depois de N trocas em 60s, novas trocas são recusadas por um
  // tempo e quem está na sala fica.
  maxReplacementsPerMinute: num(env.MEDIA_MAX_REPLACEMENTS_PER_MINUTE, 3),
  replacementCooldownMs: num(env.MEDIA_REPLACEMENT_COOLDOWN_MS, 30000),

  // Detector de fala (anel verde): limiar em dBov (0 = máximo, -127 =
  // silêncio). -60 pega fala normal sem acender com ruído de fundo.
  speakingThresholdDb: Math.max(-127, Math.min(0, num(env.MEDIA_SPEAKING_THRESHOLD, -60))),
  speakingIntervalMs: Math.max(100, num(env.MEDIA_SPEAKING_INTERVAL_MS, 400)),

  // Bitrate inicial de saída por transport (bps) — o BWE ajusta depois.
  initialAvailableOutgoingBitrate: num(env.MEDIA_INITIAL_BITRATE, 800000),
  // Teto de bitrate de entrada por transport (bps): 0 = sem teto. 3 Mbps
  // cobre mic + câmera simulcast + tela 1080p/15fps; quem precisar de mais
  // (tela 60fps) sobe por env.
  maxIncomingBitrate: num(env.MEDIA_MAX_INCOMING_BITRATE, 3000000),

  // Codecs oferecidos (prioridade de áudio: Opus — ver PDF, seção 4.1).
  mediaCodecs: [
    {
      kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2,
      // Opus com FEC em banda + DTX: inteligibilidade de voz com perda de
      // pacotes e menos tráfego no silêncio.
      parameters: { useinbandfec: 1, usedtx: 1 },
    },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 600 } },
    {
      kind: 'video', mimeType: 'video/H264', clockRate: 90000,
      parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1, 'x-google-start-bitrate': 600 },
    },
  ],
};

// Portas reservadas pro WebRtcServer (porta-base + índice do worker) quando
// elas caem dentro da faixa RTC: os transports avulsos (modo reserva, sem
// WebRtcServer) usam a faixa DEPOIS delas, pra nunca disputar a mesma porta.
const WEBRTC_SERVER_PORT_RESERVE = 16;

// Faixa usada pelos transports avulsos (sem WebRtcServer).
function transportPortRange() {
  let min = config.rtcMinPort;
  if (config.useWebRtcServer && config.webRtcServerPort >= config.rtcMinPort && config.webRtcServerPort <= config.rtcMaxPort) {
    min = Math.max(min, config.webRtcServerPort + WEBRTC_SERVER_PORT_RESERVE);
  }
  return { min, max: config.rtcMaxPort };
}

function validate() {
  const errors = [];
  if (!config.secret || config.secret.length < 16) errors.push('MEDIA_SERVER_SECRET precisa ter pelo menos 16 caracteres (o mesmo valor configurado no Project Club).');
  if (!config.publicIp) errors.push('MEDIA_PUBLIC_IP é obrigatório (IP público do VPS; em teste local use 127.0.0.1).');
  if (config.rtcMaxPort <= config.rtcMinPort) errors.push('MEDIA_RTC_MAX_PORT precisa ser maior que MEDIA_RTC_MIN_PORT.');
  if (config.useWebRtcServer && config.webRtcServerPort >= config.rtcMinPort && config.webRtcServerPort <= config.rtcMaxPort
    && config.webRtcServerPort + WEBRTC_SERVER_PORT_RESERVE > config.rtcMaxPort) {
    errors.push('faixa MEDIA_RTC_MIN_PORT..MAX_PORT pequena demais pra reservar as portas do WebRtcServer.');
  }
  return errors;
}

module.exports = { config, validate, transportPortRange, WEBRTC_SERVER_PORT_RESERVE };
