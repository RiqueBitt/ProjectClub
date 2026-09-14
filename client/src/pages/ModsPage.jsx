import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  matchSteamGames, getModioGameTags, listMods, getMod, getModDownload,
  toggleModFavorite, toggleModUp, listModComments, addModComment, reportMod,
  listModProfiles, createModProfile, deleteModProfile, upsertModProfileItem, removeModProfileItem,
  listModCollections, createModCollection, deleteModCollection, addModCollectionItem,
  matchWorkshopGames, listWorkshopItems,
  matchGameBananaGames, browseGameBanana, getGameBananaMod,
} from '../api/endpoints';
import {
  isDesktopModsAvailable, detectSteamGames, installModLocally, listInstalledModsLocally, onModsProgress,
  setModEnabledLocally, applyProfileLocally, listInstalledWorkshopItemsLocally, openWorkshopItemInSteam,
  openModsFolder, pickLocalModFile, installLocalModFile, listModConfigFiles, readModConfigFile, writeModConfigFile, steamCoverUrl,
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
  const [view, setView] = useState('home'); // 'home' | 'hub' | 'game' | 'mod'
  const [mergedGame, setMergedGame] = useState(null); // { steamAppId, displayName, iconUrl, installPath, sources: { modio?, workshop?, gamebanana? } }
  const [selectedGame, setSelectedGame] = useState(null); // objeto já resolvido pra UMA fonte específica
  const [selectedModId, setSelectedModId] = useState(null);

  // Item pedido: "funda o Workshop e o GameBanana na mesma aba de
  // download de mods de jogo pra não ter esse tipo de game repetido"
  // — quando um jogo tem só UMA fonte (o caso mais comum), abre direto
  // nela; quando tem mais de uma (ex: Terraria no Workshop via
  // tModLoader E no GameBanana), abre um seletor pequeno primeiro (ver
  // GameHubView) em vez de mostrar dois cartões pro mesmo jogo em
  // "Meus jogos".
  const openGame = (merged) => {
    const sourceKeys = Object.keys(merged.sources);
    if (sourceKeys.length === 1) {
      openSource(merged, sourceKeys[0]);
    } else {
      setMergedGame(merged);
      setView('hub');
    }
  };
  const openSource = (merged, sourceKey) => {
    setMergedGame(merged);
    setSelectedGame({ ...merged.sources[sourceKey], source: sourceKey, installPath: merged.installPath, displayName: merged.displayName, iconUrl: merged.iconUrl, steamAppId: merged.steamAppId });
    setView('game');
  };
  const openMod = (modId) => { setSelectedModId(modId); setView('mod'); };
  const backToGame = () => setView('game');
  // Volta pro seletor de fontes se o jogo tiver mais de uma; senão,
  // direto pra "Meus jogos".
  const backToHubOrHome = () => {
    if (mergedGame && Object.keys(mergedGame.sources).length > 1) { setView('hub'); return; }
    setView('home'); setSelectedGame(null); setMergedGame(null);
  };
  const backToHome = () => { setView('home'); setSelectedGame(null); setMergedGame(null); };

  if (view === 'mod' && selectedGame) {
    return <ModDetailView game={selectedGame} modioModId={selectedModId} onBack={backToGame} />;
  }
  if (view === 'game' && selectedGame?.source === 'workshop') {
    return <WorkshopGameView game={selectedGame} onBack={backToHubOrHome} />;
  }
  if (view === 'game' && selectedGame?.source === 'gamebanana') {
    return <GameBananaGameView game={selectedGame} onBack={backToHubOrHome} />;
  }
  if (view === 'game' && selectedGame) {
    return <GameModsView game={selectedGame} onBack={backToHubOrHome} onOpenMod={openMod} />;
  }
  if (view === 'hub' && mergedGame) {
    return <GameHubView merged={mergedGame} onBack={backToHome} onOpenSource={(key) => openSource(mergedGame, key)} />;
  }
  return <ModsHome onBack={() => navigate('/jogos')} onOpenGame={openGame} />;
}

