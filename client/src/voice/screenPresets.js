// Presets da transmissão de tela e escolha de camadas na recepção — lógica
// PURA (sem DOM/WebRTC), testada em client/test/voice-screen-presets.test.js.
//
// Ideias adotadas de projetos abertos (código nosso):
//   - tabela resolução × fps → bitrate no estilo dos presets de tela do
//     LiveKit (Apache-2.0);
//   - regra do lib-jitsi-meet (Apache-2.0) pro contentHint: fps baixo =
//     texto/slides ('detail', segura a resolução); fps alto = movimento
//     ('motion', segura a fluidez);
//   - simulcast de 2 camadas pra tela e camada escolhida pelo tamanho em que
//     o vídeo aparece (mediasoup-demo, ISC).

export const SCREEN_RESOLUTIONS = Object.freeze({
  '720p': Object.freeze({ width: 1280, height: 720 }),
  '1080p': Object.freeze({ width: 1920, height: 1080 }),
  '1440p': Object.freeze({ width: 2560, height: 1440 }),
});
export const SCREEN_FRAME_RATES = Object.freeze([5, 15, 30, 60]);

// Bitrate (bps) da camada CHEIA por resolução e fps.
export const SCREEN_BITRATES = Object.freeze({
  '720p': Object.freeze({ 5: 800_000, 15: 1_500_000, 30: 2_000_000, 60: 3_500_000 }),
  '1080p': Object.freeze({ 5: 1_500_000, 15: 2_500_000, 30: 5_000_000, 60: 8_000_000 }),
  '1440p': Object.freeze({ 5: 2_500_000, 15: 4_000_000, 30: 7_000_000, 60: 10_000_000 }),
});

export const DEFAULT_SCREEN_QUALITY = '1080p';
export const DEFAULT_SCREEN_FPS = 30;
// Camada baixa do simulcast da tela: metade da resolução, no máximo 15 fps
// e pelo menos 300 kbps (texto continua legível em miniatura).
export const SCREEN_LOW_LAYER_MIN_BITRATE = 300_000;
export const SCREEN_LOW_LAYER_MAX_FPS = 15;

// fps válido mais próximo (ex.: 12 → 15, 45 → 30, 90 → 60).
export function nearestScreenFps(fps) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCREEN_FPS;
  let best = SCREEN_FRAME_RATES[0];
  for (const f of SCREEN_FRAME_RATES) if (Math.abs(f - n) < Math.abs(best - n) || (Math.abs(f - n) === Math.abs(best - n) && f < best)) best = f;
  return best;
}

// { quality, frameRate } válidos (preset desconhecido → 1080p; fps → o mais próximo).
export function normalizeScreenPreset({ quality, frameRate } = {}) {
  const q = SCREEN_RESOLUTIONS[quality] ? quality : DEFAULT_SCREEN_QUALITY;
  const f = frameRate == null ? DEFAULT_SCREEN_FPS : nearestScreenFps(frameRate);
  return { quality: q, frameRate: f };
}

export function screenBitrate(quality, frameRate) {
  const p = normalizeScreenPreset({ quality, frameRate });
  return SCREEN_BITRATES[p.quality][p.frameRate];
}

// contentHint + degradationPreference (regra do Jitsi): até 15 fps é
// conteúdo "parado" (texto, código, slides) → nitidez; 30+ é movimento
// (jogo, vídeo) → fluidez.
export function screenContentHint(frameRate) {
  const f = Number(frameRate) || DEFAULT_SCREEN_FPS;
  if (f <= 15) return { contentHint: 'detail', degradationPreference: 'maintain-resolution' };
  return { contentHint: 'motion', degradationPreference: 'maintain-framerate' };
}

// Encodings do producer da tela: 2 camadas (baixa → cheia), VP8 L1T3.
// `maxBitrate` explícito (legado) substitui o da tabela na camada cheia.
export function screenEncodings({ quality, frameRate, maxBitrate } = {}) {
  const p = normalizeScreenPreset({ quality, frameRate });
  const full = Number.isFinite(maxBitrate) && maxBitrate > 0 ? Math.round(maxBitrate) : SCREEN_BITRATES[p.quality][p.frameRate];
  const low = Math.max(SCREEN_LOW_LAYER_MIN_BITRATE, Math.round(full / 4));
  return [
    { scaleResolutionDownBy: 2, maxBitrate: Math.min(low, full), maxFramerate: Math.min(SCREEN_LOW_LAYER_MAX_FPS, p.frameRate), scalabilityMode: 'L1T3' },
    { scaleResolutionDownBy: 1, maxBitrate: full, maxFramerate: p.frameRate, scalabilityMode: 'L1T3' },
  ];
}

