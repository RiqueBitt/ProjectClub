import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { steamCoverCandidates } from '../../utils/activityArt';
import { searchGames } from '../../api/gameHub';
import { getGameLibrary } from '../../api/games';

// Peças do Game Hub usadas em várias abas: ícones, capa do jogo, escolha de
// jogo, formatos (preço, horas, horário) e um carregador simples.

const PATHS = {
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  film: 'M4 4h16v16H4zM4 9h16M4 15h16M9 4v5M15 4v5M9 15v5M15 15v5',
  hammer: 'M14 6l4 4M3 21l9-9M12 4l8 8-3 3-8-8z',
  puzzle: 'M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 2.5 15.5-3.5 1z',
  gamepad: 'M6 9h12a4 4 0 0 1 3.9 4.9l-.9 3.6a2 2 0 0 1-3.4.9L15 16H9l-2.6 2.4a2 2 0 0 1-3.4-.9l-.9-3.6A4 4 0 0 1 6 9zM8 11v3M6.5 12.5h3M15 12h.01M17 13.5h.01',
  flame: 'M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-6 5-6 9-1-1-2-2-2-4-2 2-1 5-1 7 0 4 3 7 7 7z',
  gift: 'M3 9h18v4H3zM5 13h14v8H5zM12 9v12M12 9C10 5 6 5 7 8c.5 1.3 3 1 5 1zM12 9c2-4 6-4 5-1-.5 1.3-3 1-5 1z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  send: 'M4 12l16-8-6 16-2-7-8-1z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  folder: 'M3 6h6l2 2h10v11H3z',
  play: 'M8 5v14l11-7L8 5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  close: 'M6 6l12 12M18 6 6 18',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z',
  check: 'm5 12 5 5L20 7',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01',
};

export function Ico({ name, size = 18, className = '' }) {
  return (
    <svg className={`gh-ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.gamepad} />
    </svg>
  );
}

// Capa do jogo: imagem dada, ou as da Steam (cada erro tenta a próxima), ou
// um controle com o nome.
export function GameCover({ appId, name, src = null, shape = 'wide', className = '' }) {
  const list = useMemo(() => [...(src ? [{ src }] : []), ...steamCoverCandidates(appId, shape === 'wide' ? 'wide' : 'cover')], [appId, src, shape]);
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [list]);
  if (!list[i]) {
    return <span className={`gh-cover-none ${className}`}><Ico name="gamepad" size={28} />{name && <b>{name}</b>}</span>;
  }
  return <img className={className} src={list[i].src} alt="" loading="lazy" decoding="async" onError={() => setI((n) => n + 1)} />;
}

export const errText = (err, fallback) => err?.response?.data?.error || fallback;

// Carrega algo e devolve { data, error, loading, reload, setData }.
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve().then(loader).then(
      (data) => { if (alive.current) setState({ data, error: null, loading: false }); return data; },
      (error) => { if (alive.current) setState((s) => ({ data: s.data, error, loading: false })); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
}

const MONEY = {};
export function fmtMoney(value, currency = 'BRL') {
  if (value == null) return '';
  if (value === 0) return 'Grátis';
  MONEY[currency] = MONEY[currency] || new Intl.NumberFormat('pt-BR', { style: 'currency', currency });
  return MONEY[currency].format(value);
}

export function fmtHours(sec) {
  const h = (sec || 0) / 3600;
  if (h >= 10) return `${Math.round(h).toLocaleString('pt-BR')} h`;
  if (h >= 1) return `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
  return `${Math.max(1, Math.round((sec || 0) / 60))} min`;
}

const TIME = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
export function whenLabel(startsAt, now = new Date()) {
  if (!startsAt) return 'Agora';
  const d = new Date(startsAt);
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d - day0) / 86400000);
  if (diffDays === 0) return `Hoje, ${TIME.format(d)}`;
  if (diffDays === 1) return `Amanhã, ${TIME.format(d)}`;
  return `${DAY.format(d)}, ${TIME.format(d)}`;
}

export function untilLabel(iso, now = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'acabando';
  const h = Math.floor(ms / 3600000);
  if (h >= 48) return `${Math.floor(h / 24)} dias`;
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}

export function agoLabel(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

// Escolher o jogo: seus jogos recentes primeiro; digitando, busca na loja da
// Steam; e sempre dá pra usar o nome digitado como está.
export function GamePicker({ value, onChange, autoFocus = false, label = 'JOGO' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getGameLibrary('me').then((d) => {
      if (!alive) return;
      const list = [...(d?.games || [])].sort((a, b) => new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0)).slice(0, 6);
      setRecent(list.map((g) => ({ name: g.name, steamAppId: g.steamAppId || null, gameKey: g.gameKey })));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return undefined; }
    setBusy(true);
    const t = setTimeout(() => {
      searchGames(term).then((g) => setResults(g.slice(0, 8))).catch(() => setResults([])).finally(() => setBusy(false));
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="gh-gamepicker">
        <span className="gh-field-label">{label}</span>
        <div className="gh-picked">
          <span className="gh-picked-art"><GameCover appId={value.steamAppId} name="" /></span>
          <strong className="truncate">{value.name}</strong>
          <button type="button" className="gh-link-btn" onClick={() => onChange(null)}>Trocar</button>
        </div>
      </div>
    );
  }
  const list = q.trim().length >= 2 ? results : recent;
  return (
    <div className="gh-gamepicker">
      <label className="gh-field-label" htmlFor="gh-game-q">{label}</label>
      <div className="gh-search">
        <Ico name="search" size={16} />
        <input
          id="gh-game-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar jogo…" autoFocus={autoFocus} autoComplete="off" maxLength={80}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (q.trim().length >= 2) onChange(results[0] ? { name: results[0].name, steamAppId: results[0].steamAppId ? Number(results[0].steamAppId) : null, gameKey: results[0].gameKey } : { name: q.trim(), steamAppId: null }); } }}
        />
      </div>
      {list.length > 0 && (
        <ul className="gh-game-results" role="listbox" aria-label={q.trim() ? 'Resultados' : 'Seus jogos recentes'}>
          {list.map((g) => (
            <li key={`${g.gameKey || g.name}-${g.steamAppId || ''}`}>
              <button type="button" role="option" aria-selected="false" onClick={() => onChange({ name: g.name, steamAppId: g.steamAppId ? Number(g.steamAppId) : null, gameKey: g.gameKey })}>
                <span className="gh-game-results-art"><GameCover appId={g.steamAppId} name="" /></span>
                <span className="truncate">{g.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !busy && (
        <button type="button" className="gh-link-btn" onClick={() => onChange({ name: q.trim(), steamAppId: null })}>Usar “{q.trim()}” mesmo</button>
      )}
      {!q.trim() && recent.length === 0 && <p className="gh-hint">Digite o nome do jogo.</p>}
    </div>
  );
}

export function EmptyState({ icon = 'gamepad', title, children, action }) {
  return (
    <div className="gh-empty">
      <span className="gh-empty-ico"><Ico name={icon} size={26} /></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
