import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { getDiceRoll } from '../../api/endpoints';
import '../../styles/dice.css';

// Rolagem de dados (Atividades). O sorteio é no servidor; aqui só desenha.
// Cada tipo de dado tem o seu formato, agora com FACETAS (cada lado com um
// tom, luz vindo do alto à esquerda): D4 pirâmide, D6 cubo, D8 octaedro,
// D10 pipa, D12 dodecaedro, D20 icosaedro, D100 pipa com "%"; os outros
// viram uma moeda. Ao chegar, os dados caem numa bandeja, giram e os
// números embaralham por ~1 s antes de parar no resultado.

export const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
export const ROLL_MS = 1000;
const MAX_SHOWN = 12;
const LAST_KEY = 'pc.dice.last';

function pt(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)];
}
const join = (pts) => pts.map((p) => p.join(',')).join(' ');

// Facetas de cada tipo (viewBox 0 0 100 100): [pontos, tom 0 = mais claro … 3 = mais escuro].
function shapeOf(sides) {
  switch (sides) {
    case 4: return { ty: 64, outline: '50,6 95,88 5,88', facets: [['50,6 50,62 5,88', 1], ['50,6 95,88 50,62', 2], ['5,88 50,62 95,88', 3]], face: '50,6 50,62 5,88' };
    case 6: return { ty: 52, cube: true };
    case 8: return { ty: 55, outline: '50,3 93,50 50,97 7,50', facets: [['50,3 30,50 7,50', 1], ['50,3 70,50 30,50', 0], ['50,3 93,50 70,50', 2], ['7,50 30,50 50,97', 2], ['30,50 70,50 50,97', 1], ['70,50 93,50 50,97', 3]] };
    case 10:
    case 100: return { ty: 42, outline: '50,3 93,40 50,97 7,40', facets: [['50,3 93,40 50,60 7,40', 0], ['7,40 50,60 50,97', 2], ['93,40 50,60 50,97', 3]] };
    case 12: {
      const out = Array.from({ length: 5 }, (_, i) => pt(50, 52, 47, -90 + 72 * i));
      const inn = Array.from({ length: 5 }, (_, i) => pt(50, 52, 25, -90 + 72 * i));
      const tones = [1, 2, 3, 3, 1];
      return { ty: 54, outline: join(out), facets: [...out.map((p, i) => [join([p, out[(i + 1) % 5], inn[(i + 1) % 5], inn[i]]), tones[i]]), [join(inn), 0]] };
    }
    case 20: return { ty: 52, outline: '50,3 91,27 91,73 50,97 9,73 9,27', facets: [['50,3 9,27 9,73 22,66', 1], ['50,3 91,27 91,73 78,66', 2], ['9,73 22,66 50,97', 2], ['22,66 78,66 50,97', 3], ['78,66 91,73 50,97', 3], ['50,3 22,66 78,66', 0]] };
    default: return { ty: 54, coin: true };
  }
}

