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
import '../styles/contentx.css';
import { useStore } from '../store/useStore';
import { getShopHistory, giftShopItem } from '../api/contentx';

// "2d 4h" / "3h 12min" / "45s" — contagem regressiva da oferta.
function countdown(target, now) {
  const ms = new Date(target).getTime() - now;
  if (!(ms > 0)) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return m > 0 ? `${m}min ${sec}s` : `${sec}s`;
}
// Relógio que só roda enquanto existe oferta na tela (1s perto do fim).
function useNow(enabled) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}
// Selo da oferta: "-30% · termina em 2d 4h" (ou "começa em ..." se ainda não abriu).
function OfferBadge({ offer, now, big }) {
  if (!offer) return null;
  const active = offer.active && new Date(offer.endsAt).getTime() > now;
  const startsIn = !active && offer.startsAt ? countdown(offer.startsAt, now) : null;
  const endsIn = active ? countdown(offer.endsAt, now) : null;
  if (!endsIn && !startsIn) return null;
  return (
    <span className={`cxs-offer${big ? ' big' : ''}${active ? '' : ' soon'}`}>
      <Ico name="bolt" size={big ? 15 : 13} strokeWidth={2.2} />
      <b>-{offer.discount}%</b>
      <span>{active ? `termina em ${endsIn}` : `começa em ${startsIn}`}</span>
    </span>
  );
}

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
  const [giftFor, setGiftFor] = useState(null); // item a presentear

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

  const ctx = { user, data, busy, buy, equip, isEquipped, open: setDetail, gift: setGiftFor };
  const hasOffer = collections.some((c) => c.offer);
  const now = useNow(hasOffer);

  return (
    <div className="shop-scroll">
      <div className="shop-page">
        <header className="shop-top">
          <div className="shop-top-title">
            <span className="shop-top-icon"><Ico name="store" size={20} /></span>
            <h1>Loja</h1>
          </div>
          <div className="shop-tabs" role="tablist" aria-label="Seções da loja">
            {[['destaques', 'Destaques', 'star'], ['navegar', 'Navegar', 'search'], ['historico', 'Histórico', 'clock']].map(([id, label, icon]) => (
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
          <CollectionView c={current} now={now} items={items.filter((i) => i.collectionId === current.id)} onBack={() => setCollectionId(null)} buyBundle={buyBundle} {...ctx} />
        ) : tab === 'historico' ? (
          <ShopHistory />
        ) : tab === 'destaques' ? (
          <Featured collections={collections} now={now} items={items} openCollection={openCollection} goBrowse={goBrowse} {...ctx} />
        ) : (
          <Browse
            items={items} collections={collections} sort={sort} setSort={setSort} types={types} setTypes={setTypes}
            query={query} setQuery={setQuery} openCollection={openCollection} {...ctx}
          />
        )}
      </div>
      {detail && <ItemModal item={detail} onClose={() => setDetail(null)} collection={collections.find((c) => c.id === detail.collectionId)} openCollection={openCollection} {...ctx} />}
      {giftFor && (
        <GiftModal
          item={giftFor} data={data} onClose={() => setGiftFor(null)}
          onDone={(r, friendName) => { setGiftFor(null); setData((d) => (d ? { ...d, coins: r.coins ?? d.coins, gems: r.gems ?? d.gems } : d)); flash(`Presente enviado para ${friendName}!`); }}
        />
      )}
    </div>
  );
}

