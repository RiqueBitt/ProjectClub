import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import UserAvatar from '../UserAvatar.jsx';
import RpgTools from './RpgTools.jsx';
import '../../styles/rpg-table.css';

// Call modo RPG (canal com rpgMode): a mesa. Mestre no topo, com o escudo
// de Dungeon Master e a foto em cima da área principal (onde fica a
// transmissão da mesa: tela compartilhada, vídeo/música da atividade);
// os 4 jogadores embaixo, com nome do personagem (o nome da pessoa fica
// pequeno embaixo) e a ficha do BLACKOUT: Pontos de Vida, Estresse (6
// espaços; cheio = BURNOUT) e Pontos de Ação (3 por turno + 1 Ação Rápida).
// Ao lado, o histórico das rolagens da mesa. Servidor: sockets/rpgTable.js.

export function useRpgTable(channelId, rosterKey = '') {
  const { socket } = useSocket() || {};
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const ask = () => socket.emit('rpg:get', { channelId });
    const onState = (s) => { if (s?.channelId === channelId) setState(s); };
    const onLog = ({ channelId: id, entry } = {}) => {
      if (id !== channelId || !entry) return;
      setState((s) => (s ? { ...s, log: [...(s.log || []), entry].slice(-80) } : s));
    };
    ask();
    socket.on('rpg:state', onState);
    socket.on('rpg:log', onLog);
    socket.on('voice:joined', ask);
    socket.on('connect', ask);
    return () => {
      socket.off('rpg:state', onState);
      socket.off('rpg:log', onLog);
      socket.off('voice:joined', ask);
      socket.off('connect', ask);
    };
  }, [socket, channelId]);
  // Alguém entrou/saiu da call: o servidor libera o lugar de quem saiu.
  useEffect(() => { if (socket && channelId) socket.emit('rpg:get', { channelId }); }, [socket, channelId, rosterKey]);

  const send = useCallback((event, payload) => new Promise((resolve) => {
    if (!socket) { resolve(false); return; }
    socket.emit(event, { channelId, ...payload }, (r) => {
      if (r?.error) { setError(r.error); setTimeout(() => setError(''), 3500); resolve(false); } else resolve(true);
    });
  }), [socket, channelId]);
  return {
    state, error,
    sit: (seat) => send('rpg:sit', { seat }),
    setChar: (userId, patch) => send('rpg:char', { userId, patch }),
    clearLog: () => send('rpg:log-clear', {}),
  };
}

function ShieldIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Zm0 4.2 1.5 3.1 3.4.5-2.5 2.4.6 3.4L12 14l-3 1.6.6-3.4-2.5-2.4 3.4-.5L12 6.2Z" />
    </svg>
  );
}

/** Ficha rápida: PV, Estresse e PA (+ Ação Rápida). */
function Sheet({ c, canEdit, onPatch }) {
  const pvPct = c.pvMax ? Math.round((c.pv / c.pvMax) * 100) : 0;
  const burn = c.stress >= 6;
  return (
    <div className="rpg-sheet">
      <div className="rpg-stat rpg-pv" title="Pontos de Vida">
        <span className="rpg-stat-k">PV</span>
        {canEdit && <button type="button" className="rpg-step" onClick={() => onPatch({ pv: c.pv - 1 })} aria-label="Perder 1 PV" disabled={c.pv <= 0}>−</button>}
        <span className="rpg-pv-bar" role="meter" aria-valuemin={0} aria-valuemax={c.pvMax} aria-valuenow={c.pv} aria-label="Pontos de Vida">
          <span className={`rpg-pv-fill${pvPct <= 30 ? ' is-low' : ''}`} style={{ width: `${pvPct}%` }} />
          <span className="rpg-pv-num">{c.pv}/{c.pvMax}</span>
        </span>
        {canEdit && <button type="button" className="rpg-step" onClick={() => onPatch({ pv: c.pv + 1 })} aria-label="Ganhar 1 PV" disabled={c.pv >= c.pvMax}>+</button>}
      </div>
      <div className={`rpg-stat rpg-stress${burn ? ' is-burnout' : ''}`} title="Estresse (6 espaços — cheio = BURNOUT)">
        <span className="rpg-stat-k">EST</span>
        <span className="rpg-pips" role="group" aria-label={`Estresse ${c.stress} de 6`}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n} type="button" className={`rpg-pip${n <= c.stress ? ' is-on' : ''}`} disabled={!canEdit}
              onClick={() => onPatch({ stress: c.stress === n ? n - 1 : n })} aria-label={`Estresse ${n}`}
            />
          ))}
        </span>
        {burn && <span className="rpg-burnout">BURNOUT</span>}
      </div>
      <div className="rpg-stat rpg-pa" title="Pontos de Ação (3 por turno) e Ação Rápida">
        <span className="rpg-stat-k">PA</span>
        <span className="rpg-pips" role="group" aria-label={`Pontos de Ação ${c.pa} de 3`}>
          {[1, 2, 3].map((n) => (
            <button
              key={n} type="button" className={`rpg-pip is-pa${n <= c.pa ? ' is-on' : ''}`} disabled={!canEdit}
              onClick={() => onPatch({ pa: c.pa === n ? n - 1 : n })} aria-label={`Ponto de Ação ${n}`}
            />
          ))}
          <button
            type="button" className={`rpg-pip is-ar${c.ar ? ' is-on' : ''}`} disabled={!canEdit}
            onClick={() => onPatch({ ar: c.ar ? 0 : 1 })} aria-label="Ação Rápida" title="Ação Rápida"
          >AR</button>
        </span>
        {canEdit && <button type="button" className="rpg-turn" onClick={() => onPatch({ pa: 3, ar: 1 })} title="Novo turno: volta 3 PA e a Ação Rápida">↻</button>}
      </div>
    </div>
  );
}

