import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, CardArt, CardBack, ABILITIES, ELEMENTS, Icon, UI, abilityText } from './CardView.jsx';
import { cardsAction, cardsMatch, errMsg } from './api';

// Tela de batalha. O servidor manda a visão do jogador (`view`, com as ações
// legais já calculadas pelo motor) e a lista de eventos da jogada; aqui só
// exibimos e animamos — nenhuma regra é decidida no cliente.

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Unit({ u, mine, canAttack, selected, targetable, dying, onClick, onHover }) {
  const el = ELEMENTS[u.element] || ELEMENTS.FOGO;
  const ab = ABILITIES[u.ability];
  return (
    <button
      type="button" data-uid={u.uid}
      className={`tcgb-unit tcg-r-${u.rarity}${canAttack ? ' can-attack' : ''}${selected ? ' is-selected' : ''}${targetable ? ' is-target' : ''}${u.ability === 'GUARDA' ? ' is-guard' : ''}${u.shield ? ' has-shield' : ''}${u.sick && mine && u.ability !== 'INVESTIDA' ? ' is-sick' : ''}${dying ? ' is-dying' : ''}`}
      style={{ '--el': el.color, '--el-dark': el.dark }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(u)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(u)} onBlur={() => onHover?.(null)}
      aria-label={`${u.name}: ataque ${u.atk}, vida ${u.hp}${ab?.label ? `, ${ab.label}` : ''}`}
    >
      <span className="tcgb-unit-art"><CardArt card={u} /></span>
      {ab?.icon && <span className="tcgb-unit-ab" title={`${ab.label}: ${abilityText(u.ability, u.value)}`}><Icon d={ab.icon} size={12} /></span>}
      <span className="tcgb-unit-atk"><Icon d={UI.sword} size={11} />{u.atk}</span>
      <span className={`tcgb-unit-hp${u.hp < u.maxHp ? ' is-hurt' : ''}`}><Icon d={UI.heart} size={11} fill />{u.hp}</span>
      {u.level > 1 && <span className="tcgb-unit-lv">{u.level}</span>}
    </button>
  );
}

function Hero({ p, side, targetable, onClick, active }) {
  return (
    <div className={`tcgb-hero is-${side}${targetable ? ' is-target' : ''}${active ? ' is-active' : ''}`} data-hero={side}>
      <button type="button" className="tcgb-hero-face" onClick={onClick} disabled={!targetable} aria-label={`${p.name}: ${p.hp} de vida`}>
        {p.isBot ? <span className="tcgb-bot"><Icon d={UI.bot} size={30} /></span> : <UserAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={56} />}
        <span className="tcgb-hero-hp"><Icon d={UI.heart} size={13} fill />{p.hp}</span>
      </button>
      <div className="tcgb-hero-info">
        <strong data-no-translate>{p.name}</strong>
        <span className="tcgb-energy" title="Energia">
          {Array.from({ length: Math.max(p.maxEnergy, 1) }, (_, i) => <i key={i} className={i < p.energy ? 'on' : ''} />)}
          <em>{p.energy}/{p.maxEnergy}</em>
        </span>
        <span className="tcgb-hero-meta"><Icon d={UI.deck} size={12} />{p.deckCount} no baralho · {p.handCount} na mão</span>
      </div>
    </div>
  );
}

