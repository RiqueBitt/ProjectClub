// Short notification sounds for a few key events. Files live in
// client/public/sounds/ (plain static assets — Vite serves anything in
// public/ as-is at the site root, no import/bundling needed) so replacing
// one is just dropping in a new file with the same name, no code changes.
//
import { useStore } from '../store/useStore';
// A fresh `new Audio()` per play (not one shared/reused element) is
// deliberate: two messages arriving close together should both play their
// full sound instead of the second cutting the first off mid-playback.
const SOUND_FILES = {
  callJoin: '/sounds/call-join.wav',
  callLeave: '/sounds/call-leave.wav',
  message: '/sounds/notification.wav',
  mention: '/sounds/notification.wav',
  friendRequest: '/sounds/notification.wav',
  dmCallRinging: '/sounds/dm-call-ringing.mp3',
  appOpen: '/sounds/app-open.wav',
  switchChannel: '/sounds/switch.wav',
};

const DEFAULT_VOLUME = 0.5;

// Item pedido: verificar se todos os toggles de Configurações têm efeito
// real. notificationSounds existia na tela ("Sons de notificação") mas
// nunca era lido em lugar nenhum — mexer nele não mudava nada de verdade.
// Só os sons que representam "algo aconteceu" (mensagem, menção, pedido de
// amizade, DM tocando) respeitam o toggle — sons de feedback da própria
// ação do usuário (entrar/sair de chamada, trocar de canal, abrir o app)
// continuam tocando sempre, já que desligá-los junto seria uma surpresa
// não pedida por quem só queria silenciar notificações de outras pessoas.
const NOTIFICATION_SOUNDS = new Set(['message', 'mention', 'friendRequest', 'dmCallRinging']);

export function playSound(name, volume = DEFAULT_VOLUME) {
  const src = SOUND_FILES[name];
  if (!src) return;
  if (NOTIFICATION_SOUNDS.has(name)) {
    const settings = useStore.getState().userSettings;
    if (settings && settings.notificationSounds === false) return;
  }
  try {
    const el = new Audio(src);
    el.volume = volume;
    // Playback can be blocked by the browser's autoplay policy if it fires
    // outside a user gesture (e.g. a message arriving while the tab is just
    // sitting there) — that's expected and not worth surfacing as an error.
    el.play().catch(() => {});
  } catch { /* not fatal — a missing/broken sound file shouldn't break the app */ }
}
