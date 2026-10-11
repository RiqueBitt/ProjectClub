import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, CardArt, CardBack, ABILITIES, ELEMENTS, RARITY_ORDER, RARITIES, Icon, UI, abilityText } from './CardView.jsx';
import { cardsAction, cardsMatch, cardsWatch, cardsStopWatch, cardsEmote, cardsAgain, cardsChallenge, cardsStartBrawl, cardsDraftPlay, cardsBossStart, errMsg } from './api';
import { sfx, startMusic, stopMusic, getSfxPrefs, setSfxPrefs } from './sfx';
import BotPortrait from './BotPortrait.jsx';
import { BoardBackdrop, BOARD_THEMES } from './BoardScene.jsx';

// Tela de batalha. O servidor manda a visão do jogador (`view`, com as ações
// legais já calculadas pelo motor) e a lista de eventos da jogada; aqui só
// exibimos e animamos — nenhuma regra é decidida no cliente.
// mode: 'play' (jogando) | 'watch' (assistindo ao vivo) | 'replay' (frames).

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
const THEMES = ['floresta', 'vulcao', 'templo', 'abismo', 'oceano'];
const themeOf = (id = '') => THEMES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % THEMES.length];
const isEpic = (c) => RARITY_ORDER.indexOf(c?.rarity) >= RARITY_ORDER.indexOf('EPICA');

