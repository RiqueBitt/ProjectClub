// Preferência de microfone/saída de áudio — fica no localStorage (não na
// conta) de propósito: é uma escolha por APARELHO (o notebook pode ter um
// headset USB que o celular nunca vai ter), não algo que faça sentido
// sincronizar entre dispositivos diferentes.
const MIC_KEY = 'voice.preferredMicId';
const SPEAKER_KEY = 'voice.preferredSpeakerId';
const SPEAKER_CHANGE_EVENT = 'voice:speaker-changed';

export function getPreferredMicId() { return localStorage.getItem(MIC_KEY) || ''; }
export function setPreferredMicId(id) {
  if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY);
}

export function getPreferredSpeakerId() { return localStorage.getItem(SPEAKER_KEY) || ''; }
export function setPreferredSpeakerId(id) {
  if (id) localStorage.setItem(SPEAKER_KEY, id); else localStorage.removeItem(SPEAKER_KEY);
  window.dispatchEvent(new CustomEvent(SPEAKER_CHANGE_EVENT, { detail: id || '' }));
}
export function onSpeakerPreferenceChange(handler) {
  const listener = (e) => handler(e.detail);
  window.addEventListener(SPEAKER_CHANGE_EVENT, listener);
  return () => window.removeEventListener(SPEAKER_CHANGE_EVENT, listener);
}

// Trocar a saída de áudio (alto-falantes/fones) só é suportado em
// navegadores baseados em Chromium (HTMLMediaElement.setSinkId) — Firefox e
// Safari não têm isso ainda. A tela de configurações esconde essa opção
// quando não suportado, em vez de oferecer um seletor que não faz nada.
export function isOutputSelectionSupported() {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export async function listAudioDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput'),
  };
}