// ---------- Destaques ----------
function Featured({ collections, items, openCollection, goBrowse, now, ...ctx }) {
  const featured = collections.filter((c) => c.featured);
  const newest = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  return (
    <>
      {featured.length > 0 ? <HeroCarousel list={featured} items={items} openCollection={openCollection} now={now} /> : (
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
              <OfferBadge offer={c.offer} now={now} />
              <strong>{c.name}</strong><small>{items.filter((i) => i.collectionId === c.id).length} itens</small>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function HeroCarousel({ list, items, openCollection, now }) {
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
          <OfferBadge offer={c.offer} now={now} big />
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
function CollectionView({ c, items, onBack, buyBundle, now, ...ctx }) {
  const { busy } = ctx;
  const offerOn = !!c.offer?.active && new Date(c.offer.endsAt).getTime() > now;
  const priceCoins = offerOn ? c.finalBundleCoins : c.bundlePriceCoins;
  const priceGems = offerOn ? c.finalBundleGems : c.bundlePriceGems;
  const missing = items.filter((i) => !i.owned);
  return (
    <>
      <section className="shop-colhero" style={{ '--col-accent': c.accentColor || 'var(--brand)' }}>
        {c.bannerUrl && <img className="shop-slide-art" src={proxyImage(c.bannerUrl)} alt="" />}
        <div className="shop-slide-shade" />
        <button type="button" className="shop-back" onClick={onBack}><Ico name="left" size={16} /> Voltar</button>
        <div className="shop-slide-content">
          <span className="shop-kicker">Coleção</span>
          <OfferBadge offer={c.offer} now={now} big />
          {c.logoUrl ? <img className="shop-slide-logo" src={proxyImage(c.logoUrl)} alt={c.name} /> : <h2>{c.name}</h2>}
          {c.description && <p>{c.description}</p>}
          {(c.bundlePriceCoins != null || c.bundlePriceGems != null) && (
            <div className="shop-bundle">
              {missing.length === 0 ? <span className="shop-owned-chip"><Ico name="check" size={14} /> Você já tem tudo</span> : (
                <>
                  <span className="shop-bundle-label">Pacote com {missing.length === items.length ? 'tudo' : `os ${missing.length} que faltam`}</span>
                  {c.bundlePriceCoins != null && (
                    <button type="button" className="shop-btn coins solid" disabled={!!busy} onClick={() => buyBundle(c, 'coins')}>
                      <Ico name="coin" size={15} /> {offerOn && <s className="cxs-old">{fmt(c.bundlePriceCoins)}</s>} {fmt(priceCoins)}
                    </button>
                  )}
                  {c.bundlePriceGems != null && (
                    <button type="button" className="shop-btn gems solid" disabled={!!busy} onClick={() => buyBundle(c, 'gems')}>
                      <Ico name="gem" size={15} /> {offerOn && <s className="cxs-old">{fmt(c.bundlePriceGems)}</s>} {fmt(priceGems)}
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

function ItemModal({ item: initial, onClose, collection, openCollection, user, data, busy, buy, equip, isEquipped, gift }) {
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
          {(item.priceCoins != null || item.priceGems != null) && (
            <button type="button" className="shop-btn ghost cxs-gift-btn" onClick={() => { onClose(); gift(item); }}>
              <Ico name="gift" size={16} /> Presentear um amigo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Presentear ----------
// Você paga com a sua moeda; o amigo ganha o item e recebe um aviso.
function GiftModal({ item, data, onClose, onDone }) {
  const friends = useStore((s) => s.friends);
  const accepted = useMemo(() => friends.filter((f) => f.status === 'ACCEPTED' && f.user).map((f) => f.user)
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'pt-BR')), [friends]);
  const [q, setQ] = useState('');
  const [toId, setToId] = useState(null);
  const [currency, setCurrency] = useState(item.priceCoins != null ? 'coins' : 'gems');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const term = q.trim().toLowerCase();
  const list = term ? accepted.filter((u) => `${u.displayName} ${u.username}`.toLowerCase().includes(term)) : accepted;
  const price = currency === 'gems' ? item.priceGems : item.priceCoins;
  const balance = currency === 'gems' ? data?.gems : data?.coins;
  const friend = accepted.find((u) => u.id === toId);
  const send = async () => {
    if (!friend) return;
    setBusy(true); setError('');
    try {
      const r = await giftShopItem({ kind: item.kind, id: item.id, toUserId: friend.id, currency, note });
      onDone(r, friend.displayName);
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="shop-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="shop-modal cxs-gift" role="dialog" aria-modal="true" aria-label={`Presentear ${item.name}`}>
        <button type="button" className="shop-modal-close" aria-label="Fechar" onClick={onClose}><Ico name="close" size={18} /></button>
        <div className="cxs-gift-body">
          <span className="cxs-gift-icon"><Ico name="gift" size={22} /></span>
          <h2>Presentear "{item.name}"</h2>
          <p className="shop-muted">Você paga com a sua carteira e o amigo ganha o item na hora, com um aviso.</p>
          {accepted.length === 0 ? (
            <div className="shop-empty"><strong>Sem amigos ainda</strong><span>Adicione amigos em Social pra poder presentear.</span></div>
          ) : (
            <>
              <label className="shop-search cxs-gift-search">
                <Ico name="search" size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar amigo" aria-label="Buscar amigo" />
              </label>
              <ul className="cxs-gift-friends" role="listbox" aria-label="Amigos">
                {list.slice(0, 50).map((u) => (
                  <li key={u.id}>
                    <button type="button" role="option" aria-selected={toId === u.id} className={toId === u.id ? 'on' : ''} onClick={() => setToId(u.id)}>
                      <UserAvatar user={u} size={30} />
                      <span className="truncate">{u.displayName}</span>
                      {toId === u.id && <Ico name="check" size={15} strokeWidth={2.6} />}
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="shop-muted cxs-gift-none">Nenhum amigo com esse nome.</li>}
              </ul>
              <label className="cxs-gift-note">
                <span>Mensagem (opcional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Ex.: Feliz aniversário!" />
              </label>
              <div className="cxs-gift-pay">
                {item.priceCoins != null && (
                  <button type="button" className={`shop-btn coins${currency === 'coins' ? ' solid' : ''}`} aria-pressed={currency === 'coins'} onClick={() => setCurrency('coins')}>
                    <Ico name="coin" size={15} /> {fmt(item.priceCoins)}
                  </button>
                )}
                {item.priceGems != null && (
                  <button type="button" className={`shop-btn gems${currency === 'gems' ? ' solid' : ''}`} aria-pressed={currency === 'gems'} onClick={() => setCurrency('gems')}>
                    <Ico name="gem" size={15} /> {fmt(item.priceGems)}
                  </button>
                )}
              </div>
              {balance != null && price != null && balance < price && <p className="cxs-gift-warn">Saldo insuficiente nessa moeda.</p>}
              {error && <p className="cxs-gift-warn">{error}</p>}
              <button type="button" className="shop-btn primary big cxs-gift-send" disabled={!friend || busy || (balance != null && price != null && balance < price)} onClick={send}>
                <Ico name="gift" size={16} /> {busy ? 'Enviando...' : friend ? `Enviar para ${friend.displayName}` : 'Escolha um amigo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Histórico ----------
function ShopHistory() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    getShopHistory().then(setData).catch((e) => { setError(errMsg(e)); setData({ purchases: [], received: [], hasMore: false }); });
  }, []);
  const more = async () => {
    const list = data?.purchases || [];
    if (!list.length) return;
    setLoadingMore(true);
    try {
      const d = await getShopHistory({ before: list[list.length - 1].createdAt });
      setData((cur) => ({ ...cur, purchases: [...cur.purchases, ...(d.purchases || [])], hasMore: d.hasMore }));
    } catch { /* tenta de novo no próximo clique */ }
    setLoadingMore(false);
  };
  const when = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!data) return <div className="cxs-history">{[0, 1, 2, 3].map((i) => <div key={i} className="shop-skel cxs-history-skel" />)}</div>;
  return (
    <div className="cxs-history">
      {error && <div className="shop-notice bad">{error}</div>}
      {(data.received || []).length > 0 && (
        <section className="shop-section">
          <div className="shop-section-head"><h2>Presentes recebidos</h2></div>
          <ul className="cxs-history-list">
            {data.received.map((n) => (
              <li key={n.id}>
                <span className="cxs-history-ico gift"><Ico name="gift" size={18} /></span>
                <div className="cxs-history-text"><strong className="truncate">{n.title}</strong><small>{n.body}</small></div>
                <time>{when(n.createdAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="shop-section">
        <div className="shop-section-head"><h2>Compras e presentes enviados</h2></div>
        {data.purchases.length === 0 ? <Empty text="Suas compras e presentes aparecem aqui." /> : (
          <ul className="cxs-history-list">
            {data.purchases.map((t) => (
              <li key={t.id}>
                <span className={`cxs-history-ico ${t.kind === 'GIFT' ? 'gift' : ''}`}><Ico name={t.kind === 'GIFT' ? 'gift' : 'store'} size={18} /></span>
                <div className="cxs-history-text"><strong className="truncate">{t.label}</strong><small>{when(t.createdAt)}</small></div>
                <span className="cxs-history-cost">
                  {t.coins !== 0 && <span className="coins"><Ico name="coin" size={13} strokeWidth={2} /> {fmt(Math.abs(t.coins))}</span>}
                  {t.gems !== 0 && <span className="gems"><Ico name="gem" size={13} strokeWidth={2} /> {fmt(Math.abs(t.gems))}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.hasMore && <button type="button" className="shop-btn ghost cxs-history-more" disabled={loadingMore} onClick={more}>{loadingMore ? 'Carregando...' : 'Ver mais'}</button>}
      </section>
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