function Unit({ u, mine, canAttack, selected, targetable, dying, entering, onClick, onHover }) {
  const el = ELEMENTS[u.element] || ELEMENTS.FOGO;
  const ab = ABILITIES[u.ability];
  return (
    <button
      type="button" data-uid={u.uid}
      className={`tcgb-unit tcg-r-${u.rarity}${canAttack ? ' can-attack' : ''}${selected ? ' is-selected' : ''}${targetable ? ' is-target' : ''}${u.ability === 'GUARDA' ? ' is-guard' : ''}${u.shield ? ' has-shield' : ''}${u.sick && mine && u.ability !== 'INVESTIDA' ? ' is-sick' : ''}${u.frozen ? ' is-frozen' : ''}${u.stealth ? ' is-stealth' : ''}${u.token ? ' is-token' : ''}${u.foil ? ' is-foil' : ''}${u.golden ? ' is-golden' : ''}${dying ? ' is-dying' : ''}${entering && isEpic(u) ? ' is-epic-enter' : ''}`}
      style={{ '--el': el.color, '--el-dark': el.dark, '--rar': RARITIES[u.rarity]?.color }}
      onClick={onClick}
      onMouseEnter={() => onHover?.(u)} onMouseLeave={() => onHover?.(null)} onFocus={() => onHover?.(u)} onBlur={() => onHover?.(null)}
      aria-label={`${u.name}: ataque ${u.atk}, vida ${u.hp}${ab?.label ? `, ${ab.label}` : ''}${u.frozen ? ', congelada' : ''}${u.stealth ? ', furtiva' : ''}`}
    >
      <span className="tcgb-unit-shadow" aria-hidden="true" />
      <span className="tcgb-unit-body">
        <span className="tcgb-unit-name" data-no-translate>{u.name}</span>
        <span className="tcgb-unit-art"><CardArt card={u} /><span className="tcgb-unit-gloss" /></span>
        {ab?.icon && <span className="tcgb-unit-ab" title={`${ab.label}: ${abilityText(u.ability, u.value)}`}><Icon d={ab.icon} size={12} /></span>}
        <span className="tcgb-unit-pt">
          <b className={`tcgb-unit-atk${u.atk > u.baseAtk ? ' is-up' : ''}`}>{u.atk}</b><i>/</i><b className={`tcgb-unit-hp${u.hp < u.maxHp ? ' is-hurt' : ''}`}>{u.hp}</b>
        </span>
        {u.level > 1 && <span className="tcgb-unit-lv">Nv {u.level}</span>}
      </span>
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

function TeamChips({ team, activeMember }) {
  if (!team?.length) return null;
  return (
    <span className="tcgb-team">
      {team.map((m) => {
        const on = activeMember && (m.userId || m.name) === activeMember;
        return (
          <span key={m.userId || m.name} className={`tcgb-team-m${on ? ' is-on' : ''}`} title={`${m.name}: ${m.handCount} na mão · ${m.energy}/${m.maxEnergy} de energia`}>
            {m.isBot ? <BotPortrait name={m.name} size={22} /> : <UserAvatar user={{ displayName: m.name, avatarUrl: m.avatarUrl }} size={22} />}
            <em data-no-translate>{m.name}</em><small>{m.handCount}</small>
          </span>
        );
      })}
    </span>
  );
}

// Coluna da esquerda: retrato com anel de vida e a vida grande (alvo dos ataques).
function RailHero({ p, side, targetable, onClick, active, bubble }) {
  return (
    <div className={`tcgb-hero tcgb-railhero is-${side} fr-${(p.cosmetics?.frame || 'frame:padrao').replace('frame:', '')}${targetable ? ' is-target' : ''}${active ? ' is-active' : ''}${p.hp <= p.maxHp * 0.25 ? ' is-low' : ''}`} data-hero={side}>
      <button type="button" className="tcgb-hero-face" onClick={onClick} disabled={!targetable} aria-label={`${p.name}: ${p.hp} de vida`} title={p.name}>
        <HpRing hp={p.hp} max={p.maxHp} />
        <span className="tcgb-hero-pic">
          {p.isBot ? <BotPortrait name={p.name} size={52} className="tcgb-bot" /> : <UserAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={52} />}
        </span>
        {bubble && <span key={bubble.id} className="tcgb-bubble">{bubble.text}</span>}
      </button>
      <span className="tcgb-rail-hp" title="Vida"><b>{p.hp}</b><small>/{p.maxHp}</small></span>
    </div>
  );
}

// Plaquinha do jogador no canto da área dele: nome, energia, poder, time.
function Plate({ p, side, activeMember, children }) {
  return (
    <div className={`tcgb-plate is-${side}`}>
      <strong data-no-translate>{p.name}</strong>
      <TeamChips team={p.team} activeMember={activeMember} />
      <span className="tcgb-energy" title={`Energia: ${p.energy}/${p.maxEnergy}`}>
        {Array.from({ length: Math.max(p.maxEnergy, 1) }, (_, i) => <i key={i} className={i < p.energy ? 'on' : ''} />)}
        <em>{p.energy}/{p.maxEnergy}</em>
      </span>
      {children}
    </div>
  );
}

// Coluna da direita: baralho, descarte e mão (contagens).
function Piles({ p, side }) {
  return (
    <div className={`tcgb-piles is-${side}`}>
      <div className="tcgb-pile is-deck" title={`${p.deckCount} cartas no baralho`}>
        <CardBack variant={p.cosmetics?.back} />
        <b>{p.deckCount}</b>
        <small>Baralho</small>
      </div>
      <div className="tcgb-pile is-count" title="Cartas usadas ou destruídas"><small>Descarte</small><b>{p.graveyard}</b></div>
      <div className="tcgb-pile is-count" title="Cartas na mão"><small>Mão</small><b>{p.handCount}</b></div>
    </div>
  );
}


const EMOTES = [['hello', 'Olá!'], ['gg', 'Bom jogo!'], ['nice', 'Boa jogada!'], ['wow', 'Uau!'], ['think', 'Hmm…'], ['oops', 'Ops!'], ['thanks', 'Valeu!'], ['threat', 'Prepare-se!']];
const EFFECT_LABEL = {
  CHAMAS: ['Chão de lava', 'No início de cada turno, o herói da vez leva 1 de dano.'], BENCAO: ['Solo sagrado', 'Todas as curas são dobradas.'],
  ARCANO: ['Energia arcana', 'Todas as cartas custam 1 a menos.'], FURIA: ['Grito de guerra', 'Todas as unidades entram com +1 de ataque.'],
  MARE: ['Maré alta', 'Todos compram 1 carta a mais por turno.'], REGENERACAO: ['Seiva viva', 'No início do seu turno, suas unidades curam 1 de vida.'],
  GIGANTES: ['Terra de gigantes', 'Todas as unidades entram com +1/+1.'],
};
const readPref = (k, fb) => { try { const v = localStorage.getItem(k); return v === null ? fb : v; } catch { return fb; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } };

function HeroPower({ power, usable, casting, onUse, foe }) {
  if (!power) return null;
  const el = ELEMENTS[power.element] || ELEMENTS.FOGO;
  return (
    <button
      type="button" className={`tcgb-power${usable ? ' is-ready' : ''}${power.used ? ' is-used' : ''}${casting ? ' is-casting' : ''}${foe ? ' is-foe' : ''}`}
      style={{ '--el': el.color, '--el-dark': el.dark }} disabled={!usable} onClick={onUse}
      title={`Poder do herói — ${power.label} (${power.cost} de energia, 1x por turno): ${power.desc}`} aria-label={`Poder do herói: ${power.label}`}
    >
      <Icon d={el.glyph} size={foe ? 16 : 20} />
      <b>{power.cost}</b>
      {!foe && <em>{power.label}</em>}
    </button>
  );
}

// Dicas do tutorial: olham o estado da partida e mostram o próximo passo.
function TutorialCoach({ view, legal, myTurn, selected, casting, onHide }) {
  const me = view.me;
  let tip;
  if (view.over) return null;
  if (!myTurn) tip = 'Agora é a vez do Treinador Theo. Observe as jogadas dele — na sua vez você faz igual!';
  else if (selected) tip = 'Agora clique no alvo: uma unidade inimiga ou o herói inimigo. Se houver unidade com Guarda (escudo), ela precisa ser atacada primeiro.';
  else if (casting) tip = 'Escolha o alvo: clique numa das unidades ou heróis destacados. Esc cancela.';
  else if (view.turn <= 1 && !me.board.length && legal.playable.length) tip = 'Estas são suas cartas! O número no hexágono azul é o custo em energia (os losangos ao lado do seu nome). Clique numa carta para jogá-la no campo.';
  else if (legal.attackers.length) tip = 'Suas unidades com brilho verde podem atacar! Clique em uma delas e depois no alvo. Atacar o herói inimigo tira vida dele.';
  else if (legal.playable.length) tip = 'Você ainda tem energia: jogue mais cartas. Feitiços (cartas com arte redonda) causam efeitos na hora.';
  else if (legal.power) tip = 'Sobrou energia? Use o PODER DO HERÓI: o botão redondo ao lado do seu retrato (custa 2).';
  else if (me.board.some((u) => u.sick)) tip = 'Unidades novas descansam (Zz) e só atacam no próximo turno. Clique em Encerrar turno.';
  else tip = 'Nada mais a fazer agora: clique em Encerrar turno.';
  return (
    <div className="tcgb-coach" role="status">
      <span className="tcgb-coach-pic"><BotPortrait name="Treinador Theo" size={44} /></span>
      <p>{tip}</p>
      <button type="button" className="tcg-icon-btn" onClick={onHide} aria-label="Ocultar dicas"><Icon d={UI.close} size={14} /></button>
    </div>
  );
}

function EndTurnButton({ onClick, disabled, busy, myTurn, pulse, secondsLeft, total, partnerTurn }) {
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
        {busy ? 'Aguarde…' : myTurn ? 'Encerrar turno' : partnerTurn ? 'Vez do parceiro' : 'Turno do oponente'}
        {secondsLeft !== null && <small>{secondsLeft}s</small>}
      </button>
    </div>
  );
}

export default function Battle({ initial, onExit, onRematch, mode = 'play', frames = null, boards = [] }) {
  const { socket } = useSocket() || {};
  const { user: authUser } = useAuth() || {};
  const myId = authUser?.id;
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
  const [side, setSide] = useState(initial?.side || 0); // espectador: de que lado assiste
  const [powerSel, setPowerSel] = useState(false); // poder do herói aguardando alvo
  const [fast, setFast] = useState(() => readPref('pc-cards-speed', '1') === '2');
  const fastRef = useRef(fast);
  fastRef.current = fast;
  const [bubbles, setBubbles] = useState({});
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [emotesMuted, setEmotesMuted] = useState(() => readPref('pc-cards-emotes', 'on') === 'off');
  const [coach, setCoach] = useState(true);
  const [handOpen, setHandOpen] = useState(false);
  const [endNote, setEndNote] = useState('');
  const seenEmotes = useRef(new Set());
  const [ticker, setTicker] = useState([]);
  const nRef = useRef(initial?.n ?? null);
  const sideRef = useRef(side);
  sideRef.current = side;
  const boardRef = useRef(null);
  const busyRef = useRef(false);
  const matchRef = useRef(match);
  matchRef.current = match;
  const theme = useMemo(() => themeOf(initial?.id), [initial?.id]);
  const board = useMemo(() => boards?.find((b) => b.id === (match?.boardId || initial?.boardId)) || { theme, name: BOARD_THEMES[theme]?.label, accent: BOARD_THEMES[theme]?.accent }, [boards, match?.boardId, initial?.boardId, theme]);

  const view = match?.view;
  const mySeat = view?.seat ?? 0;
  const legal = view?.legal || { playable: [], spellTargets: {}, attackers: [], targets: {}, canEndTurn: false };
  // 2v2: o time está na vez, mas só joga o membro da vez.
  const myTurn = !readOnly && view && !view.over && view.active === mySeat && (!view.duo || view.activeMember === myId);
  const partnerTurn = !readOnly && view?.duo && !view.over && view.active === mySeat && view.activeMember !== myId;

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
    const dur = fastRef.current ? 260 : 460;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    try {
      await from.animate([
        { transform: 'translate(0,0) scale(1)', zIndex: 5 },
        { transform: `translate(${dx * 0.78}px, ${dy * 0.78}px) scale(1.12)`, offset: 0.55, zIndex: 5 },
        { transform: 'translate(0,0) scale(1)', zIndex: 5 },
      ], { duration: dur, easing: 'cubic-bezier(.5,0,.3,1)' }).finished;
    } catch { /* elemento saiu da tela */ }
  }, []);

  const shake = useCallback((el) => {
    if (!el || reduceMotion()) return;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }, []);

  // Entrada especial: épicas ganham um feixe; lendárias e míticas têm uma
  // animação própria do elemento (fogo, água, terra, ar, luz, sombra) + nome.
  const cinematic = useCallback(async (card) => {
    if (reduceMotion()) return;
    const legend = RARITY_ORDER.indexOf(card.rarity) >= RARITY_ORDER.indexOf('LENDARIA');
    setCine({ color: RARITIES[card.rarity]?.color || '#fff', el: card.element, legend, name: card.name, key: Math.random() });
    sfx('epic');
    await wait(legend ? (fastRef.current ? 700 : 1250) : 650);
    setCine(null);
  }, []);

  const playEvents = useCallback(async (events = [], speedArg = null) => {
    const side = (seat) => (seat === mySeat ? 'me' : 'foe');
    const speedMul = speedArg || (fastRef.current ? 2 : 1);
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
        case 'power': sfx('power'); float(elFor(`hero:${side(e.seat)}`), 'Poder!', 'fx'); await W(250); break;
        case 'synergy': {
          sfx('synergy');
          const name = ELEMENTS[e.element]?.label || e.element;
          for (const uid of e.uids || []) float(elFor(uid), '+1/+1', 'fx');
          setBanner(`Sinergia de ${name}!`); setTimeout(() => setBanner(''), 1100);
          await W(450);
          break;
        }
        case 'boardFx': float(elFor(`hero:${side(e.seat)}`), 'Lava!', 'dmg'); await W(200); break;
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
        case 'turn': if (e.seat === mySeat && !readOnly && !events.some((x) => x.type === 'gameOver')) {
          const mine = !matchRef.current?.view?.duo || e.member === myId;
          sfx('turn'); setBanner(mine ? 'Sua vez!' : 'Vez do seu parceiro'); setTimeout(() => setBanner(''), 1100);
        } break;
        default: break;
      }
    }
  }, [elFor, float, lunge, shake, cinematic, mySeat, readOnly, myId]);

  const apply = useCallback(async (res) => {
    if (res?.events?.length) await playEvents(res.events);
    setDying(new Set());
    matchRef.current = { ...matchRef.current, ...res };
    setMatch((m) => ({ ...m, ...res }));
    setTimeout(() => setEntering(new Set()), 900);
  }, [playEvents]);

  // Ação: manda pro servidor, anima os eventos e troca pra visão nova.
  const send = useCallback(async (action) => {
    if (busyRef.current || readOnly) return;
    busyRef.current = true; setBusy(true); setError(''); setSelected(null); setSpellSel(null); setHandPick(null); setPowerSel(false);
    try {
      const res = await cardsAction(matchRef.current.id, action);
      await apply(res);
      return res;
    } catch (e) {
      setError(errMsg(e));
      try { const fresh = await cardsMatch(matchRef.current.id); setMatch((m) => ({ ...m, ...fresh })); } catch { /* ignora */ }
      return null;
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
      if (mode === 'watch') {
        const fresh = await cardsWatch(matchRef.current.id, { lado: sideRef.current, ...(nRef.current !== null ? { n: nRef.current } : {}) });
        const cur = matchRef.current;
        const changed = fresh.version !== cur.version || fresh.status !== cur.status;
        nRef.current = fresh.n;
        if (changed && fresh.events?.length && fresh.side === sideRef.current) {
          busyRef.current = true;
          try { await playEvents(fresh.events); } finally { busyRef.current = false; }
          setDying(new Set());
          setTimeout(() => setEntering(new Set()), 900);
        }
        setMatch((m) => ({ ...m, ...fresh }));
        return;
      }
      const fresh = await cardsMatch(matchRef.current.id);
      const cur = matchRef.current;
      if (fresh.version !== cur.version || fresh.status !== cur.status || fresh.spectators !== cur.spectators) {
        const prevSeq = cur.view?.seq;
        setMatch((m) => ({ ...m, ...fresh }));
        if (mode === 'play' && fresh.view && fresh.view.active === fresh.view.seat && (!fresh.view.duo || fresh.view.activeMember === myId) && prevSeq !== fresh.view.seq && !fresh.view.over) { sfx('turn'); setBanner('Sua vez!'); setTimeout(() => setBanner(''), 1100); }
      }
    } catch { /* ignora */ }
  }, [mode, playEvents, myId]);
  // Espectador: troca de lado (busca a visão do outro jogador na hora).
  useEffect(() => {
    if (mode !== 'watch') return undefined;
    nRef.current = null;
    refresh();
    return undefined;
  }, [side]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (mode === 'watch') cardsStopWatch(initial?.id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Faixa com as últimas jogadas pra quem assiste.
  useEffect(() => {
    if (mode !== 'watch' || !view?.log?.length) return;
    setTicker(view.log.slice(-3).reverse());
  }, [mode, view?.log?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!socket || match?.mode !== 'PVP' || mode !== 'play') return undefined;
    const on = (msg) => { if (msg?.id === matchRef.current.id) refresh(); };
    socket.on('cards:match', on);
    return () => socket.off('cards:match', on);
  }, [socket, match?.mode, refresh, mode]);
  useEffect(() => {
    if (mode === 'replay' || view?.over) return undefined;
    if (mode === 'play' && match?.mode !== 'PVP') return undefined;
    let tick = 0;
    const t = setInterval(() => {
      setNow(Date.now());
      tick += 1;
      if (mode === 'watch') { refresh(); return; }
      if (!myTurn) refresh(); else if ((match.turnDeadline && Date.now() > new Date(match.turnDeadline).getTime() + 2000) || tick % 10 === 0) refresh();
    }, mode === 'watch' ? 1800 : 1000);
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

  // Emotes: chegam pelo socket (e, como reserva, junto com a partida).
  const showBubble = useCallback((who, text) => {
    const id = Math.random();
    setBubbles((b) => ({ ...b, [who]: { id, text } }));
    setTimeout(() => setBubbles((b) => (b[who]?.id === id ? { ...b, [who]: null } : b)), 3200);
  }, []);
  useEffect(() => {
    if (!socket) return undefined;
    const on = (msg) => {
      if (msg?.id !== matchRef.current?.id || !msg.emote || seenEmotes.current.has(msg.emote.id)) return;
      seenEmotes.current.add(msg.emote.id);
      if (emotesMuted) return;
      sfx('emote');
      showBubble(msg.emote.seat === (matchRef.current?.view?.seat ?? 0) ? 'me' : 'foe', msg.emote.text);
    };
    socket.on('cards:emote', on);
    return () => socket.off('cards:emote', on);
  }, [socket, emotesMuted, showBubble]);
  useEffect(() => {
    for (const e of match?.emotes || []) {
      if (seenEmotes.current.has(e.id)) continue;
      seenEmotes.current.add(e.id);
      if (e.by === myId || emotesMuted) continue;
      showBubble(e.seat === mySeat ? 'me' : 'foe', e.text);
    }
  }, [match?.emotes]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendEmote = async (key, text) => {
    setEmoteOpen(false);
    showBubble('me', text);
    try { const r = await cardsEmote(matchRef.current.id, key); if (r?.emote) seenEmotes.current.add(r.emote.id); } catch { /* ignora */ }
  };

  // Esc cancela a seleção.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSelected(null); setSpellSel(null); setHandPick(null); setPowerSel(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const targets = useMemo(() => {
    if (powerSel) return new Set(legal.power?.targets || []);
    if (spellSel) return new Set(legal.spellTargets?.[spellSel] || []);
    return new Set(selected ? legal.targets[selected] || [] : []);
  }, [selected, spellSel, powerSel, legal]);
  const attackers = useMemo(() => new Set(legal.attackers), [legal]);
  const playable = useMemo(() => new Set(legal.playable), [legal]);

  const clickUnit = (u, mine) => {
    if (!myTurn || busy) return;
    if (powerSel) { if (targets.has(u.uid)) send({ type: 'POWER', target: u.uid }); return; }
    if (spellSel) { if (targets.has(u.uid)) send({ type: 'PLAY', uid: spellSel, target: u.uid }); return; }
    if (mine) { if (attackers.has(u.uid)) { sfx('click'); setSelected((s) => (s === u.uid ? null : u.uid)); } return; }
    if (selected && targets.has(u.uid)) send({ type: 'ATTACK', uid: selected, target: u.uid });
  };
  const clickFoeHero = () => {
    if (powerSel && targets.has('hero')) send({ type: 'POWER', target: 'hero' });
    else if (spellSel && targets.has('hero')) send({ type: 'PLAY', uid: spellSel, target: 'hero' });
    else if (selected && targets.has('hero')) send({ type: 'ATTACK', uid: selected, target: 'hero' });
  };
  const usePower = () => {
    if (!myTurn || busy || !legal.power) return;
    if (legal.power.targets) { sfx('click'); setSelected(null); setSpellSel(null); setPowerSel((v) => !v); return; }
    send({ type: 'POWER' });
  };
  // Ataca com todas as unidades que puderem (no herói quando dá, senão no alvo obrigatório).
  const attackAll = async () => {
    if (!myTurn || busyRef.current) return;
    for (let i = 0; i < 12; i += 1) {
      const v = matchRef.current?.view;
      const L = v?.legal;
      if (!v || v.over || !L?.attackers?.length) break;
      const a = L.attackers[0];
      const t = L.targets[a] || [];
      if (!t.length) break;
      const res = await send({ type: 'ATTACK', uid: a, target: t.includes('hero') ? 'hero' : t[0] });
      if (!res) break;
    }
  };
  const toggleFast = () => { setFast((f) => { writePref('pc-cards-speed', f ? '1' : '2'); return !f; }); };
  const toggleEmotes = () => { setEmotesMuted((m) => { writePref('pc-cards-emotes', m ? 'on' : 'off'); return !m; }); };
  const playAgain = async () => {
    setEndNote('');
    try {
      if (match.lobbyId) { const r = await cardsAgain(match.id); onExit({ room: r.code }); return; }
      if (match.kind === 'BRAWL') { const m = await cardsStartBrawl(); onExit({ start: m }); return; }
      if (match.kind === 'DRAFT') { const m = await cardsDraftPlay(); onExit({ start: m }); return; }
      if (match.kind === 'BOSS') { const m = await cardsBossStart(); onExit({ start: m }); return; }
      if (match.mode === 'PVP' && view.foe.userId) { await cardsChallenge(view.foe.userId); setEndNote(`Revanche enviada para ${view.foe.name}! Assim que aceitar, a partida começa.`); }
    } catch (e) { setEndNote(errMsg(e)); }
  };

  const playCard = (uid, fromDrag = false) => {
    if (!myTurn || busy || !playable.has(uid)) return;
    // Celular: primeiro toque amplia a carta, o segundo joga.
    if (!fromDrag && coarse() && handPick !== uid) { setHandPick(uid); return; }
    if (legal.spellTargets?.[uid]) { sfx('click'); setSelected(null); setHandPick(null); setPowerSel(false); setSpellSel(uid); return; }
    send({ type: 'PLAY', uid });
  };

  // Linha de mira do atacante (ou feitiço) até o ponteiro.
  const aim = useMemo(() => {
    if ((!selected && !spellSel && !powerSel) || !pointer || !boardRef.current) return null;
    const from = selected ? elFor(selected) : powerSel ? boardRef.current.querySelector('.tcgb-power.is-casting') : boardRef.current.querySelector('.tcgb-hand-slot.is-casting');
    if (!from) return null;
    const a = from.getBoundingClientRect();
    const b = boardRef.current.getBoundingClientRect();
    return { x1: a.left - b.left + a.width / 2, y1: a.top - b.top + a.height / 2, x2: pointer.x, y2: pointer.y };
  }, [selected, spellSel, powerSel, pointer, elFor]);

  if (!view) return <div className="tcgb-loading">Carregando partida…</div>;
  const { me, foe } = view;
  const secondsLeft = mode === 'play' && match.mode === 'PVP' && match.turnDeadline && !view.over ? Math.max(0, Math.ceil((new Date(match.turnDeadline).getTime() - now) / 1000)) : null;
  const won = view.over && view.winner === mySeat;
  const spellCard = spellSel ? me.hand?.find((c) => c.uid === spellSel) : null;
  const pickCard = handPick ? me.hand?.find((c) => c.uid === handPick) : null;
  const toggleAudio = () => setAudio(setSfxPrefs({ muted: !audio.muted }));
  const activeSide = view.active === me.seat ? me : foe;
  const activeName = activeSide.team?.find((t) => (t.userId || t.name) === view.activeMember)?.name || activeSide.name;

  return (
    <div className={`tcgb theme-${board.theme || theme}${cine ? ' is-cine' : ''}${readOnly ? ' is-readonly' : ''}`} ref={boardRef} style={{ '--accent': board.accent || '#8b6bff' }}
      onMouseMove={(e) => { if ((!selected && !spellSel && !powerSel) || !boardRef.current) return; const b = boardRef.current.getBoundingClientRect(); setPointer({ x: e.clientX - b.left, y: e.clientY - b.top }); }}
      onContextMenu={(e) => { if (selected || spellSel || powerSel) { e.preventDefault(); setSelected(null); setSpellSel(null); setPowerSel(false); } }}
    >
      <BoardBackdrop board={board} />
      <div className="tcgb-top">
        <button type="button" className="tcg-btn ghost" onClick={() => onExit()}><Icon d={UI.back} /><span className="tcgb-lbl">Sair</span></button>
        <span className="tcgb-turn">
          {mode === 'watch' && <b className="tcgb-live">AO VIVO</b>}
          {mode === 'replay' && <b className="tcgb-live is-replay">REPLAY</b>}
          Turno {view.turn} · {mode === 'play' ? (myTurn ? <b>Sua vez</b> : view.over ? 'Fim de jogo' : partnerTurn ? <b className="is-partner">Vez do seu parceiro</b> : `Vez de ${activeName}`) : (view.over ? 'Fim de jogo' : `Vez de ${activeName}`)}
          {match.custom && <em className="tcgb-chip is-custom">Personalizada · sem recompensas</em>}
          {view.duo && <em className="tcgb-chip is-duo">2 vs 2</em>}
        </span>
        <span className="tcgb-arena-name">{board.name}</span>
        {view.rules?.effect && view.rules.effect !== 'NONE' && EFFECT_LABEL[view.rules.effect] && (
          <span className="tcgb-effect" title={EFFECT_LABEL[view.rules.effect][1]}><Icon d={UI.star} size={12} />{EFFECT_LABEL[view.rules.effect][0]}</span>
        )}
        {view.rules?.brawl && <span className="tcgb-effect is-brawl" title="Briga da semana: regras especiais"><Icon d={UI.trophy} size={12} />Briga da semana</span>}
        {match.kind === 'DRAFT' && <span className="tcgb-effect is-brawl" title="Partida do Draft"><Icon d={UI.wand} size={12} />Draft</span>}
        {match.kind === 'BOSS' && <span className="tcgb-effect is-brawl" title="Chefão semanal da comunidade"><Icon d={UI.flag} size={12} />Chefão semanal</span>}
        <span className="tcgb-spacer" />
        {match.spectators > 0 && (
          <span className="tcgb-eye" title={mode === 'watch' ? 'Pessoas assistindo' : 'Pessoas assistindo sua partida'}>
            <Icon d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" size={15} />{match.spectators}
          </span>
        )}
        {mode === 'watch' && (
          <button type="button" className="tcg-btn ghost" onClick={() => setSide((x) => 1 - x)} title="Ver a partida do lado do outro jogador">
            <Icon d={UI.swap} /><span className="tcgb-lbl">Trocar lado</span>
          </button>
        )}
      </div>

      <div className="tcgb-table">
        {/* Coluna da esquerda: vida dos heróis e ações */}
        <aside className="tcgb-rail">
          <RailHero p={foe} side="foe" targetable={targets.has('hero')} onClick={clickFoeHero} active={view.active === foe.seat && !view.over} bubble={bubbles.foe} />
          <div className="tcgb-rail-tools">
            {mode === 'play' && match.mode === 'PVP' && !view.over && (
              <span className="tcgb-emote-wrap">
                <button type="button" className="tcgb-rail-btn" onClick={() => setEmoteOpen((v) => !v)} aria-expanded={emoteOpen} aria-label="Emotes" title="Emotes">
                  <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01" />
                </button>
                {emoteOpen && (
                  <div className="tcgb-emotes">
                    {EMOTES.map(([k, t]) => <button key={k} type="button" onClick={() => sendEmote(k, t)}>{t}</button>)}
                    <label className="tcg-check"><input type="checkbox" checked={emotesMuted} onChange={toggleEmotes} />Silenciar emotes do oponente</label>
                  </div>
                )}
              </span>
            )}
            {mode !== 'replay' && (
              <button type="button" className={`tcgb-rail-btn tcgb-speed${fast ? ' on' : ''}`} onClick={toggleFast} title="Velocidade das animações" aria-pressed={fast}>{fast ? '2x' : '1x'}</button>
            )}
            <button type="button" className="tcgb-rail-btn" onClick={toggleAudio} aria-label={audio.muted ? 'Ativar som' : 'Silenciar'} title={audio.muted ? 'Ativar som' : 'Silenciar'}>
              <Icon d={audio.muted ? 'M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6' : 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13'} />
            </button>
            <button type="button" className={`tcgb-rail-btn${showLog ? ' on' : ''}`} onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} aria-label="Registro" title="Registro da partida"><Icon d={UI.list} /></button>
            {mode === 'play' && !view.over && <button type="button" className="tcgb-rail-btn is-danger" disabled={busy} onClick={() => { if (window.confirm('Desistir da partida?')) send({ type: 'SURRENDER' }); }} aria-label="Desistir" title="Desistir"><Icon d={UI.flag} /></button>}
          </div>
          <RailHero p={me} side="me" active={view.active === me.seat && !view.over} bubble={bubbles.me} />
        </aside>

        {/* Mesa: área do oponente em cima, a sua embaixo */}
        <div className="tcgb-zones">
          <div className="tcgb-foe-hand" aria-label={`${foe.handCount} cartas na mão`}>
            {Array.from({ length: Math.min(foe.handCount, 10) }, (_, i) => <CardBack key={i} variant={foe.cosmetics?.back} />)}
          </div>
          <section className={`tcgb-zone is-foe${view.active === foe.seat && !view.over ? ' is-active' : ''}`}>
            <Plate p={foe} side="foe" activeMember={view.active === foe.seat ? view.activeMember : null}>
              <HeroPower power={foe.power} foe />
            </Plate>
            <div className="tcgb-board is-foe">
              {foe.board.map((u) => <Unit key={u.uid} u={u} targetable={targets.has(u.uid)} dying={dying.has(u.uid)} entering={entering.has(u.uid)} onClick={() => clickUnit(u, false)} onHover={setHover} />)}
              {!foe.board.length && <span className="tcgb-empty">Campo vazio</span>}
            </div>
          </section>

          <div className="tcgb-mid">
            {mode === 'play' ? (
              <>
                {myTurn && (legal.playable.length + legal.attackers.length + (legal.power ? 1 : 0)) > 0 && (
                  <span className="tcgb-left" title="Cartas que dá pra jogar, unidades que podem atacar e o poder do herói">
                    {legal.playable.length > 0 && <i><Icon d={UI.deck} size={12} />{legal.playable.length}</i>}
                    {legal.attackers.length > 0 && <i><Icon d={UI.sword} size={12} />{legal.attackers.length}</i>}
                    {legal.power && <i><Icon d={UI.bolt} size={12} />poder</i>}
                  </span>
                )}
                {myTurn && legal.attackers.length > 1 && !spellSel && !powerSel && (
                  <button type="button" className="tcg-btn tcgb-allin" disabled={busy} onClick={attackAll} title="Ataca com todas as unidades que puderem"><Icon d={UI.sword} />Atacar com tudo</button>
                )}
                <EndTurnButton
                  onClick={() => send({ type: 'END_TURN' })} disabled={!myTurn || busy} busy={busy} myTurn={myTurn} partnerTurn={partnerTurn}
                  pulse={myTurn && !legal.playable.length && !legal.attackers.length && !legal.power} secondsLeft={secondsLeft} total={view.rules?.turnSeconds || 75}
                />
              </>
            ) : mode === 'replay' ? (
              <div className="tcgb-replay">
                <button type="button" className="tcg-icon-btn" onClick={() => jumpTo(Math.max(0, frameIdx - 1))} aria-label="Voltar"><Icon d="M15 18l-6-6 6-6" /></button>
                <button type="button" className="tcg-btn primary" onClick={() => { if (frameIdx >= frames.length - 1) jumpTo(0); setPlaying((p) => !p); }}>{playing ? 'Pausar' : frameIdx >= frames.length - 1 ? 'Ver de novo' : 'Reproduzir'}</button>
                <button type="button" className="tcg-icon-btn" onClick={() => jumpTo(Math.min(frames.length - 1, frameIdx + 1))} aria-label="Avançar"><Icon d="M9 6l6 6-6 6" /></button>
                <select className="tcg-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Velocidade"><option value={0.5}>0,5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option></select>
                <span className="tcg-dim">{frameIdx + 1}/{frames.length}</span>
              </div>
            ) : (
              <div className="tcgb-watchbar">
                <b className="tcgb-live">AO VIVO</b>
                <span>{view.over ? 'Partida encerrada' : `Vez de ${view.active === me.seat ? me.name : foe.name}`}</span>
                {match.watchers?.length > 0 && (
                  <span className="tcgb-watchers" title={match.watchers.map((w) => w.displayName).join(', ')}>
                    {match.watchers.slice(0, 5).map((w) => <UserAvatar key={w.id} user={w} size={22} />)}
                  </span>
                )}
              </div>
            )}
          </div>

          <section className={`tcgb-zone is-me${view.active === me.seat && !view.over ? ' is-active' : ''}`}>
            <Plate p={me} side="me" activeMember={view.active === me.seat ? view.activeMember : null}>
              <HeroPower power={me.power} usable={myTurn && !busy && !!legal.power} casting={powerSel} onUse={usePower} foe={readOnly} />
              {me.partnerHand && !readOnly && (
                <details className="tcgb-partner">
                  <summary><Icon d={UI.users} size={14} />Mão do parceiro ({me.partnerHand.length})</summary>
                  <div className="tcgb-partner-cards">{me.partnerHand.map((c) => <CardView key={c.uid} card={c} size="xs" tilt={false} />)}</div>
                </details>
              )}
            </Plate>
            <div className={`tcgb-board is-me${myTurn && legal.playable.length ? ' is-drop' : ''}`}
              onDragOver={(e) => { if (myTurn) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); playCard(e.dataTransfer.getData('text/plain'), true); }}
            >
              {me.board.map((u) => <Unit key={u.uid} u={u} mine canAttack={myTurn && !spellSel && attackers.has(u.uid)} targetable={targets.has(u.uid)} selected={selected === u.uid} dying={dying.has(u.uid)} entering={entering.has(u.uid)} onClick={() => clickUnit(u, true)} onHover={setHover} />)}
              {!me.board.length && <span className="tcgb-empty">{myTurn ? 'Arraste ou clique numa carta da mão' : 'Campo'}</span>}
            </div>
          </section>
        </div>

        {/* Coluna da direita: pilhas */}
        <aside className="tcgb-pilecol">
          <Piles p={foe} side="foe" />
          <Piles p={me} side="me" />
        </aside>
      </div>

      {/* Mão: recolhida embaixo, abre ao passar o mouse (ou tocar) */}
      <div className={`tcgb-handdock${handOpen || spellSel || handPick ? ' is-open' : ''}${readOnly ? ' is-readonly' : ''}`}
        onMouseEnter={() => setHandOpen(true)} onMouseLeave={() => setHandOpen(false)}
      >
        {!readOnly && (me.hand?.length || 0) > 0 && (
          <button type="button" className="tcgb-handtab" onClick={() => setHandOpen((v) => !v)} aria-expanded={handOpen}>
            <Icon d={handOpen ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} size={14} />
            {handOpen ? 'Recolher mão' : `Passe o mouse para ver a mão (${me.hand.length})`}
          </button>
        )}
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
          {readOnly && me.handCount > 0 && Array.from({ length: Math.min(me.handCount, 10) }, (_, i) => <CardBack key={i} small variant={me.cosmetics?.back} />)}
        </div>
      </div>

      {(selected || spellSel || powerSel) && (
        <p className="tcgb-hint">
          {powerSel ? `${me.power?.label}: escolha o alvo` : spellSel ? `${spellCard?.name}: escolha o alvo` : targets.has('hero') ? 'Escolha um alvo (unidade ou herói inimigo)' : 'Precisa atacar quem tem Guarda'} · Esc cancela
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
          <defs><marker id="tcgb-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 10 5 0 10z" fill={spellSel || powerSel ? '#a46bff' : '#ff4d6d'} /></marker></defs>
          <line x1={aim.x1} y1={aim.y1} x2={aim.x2} y2={aim.y2} stroke={spellSel || powerSel ? '#a46bff' : '#ff4d6d'} strokeWidth="3.5" strokeLinecap="round" markerEnd="url(#tcgb-arrow)" opacity=".9" />
          <g transform={`translate(${(aim.x1 + aim.x2) / 2} ${(aim.y1 + aim.y2) / 2})`}>
            <circle r="13" fill={spellSel || powerSel ? '#7b46e6' : '#d8344f'} stroke="#fff" strokeOpacity=".55" strokeWidth="2" />
            <path d={spellSel || powerSel ? 'M1 -7 -4 1h4l-1 6 5-8h-4z' : 'M-5 5 4 -4M1 -5h4v4M-6 1l5 5'} fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      )}
      {cine && (
        <div key={cine.key} className={`tcgb-cine el-${cine.el}${cine.legend ? ' is-legend' : ''}`} style={{ '--c': cine.color, '--elc': ELEMENTS[cine.el]?.color || cine.color }} aria-hidden="true">
          {cine.legend && <><span className="tcgb-cine-fx" /><span className="tcgb-cine-name" data-no-translate>{cine.name}</span></>}
        </div>
      )}
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

      {mode === 'play' && match.kind === 'TUTORIAL' && coach && (
        <TutorialCoach view={view} legal={legal} myTurn={myTurn} selected={selected} casting={spellSel || powerSel} onHide={() => setCoach(false)} />
      )}
      {mode === 'watch' && ticker.length > 0 && !view.over && (
        <ol className="tcgb-ticker" aria-live="polite">
          {ticker.map((l, i) => <li key={`${l.t}-${i}-${l.text}`}><em>T{l.t}</em> {l.text}</li>)}
        </ol>
      )}

      {view.over && mode === 'watch' && (
        <div className="tcgb-end">
          <div className="tcgb-end-box is-win">
            <span className="tcgb-end-icon"><Icon d={UI.trophy} size={44} /></span>
            <h2 data-no-translate>{view.winner === me.seat ? me.name : foe.name} venceu!</h2>
            <p>{view.endReason === 'surrender' ? 'O oponente desistiu.' : view.endReason === 'timeout' ? 'Tempo de turno esgotado.' : 'O herói inimigo caiu.'}</p>
            <div className="tcgb-end-actions">
              <button type="button" className="tcg-btn primary" onClick={() => onExit({ replay: match.id })}>Ver replay</button>
              <button type="button" className="tcg-btn" onClick={() => onExit()}>Voltar para a arena</button>
            </div>
          </div>
        </div>
      )}

      {view.over && mode === 'play' && (
        <div className="tcgb-end">
          <div className={`tcgb-end-box${won ? ' is-win' : ' is-loss'}`}>
            <span className="tcgb-end-icon"><Icon d={won ? UI.trophy : UI.flag} size={44} /></span>
            <h2>{won ? 'Vitória!' : 'Derrota'}</h2>
            <p>{view.endReason === 'surrender' ? (won ? 'O oponente desistiu.' : 'Você desistiu.') : view.endReason === 'timeout' ? 'Tempo de turno esgotado.' : won ? 'Você derrotou o herói inimigo.' : 'Seu herói caiu.'}</p>
            <p className="tcgb-reward"><Icon d={UI.coin} size={20} />{match.custom ? 'Partida personalizada — sem recompensas' : match.reward > 0 ? `+${match.reward} moedas` : 'Sem recompensa nesta partida'}</p>
            {match.result?.campaign && <p className="tcg-ok">Fase concluída: {match.result.campaign.stage}! Próxima fase liberada.</p>}
            {match.result?.brawl && <p className="tcg-ok">Briga da semana vencida! +{match.result.brawl.coins} moedas e +{match.result.brawl.gems} gemas.</p>}
            {match.result?.draft && (
              <p className={match.result.draft.over ? 'tcg-ok' : 'tcg-dim'}>
                Draft: <b>{match.result.draft.wins}V · {match.result.draft.losses}D</b>
                {match.result.draft.over ? ` — corrida encerrada! +${match.result.draft.reward} moedas.` : ' — continue para a próxima partida.'}
              </p>
            )}
            {match.result?.boss && (
              <p className="tcg-ok">
                Você causou <b>{match.result.boss.damage}</b> de dano em {match.result.boss.name}!
                {match.result.boss.defeated ? ' O chefão foi derrotado — resgate o prêmio em Desafios 🎉' : ` Comunidade: ${match.result.boss.total}/${match.result.boss.hp}.`}
              </p>
            )}
            {match.result?.tutorial && <p className="tcg-ok">Tutorial concluído! +{match.result.tutorial.coins} moedas. Agora você já sabe jogar 🎉</p>}
            {match.result?.progress?.[myId]?.daily && <p className="tcg-ok">🔥 Sequência de {match.result.progress[myId].daily.days} dia(s): +{match.result.progress[myId].daily.coins} moedas</p>}
            {match.result?.progress?.[myId]?.chest?.ready > 0 && <p className="tcg-ok">🎁 Baú de vitórias liberado! Abra no início da Arena.</p>}
            {endNote && <p className="tcg-dim">{endNote}</p>}
            {match.reward === 0 && !match.custom && <small>Partidas muito curtas, desistências no começo, partidas com bots no 2 vs 2 ou acima do limite diário não dão moedas.</small>}
            <div className="tcgb-end-actions">
              {match.mode === 'PVE' && !match.result?.campaign && !match.kind && !match.lobbyId && <button type="button" className="tcg-btn primary" onClick={() => onRematch?.(match.difficulty)}>Jogar de novo</button>}
              {(match.lobbyId || match.kind === 'BRAWL') && <button type="button" className="tcg-btn primary" onClick={playAgain}>Jogar de novo</button>}
              {match.kind === 'DRAFT' && match.result?.draft && !match.result.draft.over && <button type="button" className="tcg-btn primary" onClick={playAgain}>Próxima partida do Draft</button>}
              {match.kind === 'BOSS' && match.result?.boss && !match.result.boss.defeated && <button type="button" className="tcg-btn primary" onClick={playAgain}>Atacar de novo</button>}
              {match.mode === 'PVP' && !match.lobbyId && !match.tournamentId && view.foe.userId && <button type="button" className="tcg-btn primary" onClick={playAgain}>Revanche</button>}
              <button type="button" className="tcg-btn" onClick={() => onExit({ replay: match.id })}>Ver replay</button>
              <button type="button" className="tcg-btn" onClick={() => onExit()}>Voltar para a arena</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
