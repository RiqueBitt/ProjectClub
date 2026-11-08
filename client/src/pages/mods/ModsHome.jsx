import { useEffect, useMemo, useState } from 'react';
import { listPublicModpacks } from '../../api/endpoints';
import { useLiveRefresh, sameData } from '../../utils/liveRefresh';
import UserAvatar from '../../components/UserAvatar.jsx';
import { Icon, ModThumb, GameCover, formatCount } from './shared.jsx';
import { ModpackCover } from './ModpacksTab.jsx';
import { requestOpenModpack } from './modpackShared.js';
import { getTrendingMods } from './unifiedApi.js';

// Tela inicial de /jogos/mods (em cima do álbum): "Seus jogos com
// atualização de mod", "Em alta esta semana" e "Modpacks mais baixados".
// No navegador (sem o app) mostra só "Em alta" e os modpacks.

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function ModsHome({ library, updates, onOpenGame }) {
  const { desktopReady, loading, games, installedCounts } = library;
  const [trending, setTrending] = useState(null);
  const [trendingFailed, setTrendingFailed] = useState(false);
  const [modpacks, setModpacks] = useState(null);

  const gamesById = useMemo(() => new Map(games.map((g) => [Number(g.steamAppId), g])), [games]);

  // Jogos do PC usados no "Em alta": os com suporte, com mais mods
  // instalados primeiro (no máximo 6).
  const trendingGames = useMemo(() => games
    .filter((g) => Object.keys(g.sources).length > 0)
    .sort((a, b) => (installedCounts[b.steamAppId] || 0) - (installedCounts[a.steamAppId] || 0) || a.displayName.localeCompare(b.displayName, 'pt-BR'))
    .slice(0, 6)
    .map((g) => ({ steamAppId: g.steamAppId, name: g.displayName })), [games, installedCounts]);
  const trendingKey = trendingGames.map((g) => g.steamAppId).join(',');
  // No app: espera a biblioteca carregar pra saber os jogos.
  const trendingReady = !desktopReady || !loading;

  useEffect(() => {
    if (!trendingReady) return undefined;
    let alive = true;
    setTrending(null);
    setTrendingFailed(false);
    getTrendingMods(trendingGames)
      .then((d) => { if (alive) setTrending(d.items || []); })
      .catch(() => { if (alive) { setTrending([]); setTrendingFailed(true); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendingReady, trendingKey]);

  useEffect(() => {
    let alive = true;
    listPublicModpacks({ sort: 'downloads', page: 1 })
      .then((d) => { if (alive) setModpacks((d.modpacks || []).slice(0, 10)); })
      .catch(() => { if (alive) setModpacks([]); });
    return () => { alive = false; };
  }, []);

  // Ao vivo: modpacks (downloads/likes) e, mais devagar, o "Em alta".
  useLiveRefresh(async (ctx) => {
    const d = await listPublicModpacks({ sort: 'downloads', page: 1 });
    ctx.put(setModpacks)((d.modpacks || []).slice(0, 10));
  });
  useLiveRefresh(async (ctx) => {
    const d = await getTrendingMods(trendingGames);
    if (!ctx.ok() || !d.items?.length) return;
    setTrending((prev) => (sameData(prev, d.items) ? prev : d.items));
  }, { enabled: trendingReady, interval: 120000, key: trendingKey });

  const updateGames = desktopReady
    ? games.filter((g) => updates.byGame[g.steamAppId]?.length).map((g) => ({ game: g, list: updates.byGame[g.steamAppId] }))
    : [];

  const openTrending = (item) => {
    const game = gamesById.get(Number(item.steamAppId));
    if (game) onOpenGame(game, { mod: item });
  };
  const openModpack = (mp) => {
    const game = gamesById.get(Number(mp.steamAppId));
    if (!game) return;
    requestOpenModpack(mp.steamAppId, mp.id);
    onOpenGame(game);
  };

  return (
    <div className="mdx-home">
      {desktopReady && (updateGames.length > 0 || (updates.checking && !updates.checked)) && (
        <section className="mdx-home-sec" aria-label="Seus jogos com atualização de mod">
          <HomeHead icon="refresh" title="Seus jogos com atualização de mod" sub="Mods que você instalou pelo Project Club e já têm versão nova." />
          {updateGames.length === 0 ? (
            <div className="mdx-home-upd-grid">{[0, 1].map((i) => <div key={i} className="mdx-skel mdx-home-skel-upd" />)}</div>
          ) : (
            <div className="mdx-home-upd-grid">
              {updateGames.map(({ game, list }) => (
                <button key={game.steamAppId} type="button" className="mdx-home-upd" onClick={() => onOpenGame(game, { tab: 'installed' })}>
                  <span className="mdx-home-upd-cover"><GameCover appId={game.steamAppId} name={game.displayName} iconUrl={game.iconUrl} /></span>
                  <span className="mdx-home-upd-body">
                    <strong>{game.displayName}</strong>
                    <span className="mdx-home-upd-count"><Icon name="refresh" size={13} strokeWidth={2.2} /> {plural(list.length, 'atualização', 'atualizações')}</span>
                    <span className="mdx-home-upd-mods">
                      {list.slice(0, 3).map((m) => (
                        <span key={m.key} className="mdx-home-upd-mod">{m.update?.name || m.name}{m.update?.latestVersion && <em> v{m.update.latestVersion}</em>}</span>
                      ))}
                      {list.length > 3 && <span className="mdx-home-upd-mod more">+{list.length - 3}</span>}
                    </span>
                  </span>
                  <span className="mdx-home-upd-go">Atualizar <Icon name="next" size={15} /></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mdx-home-sec" aria-label="Em alta esta semana">
        <HomeHead
          icon="bolt"
          title="Em alta esta semana"
          sub={desktopReady && trendingGames.length ? 'Os mods mais populares dos jogos que você tem.' : 'Os mods mais populares do momento.'}
        />
        {trending === null ? (
          <div className="mdx-rail">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="mdx-skel mdx-home-skel-mod" />)}</div>
        ) : trending.length === 0 ? (
          <HomeEmpty icon={trendingFailed ? 'alert' : 'bolt'} title={trendingFailed ? 'Não deu pra carregar agora' : 'Nada em alta por aqui ainda'}>
            {trendingFailed ? 'Tente de novo daqui a pouco.' : 'Assim que os jogos com mods tiverem novidades, elas aparecem aqui.'}
          </HomeEmpty>
        ) : (
          <div className="mdx-rail" role="list">
            {trending.map((item) => (
              <TrendingCard
                key={`${item.steamAppId}-${item.key}`}
                item={item}
                canOpen={desktopReady && gamesById.has(Number(item.steamAppId))}
                desktopReady={desktopReady}
                onOpen={() => openTrending(item)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mdx-home-sec" aria-label="Modpacks mais baixados">
        <HomeHead icon="layers" title="Modpacks mais baixados" sub="Pacotes prontos que a comunidade montou — de todos os jogos." />
        {modpacks === null ? (
          <div className="mdx-rail">{[0, 1, 2, 3].map((i) => <div key={i} className="mdx-skel mdx-home-skel-pack" />)}</div>
        ) : modpacks.length === 0 ? (
          <HomeEmpty icon="layers" title="Nenhum modpack publicado ainda">Crie um na aba Modpacks de qualquer jogo e publique — ele aparece aqui.</HomeEmpty>
        ) : (
          <div className="mdx-rail packs" role="list">
            {modpacks.map((mp) => (
              <ModpackCard key={mp.id} mp={mp} canOpen={desktopReady && gamesById.has(Number(mp.steamAppId))} desktopReady={desktopReady} onOpen={() => openModpack(mp)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HomeHead({ icon, title, sub }) {
  return (
    <div className="mdx-home-head">
      <span className="mdx-home-head-icon"><Icon name={icon} size={17} /></span>
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}

function HomeEmpty({ icon, title, children }) {
  return (
    <div className="mdx-home-empty">
      <span className="mdx-empty-icon"><Icon name={icon} size={20} /></span>
      <div><strong>{title}</strong><span>{children}</span></div>
    </div>
  );
}

// Cartão do "Em alta". Abre o mod no gerenciador do jogo quando o jogo
// está no PC; senão só mostra (e diz por quê).
function TrendingCard({ item, canOpen, desktopReady, onOpen }) {
  const Tag = canOpen ? 'button' : 'div';
  return (
    <Tag
      role="listitem"
      {...(canOpen ? { type: 'button', onClick: onOpen, title: `Abrir ${item.name}` } : {})}
      className={`mdx-home-mod ${canOpen ? 'clickable' : ''}`}
    >
      <span className="mdx-home-mod-media">
        <ModThumb url={item.thumbnailUrl} seed={item.name} />
        <span className="mdx-home-mod-game"><Icon name="gamepad" size={12} /> {item.gameName}</span>
      </span>
      <span className="mdx-home-mod-body">
        <strong title={item.name}>{item.name}</strong>
        {item.author && <span className="mdx-home-mod-by">por {item.author}</span>}
        <span className="mdx-home-mod-stats">
          {item.downloads > 0 && <span><Icon name={item.installMethod === 'steam-subscribe' ? 'users' : 'download'} size={13} /> {formatCount(item.downloads)}</span>}
          {item.likes > 0 && <span><Icon name="thumb" size={13} /> {formatCount(item.likes)}</span>}
          {!canOpen && <span className="mdx-home-mod-hint">{desktopReady ? 'Jogo não está no PC' : 'Instale pelo app do PC'}</span>}
        </span>
      </span>
    </Tag>
  );
}

function ModpackCard({ mp, canOpen, desktopReady, onOpen }) {
  const Tag = canOpen ? 'button' : 'div';
  return (
    <Tag role="listitem" {...(canOpen ? { type: 'button', onClick: onOpen, title: `Abrir ${mp.name}` } : {})} className={`mdx-home-pack ${canOpen ? 'clickable' : ''}`}>
      <span className="mdx-home-pack-media">
        <ModpackCover modpack={mp} />
        <span className="mdx-home-mod-game"><Icon name="gamepad" size={12} /> {mp.gameName}</span>
      </span>
      <span className="mdx-home-mod-body">
        <strong title={mp.name}>{mp.name}</strong>
        <span className="mdx-home-pack-author">
          {mp.author && <UserAvatar user={mp.author} size={18} />}
          <span>por <b>{mp.author?.displayName || 'alguém'}</b></span>
        </span>
        <span className="mdx-home-mod-stats">
          <span title="Pessoas que baixaram"><Icon name="download" size={13} /> {formatCount(mp.downloadCount)}</span>
          <span title="Curtidas"><Icon name="thumb" size={13} /> {formatCount(mp.likeCount)}</span>
          <span title="Mods no modpack"><Icon name="puzzle" size={13} /> {mp.itemCount}</span>
          {!canOpen && <span className="mdx-home-mod-hint">{desktopReady ? 'Jogo não está no PC' : 'Baixe pelo app do PC'}</span>}
        </span>
      </span>
    </Tag>
  );
}
