// Registro dos engines de mídia da cadeia de voz. Mapeia cada provedor pra
// uma factory de engine (carregada de forma preguiçosa) e diz quais o cliente
// consegue usar HOJE — essa lista é enviada ao servidor em /api/voice/join
// (clientReady=...), pra cadeia pular no navegador os provedores cujo engine
// ainda está pendente.
//
// O Agora NÃO está aqui: o caminho do Agora continua embutido no VoiceContext
// (código consolidado e testado), e este registro cobre os DEMAIS provedores
// da cadeia. O VoiceContext usa o caminho do Agora quando provider==='agora'
// e este registro para os outros (todos com a MESMA interface de engine:
// getNode/join/setMicEnabled/setCamera/setScreen/dispose).
import { JitsiEngine } from './jitsiEngine.js';
import { createLiveKitEngine } from './livekitEngine.js';
import { createMediasoupEngine } from './mediasoupEngine.js';
import { createGetStreamEngine, createDailyEngine, createTRTCEngine } from './pendingEngines.js';
import { CLIENT_READY, PROVIDER_ORDER, CLIENT_READY_PROVIDERS } from './providerDecision.js';

export { CLIENT_READY_PROVIDERS, PROVIDER_ORDER };

// Factories que recebem (callbacks, creds) e devolvem um engine pronto.
const FACTORIES = {
  // Servidor de mídia PRÓPRIO (media-server/, mediasoup) — primeiro da cadeia.
  projectclub: (callbacks) => createMediasoupEngine(callbacks),
  jitsi: (callbacks, creds) => new JitsiEngine({ domain: creds?.domain || 'meet.jit.si', callbacks }),
  livekit: (callbacks) => createLiveKitEngine(callbacks),
  getstream: (callbacks) => createGetStreamEngine(callbacks),
  daily: (callbacks) => createDailyEngine(callbacks),
  trtc: (callbacks) => createTRTCEngine(callbacks),
};

// Tem um engine pra esse provedor? (agora é tratado à parte no VoiceContext.)
export function hasEngine(provider) {
  return provider === 'agora' || !!FACTORIES[provider];
}

// O engine deste provedor usa faixas por participante na NOSSA grade
// (livekit/agora) ou uma UI própria num iframe (jitsi)?
export function usesCustomGrid(provider) {
  return provider !== 'jitsi';
}

// Cria o engine do provedor (menos agora). Devolve null pra agora/desconhecido.
export function createEngine(provider, callbacks, creds) {
  const factory = FACTORIES[provider];
  return factory ? factory(callbacks, creds) : null;
}

export { CLIENT_READY };
