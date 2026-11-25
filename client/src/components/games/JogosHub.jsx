import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { getGameLibrary } from '../../api/games';
import { isFeatureEnabled } from '../../utils/features';
import { steamCoverCandidates, steamAppIdFromActivity } from '../../utils/activityArt';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/jogos-hub.css';

// Canal em destaque "Jogos" (nov/2026): vitrine no topo (BLACKOUT, Mod
// Manager, Guerra das Cartas, biblioteca), quem está jogando agora, a mesa
// de RPG, seus jogos recentes e atalhos. Os apps do clube continuam embaixo
// (pages/JogosPage.jsx).

const IC = {
  dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 8.5h.01M15.5 8.5h.01M8.5 15.5h.01M15.5 15.5h.01M12 12h.01',
  puzzle: 'M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z',
  cards: 'M4 7l9-3 4 12-9 3-4-12zM15 5l4 1-3 12',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 2.5 15.5-3.5 1z',
  gamepad: 'M6 9h12a4 4 0 0 1 3.9 4.9l-.9 3.6a2 2 0 0 1-3.4.9L15 16H9l-2.6 2.4a2 2 0 0 1-3.4-.9l-.9-3.6A4 4 0 0 1 6 9zM8 11v3M6.5 12.5h3M15 12h.01M17 13.5h.01',
  arrow: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
};
function Svg({ d, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

// Capa da Steam com fallback (cada erro tenta a próxima).
function GameCover({ appId, name }) {
  const list = useMemo(() => steamCoverCandidates(appId, 'cover'), [appId]);
  const [i, setI] = useState(0);
  if (!list[i]) return <span className="jh-cover-none"><Svg d={IC.gamepad} size={34} /><b>{name}</b></span>;
  return <img src={list[i].src} alt="" loading="lazy" onError={() => setI((n) => n + 1)} />;
}

export default function JogosHub() {
  const navigate = useNavigate();
  const members = useStore((s) => s.members);
  const activities = useStore((s) => s.activities);
  const disabledSystems = useStore((s) => s.disabledSystems) || [];

  const slides = useMemo(() => [
    {
      key: 'blackout', cls: 'blackout', icon: IC.dice, kicker: 'RPG do clube', title: 'BLACKOUT',
      text: 'O compêndio completo do RPG BLACKOUT: regras, classes, poderes e fichas. Agora aberto pra todo mundo.',
      cta: 'Abrir compêndio', to: '/compendio-blackout',
    },
    {
      key: 'mods', cls: 'mods', icon: IC.puzzle, kicker: 'Ferramenta', title: 'Mod Manager',
      text: 'Instale, organize e jogue com mods e modpacks da Steam, Epic, GOG, Minecraft e Hytale.',
      cta: 'Abrir Mod Manager', to: '/jogos/mods',
    },
    ...(isFeatureEnabled('cardsWar') && !disabledSystems.includes('cartas') ? [{
      key: 'cartas', cls: 'cartas', icon: IC.cards, kicker: 'Jogo de cartas', title: 'Guerra das Cartas',
      text: 'Colecione cartas, monte seu baralho e batalhe com o pessoal do clube.',
      cta: 'Jogar', to: '/cartas',
    }] : []),
    {
      key: 'biblioteca', cls: 'library', icon: IC.library, kicker: 'Sua biblioteca', title: 'Biblioteca de jogos',
      text: 'Seu tempo de jogo, jogos recentes e o que você está jogando agora.',
      cta: 'Ver biblioteca', to: '/jogos/biblioteca',
    },
  ], [disabledSystems]);

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
  const [games, setGames] = useState(null);
  useEffect(() => {
    let alive = true;
    getGameLibrary('me').then((d) => {
      if (!alive) return;
      const list = [...(d?.games || [])].sort((a, b) => (b.playingNow ? 1 : 0) - (a.playingNow ? 1 : 0) || new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0));
      setGames(list.slice(0, 8));
    }).catch(() => { if (alive) setGames([]); });
    return () => { alive = false; };
  }, []);

  const s = slides[cur];
  return (
    <div className="jh">
      <section
        className={`jh-hero jh-${s.cls}`} aria-roledescription="carrossel" aria-label="Destaques de jogos"
        onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      >
        <span className="jh-hero-art" aria-hidden="true"><Svg d={s.icon} size={190} /></span>
        <div className="jh-hero-content" key={s.key}>
          <span className="jh-kicker"><Svg d={s.icon} size={14} /> {s.kicker}</span>
          <h1 className="jh-title">{s.title}</h1>
          <p className="jh-text">{s.text}</p>
          <button type="button" className="jh-cta" onClick={() => navigate(s.to)}>{s.cta} <Svg d={IC.arrow} size={16} /></button>
        </div>
        {n > 1 && (
          <div className="jh-dots" role="tablist" aria-label="Escolher destaque">
            {slides.map((x, i) => (
              <button key={x.key} type="button" role="tab" aria-selected={i === cur} aria-label={x.title} className={`jh-dot${i === cur ? ' on' : ''}`} onClick={() => setIdx(i)} />
            ))}
          </div>
        )}
      </section>

      <div className="jh-row">
        <section className="jh-block">
          <h2 className="jh-h2">Jogando agora</h2>
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
          <span className="jh-promo-art" aria-hidden="true"><Svg d={IC.dice} size={120} /></span>
          <h2>Monte sua mesa de RPG</h2>
          <p>Crie uma call no modo RPG (1 mestre e até 4 jogadores) e jogue BLACKOUT com a galera.</p>
          <button type="button" className="jh-promo-btn" onClick={() => navigate('/compendio-blackout')}>Abrir o BLACKOUT</button>
        </section>
      </div>

      <section className="jh-block">
        <div className="jh-head">
          <h2 className="jh-h2">Seus jogos recentes</h2>
          <button type="button" className="jh-link" onClick={() => navigate('/jogos/biblioteca')}>Ver biblioteca <Svg d={IC.arrow} size={14} /></button>
        </div>
        {games === null ? (
          <div className="jh-games">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="jh-game jh-skel" />)}</div>
        ) : games.length === 0 ? (
          <p className="jh-empty">Nenhum jogo na sua biblioteca ainda. Jogue com o app do PC aberto pra registrar o tempo de jogo.</p>
        ) : (
          <div className="jh-games">
            {games.map((g) => (
              <button key={g.gameKey} type="button" className={`jh-game${g.playingNow ? ' is-now' : ''}`} onClick={() => navigate('/jogos/biblioteca')} title={g.name}>
                <span className="jh-game-art"><GameCover appId={g.steamAppId} name={g.name} /></span>
                <span className="jh-game-name">{g.playingNow ? 'Jogando · ' : ''}{g.name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="jh-block">
        <h2 className="jh-h2">Atalhos</h2>
        <div className="jh-tools">
          <button type="button" className="jh-tool t-blackout" onClick={() => navigate('/compendio-blackout')}><Svg d={IC.dice} size={22} /><span><strong>BLACKOUT</strong><small>Compêndio do RPG</small></span></button>
          <button type="button" className="jh-tool t-mods" onClick={() => navigate('/jogos/mods')}><Svg d={IC.puzzle} size={22} /><span><strong>Mod Manager</strong><small>Mods e modpacks</small></span></button>
          <button type="button" className="jh-tool t-library" onClick={() => navigate('/jogos/biblioteca')}><Svg d={IC.library} size={22} /><span><strong>Biblioteca</strong><small>Tempo de jogo</small></span></button>
        </div>
      </section>
    </div>
  );
}
