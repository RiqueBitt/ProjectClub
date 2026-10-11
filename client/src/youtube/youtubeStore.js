import { create } from 'zustand';

// YouTube pessoal do Project Club (botão na barra de cima): assistir sem
// precisar estar numa chamada. view: 'browse' | 'watch'; mini = player
// pequeno no canto enquanto você navega pelo app.
export const useYouTubeApp = create((set, get) => ({
  open: false,
  mini: false,
  view: 'browse',
  video: null, // { videoId, title, channel, channelId }
  history: [],
  queue: [], // "assistir depois" (toca antes dos relacionados)
  autoplay: (() => { try { return localStorage.getItem('pc.yt.autoplay') !== 'off'; } catch { return true; } })(),
  openApp() { set({ open: true, mini: false, view: get().video ? 'watch' : 'browse' }); },
  play(v) {
    if (!v?.videoId) return;
    const video = { videoId: v.videoId, title: v.title || '', channel: v.channel || '', channelId: v.channelId || null };
    set((s) => ({ video, open: true, mini: false, view: 'watch', history: [video, ...s.history.filter((h) => h.videoId !== video.videoId)].slice(0, 30) }));
  },
  browse() { set({ view: 'browse', mini: false, open: true }); },
  minimize() { if (get().video) set({ mini: true, open: false }); else set({ open: false }); },
  restore() { set({ open: true, mini: false, view: 'watch' }); },
  enqueue(v) {
    if (!v?.videoId) return;
    set((s) => (s.queue.some((q) => q.videoId === v.videoId) ? s : { queue: [...s.queue, { videoId: v.videoId, title: v.title || '', channel: v.channel || '', channelId: v.channelId || null }].slice(0, 50) }));
  },
  dequeue(videoId) { set((s) => ({ queue: s.queue.filter((q) => q.videoId !== videoId) })); },
  shiftQueue() { const [first, ...rest] = get().queue; set({ queue: rest }); return first || null; },
  setAutoplay(on) { try { localStorage.setItem('pc.yt.autoplay', on ? 'on' : 'off'); } catch { /* ignora */ } set({ autoplay: on }); },
  close() { set({ open: false, mini: false, video: null, view: 'browse' }); },
}));