export function DieFace({ sides, value, rolling = false, delay = 0, size = 64, tone = '' }) {
  const s = shapeOf(sides);
  const gid = useId().replace(/:/g, '');
  const [shown, setShown] = useState(rolling ? Math.ceil(Math.random() * sides) : value);
  useEffect(() => {
    if (!rolling) { setShown(value); return undefined; }
    const t = setInterval(() => setShown(Math.ceil(Math.random() * sides)), 70);
    const stop = setTimeout(() => { clearInterval(t); setShown(value); }, ROLL_MS - 120 + delay);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [rolling, value, sides, delay]);
  const label = String(shown);
  const fs = label.length >= 3 ? 23 : label.length === 2 ? 29 : 35;
  const gloss = `url(#${gid}-gloss)`;
  return (
    <span
      className={`die${rolling ? ' is-rolling' : ''}${tone ? ` is-${tone}` : ''}`}
      style={{ width: size, height: size, animationDelay: `${delay}ms` }}
      role="img" aria-label={`D${sides}: ${value}`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`${gid}-gloss`} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset=".45" stopColor="#fff" stopOpacity=".04" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {s.cube && (
          <g>
            <rect className="die-f3" x="9" y="9" width="82" height="82" rx="16" />
            <rect className="die-f0" x="17" y="15" width="66" height="66" rx="11" />
            <rect x="17" y="15" width="66" height="66" rx="11" fill={gloss} />
            <rect className="die-rim" x="9" y="9" width="82" height="82" rx="16" />
          </g>
        )}
        {s.coin && (
          <g>
            <circle className="die-f3" cx="50" cy="50" r="45" />
            <circle className="die-f0" cx="50" cy="48" r="35" />
            <circle cx="50" cy="48" r="35" fill={gloss} />
            <circle className="die-rim" cx="50" cy="50" r="45" />
            <circle className="die-edge" cx="50" cy="48" r="35" />
          </g>
        )}
        {s.facets && (
          <g>
            {s.facets.map(([pts, t]) => <polygon key={pts} className={`die-f${t}`} points={pts} />)}
            <polygon points={s.outline} fill={gloss} />
            {s.facets.map(([pts]) => <polygon key={`e${pts}`} className="die-edge" points={pts} />)}
            <polygon className="die-rim" points={s.outline} />
          </g>
        )}
        <text className="die-num" x="50" y={s.ty} fontSize={fs} textAnchor="middle" dominantBaseline="central">{label}</text>
        {sides === 100 && <text className="die-tag" x="50" y="79" fontSize="15" textAnchor="middle">%</text>}
        {!DICE_TYPES.includes(sides) && <text className="die-tag" x="50" y="25" fontSize="11" textAnchor="middle">D{sides}</text>}
      </svg>
    </span>
  );
}

function verdict(roll) {
  const dice = roll.groups.flatMap((g) => g.results.map((v) => ({ v, sides: g.sides })));
  if (dice.length === 1 && dice[0].sides === 20) {
    if (dice[0].v === 20) return { text: 'CRÍTICO!', tone: 'crit' };
    if (dice[0].v === 1) return { text: 'FALHA CRÍTICA', tone: 'fail' };
  }
  if (dice.length > 1 && dice.every((d) => d.v === d.sides)) return { text: 'TUDO NO MÁXIMO!', tone: 'crit' };
  if (dice.length > 1 && dice.every((d) => d.v === 1)) return { text: 'TUDO NO 1…', tone: 'fail' };
  return null;
}

// Total subindo de 0 até o valor (só quando a rolagem é nova).
function useCountUp(target, run) {
  const [n, setN] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) { setN(target); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650);
      setN(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return n;
}

const SPARKS = Array.from({ length: 10 }, (_, i) => i);

/** O resultado desenhado: bandeja com os dados, conta por tipo e total. */
export function DiceRollView({ roll, animate = false, compact = false }) {
  const [rolling, setRolling] = useState(animate);
  const [counted, setCounted] = useState(!animate);
  useEffect(() => {
    if (!animate) return undefined;
    setRolling(true); setCounted(false);
    const t = setTimeout(() => setRolling(false), ROLL_MS + 200);
    return () => clearTimeout(t);
  }, [animate, roll]);
  const dice = useMemo(() => roll.groups.flatMap((g) => g.results.map((v) => ({ v, sides: g.sides }))), [roll]);
  const shown = dice.slice(0, MAX_SHOWN);
  const v = verdict(roll);
  const size = compact ? 46 : (dice.length > 6 ? 52 : dice.length > 3 ? 62 : 76);
  const total = useCountUp(roll.total, animate && !rolling && !counted);
  useEffect(() => { if (animate && !rolling) { const t = setTimeout(() => setCounted(true), 700); return () => clearTimeout(t); } return undefined; }, [animate, rolling]);
  const parts = dice.length <= 8 ? [...dice.map((d) => String(d.v)), ...(roll.modifier ? [String(Math.abs(roll.modifier))] : [])] : null;
  const equation = parts ? parts.map((p, i) => (i === 0 ? p : `${(roll.modifier < 0 && i === parts.length - 1) ? '−' : '+'} ${p}`)).join(' ') : null;
  return (
    <div className={`dice-view${rolling ? ' is-rolling' : ''}${compact ? ' is-compact' : ''}${v && !rolling ? ` is-${v.tone}` : ''}`}>
      <div className="dice-tray">
        <div className="dice-row">
          {shown.map((d, i) => (
            <DieFace
              // eslint-disable-next-line react/no-array-index-key
              key={i} sides={d.sides} value={d.v} rolling={rolling} delay={i * 70} size={size}
              tone={d.v === d.sides ? 'max' : (d.v === 1 ? 'min' : '')}
            />
          ))}
          {dice.length > MAX_SHOWN && <span className="dice-more">+{dice.length - MAX_SHOWN}</span>}
        </div>
        {v && !rolling && v.tone === 'crit' && (
          <span className="dice-sparks" aria-hidden="true">{SPARKS.map((i) => <i key={i} style={{ '--i': i }} />)}</span>
        )}
      </div>
      <div className={`dice-result${rolling ? ' is-hidden' : ''}`} aria-live="polite">
        <div className="dice-groups">
          {roll.groups.map((g) => (
            <span key={g.sides} className="dice-group">
              <b>{g.count}d{g.sides}</b>
              <span>{g.results.join(' · ')}</span>
            </span>
          ))}
          {roll.modifier ? (
            <span className={`dice-group is-mod${roll.modifier < 0 ? ' is-neg' : ''}`}>
              <b>{roll.modifier > 0 ? 'Bônus' : 'Redutor'}</b>
              <span>{roll.modifier > 0 ? '+' : '−'}{Math.abs(roll.modifier)}</span>
            </span>
          ) : null}
        </div>
        <div className="dice-total">
          <span className="dice-total-ring" aria-hidden="true" />
          <small>Total</small>
          <strong>{rolling ? '…' : total}</strong>
        </div>
        {equation && !rolling && dice.length + (roll.modifier ? 1 : 0) > 1 && <div className="dice-equation">{equation} = <b>{roll.total}</b></div>}
        {v && !rolling && <div className={`dice-verdict is-${v.tone}`}>{v.text}</div>}
      </div>
    </div>
  );
}

function DiceHeader({ user, roll }) {
  const name = user?.displayName || user?.username || 'Alguém';
  return (
    <div className="dice-head">
      {user && <UserAvatar user={user} size={32} />}
      <span className="dice-head-text">
        <strong>{name}</strong>
        <small>rolou {roll.notation}</small>
      </span>
      {roll.label ? <span className="dice-chip" title={roll.label}>{roll.label}</span> : null}
    </div>
  );
}

// Cartão no chat (/atividade/dados/<id>). Anima só se a rolagem é nova
// (menos de 8 s) — rolar o histórico não fica girando dado.
const cache = new Map();
export function DiceChatCard({ id }) {
  const [data, setData] = useState(() => cache.get(id));
  useEffect(() => {
    if (cache.has(id)) { setData(cache.get(id)); return undefined; }
    let alive = true;
    getDiceRoll(id)
      .then((d) => { cache.set(id, d); if (alive) setData(d); })
      .catch(() => { cache.set(id, null); if (alive) setData(null); });
    return () => { alive = false; };
  }, [id]);
  const fresh = useRef(null);
  if (data === null) return <div className="dice-card is-missing">Rolagem de dados não encontrada.</div>;
  if (data === undefined) return <div className="dice-card is-loading" aria-hidden="true"><span className="ilc-skel" style={{ width: '100%', height: 150 }} /></div>;
  if (fresh.current === null) fresh.current = Date.now() - new Date(data.createdAt).getTime() < 8000;
  return (
    <div className="dice-card" role="group" aria-label={`Rolagem de dados: ${data.notation} = ${data.total}`}>
      <DiceHeader user={data.user} roll={data} />
      <DiceRollView roll={data} animate={fresh.current} />
    </div>
  );
}

// Popup da call: aparece pra todo mundo e some depois de 2 s (depois da
// animação). Vários seguidos entram na fila.
export function CallDicePopup({ event, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, ROLL_MS + 2000);
    return () => clearTimeout(t);
  }, [event, onDone]);
  return (
    <div className="dice-popup" role="status">
      <div className="dice-card is-popup">
        <DiceHeader user={event.user} roll={event} />
        <DiceRollView roll={event} animate compact={event.groups.reduce((n, g) => n + g.count, 0) > 6} />
      </div>
    </div>
  );
}

