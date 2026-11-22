import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { getDiceRoll } from '../../api/endpoints';
import '../../styles/dice.css';

// Rolagem de dados (Atividades). O sorteio é no servidor; aqui só desenha.
// Cada tipo de dado tem o seu formato (D4 triângulo, D6 quadrado, D8
// losango, D10 pipa, D12 pentágono, D20 hexágono com a face triangular,
// D100 = pipa com "%"; os outros, círculo). Ao chegar, os dados giram e os
// números embaralham por ~1 s antes de parar no resultado.

export const DICE_TYPES = [2, 4, 6, 8, 10, 12, 20, 100];
export const ROLL_MS = 1000;
const MAX_SHOWN = 12;

function poly(n, r = 44, rot = -90, cx = 50, cy = 50) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// Contorno + linhas internas de cada tipo (viewBox 0 0 100 100).
function shapeOf(sides) {
  switch (sides) {
    case 4: return { outline: '50,8 94,86 6,86', lines: ['50,8 50,62', '50,62 94,86', '50,62 6,86'], ty: 66 };
    case 6: return { outline: '14,14 86,14 86,86 14,86', lines: [], rx: 14 };
    case 8: return { outline: '50,4 92,50 50,96 8,50', lines: ['8,50 92,50', '50,4 30,50', '50,4 70,50'], ty: 64 };
    case 10:
    case 100: return { outline: '50,4 92,40 50,96 8,40', lines: ['8,40 50,58 92,40', '50,58 50,96'], ty: 48 };
    case 12: return { outline: poly(5, 46), lines: [poly(5, 25)].map((p) => `${p} ${p.split(' ')[0]}`), ty: 56 };
    case 20: return { outline: poly(6, 46, -90), lines: ['50,4 22,66 78,66 50,4', '22,66 10,73', '78,66 90,73', '22,66 50,96 78,66'], ty: 54 };
    default: return { circle: true, ty: 56 };
  }
}