function CharName({ c, person, canEdit, onPatch, master = false }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const personName = person?.displayName || person?.username || 'Alguém';
  const shown = c?.name || (master ? 'Mestre' : personName);
  if (editing) {
    return (
      <form className="rpg-name-edit" onSubmit={(e) => { e.preventDefault(); onPatch({ name: val }); setEditing(false); }}>
        <input autoFocus value={val} maxLength={40} onChange={(e) => setVal(e.target.value)} onBlur={() => { onPatch({ name: val }); setEditing(false); }} placeholder={master ? 'Título do mestre (opcional)' : 'Nome do personagem'} aria-label="Nome do personagem" />
      </form>
    );
  }
  return (
    <div className="rpg-names">
      <button
        type="button" className="rpg-char" disabled={!canEdit} onClick={() => { setVal(c?.name || ''); setEditing(true); }}
        title={canEdit ? 'Trocar o nome do personagem' : undefined}
      >{shown}{canEdit && !c?.name && !master && <small> ✎</small>}</button>
      {(c?.name || master) && <span className="rpg-player">{personName}</span>}
    </div>
  );
}

function Face({ uid, person, speaking, muted, cameraStream, renderCamera, size }) {
  return (
    <span className={`rpg-face${speaking ? ' is-speaking' : ''}`} style={{ '--face': `${size}px` }}>
      {cameraStream && renderCamera ? renderCamera(uid, cameraStream) : <UserAvatar user={person || { id: uid }} size={size} />}
      {muted && <span className="rpg-muted" aria-label="Microfone desligado" title="Microfone desligado">🔇</span>}
    </span>
  );
}

