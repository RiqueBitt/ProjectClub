import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import UserAvatar from '../../components/UserAvatar.jsx';
import { useStore } from '../../store/useStore';
import { likeBuild, listBuilds } from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, Ico, errText, useLoad } from './shared.jsx';
import { BUILD_GAMES, BuildPortrait, DARKTIDE_CLASSES, Icon, LOL_ROLES, gameMeta, useGameData, useIndex } from './buildsShared.jsx';

// Game Hub → Builds: lista com filtro por jogo, as mais curtidas primeiro.

const notice = (m) => useStore.getState().pushNotice(m);

// Ícones de prévia (itens principais) — LoL e Deadlock.
function BuildPreview({ build, index }) {
  const d = build.data || {};
  if (build.game === 'lol' && index) {
    const ids = [...(d.core || []), ...(d.situational || [])].slice(0, 6);
    return <span className="gh-bcard-items">{ids.map((id) => { const it = index.item.get(String(id)); return <Icon key={id} src={it?.img} name={it?.name || id} size={28} />; })}</span>;
  }
  if (build.game === 'deadlock' && index) {
    const ids = [...(d.late || []), ...(d.mid || [])].slice(0, 6);
    return <span className="gh-bcard-items">{ids.map((id) => { const it = index.item.get(Number(id)); return <Icon key={id} src={it?.img} name={it?.name || id} size={28} slot={it?.slot} />; })}</span>;
  }
  if (build.game === 'darktide') return <span className="gh-bcard-text truncate">{[d.melee, d.ranged].filter(Boolean).join(' · ') || 'Build de Darktide'}</span>;
  return <span className="gh-bcard-text truncate">{(d.items || []).slice(0, 4).join(' · ') || build.gameInfo?.name}</span>;
}

