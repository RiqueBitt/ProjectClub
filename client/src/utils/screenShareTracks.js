// Montagem das faixas do compartilhamento de tela — isolada aqui, sem
// React nem Agora, pra poder ser testada direta (ver client/e2e/
// screenshare-tracks.spec.mjs).
//
// Item pedido (C): "o compartilhamento de tela NÃO pode levar a voz do
// microfone junto — só o som do sistema/aba". O jeito certo de garantir
// isso é NUNCA misturar a faixa do microfone na captura de tela: a
// captura de tela (getDisplayMedia, por baixo do createScreenVideoTrack
// do Agora) só entrega vídeo da tela + ÁUDIO DO SISTEMA/ABA — ela não tem
// acesso nenhum ao microfone. A faixa do microfone é uma faixa
// completamente separada, publicada à parte (a pessoa continua falando
// normalmente pela voz). Estas funções deixam essa separação explícita e
// verificável.

export const SCREEN_QUALITY_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const ALLOWED_FPS = [15, 30, 60];

// Argumentos puros passados pro AgoraRTC.createScreenVideoTrack. O
// segundo valor (`audioParam`) é EXATAMENTE o que decide se o áudio do
// SISTEMA/ABA entra junto — 'auto' captura o áudio da tela, 'disable' não
// captura nenhum áudio. Em NENHUM dos casos o microfone é envolvido: o
// getDisplayMedia por baixo não tem acesso a ele.
export function buildScreenShareConfig(options = {}) {
  const quality = SCREEN_QUALITY_PRESETS[options.quality] ? options.quality : '1080p';
  const frameRate = ALLOWED_FPS.includes(options.frameRate) ? options.frameRate : 30;
  const dims = SCREEN_QUALITY_PRESETS[quality];
  const withSystemAudio = options.audio !== false; // padrão: inclui som do sistema/aba
  return {
    encoderConfig: { width: dims.width, height: dims.height, frameRate },
    // 'motion' prioriza fluidez (ver VoiceContext) — mantido aqui.
    optimizationMode: 'motion',
    // O que vai como 2º argumento do createScreenVideoTrack:
    audioParam: withSystemAudio ? 'auto' : 'disable',
    quality,
    frameRate,
    withSystemAudio,
  };
}

// A LISTA de faixas que vão ser publicadas num compartilhamento de tela.
// Recebe a faixa de vídeo da tela e (opcionalmente) a faixa de áudio
// do SISTEMA/ABA que o createScreenVideoTrack devolveu. Garante, por
// construção, que a faixa do microfone (passada aqui só pra conferência)
// NUNCA entra nessa lista.
export function collectScreenPublishTracks(screenVideoTrack, screenSystemAudioTrack, localMicTrack) {
  const tracks = [screenVideoTrack, screenSystemAudioTrack].filter(Boolean);
  // Trava de segurança: se por qualquer motivo a faixa do microfone
  // aparecesse aqui, ela é removida — o compartilhamento jamais carrega
  // a voz do mic.
  return tracks.filter((t) => t && t !== localMicTrack);
}

// Verificação usada no código e nos testes: confirma que a voz do
// microfone NÃO está na transmissão de tela. Retorna true quando está
// tudo certo (nenhuma faixa de mic no conjunto compartilhado).
export function assertNoMicInScreenShare(publishedScreenTracks, localMicTrack) {
  if (!Array.isArray(publishedScreenTracks)) return true;
  if (!localMicTrack) return true;
  const micMediaTrack = typeof localMicTrack.getMediaStreamTrack === 'function'
    ? localMicTrack.getMediaStreamTrack()
    : localMicTrack;
  return !publishedScreenTracks.some((t) => {
    if (!t) return false;
    if (t === localMicTrack) return true;
    const media = typeof t.getMediaStreamTrack === 'function' ? t.getMediaStreamTrack() : t;
    return media && micMediaTrack && media === micMediaTrack;
  });
}
