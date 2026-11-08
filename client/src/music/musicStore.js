import { create } from 'zustand';

// Player de música pessoal (YouTube Music): fila, faixa atual, tocando/pausado.
// O player de verdade (iframe escondido do YouTube) fica em MusicPlayer.jsx.
const load = () => { try { return JSON.parse(localStorage.getItem('pc-music') || '{}'); } catch { return {}; } };
const saved = load();
const persist = (s) => { try { localStorage.setItem('pc-music', JSON.stringify({ queue: s.queue.slice(0, 100), index: s.index, volume: s.volume })); } catch { /* sem storage */ } };

export const useMusic = create((set, get) => ({
  queue: Array.isArray(saved.queue) ? saved.queue : [],
  index: Number.isInteger(saved.index) ? saved.index : -1,
  volume: typeof saved.volume === 'number' ? saved.volume : 70,
  playing: false,
  panelOpen: false,
  position: 0,
  duration: 0,
  current() { const s = get(); return s.queue[s.index] || null; },
  openPanel(v = true) { set({ panelOpen: v }); },
  playNow(track, list) {
    const s = get();
    let queue = s.queue;
    let index;
    if (list && list.length) { queue = list.slice(0, 100); index = Math.max(0, queue.findIndex((t) => t.videoId === track.videoId)); }
    else { const at = queue.findIndex((t) => t.videoId === track.videoId); if (at >= 0) index = at; else { queue = [...queue, track]; index = queue.length - 1; } }
    set({ queue, index, playing: true }); persist(get());
  },
  enqueue(track) {
    const s = get();
    if (s.queue.some((t) => t.videoId === track.videoId)) return;
    const queue = [...s.queue, track];
    set({ queue, index: s.index < 0 ? 0 : s.index, playing: s.index < 0 ? true : s.playing }); persist(get());
  },
  removeAt(i) {
    const s = get();
    const queue = s.queue.filter((_, k) => k !== i);
    let index = s.index;
    if (i < index) index -= 1; else if (i === index) index = Math.min(index, queue.length - 1);
    set({ queue, index, playing: queue.length ? s.playing : false }); persist(get());
  },
  clear() { set({ queue: [], index: -1, playing: false }); persist(get()); },
  next() { const s = get(); if (s.index < s.queue.length - 1) { set({ index: s.index + 1, playing: true }); persist(get()); } else set({ playing: false }); },
  prev() { const s = get(); if (s.position > 4 || s.index <= 0) set({ seekTo: 0, seekNonce: Date.now() }); else { set({ index: s.index - 1, playing: true }); persist(get()); } },
  toggle() { const s = get(); if (s.index < 0 && s.queue.length) set({ index: 0, playing: true }); else set({ playing: !s.playing }); },
  setPlaying(v) { set({ playing: v }); },
  setVolume(v) { set({ volume: v }); persist(get()); },
  seek(sec) { set({ seekTo: sec, seekNonce: Date.now() }); },
  setProgress(position, duration) { set({ position, duration }); },
}));
