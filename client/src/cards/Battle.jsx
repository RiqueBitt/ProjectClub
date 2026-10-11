import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, CardArt, CardBack, ABILITIES, ELEMENTS, RARITY_ORDER, RARITIES, Icon, UI, abilityText } from './CardView.jsx';
import { cardsAction, cardsMatch, cardsWatch, errMsg } from './api';
import { sfx, startMusic, stopMusic, getSfxPrefs, setSfxPrefs } from './sfx';
import BotPortrait from './BotPortrait.jsx';

// Tela de batalha. O servidor manda a visão do jogador (`view`, com as ações
// legais já calculadas pelo motor) e a lista de eventos da jogada; aqui só
// exibimos e animamos — nenhuma regra é decidida no cliente.
// mode: 'play' (jogando) | 'watch' (assistindo ao vivo) | 'replay' (frames).

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const THEMES = ['floresta', 'vulcao', 'templo', 'abismo', 'oceano'];
const THEME_LABEL = { floresta: 'Floresta Antiga', vulcao: 'Forja do Vulcão', templo: 'Templo Dourado', abismo: 'Abismo Eterno', oceano: 'Recife Profundo' };
const themeOf = (id = '') => THEMES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % THEMES.length];
const isEpic = (c) => RARITY_ORDER.indexOf(c?.rarity) >= RARITY_ORDER.indexOf('EPICA');

function Unit({ u, mine, canAttack, selected, targetable, dying, entering, onClick, onHover }) {
  const el = ELEMENTS[u.element] || ELEMENTS.FOGO;
  const ab = ABILITIES[u.ability];
  return (
    <button
      type="button" data-uid={u.uid}
      className={`tcgb-unit tcg-r-${u.rarity}${canAttack ? ' can-attack' : ''}${selected ? ' is-selected' : ''}${targetable ? ' is-target' : ''}${u.ability === 'GUARDA' ? ' is-guard' : ''}${u.shield ? ' has-shield' : ''}${u.sick && mine && u.ability !== 'INVESTIDA' ? ' is-sick' : ''}${u.frozen ? ' is-frozen' : ''}${u.stealth ? ' is-stealth' : ''}${u.token ? ' is-token' : ''}${u.foil ? ' is-foil' : ''}${dying ? ' is-dying' : ''}${entering && isEpic(u) ? ' is-epic-enter' : ''}`}
      style={{ '--el': el.color, '--el-dark': el.dark, '--rar': RARITIES[u.rarity]?.color }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(u)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(u)} onBlur={() => onHover?.(null)}
      aria-label={`${u.name}: ataque ${u.atk}, vida ${u.hp}${ab?.label ? `, ${ab.label}` : ''}${u.frozen ? ', congelada' : ''}${u.stealth ? ', furtiva' : ''}`}
    >
      <span className="tcgb-unit-art"><CardArt card={u} /></span>
      {ab?.icon && <span className="tcgb-unit-ab" title={`${ab.label}: ${abilityText(u.ability, u.value)}`}><Icon d={ab.icon} size={12} /></span>}
      <span className="tcgb-unit-atk"><Icon d={UI.sword} size={11} />{u.atk}</span>
      <span className={`tcgb-unit-hp${u.hp < u.maxHp ? ' is-hurt' : ''}`}><Icon d={UI.heart} size={11} fill />{u.hp}</span>
      {u.level > 1 && <span className="tcgb-unit-lv">{u.level}</span>}
    </button>
  );
}

function HpRing({ hp, max }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  const color = pct > 0.5 ? '#4cc76b' : pct > 0.25 ? '#ffb020' : '#f23f43';
  return (
    <svg className="tcgb-hp-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="6" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset .5s, stroke .3s' }} />
    </svg>
  );
}

