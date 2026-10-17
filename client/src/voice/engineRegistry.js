// Registro dos engines de mídia da cadeia de voz. Mapeia cada provedor pra
// uma factory de engine (carregada de forma preguiçosa) e diz quais o cliente
// consegue usar HOJE — essa lista é enviada ao servidor em /api/voice/join
// (clientReady=...), pra cadeia pular no navegador os provedores cujo engine
// ainda está pendente.
//
// TODA a mídia passa por aqui: o VoiceContext cria o engine do provedor
// escolhido pela cadeia (servidor próprio, LiveKit, Jitsi, pendentes), todos
// com a MESMA interface (getNode/join/setMicEnabled/setCamera/setScreen/
// dispose).
import { JitsiEngine } from './jitsiEngine.js';
import { createLiveKitEngine } from './livekitEngine.js';
import { createMediasoupEngine } from './mediasoupEngine.js';
import { createDailyEngine, createTRTCEngine } from './pendingEngines.js';
import { CLIENT_READY, PROVIDER_ORDER, CLIENT_READY_PROVIDERS } from './providerDecision.js';

export { CLIENT_READY_PROVIDERS, PROVIDER_ORDER };

// Factories que recebem (callbacks, creds) e devolvem um engine pronto.
const FACTORIES = {
  // Servidor de mídia PRÓPRIO (media-server/, mediasoup) — primeiro da cadeia.
  projectclub: (callbacks) => createMediasoupEngine(callbacks),
  jitsi: (callbacks, creds) => new JitsiEngine({ domain: creds?.domain || 'meet.jit.si', callbacks }),
  livekit: (callbacks) => createLiveKitEngine(callbacks),
  daily: (callbacks) => createDailyEngine(callbacks),
  trtc: (callbacks) => createTRTCEngine(callbacks),
};

// Tem um engine pra esse provedor?
export function hasEngine(provider) {
  return !!FACTORIES[provider];
}

// O engine deste provedor usa faixas por participante na NOSSA grade
// (servidor próprio/livekit) ou uma UI própria num iframe (jitsi)?
export function usesCustomGrid(provider) {
  return provider !== 'jitsi';
}

// Cria o engine do provedor. Devolve null pra provedor desconhecido.
export function createEngine(provider, callbacks, creds) {
  const factory = FACTORIES[provider];
  return factory ? factory(callbacks, creds) : null;
}

export { CLIENT_READY };
