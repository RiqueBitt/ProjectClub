import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { MINIJOGOS, MINIJOGOS_CATEGORIES, findMinijogo } from '../minijogos/catalog.js';
import '../styles/minijogos.css';
import { useMinijogoScores, ScoresPanel } from '../minijogos/MiniJogoScores.jsx';
import TouchPad from '../minijogos/TouchPad.jsx';
import { CardView } from '../cards/CardView.jsx';
import { isFeatureEnabled } from '../utils/features';
import '../styles/cards.css';

// Cartas de vitrine do destaque da Arena (só visual).
const ARENA_SAMPLE = [
  { slug: 'capivara-suprema', name: 'Capivara Suprema', element: 'TERRA', rarity: 'MITICA', cost: 9, attack: 9, health: 10, ability: 'ESCUDO' },
  { slug: 'iceberg', name: 'O Iceberg', element: 'AGUA', rarity: 'MITICA', cost: 9, attack: 8, health: 12, ability: 'GUARDA' },
  { slug: 'goku', name: 'Goku', element: 'FOGO', rarity: 'MITICA', cost: 9, attack: 9, health: 9, ability: 'FURIA' },
];

// Mini-Jogos: jogos que já vêm no Project Club (ver minijogos/catalog.js).
// Lista no estilo "loja de atividades" (busca, destaques em cartões com
// banner, categorias em linhas) e um player que cobre a área da página.
// O jogo aberto fica na URL (?jogo=slug): o botão voltar do navegador
// fecha o player e dá pra mandar o link de um jogo direto.

// Ícones locais de traço (mesmo estilo de NavIcons.jsx).
const MJ_PATHS = {
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  mute: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6M21 9l-5 6" /></>,
  reload: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  play: <path d="M8 5v14l11-7L8 5Z" />,
  rotate: <><rect x="7" y="2" width="10" height="20" rx="2" transform="rotate(90 12 12)" /><path d="M4 7a8 8 0 0 1 4-4M8 3H5v3" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  shapes: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><path d="M17 3.5 21 10.5h-8z" /><circle cx="7" cy="17" r="3.6" /><path d="M17 13c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4z" /></>,
};
function MjIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {MJ_PATHS[name]}
    </svg>
  );
}

const MUTE_KEY = 'minijogos:muted';
const isCoarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
// No celular: tela cheia + paisagem travada (quando o navegador deixa).
function goLandscape(el) {
  if (!el) return;
  const lock = () => { try { window.screen?.orientation?.lock?.('landscape').catch(() => {}); } catch { /* ignora */ } };
  if (document.fullscreenElement === el) { lock(); return; }
  try { el.requestFullscreen?.({ navigationUI: 'hide' }).then(lock).catch(() => {}); } catch { /* ignora */ }
}
function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function GameRow({ game, onOpen }) {
  return (
    <button type="button" className="mj-row" onClick={() => onOpen(game.slug)}>
      <img className="mj-row-icon" src={game.icon} alt="" loading="lazy" draggable="false" />
      <span className="mj-row-text">
        <span className="mj-row-name">{game.name}{game.original && <span className="mj-row-orig">{game.original}</span>}</span>
        <span className="mj-row-desc">{game.description}</span>
      </span>
      <span className="mj-row-play" aria-hidden="true"><MjIcon name="play" size={14} /></span>
    </button>
  );
}