function Hero({ p, side, targetable, onClick, active }) {
  return (
    <div className={`tcgb-hero is-${side}${targetable ? ' is-target' : ''}${active ? ' is-active' : ''}${p.hp <= p.maxHp * 0.25 ? ' is-low' : ''}`} data-hero={side}>
      <button type="button" className="tcgb-hero-face" onClick={onClick} disabled={!targetable} aria-label={`${p.name}: ${p.hp} de vida`}>
        <HpRing hp={p.hp} max={p.maxHp} />
        <span className="tcgb-hero-pic">
          {p.isBot ? <BotPortrait name={p.name} size={72} className="tcgb-bot" /> : <UserAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={72} />}
        </span>
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

function EndTurnButton({ onClick, disabled, busy, myTurn, pulse, secondsLeft, total }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const pct = secondsLeft === null ? 1 : Math.max(0, secondsLeft / Math.max(1, total));
  return (
    <div className={`tcgb-endwrap${pulse ? ' is-pulse' : ''}${secondsLeft !== null && secondsLeft <= 15 ? ' is-low' : ''}`}>
      {secondsLeft !== null && (
        <svg className="tcgb-endring" viewBox="0 0 70 70" aria-hidden="true">
          <circle cx="35" cy="35" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
          <circle cx="35" cy="35" r={r} fill="none" stroke={pct < 0.25 ? '#f23f43' : '#8b6bff'} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 35 35)" />
        </svg>
      )}
      <button type="button" className="tcg-btn primary tcgb-endturn" disabled={disabled} onClick={onClick}>
        {busy ? 'Aguarde…' : myTurn ? 'Encerrar turno' : 'Turno do oponente'}
        {secondsLeft !== null && <small>{secondsLeft}s</small>}
      </button>
    </div>
  );
}

export default function Battle({ initial, onExit, onRematch, mode = 'play', frames = null }) {
  const { socket } = useSocket() || {};
  const readOnly = mode !== 'play';
  const [match, setMatch] = useState(initial);
  const [selected, setSelected] = useState(null); // atacante escolhido
  const [spellSel, setSpellSel] = useState(null); // feitiço aguardando alvo
  const [handPick, setHandPick] = useState(null); // toque no celular (zoom antes de jogar)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [floats, setFloats] = useState([]);
  const [popup, setPopup] = useState(null);
  const [banner, setBanner] = useState('');
  const [dying, setDying] = useState(() => new Set());
  const [entering, setEntering] = useState(() => new Set());
  const [cine, setCine] = useState(null);
  const [hover, setHover] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pointer, setPointer] = useState(null);
  const [audio, setAudio] = useState(getSfxPrefs);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(mode === 'replay');
  const [speed, setSpeed] = useState(1);
  const boardRef = useRef(null);
  const busyRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;
  const theme = useMemo(() => themeOf(initial?.id), [initial?.id]);

  const view = match?.view;
  const mySeat = view?.seat ?? 0;
  const legal = view?.legal || { playable: [], spellTargets: {}, attackers: [], targets: {}, canEndTurn: false };
  const myTurn = !readOnly && view && !view.over && view.active === mySeat;

  // Música ambiente só durante a partida.
  useEffect(() => { startMusic(); return () => stopMusic(); }, []);
  useEffect(() => { if (view?.over && mode === 'play') sfx(view.winner === mySeat ? 'win' : 'lose'); }, [view?.over]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- animações ----------
  const elFor = useCallback((ref) => {
    const root = boardRef.current;
    if (!root || !ref) return null;
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

  const cinematic = useCallback(async (card) => {
    if (reduceMotion()) return;
    setCine({ color: RARITIES[card.rarity]?.color || '#fff', key: Math.random() });
    sfx('epic');
    await wait(650);
    setCine(null);
  }, []);

  const playEvents = useCallback(async (events = [], speedMul = 1) => {
    const side = (seat) => (seat === mySeat ? 'me' : 'foe');
    const W = (ms) => wait(ms / speedMul);
    let i = 0;
    for (const e of events) {
      i += 1;
      if (i > 90) break;
      switch (e.type) {
        case 'play':
          if (e.seat !== mySeat || readOnly) { setPopup({ card: e.card, verb: 'jogou', who: e.seat }); sfx('play'); await W(reduceMotion() ? 300 : 900); setPopup(null); } else sfx('play');
          if (isEpic(e.card)) await cinematic(e.card);
          setEntering((s) => new Set(s).add(e.card.uid));
          break;
        case 'spell':
          sfx('spell');
          if (e.seat !== mySeat || readOnly) { setPopup({ card: e.card, verb: 'lançou', who: e.seat }); await W(reduceMotion() ? 300 : 950); setPopup(null); }
          if (isEpic(e.card)) await cinematic(e.card);
          break;
        case 'summon': setEntering((s) => new Set(s).add(e.card.uid)); break;
        case 'attack': sfx('attack'); await lunge(elFor(e.uid), elFor(e.target === 'hero' ? `hero:${side(1 - e.seat)}` : e.target)); break;
        case 'bolt': float(elFor(e.target), 'Raio!', 'fx'); sfx('spell'); await W(250); break;
        case 'unitDamage': sfx('hit'); float(elFor(e.uid), `-${e.amount}`, 'dmg'); break;
        case 'heroDamage': { const h = elFor(`hero:${side(e.seat)}`); sfx('hero'); float(h, `-${e.amount}`, 'dmg'); shake(h); await W(150); break; }
        case 'heroHeal': sfx('heal'); float(elFor(`hero:${side(e.seat)}`), `+${e.amount}`, 'heal'); break;
        case 'heal': sfx('heal'); float(elFor(e.uid), `+${e.amount}`, 'heal'); break;
        case 'buff': float(elFor(e.uid), e.hp ? `+${e.atk}/+${e.hp}` : `+${e.atk} atq`, 'fx'); break;
        case 'shieldBreak': sfx('shield'); float(elFor(e.uid), 'Escudo!', 'fx'); break;
        case 'shieldUp': sfx('shield'); float(elFor(e.uid), 'Escudo', 'fx'); break;
        case 'freeze': sfx('freeze'); float(elFor(e.uid), 'Congelada!', 'ice'); break;
        case 'thaw': float(elFor(e.uid), 'Descongelou', 'ice'); break;
        case 'reveal': float(elFor(e.uid), 'Revelada!', 'fx'); break;
        case 'poison': float(elFor(e.uid), 'Veneno!', 'poison'); break;
        case 'fatigue': float(elFor(`hero:${side(e.seat)}`), `Cansaço -${e.amount}`, 'dmg'); break;
        case 'death': sfx('death'); setDying((d) => new Set(d).add(e.uid)); await W(380); break;
        case 'draw': if (e.seat === mySeat && !readOnly) sfx('draw'); break;
        case 'turn': if (e.seat === mySeat && !readOnly && !events.some((x) => x.type === 'gameOver')) { sfx('turn'); setBanner('Sua vez!'); setTimeout(() => setBanner(''), 1100); } break;
        default: break;
      }
    }
  }, [elFor, float, lunge, shake, cinematic, mySeat, readOnly]);

  const apply = useCallback(async (res) => {
    if (res?.events?.length) await playEvents(res.events);
    setDying(new Set());
    setMatch((m) => ({ ...m, ...res }));
    setTimeout(() => setEntering(new Set()), 900);
  }, [playEvents]);

  // Ação: manda pro servidor, anima os eventos e troca pra visão nova.
  const send = useCallback(async (action) => {
    if (busyRef.current || readOnly) return;
    busyRef.current = true; setBusy(true); setError(''); setSelected(null); setSpellSel(null); setHandPick(null);
    try {
      const res = await cardsAction(matchRef.current.id, action);
      await apply(res);
    } catch (e) {
      setError(errMsg(e));
      try { const fresh = await cardsMatch(matchRef.current.id); setMatch((m) => ({ ...m, ...fresh })); } catch { /* ignora */ }
    } finally { busyRef.current = false; setBusy(false); }
  }, [apply, readOnly]);

  // Primeira entrada: anima o turno do bot que já aconteceu (se o bot começou).
  useEffect(() => {
    if (initial?.events?.length) { busyRef.current = true; setBusy(true); playEvents(initial.events).finally(() => { busyRef.current = false; setBusy(false); }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PvP: atualiza quando o oponente joga (socket) + reserva por polling.
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const fresh = mode === 'watch' ? await cardsWatch(matchRef.current.id) : await cardsMatch(matchRef.current.id);
      const cur = matchRef.current;
      if (fresh.version !== cur.version || fresh.status !== cur.status) {
        const prevSeq = cur.view?.seq;
        setMatch((m) => ({ ...m, ...fresh }));
        if (mode === 'play' && fresh.view && fresh.view.active === fresh.view.seat && prevSeq !== fresh.view.seq && !fresh.view.over) { sfx('turn'); setBanner('Sua vez!'); setTimeout(() => setBanner(''), 1100); }
      }
    } catch { /* ignora */ }
  }, [mode]);
  useEffect(() => {
    if (!socket || match?.mode !== 'PVP' || mode !== 'play') return undefined;
    const on = (msg) => { if (msg?.id === matchRef.current.id) refresh(); };
    socket.on('cards:match', on);
    return () => socket.off('cards:match', on);
  }, [socket, match?.mode, refresh, mode]);
  useEffect(() => {
    if (mode === 'replay' || view?.over) return undefined;
    if (mode === 'play' && match?.mode !== 'PVP') return undefined;
    const t = setInterval(() => {
      setNow(Date.now());
      if (mode === 'watch') { refresh(); return; }
      if (!myTurn) refresh(); else if (match.turnDeadline && Date.now() > new Date(match.turnDeadline).getTime() + 2000) refresh();
    }, mode === 'watch' ? 2000 : 1000);
    return () => clearInterval(t);
  }, [mode, match?.mode, match?.turnDeadline, view?.over, myTurn, refresh]);

  // Replay: avança os quadros animando os eventos de cada um.
  useEffect(() => {
    if (mode !== 'replay' || !playing || !frames) return undefined;
    if (frameIdx >= frames.length - 1) { setPlaying(false); return undefined; }
    let cancelled = false;
    (async () => {
      const next = frames[frameIdx + 1];
      await playEvents(next.events || [], speed);
      if (cancelled) return;
      setDying(new Set());
      setMatch((m) => ({ ...m, view: next.view }));
      await wait(350 / speed);
      if (!cancelled) setFrameIdx((i) => i + 1);
    })();
    return () => { cancelled = true; };
  }, [mode, playing, frameIdx, frames, speed, playEvents]);
  const jumpTo = (i) => { setPlaying(false); setFrameIdx(i); setMatch((m) => ({ ...m, view: frames[i].view })); };

  // Esc cancela a seleção.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSelected(null); setSpellSel(null); setHandPick(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const targets = useMemo(() => {
    if (spellSel) return new Set(legal.spellTargets?.[spellSel] || []);
    return new Set(selected ? legal.targets[selected] || [] : []);
  }, [selected, spellSel, legal]);
  const attackers = useMemo(() => new Set(legal.attackers), [legal]);
  const playable = useMemo(() => new Set(legal.playable), [legal]);

  const clickUnit = (u, mine) => {
    if (!myTurn || busy) return;
    if (spellSel) { if (targets.has(u.uid)) send({ type: 'PLAY', uid: spellSel, target: u.uid }); return; }
    if (mine) { if (attackers.has(u.uid)) { sfx('click'); setSelected((s) => (s === u.uid ? null : u.uid)); } return; }
    if (selected && targets.has(u.uid)) send({ type: 'ATTACK', uid: selected, target: u.uid });
  };
  const clickFoeHero = () => {
    if (spellSel && targets.has('hero')) send({ type: 'PLAY', uid: spellSel, target: 'hero' });
    else if (selected && targets.has('hero')) send({ type: 'ATTACK', uid: selected, target: 'hero' });
  };
  const playCard = (uid, fromDrag = false) => {
    if (!myTurn || busy || !playable.has(uid)) return;
    // Celular: primeiro toque amplia a carta, o segundo joga.
    if (!fromDrag && coarse() && handPick !== uid) { setHandPick(uid); return; }
    if (legal.spellTargets?.[uid]) { sfx('click'); setSelected(null); setHandPick(null); setSpellSel(uid); return; }
    send({ type: 'PLAY', uid });
  };

  // Linha de mira do atacante (ou feitiço) até o ponteiro.
  const aim = useMemo(() => {
    if ((!selected && !spellSel) || !pointer || !boardRef.current) return null;
    const from = selected ? elFor(selected) : boardRef.current.querySelector('.tcgb-hand-slot.is-casting');
    if (!from) return null;
    const a = from.getBoundingClientRect();
    const b = boardRef.current.getBoundingClientRect();
    return { x1: a.left - b.left + a.width / 2, y1: a.top - b.top + a.height / 2, x2: pointer.x, y2: pointer.y };
  }, [selected, spellSel, pointer, elFor]);

  if (!view) return <div className="tcgb-loading">Carregando partida…</div>;
  const { me, foe } = view;
  const secondsLeft = mode === 'play' && match.mode === 'PVP' && match.turnDeadline && !view.over ? Math.max(0, Math.ceil((new Date(match.turnDeadline).getTime() - now) / 1000)) : null;
  const won = view.over && view.winner === mySeat;
  const spellCard = spellSel ? me.hand?.find((c) => c.uid === spellSel) : null;
  const pickCard = handPick ? me.hand?.find((c) => c.uid === handPick) : null;
  const toggleAudio = () => setAudio(setSfxPrefs({ muted: !audio.muted }));

  return (
    <div className={`tcgb theme-${theme}${cine ? ' is-cine' : ''}`} ref={boardRef}
      onMouseMove={(e) => { if ((!selected && !spellSel) || !boardRef.current) return; const b = boardRef.current.getBoundingClientRect(); setPointer({ x: e.clientX - b.left, y: e.clientY - b.top }); }}
      onContextMenu={(e) => { if (selected || spellSel) { e.preventDefault(); setSelected(null); setSpellSel(null); } }}
    >
      <div className="tcgb-top">
        <button type="button" className="tcg-btn ghost" onClick={() => onExit()}><Icon d={UI.back} /><span className="tcgb-lbl">Sair</span></button>
        <span className="tcgb-turn">
          {mode === 'watch' && <b className="tcgb-live">AO VIVO</b>}
          {mode === 'replay' && <b className="tcgb-live is-replay">REPLAY</b>}
          Turno {view.turn} · {mode === 'play' ? (myTurn ? <b>Sua vez</b> : view.over ? 'Fim de jogo' : `Vez de ${foe.name}`) : (view.over ? 'Fim de jogo' : `Vez de ${view.active === me.seat ? me.name : foe.name}`)}
        </span>
        <span className="tcgb-arena-name">{THEME_LABEL[theme]}</span>
        <span className="tcgb-spacer" />
        <button type="button" className="tcg-btn ghost" onClick={toggleAudio} aria-label={audio.muted ? 'Ativar som' : 'Silenciar'} title={audio.muted ? 'Ativar som' : 'Silenciar'}>
          <Icon d={audio.muted ? 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6' : 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'} />
        </button>
        <button type="button" className="tcg-btn ghost" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}><Icon d={UI.list} /><span className="tcgb-lbl">Registro</span></button>
        {mode === 'play' && !view.over && <button type="button" className="tcg-btn ghost danger" disabled={busy} onClick={() => { if (window.confirm('Desistir da partida?')) send({ type: 'SURRENDER' }); }}><Icon d={UI.flag} /><span className="tcgb-lbl">Desistir</span></button>}
      </div>

      <div className="tcgb-field">
        <div className="tcgb-side is-foe">
          <Hero p={foe} side="foe" targetable={targets.has('hero')} onClick={clickFoeHero} active={view.active === foe.seat && !view.over} />
          <div className="tcgb-foe-hand" aria-label={`${foe.handCount} cartas na mão`}>
            {Array.from({ length: Math.min(foe.handCount, 10) }, (_, i) => <CardBack key={i} small />)}
          </div>
        </div>
        <div className="tcgb-board is-foe">
          {foe.board.map((u) => <Unit key={u.uid} u={u} targetable={targets.has(u.uid)} dying={dying.has(u.uid)} entering={entering.has(u.uid)} onClick={() => clickUnit(u, false)} onHover={setHover} />)}
          {!foe.board.length && <span className="tcgb-empty">Campo vazio</span>}
        </div>

        <div className="tcgb-mid">
          <span className="tcgb-mid-line" />
          {mode === 'play' ? (
            <EndTurnButton
              onClick={() => send({ type: 'END_TURN' })} disabled={!myTurn || busy} busy={busy} myTurn={myTurn}
              pulse={myTurn && !legal.playable.length && !legal.attackers.length} secondsLeft={secondsLeft} total={view.rules?.turnSeconds || 75}
            />
          ) : mode === 'replay' ? (
            <div className="tcgb-replay">
              <button type="button" className="tcg-icon-btn" onClick={() => jumpTo(Math.max(0, frameIdx - 1))} aria-label="Voltar"><Icon d="M15 18l-6-6 6-6" /></button>
              <button type="button" className="tcg-btn primary" onClick={() => { if (frameIdx >= frames.length - 1) jumpTo(0); setPlaying((p) => !p); }}>{playing ? 'Pausar' : frameIdx >= frames.length - 1 ? 'Ver de novo' : 'Reproduzir'}</button>
              <button type="button" className="tcg-icon-btn" onClick={() => jumpTo(Math.min(frames.length - 1, frameIdx + 1))} aria-label="Avançar"><Icon d="M9 6l6 6-6 6" /></button>
              <select className="tcg-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Velocidade"><option value={0.5}>0,5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option></select>
              <span className="tcg-dim">{frameIdx + 1}/{frames.length}</span>
            </div>
          ) : <span className="tcg-dim">Assistindo em tempo real</span>}
          <span className="tcgb-mid-line" />
        </div>

        <div className={`tcgb-board is-me${myTurn && legal.playable.length ? ' is-drop' : ''}`}
          onDragOver={(e) => { if (myTurn) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); playCard(e.dataTransfer.getData('text/plain'), true); }}
        >
          {me.board.map((u) => <Unit key={u.uid} u={u} mine canAttack={myTurn && !spellSel && attackers.has(u.uid)} targetable={targets.has(u.uid)} selected={selected === u.uid} dying={dying.has(u.uid)} entering={entering.has(u.uid)} onClick={() => clickUnit(u, true)} onHover={setHover} />)}
          {!me.board.length && <span className="tcgb-empty">{myTurn ? 'Arraste ou clique numa carta da mão' : 'Campo'}</span>}
        </div>
        <div className="tcgb-side is-me">
          <Hero p={me} side="me" active={view.active === me.seat && !view.over} />
          <div className="tcgb-hand" style={{ '--n': me.hand?.length || 0 }}>
            {(me.hand || []).map((c, i) => (
              <div key={c.uid}
                className={`tcgb-hand-slot${playable.has(c.uid) && myTurn ? ' is-playable' : ''}${spellSel === c.uid ? ' is-casting' : ''}${handPick === c.uid ? ' is-picked' : ''}`}
                style={{ '--i': i, '--n': me.hand.length }}
              >
                <CardView
                  card={c} size="sm" onClick={() => playCard(c.uid)} dim={!myTurn || !playable.has(c.uid)}
                  draggable={myTurn && playable.has(c.uid) && !legal.spellTargets?.[c.uid]}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.uid); e.dataTransfer.effectAllowed = 'move'; }}
                  aria-label={`${c.kind === 'SPELL' ? 'Lançar' : 'Jogar'} ${c.name} (custo ${c.cost})`}
                />
              </div>
            ))}
            {readOnly && me.handCount > 0 && Array.from({ length: Math.min(me.handCount, 10) }, (_, i) => <CardBack key={i} small />)}
          </div>
        </div>
      </div>

      {(selected || spellSel) && (
        <p className="tcgb-hint">
          {spellSel ? `${spellCard?.name}: escolha o alvo` : targets.has('hero') ? 'Escolha um alvo (unidade ou herói inimigo)' : 'Precisa atacar quem tem Guarda'} · Esc cancela
        </p>
      )}
      {pickCard && (
        <div className="tcgb-pick" onClick={() => setHandPick(null)}>
          <CardView card={pickCard} size="lg" />
          <div className="tcgb-pick-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="tcg-btn ghost" onClick={() => setHandPick(null)}>Voltar</button>
            <button type="button" className="tcg-btn primary" onClick={() => playCard(pickCard.uid)}>{pickCard.kind === 'SPELL' ? 'Lançar' : 'Jogar'}</button>
          </div>
        </div>
      )}
      {error && <div className="tcgb-error" role="alert" onAnimationEnd={() => setError('')}>{error}</div>}
      {aim && (
        <svg className="tcgb-aim" aria-hidden="true">
          <defs><marker id="tcgb-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill={spellSel ? '#a46bff' : '#ff4d6d'} /></marker></defs>
          <line x1={aim.x1} y1={aim.y1} x2={aim.x2} y2={aim.y2} stroke={spellSel ? '#a46bff' : '#ff4d6d'} strokeWidth="4" strokeDasharray="8 6" markerEnd="url(#tcgb-arrow)" />
        </svg>
      )}
      {cine && <div key={cine.key} className="tcgb-cine" style={{ '--c': cine.color }} aria-hidden="true" />}
      {floats.map((f) => <span key={f.id} className={`tcgb-float is-${f.kind}`} style={{ left: f.x, top: f.y }}>{f.text}</span>)}
      {popup && <div className="tcgb-popup"><span>{popup.who === me.seat ? me.name : foe.name} {popup.verb}</span><CardView card={popup.card} size="lg" /></div>}
      {banner && <div className="tcgb-banner">{banner}</div>}
      {hover && !popup && <div className="tcgb-preview"><CardView card={hover} size="md" /></div>}

      {showLog && (
        <aside className="tcgb-log">
          <h3>Registro</h3>
          <ol>{[...view.log].reverse().map((l, i) => <li key={i}><em>T{l.t}</em> {l.text}</li>)}</ol>
        </aside>
      )}

      {view.over && mode === 'play' && (
        <div className="tcgb-end">
          <div className={`tcgb-end-box${won ? ' is-win' : ' is-loss'}`}>
            <span className="tcgb-end-icon"><Icon d={won ? UI.trophy : UI.flag} size={44} /></span>
            <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
            <p>{view.endReason === 'surrender' ? (won ? 'O oponente desistiu.' : 'Você desistiu.') : view.endReason === 'timeout' ? 'Tempo de turno esgotado.' : won ? 'Você derrotou o herói inimigo.' : 'Seu herói caiu.'}</p>
            <p className="tcgb-reward"><Icon d={UI.coin} size={20} />{match.reward > 0 ? `+${match.reward} moedas` : 'Sem recompensa nesta partida'}</p>
            {match.result?.campaign && <p className="tcg-ok">Fase concluída: {match.result.campaign.stage}! Próxima fase liberada.</p>}
            {match.reward === 0 && <small>Partidas muito curtas, desistências no começo ou acima do limite diário não dão moedas.</small>}
            <div className="tcgb-end-actions">
              {match.mode === 'PVE' && !match.result?.campaign && <button type="button" className="tcg-btn primary" onClick={() => onRematch?.(match.difficulty)}>Jogar de novo</button>}
              <button type="button" className="tcg-btn" onClick={() => onExit({ replay: match.id })}>Ver replay</button>
              <button type="button" className="tcg-btn" onClick={() => onExit()}>Voltar para a arena</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
