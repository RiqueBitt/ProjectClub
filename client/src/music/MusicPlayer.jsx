import { useEffect, useRef, useState } from 'react';
import { useMusic } from './musicStore';
import { loadYouTubeApi } from '../components/voice/YouTubeWatch.jsx';
import { ytSearch, ytTrending } from '../api/endpoints';
import '../styles/music.css';

// YouTube Music no Project Club: player pessoal (toca só pra você), com busca,
// gêneros, fila e mini player que continua tocando enquanto você navega.
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const toTrack = (v) => ({ videoId: v.videoId, title: v.title, artist: v.channel || '', thumbnail: v.thumbnail || thumb(v.videoId), duration: v.duration || '' });

function Ico({ d, size = 18, fill }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const I = {
  play: 'M8 5.5v13l10-6.5z', pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  next: 'M6 5.5v13l8.5-6.5zM17 5v14', prev: 'M18 5.5v13l-8.5-6.5zM7 5v14',
  note: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18',
  vol: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
};

const GENRES = [
  { id: 'hot', label: 'Em alta', q: null },
  { id: 'funk', label: 'Funk', q: 'funk lançamento 2026' },
  { id: 'sertanejo', label: 'Sertanejo', q: 'sertanejo mais tocadas' },
  { id: 'pop', label: 'Pop', q: 'pop hits' },
  { id: 'rap', label: 'Rap / Trap', q: 'trap nacional' },
  { id: 'rock', label: 'Rock', q: 'rock clássicos' },
  { id: 'gospel', label: 'Gospel', q: 'louvores mais tocados' },
  { id: 'lofi', label: 'Lo-fi', q: 'lofi hip hop' },
  { id: 'games', label: 'Trilhas de jogos', q: 'video game soundtrack' },
];

// Player escondido (iframe do YouTube) — sempre montado no app.
export function MusicEngine() {
  const { queue, index, playing, volume, seekNonce } = useMusic();
  const cur = queue[index] || null;
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const curIdRef = useRef(null);

  useEffect(() => {
    if (!cur || playerRef.current) return;
    let dead = false;
    loadYouTubeApi().then((YT) => {
      if (dead || !hostRef.current) return;
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      playerRef.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com', width: 200, height: 112, videoId: cur.videoId,
        playerVars: { autoplay: 1, controls: 0, playsinline: 1, rel: 0 },
        events: {
          onReady: (e) => { readyRef.current = true; curIdRef.current = cur.videoId; e.target.setVolume(useMusic.getState().volume); if (useMusic.getState().playing) e.target.playVideo(); },
          onStateChange: (e) => {
            if (e.data === 0) useMusic.getState().next();
            else if (e.data === 1 && !useMusic.getState().playing) useMusic.getState().setPlaying(true);
          },
          onError: () => useMusic.getState().next(),
        },
      });
    }).catch(() => {});
    return () => { dead = true; };
  }, [cur]);

  useEffect(() => {
    const p = playerRef.current; if (!p || !readyRef.current || !cur) return;
    if (curIdRef.current !== cur.videoId) { curIdRef.current = cur.videoId; p.loadVideoById(cur.videoId); if (!playing) p.pauseVideo(); return; }
    if (playing) p.playVideo(); else p.pauseVideo();
  }, [cur, playing]);
  useEffect(() => { const p = playerRef.current; if (p && readyRef.current) p.setVolume(volume); }, [volume]);
  useEffect(() => { const p = playerRef.current; if (p && readyRef.current && seekNonce) p.seekTo(useMusic.getState().seekTo || 0, true); }, [seekNonce]);
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current; if (!p || !readyRef.current || !useMusic.getState().playing) return;
      try { useMusic.getState().setProgress(p.getCurrentTime() || 0, p.getDuration() || 0); } catch { /* ignora */ }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  return <div ref={hostRef} className="mu-engine" aria-hidden="true" />;
}

function Results({ items, onPlay, onAdd, loading }) {
  if (loading) return <div className="mu-list">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="mu-row mu-skel" />)}</div>;
  if (!items.length) return <p className="mu-empty">Nada encontrado.</p>;
  return (
    <div className="mu-list">
      {items.map((t) => (
        <div key={t.videoId} className="mu-row">
          <button type="button" className="mu-row-main" onClick={() => onPlay(t)}>
            <img src={t.thumbnail} alt="" loading="lazy" />
            <span className="mu-row-text"><b data-no-translate>{t.title}</b><small data-no-translate>{t.artist}{t.duration ? ` · ${t.duration}` : ''}</small></span>
          </button>
          <button type="button" className="mu-icon-btn" onClick={() => onAdd(t)} title="Adicionar à fila" aria-label="Adicionar à fila"><Ico d={I.plus} size={16} /></button>
        </div>
      ))}
    </div>
  );
}