// Item pedido: "funda o Workshop e o GameBanana na mesma aba... pra
// não ter esse tipo de game repetido" — tela pequena com um botão por
// fonte disponível, só aparece quando o jogo tem mais de uma.
function GameHubView({ merged, onBack, onOpenSource }) {
  const coverUrl = merged.iconUrl ? proxyImage(merged.iconUrl) : steamCoverUrl(merged.steamAppId);
  const SOURCE_META = {
    modio: { icon: '🧩', label: 'mod.io' },
    workshop: { icon: '🚂', label: 'Steam Workshop' },
    gamebanana: { icon: '🍌', label: 'GameBanana' },
  };
  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Meus jogos</button>
      <div className="mods-game-header">
        <div className="mods-game-header-icon">
          <img src={coverUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div>
          <h1>{merged.displayName}</h1>
          <p className="dim">Esse jogo tem mods em mais de um lugar — escolha onde ver.</p>
        </div>
      </div>
      <div className="mods-hub-sources">
        {Object.keys(merged.sources).map((key) => (
          <button key={key} type="button" className="mods-hub-source-btn" onClick={() => onOpenSource(key)}>
            <span className="mods-hub-source-icon">{SOURCE_META[key]?.icon}</span>
            <span>{SOURCE_META[key]?.label}</span>
            <span className="mods-hub-source-arrow">›</span>
          </button>
        ))}
      </div>
    </div>
  );
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
        // sobe pro servidor, pra cruzar com os catálogos de suporte
        // (mod.io e Steam Workshop, os dois staff-editáveis).
        const detection = await detectSteamGames();
        setSteamFound(detection.steamFound);
        if (detection.steamFound && detection.games.length > 0) {
          const appIds = detection.games.map((g) => g.steamAppId);
          const [{ games: modioSupported }, { games: workshopSupported }, { games: gamebananaSupported }] = await Promise.all([
            matchSteamGames(appIds),
            matchWorkshopGames(appIds).catch(() => ({ games: [] })),
            matchGameBananaGames(appIds).catch(() => ({ games: [] })),
          ]);
          const byInstall = new Map(detection.games.map((g) => [g.steamAppId, g.installPath]));

          // Item pedido: "funda o Workshop e o GameBanana na mesma
          // aba de download de mods de jogo pra não ter esse tipo de
          // game repetido" — junta tudo num Map por steamAppId em vez
          // de três listas separadas, então um jogo com suporte em
          // mais de uma fonte (ex: Terraria no Workshop via tModLoader
          // E no GameBanana, mesmo steamAppId 105600 nos dois) vira UM
          // cartão só em "Meus jogos", não repetido.
          const merged = new Map();
          const addSource = (list, sourceKey) => {
            for (const s of list) {
              if (!merged.has(s.steamAppId)) {
                merged.set(s.steamAppId, { steamAppId: s.steamAppId, displayName: s.displayName, iconUrl: s.iconUrl, installPath: byInstall.get(s.steamAppId), sources: {} });
              }
              const entry = merged.get(s.steamAppId);
              if (!entry.iconUrl && s.iconUrl) entry.iconUrl = s.iconUrl;
              entry.sources[sourceKey] = s;
            }
          };
          addSource(modioSupported, 'modio');
          addSource(workshopSupported, 'workshop');
          addSource(gamebananaSupported, 'gamebanana');
          setGames(Array.from(merged.values()));
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
  const coverUrl = game.iconUrl ? proxyImage(game.iconUrl) : steamCoverUrl(game.steamAppId);
  const sourceCount = Object.keys(game.sources).length;
  const sourceLabel = sourceCount > 1
    ? `${sourceCount} fontes`
    : { modio: 'mod.io', workshop: 'Steam Workshop', gamebanana: 'GameBanana' }[Object.keys(game.sources)[0]];
  return (
    <button type="button" className="mods-game-card" onClick={onClick}>
      <div className="mods-game-card-icon">
        <img src={coverUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }} />
        <span className="mods-game-card-icon-fallback">🎮</span>
      </div>
      <span className="mods-game-card-name">{game.displayName}</span>
      <span className="mods-game-card-source dim">{sourceLabel}</span>
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
  const { user } = useAuth();
  const desktopReady = isDesktopModsAvailable();
  const [tab, setTab] = useState('mods'); // 'mods' | 'mine' | 'collections'
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState([]);
  const [mods, setMods] = useState(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [installedState, setInstalledState] = useState({ enabled: [], disabled: [] });
  const [localInstallBusy, setLocalInstallBusy] = useState(false);
  const [localInstallError, setLocalInstallError] = useState('');
  const [configFiles, setConfigFiles] = useState([]);
  const [selectedConfigFile, setSelectedConfigFile] = useState(null);
  const [configContent, setConfigContent] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState('');
  const [profiles, setProfiles] = useState(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [activatingProfileId, setActivatingProfileId] = useState(null);
  const [activateMessage, setActivateMessage] = useState('');
  const [collections, setCollections] = useState(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [installingCollectionId, setInstallingCollectionId] = useState(null);
  const [collectionMessage, setCollectionMessage] = useState('');

  useEffect(() => {
    if (tab === 'collections') listModCollections(game.modioGameId).then((d) => setCollections(d.collections));
  }, [tab, game.modioGameId]);

  const doCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    await createModCollection(game.modioGameId, { name });
    setNewCollectionName('');
    listModCollections(game.modioGameId).then((d) => setCollections(d.collections));
  };

  const doDeleteCollection = async (collection) => {
    if (!confirm(`Apagar a coleção "${collection.name}"? Isso não desinstala mods de ninguém, só remove o compartilhamento.`)) return;
    await deleteModCollection(collection.id);
    listModCollections(game.modioGameId).then((d) => setCollections(d.collections));
  };

  // Item pedido 19: "outro usuário poderá clicar Instalar coleção... o
  // Project Club deve verificar dependências e conflitos antes de
  // instalar." MVP: instala cada mod da coleção em sequência (mesmo
  // download+instalação de sempre). Verificação automática de
  // DEPENDÊNCIA e CONFLITO entre os mods da coleção ainda não roda
  // sozinha aqui — se um mod precisar de outro, a pessoa ainda instala
  // a dependência manualmente na página dele (ver roadmap no topo do
  // arquivo).
  const doInstallCollection = async (collection) => {
    if (!game.installPath) { setCollectionMessage('Não sabemos onde este jogo está instalado.'); return; }
    setInstallingCollectionId(collection.id);
    setCollectionMessage('');
    try {
      for (const item of collection.items) {
        setCollectionMessage(`Instalando ${item.modName || `mod #${item.modioModId}`}...`);
        const modDetail = await getMod(game.modioGameId, item.modioModId);
        const download = await getModDownload(game.modioGameId, item.modioModId);
        const result = await installModLocally({
          downloadUrl: download.downloadUrl,
          filename: download.filename,
          gameInstallPath: game.installPath,
          modName: modDetail.mod.name,
          modioModId: item.modioModId,
        });
        if (!result.success) throw new Error(`${modDetail.mod.name}: ${result.error || 'falha desconhecida'}`);
      }
      setCollectionMessage(`Coleção "${collection.name}" instalada.`);
      refreshInstalled();
    } catch (err) {
      setCollectionMessage(`Erro ao instalar a coleção: ${err.message}`);
    } finally {
      setInstallingCollectionId(null);
    }
  };

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
    setLoadError('');
    const timeout = setTimeout(() => {
      listMods(game.modioGameId, { q: query || undefined, sort, category: category || undefined, offset: 0 })
        .then((d) => { setMods(d.mods); setResultTotal(d.resultTotal); })
        .catch((err) => { setMods([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar mods agora.'); });
    }, 250); // pequeno debounce pra não disparar uma busca a cada tecla
    return () => clearTimeout(timeout);
  }, [game.modioGameId, query, sort, category]);

  // Item pedido: "adicione páginas em cada jogo para poder ver mais" —
  // "carregar mais" no final da grade em vez de páginas numeradas
  // (mais natural pra rolagem contínua, mesmo padrão que o resto do
  // app já usa em listas longas).
  const loadMoreMods = async () => {
    setLoadingMore(true);
    try {
      const d = await listMods(game.modioGameId, { q: query || undefined, sort, category: category || undefined, offset: mods.length });
      setMods((prev) => [...prev, ...d.mods]);
      setResultTotal(d.resultTotal);
    } catch {
      setLoadError('Não foi possível carregar mais mods agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  const refreshInstalled = () => {
    if (!desktopReady || !game.installPath) return;
    listInstalledModsLocally(game.installPath).then((d) => setInstalledState({ enabled: d.enabled || [], disabled: d.disabled || [] }));
  };
  const refreshProfiles = () => listModProfiles(game.modioGameId).then((d) => setProfiles(d.profiles));

  useEffect(() => {
    if (tab !== 'mine') return;
    refreshInstalled();
    refreshProfiles();
    refreshConfigFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, game.installPath, game.modioGameId]);

  const toggleInstalledMod = async (name, currentlyEnabled) => {
    await setModEnabledLocally({ gameInstallPath: game.installPath, modName: name, enabled: !currentlyEnabled });
    refreshInstalled();
  };

  // Item pedido: "abrir a pasta" — mesma pasta que a instalação
  // automática já usa (BepInEx/plugins ou Mods, dependendo do jogo).
  const doOpenFolder = () => openModsFolder(game.installPath);

  // Item pedido: "adicionar mods de um arquivo local".
  const doInstallLocalFile = async () => {
    const picked = await pickLocalModFile();
    if (!picked.success) return;
    setLocalInstallError('');
    setLocalInstallBusy(true);
    try {
      const modName = picked.name.replace(/\.(zip|dll)$/i, '');
      const result = await installLocalModFile({ filePath: picked.path, gameInstallPath: game.installPath, modName });
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
      refreshInstalled();
    } catch (err) {
      setLocalInstallError(err.message);
    } finally {
      setLocalInstallBusy(false);
    }
  };

  // Item pedido: "poder configurar mods" — lista/abre/edita os .cfg de
  // BepInEx/config como texto puro (ver roadmap em modsManager.js).
  const refreshConfigFiles = () => {
    listModConfigFiles(game.installPath).then((d) => setConfigFiles(d.files || []));
  };
  const openConfigFile = async (filename) => {
    setSelectedConfigFile(filename);
    setConfigMessage('');
    const d = await readModConfigFile(game.installPath, filename);
    setConfigContent(d.success ? d.content : '');
    if (!d.success) setConfigMessage(`Não foi possível abrir: ${d.error}`);
  };
  const saveConfigFile = async () => {
    setConfigSaving(true);
    try {
      const d = await writeModConfigFile(game.installPath, selectedConfigFile, configContent);
      setConfigMessage(d.success ? 'Salvo!' : `Erro ao salvar: ${d.error}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const doCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    await createModProfile(game.modioGameId, name);
    setNewProfileName('');
    refreshProfiles();
  };

  const doDeleteProfile = async (profile) => {
    if (!confirm(`Apagar o perfil "${profile.name}"? Isso não desinstala nenhum mod, só o agrupamento.`)) return;
    await deleteModProfile(profile.id);
    refreshProfiles();
  };

  // Item pedido 15/28: "trocar de perfil rapidamente" + "▶ Jogar" —
  // reconcilia o disco (ver modsManager.applyProfileMods) pra deixar
  // ativos exatamente os mods marcados como enabled neste perfil, e só
  // depois, se pedido, abre o jogo via protocolo steam:// (não mexe em
  // nenhuma configuração da Steam, só pede pra ELA abrir o jogo —
  // item pedido 28: "não alterar configurações da Steam de maneira
  // destrutiva").
  const activateProfile = async (profile, alsoPlay) => {
    if (!game.installPath) { setActivateMessage('Não sabemos onde este jogo está instalado.'); return; }
    setActivatingProfileId(profile.id);
    setActivateMessage('');
    try {
      const enabledModNames = profile.items.filter((i) => i.enabled && i.modName).map((i) => i.modName);
      const result = await applyProfileLocally({ gameInstallPath: game.installPath, enabledModNames });
      refreshInstalled();
      if (result.missing?.length) {
        setActivateMessage(`Perfil ativado, mas ${result.missing.length} mod(s) dele ainda não foram instalados neste computador.`);
      } else {
        setActivateMessage(`Perfil "${profile.name}" ativado.`);
      }
      if (alsoPlay && game.steamAppId) {
        window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`);
      }
    } finally {
      setActivatingProfileId(null);
    }
  };

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Meus jogos</button>

      <div className="mods-game-header" style={game.iconUrl ? undefined : undefined}>
        <div className="mods-game-header-icon">{game.iconUrl ? <img src={proxyImage(game.iconUrl)} alt="" /> : '🎮'}</div>
        <div>
          <h1>{game.displayName}</h1>
          <p className="dim">{resultTotal} {resultTotal === 1 ? 'mod disponível' : 'mods disponíveis'}</p>
        </div>
        {desktopReady && game.steamAppId && (
          <button type="button" className="btn-play mods-play-btn" onClick={() => window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`)}>▶ Jogar</button>
        )}
      </div>

      <div className="mods-tabs">
        <button type="button" className={`mods-tab ${tab === 'mods' ? 'active' : ''}`} onClick={() => setTab('mods')}>Mods</button>
        <button type="button" className={`mods-tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>Meus mods · Perfis</button>
        <button type="button" className={`mods-tab ${tab === 'collections' ? 'active' : ''}`} onClick={() => setTab('collections')}>Coleções</button>
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
              <span className="mods-empty-icon">{loadError ? '⚠️' : '🔍'}</span>
              <h3>{loadError ? 'Não foi possível buscar' : 'Nenhum mod encontrado'}</h3>
              <p>{loadError || 'Tente outra busca ou outro filtro.'}</p>
            </div>
          ) : (
            <>
              <div className="mods-grid">
                {mods.map((m) => <ModCard key={m.id} mod={m} onClick={() => onOpenMod(m.id)} />)}
              </div>
              {mods.length < resultTotal && (
                <button type="button" className="mods-load-more" disabled={loadingMore} onClick={loadMoreMods}>
                  {loadingMore ? 'Carregando...' : `Ver mais (${mods.length} de ${resultTotal})`}
                </button>
              )}
            </>
          )}
        </>
      )}

      {tab === 'mine' && (
        !desktopReady ? (
          <div className="mods-empty-state">
            <span className="mods-empty-icon">🖥️</span>
            <h3>Isso precisa do app de desktop</h3>
            <p>Gerenciar mods instalados e perfis só funciona pelo app de desktop do Project Club.</p>
          </div>
        ) : !game.installPath ? (
          <div className="mods-empty-state">
            <span className="mods-empty-icon">📁</span>
            <h3>Pasta do jogo não detectada</h3>
            <p>Não conseguimos confirmar a pasta de instalação — abra o jogo pela Steam pra ela ser detectada de novo.</p>
          </div>
        ) : (
          <>
            <h2 className="mods-section-title" style={{ marginTop: 0 }}>Perfis</h2>
            <p className="dim" style={{ marginBottom: 12 }}>
              Um perfil é um conjunto de mods que você liga de uma vez. Adicione mods a um perfil pela página de cada
              mod ("Adicionar a um perfil"), depois ative o perfil aqui — ele desativa (sem desinstalar) qualquer
              outro mod que não faça parte dele.
            </p>
            <div className="mods-profile-create">
              <input placeholder="Nome do novo perfil (ex: Terror, Vanilla...)" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
              <button type="button" className="btn-primary" onClick={doCreateProfile}>Criar perfil</button>
            </div>
            {activateMessage && <p className="dim" style={{ marginBottom: 12 }}>{activateMessage}</p>}
            {profiles === null ? <p className="dim">Carregando perfis...</p> : profiles.length === 0 ? (
              <p className="dim" style={{ marginBottom: 20 }}>Nenhum perfil criado ainda.</p>
            ) : (
              <div className="mods-profile-list">
                {profiles.map((p) => (
                  <div key={p.id} className="mods-profile-card">
                    <div className="mods-profile-card-header">
                      <strong>{p.name}</strong>
                      <span className="dim">{p.items.filter((i) => i.enabled).length} mods ativos</span>
                    </div>
                    {p.items.length > 0 && (
                      <div className="mods-profile-card-items dim">{p.items.map((i) => i.modName || `Mod #${i.modioModId}`).join(', ')}</div>
                    )}
                    <div className="mods-profile-card-actions">
                      <button type="button" className="btn-primary" disabled={activatingProfileId === p.id} onClick={() => activateProfile(p, false)}>
                        {activatingProfileId === p.id ? 'Ativando...' : 'Ativar este perfil'}
                      </button>
                      <button type="button" className="btn-play" disabled={activatingProfileId === p.id} onClick={() => activateProfile(p, true)}>▶ Jogar com este perfil</button>
                      <button type="button" className="btn-link" style={{ color: 'var(--red)' }} onClick={() => doDeleteProfile(p)}>Apagar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mods-section-header-row">
              <h2 className="mods-section-title" style={{ margin: 0 }}>Mods instalados agora</h2>
              <div className="mods-section-header-actions">
                <button type="button" className="btn-link" onClick={doOpenFolder}>📂 Abrir pasta</button>
                <button type="button" className="btn-link" disabled={localInstallBusy} onClick={doInstallLocalFile}>
                  {localInstallBusy ? 'Instalando...' : '➕ Instalar de um arquivo local'}
                </button>
              </div>
            </div>
            {localInstallError && <p className="mods-install-error">{localInstallError}</p>}
            {installedState.enabled.length === 0 && installedState.disabled.length === 0 ? (
              <p className="dim">Nenhum mod instalado ainda. Instale um mod na aba "Mods" acima, ou de um arquivo local pelo botão ao lado.</p>
            ) : (
              <div className="mods-installed-list">
                {installedState.enabled.map((name) => (
                  <div key={name} className="mods-installed-item">
                    <span>🧩 {name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mods-installed-tag">✓ Ativado</span>
                      <button type="button" className="btn-link" onClick={() => toggleInstalledMod(name, true)}>Desativar</button>
                    </div>
                  </div>
                ))}
                {installedState.disabled.map((name) => (
                  <div key={name} className="mods-installed-item mods-installed-item-disabled">
                    <span>🧩 {name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="dim">Desativado</span>
                      <button type="button" className="btn-link" onClick={() => toggleInstalledMod(name, false)}>Ativar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {configFiles.length > 0 && (
              <>
                <h2 className="mods-section-title">Configurar mods</h2>
                <p className="dim" style={{ marginBottom: 12 }}>
                  Edição em texto puro dos arquivos de configuração de cada mod — exatamente como eles são salvos no
                  disco, sem tentar adivinhar um formulário pra cada mod diferente.
                </p>
                <div className="mods-config-layout">
                  <div className="mods-config-file-list">
                    {configFiles.map((f) => (
                      <button key={f} type="button" className={`mods-config-file-item ${selectedConfigFile === f ? 'active' : ''}`} onClick={() => openConfigFile(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                  {selectedConfigFile && (
                    <div className="mods-config-editor">
                      <textarea value={configContent} onChange={(e) => setConfigContent(e.target.value)} spellCheck={false} />
                      <div className="mods-config-editor-actions">
                        <button type="button" className="btn-primary" disabled={configSaving} onClick={saveConfigFile}>
                          {configSaving ? 'Salvando...' : 'Salvar'}
                        </button>
                        {configMessage && <span className="dim">{configMessage}</span>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )
      )}

      {tab === 'collections' && (
        <>
          <p className="dim" style={{ marginBottom: 12 }}>
            Coleções são públicas — qualquer pessoa com este jogo pode ver e instalar a sua. Monte uma coleção
            adicionando mods pela página de cada mod ("Adicionar a uma coleção").
          </p>
          <div className="mods-profile-create">
            <input placeholder="Nome da nova coleção (ex: Modpack de Terror...)" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} />
            <button type="button" className="btn-primary" onClick={doCreateCollection}>Criar coleção</button>
          </div>
          {collectionMessage && <p className="dim" style={{ marginBottom: 12 }}>{collectionMessage}</p>}
          {collections === null ? <p className="dim">Carregando coleções...</p> : collections.length === 0 ? (
            <p className="dim">Nenhuma coleção criada ainda pra este jogo.</p>
          ) : (
            <div className="mods-profile-list">
              {collections.map((c) => (
                <div key={c.id} className="mods-profile-card">
                  <div className="mods-profile-card-header">
                    <strong>{c.name}</strong>
                    <span className="dim">{c.items.length} mods · por {c.author?.displayName}</span>
                  </div>
                  {c.items.length > 0 && (
                    <div className="mods-profile-card-items dim">{c.items.map((i) => i.modName || `Mod #${i.modioModId}`).join(', ')}</div>
                  )}
                  <div className="mods-profile-card-actions">
                    {desktopReady && (
                      <button type="button" className="btn-primary" disabled={installingCollectionId === c.id || c.items.length === 0} onClick={() => doInstallCollection(c)}>
                        {installingCollectionId === c.id ? 'Instalando...' : '⬇ Instalar coleção'}
                      </button>
                    )}
                    {c.author?.id === user.id && (
                      <button type="button" className="btn-link" style={{ color: 'var(--red)' }} onClick={() => doDeleteCollection(c)}>Apagar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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

// ---------- Tela do jogo (Steam Workshop) ----------
// Bem mais simples que GameModsView (mod.io): não existe download/
// instalação nossa aqui — a própria Steam cuida disso quando a pessoa
// clica "Inscrever-se" (abre o item dentro do cliente da Steam via
// steam://). Por isso também não tem perfis, coleções, favoritos ou
// comentários pro Workshop nesta fase — a página do item já tem tudo
// isso nativo da própria Steam; só linkamos pra lá.
const WORKSHOP_SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais inscrições' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

function WorkshopGameView({ game, onBack }) {
  const desktopReady = isDesktopModsAvailable();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [installedIds, setInstalledIds] = useState([]);

  useEffect(() => {
    setItems(null);
    setLoadError('');
    const timeout = setTimeout(() => {
      listWorkshopItems(game.workshopAppId, { q: query || undefined, sort })
        .then((d) => { setItems(d.items); setTotal(d.total); setNextCursor(d.nextCursor); })
        .catch((err) => { setItems([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar no Steam Workshop agora.'); });
    }, 250);
    return () => clearTimeout(timeout);
  }, [game.workshopAppId, query, sort]);

  // Item pedido: "adicione páginas em cada jogo para poder ver mais" —
  // a API da Valve pagina por "cursor" (não por número de página), a
  // gente só guarda o cursor que ela devolveu e manda de volta pra
  // pedir a próxima leva.
  const loadMoreItems = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const d = await listWorkshopItems(game.workshopAppId, { q: query || undefined, sort, cursor: nextCursor });
      setItems((prev) => [...prev, ...d.items]);
      setNextCursor(d.nextCursor);
    } catch {
      setLoadError('Não foi possível carregar mais itens agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!desktopReady || !game.installPath) return;
    listInstalledWorkshopItemsLocally(game.installPath, game.workshopAppId).then((d) => setInstalledIds(d.items || []));
  }, [desktopReady, game.installPath, game.workshopAppId]);

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Meus jogos</button>

      <div className="mods-game-header">
        <div className="mods-game-header-icon">{game.iconUrl ? <img src={proxyImage(game.iconUrl)} alt="" /> : '🎮'}</div>
        <div>
          <h1>{game.displayName}</h1>
          <p className="dim">{total} {total === 1 ? 'item no Steam Workshop' : 'itens no Steam Workshop'}</p>
        </div>
        {desktopReady && game.steamAppId && (
          <button type="button" className="btn-play mods-play-btn" onClick={() => window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`)}>▶ Jogar</button>
        )}
      </div>

      {game.note && <p className="dim mods-workshop-note">ℹ️ {game.note}</p>}
      {!desktopReady && (
        <p className="dim mods-workshop-note">Ver o que já está inscrito precisa do app de desktop — buscar e abrir itens no Steam funciona por aqui mesmo assim.</p>
      )}

      <div className="mods-filters">
        <input className="mods-search-bar" placeholder="Pesquisar no Workshop..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="mods-filter-chips">
          {WORKSHOP_SORT_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={`mods-chip ${sort === o.value ? 'active' : ''}`} onClick={() => setSort(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="mods-loading">Buscando no Workshop...</div>
      ) : items.length === 0 ? (
        <div className="mods-empty-state">
          <span className="mods-empty-icon">{loadError ? '⚠️' : '🔍'}</span>
          <h3>{loadError ? 'Não foi possível buscar' : 'Nenhum item encontrado'}</h3>
          <p>{loadError || 'Tente outra busca ou outro filtro.'}</p>
        </div>
      ) : (
        <>
          <div className="mods-grid">
            {items.map((item) => (
              <WorkshopItemCard key={item.publishedfileid} item={item} installed={installedIds.includes(item.publishedfileid)} />
            ))}
          </div>
          {nextCursor && (
            <button type="button" className="mods-load-more" disabled={loadingMore} onClick={loadMoreItems}>
              {loadingMore ? 'Carregando...' : `Ver mais (${items.length} de ${total})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function WorkshopItemCard({ item, installed }) {
  const preview = item.preview_url;
  return (
    <div className="mods-mod-card mods-workshop-card">
      <div className="mods-mod-card-thumb" style={preview ? { backgroundImage: `url(${proxyImage(preview)})` } : undefined}>
        {!preview && <span>🧩</span>}
      </div>
      <div className="mods-mod-card-body">
        <span className="mods-mod-card-name">{item.title}</span>
        <span className="mods-mod-card-author dim">{item.short_description}</span>
        <div className="mods-mod-card-stats dim">
          <span>👥 {formatCount(item.subscriptions)}</span>
          {item.vote_data?.votes_up > 0 && <span>👍 {formatCount(item.vote_data.votes_up)}</span>}
        </div>
        <div className="mods-workshop-card-actions">
          {installed && <span className="mods-installed-tag">✓ Inscrito</span>}
          <button type="button" className="btn-primary" onClick={() => openWorkshopItemInSteam(item.publishedfileid)}>
            {installed ? 'Ver na Steam' : 'Inscrever-se'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Tela do jogo (GameBanana) ----------
// Item pedido: "GameBanana... sem precisar de login". API semi-oficial,
// sem chave nenhuma. Diferente do mod.io/Workshop, mods do GameBanana
// não têm uma convenção única de instalação (varia MUITO de jogo pra
// jogo — item pedido 26: "não criar uma regra universal") — em vez de
// arriscar colocar arquivo no lugar errado, o botão de baixar abre o
// link direto do arquivo (a própria GameBanana serve o download), a
// pessoa extrai/instala seguindo as instruções da própria página do
// mod — que a gente já linka.
const GAMEBANANA_SORT_OPTIONS = [
  { value: 'default', label: 'Em destaque' },
  { value: 'new', label: 'Novos' },
];

// BUG CORRIGIDO ("o banner/thumbnail dos mods do GameBanana bugando"):
// era feito com CSS background-image, que não tem como detectar uma
// URL quebrada — se o nome do campo de imagem viesse errado (API
// semi-oficial, ver aviso no backend), a pessoa via uma caixa cinza
// vazia sem explicação. Agora é uma <img> de verdade com onError, que
// esconde a imagem e mostra o 🧩 de reserva assim que ela falha.
function GameBananaThumb({ url }) {
  const [failed, setFailed] = useState(!url);
  return (
    <div className="mods-mod-card-thumb">
      {!failed && <img src={proxyImage(url)} alt="" onError={() => setFailed(true)} />}
      {failed && <span>🧩</span>}
    </div>
  );
}

function GameBananaGameView({ game, onBack }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedModId, setSelectedModId] = useState(null);

  useEffect(() => {
    setItems(null);
    setLoadError('');
    setPage(1);
    const timeout = setTimeout(() => {
      browseGameBanana(game.gameBananaGameId, { q: query || undefined, sort, page: 1 })
        .then((d) => { setItems(d.items); setHasMore(!!d.hasMore); })
        .catch((err) => { setItems([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar no GameBanana agora.'); });
    }, 250);
    return () => clearTimeout(timeout);
  }, [game.gameBananaGameId, query, sort]);

  // Item pedido: "adicione páginas em cada jogo para poder ver mais".
  const loadMoreItems = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const d = await browseGameBanana(game.gameBananaGameId, { q: query || undefined, sort, page: nextPage });
      setItems((prev) => [...prev, ...d.items]);
      setHasMore(!!d.hasMore);
      setPage(nextPage);
    } catch {
      setLoadError('Não foi possível carregar mais itens agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (selectedModId) {
    return <GameBananaDetailView modId={selectedModId} onBack={() => setSelectedModId(null)} />;
  }

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar para Meus jogos</button>

      <div className="mods-game-header">
        <div className="mods-game-header-icon">{game.iconUrl ? <img src={proxyImage(game.iconUrl)} alt="" /> : '🎮'}</div>
        <div><h1>{game.displayName}</h1><p className="dim">GameBanana</p></div>
      </div>

      <div className="mods-filters">
        <input className="mods-search-bar" placeholder="Pesquisar no GameBanana..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="mods-filter-chips">
          {GAMEBANANA_SORT_OPTIONS.map((o) => (
            <button key={o.value} type="button" className={`mods-chip ${sort === o.value ? 'active' : ''}`} onClick={() => setSort(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="mods-loading">Buscando no GameBanana...</div>
      ) : items.length === 0 ? (
        <div className="mods-empty-state">
          <span className="mods-empty-icon">{loadError ? '⚠️' : '🔍'}</span>
          <h3>{loadError ? 'Não foi possível buscar' : 'Nenhum item encontrado'}</h3>
          <p>{loadError || 'Tente outra busca.'}</p>
        </div>
      ) : (
        <>
          <div className="mods-grid">
            {items.map((item) => (
              <button key={item.id} type="button" className="mods-mod-card" onClick={() => setSelectedModId(item.id)}>
                <GameBananaThumb url={item.thumbUrl} />
                <div className="mods-mod-card-body">
                  <span className="mods-mod-card-name">{item.name}</span>
                  {item.submitter && <span className="mods-mod-card-author dim">por {item.submitter}</span>}
                  <div className="mods-mod-card-stats dim">
                    {!!item.viewCount && <span>👁 {formatCount(item.viewCount)}</span>}
                    {!!item.likeCount && <span>❤ {formatCount(item.likeCount)}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {hasMore && (
            <button type="button" className="mods-load-more" disabled={loadingMore} onClick={loadMoreItems}>
              {loadingMore ? 'Carregando...' : 'Ver mais'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function GameBananaDetailView({ modId, onBack }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    getGameBananaMod(modId).then((d) => setData(d.mod)).catch(() => setData({ error: true }));
  }, [modId]);

  if (!data) return <div className="mods-page"><div className="mods-loading">Carregando mod...</div></div>;
  if (data.error) return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar</button>
      <div className="mods-empty-state"><span className="mods-empty-icon">⚠️</span><h3>Não foi possível carregar este mod</h3></div>
    </div>
  );

  return (
    <div className="mods-page">
      <button type="button" className="mods-back" onClick={onBack}>‹ Voltar</button>

      <div className="mods-detail-banner">
        {data.thumbUrl ? <img className="mods-detail-banner-img" src={proxyImage(data.thumbUrl)} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex'; }} /> : null}
        <span className="mods-detail-banner-fallback" style={data.thumbUrl ? { display: 'none' } : undefined}>🧩</span>
        <div className="mods-detail-banner-gradient" />
        <div className="mods-detail-title-row">
          <div>
            <h1>{data.name}</h1>
            {data.submitter && <p className="mods-detail-subtitle">por {data.submitter}</p>}
          </div>
        </div>
      </div>

      <div className="mods-detail-actions">
        <div className="mods-detail-stats dim">
          {!!data.viewCount && <span>👁 {formatCount(data.viewCount)} visualizações</span>}
          {!!data.likeCount && <span>❤ {formatCount(data.likeCount)}</span>}
        </div>
        <div className="mods-detail-install">
          {data.profileUrl && (
            <a href={data.profileUrl} target="_blank" rel="noreferrer" className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
              Ver no GameBanana
            </a>
          )}
          {data.files?.length > 0 && (
            <div className="mods-gamebanana-files">
              {data.files.map((f) => (
                <a key={f.id} href={f.downloadUrl} target="_blank" rel="noreferrer" className="mods-gamebanana-file-row">
                  <span>📦 {f.filename}</span>
                  <span className="dim">{f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(1)} MB` : ''} · Baixar ↓</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mods-detail-body">
        {data.description && <p className="mods-detail-description">{data.description}</p>}
        {data.categories?.length > 0 && (
          <div className="mods-detail-tags">{data.categories.map((c) => <span key={c} className="mods-tag-chip">{c}</span>)}</div>
        )}
      </div>

      {data.images?.length > 0 && (
        <div className="mods-detail-screenshots">
          <h3>Screenshots</h3>
          <div className="mods-detail-screenshots-grid">
            {data.images.map((img) => (
              <a key={img} href={proxyImage(img)} target="_blank" rel="noreferrer" className="mods-detail-screenshot-thumb">
                <img src={proxyImage(img)} alt="" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Página individual do mod ----------
function ModDetailView({ game, modioModId, onBack }) {
  const { user } = useAuth();
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
  const [depsBusy, setDepsBusy] = useState(false);
  const [depsError, setDepsError] = useState('');
  const [profiles, setProfiles] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [addToProfileMsg, setAddToProfileMsg] = useState('');
  const [collections, setCollections] = useState(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [addToCollectionMsg, setAddToCollectionMsg] = useState('');

  const refresh = () => {
    getMod(game.modioGameId, modioModId).then(setData).catch(() => setData({ error: true }));
    listModComments(modioModId).then((d) => setComments(d.comments)).catch(() => setComments([]));
  };
  useEffect(refresh, [game.modioGameId, modioModId]);

  useEffect(() => {
    if (!desktopReady || !game.installPath || !data?.mod) return;
    listInstalledModsLocally(game.installPath).then((d) => {
      const folder = String(data.mod.name).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
      setInstalled((d.enabled || []).includes(folder) || (d.disabled || []).includes(folder));
    });
  }, [desktopReady, game.installPath, data?.mod]);

  // Item pedido 15: "Adicionar a um perfil" — carrega os perfis do
  // usuário pra este jogo, só quando o app desktop está disponível
  // (perfis sem app desktop não têm como ser ativados de qualquer
  // forma, então não vale a pena mostrar o controle).
  useEffect(() => {
    if (!desktopReady) return;
    listModProfiles(game.modioGameId).then((d) => setProfiles(d.profiles)).catch(() => setProfiles([]));
  }, [desktopReady, game.modioGameId]);

  // Item pedido 19: "Adicionar a uma coleção" — só mostra as coleções
  // que a PRÓPRIA pessoa criou (só o autor pode adicionar item, ver
  // addCollectionItem no backend); funciona mesmo sem app desktop
  // (montar uma coleção é só metadado, instalar é que precisa do
  // desktop).
  useEffect(() => {
    listModCollections(game.modioGameId).then((d) => setCollections(d.collections.filter((c) => c.authorId === user.id))).catch(() => setCollections([]));
  }, [game.modioGameId, user.id]);

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

  // Item pedido 16: "quando um mod precisar de outros mods/frameworks...
  // botão Instalar dependências". Instala uma de cada vez (sequencial,
  // não em paralelo) — mais lento, mas mais fácil de mostrar progresso
  // e de identificar qual delas falhou, se falhar.
  const doInstallDependencies = async () => {
    if (!game.installPath) { setDepsError('Não sabemos onde este jogo está instalado.'); return; }
    setDepsBusy(true);
    setDepsError('');
    try {
      for (const dep of dependencies) {
        const depMod = await getMod(game.modioGameId, dep.mod_id);
        const download = await getModDownload(game.modioGameId, dep.mod_id);
        const result = await installModLocally({
          downloadUrl: download.downloadUrl,
          filename: download.filename,
          gameInstallPath: game.installPath,
          modName: depMod.mod.name,
          modioModId: dep.mod_id,
        });
        if (!result.success) throw new Error(`${depMod.mod.name}: ${result.error || 'falha desconhecida'}`);
      }
    } catch (err) {
      setDepsError(`Não foi possível instalar todas as dependências: ${err.message}`);
    } finally {
      setDepsBusy(false);
    }
  };

  // Item pedido 15: adiciona o mod atual ao perfil selecionado (upsert —
  // se já estiver lá, só atualiza a versão/estado).
  const doAddToProfile = async () => {
    if (!selectedProfileId) return;
    await upsertModProfileItem(selectedProfileId, {
      modioModId, modioModfileId: mod.modfile?.id, modName: mod.name, version: mod.modfile?.version, enabled: true,
    });
    setAddToProfileMsg('Adicionado ao perfil!');
    setTimeout(() => setAddToProfileMsg(''), 2500);
  };

  const doAddToCollection = async () => {
    if (!selectedCollectionId) return;
    await addModCollectionItem(selectedCollectionId, { modioModId, modName: mod.name });
    setAddToCollectionMsg('Adicionado à coleção!');
    setTimeout(() => setAddToCollectionMsg(''), 2500);
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

        {desktopReady && profiles && profiles.length > 0 && (
          <div className="mods-add-to-profile">
            <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
              <option value="">Adicionar a um perfil...</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="button" className="btn-link" disabled={!selectedProfileId} onClick={doAddToProfile}>Adicionar</button>
            {addToProfileMsg && <span className="dim">{addToProfileMsg}</span>}
          </div>
        )}
        {collections && collections.length > 0 && (
          <div className="mods-add-to-profile">
            <select value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)}>
              <option value="">Adicionar a uma coleção sua...</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" className="btn-link" disabled={!selectedCollectionId} onClick={doAddToCollection}>Adicionar</button>
            {addToCollectionMsg && <span className="dim">{addToCollectionMsg}</span>}
          </div>
        )}
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
          {desktopReady && (
            <button type="button" className="btn-primary" disabled={depsBusy} onClick={doInstallDependencies}>
              {depsBusy ? 'Instalando dependências...' : 'Instalar dependências'}
            </button>
          )}
          {depsError && <p className="mods-install-error">{depsError}</p>}
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
