// Engine de mídia da voz: a plataforma usa SÓ o servidor de mídia próprio
// (media-server/, mediasoup). Este módulo é o ponto único onde o VoiceContext
// cria o engine e lê a resposta de /api/voice/join.
//
// Interface do engine: getNode/join/setMicEnabled/setCamera/setScreen/dispose
// (ver mediasoupEngine.js).
import { createMediasoupEngine } from './mediasoupEngine.js';
import { readJoinResponse, VOICE_PROVIDER } from './joinResponse.js';

export { readJoinResponse, VOICE_PROVIDER };

// Cria o engine do servidor próprio.
export function createEngine(callbacks) {
  return createMediasoupEngine(callbacks);
}