// Constraints de vídeo da captura (applyConstraints / getDisplayMedia).
export function screenVideoConstraints({ quality, frameRate, width, height } = {}) {
  const p = normalizeScreenPreset({ quality, frameRate });
  const dims = SCREEN_RESOLUTIONS[p.quality];
  const w = Number.isFinite(width) && width > 0 ? width : dims.width;
  const h = Number.isFinite(height) && height > 0 ? height : dims.height;
  return { width: { ideal: w, max: w }, height: { ideal: h, max: h }, frameRate: { ideal: p.frameRate, max: p.frameRate } };
}

// Opções do getDisplayMedia: som do sistema incluído quando pedido, a
// própria aba/janela do Project Club fora da lista (evita o "espelho
// infinito"), troca de fonte no meio permitida, e o áudio da tela SEM
// cancelamento de eco/supressor/ganho automático (é música/jogo, não voz)
// e sem o som que o próprio app toca (restrictOwnAudio).
export function displayMediaOptions({ quality, frameRate, width, height, audio = true } = {}) {
  const opts = {
    video: screenVideoConstraints({ quality, frameRate, width, height }),
    audio: audio === false ? false : {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      suppressLocalAudioPlayback: false, restrictOwnAudio: true,
    },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  };
  if (audio !== false) opts.systemAudio = 'include';
  return opts;
}

// ---------- recepção ----------
// Quantas camadas espaciais um consumer de vídeo tem (pelo scalabilityMode
// que o servidor devolve: 'L3T3' = 3, 'L2T3' = 2, 'L1T3'/sem = 1).
export function spatialLayersOf(rtpParameters) {
  const enc = rtpParameters?.encodings?.[0];
  const m = /^L(\d+)T/.exec(String(enc?.scalabilityMode || ''));
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Altura em pixels físicos a partir da qual vale a camada ALTA.
export const HIGH_LAYER_MIN_PX = 540;
export const MID_LAYER_MIN_PX = 270;

// Camada espacial pelo tamanho em que o vídeo aparece (altura CSS ×
// devicePixelRatio). >= 540 px → a mais alta; câmera (3 camadas): >= 270 →
// a do meio; senão a mais baixa. Sem altura conhecida → a mais alta.
export function pickSpatialLayer(pixelHeight, spatialLayers) {
  const top = Math.max(0, (Number(spatialLayers) || 1) - 1);
  if (top === 0) return 0;
  const h = Number(pixelHeight);
  if (!Number.isFinite(h) || h <= 0) return top;
  if (h >= HIGH_LAYER_MIN_PX) return top;
  if (top >= 2 && h >= MID_LAYER_MIN_PX) return 1;
  return 0;
}

// O que fazer com um consumer de vídeo: { paused, spatialLayer }.
// `views`: lista de { visible, height } (um por bloco que mostra o vídeo);
// vazia = ninguém informou → mostra na camada mais alta (comportamento antigo).
export function viewportDecision({ views = [], documentHidden = false, dpr = 1, spatialLayers = 1 } = {}) {
  if (documentHidden) return { paused: true, spatialLayer: null };
  const list = Array.isArray(views) ? views : [];
  if (!list.length) return { paused: false, spatialLayer: pickSpatialLayer(null, spatialLayers) };
  const visible = list.filter((v) => v && v.visible);
  if (!visible.length) return { paused: true, spatialLayer: null };
  const maxH = Math.max(0, ...visible.map((v) => Number(v.height) || 0));
  const ratio = Number(dpr) > 0 ? Number(dpr) : 1;
  return { paused: false, spatialLayer: pickSpatialLayer(maxH > 0 ? maxH * ratio : null, spatialLayers) };
}

// Prioridade na divisão da banda (mediasoup 1..255): tela > câmera.
export const CONSUMER_PRIORITY = Object.freeze({ screen: 200, camera: 100 });
