import { useCallback, useEffect, useMemo, useState } from 'react';
import { matchSteamGames, matchWorkshopGames, matchGameBananaGames, matchThunderstoreGames, matchNexusGames } from '../../api/endpoints';
import { isDesktopModsAvailable, detectSteamGames, listInstalledModsLocally } from '../../utils/mods';
import { Icon, GameCover, SourceChip, EmptyState, SkeletonGrid, SearchField, ChipRow, SOURCE_ORDER } from './shared.jsx';
import { NexusLinkToggle } from './NexusViews.jsx';
import ModsHome from './ModsHome.jsx';

// Itens da Steam que não são jogos (pacotes de runtime, Proton, SteamVR,
// redistribuíveis) — item pedido: "remova o Steamworks Common
// Redistributables da aba de jogos".
const STEAM_TOOL_IDS = new Set([228980, 1070560, 1391110, 1628350, 250820, 1826330, 1161040, 1493710, 961940, 1054830, 1113280, 1245040, 1420170, 1580130, 1887720, 2180100, 2230260, 2348590, 2805730, 3658110, 1007, 243750]);
const STEAM_TOOL_NAME = /redistributable|^proton\b|steam linux runtime|steamvr|steamworks|easyanticheat runtime|battleye service|dedicated server|\bsdk\b/i;
function isSteamTool(game) {
  return STEAM_TOOL_IDS.has(Number(game.steamAppId)) || STEAM_TOOL_NAME.test(game.name || '');
}

// Carrega a biblioteca uma vez só (fica no ModsPage), pra voltar do
// gerenciador de um jogo pro álbum sem detectar a Steam de novo.
export function useModsLibrary() {
  const desktopReady = isDesktopModsAvailable();
  const [loading, setLoading] = useState(desktopReady);
  const [steamFound, setSteamFound] = useState(null);
  const [games, setGames] = useState([]);
  const [installedCounts, setInstalledCounts] = useState({}); // steamAppId -> nº de mods

  // Conta os mods instalados de cada jogo COM suporte (leitura local de
  // pasta pelo app desktop — barato). Jogo sem suporte fica de fora:
  // não sabemos qual pasta de mods ele usaria.
  const refreshCounts = useCallback((list) => {
    const targets = (list || []).filter((g) => g.installPath && Object.keys(g.sources).length > 0);
    Promise.all(targets.map((g) => listInstalledModsLocally(g.installPath)
      .then((d) => [g.steamAppId, (d.enabled?.length || 0) + (d.disabled?.length || 0)])
      .catch(() => [g.steamAppId, 0])))
      .then((pairs) => setInstalledCounts(Object.fromEntries(pairs)));
  }, []);

  useEffect(() => {
    if (!desktopReady) return;
    (async () => {
      try {
        // Item pedido 30: a detecção roda LOCALMENTE (steamDetector.js,
        // dentro do app desktop) — só a lista de AppIDs encontrados
        // sobe pro servidor, pra cruzar com os catálogos de suporte
        // (mod.io, Workshop, GameBanana e Thunderstore, todos
        // staff-editáveis).
        const detection = await detectSteamGames();
        setSteamFound(detection.steamFound);
        if (detection.steamFound && detection.games?.length > 0) {
          const appIds = detection.games.map((g) => g.steamAppId);
          const names = Object.fromEntries(detection.games.map((g) => [g.steamAppId, g.name || '']));
          const [{ games: modioSupported }, { games: workshopSupported }, { games: gamebananaSupported }, { games: thunderstoreSupported }, { games: nexusSupported }] = await Promise.all([
            matchSteamGames(appIds).catch(() => ({ games: [] })),
            matchWorkshopGames(appIds).catch(() => ({ games: [] })),
            matchGameBananaGames(appIds).catch(() => ({ games: [] })),
            matchThunderstoreGames(appIds).catch(() => ({ games: [] })),
            // Nexus Mods (fonte do Vortex): acha o jogo pelo AppID ou nome.
            matchNexusGames(appIds, names).catch(() => ({ games: [] })),
          ]);

          // Álbum: TODOS os jogos detectados viram um cartão (com ou
          // sem suporte). Item pedido: "funda o Workshop e o GameBanana
          // na mesma aba... pra não ter esse tipo de game repetido" —
          // tudo num Map por steamAppId, então um jogo com suporte em
          // mais de uma fonte continua sendo UM cartão só.
          const merged = new Map();
          for (const g of detection.games.filter((x) => !isSteamTool(x))) {
            if (merged.has(g.steamAppId)) continue;
            merged.set(g.steamAppId, { steamAppId: g.steamAppId, displayName: g.name || `App ${g.steamAppId}`, iconUrl: null, installPath: g.installPath, sources: {} });
          }
          const addSource = (list, sourceKey) => {
            for (const s of list || []) {
              const entry = merged.get(s.steamAppId);
              if (!entry) continue;
              if (s.displayName && !entry.namedBySource) { entry.displayName = s.displayName; entry.namedBySource = true; }
              if (!entry.iconUrl && s.iconUrl) entry.iconUrl = s.iconUrl;
              entry.sources[sourceKey] = s;
            }
          };
          addSource(modioSupported, 'modio');
          addSource(workshopSupported, 'workshop');
          addSource(gamebananaSupported, 'gamebanana');
          addSource(thunderstoreSupported, 'thunderstore');
          addSource(nexusSupported, 'nexus');
          const list = Array.from(merged.values());
          setGames(list);
          refreshCounts(list);
        }
      } catch {
        setSteamFound(false);
      } finally {
        setLoading(false);
      }
    })();
  }, [desktopReady, refreshCounts]);

  return { desktopReady, loading, steamFound, games, installedCounts, refreshCounts: () => refreshCounts(games) };
}

