import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  matchSteamGames, getModioGameTags, listMods, getMod, getModDownload,
  toggleModFavorite, toggleModUp, listModComments, addModComment, reportMod,
} from '../api/endpoints';
import {
  isDesktopModsAvailable, detectSteamGames, installModLocally, listInstalledModsLocally, onModsProgress,
} from '../utils/mods';
import { proxyImage } from '../utils/imageProxy';
import '../styles/mods-page.css';

// Item pedido: "Project Club → Apps → Mods → detectar Steam → detectar
// jogos instalados → mostrar os jogos do usuário → escolher um jogo →
// mostrar os mods disponíveis → instalar e gerenciar mods." — este
// arquivo é a página inteira desse fluxo, com navegação interna própria
// (mesmo padrão de JogosPage.jsx: um estado de "view" em vez de várias
// rotas separadas, já que tudo isso é uma experiência só e contínua).
//
// FASE 1 deste sistema — o que já funciona de ponta a ponta:
// - Detecção real da Steam (via app desktop) + cruzamento com o
//   catálogo de jogos com suporte (ModGameMapping, staff-editável).
// - Busca/listagem/detalhe de mods direto da API do mod.io (nunca
//   armazenamos o arquivo do mod em lugar nenhum nosso).
// - Favoritar, dar up, comentar, denunciar — tudo com a conta atual do
//   Project Club, sem login separado.
// - Instalação de verdade pelo app desktop (baixa, extrai, coloca na
//   pasta do jogo).
// O que ainda NÃO está nesta fase (ver comentários mais abaixo, nos
// pontos exatos): perfis com ativar/desativar, coleções, resolução
// automática de dependências/conflitos, "▶ Jogar".
export default function ModsPage() {
  const navigate = useNavigate();
  const [view, setView] = useState('home'); // 'home' | 'game' | 'mod'
  const [selectedGame, setSelectedGame] = useState(null); // { modioGameId, steamAppId, displayName, iconUrl, installPath? }
  const [selectedModId, setSelectedModId] = useState(null);

  const openGame = (game) => { setSelectedGame(game); setView('game'); };
  const openMod = (modId) => { setSelectedModId(modId); setView('mod'); };
  const backToGame = () => setView('game');
  const backToHome = () => { setView('home'); setSelectedGame(null); };

  if (view === 'mod' && selectedGame) {
    return <ModDetailView game={selectedGame} modioModId={selectedModId} onBack={backToGame} />;
  }
  if (view === 'game' && selectedGame) {
    return <GameModsView game={selectedGame} onBack={backToHome} onOpenMod={openMod} />;
  }
  return <ModsHome onBack={() => navigate('/jogos')} onOpenGame={openGame} />;
}