// Atalhos comuns de RPG/jogo de mesa.
const PRESETS = [
  { name: '1d20', counts: { 20: 1 } },
  { name: '2d20', hint: 'vantagem', counts: { 20: 2 } },
  { name: '2d6', counts: { 6: 2 } },
  { name: '3d6', counts: { 6: 3 } },
  { name: '4d6', hint: 'atributo', counts: { 6: 4 } },
  { name: '1d100', hint: 'porcentagem', counts: { 100: 1 } },
];

function readLast() {
  try { const v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); return v && v.counts && Object.keys(v.counts).length ? v : null; } catch { return null; }
}
function notationOf(counts, modifier) {
  return Object.entries(counts).sort((a, b) => a[0] - b[0]).map(([s, c]) => `${c}d${s}`).join(' + ') + (modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : '');
}

// Escolher os dados: tipo (D2…D100 ou qualquer número de 2 a 100),
// quantidade, bônus e um nome opcional ("Ataque").
export function DicePicker({ onRoll, onClose, where = 'chat' }) {
  const [counts, setCounts] = useState({ 20: 1 });
  const [custom, setCustom] = useState('');
  const [modifier, setModifier] = useState(0);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last] = useState(readLast);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const types = [...new Set([...DICE_TYPES, ...Object.keys(counts).map(Number)])].sort((a, b) => a - b);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const set = (sides, n) => setCounts((c) => {
    const next = { ...c };
    const v = Math.max(0, Math.min(20, n));
    if (v) next[sides] = v; else delete next[sides];
    return next;
  });
  const addCustom = () => {
    const n = Number(custom);
    if (!Number.isInteger(n) || n < 2 || n > 100) { setError('Dado personalizado: de 2 a 100 lados.'); return; }
    set(n, (counts[n] || 0) + 1); setCustom(''); setError('');
  };
  const bump = (d) => setModifier((m) => Math.max(-999, Math.min(999, m + d)));
  const notation = notationOf(counts, modifier);
  const hand = Object.entries(counts).sort((a, b) => a[0] - b[0]).flatMap(([s, c]) => Array.from({ length: c }, () => Number(s)));
  const submit = async (e) => {
    e?.preventDefault();
    if (!total || busy) return;
    if (total > 30) { setError('No máximo 30 dados por rolagem.'); return; }
    setBusy(true); setError('');
    try {
      await onRoll({ groups: Object.entries(counts).map(([sides, count]) => ({ sides: Number(sides), count })), modifier, label: label.trim() || undefined });
      try { localStorage.setItem(LAST_KEY, JSON.stringify({ counts, modifier, label: label.trim() })); } catch { /* sem storage */ }
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Não deu pra rolar os dados.');
    } finally { setBusy(false); }
  };
  const isPreset = (p) => !modifier && notationOf(p.counts, 0) === notationOf(counts, 0);

  return (
    <div className="dice-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dice-picker" role="dialog" aria-label="Rolar dados" onSubmit={submit}>
        <div className="dice-picker-head">
          <span className="dice-picker-icon" aria-hidden="true"><DieFace sides={20} value={20} size={34} /></span>
          <span className="dice-picker-title">
            <strong>Rolar dados</strong>
            <small>{where === 'call' ? 'Todo mundo da chamada vê o resultado' : 'O resultado vai pro chat'}</small>
          </span>
          <button type="button" className="dice-x" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <div className="dice-presets" role="group" aria-label="Rolagens rápidas">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className={`dice-preset${isPreset(p) ? ' is-on' : ''}`} onClick={() => { setCounts(p.counts); setModifier(0); setError(''); }}>
              <b>{p.name}</b>{p.hint && <small>{p.hint}</small>}
            </button>
          ))}
          {last && (
            <button type="button" className="dice-preset is-last" onClick={() => { setCounts(last.counts); setModifier(last.modifier || 0); setLabel(last.label || ''); setError(''); }} title="Repetir a última rolagem">
              <b>↻ {notationOf(last.counts, last.modifier || 0)}</b><small>{last.label || 'última'}</small>
            </button>
          )}
        </div>

        <div className="dice-grid">
          {types.map((sides) => {
            const n = counts[sides] || 0;
            return (
              <div key={sides} className={`dice-type${n ? ' is-on' : ''}`}>
                {n > 0 && <span className="dice-type-badge" aria-hidden="true">×{n}</span>}
                <button type="button" className="dice-type-face" onClick={() => set(sides, n + 1)} aria-label={`Adicionar um D${sides}`}>
                  <DieFace sides={sides} value={sides} size={48} />
                  <span>D{sides}</span>
                </button>
                <div className="dice-stepper">
                  <button type="button" onClick={() => set(sides, n - 1)} disabled={!n} aria-label={`Tirar um D${sides}`}>−</button>
                  <output aria-label={`Quantidade de D${sides}`}>{n}</output>
                  <button type="button" onClick={() => set(sides, n + 1)} disabled={n >= 20} aria-label={`Adicionar um D${sides}`}>+</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="dice-extra">
          <label>
            <span>Outro dado</span>
            <span className="dice-inline">
              <b>D</b>
              <input type="number" min="2" max="100" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} placeholder="2–100" aria-label="Número de lados do dado personalizado" />
              <button type="button" className="dice-ghost" onClick={addCustom} disabled={!custom}>Adicionar</button>
            </span>
          </label>
          <div className="dice-mod">
            <span>Bônus</span>
            <span className="dice-mod-ctl">
              <button type="button" onClick={() => bump(-1)} aria-label="Diminuir o bônus">−</button>
              <input type="number" min="-999" max="999" value={modifier} onChange={(e) => setModifier(Math.max(-999, Math.min(999, Number(e.target.value) || 0)))} aria-label="Bônus somado ao total" />
              <button type="button" onClick={() => bump(1)} aria-label="Aumentar o bônus">+</button>
            </span>
          </div>
          <label className="dice-label-field">
            <span>Nome (opcional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="Ex.: Ataque, Iniciativa" aria-label="Nome da rolagem" />
          </label>
        </div>

        <div className={`dice-hand${hand.length ? '' : ' is-empty'}`} aria-label="Dados escolhidos">
          {hand.length ? (
            <>
              {hand.slice(0, 16).map((sides, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <button key={`${sides}-${i}`} type="button" className="dice-hand-die" onClick={() => set(sides, (counts[sides] || 0) - 1)} title={`Tirar um D${sides}`} aria-label={`Tirar um D${sides} da mão`}>
                  <DieFace sides={sides} value={sides} size={30} />
                </button>
              ))}
              {hand.length > 16 && <span className="dice-more">+{hand.length - 16}</span>}
            </>
          ) : <span>Toque num dado acima ou escolha uma rolagem rápida</span>}
        </div>

        {error && <p className="dice-error" role="alert">{error}</p>}
        <div className="dice-picker-foot">
          <span className="dice-notation">{total ? notation : 'Escolha os dados'}</span>
          <button type="button" className="dice-ghost" onClick={() => { setCounts({}); setModifier(0); setError(''); }} disabled={!total && !modifier}>Limpar</button>
          <button type="submit" className="dice-roll-btn" disabled={!total || busy}>
            <span className={`dice-roll-ico${busy ? ' is-spin' : ''}`} aria-hidden="true"><DieFace sides={6} value={6} size={20} /></span>
            {busy ? 'Rolando…' : 'Rolar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Dados na call: rola pelo socket (o servidor sorteia e manda pra todo mundo
// da sala) e mostra os popups em fila, um de cada vez.
export function useCallDice(channelId) {
  const { socket } = useSocket() || {};
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const on = (ev) => { if (ev?.channelId === channelId) setQueue((q) => [...q.slice(-4), ev]); };
    socket.on('dice:rolled', on);
    return () => socket.off('dice:rolled', on);
  }, [socket, channelId]);
  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  const roll = useCallback((payload) => new Promise((resolve, reject) => {
    if (!socket || !channelId) { reject(new Error('Entre na chamada pra rolar os dados nela.')); return; }
    const t = setTimeout(() => reject(new Error('O servidor não respondeu. Tente de novo.')), 8000);
    socket.emit('dice:roll', { ...payload, channelId }, (res) => {
      clearTimeout(t);
      if (res?.error) reject(new Error(res.error)); else resolve(res);
    });
  }), [socket, channelId]);
  return { current: queue[0] || null, done, roll };
}
