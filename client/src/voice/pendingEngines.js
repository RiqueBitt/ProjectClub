// Engines PENDENTES da cadeia de voz: getstream, daily e trtc.
//
// O lado do SERVIDOR destes provedores está pronto (token/UserSig mintado em
// services/voiceTokens.js e status no painel da staff). O engine de CLIENTE
// ainda não está finalizado — por isso o cliente anuncia ao servidor
// (clientReady em /api/voice/join) que NÃO sabe usá-los ainda, e a cadeia os
// PULA automaticamente no navegador (continua indo agora → livekit → jitsi).
// Estes módulos existem pra: (a) já deixar a dependência do SDK instalada e
// carregável (lazy, fora do bundle inicial), (b) documentar o ponto exato
// que falta, e (c) falhar com uma mensagem CLARA caso sejam forçados, em vez
// de deixar a pessoa numa call muda.
//
// Interface igual à do JitsiEngine/LiveKitEngine (getNode/join/setMicEnabled/
// setCamera/setScreen/dispose) — quando formos finalizar, é só trocar o
// corpo de `join` pela conexão real.

// --- GetStream (@stream-io/video-client) ---
let streamPromise = null;
export function loadStream() {
  if (!streamPromise) streamPromise = import('@stream-io/video-client');
  return streamPromise;
}

// --- Daily (@daily-co/daily-js) — além de pendente no cliente, está GATEADO
// no servidor até existir a DAILY_API_KEY. ---
let dailyPromise = null;
export function loadDaily() {
  if (!dailyPromise) dailyPromise = import('@daily-co/daily-js');
  return dailyPromise;
}

// --- TRTC (trtc-sdk-v5) ---
let trtcPromise = null;
export function loadTRTC() {
  if (!trtcPromise) trtcPromise = import('trtc-sdk-v5');
  return trtcPromise;
}

class PendingEngine {
  constructor(provider, loader, callbacks = {}) {
    this.provider = provider;
    this._loader = loader;
    this.cb = callbacks;
    this.pending = true;
  }

  getNode() { return null; }
  capabilities() { return { camera: true, screen: true, perUserVolume: false, speakingIndicator: false, customGrid: true }; }

  async join() {
    // Carrega o SDK (prova que a dependência está lá) e falha claro.
    await this._loader().catch(() => {});
    const err = new Error(`O provedor ${this.provider} ainda não está disponível no cliente (engine pendente).`);
    err.code = 'ENGINE_PENDING';
    this.cb.onError?.(err, { where: 'join', pending: true });
    throw err;
  }

  async setMicEnabled() {}
  async setCamera() { return null; }
  async setScreen() { return null; }
  hangup() {}
  dispose() {}
}

export function createGetStreamEngine(callbacks) { return new PendingEngine('getstream', loadStream, callbacks); }
export function createDailyEngine(callbacks) { return new PendingEngine('daily', loadDaily, callbacks); }
export function createTRTCEngine(callbacks) { return new PendingEngine('trtc', loadTRTC, callbacks); }
