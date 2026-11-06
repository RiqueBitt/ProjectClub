// Jukebox da Danceteria: música do YouTube que TODO MUNDO da sala ouve junto.
//
// O servidor guarda a música tocando (com o instante em que começou) e a
// fila (ver server/src/services/waddle/jukebox.js); aqui o player do YouTube
// só segue: carrega a música e pula pro ponto certo (agora − startedAt,
// corrigindo o relógio pelo serverNow). Enquanto toca, a música da própria
// sala do jogo fica desligada (callback pracaRoomMusic no interface.swf).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { loadYouTubeApi } from '../youtube/loadYouTubeApi.js';
import { ytSearch } from '../api/endpoints.js';
import { parseYouTubeId } from '../components/voice/ytUtils.js';
import '../styles/jukebox.css';

export const JUKEBOX_ROOMS = { 120: 'Danceteria' };
const PREFS_KEY = 'pc.praca.jukebox';
const DRIFT_SEC = 2.5;

// tela pequena (celular): o painel começa fechado pra não cobrir o jogo
const smallScreen = () => { try { return window.matchMedia('(max-width: 600px), (max-height: 520px)').matches; } catch { return false; } };

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { volume: Number.isFinite(p.volume) ? Math.min(100, Math.max(0, p.volume)) : 70, off: !!p.off, open: typeof p.open === 'boolean' ? p.open : !smallScreen() };
  } catch { return { volume: 70, off: false, open: !smallScreen() }; }
}