function MiniJogoPlayer({ game, onClose }) {
  const { user } = useAuth();
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const { board, toast } = useMinijogoScores(game.slug);
  const [showScores, setShowScores] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const playerName = user?.displayName || user?.username || '';
  const src = `${game.path}${game.path.includes('?') ? '&' : '?'}name=${encodeURIComponent(playerName.slice(0, 19))}`;

  // Repassa o mudo pro jogo (o shim dos jogos escuta essa mensagem).
  const sendMute = (value) => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try { win.__pcMuted = value; } catch { /* outra origem: ignora */ }
    win.postMessage({ type: 'pc-minigame-mute', muted: value }, window.location.origin);
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      try { localStorage.setItem(MUTE_KEY, next ? '1' : '0'); } catch { /* sem storage */ }
      sendMute(next);
      return next;
    });
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    else if (isCoarse()) goLandscape(el);
    else el.requestFullscreen?.().catch(() => {});
  };

  // Celular: abre em tela cheia na horizontal (o toque que abriu o jogo ainda vale).
  useEffect(() => { if (isCoarse()) goLandscape(wrapRef.current); }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement === wrapRef.current) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Esc fecha o player (quando não está em tela cheia — aí o Esc do
  // navegador só sai da tela cheia, como esperado).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Esc dentro do jogo (iframe da mesma origem) também fecha.
    let innerWins = [];
    const hookFrames = () => {
      innerWins.forEach((w) => { try { w.removeEventListener('keydown', onKey); } catch { /* ignora */ } });
      innerWins = [];
      try {
        const outer = frameRef.current?.contentWindow;
        if (!outer) return;
        innerWins.push(outer);
        const inner = outer.document.querySelector('iframe.game-box')?.contentWindow;
        if (inner) innerWins.push(inner);
        innerWins.forEach((w) => w.addEventListener('keydown', onKey));
      } catch { /* ignora */ }
    };
    const t = setInterval(hookFrames, 1500);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
      innerWins.forEach((w) => { try { w.removeEventListener('keydown', onKey); } catch { /* ignora */ } });
    };
  }, [onClose, reloadKey]);

  const onFrameLoad = () => {
    setLoaded(true);
    sendMute(muted);
    try { frameRef.current?.focus(); } catch { /* ignora */ }
  };

  return (
    <div className={`mj-player${isFullscreen ? ' is-fullscreen' : ''}`} ref={wrapRef} role="dialog" aria-label={game.name}>
      <div className="mj-player-bar">
        <button type="button" className="mj-player-btn" onClick={onClose} title="Voltar (Esc)" aria-label="Voltar">
          <MjIcon name="back" />
        </button>
        <img className="mj-player-icon" src={game.icon} alt="" draggable="false" />
        <div className="mj-player-title">
          <span className="mj-player-name">{game.name}</span>
          <span className="mj-player-controls"><MjIcon name="keyboard" size={13} />{isCoarse() && game.touch ? game.touch : game.controls}</span>
        </div>
        <div className="mj-player-actions">
          <button type="button" className={`mj-player-btn mj-scores-btn${showScores ? ' is-on' : ''}`} onClick={() => setShowScores((v) => !v)} title="Recordes" aria-label="Recordes" aria-pressed={showScores}>
            <MjIcon name="trophy" />
            {board?.me?.best > 0 && <span className="mj-scores-best">{board.me.best.toLocaleString('pt-BR')}</span>}
          </button>
          <button type="button" className="mj-player-btn" onClick={() => { setLoaded(false); setReloadKey((k) => k + 1); }} title="Reiniciar" aria-label="Reiniciar">
            <MjIcon name="reload" />
          </button>
          <button type="button" className={`mj-player-btn${muted ? ' is-on' : ''}`} onClick={toggleMute} title={muted ? 'Ativar som' : 'Silenciar'} aria-label={muted ? 'Ativar som' : 'Silenciar'} aria-pressed={muted}>
            <MjIcon name={muted ? 'mute' : 'volume'} />
          </button>
          <button type="button" className="mj-player-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            <MjIcon name={isFullscreen ? 'shrink' : 'expand'} />
          </button>
        </div>
      </div>
      <div className="mj-player-stage">
        {showScores && <ScoresPanel board={board} onClose={() => setShowScores(false)} />}
        {toast && (
          <div className="mj-score-toast" role="status"><strong>{toast.title}</strong><span>{toast.text}</span></div>
        )}
        {!loaded && (
          <div className="mj-player-loading" aria-hidden="true">
            <img src={game.icon} alt="" />
            <span className="mj-player-spinner" />
          </div>
        )}
        <iframe
          key={reloadKey}
          ref={frameRef}
          className="mj-player-frame"
          src={src}
          title={game.name}
          allow="autoplay; fullscreen"
          onLoad={onFrameLoad}
        />
        <TouchPad frameRef={frameRef} layout={game.pad || 'dpada'} />
        {loaded && isCoarse() && game.touch && <div className="mj-touch-hint" role="note">{game.touch}</div>}
        <div className="mj-rotate-hint" role="note">
          <MjIcon name="rotate" size={34} />
          <strong>Gire o celular</strong>
          <span>Os mini-jogos funcionam melhor na horizontal. Toque em tela cheia (⤢) para jogar deitado.</span>
        </div>
      </div>
    </div>
  );
}