export function MusicPanel() {
  const m = useMusic();
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('hot');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('browse');

  const run = (query, g) => {
    setLoading(true);
    const p = query ? ytSearch(query) : (g?.q ? ytSearch(g.q) : ytTrending('music'));
    p.then((d) => setItems((d?.items || d?.videos || []).filter((v) => !v.live).map(toTrack))).catch(() => setItems([])).finally(() => setLoading(false));
  };
  useEffect(() => { if (m.panelOpen && !items.length) run(null, GENRES[0]); }, [m.panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!m.panelOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') m.openPanel(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [m.panelOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m.panelOpen) return null;

  return (
    <div className="mu-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) m.openPanel(false); }}>
      <div className="mu-panel" role="dialog" aria-label="YouTube Music">
        <div className="mu-head">
          <span className="mu-logo"><Ico d={I.note} size={18} /></span>
          <strong>Música</strong>
          <div className="mu-tabs">
            <button type="button" className={tab === 'browse' ? 'on' : ''} onClick={() => setTab('browse')}>Explorar</button>
            <button type="button" className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>Fila ({m.queue.length})</button>
          </div>
          <button type="button" className="mu-icon-btn" onClick={() => m.openPanel(false)} aria-label="Fechar"><Ico d={I.x} /></button>
        </div>
        {tab === 'browse' ? (
          <>
            <form className="mu-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { setGenre(null); run(q.trim()); } }}>
              <Ico d={I.search} size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar músicas, artistas, álbuns…" aria-label="Buscar músicas" />
            </form>
            <div className="mu-chips">
              {GENRES.map((g) => (
                <button key={g.id} type="button" className={genre === g.id ? 'on' : ''} onClick={() => { setGenre(g.id); setQ(''); run(null, g); }}>{g.label}</button>
              ))}
            </div>
            <Results items={items} loading={loading} onPlay={(t) => m.playNow(t, items)} onAdd={(t) => m.enqueue(t)} />
          </>
        ) : (
          <div className="mu-list">
            {!m.queue.length && <p className="mu-empty">A fila está vazia. Toque uma música em Explorar.</p>}
            {m.queue.map((t, i) => (
              <div key={`${t.videoId}-${i}`} className={`mu-row${i === m.index ? ' is-current' : ''}`}>
                <button type="button" className="mu-row-main" onClick={() => m.playNow(t)}>
                  <img src={t.thumbnail} alt="" loading="lazy" />
                  <span className="mu-row-text"><b data-no-translate>{t.title}</b><small data-no-translate>{t.artist}</small></span>
                </button>
                <button type="button" className="mu-icon-btn" onClick={() => m.removeAt(i)} aria-label="Tirar da fila"><Ico d={I.x} size={15} /></button>
              </div>
            ))}
            {m.queue.length > 0 && <button type="button" className="mu-clear" onClick={() => m.clear()}>Limpar fila</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export function MiniMusicBar() {
  const m = useMusic();
  const cur = m.queue[m.index];
  if (!cur) return null;
  const pct = m.duration ? Math.min(100, (m.position / m.duration) * 100) : 0;
  return (
    <div className="mu-mini" role="region" aria-label="Tocando agora">
      <button type="button" className="mu-mini-info" onClick={() => m.openPanel(true)} title="Abrir música">
        <img src={cur.thumbnail} alt="" />
        <span className="mu-row-text"><b data-no-translate>{cur.title}</b><small data-no-translate>{cur.artist}</small></span>
      </button>
      <div className="mu-mini-ctrls">
        <button type="button" className="mu-icon-btn" onClick={() => m.prev()} aria-label="Anterior"><Ico d={I.prev} size={16} fill /></button>
        <button type="button" className="mu-icon-btn mu-play" onClick={() => m.toggle()} aria-label={m.playing ? 'Pausar' : 'Tocar'}><Ico d={m.playing ? I.pause : I.play} size={18} fill /></button>
        <button type="button" className="mu-icon-btn" onClick={() => m.next()} aria-label="Próxima"><Ico d={I.next} size={16} fill /></button>
      </div>
      <input className="mu-vol" type="range" min="0" max="100" value={m.volume} onChange={(e) => m.setVolume(Number(e.target.value))} aria-label="Volume" />
      <button type="button" className="mu-icon-btn" onClick={() => { m.setPlaying(false); m.clear(); }} aria-label="Fechar player"><Ico d={I.x} size={15} /></button>
      <div className="mu-progress" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (m.duration) m.seek(((e.clientX - r.left) / r.width) * m.duration); }}>
        <span style={{ width: `${pct}%` }} />
        <em>{fmt(m.position)} / {fmt(m.duration)}</em>
      </div>
    </div>
  );
}
