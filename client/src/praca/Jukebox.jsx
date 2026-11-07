// Jukebox da Danceteria — DENTRO do Club Penguin.
//
// - O botão é do próprio jogo: uma jukebox em cima da mesinha do canto direito
//   da Danceteria (interface.swf, server/waddle/praca-voice/voice.as.tpl).
//   Clicar chama window.pracaJukeboxToggle; a página devolve se está tocando
//   (pracaJukeboxState) e o ícone dança no ritmo.
// - A janela é desenhada por cima da tela do jogo, nas coordenadas do palco
//   (760×480) e escalada junto com ele, no visual das janelas do jogo.
// - Música: o servidor guarda a música tocando (com o instante em que
//   começou) e a fila (server/src/services/waddle/jukebox.js); o player do
//   YouTube só segue — carrega e pula pro ponto certo (agora − startedAt,
//   corrigindo o relógio pelo serverNow). Enquanto toca, a música da sala do
//   jogo fica desligada (pracaRoomMusic).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { loadYouTubeApi } from '../youtube/loadYouTubeApi.js';
import { ytSearch } from '../api/endpoints.js';
import { parseYouTubeId } from '../components/voice/ytUtils.js';
import '../styles/jukebox.css';

export const JUKEBOX_ROOMS = { 120: 'Danceteria' };
const PREFS_KEY = 'pc.praca.jukebox';
const HINT_KEY = 'pc.praca.jukebox.hint';
const DRIFT_SEC = 2.5;
const STAGE_W = 760; const STAGE_H = 480;
const WIN_W = 430; const WIN_H = 384;
const ICON = '/praca-ui/jukebox-128.png';

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { volume: Number.isFinite(p.volume) ? Math.min(100, Math.max(0, p.volume)) : 70, off: !!p.off };
  } catch { return { volume: 70, off: false }; }
}

const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const Icon = ({ d, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);
const I = {
  skip: 'M6 6.5v11a1 1 0 0 0 1.55.83L15 13.2V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.8L7.55 5.67A1 1 0 0 0 6 6.5z',
  vol: 'M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.77V5.67a1 1 0 0 0-1.7-.77L8 8.5H5a1 1 0 0 0-1 1zm12.5-2.3a1 1 0 0 1 1.4.1 7 7 0 0 1 0 9.4 1 1 0 1 1-1.5-1.3 5 5 0 0 0 0-6.8 1 1 0 0 1 .1-1.4z',
  mute: 'M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.77V5.67a1 1 0 0 0-1.7-.77L8 8.5H5a1 1 0 0 0-1 1zm12.3.2a1 1 0 0 1 1.4 0L19 11l1.3-1.3a1 1 0 1 1 1.4 1.4L20.4 12.4l1.3 1.3a1 1 0 0 1-1.4 1.4L19 13.8l-1.3 1.3a1 1 0 0 1-1.4-1.4l1.3-1.3-1.3-1.3a1 1 0 0 1 0-1.4z',
  plus: 'M12 4.5a1.5 1.5 0 0 1 1.5 1.5v4.5H18a1.5 1.5 0 0 1 0 3h-4.5V18a1.5 1.5 0 0 1-3 0v-4.5H6a1.5 1.5 0 0 1 0-3h4.5V6A1.5 1.5 0 0 1 12 4.5z',
  close: 'M6.3 6.3a1.2 1.2 0 0 1 1.7 0l4 4 4-4a1.2 1.2 0 1 1 1.7 1.7l-4 4 4 4a1.2 1.2 0 0 1-1.7 1.7l-4-4-4 4a1.2 1.2 0 0 1-1.7-1.7l4-4-4-4a1.2 1.2 0 0 1 0-1.7z',
  search: 'M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24a1 1 0 0 1-1.42 1.42l-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  trash: 'M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.9 12.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1zm1 2h4V5h-4zm-1 5v7a1 1 0 1 0 2 0v-7a1 1 0 1 0-2 0zm4 0v7a1 1 0 1 0 2 0v-7a1 1 0 1 0-2 0z',
  power: 'M12 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zM7.05 6.05a1 1 0 0 1 0 1.41 6.5 6.5 0 1 0 9.9 0 1 1 0 1 1 1.41-1.41 8.5 8.5 0 1 1-12.72 0 1 1 0 0 1 1.41 0z',
  note: 'M19 3.5v11.25a3.25 3.25 0 1 1-2-3V7.6l-8 1.6v7.55a3.25 3.25 0 1 1-2-3V6.5a1 1 0 0 1 .8-.98l10-2A1 1 0 0 1 19 3.5z',
};

/** Caixa da tela do jogo dentro da arena (px), acompanhando redimensionar. */
function useStageBox(stageRef, on) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const stage = stageRef?.current;
    if (!on || !stage) { setBox(null); return undefined; }
    const parent = stage.offsetParent || stage.parentElement;
    const measure = () => {
      const r = stage.getBoundingClientRect(); const p = parent.getBoundingClientRect();
      if (r.width < 50) { setBox(null); return; }
      setBox((b) => {
        const nb = { left: Math.round(r.left - p.left), top: Math.round(r.top - p.top), width: Math.round(r.width), height: Math.round(r.height) };
        return b && b.left === nb.left && b.top === nb.top && b.width === nb.width && b.height === nb.height ? b : nb;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage); ro.observe(parent);
    window.addEventListener('resize', measure);
    const t = setInterval(measure, 1500); // tela cheia/rotação às vezes não avisam
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearInterval(t); };
  }, [stageRef, on]);
  return box;
}