export function DieFace({ sides, value, rolling = false, delay = 0, size = 64, tone = '' }) {
  const s = shapeOf(sides);
  const [shown, setShown] = useState(rolling ? Math.ceil(Math.random() * sides) : value);
  useEffect(() => {
    if (!rolling) { setShown(value); return undefined; }
    const t = setInterval(() => setShown(Math.ceil(Math.random() * sides)), 70);
    const stop = setTimeout(() => { clearInterval(t); setShown(value); }, ROLL_MS - 120 + delay);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [rolling, value, sides, delay]);
  const label = sides === 100 ? `${shown}` : String(shown);
  const fs = label.length >= 3 ? 24 : label.length === 2 ? 30 : 36;
  return (
    <span
      className={`die${rolling ? ' is-rolling' : ''}${tone ? ` is-${tone}` : ''}`}
      style={{ width: size, height: size, animationDelay: `${delay}ms` }}
      role="img" aria-label={`D${sides}: ${value}`}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        {s.circle ? <circle className="die-body" cx="50" cy="50" r="44" /> : s.rx ? <rect className="die-body" x="10" y="10" width="80" height="80" rx={s.rx} /> : <polygon className="die-body" points={s.outline} />}
        {(s.lines || []).map((l) => <polyline key={l} className="die-edge" points={l} />)}
        <text className="die-num" x="50" y={s.ty || 50} fontSize={fs} textAnchor="middle" dominantBaseline="middle">{label}</text>
        {sides === 100 && <text className="die-tag" x="50" y="82" fontSize="13" textAnchor="middle">%</text>}
        {![4, 6, 8, 10, 12, 20, 100].includes(sides) && <text className="die-tag" x="50" y="24" fontSize="13" textAnchor="middle">D{sides}</text>}
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
  return null;
}

/** O resultado desenhado: dados, conta por tipo e total. */
export function DiceRollView({ roll, animate = false, compact = false }) {
  const [rolling, setRolling] = useState(animate);
  useEffect(() => {
    if (!animate) return undefined;
    setRolling(true);
    const t = setTimeout(() => setRolling(false), ROLL_MS + 200);
    return () => clearTimeout(t);
  }, [animate, roll]);
  const dice = useMemo(() => roll.groups.flatMap((g) => g.results.map((v) => ({ v, sides: g.sides }))), [roll]);
  const shown = dice.slice(0, MAX_SHOWN);
  const v = verdict(roll);
  const size = compact ? 48 : (dice.length > 6 ? 52 : 70);
  return (
    <div className={`dice-view${rolling ? ' is-rolling' : ''}${compact ? ' is-compact' : ''}`}>
      <div className="dice-row">
        {shown.map((d, i) => (
          <DieFace
            // eslint-disable-next-line react/no-array-index-key
            key={i} sides={d.sides} value={d.v} rolling={rolling} delay={i * 60} size={size}
            tone={d.v === d.sides ? 'max' : (d.v === 1 ? 'min' : '')}
          />
        ))}
        {dice.length > MAX_SHOWN && <span className="dice-more">+{dice.length - MAX_SHOWN}</span>}
      </div>
      <div className={`dice-result${rolling ? ' is-hidden' : ''}`} aria-live="polite">
        <div className="dice-groups">
          {roll.groups.map((g) => (
            <span key={g.sides} className="dice-group">
              <b>{g.count}d{g.sides}</b>
              <span>{g.results.join(', ')}</span>
            </span>
          ))}
          {roll.modifier ? <span className="dice-group"><b>{roll.modifier > 0 ? 'Bônus' : 'Redutor'}</b><span>{roll.modifier > 0 ? '+' : '−'}{Math.abs(roll.modifier)}</span></span> : null}
        </div>
        <div className="dice-total">
          <small>Total</small>
          <strong>{rolling ? '…' : roll.total}</strong>
        </div>
        {v && !rolling && <div className={`dice-verdict is-${v.tone}`}>{v.text}</div>}
      </div>
    </div>
  );
}

function DiceHeader({ user, roll }) {
  const name = user?.displayName || user?.username || 'Alguém';
  return (
    <div className="dice-head">
      {user && <UserAvatar user={user} size={28} />}
      <span className="dice-head-text">
        <strong>{name}</strong>
        <small>rolou {roll.notation}{roll.label ? ` · ${roll.label}` : ''}</small>
      </span>
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

// Escolher os dados: tipo (D2…D100 ou qualquer número de 2 a 100),
// quantidade, bônus e um nome opcional ("Ataque").
export function DicePicker({ onRoll, onClose, where = 'chat' }) {
  const [counts, setCounts] = useState({ 20: 1 });
  const [custom, setCustom] = useState('');
  const [modifier, setModifier] = useState(0);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  const notation = Object.entries(counts).sort((a, b) => a[0] - b[0]).map(([s, c]) => `${c}d${s}`).join(' + ') + (modifier ? ` ${modifier > 0 ? '+' : '−'} ${Math.abs(modifier)}` : '');
  const submit = async (e) => {
    e?.preventDefault();
    if (!total || busy) return;
    if (total > 30) { setError('No máximo 30 dados por rolagem.'); return; }
    setBusy(true); setError('');
    try {
      await onRoll({ groups: Object.entries(counts).map(([sides, count]) => ({ sides: Number(sides), count })), modifier, label: label.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Não deu pra rolar os dados.');
    } finally { setBusy(false); }
  };

  return (
    <div className="dice-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dice-picker" role="dialog" aria-label="Rolar dados" onSubmit={submit}>
        <div className="dice-picker-head">
          <strong>Rolar dados</strong>
          <small>{where === 'call' ? 'Todo mundo da chamada vê o resultado' : 'O resultado vai pro chat'}</small>
          <button type="button" className="dice-x" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="dice-grid">
          {types.map((sides) => {
            const n = counts[sides] || 0;
            return (
              <div key={sides} className={`dice-type${n ? ' is-on' : ''}`}>
                <button type="button" className="dice-type-face" onClick={() => set(sides, n + 1)} aria-label={`Adicionar um D${sides}`}>
                  <DieFace sides={sides} value={sides} size={46} />
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
              <input type="number" min="2" max="100" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="2–100" aria-label="Número de lados do dado personalizado" />
              <button type="button" className="btn-secondary" onClick={addCustom} disabled={!custom}>Adicionar</button>
            </span>
          </label>
          <label>
            <span>Bônus</span>
            <input type="number" min="-999" max="999" value={modifier} onChange={(e) => setModifier(Math.max(-999, Math.min(999, Number(e.target.value) || 0)))} aria-label="Bônus somado ao total" />
          </label>
          <label className="dice-label-field">
            <span>Nome (opcional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} placeholder="Ex.: Ataque, Iniciativa" aria-label="Nome da rolagem" />
          </label>
        </div>
        {error && <p className="dice-error" role="alert">{error}</p>}
        <div className="dice-picker-foot">
          <span className="dice-notation">{total ? notation : 'Escolha os dados'}</span>
          <button type="button" className="btn-secondary" onClick={() => { setCounts({}); setModifier(0); }}>Limpar</button>
          <button type="submit" className="btn-primary" disabled={!total || busy}>{busy ? 'Rolando…' : 'Rolar'}</button>
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
