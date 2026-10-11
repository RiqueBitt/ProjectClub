import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { parseYouTubeId, thumb } from './ytUtils.js';
import YouTubeBrowser, { RelatedList } from './YouTubeBrowser.jsx';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/ytwatch.css';

// ============================================================
// YouTube "Assistir juntos" dentro da chamada de voz.
// Estado vem do servidor (sockets/ytWatch.js) via 'yt:state':
//   { videoId, title, playing, positionSec, updatedAt, hostId, queue[] }
// Cada cliente aplica o estado no seu player (IFrame Player API do
// youtube-nocookie): corrige a posição se desviar mais de 1,5s e
// segue play/pausa. Controles locais mandam eventos; volume é só local.
// ============================================================

const DRIFT_SEC = 1.5;

export { parseYouTubeId };


// Carrega a IFrame API uma vez só.
let apiPromise = null;
export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* ignora */ } resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('Não consegui carregar o player do YouTube.')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

// Estado compartilhado da sala + ações. channelId null = desligado.
export function useYouTubeWatch(channelId) {
  const { socket } = useSocket() || {};
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const offsetRef = useRef(0); // relógio do servidor - relógio local

  useEffect(() => {
    setState(null);
    if (!socket || !channelId) return undefined;
    const onState = (msg) => {
      if (msg?.channelId !== channelId) return;
      if (Number.isFinite(msg.serverNow)) offsetRef.current = msg.serverNow - Date.now();
      setState(msg.state || null);
    };
    const onError = (msg) => { if (msg?.channelId === channelId) setError(msg.reason || 'Algo deu errado.'); };
    const ask = () => socket.emit('yt:get', { channelId });
    const onJoined = (msg) => { if (msg?.channelId === channelId) ask(); };
    socket.on('yt:state', onState);
    socket.on('yt:error', onError);
    socket.on('voice:joined', onJoined);
    socket.on('connect', ask);
    ask();
    return () => {
      socket.off('yt:state', onState);
      socket.off('yt:error', onError);
      socket.off('voice:joined', onJoined);
      socket.off('connect', ask);
    };
  }, [socket, channelId]);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const emit = useCallback((event, payload = {}) => {
    if (socket && channelId) socket.emit(event, { channelId, ...payload });
  }, [socket, channelId]);

  const expectedPos = useCallback((st = state) => {
    if (!st) return 0;
    const now = Date.now() + offsetRef.current;
    return Math.max(0, (st.positionSec || 0) + (st.playing ? (now - (st.updatedAt || now)) / 1000 : 0));
  }, [state]);

  return { state, error, setError, emit, expectedPos, active: !!state?.videoId };
}

