import { create } from 'zustand';

// Cinema do Project Club (botão na barra de cima): filmes, séries,
// desenhos e anime do Internet Archive. view: 'browse' | 'detail' | 'watch';
// mini = player pequeno no canto enquanto você navega pelo app.
// "Continuar assistindo" e "Minha lista" ficam no navegador (localStorage).

const K_PROGRESS = 'pc.cine.progress';
const K_LIST = 'pc.cine.list';
const K_PREFS = 'pc.cine.prefs';

const load = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } };

// Só o que precisa para os cartões (sem a lista de arquivos).
export const cardOf = (it) => (it ? {
  id: it.id, title: it.title, year: it.year ?? null, kind: it.kind || 'filme', thumbnail: it.thumbnail, duration: it.duration ?? null,
} : null);

export const useCinema = create((set, get) => ({
  open: false,
  mini: false,
  view: 'browse',
  detailId: null,
  // { item, epIdx, srcIdx, sub (arquivo da legenda ou null), startAt }
  playing: null,
  progress: load(K_PROGRESS, {}),
  list: load(K_LIST, []),
  prefs: { autoNext: true, subLang: 'pt', quality: 'best', ...load(K_PREFS, {}) },

  openApp() {
    const s = get();
    set({ open: true, mini: false, view: s.playing ? 'watch' : (s.view === 'watch' ? 'browse' : s.view) });
  },
  browse() { set({ open: true, mini: false, view: 'browse' }); },
  showDetail(id, opts = {}) { if (id) set({ open: true, mini: false, view: 'detail', detailId: id, detailTrailer: !!opts.trailer, detailPluto: !!opts.pluto }); },
  detailPluto: false,
  detailTrailer: false,
  // 'lancamentos' (catálogo recente) | 'pluto' (grátis na Pluto TV) | 'classicos' (Internet Archive)
  section: (() => { try { const v = localStorage.getItem('pc.cine.section'); return ['classicos', 'pluto'].includes(v) ? v : 'lancamentos'; } catch { return 'lancamentos'; } })(),
  setSection(section) { try { localStorage.setItem('pc.cine.section', section); } catch { /* ignora */ } set({ section, view: 'browse', open: true, mini: false }); },
  play(item, epIdx = 0, opts = {}) {
    if (!item?.episodes?.length) return;
    const idx = Math.min(Math.max(0, epIdx), item.episodes.length - 1);
    const ep = item.episodes[idx];
    const p = get().progress[item.id];
    // Retoma de onde parou se for o mesmo episódio e não estava no fim.
    const resume = opts.startAt ?? (p && p.ep === ep.key && p.t > 5 && (!p.d || p.t < p.d - Math.min(30, p.d * 0.05)) ? p.t : 0);
    const { prefs } = get();
    const srcIdx = prefs.quality === 'light' ? Math.max(0, ep.sources.length - 1) : 0;
    const want = prefs.subLang;
    const sub = want === 'off' ? null
      : (ep.subtitles.find((s) => s.lang === 'pt-BR') || ep.subtitles.find((s) => s.lang.startsWith(want)) || null)?.file || null;
    set({ playing: { item, epIdx: idx, srcIdx, sub, startAt: resume || 0 }, open: true, mini: false, view: 'watch', detailId: item.id });
  },
  setSource(srcIdx, startAt) {
    const p = get().playing; if (!p) return;
    set({ playing: { ...p, srcIdx, startAt } });
    get().setPrefs({ quality: srcIdx === 0 ? 'best' : (srcIdx === p.item.episodes[p.epIdx].sources.length - 1 ? 'light' : get().prefs.quality) });
  },
  setSub(file) {
    const p = get().playing; if (!p) return;
    set({ playing: { ...p, sub: file } });
    const lang = file ? (p.item.episodes[p.epIdx].subtitles.find((s) => s.file === file)?.lang || 'pt') : 'off';
    get().setPrefs({ subLang: lang });
  },
  nextEpisode() {
    const p = get().playing; if (!p) return false;
    if (p.epIdx + 1 >= p.item.episodes.length) return false;
    get().play(p.item, p.epIdx + 1, { startAt: 0 });
    return true;
  },
  setPrefs(patch) { const prefs = { ...get().prefs, ...patch }; save(K_PREFS, prefs); set({ prefs }); },
  minimize() { if (get().playing) set({ mini: true, open: false }); else set({ open: false }); },
  restore() { set({ open: true, mini: false, view: 'watch' }); },
  close() { set({ open: false, mini: false, playing: null, view: get().view === 'watch' ? 'browse' : get().view }); },
  stop() { set({ playing: null, mini: false, view: 'detail' }); },

  saveProgress(item, ep, epIdx, t, d) {
    if (!item || !ep || !Number.isFinite(t)) return;
    const progress = { ...get().progress };
    // "Terminou" = créditos finais: últimos 30 s (ou 5% em vídeos curtos).
    const done = d > 0 && t > d - Math.min(30, d * 0.05);
    // Terminou o último episódio: sai do "Continuar assistindo".
    if (done && epIdx >= item.episodes.length - 1) delete progress[item.id];
    else {
      progress[item.id] = {
        ...cardOf(item), ep: done ? item.episodes[epIdx + 1]?.key : ep.key, epIdx: done ? epIdx + 1 : epIdx,
        epTitle: done ? item.episodes[epIdx + 1]?.title : ep.title, epCount: item.episodes.length,
        t: done ? 0 : Math.floor(t), d: done ? (item.episodes[epIdx + 1]?.duration || 0) : Math.floor(d || 0), at: Date.now(),
      };
    }
    const keep = Object.values(progress).sort((a, b) => b.at - a.at).slice(0, 40);
    const trimmed = Object.fromEntries(keep.map((x) => [x.id, x]));
    save(K_PROGRESS, trimmed);
    set({ progress: trimmed });
  },
  forget(id) { const progress = { ...get().progress }; delete progress[id]; save(K_PROGRESS, progress); set({ progress }); },
  toggleList(item) {
    const c = cardOf(item); if (!c) return;
    const list = get().list.some((x) => x.id === c.id) ? get().list.filter((x) => x.id !== c.id) : [{ ...c, at: Date.now() }, ...get().list].slice(0, 100);
    save(K_LIST, list); set({ list });
  },
}));
