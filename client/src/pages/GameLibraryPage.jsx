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
import '../styles/contentx.css';

// Gráfico simples de barras: horas por semana (últimas 8 semanas). Quando
// ainda não existe registro por dia (dados novos começam a contar a
// partir desta versão), mostra quantos jogos foram abertos pela última
// vez em cada semana — e avisa que NÃO é tempo de jogo.
function WeeklyChart({ weekly }) {
  if (!weekly?.weeks?.length) return null;
  const byDays = weekly.source === 'days';
  const values = weekly.weeks.map((w) => (byDays ? w.seconds / 3600 : w.games));
  const max = Math.max(...values, byDays ? 1 : 1);
  const total = values.reduce((a, b) => a + b, 0);
  const label = (w) => new Date(`${w.start}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const valueText = (v) => (byDays ? (v >= 10 ? `${Math.round(v)}h` : `${v.toFixed(1).replace('.', ',')}h`) : String(v));
  return (
    <section className="cxl-chart" aria-label={byDays ? 'Horas jogadas por semana' : 'Jogos abertos por semana'}>
      <header>
        <h2><GlIcon name="clock" size={16} /> {byDays ? 'Horas por semana' : 'Atividade por semana'}</h2>
        <span className="cxl-chart-sub">{byDays ? `${valueText(total)} nas últimas 8 semanas` : 'Últimas 8 semanas'}</span>
      </header>
      <div className="cxl-bars">
        {weekly.weeks.map((w, i) => {
          const v = values[i];
          const pct = max > 0 ? Math.max(v > 0 ? 4 : 0, Math.round((v / max) * 100)) : 0;
          return (
            <div key={w.start} className={`cxl-bar-col${i === weekly.weeks.length - 1 ? ' current' : ''}`} title={`Semana de ${label(w)}: ${valueText(v)}${byDays ? '' : (v === 1 ? ' jogo' : ' jogos')}`}>
              <span className="cxl-bar-val">{v > 0 ? valueText(v) : ''}</span>
              <span className="cxl-bar-track"><span className="cxl-bar-fill" style={{ height: `${pct}%` }} /></span>
              <span className="cxl-bar-label">{i === weekly.weeks.length - 1 ? 'Esta' : label(w)}</span>
            </div>
          );
        })}
      </div>
      {!byDays && (
        <p className="cxl-chart-note">
          Ainda não temos o tempo jogado por dia: ele começa a ser contado a partir de agora. Por enquanto as barras mostram quantos jogos foram abertos pela última vez em cada semana, não horas.
        </p>
      )}
    </section>
  );
}

// "Jogos em comum" na biblioteca de outra pessoa: os dois tempos lado a lado.
function CommonGames({ list, name }) {
  if (!Array.isArray(list)) return null;
  return (
    <section className="cxl-common" aria-label="Jogos em comum">
      <header>
        <h2><GlIcon name="gamepad" size={16} /> Jogos em comum</h2>
        <span className="cxl-chart-sub">{list.length === 0 ? 'Nenhum ainda' : list.length === 1 ? '1 jogo' : `${list.length} jogos`}</span>
      </header>
      {list.length === 0 ? (
        <p className="cxl-chart-note">Vocês ainda não jogaram nenhum jogo igual (pelo tempo registrado no app de desktop).</p>
      ) : (
        <ul className="cxl-common-list">
          {list.map((g) => {
            const sum = Math.max(1, g.mySeconds + g.theirSeconds);
            return (
              <li key={g.gameKey}>
                <GameCapsule game={g} size="sm" />
                <div className="cxl-common-main">
                  <strong className="truncate">{g.name}</strong>
                  <span className="cxl-common-split" aria-hidden="true">
                    <span className="me" style={{ width: `${(g.mySeconds / sum) * 100}%` }} />
                    <span className="them" style={{ width: `${(g.theirSeconds / sum) * 100}%` }} />
                  </span>
                  <span className="cxl-common-times">
                    <span><i className="me" /> Você: {formatHoursShort(g.mySeconds)}</span>
                    <span><i className="them" /> {name || 'Amigo'}: {formatHoursShort(g.theirSeconds)}</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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
          <div className={`cxl-insights${!isMe && Array.isArray(data.common) ? ' two' : ''}`}>
            <WeeklyChart weekly={data.weekly} />
            {!isMe && <CommonGames list={data.common} name={user?.displayName} />}
          </div>
        )}

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
