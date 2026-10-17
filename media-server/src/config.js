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

  // Quantidade de workers (processos C++ do mediasoup). Um por CPU é o
  // padrão; cada sala vive num worker (round-robin).
  numWorkers: Math.max(1, num(env.MEDIA_WORKERS, os.cpus().length)),
  logLevel: env.MEDIA_LOG_LEVEL || 'warn',

  // Limites de proteção contra abuso (por sala / por participante).
  maxPeersPerRoom: num(env.MEDIA_MAX_PEERS_PER_ROOM, 50),
  maxProducersPerPeer: num(env.MEDIA_MAX_PRODUCERS_PER_PEER, 4), // mic + câmera + tela + áudio da tela
  maxRooms: num(env.MEDIA_MAX_ROOMS, 500),
  // A partir de quantas pessoas a sala passa a usar mais de um núcleo.
  splitAt: Math.max(2, num(env.MEDIA_SPLIT_AT, 10)),

  // Detector de fala (anel verde): limiar em dBov (0 = máximo, -127 =
  // silêncio). -60 pega fala normal sem acender com ruído de fundo.
  speakingThresholdDb: Math.max(-127, Math.min(0, num(env.MEDIA_SPEAKING_THRESHOLD, -60))),
  speakingIntervalMs: Math.max(100, num(env.MEDIA_SPEAKING_INTERVAL_MS, 400)),

  // Bitrate inicial de saída por transport (bps) — o BWE ajusta depois.
  initialAvailableOutgoingBitrate: num(env.MEDIA_INITIAL_BITRATE, 800000),
  // Teto de bitrate de entrada por transport (bps): 0 = sem teto.
  // 10 Mbps: cabe a tela em 1080p60 (~8 Mbps) + microfone + câmera.
  maxIncomingBitrate: num(env.MEDIA_MAX_INCOMING_BITRATE, 10000000),

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

function validate() {
  const errors = [];
  if (!config.secret || config.secret.length < 16) errors.push('MEDIA_SERVER_SECRET precisa ter pelo menos 16 caracteres (o mesmo valor configurado no Project Club).');
  if (!config.publicIp) errors.push('MEDIA_PUBLIC_IP é obrigatório (IP público do VPS; em teste local use 127.0.0.1).');
  if (config.rtcMaxPort <= config.rtcMinPort) errors.push('MEDIA_RTC_MAX_PORT precisa ser maior que MEDIA_RTC_MIN_PORT.');
  return errors;
}

module.exports = { config, validate };