/**
 * @param {{ room:number|null, playerRef:{current:any}, stageRef:{current:HTMLElement|null}, gameMuted:boolean, active:boolean }} props
 */
export default function Jukebox({ room, playerRef, stageRef, gameMuted, active }) {
  const { socket } = useSocket() || {};
  const { user } = useAuth();
  const isStaff = ['ADMIN', 'MODERATOR'].includes(user?.platformRole);
  const here = active && room != null && !!JUKEBOX_ROOMS[room];
  const [open, setOpen] = useState(false);
  const [iconAt, setIconAt] = useState(null); // {x,y} do ícone na tela do jogo (pro balão)
  const [bubble, setBubble] = useState(null);
  useEffect(() => { if (!here) setOpen(false); }, [here]);

  const [state, setState] = useState(null);
  const offsetRef = useRef(0); // serverNow − Date.now()
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ok */ } }, [prefs]);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('queue'); // queue | add
  const [blocked, setBlocked] = useState(false); // navegador barrou o som automático
  const [pos, setPos] = useState(0);

  // ---- estado do servidor ----
  useEffect(() => {
    if (!socket) return undefined;
    const onState = (s) => {
      if (!s || typeof s !== 'object') return;
      if (Number.isFinite(s.serverNow)) offsetRef.current = s.serverNow - Date.now();
      setState(s.off ? null : s);
      if (s.notice?.text) setNotice({ ...s.notice, at: Date.now() });
    };
    const onError = (e) => { if (e?.text) setError(e.text); };
    socket.on('cpjb:state', onState);
    socket.on('cpjb:error', onError);
    return () => { socket.off('cpjb:state', onState); socket.off('cpjb:error', onError); };
  }, [socket]);
  useEffect(() => { if (here && socket) socket.emit('cpjb:get'); if (!here) setState(null); }, [here, socket, room]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const current = here ? state?.current || null : null;
  const listening = !!current && !prefs.off;
  const expected = useCallback(() => (current ? Math.max(0, (Date.now() + offsetRef.current - current.startedAt) / 1000) : 0), [current]);

  // ---- player do YouTube ----
  const hostRef = useRef(null);
  const ytRef = useRef(null);
  const readyRef = useRef(false);
  const loadedRef = useRef(null);
  const reportedRef = useRef(new Set());
  const curRef = useRef(current);
  curRef.current = current;
  const volRef = useRef(0);
  const volume = gameMuted ? 0 : prefs.volume;
  volRef.current = volume;

  const sync = useCallback(() => {
    const p = ytRef.current;
    if (!p || !readyRef.current) return;
    const c = curRef.current;
    if (!c || !listening) {
      if (loadedRef.current) { try { p.stopVideo(); } catch { /* ok */ } loadedRef.current = null; }
      return;
    }
    const want = expected();
    if (loadedRef.current !== c.videoId) {
      loadedRef.current = c.videoId;
      try { p.loadVideoById({ videoId: c.videoId, startSeconds: want }); } catch { /* ok */ }
      return;
    }
    let now = 0; let ps = -1;
    try { now = p.getCurrentTime() || 0; ps = p.getPlayerState(); } catch { return; }
    const dur = c.durationSec || (() => { try { return p.getDuration() || 0; } catch { return 0; } })();
    if (dur && want >= dur - 0.5) return; // já acabou aqui; o servidor troca
    if (ps === 1 && Math.abs(now - want) > DRIFT_SEC) p.seekTo(want, true);
    if (ps !== 1 && ps !== 3) { try { p.seekTo(want, true); p.playVideo(); } catch { /* ok */ } }
  }, [expected, listening]);

  useEffect(() => {
    if (!here) return undefined;
    let dead = false;
    loadYouTubeApi().then((YT) => {
      if (dead || !hostRef.current) return;
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      ytRef.current = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        width: '100%', height: '100%',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, origin: window.location.origin, hl: 'pt-BR' },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            try { if (volRef.current === 0) e.target.mute(); else { e.target.unMute(); e.target.setVolume(volRef.current); } } catch { /* ok */ }
            sync();
          },
          onStateChange: (e) => {
            const c = curRef.current;
            if (e.data === 1) setBlocked(false);
            if (e.data === 0 && c) socket?.emit('cpjb:report', { videoId: c.videoId, kind: 'ended' });
          },
          onError: () => {
            const c = curRef.current;
            if (!c || reportedRef.current.has(c.id)) return;
            reportedRef.current.add(c.id);
            socket?.emit('cpjb:report', { videoId: c.videoId, kind: 'error' });
          },
        },
      });
    }).catch(() => setError('Não deu pra carregar o player do YouTube.'));
    return () => {
      dead = true; readyRef.current = false; loadedRef.current = null;
      try { ytRef.current?.destroy?.(); } catch { /* ok */ }
      ytRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [here]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sync(); }, [current?.id, listening, sync]);
  useEffect(() => {
    const p = ytRef.current;
    if (!p || !readyRef.current) return;
    try { if (volume === 0) p.mute(); else { p.unMute(); p.setVolume(volume); } } catch { /* ok */ }
  }, [volume]);

  // tique: progresso, deriva e som bloqueado pelo navegador
  const stuckRef = useRef(0);
  useEffect(() => {
    if (!current) { setPos(0); return undefined; }
    const id = setInterval(() => {
      setPos(expected());
      sync();
      const p = ytRef.current;
      if (listening && p && readyRef.current) {
        let ps = -1; try { ps = p.getPlayerState(); } catch { /* ok */ }
        // parado 3 s seguidos: o navegador barrou o som automático
        stuckRef.current = (ps === -1 || ps === 5 || ps === 2) ? stuckRef.current + 1 : 0;
        setBlocked(stuckRef.current >= 3);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [current, expected, sync, listening]);

  // ---- música da sala do jogo ----
  const silencedRef = useRef(false);
  useEffect(() => {
    const call = (on) => { try { playerRef.current?.pracaRoomMusic?.(on); } catch { /* jogo carregando */ } };
    if (listening) {
      silencedRef.current = true;
      call(false);
      // o jogo pode religar a música (troca de sala, festa): desliga de novo
      const id = setInterval(() => call(false), 3000);
      return () => clearInterval(id);
    }
    if (silencedRef.current) { silencedRef.current = false; call(true); }
    return undefined;
  }, [listening, playerRef, room]);

  // ---- ações ----
  const emit = useCallback((ev, payload) => new Promise((resolve) => {
    if (!socket) { resolve({ ok: false }); return; }
    socket.timeout(15000).emit(ev, payload || {}, (err, res) => resolve(err ? { ok: false } : (res || { ok: true })));
  }), [socket]);

  const add = useCallback(async (video) => {
    setError('');
    const r = await emit('cpjb:add', { videoId: video.videoId, hint: { title: video.title, channel: video.channel, duration: video.duration } });
    if (r?.ok) { setTab('queue'); setPrefs((p) => ({ ...p, off: false })); }
    return r;
  }, [emit]);

  const unlock = () => { setBlocked(false); try { ytRef.current?.playVideo(); } catch { /* ok */ } sync(); };

  const myId = user?.id;
  const votes = state?.skip?.votes || [];
  const iVoted = votes.includes(myId);
  const canForceSkip = !!current && (current.by?.userId === myId || isStaff);
  const listeners = state?.listeners || 0;
  const queue = state?.queue || [];
  const mineInQueue = queue.filter((x) => x.by?.userId === myId).length;

  // ---- botão dentro do jogo ----
  useEffect(() => {
    window.pracaJukeboxToggle = (where) => {
      const m = /^(-?\d+),(-?\d+)$/.exec(String(where || ''));
      if (m) setIconAt({ x: Number(m[1]), y: Number(m[2]) });
      // fora da chamada do Flash (o Ruffle não gosta de reentrada)
      setTimeout(() => { setOpen((o) => !o); setBubble(null); }, 0);
    };
    return () => { delete window.pracaJukeboxToggle; };
  }, []);
  useEffect(() => {
    if (!here) return undefined;
    const push = () => {
      try {
        const r = playerRef.current?.pracaJukeboxState?.(listening, open);
        const m = /^(-?\d+),(-?\d+)$/.exec(String(r || ''));
        if (m) setIconAt((o) => (o && o.x === Number(m[1]) && o.y === Number(m[2]) ? o : { x: Number(m[1]), y: Number(m[2]) }));
      } catch { /* jogo carregando */ }
    };
    push();
    const id = setInterval(push, 2000); // o jogo pode ter recarregado a interface
    return () => clearInterval(id);
  }, [here, listening, open, playerRef]);
  useEffect(() => () => { try { playerRef.current?.pracaJukeboxState?.(false, false); } catch { /* ok */ } }, [playerRef]);

  // Balão no ícone (com a janela fechada): o que começou a tocar / avisos.
  const lastSongRef = useRef(null);
  useEffect(() => {
    if (!here) { lastSongRef.current = null; return; }
    const id = current?.id || null;
    if (id === lastSongRef.current) return;
    const first = lastSongRef.current === null;
    lastSongRef.current = id || '';
    if (open) return;
    if (current && !prefs.off) setBubble({ kind: 'song', title: current.title, by: current.by?.name, at: Date.now() });
    else if (first && !current) {
      let seen = false; try { seen = localStorage.getItem(HINT_KEY) === '1'; localStorage.setItem(HINT_KEY, '1'); } catch { /* ok */ }
      if (!seen) setBubble({ kind: 'hint', at: Date.now() });
    }
  }, [here, current, open, prefs.off]);
  useEffect(() => { if (notice && !open && notice.kind !== 'add') setBubble({ kind: 'notice', text: notice.text, at: Date.now() }); }, [notice]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!bubble) return undefined;
    const t = setTimeout(() => setBubble(null), bubble.kind === 'hint' ? 7000 : 5000);
    return () => clearTimeout(t);
  }, [bubble]);

  // ---- posição da janela (arrasta pela barra do título) ----
  const box = useStageBox(stageRef, here);
  const k = box ? box.width / STAGE_W : 1;
  // celular em pé: a tela do jogo fica minúscula — a janela cresce um pouco
  // (sem passar da tela do jogo)
  const zoom = box ? clamp(0.7 / k, 1, Math.min((box.width - 8) / (WIN_W * k), (box.height - 8) / (WIN_H * k))) : 1;
  const [winPos, setWinPos] = useState({ x: Math.round((STAGE_W - WIN_W) / 2), y: 54 });
  const dragRef = useRef(null);
  const onDragStart = (e) => {
    if (e.button !== 0 || zoom > 1 || e.target.closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, x: winPos.x, y: winPos.y };
  };
  const onDragMove = (e) => {
    const d = dragRef.current; if (!d) return;
    setWinPos({ x: clamp(d.x + (e.clientX - d.sx) / k, 0, STAGE_W - WIN_W), y: clamp(d.y + (e.clientY - d.sy) / k, 0, STAGE_H - WIN_H) });
  };
  const onDragEnd = () => { dragRef.current = null; };

  // Esc fecha
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!here || !box) return null;

  const progress = current?.durationSec ? Math.min(1, pos / current.durationSec) : 0;
  const winStyle = zoom > 1
    ? { left: (STAGE_W - WIN_W * zoom) / 2, top: (STAGE_H - WIN_H * zoom) / 2, transform: `scale(${zoom})`, transformOrigin: '0 0' }
    : { left: winPos.x, top: winPos.y };
  // balão em cima da jukebox (mesinha do canto direito), com a ponta pra ela
  const at = iconAt || { x: 707, y: 332 };
  const bubblePos = { left: clamp(at.x - 170, 4, STAGE_W - 244), bottom: STAGE_H - at.y + 12 };
  const arrowX = clamp(at.x - bubblePos.left, 16, 224);

  return (
    <div className="cpjb-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <div className="cpjb-canvas" style={{ transform: `scale(${k})` }}>
        {bubble && !open && (
          <button type="button" className="cpjb-bubble is-up" style={{ ...bubblePos, '--ax': `${arrowX}px` }} onClick={() => { setOpen(true); setBubble(null); }}>
            {bubble.kind === 'song' && (<><span className="cpjb-bubble-k"><Icon d={I.note} size={14} /> Tocando agora</span><b>{bubble.title}</b><small>por {bubble.by}</small></>)}
            {bubble.kind === 'hint' && (<><b>Jukebox!</b><small>Clique aqui pra colocar uma música do YouTube pra pista inteira ouvir.</small></>)}
            {bubble.kind === 'notice' && <b>{bubble.text}</b>}
          </button>
        )}

        <section
          className={`cpjb-win${open ? ' is-open' : ''}${listening ? ' is-live' : ''}`}
          style={winStyle}
          role="dialog"
          aria-label="Jukebox da Danceteria"
          aria-hidden={!open}
        >
          <header className="cpjb-title" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
            <img className="cpjb-badge" src={ICON} alt="" draggable="false" />
            <div className="cpjb-title-text">
              <h2>Jukebox</h2>
              {/* avisos aparecem aqui no lugar do subtítulo, como no jogo */}
              {(error || notice)
                ? <span className={`cpjb-say${error ? ' is-error' : ''}`} role="status">{error || notice.text}</span>
                : <span>{JUKEBOX_ROOMS[room]} · {listeners} {listeners === 1 ? 'pinguim' : 'pinguins'} na pista</span>}
            </div>
            <button type="button" className="cpjb-x" onClick={() => setOpen(false)} aria-label="Fechar" tabIndex={open ? 0 : -1}><Icon d={I.close} size={18} /></button>
          </header>

          <div className="cpjb-now">
            <div className={`cpjb-screen${current && !prefs.off ? '' : ' is-empty'}`}>
              <div className="cpjb-video" ref={hostRef} />
              {(!current || prefs.off) && <div className="cpjb-idle"><img src={ICON} alt="" /></div>}
              {blocked && listening && <button type="button" className="cpjb-unlock" onClick={unlock}>▶ Ouvir</button>}
            </div>
            <div className="cpjb-now-info">
              {current ? (
                <>
                  <span className="cpjb-label">{prefs.off ? 'Desligado pra você' : 'Tocando agora'}</span>
                  <strong className="cpjb-song" title={current.title}>{current.title}</strong>
                  <span className="cpjb-by">por <b>{current.by?.name}</b></span>
                  <div className="cpjb-bar"><span style={{ width: `${progress * 100}%` }} /></div>
                  <div className="cpjb-times"><span>{fmt(pos)}</span><span>{current.durationSec ? fmt(current.durationSec) : ''}</span></div>
                </>
              ) : (
                <>
                  <span className="cpjb-label">Pista em silêncio</span>
                  <strong className="cpjb-song">Seja o DJ!</strong>
                  <span className="cpjb-by">Coloque uma música do YouTube e todo mundo aqui ouve junto.</span>
                </>
              )}
            </div>
          </div>

          <div className="cpjb-controls">
            <button
              type="button" className={`cpjb-round${volume === 0 ? ' is-off' : ''}`}
              onClick={() => setPrefs((p) => ({ ...p, volume: p.volume === 0 ? 70 : 0 }))}
              aria-label={prefs.volume === 0 ? 'Ligar o som do Jukebox' : 'Silenciar o Jukebox'}
              title={gameMuted ? 'O jogo está silenciado' : (prefs.volume === 0 ? 'Ligar o som' : 'Silenciar')}
              tabIndex={open ? 0 : -1}
            >
              <Icon d={volume === 0 ? I.mute : I.vol} />
            </button>
            <input
              className="cpjb-vol" type="range" min="0" max="100" step="1"
              value={prefs.volume}
              onChange={(e) => setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))}
              aria-label="Volume do Jukebox" style={{ '--v': `${prefs.volume}%` }} tabIndex={open ? 0 : -1}
            />
            {current && (
              <button
                type="button" className={`cpjb-pill is-yellow${iVoted ? ' is-on' : ''}`}
                onClick={() => emit('cpjb:skip')}
                title={canForceSkip ? 'Pular esta música' : 'Votar pra pular (metade da pista precisa votar)'}
                tabIndex={open ? 0 : -1}
              >
                <Icon d={I.skip} size={16} />{canForceSkip ? 'Pular' : `Pular ${votes.length}/${state?.skip?.needed || 1}`}
              </button>
            )}
            {current && (
              <button
                type="button" className={`cpjb-round${prefs.off ? ' is-off' : ''}`}
                onClick={() => setPrefs((p) => ({ ...p, off: !p.off }))}
                aria-label={prefs.off ? 'Ligar o Jukebox pra mim' : 'Desligar o Jukebox só pra mim'}
                title={prefs.off ? 'Ligar o Jukebox pra mim' : 'Desligar só pra mim (volta a música do jogo)'}
                tabIndex={open ? 0 : -1}
              >
                <Icon d={I.power} />
              </button>
            )}
          </div>

          <nav className="cpjb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'is-on' : ''} onClick={() => setTab('queue')} tabIndex={open ? 0 : -1}>
              Fila{queue.length ? ` (${queue.length})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'add'} className={tab === 'add' ? 'is-on' : ''} onClick={() => setTab('add')} tabIndex={open ? 0 : -1}>
              <Icon d={I.plus} size={14} /> Colocar música
            </button>
            {isStaff && current && (
              <button type="button" className="cpjb-staff" onClick={() => emit('cpjb:clear')} title="Equipe: desligar o som e limpar a fila" tabIndex={open ? 0 : -1}>Desligar tudo</button>
            )}
          </nav>

          <div className="cpjb-panel">
            {tab === 'queue'
              ? <QueueList queue={queue} myId={myId} isStaff={isStaff} onRemove={(id) => emit('cpjb:remove', { id })} onAdd={() => setTab('add')} />
              : <AddMusic onAdd={add} full={mineInQueue >= (state?.limits?.perUser || 3) && !isStaff} limits={state?.limits} focus={open && tab === 'add'} />}
          </div>

        </section>
      </div>
    </div>
  );
}

function QueueList({ queue, myId, isStaff, onRemove, onAdd }) {
  if (!queue.length) {
    return (
      <div className="cpjb-empty">
        <span>Nenhuma música na fila.</span>
        <button type="button" className="cpjb-pill is-green is-small" onClick={onAdd}><Icon d={I.plus} size={14} /> Colocar a próxima</button>
      </div>
    );
  }
  return (
    <ol className="cpjb-list">
      {queue.map((q, i) => (
        <li key={q.id} className="cpjb-row">
          <span className="cpjb-n">{i + 1}</span>
          <img src={thumb(q.videoId)} alt="" loading="lazy" />
          <span className="cpjb-row-text">
            <span className="cpjb-row-title" title={q.title}>{q.title}</span>
            <small>{q.by?.name}{q.durationSec ? ` · ${fmt(q.durationSec)}` : ''}</small>
          </span>
          {(q.by?.userId === myId || isStaff) && (
            <button type="button" className="cpjb-mini is-red" onClick={() => onRemove(q.id)} aria-label={`Tirar “${q.title}” da fila`} title="Tirar da fila">
              <Icon d={I.trash} size={14} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function AddMusic({ onAdd, full, limits, focus }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null); // videoId sendo colocado
  const reqRef = useRef(0);
  const inputRef = useRef(null);
  const linkId = useMemo(() => parseYouTubeId(q), [q]);
  useEffect(() => { if (focus) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50); }, [focus]);

  const search = useCallback(async (text) => {
    const term = text.trim();
    if (!term || parseYouTubeId(term)) return;
    const id = ++reqRef.current;
    setLoading(true); setMsg('');
    try {
      const r = await ytSearch(term);
      if (id !== reqRef.current) return;
      const list = (r?.videos || []).filter((v) => !v.live).slice(0, 12);
      setResults(list);
      if (!list.length) setMsg('Nada encontrado. Tente outro nome.');
    } catch {
      if (id === reqRef.current) setMsg('A busca do YouTube não respondeu. Cole o link do vídeo.');
    } finally { if (id === reqRef.current) setLoading(false); }
  }, []);

  // busca enquanto digita (com uma pausa)
  useEffect(() => {
    if (!q.trim() || linkId) { setResults([]); return undefined; }
    const t = setTimeout(() => search(q), 450);
    return () => clearTimeout(t);
  }, [q, linkId, search]);

  const pick = async (video) => {
    setBusy(video.videoId); setMsg('');
    const r = await onAdd(video);
    setBusy(null);
    if (r?.ok) { setQ(''); setResults([]); }
    else if (r?.error) setMsg(r.error);
  };

  return (
    <div className="cpjb-add">
      <form className="cpjb-search" onSubmit={(e) => { e.preventDefault(); if (linkId) pick({ videoId: linkId }); else search(q); }}>
        <span className="cpjb-field">
          <Icon d={I.search} size={15} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome da música ou link do YouTube"
            aria-label="Nome da música ou link do YouTube"
            maxLength={200}
            autoComplete="off"
            // as teclas não vão pro jogo (andar/chat) enquanto digita
            onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
          />
        </span>
        <button type="submit" className="cpjb-pill is-green">{linkId ? 'Colocar' : 'Buscar'}</button>
      </form>
      {full && <p className="cpjb-hint is-warn">Você já tem {limits?.perUser || 3} músicas na fila. Espere uma tocar!</p>}
      {linkId && (
        <button type="button" className="cpjb-row is-result is-link" onClick={() => pick({ videoId: linkId })} disabled={!!busy || full}>
          <img src={thumb(linkId)} alt="" />
          <span className="cpjb-row-text"><span className="cpjb-row-title">Vídeo do link</span><small>youtube.com · {linkId}</small></span>
          <span className="cpjb-mini is-green">{busy === linkId ? '…' : <Icon d={I.plus} size={15} />}</span>
        </button>
      )}
      {loading && <p className="cpjb-hint">Procurando…</p>}
      {msg && <p className="cpjb-hint is-warn">{msg}</p>}
      {!linkId && results.length > 0 && (
        <ul className="cpjb-list">
          {results.map((v) => (
            <li key={v.videoId}>
              <button type="button" className="cpjb-row is-result" onClick={() => pick(v)} disabled={!!busy || full}>
                <img src={v.thumbnail || thumb(v.videoId)} alt="" loading="lazy" />
                <span className="cpjb-row-text">
                  <span className="cpjb-row-title" title={v.title}>{v.title}</span>
                  <small>{[v.channel, v.duration].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="cpjb-mini is-green">{busy === v.videoId ? '…' : <Icon d={I.plus} size={15} />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q && !full && <p className="cpjb-hint">Até {limits?.perUser || 3} músicas por pinguim, de até {Math.round((limits?.maxSec || 600) / 60)} min cada. Toda a pista ouve junto!</p>}
    </div>
  );
}
