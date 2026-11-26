import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { getGameLibrary } from '../../api/games';
import { getDeals, getHotlist, listBuilds, listClips, listParties } from '../../api/gameHub';
import { isFeatureEnabled } from '../../utils/features';
import { steamAppIdFromActivity } from '../../utils/activityArt';
import UserAvatar from '../UserAvatar.jsx';
import { GameCover, Ico, fmtHours } from '../../pages/gamehub/shared.jsx';
import { FreeCard } from '../../pages/gamehub/DealsTab.jsx';
import { PartyCard, CreatePartyModal } from '../../pages/gamehub/PartiesTab.jsx';
import { ClipCard, ClipPlayer } from '../../pages/gamehub/ClipsTab.jsx';
import { BuildCard } from '../../pages/gamehub/BuildsTab.jsx';
import '../../styles/jogos-hub.css';

// Game Hub → Início (nov/2026): vitrine, a Hotlist do mês (os 5 mais
// jogados no clube), grátis da semana, partidas abertas, clipes e builds,
// quem está jogando agora e seus jogos recentes. Os apps do clube continuam
// embaixo (pages/JogosPage.jsx).

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Carrega uma seção sem derrubar as outras se falhar.
function useSection(loader) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let alive = true;
    loader().then((d) => { if (alive) setV(d); }).catch(() => { if (alive) setV(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [v, setV];
}

function SectionHead({ icon, title, to, linkLabel }) {
  const navigate = useNavigate();
  return (
    <div className="jh-head">
      <h2 className="jh-h2"><Ico name={icon} size={20} /> {title}</h2>
      {to && <button type="button" className="jh-link" onClick={() => navigate(to)}>{linkLabel} <Ico name="arrow" size={14} /></button>}
    </div>
  );
}

export default function JogosHub() {
  const navigate = useNavigate();
  const members = useStore((s) => s.members);
  const activities = useStore((s) => s.activities);
  const disabledSystems = useStore((s) => s.disabledSystems) || [];

  const [hot] = useSection(getHotlist);
  const [deals] = useSection(getDeals);
  const [parties, setParties] = useSection(listParties);
  const [clips] = useSection(() => listClips().then((d) => d.clips || []));
  const [builds] = useSection(() => listBuilds({ sort: 'top' }).then((d) => d.builds || []));
  const [creating, setCreating] = useState(false);
  const [playingClip, setPlayingClip] = useState(null);

  const firstFree = deals && deals.free?.[0];
  const slides = useMemo(() => [
    {
      key: 'partidas', cls: 'party', icon: 'users', kicker: 'Game Hub', title: 'Partidas',
      text: 'Abra uma partida, chame os amigos e vão todos pra call juntos — agora ou num horário marcado.',
      cta: 'Ver partidas', to: '/jogos/partidas',
    },
    ...(firstFree ? [{
      key: 'gratis', cls: 'free', icon: 'gift', kicker: 'Grátis agora', title: firstFree.title,
      text: 'Tem jogo de graça pra resgatar. Veja as promoções da Steam, Epic e GOG num lugar só.',
      cta: 'Ver promoções', to: '/jogos/promocoes',
    }] : []),
    {
      key: 'builds', cls: 'builds', icon: 'hammer', kicker: 'Game Hub', title: 'Builds',
      text: 'Monte e compartilhe builds de LoL, Deadlock, Darktide e de qualquer outro jogo.',
      cta: 'Ver builds', to: '/jogos/builds',
    },
    {
      key: 'mods', cls: 'mods', icon: 'puzzle', kicker: 'Ferramenta', title: 'Mod Manager',
      text: 'Instale, organize e jogue com mods e modpacks da Steam, Epic, GOG, Minecraft e Hytale.',
      cta: 'Abrir Mod Manager', to: '/jogos/mods',
    },
    {
      key: 'blackout', cls: 'blackout', icon: 'dice', kicker: 'RPG do clube', title: 'BLACKOUT',
      text: 'O compêndio completo do RPG BLACKOUT: regras, classes, poderes e fichas. Aberto pra todo mundo.',
      cta: 'Abrir compêndio', to: '/compendio-blackout',
    },
    ...(isFeatureEnabled('cardsWar') && !disabledSystems.includes('cartas') ? [{
      key: 'cartas', cls: 'cartas', icon: 'sparkle', kicker: 'Jogo de cartas', title: 'Guerra das Cartas',
      text: 'Colecione cartas, monte seu baralho e batalhe com o pessoal do clube.',
      cta: 'Jogar', to: '/cartas',
    }] : []),
  ], [disabledSystems, firstFree]);

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const cur = Math.min(idx, n - 1);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (paused || reduced || n < 2) return undefined;
    const t = setTimeout(() => setIdx((cur + 1) % n), 7000);
    return () => clearTimeout(t);
  }, [cur, paused, reduced, n]);

  // Quem está jogando agora (Rich Presence).
  const playing = useMemo(() => (members || [])
    .map((m) => ({ user: m.user, act: activities?.[m.user?.id] }))
    .filter((p) => p.user && p.act?.type === 'game')
    .slice(0, 6), [members, activities]);

  // Seus jogos recentes (biblioteca).
  const [games] = useSection(() => getGameLibrary('me').then((d) => [...(d?.games || [])]
    .sort((a, b) => (b.playingNow ? 1 : 0) - (a.playingNow ? 1 : 0) || new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0))
    .slice(0, 8)));

  const s = slides[cur];
  const hotGames = hot?.games || [];
  const monthName = hot?.month ? MONTHS[Number(hot.month.slice(5, 7)) - 1] : MONTHS[new Date().getMonth()];
  const openParties = (parties || []).slice(0, 3);
  const freeList = [...(deals?.free || []), ...(deals?.upcoming || [])].slice(0, 4);

  return (
    <div className="jh">
      <section
        className={`jh-hero jh-${s.cls}`} aria-roledescription="carrossel" aria-label="Destaques do Game Hub"
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      >
        <span className="jh-hero-art" aria-hidden="true"><Ico name={s.icon} size={190} /></span>
        <div className="jh-hero-content" key={s.key}>
          <span className="jh-kicker"><Ico name={s.icon} size={14} /> {s.kicker}</span>
          <h1 className="jh-title">{s.title}</h1>
          <p className="jh-text">{s.text}</p>
          <button type="button" className="jh-cta" onClick={() => navigate(s.to)}>{s.cta} <Ico name="arrow" size={16} /></button>
        </div>
        {n > 1 && (
          <div className="jh-dots" role="tablist" aria-label="Escolher destaque">
            {slides.map((x, i) => (
              <button key={x.key} type="button" role="tab" aria-selected={i === cur} aria-label={x.title} className={`jh-dot${i === cur ? ' on' : ''}`} onClick={() => setIdx(i)} />
            ))}
          </div>
        )}
      </section>

      {/* Hotlist do mês */}
      <section className="jh-block" aria-labelledby="jh-hot-h">
        <div className="jh-head">
          <h2 className="jh-h2" id="jh-hot-h"><Ico name="flame" size={20} /> Hotlist de {monthName}</h2>
          <span className="jh-head-note">Os 5 jogos mais jogados no Project Club este mês</span>
        </div>
        {hot === null ? (
          <div className="jh-hot">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={`jh-hot-item jh-skel p${i + 1}`} />)}</div>
        ) : hotGames.length === 0 ? (
          <p className="jh-empty">Ninguém jogou nada com o app do PC aberto este mês ainda. Abra um jogo e ele aparece aqui.</p>
        ) : (
          <ol className="jh-hot">
            {hotGames.map((g) => (
              <li key={g.gameKey} className={`jh-hot-item p${g.position}`}>
                <span className="jh-hot-art"><GameCover appId={g.steamAppId} src={g.iconUrl && !g.steamAppId ? g.iconUrl : null} name={g.name} shape="cover" /></span>
                <span className="jh-hot-pos">{g.position}</span>
                <span className="jh-hot-text">
                  <strong className="truncate">{g.name}</strong>
                  <small>{fmtHours(g.seconds)} · {g.players} {g.players === 1 ? 'pessoa' : 'pessoas'}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {freeList.length > 0 && (
        <section className="jh-block">
          <SectionHead icon="gift" title="Grátis pra resgatar" to="/jogos/promocoes" linkLabel="Todas as promoções" />
          <div className="gh-free-grid is-row">{freeList.map((d) => <FreeCard key={d.id} deal={d} upcoming={!!d.startsAt && new Date(d.startsAt) > new Date()} />)}</div>
        </section>
      )}

      <section className="jh-block">
        <div className="jh-head">
          <h2 className="jh-h2"><Ico name="users" size={20} /> Partidas abertas</h2>
          <span className="jh-head-actions">
            <button type="button" className="gh-btn is-primary is-sm" onClick={() => setCreating(true)}><Ico name="plus" size={14} /> Abrir partida</button>
            <button type="button" className="jh-link" onClick={() => navigate('/jogos/partidas')}>Ver todas <Ico name="arrow" size={14} /></button>
          </span>
        </div>
        {parties === null ? (
          <div className="gh-party-list">{[0, 1].map((i) => <span key={i} className="gh-skel gh-party-skel" />)}</div>
        ) : openParties.length === 0 ? (
          <p className="jh-empty">Nenhuma partida aberta agora. Abra uma e chame a galera.</p>
        ) : (
          <div className="gh-party-list">
            {openParties.map((p) => <PartyCard key={p.id} party={p} compact onChange={(r) => (r?.id ? setParties((l) => l.map((x) => (x.id === r.id ? r : x))) : listParties().then(setParties))} />)}
          </div>
        )}
      </section>

      <div className="jh-row">
        <section className="jh-block">
          <h2 className="jh-h2"><Ico name="gamepad" size={20} /> Jogando agora</h2>
          {playing.length === 0 ? (
            <p className="jh-empty">Ninguém jogando no momento. Quando alguém abrir um jogo, aparece aqui.</p>
          ) : (
            <div className="jh-players">
              {playing.map(({ user, act }) => (
                <button
                  key={user.id} type="button" className="jh-player"
                  onClick={(e) => useStore.getState().openMiniProfile(user.id, e.currentTarget.getBoundingClientRect(), 'left')}
                >
                  <UserAvatar user={user} size={40} />
                  <span className="jh-player-text">
                    <strong className="truncate">{user.displayName}</strong>
                    <small className="truncate">{act.name}</small>
                  </span>
                  {steamAppIdFromActivity(act) && <span className="jh-player-dot" title="Jogando agora" />}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="jh-promo">
          <span className="jh-promo-art" aria-hidden="true"><Ico name="dice" size={120} /></span>
          <h2>Monte sua mesa de RPG</h2>
          <p>Crie uma call no modo RPG (1 mestre e até 4 jogadores) e jogue BLACKOUT com a galera.</p>
          <button type="button" className="jh-promo-btn" onClick={() => navigate('/compendio-blackout')}>Abrir o BLACKOUT</button>
        </section>
      </div>

      {clips && clips.length > 0 && (
        <section className="jh-block">
          <SectionHead icon="film" title="Clipes da galera" to="/jogos/clipes" linkLabel="Ver clipes" />
          <div className="gh-clip-grid is-row">{clips.slice(0, 4).map((c) => <ClipCard key={c.id} clip={c} onOpen={setPlayingClip} />)}</div>
        </section>
      )}

      {builds && builds.length > 0 && (
        <section className="jh-block">
          <SectionHead icon="hammer" title="Builds em alta" to="/jogos/builds" linkLabel="Ver builds" />
          <div className="gh-build-grid is-row">{builds.slice(0, 4).map((b) => <BuildCard key={b.id} build={b} />)}</div>
        </section>
      )}

      <section className="jh-block">
        <SectionHead icon="library" title="Seus jogos recentes" to="/jogos/biblioteca" linkLabel="Ver biblioteca" />
        {games === null ? (
          <div className="jh-games">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="jh-game jh-skel" />)}</div>
        ) : !games || games.length === 0 ? (
          <p className="jh-empty">Nenhum jogo na sua biblioteca ainda. Jogue com o app do PC aberto pra registrar o tempo de jogo.</p>
        ) : (
          <div className="jh-games">
            {games.map((g) => (
              <button key={g.gameKey} type="button" className={`jh-game${g.playingNow ? ' is-now' : ''}`} onClick={() => navigate('/jogos/biblioteca')} title={g.name}>
                <span className="jh-game-art"><GameCover appId={g.steamAppId} name={g.name} shape="cover" /></span>
                <span className="jh-game-name">{g.playingNow ? 'Jogando · ' : ''}{g.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="jh-block">
        <h2 className="jh-h2">Atalhos</h2>
        <div className="jh-tools">
          <button type="button" className="jh-tool t-mods" onClick={() => navigate('/jogos/mods')}><Ico name="puzzle" size={22} /><span><strong>Mod Manager</strong><small>Mods e modpacks</small></span></button>
          <button type="button" className="jh-tool t-deals" onClick={() => navigate('/jogos/promocoes')}><Ico name="tag" size={22} /><span><strong>Promoções</strong><small>Steam, Epic e GOG</small></span></button>
          <button type="button" className="jh-tool t-blackout" onClick={() => navigate('/compendio-blackout')}><Ico name="dice" size={22} /><span><strong>BLACKOUT</strong><small>Compêndio do RPG</small></span></button>
          <button type="button" className="jh-tool t-library" onClick={() => navigate('/jogos/biblioteca')}><Ico name="library" size={22} /><span><strong>Biblioteca</strong><small>Tempo de jogo</small></span></button>
        </div>
      </section>

      {creating && <CreatePartyModal onClose={() => setCreating(false)} onCreated={(p) => navigate(`/jogos/partidas?p=${p.id}`)} />}
      {playingClip && <ClipPlayer clip={playingClip} onClose={() => setPlayingClip(null)} />}
    </div>
  );
}
