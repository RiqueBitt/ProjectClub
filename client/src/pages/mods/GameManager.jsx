import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  getMod, getModDownload, getWorkshopItem,
  listModProfiles, createModProfile, deleteModProfile, removeModProfileItem,
  listModCollections, createModCollection, deleteModCollection,
} from '../../api/endpoints';
import {
  isDesktopModsAvailable, installModLocally, listInstalledModsLocally, onModsProgress,
  applyProfileLocally, listInstalledWorkshopItemsLocally, openWorkshopItemInSteam,
  openModsFolder, pickLocalModFile, installLocalModFile, listModConfigFiles, readModConfigFile, writeModConfigFile,
  steamCoverUrl, steamHeroUrl, saveModpackLocal, getModInstallProfileLocally,
} from '../../utils/mods';
import {
  Icon, GameCover, SourceChip, SOURCE_ORDER, EmptyState, SearchField, Section,
  ProgressBar, progressLabel, hashHue, ModsManagerContext,
} from './shared.jsx';
import { ModioModDetail } from './ModioViews.jsx';
import { GameBananaModDetail } from './GameBananaViews.jsx';
import { ThunderstoreModDetail } from './ThunderstoreViews.jsx';
import { NexusModDetail, nexusIds } from './NexusViews.jsx';
import UnifiedExplore, { CompatBadge } from './UnifiedExplore.jsx';
import InstalledPanel, { InstallProfileCard } from './InstalledPanel.jsx';
import SharedModpacksTab from './ModpacksTab.jsx';
import { peekPendingModpack } from './modpackShared.js';

