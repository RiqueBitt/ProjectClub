// Engine de mídia da voz: a plataforma usa SÓ o servidor de mídia próprio
// (media-server/, mediasoup). Este módulo é o ponto único onde o VoiceContext
// cria o engine e lê a resposta de /api/voice/join.
//
// O código do engine (mediasoupEngine.js, ~90 KB) e o SDK (mediasoup-client)
// NÃO entram no pacote inicial do site: baixam sob demanda — no tempo ocioso
// depois do login (preloadVoiceEngine) ou, no máximo, na hora de entrar na call.
//
// Interface do engine: getNode/join/setMicEnabled/setCamera/setScreen/dispose
// (ver mediasoupEngine.js).
import { readJoinResponse, VOICE_PROVIDER } from './joinResponse.js';

export { readJoinResponse, VOICE_PROVIDER };

let modPromise = null;
let mod = null;

/** Baixa (uma vez) o código do engine. Falhou? A próxima chamada tenta de novo. */
export function loadVoiceEngine() {
  if (!modPromise) {
    modPromise = import('./mediasoupEngine.js')
      .then((m) => { mod = m; return m; })
      .catch((err) => { modPromise = null; throw err; });
  }
  return modPromise;
}

/** Adianta o download do engine + SDK sem travar nada (erro é ignorado). */
export function preloadVoiceEngine() {
  loadVoiceEngine().then((m) => m.preloadMediasoup()).catch(() => {});
}

// Cria o engine do servidor próprio. Precisa de loadVoiceEngine() antes.
export function createEngine(callbacks) {
  if (!mod) throw new Error('engine de voz ainda não carregado');
  return mod.createMediasoupEngine(callbacks);
}
