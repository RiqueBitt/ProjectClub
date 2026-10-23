import { useEffect, useState } from 'react';
import { listWorkshopItems } from '../../api/endpoints';
import { isDesktopModsAvailable, openWorkshopItemInSteam } from '../../utils/mods';
import { Icon, formatCount, EmptyState, SkeletonGrid, SearchField, ChipRow, ModTile, LoadMore, useModsManager } from './shared.jsx';

// ---------- Steam Workshop (aba "Explorar") ----------
// Bem mais simples que mod.io: não existe download/instalação nossa
// aqui — a própria Steam cuida disso quando a pessoa clica
// "Inscrever-se" (abre o item dentro do cliente da Steam via steam://).
// Por isso também não tem perfis, coleções, favoritos ou comentários
// pro Workshop — a página do item já tem tudo isso nativo da Steam.
const WORKSHOP_SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais inscrições' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

export function WorkshopBrowse({ game }) {
  const desktopReady = isDesktopModsAvailable();
  const { workshopIds } = useModsManager();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');

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
  // a API da Valve pagina por "cursor" (não por número de página).
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

  return (
    <>
      {game.note && <p className="mdx-note"><Icon name="info" size={15} /> {game.note}</p>}
      {!desktopReady && (
        <p className="mdx-note"><Icon name="monitor" size={15} /> Ver o que já está inscrito precisa do app de desktop — buscar e abrir itens na Steam funciona por aqui mesmo assim.</p>
      )}
      <div className="mdx-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Pesquisar no Workshop..." />
        <ChipRow options={WORKSHOP_SORT_OPTIONS} value={sort} onChange={setSort} label="Ordenar" />
      </div>
      {items !== null && items.length > 0 && (
        <p className="mdx-result-count">{total} {total === 1 ? 'item no Steam Workshop' : 'itens no Steam Workshop'}</p>
      )}

      {items === null ? (
        <SkeletonGrid count={8} />
      ) : items.length === 0 ? (
        <EmptyState icon={loadError ? 'alert' : 'search'} tone={loadError ? 'danger' : undefined} title={loadError ? 'Não foi possível buscar' : 'Nenhum item encontrado'}>
          {loadError || 'Tente outra busca ou outro filtro.'}
        </EmptyState>
      ) : (
        <>
          <div className="mdx-mod-grid">
            {items.map((item) => {
              const installed = workshopIds.includes(item.publishedfileid);
              return (
                <ModTile
                  key={item.publishedfileid}
                  thumb={item.preview_url}
                  title={item.title}
                  author={item.short_description}
                  installed={installed}
                  installedLabel="Inscrito"
                  stats={[
                    { icon: 'users', value: formatCount(item.subscriptions) },
                    item.vote_data?.votes_up > 0 && { icon: 'thumb', value: formatCount(item.vote_data.votes_up) },
                  ]}
                >
                  <button type="button" className={`mdx-btn ${installed ? 'ghost' : 'primary'} sm block`} onClick={() => openWorkshopItemInSteam(item.publishedfileid)}>
                    <Icon name={installed ? 'external' : 'plus'} size={15} /> {installed ? 'Ver na Steam' : 'Inscrever-se'}
                  </button>
                </ModTile>
              );
            })}
          </div>
          {nextCursor && (
            <LoadMore busy={loadingMore} onClick={loadMoreItems} label={`Ver mais (${items.length} de ${total})`} />
          )}
        </>
      )}
    </>
  );
}