// Gerenciador de UM jogo, no estilo CurseForge: capa grande do jogo em
// cima, ações rápidas (Jogar / Abrir pasta / Adicionar mod do PC) e
// abas Explorar · Instalados · Modpacks · Arquivos. "Explorar" mostra
// TODAS as fontes (mod.io, Workshop, GameBanana, Thunderstore) numa
// grade só, com compatibilidade — a fonte vira só um chip no cartão.
export default function GameManager({ game, onBack, scrollRef }) {
  const desktopReady = isDesktopModsAvailable();
  const sourceKeys = SOURCE_ORDER.filter((k) => game.sources[k]);
  const supported = sourceKeys.length > 0;
  const hasModio = !!game.sources.modio;
  const hasWorkshop = !!game.sources.workshop;

  // "Ver modpack" vindo do perfil abre direto na aba Modpacks.
  const [tab, setTab] = useState(() => (peekPendingModpack(game.steamAppId) ? 'modpacks' : supported ? 'explore' : 'files'));
  const [openedMod, setOpenedMod] = useState(null); // { item, compat } do mod aberto em "Explorar"
  // Perfil de instalação do jogo vindo do app desktop (loader, pastas...).
  const [installProfile, setInstallProfile] = useState(null);
  const [installProfileLoading, setInstallProfileLoading] = useState(true);
  const listScrollRef = useRef(0);

  const [installedState, setInstalledState] = useState({ enabled: [], disabled: [] });
  const [installedLoaded, setInstalledLoaded] = useState(false);
  const [workshopIds, setWorkshopIds] = useState([]);
  const [profiles, setProfiles] = useState(null);
  const [localInstallBusy, setLocalInstallBusy] = useState(false);
  const [localInstallError, setLocalInstallError] = useState('');

  // Progresso de download/instalação (onModsProgress) — vira um cartão
  // flutuante no canto da tela, valendo pra qualquer fonte.
  const [progressById, setProgressById] = useState({});
  const namesRef = useRef({});

  // Objeto do jogo já resolvido pra UMA fonte (mesmo formato que as
  // telas de cada fonte sempre usaram).
  const resolveSource = useCallback((key) => (key ? {
    ...game.sources[key], source: key, installPath: game.installPath, displayName: game.displayName, iconUrl: game.iconUrl, steamAppId: game.steamAppId,
  } : null), [game]);

  const refreshInstalled = useCallback(() => {
    if (!desktopReady || !game.installPath) { setInstalledLoaded(true); return; }
    listInstalledModsLocally(game.installPath, game.steamAppId)
      .then((d) => setInstalledState({ enabled: d.enabled || [], disabled: d.disabled || [] }))
      .finally(() => setInstalledLoaded(true));
  }, [desktopReady, game.installPath, game.steamAppId]);

  const refreshInstallProfile = useCallback(() => {
    if (!desktopReady || !game.installPath) { setInstallProfileLoading(false); return; }
    getModInstallProfileLocally(game.installPath, game.steamAppId)
      .then((d) => setInstallProfile(d.success ? d.profile : null))
      .catch(() => setInstallProfile(null))
      .finally(() => setInstallProfileLoading(false));
  }, [desktopReady, game.installPath, game.steamAppId]);
  // Instalar um mod pode instalar o loader junto — relê o perfil.
  useEffect(() => { refreshInstallProfile(); }, [refreshInstallProfile, installedState]);

  const refreshWorkshop = useCallback(() => {
    if (!desktopReady || !game.installPath || !hasWorkshop) return;
    listInstalledWorkshopItemsLocally(game.installPath, game.sources.workshop.workshopAppId).then((d) => setWorkshopIds(d.items || []));
  }, [desktopReady, game.installPath, hasWorkshop, game.sources.workshop]);

  const refreshProfiles = useCallback(() => {
    if (!hasModio) return;
    listModProfiles(game.sources.modio.modioGameId).then((d) => setProfiles(d.profiles)).catch(() => setProfiles([]));
  }, [hasModio, game.sources.modio]);

  useEffect(() => { refreshInstalled(); refreshWorkshop(); refreshProfiles(); }, [refreshInstalled, refreshWorkshop, refreshProfiles]);

  const finishLater = useCallback((id) => {
    setTimeout(() => setProgressById((prev) => {
      if (prev[id]?.phase !== 'done') return prev;
      const next = { ...prev }; delete next[id]; return next;
    }), 2600);
  }, []);

  useEffect(() => {
    if (!desktopReady) return undefined;
    return onModsProgress((p) => {
      setProgressById((prev) => ({ ...prev, [p.modioModId]: p }));
      if (p.phase === 'done') { refreshInstalled(); finishLater(p.modioModId); }
    });
  }, [desktopReady, refreshInstalled, finishLater]);

  const trackInstall = useCallback((id, name) => {
    namesRef.current[id] = name;
    setProgressById((prev) => ({ ...prev, [id]: { modioModId: id, phase: 'starting', percent: 0 } }));
  }, []);
  const untrackInstall = useCallback((id) => {
    setProgressById((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }, []);
  const completeInstall = useCallback((id) => {
    setProgressById((prev) => ({ ...prev, [id]: { modioModId: id, phase: 'done', percent: 100 } }));
    refreshInstalled();
    finishLater(id);
  }, [refreshInstalled, finishLater]);

  const installedFolders = useMemo(() => new Set([...installedState.enabled, ...installedState.disabled]), [installedState]);
  const ctx = useMemo(() => ({
    installedFolders, refreshInstalled, trackInstall, untrackInstall, completeInstall, progressById, workshopIds,
  }), [installedFolders, refreshInstalled, trackInstall, untrackInstall, completeInstall, progressById, workshopIds]);

  // Abrir um mod guarda a posição da lista; voltar devolve o scroll.
  const openMod = (item, compat) => {
    listScrollRef.current = scrollRef?.current?.scrollTop || 0;
    setOpenedMod({ item, compat });
    requestAnimationFrame(() => {
      const el = scrollRef?.current; const anchor = document.getElementById('mdx-tabs-anchor');
      if (el && anchor) el.scrollTop = Math.max(0, anchor.offsetTop - 12);
    });
  };
  const closeMod = () => {
    setOpenedMod(null);
    requestAnimationFrame(() => { if (scrollRef?.current) scrollRef.current.scrollTop = listScrollRef.current; });
  };

  // Item pedido: "abrir a pasta" — a pasta principal de mods do perfil
  // do jogo (BepInEx/plugins, Mods, Content/Paks/~mods, Data...).
  const doOpenFolder = () => openModsFolder(game.installPath, game.steamAppId);

  // Item pedido: "adicionar mods de um arquivo local".
  const doInstallLocalFile = async () => {
    const picked = await pickLocalModFile();
    if (!picked.success) return;
    setLocalInstallError('');
    setLocalInstallBusy(true);
    const modName = picked.name.replace(/\.[a-z0-9]{1,10}$/i, '');
    trackInstall('local', modName);
    try {
      const result = await installLocalModFile({ filePath: picked.path, gameInstallPath: game.installPath, modName, steamAppId: game.steamAppId });
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
      completeInstall('local');
    } catch (err) {
      setLocalInstallError(err.message);
      untrackInstall('local');
    } finally {
      setLocalInstallBusy(false);
    }
  };

  const installedTotal = installedState.enabled.length + installedState.disabled.length;
  const canTouchDisk = desktopReady && !!game.installPath;

  const tabs = [
    supported && { key: 'explore', label: 'Explorar', icon: 'compass' },
    { key: 'installed', label: 'Instalados', icon: 'puzzle', count: canTouchDisk && installedLoaded ? installedTotal + (hasWorkshop ? workshopIds.length : 0) : null },
    { key: 'modpacks', label: 'Modpacks', icon: 'layers' },
    { key: 'files', label: 'Arquivos', icon: 'folder' },
  ].filter(Boolean);

  return (
    <ModsManagerContext.Provider value={ctx}>
      <div className="mdx-manager">
        <GameHero
          game={game}
          sourceKeys={sourceKeys}
          installedTotal={canTouchDisk && installedLoaded ? installedTotal : null}
          onBack={onBack}
          actions={(
            <>
              {desktopReady && game.steamAppId && (
                <button type="button" className="mdx-btn play lg" onClick={() => window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`)}>
                  <Icon name="play" size={16} filled /> Jogar
                </button>
              )}
              {canTouchDisk && (
                <>
                  <button type="button" className="mdx-btn glass" onClick={doOpenFolder}><Icon name="folder" size={16} /> Abrir pasta de mods</button>
                  <button type="button" className="mdx-btn glass" disabled={localInstallBusy} onClick={doInstallLocalFile}>
                    <Icon name="upload" size={16} /> {localInstallBusy ? 'Instalando...' : 'Adicionar mod do PC'}
                  </button>
                </>
              )}
            </>
          )}
        />
        {localInstallError && <p className="mdx-error mdx-error-banner">Não foi possível instalar o arquivo: {localInstallError}</p>}

        <div id="mdx-tabs-anchor" />
        <nav className="mdx-tabs" aria-label="Seções do jogo">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={`mdx-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={16} /> {t.label}
              {t.count != null && <span className="mdx-tab-count">{t.count}</span>}
            </button>
          ))}
        </nav>

        {supported && (
          <div hidden={tab !== 'explore'}>
            <div hidden={!!openedMod}>
              <UnifiedExplore game={game} localProfile={installProfile} onOpenMod={openMod} />
            </div>
            {openedMod && ['auto', 'loader', 'bad'].includes(openedMod.compat?.kind) && (
              <div className={`mdx-ux-detail-compat ${openedMod.compat.kind}`}>
                <CompatBadge compat={openedMod.compat} />
                <span>{openedMod.compat.kind === 'auto'
                  ? `Ao instalar, o ${openedMod.compat.loaderLabel || 'loader'} é instalado junto.`
                  : openedMod.compat.kind === 'loader'
                    ? (installProfile?.loader?.howTo || `Instale o ${openedMod.compat.loaderLabel || 'loader'} antes — sem ele o mod não carrega.`)
                    : openedMod.compat.reason}</span>
              </div>
            )}
            {openedMod?.item.source === 'modio' && <ModioModDetail game={resolveSource('modio')} modioModId={Number(openedMod.item.sourceId)} onBack={closeMod} />}
            {openedMod?.item.source === 'gamebanana' && <GameBananaModDetail game={resolveSource('gamebanana')} modId={Number(openedMod.item.sourceId)} onBack={closeMod} />}
            {openedMod?.item.source === 'thunderstore' && <ThunderstoreModDetail game={resolveSource('thunderstore')} fullName={openedMod.item.sourceId} onBack={closeMod} />}
            {openedMod?.item.source === 'nexus' && <NexusModDetail game={resolveSource('nexus')} {...nexusIds(openedMod.item.sourceId)} onBack={closeMod} />}
          </div>
        )}

        {tab === 'installed' && (
          canTouchDisk ? (
            <>
              <InstalledPanel
                game={game}
                installedState={installedState}
                refreshInstalled={refreshInstalled}
                profiles={hasModio ? profiles : null}
                refreshProfiles={refreshProfiles}
                localProfile={installProfile}
                onExplore={supported ? () => setTab('explore') : null}
                onAddLocal={doInstallLocalFile}
                localInstallBusy={localInstallBusy}
              />
              {hasWorkshop && <div className="mdx-tab-body"><WorkshopSubscribed ids={workshopIds} /></div>}
            </>
          ) : <DiskGuard desktopReady={desktopReady} game={game} what="Gerenciar mods instalados" />
        )}

        {/* Modpacks públicos (qualquer jogo) — os perfis/coleções antigos do mod.io ficam numa sub-aba. */}
        {tab === 'modpacks' && (
          <SharedModpacksTab
            game={game}
            desktopReady={desktopReady}
            installedState={installedState}
            legacyProfiles={hasModio ? profiles : null}
            legacy={hasModio ? (
              <ModpacksTab
                game={resolveSource('modio')}
                desktopReady={desktopReady}
                profiles={profiles}
                refreshProfiles={refreshProfiles}
                refreshInstalled={refreshInstalled}
                trackInstall={trackInstall}
                untrackInstall={untrackInstall}
                completeInstall={completeInstall}
                onGoInstalled={() => setTab('installed')}
              />
            ) : null}
          />
        )}

        {tab === 'files' && (
          <FilesTab
            game={game}
            desktopReady={desktopReady}
            supported={supported}
            onOpenFolder={doOpenFolder}
            onAddLocal={doInstallLocalFile}
            localInstallBusy={localInstallBusy}
            installProfile={installProfile}
            installProfileLoading={installProfileLoading}
          />
        )}

        <ProgressToasts progressById={progressById} names={namesRef.current} onDismiss={untrackInstall} />
      </div>
    </ModsManagerContext.Provider>
  );
}

// ---------- Cabeçalho grande com a arte do jogo ----------
function GameHero({ game, sourceKeys, installedTotal, onBack, actions }) {
  // 0 = arte "hero" horizontal da Steam; 1 = capa vertical borrada; 2 = gradiente gerado
  const [stage, setStage] = useState(0);
  const hue = hashHue(game.displayName);
  return (
    <header className="mdx-hero" style={{ '--h1': hue, '--h2': (hue + 48) % 360 }}>
      <div className="mdx-hero-bg" aria-hidden="true">
        {stage === 0 && <img src={steamHeroUrl(game.steamAppId)} alt="" onError={() => setStage(1)} />}
        {stage === 1 && <img className="blurred" src={steamCoverUrl(game.steamAppId)} alt="" onError={() => setStage(2)} />}
        {stage === 2 && <div className="mdx-hero-gen" />}
        <div className="mdx-hero-shade" />
      </div>
      <button type="button" className="mdx-hero-back" onClick={onBack}><Icon name="back" size={16} /> Biblioteca</button>
      <div className="mdx-hero-content">
        <div className="mdx-hero-poster"><GameCover appId={game.steamAppId} name={game.displayName} iconUrl={game.iconUrl} /></div>
        <div className="mdx-hero-main">
          <div className="mdx-hero-text">
            <span className="mdx-eyebrow light">Gerenciador de mods</span>
            <h1>{game.displayName}</h1>
            <div className="mdx-hero-chips">
              {sourceKeys.length > 0
                ? sourceKeys.map((k) => <SourceChip key={k} source={k} long />)
                : <span className="mdx-hero-chip muted">Sem suporte a mods ainda</span>}
              {installedTotal != null && (
                <span className="mdx-hero-chip"><Icon name="puzzle" size={13} /> {installedTotal} {installedTotal === 1 ? 'mod instalado' : 'mods instalados'}</span>
              )}
            </div>
          </div>
          <div className="mdx-hero-actions">{actions}</div>
        </div>
      </div>
    </header>
  );
}

function DiskGuard({ desktopReady, game, what }) {
  if (!desktopReady) {
    return (
      <EmptyState icon="monitor" title="Isso precisa do app de desktop">
        {what} só funciona pelo app de desktop do Project Club.
      </EmptyState>
    );
  }
  if (!game.installPath) {
    return (
      <EmptyState icon="folder" title="Pasta do jogo não detectada">
        Não conseguimos confirmar a pasta de instalação — abra o jogo pela Steam pra ela ser detectada de novo.
      </EmptyState>
    );
  }
  return null;
}

// ---------- Aba "Instalados" ----------
// A lista em si fica em InstalledPanel.jsx (detectados + Project Club).

// Itens do Steam Workshop já inscritos (a Steam baixa sozinha; aqui só
// mostramos e levamos pra página do item).
function WorkshopSubscribed({ ids }) {
  const [titles, setTitles] = useState({});
  useEffect(() => {
    let alive = true;
    ids.slice(0, 40).forEach((id) => {
      if (titles[id]) return;
      getWorkshopItem(id).then((d) => { if (alive && d.item?.title) setTitles((prev) => ({ ...prev, [id]: { title: d.item.title, preview: d.item.preview_url } })); }).catch(() => {});
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return (
    <Section title="Inscritos no Steam Workshop" icon="users" right={<span className="mdx-muted">{ids.length}</span>}>
      {ids.length === 0 ? (
        <p className="mdx-muted mdx-pad">Nenhum item do Workshop inscrito pra este jogo. Inscreva-se pela aba "Explorar" — a Steam baixa sozinha.</p>
      ) : (
        <div className="mdx-rows">
          {ids.map((id) => (
            <div key={id} className="mdx-row">
              <span className="mdx-row-icon" style={{ '--h1': 205 }}>
                {titles[id]?.preview ? <img src={titles[id].preview} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Icon name="box" size={18} />}
              </span>
              <div className="mdx-row-text">
                <strong>{titles[id]?.title || `Item #${id}`}</strong>
                <span className="mdx-status on">Inscrito</span>
              </div>
              <div className="mdx-row-actions">
                <button type="button" className="mdx-btn ghost sm" onClick={() => openWorkshopItemInSteam(id)}><Icon name="external" size={14} /> Ver na Steam</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------- Aba "Modpacks" (perfis + coleções, só mod.io) ----------
function ModpacksTab({ game, desktopReady, profiles, refreshProfiles, refreshInstalled, trackInstall, untrackInstall, completeInstall, onGoInstalled }) {
  const { user } = useAuth();
  const [newProfileName, setNewProfileName] = useState('');
  const [activatingProfileId, setActivatingProfileId] = useState(null);
  const [activateMessage, setActivateMessage] = useState('');
  const [collections, setCollections] = useState(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [installingCollectionId, setInstallingCollectionId] = useState(null);
  const [collectionMessage, setCollectionMessage] = useState('');

  const refreshCollections = () => listModCollections(game.modioGameId).then((d) => setCollections(d.collections)).catch(() => setCollections([]));
  useEffect(() => { refreshCollections(); refreshProfiles(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [game.modioGameId]);

  const doCreateProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    await createModProfile(game.modioGameId, name);
    setNewProfileName('');
    refreshProfiles();
  };
  const doDeleteProfile = async (profile) => {
    if (!confirm(`Apagar o modpack "${profile.name}"? Isso não desinstala nenhum mod, só o agrupamento.`)) return;
    await deleteModProfile(profile.id);
    refreshProfiles();
  };
  const doRemoveFromProfile = async (profileId, itemId) => {
    await removeModProfileItem(profileId, itemId);
    refreshProfiles();
  };

  // Item pedido 15/28: "trocar de perfil rapidamente" + "▶ Jogar" —
  // reconcilia o disco (ver modsManager.applyProfileMods) pra deixar
  // ativos exatamente os mods marcados como enabled neste perfil, e só
  // depois, se pedido, abre o jogo via protocolo steam:// (não mexe em
  // nenhuma configuração da Steam, só pede pra ELA abrir o jogo).
  const activateProfile = async (profile, alsoPlay) => {
    if (!game.installPath) { setActivateMessage('Não sabemos onde este jogo está instalado.'); return; }
    setActivatingProfileId(profile.id);
    setActivateMessage('');
    try {
      const enabledModNames = profile.items.filter((i) => i.enabled && i.modName).map((i) => i.modName);
      const result = await applyProfileLocally({ gameInstallPath: game.installPath, enabledModNames, steamAppId: game.steamAppId });
      refreshInstalled();
      // Item pedido: "criar uma pasta do Project Club chamada modpacks
      // onde salva os modpacks..." — toda vez que o modpack é ativado,
      // uma cópia local também é gravada em disco (funciona offline).
      saveModpackLocal({ gameKey: game.steamAppId, gameDisplayName: game.displayName, packName: profile.name, mods: enabledModNames }).catch(() => {});
      if (result.missing?.length) {
        setActivateMessage(`Modpack ativado, mas ${result.missing.length} mod(s) dele ainda não foram instalados neste computador.`);
      } else {
        setActivateMessage(`Modpack "${profile.name}" ativado (e salvo localmente).`);
      }
      if (alsoPlay && game.steamAppId) {
        window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`);
      }
    } finally {
      setActivatingProfileId(null);
    }
  };

  const doCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    await createModCollection(game.modioGameId, { name });
    setNewCollectionName('');
    refreshCollections();
  };
  const doDeleteCollection = async (collection) => {
    if (!confirm(`Apagar a coleção "${collection.name}"? Isso não desinstala mods de ninguém, só remove o compartilhamento.`)) return;
    await deleteModCollection(collection.id);
    refreshCollections();
  };

  // Item pedido 19: "Instalar coleção" — instala cada mod da coleção em
  // sequência (mesmo download+instalação de sempre). Dependências e
  // conflitos entre os mods ainda não são verificados sozinhos aqui.
  const doInstallCollection = async (collection) => {
    if (!game.installPath) { setCollectionMessage('Não sabemos onde este jogo está instalado.'); return; }
    setInstallingCollectionId(collection.id);
    setCollectionMessage('');
    try {
      for (const item of collection.items) {
        setCollectionMessage(`Instalando ${item.modName || `mod #${item.modioModId}`}...`);
        const modDetail = await getMod(game.modioGameId, item.modioModId);
        trackInstall(item.modioModId, modDetail.mod.name);
        const download = await getModDownload(game.modioGameId, item.modioModId);
        const result = await installModLocally({
          downloadUrl: download.downloadUrl,
          filename: download.filename,
          gameInstallPath: game.installPath,
          modName: modDetail.mod.name,
          modioModId: item.modioModId,
          steamAppId: game.steamAppId, source: 'modio', sourceId: item.modioModId,
        });
        if (!result.success) { untrackInstall(item.modioModId); throw new Error(`${modDetail.mod.name}: ${result.error || 'falha desconhecida'}`); }
        completeInstall(item.modioModId);
      }
      setCollectionMessage(`Coleção "${collection.name}" instalada.`);
      refreshInstalled();
    } catch (err) {
      setCollectionMessage(`Erro ao instalar a coleção: ${err.message}`);
    } finally {
      setInstallingCollectionId(null);
    }
  };

  return (
    <div className="mdx-tab-body">
      <Section title="Seus modpacks" icon="layers">
        <p className="mdx-muted mdx-lead">
          Um modpack é um conjunto de mods que você liga de uma vez. Adicione mods pela aba{' '}
          <button type="button" className="mdx-inline-link" onClick={onGoInstalled}>Instalados</button> (menu "+ Modpack" em cada um) e ative aqui —
          ele desativa (sem desinstalar) qualquer mod que não faça parte dele.
        </p>
        {desktopReady ? (
          <div className="mdx-create">
            <input placeholder="Nome do novo modpack (ex: Terror, Vanilla...)" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doCreateProfile(); }} />
            <button type="button" className="mdx-btn primary" disabled={!newProfileName.trim()} onClick={doCreateProfile}><Icon name="plus" size={16} /> Criar modpack</button>
          </div>
        ) : (
          <p className="mdx-note"><Icon name="monitor" size={15} /> Ativar modpacks só funciona pelo app de desktop.</p>
        )}
        {activateMessage && <p className="mdx-note ok"><Icon name="check" size={15} /> {activateMessage}</p>}
        {profiles === null ? (
          <div className="mdx-pack-grid">{[0, 1].map((i) => <div key={i} className="mdx-skel mdx-skel-pack" />)}</div>
        ) : profiles.length === 0 ? (
          <EmptyState icon="layers" title="Nenhum modpack ainda">Crie o primeiro acima — por exemplo "Vanilla" e "Tudo ligado".</EmptyState>
        ) : (
          <div className="mdx-pack-grid">
            {profiles.map((p) => (
              <article key={p.id} className="mdx-pack">
                <div className="mdx-pack-head">
                  <span className="mdx-pack-icon" style={{ '--h1': hashHue(p.name) }}><Icon name="layers" size={18} /></span>
                  <div>
                    <strong>{p.name}</strong>
                    <span className="mdx-muted">{p.items.filter((i) => i.enabled).length} mods ativos</span>
                  </div>
                  <button type="button" className="mdx-icon-btn danger" title="Apagar modpack" aria-label="Apagar modpack" onClick={() => doDeleteProfile(p)}><Icon name="trash" size={15} /></button>
                </div>
                {p.items.length > 0 ? (
                  <div className="mdx-pack-items">
                    {p.items.map((i) => (
                      <span key={i.id} className="mdx-pack-item">
                        {i.modName || `Mod #${i.modioModId}`}
                        <button type="button" onClick={() => doRemoveFromProfile(p.id, i.id)} title="Remover do modpack" aria-label="Remover do modpack"><Icon name="close" size={11} strokeWidth={2.4} /></button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mdx-muted mdx-small">Nenhum mod ainda — adicione pela aba "Instalados".</p>
                )}
                {desktopReady && (
                  <div className="mdx-pack-actions">
                    <button type="button" className="mdx-btn ghost sm" disabled={activatingProfileId === p.id} onClick={() => activateProfile(p, false)}>
                      <Icon name="check" size={14} /> {activatingProfileId === p.id ? 'Ativando...' : 'Ativar'}
                    </button>
                    <button type="button" className="mdx-btn play sm" disabled={activatingProfileId === p.id} onClick={() => activateProfile(p, true)}>
                      <Icon name="play" size={13} filled /> Jogar com este modpack
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="Coleções" icon="box">
        <p className="mdx-muted mdx-lead">
          Coleções são públicas — qualquer pessoa com este jogo pode ver e instalar a sua. Monte uma coleção
          adicionando mods pela página de cada mod ("Adicionar a uma coleção").
        </p>
        <div className="mdx-create">
          <input placeholder="Nome da nova coleção (ex: Modpack de Terror...)" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doCreateCollection(); }} />
          <button type="button" className="mdx-btn primary" disabled={!newCollectionName.trim()} onClick={doCreateCollection}><Icon name="plus" size={16} /> Criar coleção</button>
        </div>
        {collectionMessage && <p className="mdx-note">{collectionMessage}</p>}
        {collections === null ? (
          <div className="mdx-pack-grid">{[0, 1].map((i) => <div key={i} className="mdx-skel mdx-skel-pack" />)}</div>
        ) : collections.length === 0 ? (
          <p className="mdx-muted mdx-pad">Nenhuma coleção criada ainda pra este jogo.</p>
        ) : (
          <div className="mdx-pack-grid">
            {collections.map((c) => (
              <article key={c.id} className="mdx-pack">
                <div className="mdx-pack-head">
                  <span className="mdx-pack-icon" style={{ '--h1': hashHue(c.name) }}><Icon name="box" size={18} /></span>
                  <div>
                    <strong>{c.name}</strong>
                    <span className="mdx-muted">{c.items.length} mods · por {c.author?.displayName}</span>
                  </div>
                  {c.author?.id === user.id && (
                    <button type="button" className="mdx-icon-btn danger" title="Apagar coleção" aria-label="Apagar coleção" onClick={() => doDeleteCollection(c)}><Icon name="trash" size={15} /></button>
                  )}
                </div>
                {c.items.length > 0 && (
                  <div className="mdx-pack-items">
                    {c.items.map((i) => <span key={i.id || i.modioModId} className="mdx-pack-item">{i.modName || `Mod #${i.modioModId}`}</span>)}
                  </div>
                )}
                {desktopReady && (
                  <div className="mdx-pack-actions">
                    <button type="button" className="mdx-btn primary sm" disabled={installingCollectionId === c.id || c.items.length === 0} onClick={() => doInstallCollection(c)}>
                      <Icon name="download" size={14} /> {installingCollectionId === c.id ? 'Instalando...' : 'Instalar coleção'}
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------- Aba "Arquivos" ----------
function FilesTab({ game, desktopReady, supported, onOpenFolder, onAddLocal, localInstallBusy, installProfile, installProfileLoading }) {
  const [configFiles, setConfigFiles] = useState(null);
  const [fileQuery, setFileQuery] = useState('');
  const [selectedConfigFile, setSelectedConfigFile] = useState(null);
  const [configContent, setConfigContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  // Item pedido: "poder configurar mods" — lista/abre/edita os .cfg de
  // BepInEx/config como texto puro (ver roadmap em modsManager.js).
  const refreshConfigFiles = () => {
    if (!desktopReady || !game.installPath) return;
    listModConfigFiles(game.installPath).then((d) => setConfigFiles(d.files || [])).catch(() => setConfigFiles([]));
  };
  useEffect(refreshConfigFiles, [desktopReady, game.installPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const guard = <DiskGuard desktopReady={desktopReady} game={game} what="Ver e editar os arquivos do jogo" />;
  if (!desktopReady || !game.installPath) return guard;

  const openConfigFile = async (filename) => {
    if (selectedConfigFile && configContent !== savedContent && !confirm('Você tem alterações não salvas neste arquivo. Descartar?')) return;
    setSelectedConfigFile(filename);
    setConfigMessage('');
    const d = await readModConfigFile(game.installPath, filename);
    setConfigContent(d.success ? d.content : '');
    setSavedContent(d.success ? d.content : '');
    if (!d.success) setConfigMessage(`Não foi possível abrir: ${d.error}`);
  };
  const saveConfigFile = async () => {
    setConfigSaving(true);
    try {
      const d = await writeModConfigFile(game.installPath, selectedConfigFile, configContent);
      if (d.success) setSavedContent(configContent);
      setConfigMessage(d.success ? 'Salvo!' : `Erro ao salvar: ${d.error}`);
    } finally {
      setConfigSaving(false);
    }
  };

  const dirty = selectedConfigFile && configContent !== savedContent;
  const shownFiles = (configFiles || []).filter((f) => !fileQuery.trim() || f.toLowerCase().includes(fileQuery.trim().toLowerCase()));

  return (
    <div className="mdx-tab-body">
      <Section title="Pasta do jogo" icon="folder">
        <div className="mdx-path-card">
          <code title={game.installPath}>{game.installPath}</code>
          <div className="mdx-path-actions">
            <button type="button" className="mdx-btn ghost" onClick={onOpenFolder}><Icon name="folder" size={16} /> Abrir pasta de mods</button>
            <button type="button" className="mdx-btn primary" disabled={localInstallBusy} onClick={onAddLocal}>
              <Icon name="upload" size={16} /> {localInstallBusy ? 'Instalando...' : 'Adicionar mod do PC'}
            </button>
          </div>
        </div>
        {!supported && (
          <p className="mdx-note"><Icon name="info" size={15} /> Este jogo ainda não tem uma fonte de mods configurada no Project Club — mas dá pra abrir a pasta e colocar mods do seu PC.</p>
        )}
      </Section>

      <Section title="Como este jogo usa mods" icon="layers">
        <InstallProfileCard profile={installProfile} loading={installProfileLoading} />
      </Section>

      <Section
        title="Configurar mods"
        icon="file"
        right={<button type="button" className="mdx-icon-btn" title="Recarregar lista" aria-label="Recarregar lista" onClick={refreshConfigFiles}><Icon name="refresh" size={15} /></button>}
      >
        <p className="mdx-muted mdx-lead">
          Edição em texto puro dos arquivos de configuração (.cfg) de cada mod — exatamente como eles são salvos no
          disco, sem tentar adivinhar um formulário pra cada mod diferente.
        </p>
        {configFiles === null ? (
          <div className="mdx-skel mdx-skel-editor" />
        ) : configFiles.length === 0 ? (
          <EmptyState icon="file" title="Nenhum arquivo de configuração">
            Os mods criam seus arquivos .cfg (em BepInEx/config) na primeira vez que o jogo abre com eles instalados.
          </EmptyState>
        ) : (
          <div className="mdx-config">
            <div className="mdx-config-files">
              {configFiles.length > 6 && (
                <div className="mdx-config-search"><SearchField value={fileQuery} onChange={setFileQuery} placeholder="Filtrar arquivos..." /></div>
              )}
              <div className="mdx-config-list">
                {shownFiles.map((f) => (
                  <button key={f} type="button" className={`mdx-config-file ${selectedConfigFile === f ? 'active' : ''}`} onClick={() => openConfigFile(f)} title={f}>
                    <Icon name="file" size={15} /> <span>{f}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mdx-config-editor">
              {selectedConfigFile ? (
                <>
                  <div className="mdx-config-bar">
                    <strong title={selectedConfigFile}>{selectedConfigFile}</strong>
                    {dirty && <span className="mdx-dirty">Não salvo</span>}
                    {configMessage && !dirty && <span className={`mdx-config-msg ${configMessage === 'Salvo!' ? 'ok' : ''}`}>{configMessage}</span>}
                    <button type="button" className="mdx-btn primary sm" disabled={configSaving || !dirty} onClick={saveConfigFile}>
                      <Icon name="save" size={14} /> {configSaving ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                  <textarea
                    value={configContent}
                    onChange={(e) => setConfigContent(e.target.value)}
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty) saveConfigFile(); } }}
                    spellCheck={false}
                  />
                </>
              ) : (
                <div className="mdx-config-placeholder">
                  <Icon name="file" size={26} />
                  <span>Escolha um arquivo na lista pra editar.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------- Cartão de progresso flutuante ----------
function ProgressToasts({ progressById, names, onDismiss }) {
  const entries = Object.entries(progressById);
  if (entries.length === 0) return null;
  return (
    <div className="mdx-toasts" role="status" aria-live="polite">
      {entries.slice(-3).map(([id, p]) => {
        const done = p.phase === 'done';
        return (
          <div key={id} className={`mdx-toast ${done ? 'done' : ''}`}>
            <span className="mdx-toast-icon"><Icon name={done ? 'check' : 'download'} size={17} strokeWidth={done ? 2.6 : 1.8} /></span>
            <div className="mdx-toast-body">
              <strong>{names[id] || (id === 'local' ? 'Mod do PC' : 'Mod')}</strong>
              <span>{done ? 'Instalado!' : progressLabel(p)}</span>
              {!done && <ProgressBar percent={p.percent} indeterminate={p.phase !== 'downloading'} />}
            </div>
            {done && <button type="button" className="mdx-icon-btn" aria-label="Fechar" onClick={() => onDismiss(id)}><Icon name="close" size={14} /></button>}
          </div>
        );
      })}
    </div>
  );
}
