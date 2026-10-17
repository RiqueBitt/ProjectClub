// Engines PENDENTES da cadeia de voz: daily e trtc.
//
// O lado do SERVIDOR destes provedores está pronto (token/UserSig mintado em
// services/voiceTokens.js e status no painel da staff). O engine de CLIENTE
// ainda não está finalizado — por isso o cliente anuncia ao servidor
// (clientReady em /api/voice/join) que NÃO sabe usá-los ainda, e a cadeia os
// PULA automaticamente no navegador (segue servidor próprio → livekit → jitsi).
//
// Observação de BUILD: os SDKs destes dois (@daily-co/daily-js,
// trtc-sdk-v5) são grandes (o TRTC sozinho ~1,1MB) e
// faziam o build do cliente estourar a memória no deploy. Como o engine
// ainda é pendente e NUNCA é usado, não importamos (nem instalamos) esses
// SDKs — assim eles não entram no build. Quando formos finalizar cada um,
// a gente adiciona o pacote e troca o corpo de `join` pela conexão real.
//
// Interface igual à do JitsiEngine/LiveKitEngine (getNode/join/setMicEnabled/
// setCamera/setScreen/dispose).

class PendingEngine {
  constructor(provider, callbacks = {}) {
    this.provider = provider;
    this.cb = callbacks;
    this.pending = true;
  }

  getNode() { return null; }
  capabilities() { return { camera: true, screen: true, perUserVolume: false, speakingIndicator: false, customGrid: true }; }

  async join() {
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

export function createDailyEngine(callbacks) { return new PendingEngine('daily', callbacks); }
export function createTRTCEngine(callbacks) { return new PendingEngine('trtc', callbacks); }