export default function RpgTable({ channelId, me, memberFor, participants, localSpeaking, muted, stage, cameraFor, renderCamera, onRollDice, rosterKey }) {
  const rpg = useRpgTable(channelId, rosterKey);
  const s = rpg.state;
  const iAmMaster = !!s && s.master === me.id;
  const mySeat = !s ? null : (iAmMaster ? 'master' : s.players.indexOf(me.id));
  const seated = mySeat === 'master' || (typeof mySeat === 'number' && mySeat >= 0);
  const personOf = (uid) => (uid === me.id ? me : memberFor(uid));
  const speakingOf = (uid) => (uid === me.id ? !!localSpeaking && !muted : !!participants?.[uid]?.speaking);
  const mutedOf = (uid) => (uid === me.id ? !!muted : !!participants?.[uid]?.muted);
  const charOf = (uid) => s?.chars?.[uid] || { name: '', pv: 10, pvMax: 10, stress: 0, pa: 3, ar: 1 };
  const freeSeat = s ? s.players.findIndex((u) => !u) : -1;
  const unseated = useMemo(() => {
    if (!s) return [];
    const at = new Set([s.master, ...s.players].filter(Boolean));
    return [me.id, ...Object.keys(participants || {})].filter((u, i, a) => a.indexOf(u) === i && !at.has(u));
  }, [s, me.id, participants]);

  // Histórico: rola pro fim quando chega rolagem nova.
  const logRef = useRef(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [s?.log?.length]);

  const master = s?.master;
  return (
    <div className="rpg" data-testid="rpg-table">
      <div className="rpg-board">
        <RpgTools channelId={channelId} iAmMaster={iAmMaster} players={s?.players || []} personOf={personOf} />
        <section className="rpg-top">
          <div className={`rpg-master${master ? '' : ' is-empty'}`}>
            {master ? (
              <>
                <span className="rpg-shield" title="Dungeon Master">
                  <Face uid={master} person={personOf(master)} speaking={speakingOf(master)} muted={mutedOf(master)} cameraStream={cameraFor(master)} renderCamera={renderCamera} size={72} />
                  <span className="rpg-dm-badge"><ShieldIcon size={12} /> Mestre</span>
                </span>
                <CharName c={charOf(master)} person={personOf(master)} master canEdit={master === me.id} onPatch={(p) => rpg.setChar(master, p)} />
              </>
            ) : (
              <button type="button" className="rpg-sit rpg-sit-master" onClick={() => rpg.sit('master')}>
                <ShieldIcon size={22} /> <span>Sentar como Mestre</span>
              </button>
            )}
          </div>
          <div className="rpg-screen">
            {stage || (
              <div className="rpg-screen-empty">
                <strong>Mesa de RPG</strong>
                <span>O mestre pode transmitir a tela (mapa, cena…) ou abrir um vídeo ou música em Atividades.</span>
              </div>
            )}
          </div>
        </section>

        <section className="rpg-players" aria-label="Jogadores">
          {(s?.players || [null, null, null, null]).map((uid, i) => (
            <div key={i} className={`rpg-seat${uid ? '' : ' is-empty'}${uid === me.id ? ' is-me' : ''}`}>
              {uid ? (
                <>
                  <div className="rpg-seat-head">
                    <Face uid={uid} person={personOf(uid)} speaking={speakingOf(uid)} muted={mutedOf(uid)} cameraStream={cameraFor(uid)} renderCamera={renderCamera} size={52} />
                    <CharName c={charOf(uid)} person={personOf(uid)} canEdit={uid === me.id || iAmMaster} onPatch={(p) => rpg.setChar(uid, p)} />
                  </div>
                  <Sheet c={charOf(uid)} canEdit={uid === me.id || iAmMaster} onPatch={(p) => rpg.setChar(uid, p)} />
                </>
              ) : (
                <button type="button" className="rpg-sit" onClick={() => rpg.sit(i)}>
                  <span className="rpg-sit-plus" aria-hidden="true">+</span>
                  <span>Sentar como Jogador</span>
                </button>
              )}
            </div>
          ))}
        </section>

        {s && (!seated || unseated.length > 0) && (
          <div className="rpg-bench">
            {!seated && (
              <span className="rpg-bench-ask">
                Escolha seu lugar:
                <button type="button" className="btn-secondary" disabled={!!master} onClick={() => rpg.sit('master')}>Mestre</button>
                <button type="button" className="btn-primary" disabled={freeSeat < 0} onClick={() => rpg.sit(freeSeat)}>Jogador</button>
              </span>
            )}
            {unseated.filter((u) => u !== me.id).length > 0 && (
              <span className="rpg-bench-who">
                Sem lugar ainda: {unseated.filter((u) => u !== me.id).map((u) => <UserAvatar key={u} user={personOf(u) || { id: u }} size={20} />)}
              </span>
            )}
          </div>
        )}
        {seated && <button type="button" className="rpg-stand" onClick={() => rpg.sit(null)}>Levantar da mesa</button>}
        {rpg.error && <p className="rpg-error" role="alert">{rpg.error}</p>}
      </div>

      <aside className="rpg-log" aria-label="Histórico de rolagens">
        <div className="rpg-log-head">
          <strong>Histórico de rolagens</strong>
          {iAmMaster && (s?.log?.length > 0) && <button type="button" className="rpg-link" onClick={() => { if (window.confirm('Limpar o histórico de rolagens da mesa?')) rpg.clearLog(); }}>Limpar</button>}
        </div>
        <div className="rpg-log-list" ref={logRef}>
          {!s?.log?.length && <p className="rpg-log-empty">Nenhuma rolagem ainda. As rolagens da mesa aparecem aqui.</p>}
          {(s?.log || []).map((e, i) => (
            <div key={`${e.at}-${i}`} className={`rpg-roll${e.master ? ' is-master' : ''}`}>
              <div className="rpg-roll-who">
                <strong>{e.master ? (e.character || 'Mestre') : (e.character || e.name)}</strong>
                {e.master && <span className="rpg-roll-dm"><ShieldIcon size={10} /> DM</span>}
                {e.character && !e.master && <small>{e.name}</small>}
                <time>{new Date(e.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
              </div>
              {e.label && <div className="rpg-roll-label">{e.label}</div>}
              <div className="rpg-roll-body">
                <span className="rpg-roll-dice">
                  {(e.groups || []).flatMap((g, gi) => (g.results || []).map((r, ri) => (
                    <span key={`${gi}-${ri}`} className={`rpg-die${r === g.sides ? ' is-max' : ''}${r === 1 ? ' is-min' : ''}`} title={`D${g.sides}`}>{r}</span>
                  )))}
                  {e.modifier ? <span className="rpg-mod">{e.modifier > 0 ? `+${e.modifier}` : e.modifier}</span> : null}
                </span>
                <span className="rpg-roll-total" title={e.notation}>{e.total}</span>
              </div>
              <small className="rpg-roll-not">{e.notation}</small>
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary rpg-roll-btn" onClick={onRollDice}>🎲 Rolar dados</button>
      </aside>
    </div>
  );
}
