import { useEffect, useMemo, useRef, useState } from 'react';
import { isDesktopModsAvailable, modFolderName, openWorkshopItemInSteam } from '../../utils/mods';
import {
  Icon, formatCount, EmptyState, SkeletonGrid, SearchField, ChipRow, ModThumb, LoadMore, SOURCE_META, useModsManager,
} from './shared.jsx';
import { searchUnifiedMods, refineCompat, compatLabel } from './unifiedApi.js';

// Aba "Explorar" UNIFICADA — item pedido: "em vez de mostrar separado
// por mod.io/GameBanana etc., mostre tudo junto, com as categorias de
// mods do jogo" + "mostre quais mods são compatíveis e quais não". O
// servidor junta todas as fontes do jogo (GET /mods/unified/:steamAppId)
// e já diz a compatibilidade; a fonte vira só um chip pequeno no cartão.
// Abrir um cartão leva pra página de detalhe que cada fonte já tinha.
const SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

// Chave usada pelo instalador (nome da pasta/entrada do manifesto) pra
// saber se o mod já está instalado.
function installedKeyOf(item) {
  return modFolderName(item.source === 'thunderstore' ? item.sourceId : item.name);
}

export default function UnifiedExplore({ game, localProfile, onOpenMod }) {
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders, workshopIds } = useModsManager();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState(null); // profile/workshopNote do servidor
  const [nextToken, setNextToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    const reqId = ++reqRef.current;
    setItems(null);
    setLoadError('');
    const timeout = setTimeout(() => {
      searchUnifiedMods(game.steamAppId, { q: query.trim() || undefined, sort, category: category || undefined })
        .then((d) => {
          if (reqId !== reqRef.current) return;
          setItems(d.items || []);
          if (d.categories) setCategories(d.categories);
          setSources(d.sources || []);
          setMeta({ profile: d.profile, workshopNote: d.workshopNote });
          setNextToken(d.nextPageToken || null);
        })
        .catch((err) => {
          if (reqId !== reqRef.current) return;
          setItems([]);
          setLoadError(err.response?.data?.error || 'Não foi possível buscar mods agora.');
        });
    }, 280);
    return () => clearTimeout(timeout);
  }, [game.steamAppId, query, sort, category, reloadKey]);

  const loadMore = async () => {
    if (!nextToken) return;
    setLoadingMore(true);
    try {
      const d = await searchUnifiedMods(game.steamAppId, { q: query.trim() || undefined, sort, category: category || undefined, pageToken: nextToken });
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.key));
        return [...prev, ...(d.items || []).filter((i) => !seen.has(i.key))];
      });
      setNextToken(d.nextPageToken || null);
    } catch {
      setLoadError('Não foi possível carregar mais mods agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  const decorated = useMemo(() => (items || []).map((item) => {
    const compat = refineCompat(item, localProfile);
    const installed = item.source === 'workshop'
      ? workshopIds.includes(item.sourceId)
      : desktopReady && installedFolders.has(installedKeyOf(item));
    return { item, compat, installed };
  }), [items, localProfile, workshopIds, installedFolders, desktopReady]);

  const hiddenCount = decorated.filter((d) => d.compat.kind === 'bad').length;
  const shown = showIncompatible ? decorated : decorated.filter((d) => d.compat.kind !== 'bad');
  const failed = sources.filter((s) => !s.ok);
  const loaderNote = meta?.profile?.loader && localProfile?.loader?.installed === false && localProfile.loader.required
    ? localProfile.loader : null;

  return (
    <div className="mdx-ux">
      {meta?.profile?.blocked && <p className="mdx-note warn"><Icon name="alert" size={15} /> {meta.profile.blocked}</p>}
      {loaderNote && (
        <p className="mdx-note">
          <Icon name="info" size={15} />
          {loaderNote.autoInstall
            ? `Mods deste jogo usam o ${loaderNote.label}. Ele ainda não está instalado — o Project Club instala junto com o primeiro mod.`
            : `Mods deste jogo precisam do ${loaderNote.label}, que ainda não está instalado. ${loaderNote.howTo || ''}`}
        </p>
      )}

      {(meta?.profile?.loadOrderNote || localProfile?.loadOrderUnsupported) && (
        <p className="mdx-note"><Icon name="info" size={15} /> {meta?.profile?.loadOrderNote || 'A ordem de carga dos mods é feita dentro do jogo, não pelo Project Club.'}</p>
      )}

      <div className="mdx-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder={`Pesquisar mods de ${game.displayName}...`} />
        <ChipRow options={SORT_OPTIONS} value={sort} onChange={setSort} label="Ordenar" />
      </div>

      {categories.length > 0 && (
        <div className="mdx-ux-cats" role="group" aria-label="Categorias">
          <button type="button" className={`mdx-chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>Todas</button>
          {categories.slice(0, 40).map((c) => (
            <button key={c.name} type="button" className={`mdx-chip ${category === c.name ? 'active' : ''}`} onClick={() => setCategory(category === c.name ? '' : c.name)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="mdx-ux-bar">
        <span className="mdx-result-count">
          {items === null ? 'Buscando em todas as fontes...' : `${shown.length} ${shown.length === 1 ? 'mod' : 'mods'}${nextToken ? '+' : ''}`}
          {items !== null && sources.length > 0 && (
            <span className="mdx-ux-srcs">
              {' · de '}
              {sources.filter((s) => s.ok && !s.skipped).map((s) => SOURCE_META[s.source]?.label).filter(Boolean).join(', ') || 'nenhuma fonte'}
            </span>
          )}
        </span>
        <label className={`mdx-ux-toggle ${showIncompatible ? 'on' : ''}`}>
          <input type="checkbox" checked={showIncompatible} onChange={(e) => setShowIncompatible(e.target.checked)} />
          <span className="mdx-ux-toggle-track" aria-hidden="true"><span /></span>
          Mostrar incompatíveis{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
        </label>
      </div>

      {failed.length > 0 && items !== null && (
        <p className="mdx-note warn small">
          <Icon name="alert" size={15} />
          <span>
            {failed.map((s) => SOURCE_META[s.source]?.long || s.source).join(', ')} não {failed.length === 1 ? 'respondeu' : 'responderam'} agora — mostrando o resto.
            <button type="button" className="mdx-inline-link" onClick={() => setReloadKey((k) => k + 1)}>Tentar de novo</button>
          </span>
        </p>
      )}

      {items === null ? (
        <SkeletonGrid count={8} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={loadError ? 'alert' : 'search'}
          tone={loadError ? 'danger' : undefined}
          title={loadError ? 'Não foi possível buscar' : hiddenCount > 0 ? 'Só achamos mods incompatíveis' : 'Nenhum mod encontrado'}
          action={hiddenCount > 0 && !loadError ? (
            <button type="button" className="mdx-btn ghost" onClick={() => setShowIncompatible(true)}>Mostrar incompatíveis</button>
          ) : loadError ? (
            <button type="button" className="mdx-btn ghost" onClick={() => setReloadKey((k) => k + 1)}><Icon name="refresh" size={15} /> Tentar de novo</button>
          ) : null}
        >
          {loadError || (hiddenCount > 0 ? 'Eles estão escondidos porque não funcionariam neste jogo.' : 'Tente outra busca ou outra categoria.')}
        </EmptyState>
      ) : (
        <>
          <div className="mdx-mod-grid">
            {shown.map(({ item, compat, installed }) => (
              <UnifiedCard key={item.key} item={item} compat={compat} installed={installed} onOpen={() => onOpenMod(item, compat)} />
            ))}
          </div>
          {nextToken && <LoadMore busy={loadingMore} onClick={loadMore} />}
        </>
      )}
    </div>
  );
}

const COMPAT_ICON = { ok: 'check', auto: 'bolt', loader: 'alert', bad: 'close', steam: 'external' };

export function CompatBadge({ compat, full = false }) {
  const label = compatLabel(compat);
  return (
    <span className={`mdx-compat ${compat.kind}`} title={compat.reason || label}>
      <Icon name={COMPAT_ICON[compat.kind] || 'check'} size={12} strokeWidth={2.4} />
      <span>{full && compat.kind === 'bad' && compat.reason ? `${label}: ${compat.reason}` : label}</span>
    </span>
  );
}

function UnifiedCard({ item, compat, installed, onOpen }) {
  const src = SOURCE_META[item.source];
  const isWorkshop = item.installMethod === 'steam-subscribe';
  const dim = compat.kind === 'bad';
  const stats = [
    item.downloads > 0 && { icon: isWorkshop ? 'users' : 'download', value: formatCount(item.downloads) },
    item.likes > 0 && { icon: item.source === 'thunderstore' ? 'star' : 'thumb', value: formatCount(item.likes) },
  ].filter(Boolean);
  const body = (
    <>
      <div className="mdx-tile-media">
        <ModThumb url={item.thumbnailUrl} seed={item.name} />
        {installed && (
          <span className="mdx-tile-badge"><Icon name="check" size={13} strokeWidth={2.6} /> {isWorkshop ? 'Inscrito' : 'Instalado'}</span>
        )}
        {src && <span className="mdx-ux-src" style={{ '--src': src.color }}><span className="mdx-source-dot" />{src.label}</span>}
      </div>
      <div className="mdx-tile-body">
        <span className="mdx-tile-title">{item.name}</span>
        {item.author && <span className="mdx-tile-author">por {item.author}</span>}
        <div className="mdx-ux-compat-line">
          <CompatBadge compat={compat} />
          {dim && compat.reason && <span className="mdx-ux-reason">{compat.reason}</span>}
        </div>
        {stats.length > 0 && (
          <div className="mdx-tile-stats">
            {stats.map((s) => <span key={s.icon} className="mdx-stat"><Icon name={s.icon} size={13} /> {s.value}</span>)}
          </div>
        )}
      </div>
    </>
  );
  if (isWorkshop) {
    // Workshop não tem página nossa: a inscrição acontece no cliente da
    // Steam (steam://), nunca no navegador.
    return (
      <div className={`mdx-tile mdx-ux-tile ${dim ? 'dim' : ''}`}>
        {body}
        <div className="mdx-tile-actions">
          <button type="button" className={`mdx-btn ${installed ? 'ghost' : 'primary'} sm block`} onClick={() => openWorkshopItemInSteam(item.sourceId)}>
            <Icon name={installed ? 'external' : 'plus'} size={15} /> {installed ? 'Ver na Steam' : 'Inscrever-se pela Steam'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className={`mdx-tile mdx-ux-tile ${dim ? 'dim' : ''}`} onClick={onOpen}>
      {body}
    </button>
  );
}