function YIcon({ d, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}
const P = {
  play: 'M7 4.5v15l12-7.5-12-7.5Z',
  pause: 'M8 5v14M16 5v14',
  next: 'M5 5v14l10-7L5 5ZM19 5v14',
  close: 'M6 6l12 12M18 6 6 18',
  queue: 'M4 6h12M4 12h12M4 18h8M17 15v6M14 18h6',
  vol: 'M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6',
  volOff: 'M4 9v6h4l5 4V5L8 9H4ZM17 10l4 4M21 10l-4 4',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
  upnext: 'M4 6h10M4 11h10M4 16h6M16 13v7l5-3.5-5-3.5Z',
  yt: 'M3.5 8.2c.2-1.6 1.3-2.7 2.9-2.8C8.2 5.2 10 5.1 12 5.1s3.8.1 5.6.3c1.6.1 2.7 1.2 2.9 2.8.2 1.3.2 2.5.2 3.8s0 2.5-.2 3.8c-.2 1.6-1.3 2.7-2.9 2.8-1.8.2-3.6.3-5.6.3s-3.8-.1-5.6-.3c-1.6-.1-2.7-1.2-2.9-2.8C3.3 14.5 3.3 13.3 3.3 12s0-2.5.2-3.8ZM10 9v6l5-3-5-3Z',
};
export const ACTIVITY_ICON = 'M5 4h5v5H5zM14 4h5v5h-5zM5 15h5v5H5zM14.5 15.2l4.3 2.3-4.3 2.3z';

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

function readVol() {
  try { const v = Number(localStorage.getItem('pc.ytwatch.volume')); return Number.isFinite(v) && localStorage.getItem('pc.ytwatch.volume') !== null ? v : 80; } catch { return 80; }
}

// Palco do vídeo dentro da chamada.
export function YouTubeStage({ yt, viewers = [], onAdd }) {
  const { state, emit, expectedPos } = yt;
  const wrapRef = useRef(null);
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const loadedIdRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const expectedRef = useRef(expectedPos);
  const emitRef = useRef(emit);
  emitRef.current = emit;
  expectedRef.current = expectedPos;
  const [apiError, setApiError] = useState(null);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [title, setTitle] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(readVol);
  const [showQueue, setShowQueue] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [scrub, setScrub] = useState(null);

  // Aplica o estado do servidor no player.
  const apply = useCallback(() => {
    const p = playerRef.current; const st = stateRef.current;
    if (!p || !readyRef.current || !st?.videoId) return;
    const want = expectedRef.current(st);
    if (loadedIdRef.current !== st.videoId) {
      loadedIdRef.current = st.videoId;
      if (st.playing) p.loadVideoById({ videoId: st.videoId, startSeconds: want });
      else p.cueVideoById({ videoId: st.videoId, startSeconds: want });
      return;
    }
    const ps = p.getPlayerState?.();
    const now = p.getCurrentTime?.() || 0;
    if (Math.abs(now - want) > DRIFT_SEC) p.seekTo(want, true);
    if (st.playing && ps !== 1 && ps !== 3) p.playVideo();
    if (!st.playing && ps === 1) p.pauseVideo();
  }, []);

  // Cria o player uma vez.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      // O YT troca o elemento pelo <iframe>: cria um nó fora do React.
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      const st = stateRef.current;
      loadedIdRef.current = st?.videoId || null;
      playerRef.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId: st?.videoId,
        width: '100%', height: '100%',
        playerVars: { autoplay: st?.playing ? 1 : 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, start: Math.floor(expectedRef.current(st)), origin: window.location.origin },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            try { e.target.setVolume(readVol()); } catch { /* ignora */ }
            apply();
          },
          onStateChange: (e) => {
            const s = stateRef.current;
            if (e.data === 0 && s?.videoId) emitRef.current('yt:next', { fromVideoId: s.videoId }); // terminou
            if (e.data === 1) setBlocked(false);
            try { const d = e.target.getVideoData?.(); if (d?.title) setTitle(d.title); } catch { /* ignora */ }
          },
          onError: () => setApiError('Este vídeo não pode ser reproduzido aqui.'),
        },
      });
    }).catch((err) => { if (!cancelled) setApiError(err.message); });
    return () => {
      cancelled = true; readyRef.current = false;
      try { playerRef.current?.destroy?.(); } catch { /* ignora */ }
      playerRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [apply]);

  // Estado novo do servidor → aplica.
  useEffect(() => { setApiError(null); apply(); }, [state, apply]);
  useEffect(() => { if (state?.title) setTitle(state.title); else if (state?.videoId !== loadedIdRef.current) setTitle(''); }, [state?.title, state?.videoId]);

  // Tique: progresso + checagem de deriva + autoplay bloqueado.
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p || !readyRef.current) return;
      setCur(p.getCurrentTime?.() || 0);
      setDur(p.getDuration?.() || 0);
      const st = stateRef.current;
      if (!st) return;
      const ps = p.getPlayerState?.();
      // Navegador bloqueou o som automático: pede um clique.
      if (st.playing && (ps === 2 || ps === -1 || ps === 5)) setBlocked(true);
      apply();
    }, 1000);
    return () => clearInterval(t);
  }, [apply]);

  const setVol = (v) => {
    setVolume(v);
    try { localStorage.setItem('pc.ytwatch.volume', String(v)); } catch { /* ignora */ }
    try { playerRef.current?.setVolume(v); if (v > 0) playerRef.current?.unMute(); } catch { /* ignora */ }
  };

  const pos = () => playerRef.current?.getCurrentTime?.() || expectedPos();
  const togglePlay = () => emit(state.playing ? 'yt:pause' : 'yt:play', { positionSec: pos() });
  const unblock = () => { setBlocked(false); try { playerRef.current?.playVideo(); } catch { /* ignora */ } };
  const toggleFull = () => {
    const el = wrapRef.current;
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    else el?.requestFullscreen?.().catch(() => {});
  };

  if (!state?.videoId) return null;
  const queue = state.queue || [];
  const shown = scrub ?? cur;

  return (
    <div ref={wrapRef} className="vc-screen ytw-stage" data-testid="yt-stage">
      <div className="ytw-player" ref={hostRef} />
      {apiError && <div className="ytw-overlay ytw-msg" role="alert">{apiError}</div>}
      {blocked && !apiError && (
        <button type="button" className="ytw-overlay ytw-unblock" onClick={unblock}>
          <YIcon d={P.play} size={28} /> Clique para assistir junto
        </button>
      )}
      <div className="ytw-top">
        <span className="ytw-badge"><YIcon d={P.yt} size={16} /> Assistindo juntos</span>
        <span className="ytw-title truncate" data-no-translate title={title}>{title || 'YouTube'}</span>
        <div className="ytw-viewers" aria-label={`${viewers.length} assistindo`}>
          {viewers.slice(0, 5).map((v) => <UserAvatar key={v.id} user={v} size={22} />)}
          {viewers.length > 5 && <span className="ytw-more">+{viewers.length - 5}</span>}
        </div>
      </div>
      <div className="ytw-bar">
        <input
          type="range" className="ytw-seek" min="0" max={Math.max(1, Math.floor(dur))} step="1"
          value={Math.min(Math.floor(shown), Math.max(1, Math.floor(dur)))} aria-label="Posição do vídeo"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={(e) => { emit('yt:seek', { positionSec: Number(e.currentTarget.value) }); setScrub(null); }}
          onKeyUp={(e) => { if (scrub != null) { emit('yt:seek', { positionSec: Number(e.currentTarget.value) }); setScrub(null); } }}
        />
        <div className="ytw-row">
          <button type="button" className="ytw-btn" onClick={togglePlay} aria-label={state.playing ? 'Pausar' : 'Tocar'} title={state.playing ? 'Pausar' : 'Tocar'}>
            <YIcon d={state.playing ? P.pause : P.play} />
          </button>
          <button type="button" className="ytw-btn" onClick={() => emit('yt:next')} aria-label="Próximo da fila" title={queue.length ? 'Próximo da fila' : 'Fila vazia: encerra o vídeo'}>
            <YIcon d={P.next} />
          </button>
          <span className="ytw-time">{fmt(shown)} / {fmt(dur)}</span>
          <label className="ytw-vol" title={`Volume (só para você): ${volume}%`}>
            <button type="button" className="ytw-btn" onClick={() => setVol(volume ? 0 : 80)} aria-label={volume ? 'Silenciar vídeo' : 'Ativar som do vídeo'}>
              <YIcon d={volume ? P.vol : P.volOff} />
            </button>
            <input type="range" min="0" max="100" step="1" value={volume} onChange={(e) => setVol(Number(e.target.value))} aria-label="Volume do vídeo (só para você)" />
          </label>
          <span className="ytw-spacer" />
          <button type="button" className={`ytw-btn${showNext ? ' is-on' : ''}`} onClick={() => { setShowQueue(false); setShowNext((v) => !v); }} aria-label="A seguir" aria-expanded={showNext} title="A seguir (vídeos relacionados)" data-testid="yt-next-toggle">
            <YIcon d={P.upnext} />
          </button>
          <button type="button" className={`ytw-btn${showQueue ? ' is-on' : ''}`} onClick={() => { setShowNext(false); setShowQueue((v) => !v); }} aria-label="Fila" aria-expanded={showQueue} title="Fila">
            <YIcon d={P.queue} />{queue.length > 0 && <span className="ytw-count">{queue.length}</span>}
          </button>
          <button type="button" className="ytw-btn" onClick={onAdd} aria-label="Adicionar vídeo" title="Adicionar vídeo"><YIcon d={P.plus} /></button>
          <button type="button" className="ytw-btn" onClick={toggleFull} aria-label="Tela cheia" title="Tela cheia"><YIcon d={P.expand} /></button>
          <button type="button" className="ytw-btn ytw-danger" onClick={() => emit('yt:close')} aria-label="Fechar vídeo" title="Fechar vídeo para todos"><YIcon d={P.close} /></button>
        </div>
      </div>
      {showNext && (
        <div className="ytw-queue ytw-next" aria-label="A seguir">
          <p className="ytw-queue-h">A seguir</p>
          <RelatedList
            videoId={state.videoId} compact
            onPlay={(v) => { emit('yt:open', { videoId: v.videoId, title: v.title }); setShowNext(false); }}
            onQueue={(v) => emit('yt:queue:add', { videoId: v.videoId, title: v.title })}
          />
        </div>
      )}
      {showQueue && (
        <div className="ytw-queue" role="list" aria-label="Fila">
          <p className="ytw-queue-h">Fila ({queue.length})</p>
          {queue.length === 0 && <p className="ytw-empty">Nada na fila. Use + para adicionar.</p>}
          {queue.map((q, i) => (
            <div key={`${q.videoId}-${i}`} className="ytw-qitem" role="listitem">
              <img src={thumb(q.videoId)} alt="" loading="lazy" />
              <span className="truncate" data-no-translate>{q.title || q.videoId}</span>
              <button type="button" className="ytw-btn" onClick={() => emit('yt:queue:remove', { index: i })} aria-label="Remover da fila"><YIcon d={P.close} size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Escolher vídeo: navegador do YouTube (busca, em alta, a seguir, link colado).
export function YouTubePicker({ yt, onClose }) {
  return <YouTubeBrowser yt={yt} onClose={onClose} />;
}

// Botão "Atividades" do dock + menu.
export function ActivitiesButton({ onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="ytw-act">
      <button
        type="button" className={`vc-ctrl${open ? ' is-active' : ''}`} onClick={() => setOpen((v) => !v)}
        aria-label="Atividades" aria-expanded={open} title="Atividades"
      >
        <YIcon d={ACTIVITY_ICON} size={21} />
        <span className="vc-ctrl-label">Atividades</span>
      </button>
      {open && (
        <div className="ytw-act-pop" role="menu" aria-label="Atividades">
          <p className="ytw-sub">Atividades</p>
          <button type="button" role="menuitem" className="ytw-act-item" onClick={() => { setOpen(false); onPick('youtube'); }}>
            <span className="ytw-yt"><YIcon d={P.yt} size={22} /></span>
            <span><strong>YouTube - Assistir juntos</strong><small>Vídeos sincronizados com a chamada</small></span>
          </button>
        </div>
      )}
    </div>
  );
}

export function YouTubeToast({ yt }) {
  if (!yt.error) return null;
  return <div className="ytw-toast" role="status">{yt.error}</div>;
}
