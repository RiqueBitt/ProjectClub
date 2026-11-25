import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../../context/SocketContext.jsx';
import { CoinIcon, GemIcon } from '../CurrencyIcon.jsx';

// Baú da call: de vez em quando aparece um baú no canto da call; quem tocar
// primeiro leva moedas (às vezes gemas). O servidor sorteia e decide quem
// ganhou (services/callChest.js); aqui só mostra.

function ChestArt({ open = false }) {
  // Desenhado em código (sem imagem gerada por IA).
  return (
    <svg className="cc-art" viewBox="0 0 64 56" width="56" height="49" aria-hidden="true">
      <rect x="6" y="24" width="52" height="28" rx="4" fill="#8a5a2b" stroke="#3b2410" strokeWidth="2.5" />
      <rect x="6" y="36" width="52" height="4" fill="#6b4320" />
      <rect x="28" y="24" width="8" height="28" fill="#e8b93c" stroke="#3b2410" strokeWidth="2" />
      <g className="cc-lid" style={{ transform: open ? 'rotate(-28deg)' : 'none' }}>
        <path d="M6 24 Q6 8 32 8 Q58 8 58 24 Z" fill="#a46a33" stroke="#3b2410" strokeWidth="2.5" />
        <rect x="28" y="8.5" width="8" height="15.5" fill="#e8b93c" stroke="#3b2410" strokeWidth="2" />
      </g>
      <rect x="29" y="26" width="6" height="7" rx="1.5" fill="#fff1b8" stroke="#3b2410" strokeWidth="1.5" />
    </svg>
  );
}

export function useCallChest(channelId) {
  const { socket } = useSocket() || {};
  const [chest, setChest] = useState(null);
  const [result, setResult] = useState(null); // { user, coins, gems, mine }
  const [error, setError] = useState('');

  useEffect(() => {
    if (!socket || !channelId) { setChest(null); return undefined; }
    const onChest = (c) => { if (c?.channelId === channelId) { setChest(c); setResult(null); setError(''); } };
    const onGone = (c) => { if (c?.channelId === channelId) setChest((cur) => (cur?.id === c.id ? null : cur)); };
    const onClaimed = (c) => {
      if (c?.channelId !== channelId) return;
      setChest((cur) => (cur?.id === c.id ? null : cur));
      setResult({ user: c.user, coins: c.coins, gems: c.gems });
    };
    socket.on('voice:chest', onChest);
    socket.on('voice:chest-gone', onGone);
    socket.on('voice:chest-claimed', onClaimed);
    socket.emit('voice:chest-get', { channelId }, (r) => { if (r?.chest) setChest(r.chest); });
    return () => {
      socket.off('voice:chest', onChest);
      socket.off('voice:chest-gone', onGone);
      socket.off('voice:chest-claimed', onClaimed);
    };
  }, [socket, channelId]);

  useEffect(() => {
    if (!result) return undefined;
    const t = setTimeout(() => setResult(null), 4500);
    return () => clearTimeout(t);
  }, [result]);

  const claim = useCallback(() => {
    if (!socket || !chest) return;
    socket.emit('voice:chest-claim', { channelId, chestId: chest.id }, (r) => {
      if (!r?.ok) setError(r?.reason || 'Não deu pra abrir.');
    });
  }, [socket, channelId, chest]);

  return { chest, result, error, claim, dismissError: () => setError('') };
}

export function CallChest({ channelId, meId }) {
  const { chest, result, error, claim, dismissError } = useCallChest(channelId);
  const [left, setLeft] = useState(0);
  const btn = useRef(null);

  useEffect(() => {
    if (!chest) return undefined;
    const upd = () => setLeft(Math.max(0, Math.ceil((chest.expiresAt - Date.now()) / 1000)));
    upd();
    const t = setInterval(upd, 1000);
    return () => clearInterval(t);
  }, [chest]);

  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(dismissError, 3500);
    return () => clearTimeout(t);
  }, [error, dismissError]);

  if (chest) {
    return (
      <div className="cc-wrap" role="status">
        <button ref={btn} type="button" className="cc-chest" onClick={claim} aria-label={`Abrir o baú da call (some em ${left} segundos)`}>
          <ChestArt />
          <span className="cc-label">Baú da call!</span>
          <span className="cc-sub">Toque pra abrir · {left}s</span>
        </button>
        {error && <p className="cc-error">{error}</p>}
      </div>
    );
  }
  if (result) {
    const mine = result.user?.id === meId;
    const who = mine ? 'Você abriu' : `${result.user?.displayName || result.user?.username || 'Alguém'} abriu`;
    return (
      <div className={`cc-wrap cc-result${mine ? ' is-mine' : ''}`} role="status">
        <ChestArt open />
        <div>
          <strong>{who} o baú</strong>
          <span className="cc-loot">
            <CoinIcon size={14} /> +{result.coins}
            {result.gems > 0 && <><GemIcon size={14} /> +{result.gems}</>}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

// ---------- Gorjeta na call (services/callTips.js) ----------
export const TIP_AMOUNTS = [10, 25, 50];

/** Manda uma gorjeta; devolve { ok, reason?, coins? }. */
export function sendCallTip(socket, { channelId, toUserId, amount }) {
  return new Promise((resolve) => {
    if (!socket) { resolve({ ok: false, reason: 'Sem conexão.' }); return; }
    const t = setTimeout(() => resolve({ ok: false, reason: 'O servidor não respondeu.' }), 8000);
    socket.emit('voice:tip', { channelId, toUserId, amount }, (r) => { clearTimeout(t); resolve(r || { ok: false }); });
  });
}

const nameOf = (u) => u?.displayName || u?.username || 'Alguém';

/** Avisos de gorjeta na call ("Ana deu 25 moedas pra Bia") + erro de quem mandou. */
export function CallTips({ channelId, meId, notice, onNoticeDone }) {
  const { socket } = useSocket() || {};
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const on = (t) => {
      if (t?.channelId !== channelId) return;
      const id = `${t.at}-${t.from?.id}`;
      setList((l) => [...l.slice(-2), { ...t, id }]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 4000);
    };
    socket.on('voice:tip', on);
    return () => socket.off('voice:tip', on);
  }, [socket, channelId]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(onNoticeDone, 3500);
    return () => clearTimeout(t);
  }, [notice, onNoticeDone]);
  if (!list.length && !notice) return null;
  return (
    <div className="cc-wrap cc-tips" role="status">
      {list.map((t) => (
        <div key={t.id} className={`cc-result cc-tip${t.to?.id === meId ? ' is-mine' : ''}`}>
          <CoinIcon size={18} />
          <div>
            <strong>{t.from?.id === meId ? 'Você' : nameOf(t.from)} deu {t.amount} moedas</strong>
            <span className="cc-tip-to">pra {t.to?.id === meId ? 'você' : nameOf(t.to)}</span>
          </div>
        </div>
      ))}
      {notice && <p className="cc-error">{notice}</p>}
    </div>
  );
}
