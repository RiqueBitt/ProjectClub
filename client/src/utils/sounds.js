// Short notification sounds for a few key events. Files live in
// client/public/sounds/ (plain static assets — Vite serves anything in
// public/ as-is at the site root, no import/bundling needed) so replacing
// one is just dropping in a new file with the same name, no code changes.
//
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

export function playSound(name, volume = DEFAULT_VOLUME) {
  const src = SOUND_FILES[name];
  if (!src) return;
  try {
    const el = new Audio(src);
    el.volume = volume;
    // Playback can be blocked by the browser's autoplay policy if it fires
    // outside a user gesture (e.g. a message arriving while the tab is just
    // sitting there) — that's expected and not worth surfacing as an error.
    el.play().catch(() => {});
  } catch { /* not fatal — a missing/broken sound file shouldn't break the app */ }
}