const SORTS = [
  { value: 'mods', label: 'Com mods primeiro' },
  { value: 'az', label: 'A–Z' },
];

export default function ModsLibrary({ library, updates, onBack, onOpenGame, notice, onDismissNotice }) {
  const { desktopReady, loading, steamFound, games, installedCounts } = library;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'supported' | 'unsupported'
  const [sort, setSort] = useState('mods');

  const supportedCount = games.filter((g) => Object.keys(g.sources).length > 0).length;
  const totalInstalled = Object.values(installedCounts).reduce((a, b) => a + b, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = games.filter((g) => {
      const supported = Object.keys(g.sources).length > 0;
      if (filter === 'supported' && !supported) return false;
      if (filter === 'unsupported' && supported) return false;
      return !q || g.displayName.toLowerCase().includes(q);
    });
    list = [...list].sort((a, b) => {
      if (sort === 'mods') {
        const sa = Object.keys(a.sources).length > 0 ? 1 : 0;
        const sb = Object.keys(b.sources).length > 0 ? 1 : 0;
        if (sa !== sb) return sb - sa;
        const ia = installedCounts[a.steamAppId] || 0;
        const ib = installedCounts[b.steamAppId] || 0;
        if (ia !== ib) return ib - ia;
      }
      return a.displayName.localeCompare(b.displayName, 'pt-BR');
    });
    return list;
  }, [games, query, filter, sort, installedCounts]);

  const ready = desktopReady && !loading && steamFound;
  const updateTotal = Object.values(updates?.byGame || {}).reduce((a, l) => a + l.length, 0);

  return (
    <div className="mdx-wrap">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> Jogos</button>

      <header className="mdx-lib-hero">
        <div className="mdx-lib-hero-text">
          <span className="mdx-eyebrow"><Icon name="library" size={14} /> Biblioteca</span>
          <h1>Mods</h1>
          <p>Todos os jogos da sua Steam num lugar só. Escolha um jogo pra explorar mods compatíveis, gerenciar o que já está instalado e mexer nos arquivos.</p>
        </div>
        {ready && (
          <dl className="mdx-lib-stats">
            <div><dt><Icon name="gamepad" size={15} /> Jogos encontrados</dt><dd>{games.length}</dd></div>
            <div><dt><Icon name="puzzle" size={15} /> Com suporte a mods</dt><dd>{supportedCount}</dd></div>
            <div><dt><Icon name="check" size={15} /> Mods instalados</dt><dd>{totalInstalled}</dd></div>
            {updateTotal > 0 && <div className="upd"><dt><Icon name="refresh" size={15} /> Atualizações</dt><dd>{updateTotal}</dd></div>}
          </dl>
        )}
      </header>
      {desktopReady && <NexusLinkToggle />}

      {notice && (
        <p className="mdx-note mdx-home-notice">
          <Icon name="info" size={15} />
          <span>{notice}</span>
          <button type="button" className="mdx-icon-btn" aria-label="Fechar aviso" onClick={onDismissNotice}><Icon name="close" size={13} /></button>
        </p>
      )}

      <ModsHome library={library} updates={updates || { byGame: {} }} onOpenGame={onOpenGame} />

      <div className="mdx-home-head mdx-lib-head">
        <span className="mdx-home-head-icon"><Icon name="library" size={17} /></span>
        <div>
          <h2>Sua biblioteca</h2>
          <p>{desktopReady ? 'Todos os jogos da sua Steam — escolha um pra gerenciar os mods.' : 'Seus jogos aparecem aqui quando você abre o Project Club pelo app do PC.'}</p>
        </div>
      </div>

      {!desktopReady && (
        <EmptyState icon="monitor" title="Instalar mods precisa do app do PC">
          A detecção dos seus jogos e a instalação de mods só funcionam pelo app de desktop do Project Club — o navegador não tem acesso às pastas de jogos por segurança. Daqui dá pra ver o que está em alta e os modpacks da comunidade.
        </EmptyState>
      )}

      {desktopReady && loading && (
        <>
          <p className="mdx-loading-line"><span className="mdx-spinner" /> Procurando jogos na sua Steam...</p>
          <SkeletonGrid count={12} variant="poster" />
        </>
      )}

      {desktopReady && !loading && steamFound === false && (
        <EmptyState icon="search" title="Não encontramos a Steam">
          Verifique se a Steam está instalada neste computador. Se ela estiver num lugar incomum, a detecção pode falhar — estamos de olho nisso pra próxima fase.
        </EmptyState>
      )}

      {ready && games.length === 0 && (
        <EmptyState icon="gamepad" title="Nenhum jogo encontrado">
          Detectamos sua Steam, mas nenhum jogo instalado apareceu. Instale um jogo pela Steam e volte aqui.
        </EmptyState>
      )}

      {ready && games.length > 0 && (
        <>
          <div className="mdx-lib-toolbar">
            <SearchField value={query} onChange={setQuery} placeholder="Pesquisar nos seus jogos..." />
            <div className="mdx-lib-toolbar-row">
              <ChipRow
                label="Filtrar"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Todos', count: games.length },
                  { value: 'supported', label: 'Com mods', count: supportedCount },
                  { value: 'unsupported', label: 'Sem suporte ainda', count: games.length - supportedCount },
                ]}
              />
              <label className="mdx-sort">
                <Icon name="sort" size={15} />
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
                  {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon="search" title="Nenhum jogo por aqui">Tente outra busca ou outro filtro.</EmptyState>
          ) : (
            <div className="mdx-album-grid">
              {visible.map((g) => (
                <PosterCard key={g.steamAppId} game={g} installedCount={installedCounts[g.steamAppId] || 0} updateCount={updates?.byGame?.[g.steamAppId]?.length || 0} onClick={() => onOpenGame(g, updates?.byGame?.[g.steamAppId]?.length ? { tab: 'installed' } : undefined)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PosterCard({ game, installedCount, updateCount = 0, onClick }) {
  const sources = SOURCE_ORDER.filter((k) => game.sources[k]);
  const supported = sources.length > 0;
  return (
    <button type="button" className={`mdx-poster ${supported ? '' : 'unsupported'}`} onClick={onClick} title={game.displayName}>
      <div className="mdx-poster-art">
        <GameCover appId={game.steamAppId} name={game.displayName} iconUrl={game.iconUrl} />
        <div className="mdx-poster-shade" />
        {installedCount > 0 && (
          <span className="mdx-poster-count" title={`${installedCount} mods instalados`}><Icon name="puzzle" size={13} /> {installedCount}</span>
        )}
        {updateCount > 0 && (
          <span className="mdx-poster-upd" title={updateCount === 1 ? '1 mod com atualização' : `${updateCount} mods com atualização`}>
            <Icon name="refresh" size={12} strokeWidth={2.4} /> {updateCount}
          </span>
        )}
        <div className="mdx-poster-foot">
          {supported ? (
            <div className="mdx-poster-sources"><span className="mdx-poster-modchip"><Icon name="puzzle" size={12} /> Mods</span></div>
          ) : (
            <span className="mdx-poster-nosupport">Sem suporte ainda</span>
          )}
        </div>
      </div>
      <span className="mdx-poster-name">{game.displayName}</span>
    </button>
  );
}