export default function Battle({ initial, onExit, onRematch }) {
  const { socket } = useSocket() || {};
  const [match, setMatch] = useState(initial);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [floats, setFloats] = useState([]);
  const [popup, setPopup] = useState(null);
  const [banner, setBanner] = useState('');
  const [dying, setDying] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pointer, setPointer] = useState(null);
  const boardRef = useRef(null);
  const busyRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;

  const view = match?.view;
  const mySeat = view?.seat ?? 0;
  const legal = view?.legal || { playable: [], attackers: [], targets: {}, canEndTurn: false };
  const myTurn = view && !view.over && view.active === mySeat;

  // ---------- animações ----------
  const elFor = useCallback((ref) => {
    const root = boardRef.current;
    if (!root) return null;
    if (ref === 'hero:me' || ref === 'hero:foe') return root.querySelector(`[data-hero="${ref.slice(5)}"] .tcgb-hero-face`);
    return root.querySelector(`[data-uid="${ref}"]`);
  }, []);

  const float = useCallback((target, text, kind) => {
    const root = boardRef.current;
    if (!root || !target) return;
    const a = target.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    const id = Math.random().toString(36).slice(2);
    setFloats((f) => [...f, { id, text, kind, x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 3 }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
  }, []);

  const lunge = useCallback(async (from, to) => {
    if (!from || !to || reduceMotion()) return;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    try {
      await from.animate([
        { transform: 'translate(0,0) scale(1)', zIndex: 5 },
        { transform: `translate(${dx * 0.78}px, ${dy * 0.78}px) scale(1.12)`, offset: 0.55, zIndex: 5 },
        { transform: 'translate(0,0) scale(1)', zIndex: 5 },
      ], { duration: 460, easing: 'cubic-bezier(.5,0,.3,1)' }).finished;
    } catch { /* elemento saiu da tela */ }
  }, []);

  const shake = useCallback((el) => {
    if (!el || reduceMotion()) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }, []);

  const playEvents = useCallback(async (events = []) => {
    const side = (seat) => (seat === mySeat ? 'me' : 'foe');
    let i = 0;
    for (const e of events) {
      i += 1;
      if (i > 80) break;
      switch (e.type) {
        case 'play':
          if (e.seat !== mySeat) { setPopup(e.card); await wait(reduceMotion() ? 300 : 950); setPopup(null); }
          break;
        case 'attack': await lunge(elFor(e.uid), elFor(e.target === 'hero' ? `hero:${side(1 - e.seat)}` : e.target)); break;
        case 'bolt': float(elFor(e.target), 'Raio!', 'fx'); await wait(250); break;
        case 'unitDamage': float(elFor(e.uid), `-${e.amount}`, 'dmg'); break;
        case 'heroDamage': { const h = elFor(`hero:${side(e.seat)}`); float(h, `-${e.amount}`, 'dmg'); shake(h); await wait(150); break; }
        case 'heroHeal': float(elFor(`hero:${side(e.seat)}`), `+${e.amount}`, 'heal'); break;
        case 'heal': float(elFor(e.uid), `+${e.amount}`, 'heal'); break;
        case 'buff': float(elFor(e.uid), `+${e.atk} atq`, 'fx'); break;
        case 'shieldBreak': float(elFor(e.uid), 'Escudo!', 'fx'); break;
        case 'poison': float(elFor(e.uid), 'Veneno!', 'poison'); break;
        case 'fatigue': float(elFor(`hero:${side(e.seat)}`), `Cansaço -${e.amount}`, 'dmg'); break;
        case 'death': setDying((d) => new Set(d).add(e.uid)); await wait(380); break;
        case 'turn': if (e.seat === mySeat && !events.some((x) => x.type === 'gameOver')) { setBanner('Sua vez!'); setTimeout(() => setBanner(''), 1100); } break;
        default: break;
      }
    }
  }, [elFor, float, lunge, shake, mySeat]);

  const apply = useCallback(async (res) => {
    if (res?.events?.length) await playEvents(res.events);
    setDying(new Set());
    setMatch((m) => ({ ...m, ...res }));
  }, [playEvents]);

  // Ação: manda pro servidor, anima os eventos e troca pra visão nova.
  const send = useCallback(async (action) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setSelected(null);
    try {
      const res = await cardsAction(matchRef.current.id, action);
      await apply(res);
    } catch (e) {
      setError(errMsg(e));
      try { const fresh = await cardsMatch(matchRef.current.id); setMatch((m) => ({ ...m, ...fresh })); } catch { /* ignora */ }
    } finally { busyRef.current = false; setBusy(false); }
  }, [apply]);

  // Primeira entrada: anima o turno do bot que já aconteceu (se o bot começou).
  useEffect(() => {
    if (initial?.events?.length) { busyRef.current = true; setBusy(true); playEvents(initial.events).finally(() => { busyRef.current = false; setBusy(false); }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PvP: atualiza quando o oponente joga (socket) + reserva por polling.
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const fresh = await cardsMatch(matchRef.current.id);
      const cur = matchRef.current;
      if (fresh.version !== cur.version || fresh.status !== cur.status) {
        const prevSeq = cur.view?.seq;
        setMatch((m) => ({ ...m, ...fresh }));
        if (fresh.view && fresh.view.active === fresh.view.seat && prevSeq !== fresh.view.seq && !fresh.view.over) { setBanner('Sua vez!'); setTimeout(() => setBanner(''), 1100); }
      }
    } catch { /* ignora */ }
  }, []);
  useEffect(() => {
    if (!socket || match?.mode !== 'PVP') return undefined;
    const on = (msg) => { if (msg?.id === matchRef.current.id) refresh(); };
    socket.on('cards:match', on);
    return () => socket.off('cards:match', on);
  }, [socket, match?.mode, refresh]);
  useEffect(() => {
    if (match?.mode !== 'PVP' || view?.over) return undefined;
    const t = setInterval(() => { setNow(Date.now()); if (!myTurn) refresh(); else if (match.turnDeadline && Date.now() > new Date(match.turnDeadline).getTime() + 2000) refresh(); }, 1000);
    return () => clearInterval(t);
  }, [match?.mode, match?.turnDeadline, view?.over, myTurn, refresh]);

  // Esc cancela a seleção.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const targets = useMemo(() => new Set(selected ? legal.targets[selected] || [] : []), [selected, legal]);
  const attackers = useMemo(() => new Set(legal.attackers), [legal]);
  const playable = useMemo(() => new Set(legal.playable), [legal]);

  const clickUnit = (u, mine) => {
    if (!myTurn || busy) return;
    if (mine) { if (attackers.has(u.uid)) setSelected((s) => (s === u.uid ? null : u.uid)); return; }
    if (selected && targets.has(u.uid)) send({ type: 'ATTACK', uid: selected, target: u.uid });
  };
  const clickFoeHero = () => { if (selected && targets.has('hero')) send({ type: 'ATTACK', uid: selected, target: 'hero' }); };
  const playCard = (uid) => { if (myTurn && !busy && playable.has(uid)) send({ type: 'PLAY', uid }); };

  // Linha de mira do atacante até o ponteiro.
  const aim = useMemo(() => {
    if (!selected || !pointer || !boardRef.current) return null;
    const from = elFor(selected);
    if (!from) return null;
    const a = from.getBoundingClientRect();
    const b = boardRef.current.getBoundingClientRect();
    return { x1: a.left - b.left + a.width / 2, y1: a.top - b.top + a.height / 2, x2: pointer.x, y2: pointer.y };
  }, [selected, pointer, elFor]);

  if (!view) return <div className="tcgb-loading">Carregando partida…</div>;
  const { me, foe } = view;
  const secondsLeft = match.mode === 'PVP' && match.turnDeadline ? Math.max(0, Math.ceil((new Date(match.turnDeadline).getTime() - now) / 1000)) : null;
  const won = view.over && view.winner === mySeat;

  return (
    <div className="tcgb" ref={boardRef}
      onMouseMove={(e) => { if (!selected || !boardRef.current) return; const b = boardRef.current.getBoundingClientRect(); setPointer({ x: e.clientX - b.left, y: e.clientY - b.top }); }}
      onContextMenu={(e) => { if (selected) { e.preventDefault(); setSelected(null); } }}
    >
      <div className="tcgb-top">
        <button type="button" className="tcg-btn ghost" onClick={onExit}><Icon d={UI.back} /><span className="tcgb-lbl">Sair</span></button>
        <span className="tcgb-turn">Turno {view.turn} · {myTurn ? <b>Sua vez</b> : view.over ? 'Fim de jogo' : `Vez de ${foe.name}`}</span>
        {secondsLeft !== null && !view.over && <span className={`tcgb-timer${secondsLeft <= 15 ? ' is-low' : ''}`}><Icon d={UI.clock} size={14} />{secondsLeft}s</span>}
        <span className="tcgb-spacer" />
        <button type="button" className="tcg-btn ghost" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}><Icon d={UI.list} /><span className="tcgb-lbl">Registro</span></button>
        {!view.over && <button type="button" className="tcg-btn ghost danger" disabled={busy} onClick={() => { if (window.confirm('Desistir da partida?')) send({ type: 'SURRENDER' }); }}><Icon d={UI.flag} /><span className="tcgb-lbl">Desistir</span></button>}
      </div>

      <div className="tcgb-field">
        <div className="tcgb-side is-foe">
          <Hero p={foe} side="foe" targetable={targets.has('hero')} onClick={clickFoeHero} active={view.active !== mySeat && !view.over} />
          <div className="tcgb-foe-hand" aria-label={`${foe.handCount} cartas na mão do oponente`}>
            {Array.from({ length: Math.min(foe.handCount, 10) }, (_, i) => <CardBack key={i} small />)}
          </div>
        </div>
        <div className="tcgb-board is-foe">
          {foe.board.map((u) => <Unit key={u.uid} u={u} targetable={targets.has(u.uid)} dying={dying.has(u.uid)} onClick={() => clickUnit(u, false)} onHover={setHover} />)}
          {!foe.board.length && <span className="tcgb-empty">Campo vazio</span>}
        </div>

        <div className="tcgb-mid">
          <span className="tcgb-mid-line" />
          <button type="button" className={`tcg-btn primary tcgb-endturn${myTurn && !legal.playable.length && !legal.attackers.length ? ' is-pulse' : ''}`} disabled={!myTurn || busy} onClick={() => send({ type: 'END_TURN' })}>
            {busy ? 'Aguarde…' : myTurn ? 'Encerrar turno' : 'Turno do oponente'}
          </button>
          <span className="tcgb-mid-line" />
        </div>

        <div className={`tcgb-board is-me${myTurn && legal.playable.length ? ' is-drop' : ''}`}
          onDragOver={(e) => { if (myTurn) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); playCard(e.dataTransfer.getData('text/plain')); }}
        >
          {me.board.map((u) => <Unit key={u.uid} u={u} mine canAttack={myTurn && attackers.has(u.uid)} selected={selected === u.uid} dying={dying.has(u.uid)} onClick={() => clickUnit(u, true)} onHover={setHover} />)}
          {!me.board.length && <span className="tcgb-empty">{myTurn ? 'Jogue cartas da sua mão aqui' : 'Seu campo'}</span>}
        </div>
        <div className="tcgb-side is-me">
          <Hero p={me} side="me" active={myTurn} />
          <div className="tcgb-hand">
            {(me.hand || []).map((c, i) => (
              <div key={c.uid} className={`tcgb-hand-slot${playable.has(c.uid) && myTurn ? ' is-playable' : ''}`} style={{ '--i': i, '--n': me.hand.length }}>
                <CardView
                  card={c} size="sm" onClick={() => playCard(c.uid)} dim={!myTurn || !playable.has(c.uid)}
                  draggable={myTurn && playable.has(c.uid)}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.uid); e.dataTransfer.effectAllowed = 'move'; }}
                  aria-label={`Jogar ${c.name} (custo ${c.cost})`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && <p className="tcgb-hint">Escolha um alvo {targets.has('hero') ? '(unidade ou herói inimigo)' : '(precisa atacar quem tem Guarda)'} · Esc cancela</p>}
      {error && <div className="tcgb-error" role="alert" onAnimationEnd={() => setError('')}>{error}</div>}
      {aim && (
        <svg className="tcgb-aim" aria-hidden="true">
          <defs><marker id="tcgb-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill="#ff4d6d" /></marker></defs>
          <line x1={aim.x1} y1={aim.y1} x2={aim.x2} y2={aim.y2} stroke="#ff4d6d" strokeWidth="4" strokeDasharray="8 6" markerEnd="url(#tcgb-arrow)" />
        </svg>
      )}
      {floats.map((f) => <span key={f.id} className={`tcgb-float is-${f.kind}`} style={{ left: f.x, top: f.y }}>{f.text}</span>)}
      {popup && <div className="tcgb-popup"><span>{foe.name} jogou</span><CardView card={popup} size="lg" /></div>}
      {banner && <div className="tcgb-banner">{banner}</div>}
      {hover && !popup && <div className="tcgb-preview"><CardView card={hover} size="md" /></div>}

      {showLog && (
        <aside className="tcgb-log">
          <h3>Registro</h3>
          <ol>{[...view.log].reverse().map((l, i) => <li key={i}><em>T{l.t}</em> {l.text}</li>)}</ol>
        </aside>
      )}

      {view.over && (
        <div className="tcgb-end">
          <div className={`tcgb-end-box${won ? ' is-win' : ' is-loss'}`}>
            <span className="tcgb-end-icon"><Icon d={won ? UI.trophy : UI.flag} size={44} /></span>
            <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
            <p>{view.endReason === 'surrender' ? (won ? 'O oponente desistiu.' : 'Você desistiu.') : view.endReason === 'timeout' ? 'Tempo de turno esgotado.' : won ? 'Você derrotou o herói inimigo.' : 'Seu herói caiu.'}</p>
            <p className="tcgb-reward"><Icon d={UI.coin} size={20} />{match.reward > 0 ? `+${match.reward} moedas` : 'Sem recompensa nesta partida'}</p>
            {match.reward === 0 && <small>Partidas muito curtas, desistências no começo ou acima do limite diário não dão moedas.</small>}
            <div className="tcgb-end-actions">
              {match.mode === 'PVE' && <button type="button" className="tcg-btn primary" onClick={() => onRematch?.(match.difficulty)}>Jogar de novo</button>}
              <button type="button" className="tcg-btn" onClick={onExit}>Voltar para a arena</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
