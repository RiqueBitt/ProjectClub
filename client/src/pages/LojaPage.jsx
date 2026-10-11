import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico } from '../components/PagesKit.jsx';
import { MockProfile, decoValue, effectValue } from '../components/shop/ShopPreviews.jsx';
import { getShop, buyDecoration, equipDecoration, buyEffect, equipEffect, buyCollection } from '../api/decorations';
import { useLiveRefresh } from '../utils/liveRefresh';
import { trackMissionEvent } from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import '../styles/shop.css';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';
const KIND_LABEL = { deco: 'Moldura de avatar', effect: 'Efeito de perfil' };
const SORTS = [
  { id: 'recent', label: 'Mais recentes' },
  { id: 'cheap', label: 'Menor preço' },
  { id: 'expensive', label: 'Maior preço' },
  { id: 'name', label: 'Nome (A-Z)' },
];
const TYPES = [
  { id: 'deco', label: 'Molduras de avatar', icon: 'frame' },
  { id: 'effect', label: 'Efeitos de perfil', icon: 'sparkles' },
  { id: 'collection', label: 'Coleções', icon: 'grid' },
];
// Preço usado pra ordenar: moedas; se só vende em gemas, gemas valem 100.
const sortPrice = (i) => (i.priceCoins != null ? i.priceCoins : i.priceGems != null ? i.priceGems * 100 : Infinity);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Loja: molduras de avatar, efeitos de perfil e coleções (criados pela staff
// em Painel → Loja), pagos com moedas ou gemas.
export default function LojaPage() {
  const { user, setUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('destaques');
  const [collectionId, setCollectionId] = useState(null);
  const [detail, setDetail] = useState(null); // item aberto no modal
  const [sort, setSort] = useState('recent');
  const [types, setTypes] = useState([]); // vazio = tudo
  const [query, setQuery] = useState('');

  const load = useCallback(async (ctx) => {
    try {
      const d = await getShop();
      if (!ctx || ctx.ok()) setData(d);
    } catch (e) { if (!ctx) setNotice({ bad: true, text: errMsg(e) }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Missão "Visite a Loja" (Economia) — avisa o servidor uma vez por abertura.
  useEffect(() => { trackMissionEvent('SHOP_VISIT').catch(() => {}); }, []);
  useLiveRefresh(load, { key: 'loja' });

  const flash = (text, bad = false) => { setNotice({ text, bad }); setTimeout(() => setNotice(null), 3500); };

  const items = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.decorations || []).map((d) => ({ ...d, kind: 'deco' })),
      ...(data.effects || []).map((e) => ({ ...e, kind: 'effect' })),
    ];
  }, [data]);
  const collections = useMemo(() => data?.collections || [], [data]);
  const isEquipped = (i) => (i.kind === 'deco' ? i.id === data?.equippedId : i.id === data?.equippedEffectId);

  const buy = async (i, currency) => {
    setBusy(`${i.id}:${currency}`);
    try {
      await (i.kind === 'deco' ? buyDecoration(i.id, currency) : buyEffect(i.id, currency));
      flash(`"${i.name}" é sua! Toque em Usar pra equipar.`);
      await load();
    } catch (e) { flash(errMsg(e), true); }
    setBusy('');
  };
  const equip = async (kind, id) => {
    setBusy(`eq:${kind}`);
    try {
      const r = await (kind === 'deco' ? equipDecoration(id) : equipEffect(id));
      if (r.user) setUser((u) => ({ ...u, ...r.user }));
      if (kind === 'deco') flash(id ? 'Moldura aplicada no seu avatar.' : 'Moldura removida.');
      else flash(id ? 'Efeito aplicado no seu perfil.' : 'Efeito removido.');
      await load();
    } catch (e) { flash(errMsg(e), true); }
    setBusy('');
  };
  const buyBundle = async (c, currency) => {
    setBusy(`col:${c.id}:${currency}`);
    try {
      await buyCollection(c.id, currency);
      flash(`Coleção "${c.name}" comprada!`);
      await load();
    } catch (e) { flash(errMsg(e), true); }
    setBusy('');
  };

  const openCollection = (id) => { setCollectionId(id); setDetail(null); };
  const goBrowse = (type) => { setCollectionId(null); setTab('navegar'); setTypes(type ? [type] : []); };
  const current = collectionId ? collections.find((c) => c.id === collectionId) : null;

  const ctx = { user, data, busy, buy, equip, isEquipped, open: setDetail };

  return (
    <div className="shop-scroll">
      <div className="shop-page">
        <header className="shop-top">
          <div className="shop-top-title">
            <span className="shop-top-icon"><Ico name="store" size={20} /></span>
            <h1>Loja</h1>
          </div>
          <div className="shop-tabs" role="tablist" aria-label="Seções da loja">
            {[['destaques', 'Destaques', 'star'], ['navegar', 'Navegar', 'search']].map(([id, label, icon]) => (
              <button
                key={id} type="button" role="tab" aria-selected={tab === id && !current}
                className={`shop-tab${tab === id && !current ? ' active' : ''}`}
                onClick={() => { setCollectionId(null); setTab(id); }}
              ><Ico name={icon} size={15} /> {label}</button>
            ))}
          </div>
          <div className="shop-balances">
            <span className="shop-bal coins" title="Moedas"><Ico name="coin" size={16} /> {fmt(data?.coins)}</span>
            <span className="shop-bal gems" title="Gemas"><Ico name="gem" size={16} /> {fmt(data?.gems)}</span>
          </div>
        </header>

        {notice && <div className={`shop-notice${notice.bad ? ' bad' : ''}`} role="status">{notice.text}</div>}

        {!data ? (
          <>
            <div className="shop-hero-skel shop-skel" />
            <div className="shop-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="shop-card shop-skel" style={{ height: 250 }} />)}</div>
          </>
        ) : current ? (
          <CollectionView c={current} items={items.filter((i) => i.collectionId === current.id)} onBack={() => setCollectionId(null)} buyBundle={buyBundle} {...ctx} />
        ) : tab === 'destaques' ? (
          <Featured collections={collections} items={items} openCollection={openCollection} goBrowse={goBrowse} {...ctx} />
        ) : (
          <Browse
            items={items} collections={collections} sort={sort} setSort={setSort} types={types} setTypes={setTypes}
            query={query} setQuery={setQuery} openCollection={openCollection} {...ctx}
          />
        )}
      </div>
      {detail && <ItemModal item={detail} onClose={() => setDetail(null)} collection={collections.find((c) => c.id === detail.collectionId)} openCollection={openCollection} {...ctx} />}
    </div>
  );
}

// ---------- Destaques ----------
function Featured({ collections, items, openCollection, goBrowse, ...ctx }) {
  const featured = collections.filter((c) => c.featured);
  const newest = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  return (
    <>
      {featured.length > 0 ? <HeroCarousel list={featured} items={items} openCollection={openCollection} /> : (
        <section className="shop-hero-plain">
          <span className="shop-kicker"><Ico name="sparkles" size={14} /> Loja do Project Club</span>
          <h2>Deixe seu perfil com a sua cara</h2>
          <p>Molduras pro avatar e efeitos animados que aparecem por cima do seu perfil. Tudo pago com moedas ou gemas.</p>
          <button type="button" className="shop-btn primary" onClick={() => goBrowse()}>Ver tudo</button>
        </section>
      )}

      <section className="shop-section">
        <div className="shop-section-head">
          <h2>Novidades</h2>
          <button type="button" className="shop-link" onClick={() => goBrowse()}>Ver tudo <Ico name="arrowRight" size={14} /></button>
        </div>
        {newest.length === 0 ? <Empty text="Nada à venda ainda. Volte em breve!" /> : (
          <div className="shop-grid">{newest.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} {...ctx} />)}</div>
        )}
      </section>

      <section className="shop-section">
        <div className="shop-section-head"><h2>Encontre seu estilo</h2></div>
        <div className="shop-styles">
          <button type="button" className="shop-style-tile" onClick={() => goBrowse('deco')}>
            <span className="shop-style-ico"><Ico name="frame" size={22} /></span>
            <strong>Molduras de avatar</strong><small>{count('deco')} itens</small>
          </button>
          <button type="button" className="shop-style-tile" onClick={() => goBrowse('effect')}>
            <span className="shop-style-ico"><Ico name="sparkles" size={22} /></span>
            <strong>Efeitos de perfil</strong><small>{count('effect')} itens</small>
          </button>
          {collections.map((c) => (
            <button
              key={c.id} type="button" className="shop-style-tile has-art" onClick={() => openCollection(c.id)}
              style={{ '--col-accent': c.accentColor || 'var(--brand)' }}
            >
              {c.bannerUrl && <img className="shop-style-art" src={proxyImage(c.bannerUrl)} alt="" loading="lazy" />}
              <strong>{c.name}</strong><small>{items.filter((i) => i.collectionId === c.id).length} itens</small>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function HeroCarousel({ list, items, openCollection }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = list.length;
  useEffect(() => {
    if (n < 2 || paused || reduceMotion()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setIdx((i) => (i + 1) % n); }, 7000);
    return () => clearInterval(t);
  }, [n, paused]);
  const c = list[Math.min(idx, n - 1)];
  const go = (d) => setIdx((i) => (i + d + n) % n);
  const total = items.filter((i) => i.collectionId === c.id).length;
  return (
    <section
      className="shop-carousel" style={{ '--col-accent': c.accentColor || 'var(--brand)' }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carrossel"
    >
      <div key={c.id} className="shop-slide">
        {c.bannerUrl && <img className="shop-slide-art" src={proxyImage(c.bannerUrl)} alt="" />}
        <div className="shop-slide-shade" />
        <div className="shop-slide-content">
          <span className="shop-kicker">Coleção em destaque</span>
          {c.logoUrl ? <img className="shop-slide-logo" src={proxyImage(c.logoUrl)} alt={c.name} /> : <h2>{c.name}</h2>}
          {c.description && <p>{c.description}</p>}
          <div className="shop-slide-actions">
            <button type="button" className="shop-btn primary" onClick={() => openCollection(c.id)}>Ver coleção</button>
            <span className="shop-slide-count">{total} {total === 1 ? 'item' : 'itens'}</span>
          </div>
        </div>
      </div>
      {n > 1 && (
        <>
          <button type="button" className="shop-car-nav prev" aria-label="Anterior" onClick={() => go(-1)}><Ico name="left" size={18} /></button>
          <button type="button" className="shop-car-nav next" aria-label="Próxima" onClick={() => go(1)}><Ico name="right" size={18} /></button>
          <div className="shop-dots">
            {list.map((x, i) => (
              <button key={x.id} type="button" aria-label={`Coleção ${i + 1}`} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- Navegar ----------
function Browse({ items, collections, sort, setSort, types, setTypes, query, setQuery, openCollection, ...ctx }) {
  const q = query.trim().toLowerCase();
  const want = (t) => types.length === 0 || types.includes(t);
  const list = items
    .filter((i) => want(i.kind) && (!q || i.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sort === 'cheap') return sortPrice(a) - sortPrice(b);
      if (sort === 'expensive') return (sortPrice(b) === Infinity ? -1 : sortPrice(b)) - (sortPrice(a) === Infinity ? -1 : sortPrice(a));
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  const cols = want('collection') ? collections.filter((c) => !q || c.name.toLowerCase().includes(q)) : [];
  const toggle = (t) => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <div className="shop-browse">
      <div className="shop-browse-main">
        <div className="shop-browse-bar">
          <label className="shop-search">
            <Ico name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar na loja" aria-label="Buscar na loja" />
            {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><Ico name="close" size={14} /></button>}
          </label>
          <label className="shop-sort">
            <span>Ordenar</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {cols.length > 0 && (
          <div className="shop-col-grid">
            {cols.map((c) => (
              <button key={c.id} type="button" className="shop-col-card" style={{ '--col-accent': c.accentColor || 'var(--brand)' }} onClick={() => openCollection(c.id)}>
                {c.bannerUrl && <img src={proxyImage(c.bannerUrl)} alt="" loading="lazy" />}
                <span className="shop-col-card-shade" />
                <span className="shop-col-card-text"><small>Coleção</small><strong>{c.name}</strong></span>
              </button>
            ))}
          </div>
        )}
        {list.length === 0 && cols.length === 0 ? <Empty text="Nada encontrado com esses filtros." /> : (
          <div className="shop-grid">{list.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} {...ctx} />)}</div>
        )}
      </div>
      <aside className="shop-filters" aria-label="Filtros">
        <h3>Exibir apenas</h3>
        {TYPES.map((t) => (
          <button key={t.id} type="button" className={`shop-filter${types.includes(t.id) ? ' on' : ''}`} aria-pressed={types.includes(t.id)} onClick={() => toggle(t.id)}>
            <span className="shop-filter-box">{types.includes(t.id) && <Ico name="check" size={12} strokeWidth={3} />}</span>
            <Ico name={t.icon} size={15} /> {t.label}
          </button>
        ))}
        {types.length > 0 && <button type="button" className="shop-link" onClick={() => setTypes([])}>Limpar filtros</button>}
      </aside>
    </div>
  );
}

// ---------- Página da coleção ----------
function CollectionView({ c, items, onBack, buyBundle, ...ctx }) {
  const { busy } = ctx;
  const missing = items.filter((i) => !i.owned);
  return (
    <>
      <section className="shop-colhero" style={{ '--col-accent': c.accentColor || 'var(--brand)' }}>
        {c.bannerUrl && <img className="shop-slide-art" src={proxyImage(c.bannerUrl)} alt="" />}
        <div className="shop-slide-shade" />
        <button type="button" className="shop-back" onClick={onBack}><Ico name="left" size={16} /> Voltar</button>
        <div className="shop-slide-content">
          <span className="shop-kicker">Coleção</span>
          {c.logoUrl ? <img className="shop-slide-logo" src={proxyImage(c.logoUrl)} alt={c.name} /> : <h2>{c.name}</h2>}
          {c.description && <p>{c.description}</p>}
          {(c.bundlePriceCoins != null || c.bundlePriceGems != null) && (
            <div className="shop-bundle">
              {missing.length === 0 ? <span className="shop-owned-chip"><Ico name="check" size={14} /> Você já tem tudo</span> : (
                <>
                  <span className="shop-bundle-label">Pacote com {missing.length === items.length ? 'tudo' : `os ${missing.length} que faltam`}</span>
                  {c.bundlePriceCoins != null && (
                    <button type="button" className="shop-btn coins solid" disabled={!!busy} onClick={() => buyBundle(c, 'coins')}>
                      <Ico name="coin" size={15} /> {fmt(c.bundlePriceCoins)}
                    </button>
                  )}
                  {c.bundlePriceGems != null && (
                    <button type="button" className="shop-btn gems solid" disabled={!!busy} onClick={() => buyBundle(c, 'gems')}>
                      <Ico name="gem" size={15} /> {fmt(c.bundlePriceGems)}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>
      {items.length === 0 ? <Empty text="Essa coleção ainda não tem itens." /> : (
        <div className="shop-grid">{items.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} {...ctx} />)}</div>
      )}
    </>
  );
}

// ---------- Cartão / modal ----------
function Preview({ item, user, big = false }) {
  if (item.kind === 'deco') {
    return <div className="shop-art-deco"><UserAvatar user={{ ...user, avatarDecoration: decoValue(item) }} size={big ? 150 : 96} /></div>;
  }
  return <MockProfile user={user} effect={effectValue(item)} size={big ? 'big' : 'card'} />;
}

function PriceButtons({ item, data, busy, buy }) {
  if (item.priceCoins == null && item.priceGems == null) return <span className="shop-muted">Indisponível</span>;
  return (
    <div className="shop-prices">
      {item.priceCoins != null && (
        <button type="button" className="shop-btn coins" disabled={!!busy || data.coins < item.priceCoins} onClick={(e) => { e.stopPropagation(); buy(item, 'coins'); }}>
          <Ico name="coin" size={15} /> {fmt(item.priceCoins)}
        </button>
      )}
      {item.priceGems != null && (
        <button type="button" className="shop-btn gems" disabled={!!busy || data.gems < item.priceGems} onClick={(e) => { e.stopPropagation(); buy(item, 'gems'); }}>
          <Ico name="gem" size={15} /> {fmt(item.priceGems)}
        </button>
      )}
    </div>
  );
}

function ItemCard({ item, user, data, busy, buy, equip, isEquipped, open }) {
  const on = isEquipped(item);
  return (
    <article className={`shop-card${on ? ' equipped' : ''}`}>
      <button type="button" className="shop-card-art" onClick={() => open(item)} aria-label={`Ver ${item.name}`}>
        <Preview item={item} user={user} />
        {on ? <span className="shop-tag on">Em uso</span> : item.owned ? <span className="shop-tag">Adquirido</span> : null}
      </button>
      <div className="shop-card-info">
        <small>{KIND_LABEL[item.kind]}</small>
        <h3 title={item.name}>{item.name}</h3>
        {item.owned ? (
          <button type="button" className={`shop-btn${on ? ' ghost' : ' primary'}`} disabled={!!busy} onClick={() => equip(item.kind, on ? null : item.id)}>
            {on ? 'Tirar' : 'Usar'}
          </button>
        ) : <PriceButtons item={item} data={data} busy={busy} buy={buy} />}
      </div>
    </article>
  );
}

function ItemModal({ item: initial, onClose, collection, openCollection, user, data, busy, buy, equip, isEquipped }) {
  // Pega a versão mais nova do item (depois de comprar/usar).
  const all = [...(data.decorations || []).map((d) => ({ ...d, kind: 'deco' })), ...(data.effects || []).map((e) => ({ ...e, kind: 'effect' }))];
  const item = all.find((i) => i.kind === initial.kind && i.id === initial.id) || initial;
  const on = isEquipped(item);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="shop-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shop-modal" role="dialog" aria-modal="true" aria-label={item.name}>
        <button type="button" className="shop-modal-close" aria-label="Fechar" onClick={onClose}><Ico name="close" size={18} /></button>
        <div className="shop-modal-art"><Preview item={item} user={user} big /></div>
        <div className="shop-modal-info">
          <small className="shop-modal-kind">{KIND_LABEL[item.kind]}</small>
          <h2>{item.name}</h2>
          <p>
            {item.kind === 'deco'
              ? 'Fica em volta da sua foto em todo lugar: chat, lista de membros e perfil.'
              : 'Uma animação que passa por cima do seu perfil e do seu mini perfil quando alguém abre (e de novo a cada 30 segundos).'}
          </p>
          {collection && (
            <button type="button" className="shop-link" onClick={() => openCollection(collection.id)}>
              Da coleção {collection.name} <Ico name="arrowRight" size={14} />
            </button>
          )}
          <div className="shop-modal-actions">
            {item.owned ? (
              <button type="button" className={`shop-btn big${on ? ' ghost' : ' primary'}`} disabled={!!busy} onClick={() => equip(item.kind, on ? null : item.id)}>
                {on ? 'Tirar' : 'Usar'}
              </button>
            ) : <PriceButtons item={item} data={data} busy={busy} buy={buy} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="shop-empty">
      <span className="shop-empty-ico"><Ico name="store" size={22} /></span>
      <strong>Nada por aqui</strong>
      <span>{text}</span>
    </div>
  );
}