export default function MiniJogosPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({});
  const current = findMinijogo(params.get('jogo'));

  const navigate = useNavigate();
  // Abriu por aqui (entrada nova no histórico)? Então fechar = voltar,
  // pra o "voltar" do navegador não reabrir o jogo depois.
  const openedHere = useRef(false);
  const openGame = (slug) => { openedHere.current = true; setParams({ jogo: slug }); };
  const closeGame = useCallback(() => {
    if (openedHere.current) { openedHere.current = false; navigate(-1); return; }
    setParams((p) => { const n = new URLSearchParams(p); n.delete('jogo'); return n; }, { replace: true });
  }, [navigate, setParams]);

  const q = normalize(query.trim());
  const results = q
    ? MINIJOGOS.filter((g) => normalize(`${g.name} ${g.original || ''} ${g.description}`).includes(q))
    : null;
  const featured = MINIJOGOS.filter((g) => g.featured);
  const ROW_LIMIT = 3;

  return (
    <div className="mj-page">
      <div className="mj-scroll" aria-hidden={current ? 'true' : undefined}>
        <div className="mj-inner">
          <header className="mj-header">
            <span className="mj-header-icon"><MjIcon name="shapes" size={26} /></span>
            <div>
              <h1>Mini-Jogos</h1>
              <p>Jogos rápidos que já vêm no Project Club. É só clicar e jogar.</p>
            </div>
          </header>

          <label className="mj-search">
            <MjIcon name="search" />
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar mini-jogos" aria-label="Pesquisar mini-jogos"
            />
          </label>

          {results ? (
            <section className="mj-section">
              <h2 className="mj-section-title">Resultados</h2>
              {results.length ? (
                <div className="mj-list">{results.map((g) => <GameRow key={g.slug} game={g} onOpen={openGame} />)}</div>
              ) : (
                <div className="mj-empty">
                  <span className="mj-empty-icon"><MjIcon name="search" size={22} /></span>
                  <strong>Nenhum mini-jogo encontrado</strong>
                  <span>Tente pesquisar com outras palavras.</span>
                </div>
              )}
            </section>
          ) : (
            <>
              {/* Guerra das Cartas desligada temporariamente (utils/features.js). */}
              {isFeatureEnabled('cardsWar') && <button type="button" className="mj-tcg-feature" onClick={() => navigate('/cartas')}>
                <span className="mj-tcg-text">
                  <em>Jogo principal</em>
                  <strong>Guerra das Cartas</strong>
                  <span>Colecione cartas, abra pacotes com suas moedas, monte baralhos e duele contra bots e amigos.</span>
                </span>
                <span className="mj-tcg-cards" aria-hidden="true">
                  {ARENA_SAMPLE.map((c, i) => <CardView key={c.slug} card={c} size="sm" style={{ '--r': `${(i - 1) * 8}deg` }} />)}
                </span>
                <span className="tcg-btn primary mj-tcg-play"><MjIcon name="play" size={14} />Jogar</span>
              </button>}
              <section className="mj-section">
                <h2 className="mj-section-title">Em destaque</h2>
                <div className="mj-featured">
                  {featured.map((g) => (
                    <button key={g.slug} type="button" className="mj-card" onClick={() => openGame(g.slug)}>
                      <span className="mj-card-banner">
                        <img src={g.cover} alt="" loading="lazy" draggable="false" />
                        <span className="mj-card-play"><MjIcon name="play" size={16} />Jogar</span>
                      </span>
                      <span className="mj-card-info">
                        <img className="mj-card-icon" src={g.icon} alt="" loading="lazy" draggable="false" />
                        <span className="mj-card-text">
                          <span className="mj-card-name">{g.name}</span>
                          <span className="mj-card-desc">{g.description}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {MINIJOGOS_CATEGORIES.map((cat) => {
                const games = MINIJOGOS.filter((g) => g.category === cat.id);
                if (!games.length) return null;
                const open = !!expanded[cat.id];
                const shown = open ? games : games.slice(0, ROW_LIMIT);
                return (
                  <section key={cat.id} className="mj-section">
                    <div className="mj-section-head">
                      <div>
                        <h2 className="mj-section-title">{cat.name}</h2>
                        <p className="mj-section-sub">{cat.description}</p>
                      </div>
                      {games.length > ROW_LIMIT && (
                        <button type="button" className="mj-more" onClick={() => setExpanded((e) => ({ ...e, [cat.id]: !open }))}>
                          {open ? 'Ver menos' : 'Ver mais'}
                        </button>
                      )}
                    </div>
                    <div className="mj-list">{shown.map((g) => <GameRow key={g.slug} game={g} onOpen={openGame} />)}</div>
                  </section>
                );
              })}

              <p className="mj-credits">
                Recriações feitas por fãs dos mini-jogos do Club Penguin, com textos traduzidos para o português. Funcionam no PC (mouse e teclado) e no celular (toque e controles na tela).
              </p>
            </>
          )}
        </div>
      </div>

      {current && <MiniJogoPlayer key={current.slug} game={current} onClose={closeGame} />}
    </div>
  );
}