// ---------- Tela inicial: Meus jogos ----------
function ModsHome({ onBack, onOpenGame }) {
  const desktopReady = isDesktopModsAvailable();
  const [loading, setLoading] = useState(true);
  const [steamFound, setSteamFound] = useState(null);
  const [games, setGames] = useState([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!desktopReady) { setLoading(false); return; }
    (async () => {
      try {
        // Item pedido 30: a detecção roda LOCALMENTE (steamDetector.js,
        // dentro do app desktop) — só a lista de AppIDs encontrados
        // sobe pro servidor, pra cruzar com o catálogo de suporte.
        const detection = await detectSteamGames();
        setSteamFound(detection.steamFound);
        if (detection.steamFound && detection.games.length > 0) {
          const { games: supported } = await matchSteamGames(detection.games.map((g) => g.steamAppId));
          const bySteamId = new Map(supported.map((s) => [s.steamAppId, s]));
          const merged = detection.games
            .map((g) => {
              const support = bySteamId.get(g.steamAppId);
              return support ? { ...support, installPath: g.installPath } : null;
            })
            .filter(Boolean);
          setGames(merged);
        }
      } catch {
        setSteamFound(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [desktopReady]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.displayName.toLowerCase().includes(q));
  }, [games, query]);

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Apps</button>
      <div className="mods-page-header">
        <h1>🧰 Mods</h1>
        <p className="dim">Descubra e gerencie mods dos jogos instalados na sua Steam.</p>
      </div>

      <input
        className="mods-search-bar"
        placeholder="Pesquisar nos seus jogos..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!desktopReady && (
        <div className="mods-empty-state">
          <span className="mods-empty-icon">🖥️</span>
          <h3>Isso precisa do app de desktop</h3>
          <p>A detecção da Steam e a instalação de mods só funcionam pelo app de desktop do Project Club — o navegador não tem acesso às pastas de jogos por segurança.</p>
        </div>
      )}

      {desktopReady && loading && <div className="mods-loading">Procurando jogos na sua Steam...</div>}

      {desktopReady && !loading && steamFound === false && (
        <div className="mods-empty-state">
          <span className="mods-empty-icon">🔍</span>
          <h3>Não encontramos a Steam</h3>
          <p>Verifique se a Steam está instalada neste computador. Se ela estiver num lugar incomum, isso pode falhar — estamos de olho nisso pra próxima fase.</p>
        </div>
      )}

      {desktopReady && !loading && steamFound && (
        <>
          <h2 className="mods-section-title">Meus jogos</h2>
          {games.length === 0 ? (
            <div className="mods-empty-state">
              <span className="mods-empty-icon">🎮</span>
              <h3>Nenhum jogo com suporte a mods encontrado</h3>
              <p>Detectamos sua Steam, mas nenhum dos jogos instalados tem suporte a mods configurado ainda.</p>
            </div>
          ) : (
            <div className="mods-games-grid">
              {filtered.map((g) => <GameCard key={g.steamAppId} game={g} onClick={() => onOpenGame(g)} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GameCard({ game, onClick }) {
  return (
    <button type="button" className="mods-game-card" onClick={onClick}>
      <div className="mods-game-card-icon">
        {game.iconUrl ? <img src={proxyImage(game.iconUrl)} alt="" /> : <span>🎮</span>}
      </div>
      <span className="mods-game-card-name">{game.displayName}</span>
    </button>
  );
}

// ---------- Tela do jogo: busca/lista de mods ----------
const SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'rating', label: 'Melhor avaliados' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

function GameModsView({ game, onBack, onOpenMod }) {
  const [tab, setTab] = useState('mods'); // 'mods' | 'installed' | 'soon'
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState([]);
  const [mods, setMods] = useState(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [installedNames, setInstalledNames] = useState([]);

  useEffect(() => {
    getModioGameTags(game.modioGameId).then((d) => {
      // A API devolve grupos de tags (ex: categoria "Categoria" com
      // opções Gameplay/Gráficos/Mapas/...) — achata pro primeiro grupo
      // pra um filtro simples de categoria (item pedido 10).
      const firstGroup = d.tags?.[0];
      setTags(firstGroup?.tags || []);
    }).catch(() => setTags([]));
  }, [game.modioGameId]);

  useEffect(() => {
    setMods(null);
    const timeout = setTimeout(() => {
      listMods(game.modioGameId, { q: query || undefined, sort, category: category || undefined })
        .then((d) => { setMods(d.mods); setResultTotal(d.resultTotal); })
        .catch(() => setMods([]));
    }, 250); // pequeno debounce pra não disparar uma busca a cada tecla
    return () => clearTimeout(timeout);
  }, [game.modioGameId, query, sort, category]);

  useEffect(() => {
    if (tab === 'installed' && game.installPath) {
      listInstalledModsLocally(game.installPath).then((d) => setInstalledNames(d.mods || []));
    }
  }, [tab, game.installPath]);

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Meus jogos</button>

      <div className="mods-game-header" style={game.iconUrl ? undefined : undefined}>
        <div className="mods-game-header-icon">{game.iconUrl ? <img src={proxyImage(game.iconUrl)} alt="" /> : '🎮'}</div>
        <div>
          <h1>{game.displayName}</h1>
          <p className="dim">{resultTotal} {resultTotal === 1 ? 'mod disponível' : 'mods disponíveis'}</p>
        </div>
      </div>

      <div className="mods-tabs">
        <button type="button" className={`mods-tab ${tab === 'mods' ? 'active' : ''}`} onClick={() => setTab('mods')}>Mods</button>
        <button type="button" className={`mods-tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>Meus mods</button>
        {/* Item pedido 9/19/18: Coleções e Atualizações ainda não têm
            fluxo próprio nesta fase — placeholder honesto em vez de
            fingir que já funciona (ver roadmap no topo do arquivo). */}
        <button type="button" className={`mods-tab ${tab === 'soon' ? 'active' : ''}`} onClick={() => setTab('soon')}>Coleções · Atualizações</button>
      </div>

      {tab === 'mods' && (
        <>
          <div className="mods-filters">
            <input className="mods-search-bar" placeholder="Pesquisar mods ou criadores..." value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="mods-filter-chips">
              {SORT_OPTIONS.map((o) => (
                <button key={o.value} type="button" className={`mods-chip ${sort === o.value ? 'active' : ''}`} onClick={() => setSort(o.value)}>{o.label}</button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="mods-filter-chips">
                <button type="button" className={`mods-chip ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>Todas categorias</button>
                {tags.map((t) => (
                  <button key={t.name} type="button" className={`mods-chip ${category === t.name ? 'active' : ''}`} onClick={() => setCategory(t.name)}>{t.name}</button>
                ))}
              </div>
            )}
          </div>

          {mods === null ? (
            <div className="mods-loading">Buscando mods...</div>
          ) : mods.length === 0 ? (
            <div className="mods-empty-state">
              <span className="mods-empty-icon">🔍</span>
              <h3>Nenhum mod encontrado</h3>
              <p>Tente outra busca ou outro filtro.</p>
            </div>
          ) : (
            <div className="mods-grid">
              {mods.map((m) => <ModCard key={m.id} mod={m} onClick={() => onOpenMod(m.id)} />)}
            </div>
          )}
        </>
      )}

      {tab === 'installed' && (
        !game.installPath ? (
          <div className="mods-empty-state">
            <span className="mods-empty-icon">📁</span>
            <h3>Pasta do jogo não detectada</h3>
            <p>Não conseguimos confirmar a pasta de instalação — abra o jogo pela Steam pra ela ser detectada de novo.</p>
          </div>
        ) : installedNames.length === 0 ? (
          <div className="mods-empty-state">
            <span className="mods-empty-icon">🧩</span>
            <h3>Nenhum mod instalado ainda</h3>
            <p>Instale um mod na aba "Mods" acima pra ele aparecer aqui.</p>
          </div>
        ) : (
          <div className="mods-installed-list">
            {installedNames.map((name) => (
              <div key={name} className="mods-installed-item">
                <span>🧩 {name}</span>
                <span className="mods-installed-tag">✓ Instalado</span>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'soon' && (
        <div className="mods-empty-state">
          <span className="mods-empty-icon">🚧</span>
          <h3>Coleções, perfis e atualizações em lote</h3>
          <p>Essas partes do sistema de Mods ainda estão a caminho numa próxima fase — por enquanto, instale e desinstale mods individualmente pela aba "Mods".</p>
        </div>
      )}
    </div>
  );
}

function ModCard({ mod, onClick }) {
  return (
    <button type="button" className="mods-mod-card" onClick={onClick}>
      <div className="mods-mod-card-thumb" style={mod.logo?.thumb_320x180 ? { backgroundImage: `url(${proxyImage(mod.logo.thumb_320x180)})` } : undefined}>
        {!mod.logo?.thumb_320x180 && <span>🧩</span>}
      </div>
      <div className="mods-mod-card-body">
        <span className="mods-mod-card-name">{mod.name}</span>
        <span className="mods-mod-card-author dim">por {mod.submitted_by?.username}</span>
        <div className="mods-mod-card-stats dim">
          <span>⬇ {formatCount(mod.stats?.downloads_total)}</span>
          {mod.stats?.ratings_positive > 0 && <span>👍 {formatCount(mod.stats.ratings_positive)}</span>}
        </div>
      </div>
    </button>
  );
}

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ---------- Página individual do mod ----------
function ModDetailView({ game, modioModId, onBack }) {
  const desktopReady = isDesktopModsAvailable();
  const [data, setData] = useState(null);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [busyFavorite, setBusyFavorite] = useState(false);
  const [busyUp, setBusyUp] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installProgress, setInstallProgress] = useState(null);
  const [installError, setInstallError] = useState('');
  const [installed, setInstalled] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const refresh = () => {
    getMod(game.modioGameId, modioModId).then(setData).catch(() => setData({ error: true }));
    listModComments(modioModId).then((d) => setComments(d.comments)).catch(() => setComments([]));
  };
  useEffect(refresh, [game.modioGameId, modioModId]);

  useEffect(() => {
    if (!desktopReady || !game.installPath || !data?.mod) return;
    listInstalledModsLocally(game.installPath).then((d) => {
      const folder = String(data.mod.name).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
      setInstalled((d.mods || []).includes(folder));
    });
  }, [desktopReady, game.installPath, data?.mod]);

  useEffect(() => {
    if (!desktopReady) return undefined;
    return onModsProgress((progress) => {
      if (progress.modioModId !== modioModId) return;
      setInstallProgress(progress);
      if (progress.phase === 'done') { setInstallBusy(false); setInstallProgress(null); setInstalled(true); }
    });
  }, [desktopReady, modioModId]);

  if (!data) return <div className="mods-page"><div className="mods-loading">Carregando mod...</div></div>;
  if (data.error) return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar</button>
      <div className="mods-empty-state"><span className="mods-empty-icon">⚠️</span><h3>Não foi possível carregar este mod</h3></div>
    </div>
  );

  const { mod, dependencies, isFavorited, isUpped } = data;

  const doFavorite = async () => {
    setBusyFavorite(true);
    try { await toggleModFavorite(game.modioGameId, modioModId); refresh(); } finally { setBusyFavorite(false); }
  };
  const doUp = async () => {
    setBusyUp(true);
    try { await toggleModUp(game.modioGameId, modioModId); refresh(); } finally { setBusyUp(false); }
  };
  const doComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    await addModComment(game.modioGameId, modioModId, content);
    setCommentText('');
    listModComments(modioModId).then((d) => setComments(d.comments));
  };
  const doReport = async () => {
    if (!reportReason.trim()) return;
    await reportMod(modioModId, reportReason.trim());
    setReportReason('');
    setReportOpen(false);
  };

  // Item pedido 12: instalação automática — pede a URL assinada pro
  // backend (nunca baixa o arquivo por aqui) e manda pro app desktop
  // instalar de verdade.
  const doInstall = async () => {
    if (!game.installPath) { setInstallError('Não sabemos onde este jogo está instalado — abra-o pela Steam pra detectarmos de novo.'); return; }
    setInstallError('');
    setInstallBusy(true);
    setInstallProgress({ phase: 'downloading', percent: 0 });
    try {
      const download = await getModDownload(game.modioGameId, modioModId);
      const result = await installModLocally({
        downloadUrl: download.downloadUrl,
        filename: download.filename,
        gameInstallPath: game.installPath,
        modName: mod.name,
        modioModId,
      });
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setInstallError(err.message);
      setInstallBusy(false);
      setInstallProgress(null);
    }
  };

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para {game.displayName}</button>

      <div className="mods-detail-banner" style={mod.logo?.original ? { backgroundImage: `url(${proxyImage(mod.logo.original)})` } : undefined}>
        {!mod.logo?.original && <span className="mods-detail-banner-fallback">🧩</span>}
        <div className="mods-detail-banner-gradient" />
        <div className="mods-detail-title-row">
          <div>
            <h1>{mod.name}</h1>
            <p className="mods-detail-subtitle">por {mod.submitted_by?.username} · v{mod.modfile?.version || '?'}</p>
          </div>
        </div>
      </div>

      <div className="mods-detail-actions">
        <button type="button" className={`mods-action-btn ${isFavorited ? 'active' : ''}`} disabled={busyFavorite} onClick={doFavorite}>
          {isFavorited ? '★ Favoritado' : '☆ Favoritar'}
        </button>
        <button type="button" className={`mods-action-btn ${isUpped ? 'active' : ''}`} disabled={busyUp} onClick={doUp}>
          👍 Up {mod.stats?.ratings_positive ? `(${formatCount(mod.stats.ratings_positive)})` : ''}
        </button>
        <button type="button" className="mods-action-btn mods-action-btn-danger" onClick={() => setReportOpen((v) => !v)}>🚩 Denunciar</button>

        <div className="mods-detail-stats dim">
          <span>⬇ {formatCount(mod.stats?.downloads_total)} downloads</span>
          <span>Atualizado em {mod.date_updated ? new Date(mod.date_updated * 1000).toLocaleDateString('pt-BR') : '—'}</span>
        </div>

        <div className="mods-detail-install">
          {!desktopReady ? (
            <p className="dim">Instalar mods só funciona pelo app de desktop do Project Club.</p>
          ) : installBusy && installProgress ? (
            <div className="mods-install-progress">
              <div className="mods-install-progress-label">
                {installProgress.phase === 'downloading' ? `Baixando... ${installProgress.percent}%` : installProgress.phase === 'extracting' ? 'Extraindo arquivos...' : installProgress.phase === 'installing' ? 'Instalando...' : 'Concluído!'}
              </div>
              <div className="mods-install-progress-bar"><div style={{ width: `${installProgress.percent}%` }} /></div>
            </div>
          ) : installed ? (
            <button type="button" className="btn-danger-outline" onClick={doInstall}>🔄 Reinstalar / atualizar</button>
          ) : (
            <button type="button" className="btn-primary" onClick={doInstall}>⬇ Instalar</button>
          )}
          {installError && <p className="mods-install-error">Não foi possível instalar este mod: {installError}</p>}
        </div>
      </div>

      {reportOpen && (
        <div className="mods-report-box">
          <textarea placeholder="Descreva o motivo da denúncia..." value={reportReason} onChange={(e) => setReportReason(e.target.value)} />
          <button type="button" className="btn-danger" onClick={doReport}>Enviar denúncia</button>
        </div>
      )}

      {dependencies?.length > 0 && (
        <div className="mods-dependencies">
          <h3>«Este mod possui {dependencies.length} {dependencies.length === 1 ? 'dependência obrigatória' : 'dependências obrigatórias'}.»</h3>
          <ul>{dependencies.map((d) => <li key={d.mod_id}>{d.name || `Mod #${d.mod_id}`}</li>)}</ul>
        </div>
      )}

      <div className="mods-detail-body">
        {mod.summary && <p className="mods-detail-description">{mod.summary}</p>}
        {mod.tags?.length > 0 && (
          <div className="mods-detail-tags">{mod.tags.map((t) => <span key={t.name} className="mods-tag-chip">{t.name}</span>)}</div>
        )}
      </div>

      {mod.media?.images?.length > 0 && (
        <div className="mods-detail-screenshots">
          <h3>Screenshots</h3>
          <div className="mods-detail-screenshots-grid">
            {mod.media.images.map((img) => (
              <a key={img.filename} href={proxyImage(img.original)} target="_blank" rel="noreferrer" className="mods-detail-screenshot-thumb">
                <img src={proxyImage(img.thumb_320x180)} alt="" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mods-comments">
        <h3>Comentários</h3>
        <div className="mods-comment-form">
          <textarea placeholder="Escreva um comentário..." value={commentText} onChange={(e) => setCommentText(e.target.value)} />
          <button type="button" className="btn-primary" onClick={doComment}>Comentar</button>
        </div>
        {comments === null ? <p className="dim">Carregando comentários...</p> : comments.length === 0 ? (
          <p className="dim">Nenhum comentário ainda.</p>
        ) : (
          <div className="mods-comment-list">
            {comments.map((c) => (
              <div key={c.id} className="mods-comment-item">
                <strong>{c.user?.displayName}</strong> <span className="dim">@{c.user?.username}</span>
                <p>{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
