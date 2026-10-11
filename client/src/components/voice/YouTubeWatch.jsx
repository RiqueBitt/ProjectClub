import { useMusic } from '../../music/musicStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { parseYouTubeId, thumb, readCaptionsPref, writeCaptionsPref, applyCaptions } from './ytUtils.js';
import { ytRelated } from '../../api/endpoints';
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

const MUSIC_ICON = 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z';

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
  back10: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5M10 10v5M13 10h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z',
  fwd10: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5M10 10v5M13 10h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z',
  cc: 'M4 6h16v12H4zM10.5 10.2A2.2 2.2 0 1 0 10.5 13.8M17 10.2A2.2 2.2 0 1 0 17 13.8',
  ccOff: 'M4 6h16v12H4zM10.5 10.2A2.2 2.2 0 1 0 10.5 13.8M17 10.2A2.2 2.2 0 1 0 17 13.8M3 3l18 18',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z',
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
  const [cc, setCc] = useState(readCaptionsPref);
  const [nativeCtl, setNativeCtl] = useState(() => { try { return localStorage.getItem('pc.ytwatch.native') === '1'; } catch { return false; } });
  const [showMenu, setShowMenu] = useState(false);
  const lastVolRef = useRef(80);

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
        playerVars: {
          autoplay: st?.playing ? 1 : 0, controls: nativeCtl ? 1 : 0, disablekb: nativeCtl ? 0 : 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
          start: Math.floor(expectedRef.current(st)), origin: window.location.origin, hl: 'pt-BR', cc_lang_pref: 'pt', cc_load_policy: readCaptionsPref() ? 1 : 0,
        },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            try { e.target.setVolume(readVol()); } catch { /* ignora */ }
            applyCaptions(e.target, readCaptionsPref());
            apply();
          },
          onApiChange: (e) => applyCaptions(e.target, readCaptionsPref()),
          onStateChange: (e) => {
            const s = stateRef.current;
            if (e.data === 0 && s?.videoId) emitRef.current('yt:next', { fromVideoId: s.videoId }); // terminou
            if (e.data === 1) { setBlocked(false); applyCaptions(e.target, readCaptionsPref()); }
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
  }, [apply, nativeCtl]);

  // Música da call começou: pausa o player pessoal pra não tocar duas coisas.
  useEffect(() => {
    if (state?.mode === 'music' && state?.playing) { try { useMusic.getState().setPlaying(false); } catch { /* ignora */ } }
  }, [state?.mode, state?.playing, state?.videoId]);

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
    if (v > 0) lastVolRef.current = v;
    setVolume(v);
    try { localStorage.setItem('pc.ytwatch.volume', String(v)); } catch { /* ignora */ }
    try { playerRef.current?.setVolume(v); if (v > 0) playerRef.current?.unMute(); } catch { /* ignora */ }
  };

  const pos = () => playerRef.current?.getCurrentTime?.() || expectedPos();
  // Tocar depois que o vídeo acabou recomeça do início (antes ficava preso no fim).
  const togglePlay = () => {
    if (state.playing) { emit('yt:pause', { positionSec: pos() }); return; }
    const d = playerRef.current?.getDuration?.() || dur;
    const p = pos();
    emit('yt:play', { positionSec: d && p >= d - 1.5 ? 0 : p });
  };
  const seekBy = (delta) => {
    const d = playerRef.current?.getDuration?.() || dur || Infinity;
    emit('yt:seek', { positionSec: Math.max(0, Math.min(d - 1, pos() + delta)) });
  };
  // Próximo: fila primeiro; com a fila vazia, toca um vídeo relacionado
  // (antes fechava o vídeo para todo mundo).
  const next = async () => {
    if ((state.queue || []).length) { emit('yt:next'); return; }
    try {
      const d = await ytRelated(state.videoId);
      const v = (d?.videos || []).find((x) => !x.live && x.videoId !== state.videoId);
      if (v) emit('yt:open', { videoId: v.videoId, title: v.title });
    } catch { /* ignora */ }
  };
  const toggleCc = () => {
    const on = !cc; setCc(on); writeCaptionsPref(on);
    applyCaptions(playerRef.current, on);
  };
  const toggleNative = () => {
    const on = !nativeCtl;
    try { localStorage.setItem('pc.ytwatch.native', on ? '1' : '0'); } catch { /* ignora */ }
    readyRef.current = false; loadedIdRef.current = null;
    setNativeCtl(on); setShowMenu(false);
  };
  const toggleMute = () => setVol(volume ? 0 : (lastVolRef.current || 80));
  const unblock = () => { setBlocked(false); try { playerRef.current?.playVideo(); } catch { /* ignora */ } };
  const toggleFull = () => {
    const el = wrapRef.current;
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    else el?.requestFullscreen?.().catch(() => {});
  };

  const onKeyDown = (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable="true"]') && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
    else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); seekBy(k === 'j' ? -10 : -5); }
    else if (k === 'arrowright' || k === 'l') { e.preventDefault(); seekBy(k === 'l' ? 10 : 5); }
    else if (k === 'm') toggleMute();
    else if (k === 'f') toggleFull();
    else if (k === 'c') toggleCc();
  };

  if (!state?.videoId) return null;
  const isMusic = state.mode === 'music';
  const queue = state.queue || [];
  const shown = scrub ?? cur;

  return (
    <div ref={wrapRef} className={`vc-screen ytw-stage${isMusic ? ' ytw-music' : ''}${nativeCtl ? ' is-native' : ''}`} data-testid="yt-stage" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="ytw-player" ref={hostRef} />
      {isMusic && (
        <div className="ytw-music-art" aria-hidden="true">
          <img className="ytw-music-bg" src={`https://i.ytimg.com/vi/${state.videoId}/hqdefault.jpg`} alt="" />
          <div className={`ytw-music-disc${state.playing ? ' is-playing' : ''}`}>
            <img src={`https://i.ytimg.com/vi/${state.videoId}/hqdefault.jpg`} alt="" />
          </div>
          <div className="ytw-music-eq" data-on={state.playing ? '1' : '0'}><i /><i /><i /><i /><i /></div>
        </div>
      )}
      {apiError && <div className="ytw-overlay ytw-msg" role="alert">{apiError}</div>}
      {blocked && !apiError && (
        <button type="button" className="ytw-overlay ytw-unblock" onClick={unblock}>
          <YIcon d={P.play} size={28} /> {isMusic ? 'Clique para ouvir junto' : 'Clique para assistir junto'}
        </button>
      )}
      <div className="ytw-top">
        <span className="ytw-badge"><YIcon d={isMusic ? MUSIC_ICON : P.yt} size={16} /> {isMusic ? 'Ouvindo juntos' : 'Assistindo juntos'}</span>
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
          <button type="button" className="ytw-btn" onClick={() => seekBy(-10)} aria-label="Voltar 10 segundos" title="Voltar 10s (J)"><YIcon d={P.back10} /></button>
          <button type="button" className="ytw-btn" onClick={() => seekBy(10)} aria-label="Avançar 10 segundos" title="Avançar 10s (L)"><YIcon d={P.fwd10} /></button>
          <button type="button" className="ytw-btn" onClick={next} aria-label="Próximo" title={queue.length ? 'Próximo da fila' : 'Próximo (vídeo relacionado)'}>
            <YIcon d={P.next} />
          </button>
          <span className="ytw-time">{fmt(shown)} / {fmt(dur)}</span>
          <label className="ytw-vol" title={`Volume (só para você): ${volume}%`}>
            <button type="button" className="ytw-btn" onClick={(e) => { e.preventDefault(); toggleMute(); }} aria-label={volume ? 'Silenciar vídeo' : 'Ativar som do vídeo'}>
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
          <button type="button" className="ytw-btn" onClick={() => onAdd(isMusic ? 'music' : 'youtube')} aria-label={isMusic ? 'Adicionar música' : 'Adicionar vídeo'} title={isMusic ? 'Adicionar música' : 'Adicionar vídeo'}><YIcon d={P.plus} /></button>
          {!isMusic && (
            <button type="button" className={`ytw-btn${cc ? ' is-on' : ''}`} onClick={toggleCc} aria-pressed={cc} aria-label={cc ? 'Desligar legendas' : 'Ligar legendas'} title={cc ? 'Legendas ligadas (C)' : 'Legendas desligadas, inclusive automáticas (C)'}>
              <YIcon d={cc ? P.cc : P.ccOff} />
            </button>
          )}
          {!isMusic && (
            <span className="ytw-menu-wrap">
              <button type="button" className={`ytw-btn${showMenu ? ' is-on' : ''}`} onClick={() => setShowMenu((v) => !v)} aria-expanded={showMenu} aria-label="Configurações do vídeo" title="Configurações (qualidade, velocidade, legendas)"><YIcon d={P.gear} /></button>
              {showMenu && (
                <div className="ytw-menu" role="menu">
                  <button type="button" role="menuitemcheckbox" aria-checked={cc} onClick={toggleCc}>
                    <span>Legendas</span><b>{cc ? 'Ligadas' : 'Desligadas'}</b>
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={nativeCtl} onClick={toggleNative}>
                    <span>Controles do YouTube<small>Mostra a engrenagem do YouTube para escolher qualidade (até 4K), velocidade e idioma da legenda.</small></span>
                    <b>{nativeCtl ? 'Ligados' : 'Desligados'}</b>
                  </button>
                </div>
              )}
            </span>
          )}
          <button type="button" className="ytw-btn" onClick={toggleFull} aria-label="Tela cheia" title="Tela cheia (F)"><YIcon d={P.expand} /></button>
          <button type="button" className="ytw-btn ytw-danger" onClick={() => emit('yt:close')} aria-label={isMusic ? 'Parar música' : 'Fechar vídeo'} title={isMusic ? 'Parar música para todos' : 'Fechar vídeo para todos'}><YIcon d={P.close} /></button>
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
          <button type="button" role="menuitem" className="ytw-act-item" onClick={() => { setOpen(false); onPick('music'); }}>
            <span className="ytw-yt ytw-ytm"><YIcon d={MUSIC_ICON} size={22} /></span>
            <span><strong>YouTube Music - Ouvir juntos</strong><small>Músicas tocando para todo mundo da chamada</small></span>
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