export function BuildCard({ build, onLike }) {
  const navigate = useNavigate();
  const { data } = useGameData(build.game);
  const index = useIndex(build.game, data);
  const meta = gameMeta(build.game);
  const sub = build.game === 'lol'
    ? [index?.champ.get(build.hero)?.name || build.hero, LOL_ROLES.find((r) => r.id === build.role)?.name].filter(Boolean).join(' · ')
    : build.game === 'deadlock' ? (index?.hero.get(Number(build.hero))?.name || 'Deadlock')
      : build.game === 'darktide' ? DARKTIDE_CLASSES.find((c) => c.id === build.hero)?.name
        : [build.gameInfo?.name, build.heroName].filter(Boolean).join(' · ');
  return (
    <article className={`gh-bcard g-${build.game}`}>
      <Link to={`/jogos/builds/${build.id}`} className="gh-bcard-main" onClick={(e) => { e.preventDefault(); navigate(`/jogos/builds/${build.id}`); }}>
        <BuildPortrait build={build} index={index} size={54} />
        <span className="gh-bcard-text-col">
          <span className="gh-bcard-game">{meta.short}</span>
          <strong className="gh-bcard-title truncate">{build.title}</strong>
          <small className="truncate">{sub}</small>
        </span>
      </Link>
      <div className="gh-bcard-foot">
        <BuildPreview build={build} index={index} />
        <span className="gh-bcard-by">
          {build.author && <UserAvatar user={build.author} size={20} />}
          {onLike && (
            <button type="button" className={`gh-like${build.liked ? ' on' : ''}`} aria-pressed={build.liked} aria-label={build.liked ? 'Descurtir' : 'Curtir'} onClick={() => onLike(build)}>
              <Ico name="heart" size={15} />{build.likesCount > 0 && <span>{build.likesCount}</span>}
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

export default function BuildsTab() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const game = BUILD_GAMES.some((g) => g.id === params.get('jogo')) ? params.get('jogo') : '';
  const [sort, setSort] = useState('top');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [mine, setMine] = useState(false);
  const { data, loading, error, reload, setData } = useLoad(
    () => listBuilds({ ...(game ? { game } : {}), sort, ...(term ? { q: term } : {}), ...(mine ? { mine: '1' } : {}) }),
    [game, sort, term, mine],
  );
  const builds = useMemo(() => data?.builds || [], [data]);
  const like = async (b) => {
    try {
      const r = await likeBuild(b.id);
      setData((d) => ({ ...d, builds: d.builds.map((x) => (x.id === b.id ? { ...x, liked: r.liked, likesCount: r.likesCount } : x)) }));
    } catch (err) { notice(errText(err, 'Não deu pra curtir agora.')); }
  };
  const more = async () => {
    const r = await listBuilds({ ...(game ? { game } : {}), sort, ...(term ? { q: term } : {}), ...(mine ? { mine: '1' } : {}), skip: builds.length });
    setData((d) => ({ builds: [...d.builds, ...r.builds], more: r.more }));
  };
  const setGame = (id) => { const p = new URLSearchParams(params); if (id) p.set('jogo', id); else p.delete('jogo'); setParams(p, { replace: true }); };

  return (
    <HubPage>
      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Builds</h1>
          <p className="gh-sub">Monte e compartilhe builds de LoL, Deadlock, Darktide e de qualquer outro jogo.</p>
        </div>
        <button type="button" className="gh-btn is-primary is-lg" onClick={() => navigate(`/jogos/builds/nova${game ? `?jogo=${game}` : ''}`)}><Ico name="plus" size={17} /> Criar build</button>
      </div>

      <div className="gh-build-games">
        <button type="button" className={`gh-gamechip${!game ? ' on' : ''}`} onClick={() => setGame('')}><span className="gh-gamechip-ico"><Ico name="hammer" size={18} /></span>Todas</button>
        {BUILD_GAMES.map((g) => (
          <button key={g.id} type="button" className={`gh-gamechip g-${g.id}${game === g.id ? ' on' : ''}`} onClick={() => setGame(g.id)}>
            <span className={`gh-gamechip-ico gm-${g.id}`} aria-hidden="true">{g.short.slice(0, 1)}</span>{g.short}
          </button>
        ))}
      </div>
      <div className="gh-section-head">
        <div className="gh-chips">
          <button type="button" className={`gh-chip${sort === 'top' && !mine ? ' on' : ''}`} onClick={() => { setSort('top'); setMine(false); }}>Mais curtidas</button>
          <button type="button" className={`gh-chip${sort === 'new' && !mine ? ' on' : ''}`} onClick={() => { setSort('new'); setMine(false); }}>Recentes</button>
          <button type="button" className={`gh-chip${mine ? ' on' : ''}`} onClick={() => setMine(true)}>Minhas</button>
        </div>
        <form className="gh-search gh-search-sm" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <Ico name="search" size={15} />
          <span className="sr-only">Buscar build</span>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setTerm(''); }} placeholder="Campeão, herói, jogo…" />
        </form>
      </div>

      {loading && !data ? (
        <div className="gh-build-grid">{Array.from({ length: 6 }, (_, i) => <span key={i} className="gh-skel gh-bcard-skel" />)}</div>
      ) : error && !data ? (
        <EmptyState icon="hammer" title="As builds não carregaram" action={<button type="button" className="gh-btn" onClick={reload}>Tentar de novo</button>} />
      ) : builds.length === 0 ? (
        <EmptyState icon="hammer" title={mine ? 'Você ainda não criou builds' : 'Nenhuma build aqui ainda'} action={<button type="button" className="gh-btn is-primary" onClick={() => navigate(`/jogos/builds/nova${game ? `?jogo=${game}` : ''}`)}><Ico name="plus" size={16} /> Criar a primeira</button>}>
          {term ? `Nada encontrado pra “${term}”.` : 'Monte a sua e ajude a galera a jogar melhor.'}
        </EmptyState>
      ) : (
        <>
          <div className="gh-build-grid">{builds.map((b) => <BuildCard key={b.id} build={b} onLike={like} />)}</div>
          {data?.more && <button type="button" className="gh-btn gh-more" onClick={more}>Mostrar mais</button>}
        </>
      )}
    </HubPage>
  );
}