const fmt = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const Icon = ({ d, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);
const I = {
  disc: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  skip: 'M6 6.5v11a1 1 0 0 0 1.55.83L15 13.2V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.8L7.55 5.67A1 1 0 0 0 6 6.5z',
  vol: 'M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.77V5.67a1 1 0 0 0-1.7-.77L8 8.5H5a1 1 0 0 0-1 1zm12.5-2.3a1 1 0 0 1 1.4.1 7 7 0 0 1 0 9.4 1 1 0 1 1-1.5-1.3 5 5 0 0 0 0-6.8 1 1 0 0 1 .1-1.4z',
  mute: 'M4 9.5v5a1 1 0 0 0 1 1h3l4.3 3.6a1 1 0 0 0 1.7-.77V5.67a1 1 0 0 0-1.7-.77L8 8.5H5a1 1 0 0 0-1 1zm12.3.2a1 1 0 0 1 1.4 0L19 11l1.3-1.3a1 1 0 1 1 1.4 1.4L20.4 12.4l1.3 1.3a1 1 0 0 1-1.4 1.4L19 13.8l-1.3 1.3a1 1 0 0 1-1.4-1.4l1.3-1.3-1.3-1.3a1 1 0 0 1 0-1.4z',
  plus: 'M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1z',
  close: 'M6.3 6.3a1 1 0 0 1 1.4 0L12 10.6l4.3-4.3a1 1 0 1 1 1.4 1.4L13.4 12l4.3 4.3a1 1 0 0 1-1.4 1.4L12 13.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l4.3-4.3-4.3-4.3a1 1 0 0 1 0-1.4z',
  down: 'M6.3 9.3a1 1 0 0 1 1.4 0L12 13.6l4.3-4.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 0-1.4z',
  search: 'M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24a1 1 0 0 1-1.42 1.42l-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  trash: 'M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1l-.9 12.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 7H4a1 1 0 0 1 0-2h4V4a1 1 0 0 1 1-1zm1 2h4V5h-4zm-1 5v7a1 1 0 1 0 2 0v-7a1 1 0 1 0-2 0zm4 0v7a1 1 0 1 0 2 0v-7a1 1 0 1 0-2 0z',
  power: 'M12 3a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1zM7.05 6.05a1 1 0 0 1 0 1.41 6.5 6.5 0 1 0 9.9 0 1 1 0 1 1 1.41-1.41 8.5 8.5 0 1 1-12.72 0 1 1 0 0 1 1.41 0z',
};

/**
 * @param {{ room:number|null, playerRef:{current:any}, gameMuted:boolean, active:boolean }} props
 */
export default function Jukebox({ room, playerRef, gameMuted, active }) {
  const { socket } = useSocket() || {};
  const { user } = useAuth();
  const isStaff = ['ADMIN', 'MODERATOR'].includes(user?.platformRole);
  const here = active && room != null && !!JUKEBOX_ROOMS[room];

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

  if (!here) return null;

  const progress = current?.durationSec ? Math.min(1, pos / current.durationSec) : 0;
  const open = prefs.open;

  return (
    <section className={`cpjb${open ? ' is-open' : ''}${current ? ' is-live' : ''}`} aria-label={`Jukebox da ${JUKEBOX_ROOMS[room]}`}>
      <header className="cpjb-head">
        <button type="button" className="cpjb-toggle" onClick={() => setPrefs((p) => ({ ...p, open: !p.open }))} aria-expanded={open}>
          <span className={`cpjb-disc${listening ? ' is-spin' : ''}`}><Icon d={I.disc} size={20} /></span>
          <span className="cpjb-head-text">
            <b>DJ da {JUKEBOX_ROOMS[room]}</b>
            <small>{current ? (prefs.off ? 'Desligado pra você' : current.title) : 'Coloque uma música do YouTube'}</small>
          </span>
          {listening && <span className="cpjb-eq" aria-hidden="true"><i /><i /><i /><i /></span>}
          <span className="cpjb-chev"><Icon d={I.down} size={18} /></span>
        </button>
      </header>

      <div className="cpjb-body" hidden={!open}>
        <div className={`cpjb-screen${current && !prefs.off ? '' : ' is-empty'}`}>
          <div className="cpjb-video" ref={hostRef} />
          {(!current || prefs.off) && (
            <div className="cpjb-idle">
              <span className="cpjb-idle-disc"><Icon d={I.disc} size={34} /></span>
              {prefs.off && current
                ? <span>Música desligada só pra você.</span>
                : <span>A pista está em silêncio.<br />Seja o DJ: busque uma música!</span>}
            </div>
          )}
          {blocked && listening && (
            <button type="button" className="cpjb-unlock" onClick={unlock}>▶ Toque pra ouvir a música</button>
          )}
        </div>

        {current && (
          <div className="cpjb-now">
            <div className="cpjb-now-title" title={current.title}>{current.title}</div>
            <div className="cpjb-now-meta">
              {current.channel && <span>{current.channel}</span>}
              <span>por <b>{current.by?.name}</b></span>
            </div>
            <div className="cpjb-progress" aria-hidden={!current.durationSec}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="cpjb-times"><span>{fmt(pos)}</span><span>{current.durationSec ? fmt(current.durationSec) : '—'}</span></div>
          </div>
        )}

        <div className="cpjb-controls">
          <button
            type="button"
            className="cpjb-icon"
            onClick={() => setPrefs((p) => ({ ...p, volume: p.volume === 0 ? 70 : 0 }))}
            aria-label={prefs.volume === 0 ? 'Ligar o som do DJ' : 'Silenciar o DJ'}
            title={gameMuted ? 'O jogo está silenciado' : undefined}
          >
            <Icon d={volume === 0 ? I.mute : I.vol} />
          </button>
          <input
            className="cpjb-vol"
            type="range" min="0" max="100" step="1"
            value={prefs.volume}
            onChange={(e) => setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))}
            aria-label="Volume do DJ"
            style={{ '--v': `${prefs.volume}%` }}
          />
          {current && (
            <button
              type="button"
              className={`cpjb-btn${iVoted ? ' is-on' : ''}`}
              onClick={() => emit('cpjb:skip')}
              title={canForceSkip ? 'Pular esta música' : 'Votar pra pular (metade da pista precisa votar)'}
            >
              <Icon d={I.skip} size={16} />
              {canForceSkip ? 'Pular' : `Pular ${votes.length}/${state?.skip?.needed || 1}`}
            </button>
          )}
          {current && (
            <button
              type="button"
              className={`cpjb-icon${prefs.off ? ' is-on' : ''}`}
              onClick={() => setPrefs((p) => ({ ...p, off: !p.off }))}
              aria-label={prefs.off ? 'Ligar a música do DJ pra mim' : 'Desligar a música do DJ só pra mim'}
              title={prefs.off ? 'Ligar a música do DJ' : 'Desligar só pra mim (volta a música do jogo)'}
            >
              <Icon d={I.power} />
            </button>
          )}
        </div>

        <nav className="cpjb-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'is-on' : ''} onClick={() => setTab('queue')}>
            Fila{queue.length ? ` · ${queue.length}` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'add'} className={tab === 'add' ? 'is-on' : ''} onClick={() => setTab('add')}>
            <Icon d={I.plus} size={15} /> Colocar música
          </button>
          <span className="cpjb-people" title="Pinguins na pista">🐧 {listeners}</span>
        </nav>

        {tab === 'queue' ? (
          <QueueList queue={queue} myId={myId} isStaff={isStaff} onRemove={(id) => emit('cpjb:remove', { id })} onAdd={() => setTab('add')} />
        ) : (
          <AddMusic onAdd={add} full={mineInQueue >= (state?.limits?.perUser || 3) && !isStaff} limits={state?.limits} />
        )}

        {isStaff && current && (
          <button type="button" className="cpjb-staff" onClick={() => emit('cpjb:clear')}>Equipe: desligar o som e limpar a fila</button>
        )}
      </div>

      {(notice || error) && (
        <div className={`cpjb-toast${error ? ' is-error' : ''}`} role="status">{error || notice.text}</div>
      )}
    </section>
  );
}

