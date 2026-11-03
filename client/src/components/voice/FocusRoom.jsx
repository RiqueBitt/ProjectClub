import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useSocket } from '../../context/SocketContext.jsx';
import '../../styles/soundboard.css';
import '../../styles/temp-voice.css';

// Sala de estudos: Pomodoro compartilhado na call (server/src/sockets/focusRoom.js).
// Todo mundo da sala vê o mesmo relógio; cada bloco de foco concluído entra
// no ranking de foco.

const PRESETS = [
  { id: '25-5', label: '25 min foco · 5 pausa' },
  { id: '50-10', label: '50 min foco · 10 pausa' },
  { id: '15-3', label: '15 min foco · 3 pausa' },
];
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function useFocusState(channelId) {
  const { socket } = useSocket() || {};
  const [state, setState] = useState(null);
  const offset = useRef(0);
  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const on = (m) => { if (m?.channelId !== channelId) return; offset.current = (m.serverNow || Date.now()) - Date.now(); setState(m.state || null); };
    socket.on('focus:state', on);
    socket.emit('focus:get', { channelId });
    return () => socket.off('focus:state', on);
  }, [socket, channelId]);
  return { state, offset, socket };
}

function Ranking() {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/focus/ranking?days=7').then(({ data: d }) => setData(d)).catch(() => setData({ ranking: [], me: { minutes: 0 } })); }, []);
  if (!data) return <p className="sb-empty">Carregando ranking…</p>;
  return (
    <div className="focus-rank">
      <p className="sb-empty">Seu foco nos últimos 7 dias: <strong>{data.me.minutes} min</strong></p>
      {data.ranking.length === 0 ? <p className="sb-empty">Ninguém estudou ainda esta semana.</p> : (
        <ol>
          {data.ranking.slice(0, 10).map((r) => <li key={r.user.id}><span>{r.user.displayName || r.user.username}</span><strong>{r.minutes} min</strong></li>)}
        </ol>
      )}
    </div>
  );
}

export function FocusButton({ channelId }) {
  const { state, offset, socket } = useFocusState(channelId);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('timer');
  const [, tick] = useState(0);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!state) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const left = state ? state.endsAt - (Date.now() + offset.current) : 0;
  const label = state ? `${state.phase === 'focus' ? 'Foco' : 'Pausa'} ${fmt(left)}` : 'Estudos';
  return (
    <div className={`sb-wrap${open ? ' open' : ''}`} ref={wrapRef}>
      <button type="button" className={`vc-ctrl${state ? ' is-active' : ''}`} aria-label="Sala de estudos" aria-expanded={open} title="Sala de estudos (Pomodoro pra todo mundo da call)" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true" className="sb-ctrl-emoji">{state?.phase === 'break' ? '☕' : '📚'}</span>
        <span className="vc-ctrl-label">{label}</span>
      </button>
      {open && (
        <div className="sb-pop" role="dialog" aria-label="Sala de estudos">
          <div className="sb-head">
            <strong>Sala de estudos</strong>
            <button type="button" className="sb-link" onClick={() => setTab(tab === 'timer' ? 'rank' : 'timer')}>{tab === 'timer' ? 'Ranking de foco' : 'Voltar'}</button>
          </div>
          {tab === 'rank' ? <Ranking /> : state ? (
            <div className="focus-now">
              <p className="focus-clock" aria-live="polite">{fmt(left)}</p>
              <p className="sb-empty">{state.phase === 'focus' ? `Foco · rodada ${state.round}` : 'Pausa — respira, bebe água'} · {state.focusMin}/{state.breakMin} min</p>
              <button type="button" className="tvr-btn tvr-danger" onClick={() => socket?.emit('focus:stop', { channelId })}>Parar para todos</button>
            </div>
          ) : (
            <div className="focus-start">
              <p className="sb-empty">Começa um Pomodoro pra todo mundo da call. Cada bloco de foco concluído conta no ranking.</p>
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className="sb-play focus-preset" onClick={() => { socket?.emit('focus:start', { channelId, preset: p.id }); }}>
                  <span className="sb-name">{p.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
