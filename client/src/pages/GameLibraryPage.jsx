import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useLiveRefresh } from '../utils/liveRefresh';
import { getGameLibrary } from '../api/games';
import UserAvatar from '../components/UserAvatar.jsx';
import {
  GlIcon, GameRow, GameCapsule, LockedLibrary, EmptyLibrary, LibrarySkeleton,
  formatHoursShort, formatPlaytime, visibilityLabel, useInstalledModCounts,
} from '../components/games/GameLibraryParts.jsx';
import '../styles/game-library.css';

// Biblioteca de jogos estilo Steam: /jogos/biblioteca (a minha) e
// /jogos/biblioteca/:userId (de outra pessoa, respeitando a privacidade).
const TABS = [
  { id: 'recent', label: 'Recém-jogados', icon: 'history' },
  { id: 'all', label: 'Todos os jogos', icon: 'list' },
];
const SORTS = {
  playtime: { label: 'Tempo de jogo', fn: (a, b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name, 'pt-BR') },
  name: { label: 'A–Z', fn: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) },
  recent: { label: 'Mais recentes', fn: (a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt) },
};

export default function GameLibraryPage() {
  const { userId: paramId } = useParams();
  const navigate = useNavigate();
  const openSettings = useStore((s) => s.openSettings);
  const openProfile = useStore((s) => s.openProfile);
  const target = paramId || 'me';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('recent');
  const [sort, setSort] = useState('playtime');
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    getGameLibrary(target)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setError(err?.response?.data?.error || 'Não foi possível carregar a biblioteca.'); });
    return () => { alive = false; };
  }, [target]);

  // Tempo de jogo e "jogando agora" atualizam sozinhos.
  useLiveRefresh(({ put }) => getGameLibrary(target).then(put(setData)), { enabled: !!data, interval: 30000, key: `games-library:${target}` });

  const games = useMemo(() => data?.games || [], [data]);
  // Mods ↔ biblioteca: só a minha biblioteca, só no app desktop.
  const modCounts = useInstalledModCounts(games, !!data?.isMe);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = tab === 'recent'
      ? [...games].sort(SORTS.recent.fn).filter((g) => Date.now() - new Date(g.lastPlayedAt) < 30 * 86400000 || g.playingNow)
      : [...games].sort(SORTS[sort].fn);
    return term ? base.filter((g) => g.name.toLowerCase().includes(term)) : base;
  }, [games, tab, sort, q]);

  const user = data?.user;
  const isMe = !!data?.isMe;
  const title = isMe || !paramId ? 'Minha biblioteca' : `Biblioteca de ${user?.displayName || '...'}`;
  const nowPlaying = data?.nowPlaying;
  const recentCount = games.filter((g) => Date.now() - new Date(g.lastPlayedAt) < 30 * 86400000 || g.playingNow).length;

  return (
    <div className="gl-page">
      <div className="gl-inner">
        <button type="button" className="gl-back" onClick={() => navigate('/jogos')}>
          <GlIcon name="back" size={16} /> Apps
        </button>

        <header className="gl-hero">
          <div className="gl-head-top">
            {user && !isMe ? (
              <button type="button" className="gl-head-avatar" onClick={() => openProfile(user.id)} title="Abrir perfil">
                <UserAvatar user={user} size={52} />
              </button>
            ) : (
              <span className="gl-head-icon"><GlIcon name="gamepad" size={26} /></span>
            )}
            <div className="gl-head-text">
              <h1>{title}</h1>
              <p>Tempo de jogo registrado pelo app de desktop, igual à biblioteca da Steam.</p>
            </div>
          </div>
          {data?.visible && (
            <div className="gl-head-stats">
              <div className="gl-stat"><b>{data.totals?.games ?? 0}</b><span>{data.totals?.games === 1 ? 'jogo' : 'jogos'}</span></div>
              <div className="gl-stat"><b>{formatHoursShort(data.totals?.seconds)}</b><span>no total</span></div>
              {isMe && (
                <button type="button" className="gl-stat gl-stat-btn" onClick={openSettings} title="Mudar em Configurações → Privacidade">
                  <b><GlIcon name="eye" size={15} /> {visibilityLabel(data.visibility)}</b><span>pode ver</span>
                </button>
              )}
            </div>
          )}
        </header>

        {error && <div className="gl-empty"><h3>Ops</h3><p>{error}</p></div>}
        {!error && !data && <LibrarySkeleton rows={5} />}
        {data && !data.visible && <LockedLibrary name={user?.displayName} visibility={data.visibility} />}

        {data?.visible && nowPlaying && (
          <div className="gl-now">
            <GameCapsule game={nowPlaying} size="lg" />
            <div className="gl-now-text">
              <span className="gl-now-label"><span className="gl-dot" /> Jogando agora</span>
              <strong>{nowPlaying.name}</strong>
              <span className="gl-now-meta">{formatPlaytime(nowPlaying.totalSeconds)} no total</span>
            </div>
          </div>
        )}

        {data?.visible && games.length === 0 && <EmptyLibrary isMe={isMe} name={user?.displayName} />}

        {data?.visible && games.length > 0 && (
          <>
            <div className="gl-toolbar">
              <div className="gl-tabs" role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`gl-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                    <GlIcon name={t.icon} size={15} /> {t.label}
                    <span className="gl-tab-count">{t.id === 'all' ? games.length : recentCount}</span>
                  </button>
                ))}
              </div>
              <div className="gl-tools">
                <label className="gl-search">
                  <GlIcon name="search" size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar jogo" aria-label="Buscar jogo" />
                </label>
                {tab === 'all' && (
                  <label className="gl-sort">
                    <span>Ordenar</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar por">
                      {Object.entries(SORTS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>

            {shown.length === 0 ? (
              <div className="gl-empty">
                <span className="gl-empty-icon"><GlIcon name={q ? 'search' : 'history'} size={22} /></span>
                <h3>{q ? 'Nenhum jogo encontrado' : 'Nada jogado nos últimos 30 dias'}</h3>
                <p>{q ? 'Tente outro nome.' : 'Veja todos os jogos na outra aba.'}</p>
              </div>
            ) : (
              <div className="gl-list">
                {shown.map((g) => (
                  <GameRow
                    key={g.gameKey}
                    game={g}
                    modCount={modCounts[g.steamAppId]}
                    onOpenMods={g.steamAppId && modCounts[g.steamAppId] !== undefined ? () => navigate(`/jogos/mods?game=${g.steamAppId}`) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
