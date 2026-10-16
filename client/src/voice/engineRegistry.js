// Registro dos engines de mídia da cadeia de voz: servidor próprio
// (mediasoup), Agora e Stream (GetStream). O Agora é embutido no VoiceContext;
// os outros dois seguem a MESMA interface (getNode/join/setMicEnabled/
// setCamera/setScreen/dispose) e os mesmos callbacks.
import { createMediasoupEngine } from './mediasoupEngine.js';
import { createGetStreamEngine } from './getstreamEngine.js';
import { CLIENT_READY, PROVIDER_ORDER, CLIENT_READY_PROVIDERS } from './providerDecision.js';

export { CLIENT_READY_PROVIDERS, PROVIDER_ORDER };

const FACTORIES = {
  projectclub: (callbacks) => createMediasoupEngine(callbacks),
  getstream: (callbacks) => createGetStreamEngine(callbacks),
};

export function hasEngine(provider) {
  return provider === 'agora' || !!FACTORIES[provider];
}

// Todos usam a NOSSA grade (faixas por participante).
export function usesCustomGrid() {
  return true;
}

// Cria o engine do provedor (menos agora). Devolve null pra agora/desconhecido.
export function createEngine(provider, callbacks, creds) {
  const factory = FACTORIES[provider];
  return factory ? factory(callbacks, creds) : null;
}

export { CLIENT_READY };