function QueueList({ queue, myId, isStaff, onRemove, onAdd }) {
  if (!queue.length) {
    return (
      <div className="cpjb-empty">
        <span>Nada na fila.</span>
        <button type="button" className="cpjb-link" onClick={onAdd}>Colocar a próxima</button>
      </div>
    );
  }
  return (
    <ol className="cpjb-list">
      {queue.map((q, i) => (
        <li key={q.id} className="cpjb-item">
          <span className="cpjb-n">{i + 1}</span>
          <img src={thumb(q.videoId)} alt="" loading="lazy" />
          <span className="cpjb-item-text">
            <span className="cpjb-item-title" title={q.title}>{q.title}</span>
            <small>{q.by?.name}{q.durationSec ? ` · ${fmt(q.durationSec)}` : ''}</small>
          </span>
          {(q.by?.userId === myId || isStaff) && (
            <button type="button" className="cpjb-icon is-small" onClick={() => onRemove(q.id)} aria-label={`Tirar “${q.title}” da fila`}>
              <Icon d={I.trash} size={15} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function AddMusic({ onAdd, full, limits }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(null); // videoId sendo adicionado
  const reqRef = useRef(0);
  const linkId = useMemo(() => parseYouTubeId(q), [q]);

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

  // busca enquanto digita (com pausa)
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
        <Icon d={I.search} size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar música ou colar link do YouTube"
          aria-label="Buscar música ou colar link do YouTube"
          maxLength={200}
          autoComplete="off"
          // as teclas não podem ir pro jogo (andar/chat) enquanto digita
          onKeyDown={(e) => e.stopPropagation()}
        />
        {q && <button type="button" className="cpjb-icon is-small" onClick={() => setQ('')} aria-label="Limpar"><Icon d={I.close} size={14} /></button>}
      </form>
      {full && <p className="cpjb-hint is-warn">Você já tem {limits?.perUser || 3} músicas na fila. Espere uma tocar.</p>}
      {linkId && (
        <button type="button" className="cpjb-result is-link" onClick={() => pick({ videoId: linkId })} disabled={!!busy || full}>
          <img src={thumb(linkId)} alt="" />
          <span className="cpjb-item-text"><span className="cpjb-item-title">Colocar o vídeo do link</span><small>youtube.com · {linkId}</small></span>
          <span className="cpjb-add-btn">{busy === linkId ? '…' : <Icon d={I.plus} size={16} />}</span>
        </button>
      )}
      {loading && <div className="cpjb-hint">Buscando…</div>}
      {msg && <div className="cpjb-hint is-warn">{msg}</div>}
      {!linkId && (
        <ul className="cpjb-results">
          {results.map((v) => (
            <li key={v.videoId}>
              <button type="button" className="cpjb-result" onClick={() => pick(v)} disabled={!!busy || full}>
                <img src={v.thumbnail || thumb(v.videoId)} alt="" loading="lazy" />
                <span className="cpjb-item-text">
                  <span className="cpjb-item-title" title={v.title}>{v.title}</span>
                  <small>{[v.channel, v.duration].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="cpjb-add-btn">{busy === v.videoId ? '…' : <Icon d={I.plus} size={16} />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q && <p className="cpjb-hint">Até {limits?.perUser || 3} músicas por pessoa, de até {Math.round((limits?.maxSec || 600) / 60)} min. Todo mundo na pista ouve junto.</p>}
    </div>
  );
}
