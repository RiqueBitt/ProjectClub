import { useMemo, useState } from 'react';
import { getDeals } from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, GameCover, Ico, fmtMoney, untilLabel, useLoad } from './shared.jsx';

// Game Hub → Promoções: grátis agora (Epic), os próximos grátis, e as
// promoções da Steam e do GOG (em reais) e da Epic (em dólar).
export const STORES = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG' };
const FILTERS = [{ id: 'all', label: 'Todas' }, { id: 'steam', label: 'Steam' }, { id: 'epic', label: 'Epic' }, { id: 'gog', label: 'GOG' }];
const SORTS = [{ id: 'discount', label: 'Maior desconto' }, { id: 'price', label: 'Menor preço' }];

export function StoreBadge({ store }) {
  return <span className={`gh-store s-${store}`}>{STORES[store] || store}</span>;
}

export function FreeCard({ deal, upcoming = false }) {
  return (
    <a className={`gh-free${upcoming ? ' is-soon' : ''}`} href={deal.url} target="_blank" rel="noopener noreferrer">
      <span className="gh-free-art"><GameCover src={deal.image} appId={deal.steamAppId} name={deal.title} /></span>
      <span className="gh-free-body">
        <span className="gh-free-top"><StoreBadge store={deal.store} /><b className="gh-free-tag">{upcoming ? 'Em breve' : 'Grátis'}</b></span>
        <strong className="gh-free-title">{deal.title}</strong>
        <small>
          {upcoming
            ? `Fica grátis em ${untilLabel(deal.startsAt)}`
            : `${deal.price?.base ? `De ${fmtMoney(deal.price.base, deal.price.currency)} por grátis · ` : ''}${deal.endsAt ? `termina em ${untilLabel(deal.endsAt)}` : 'por tempo limitado'}`}
        </small>
      </span>
    </a>
  );
}

export function DealCard({ deal }) {
  const p = deal.price || {};
  return (
    <a className="gh-deal" href={deal.url} target="_blank" rel="noopener noreferrer" title={`Abrir na ${STORES[deal.store]}`}>
      <span className="gh-deal-art">
        <GameCover src={deal.image} appId={deal.steamAppId} name={deal.title} />
        {p.discount > 0 && <b className="gh-deal-off">-{p.discount}%</b>}
      </span>
      <span className="gh-deal-body">
        <strong className="gh-deal-title">{deal.title}</strong>
        <span className="gh-deal-row">
          <StoreBadge store={deal.store} />
          <span className="gh-deal-prices">
            {p.base > 0 && <s>{fmtMoney(p.base, p.currency)}</s>}
            <b>{fmtMoney(p.final, p.currency)}</b>
          </span>
        </span>
        {deal.endsAt && <small className="gh-deal-ends"><Ico name="clock" size={12} /> acaba em {untilLabel(deal.endsAt)}</small>}
      </span>
    </a>
  );
}

export default function DealsTab() {
  const { data, error, loading, reload } = useLoad(() => getDeals(), []);
  const [store, setStore] = useState('all');
  const [sort, setSort] = useState('discount');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const fold = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const term = fold(q.trim());
    const items = (data?.deals || []).filter((d) => (store === 'all' || d.store === store) && (!term || fold(d.title).includes(term)));
    // "Menor preço" compara reais com reais; o que está em dólar vai depois.
    if (sort === 'price') return [...items].sort((a, b) => (a.price.currency === 'USD') - (b.price.currency === 'USD') || a.price.final - b.price.final);
    return items;
  }, [data, store, sort, q]);

  const down = data ? Object.entries(data.stores || {}).filter(([, ok]) => !ok).map(([k]) => STORES[k]) : [];

  return (
    <HubPage className="gh-deals-page">
      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Promoções</h1>
          <p className="gh-sub">Grátis da semana e descontos na Steam, Epic e GOG. Atualiza a cada 30 minutos.</p>
        </div>
      </div>

      {loading && !data ? (
        <div className="gh-deal-grid">{Array.from({ length: 8 }, (_, i) => <span key={i} className="gh-skel gh-deal-skel" />)}</div>
      ) : error && !data ? (
        <EmptyState icon="tag" title="As promoções não carregaram" action={<button type="button" className="gh-btn" onClick={reload}>Tentar de novo</button>}>
          As lojas não responderam agora.
        </EmptyState>
      ) : (
        <>
          {((data?.free || []).length > 0 || (data?.upcoming || []).length > 0) && (
            <section className="gh-section" aria-labelledby="gh-free-h">
              <h2 id="gh-free-h" className="gh-h2"><Ico name="gift" size={20} /> Grátis pra resgatar</h2>
              <div className="gh-free-grid">
                {(data?.free || []).map((d) => <FreeCard key={d.id} deal={d} />)}
                {(data?.upcoming || []).map((d) => <FreeCard key={d.id} deal={d} upcoming />)}
              </div>
            </section>
          )}

          <section className="gh-section" aria-labelledby="gh-deals-h">
            <div className="gh-section-head">
              <h2 id="gh-deals-h" className="gh-h2"><Ico name="tag" size={20} /> Em promoção</h2>
              <div className="gh-tools">
                <div className="gh-chips" role="tablist" aria-label="Loja">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" role="tab" aria-selected={store === f.id} className={`gh-chip${store === f.id ? ' on' : ''}`} onClick={() => setStore(f.id)}>{f.label}</button>
                  ))}
                </div>
                <label className="gh-select">
                  <span className="sr-only">Ordenar</span>
                  <select value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
                <label className="gh-search gh-search-sm">
                  <Ico name="search" size={15} />
                  <span className="sr-only">Buscar promoção</span>
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" />
                </label>
              </div>
            </div>
            {list.length === 0 ? (
              <EmptyState icon="search" title="Nada por aqui">Nenhuma promoção com esse filtro agora.</EmptyState>
            ) : (
              <div className="gh-deal-grid">{list.map((d) => <DealCard key={d.id} deal={d} />)}</div>
            )}
            <p className="gh-fine">
              Preços da Steam e do GOG em reais, da loja brasileira. As promoções da Epic vêm do CheapShark, em dólar.
              {down.length > 0 && ` Fora do ar agora: ${down.join(', ')}.`}
            </p>
          </section>
        </>
      )}
    </HubPage>
  );
}
