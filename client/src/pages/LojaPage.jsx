import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico } from '../components/PagesKit.jsx';
import { MockProfile, decoValue, effectValue } from '../components/shop/ShopPreviews.jsx';
import { getShop, buyDecoration, equipDecoration, buyEffect, equipEffect, buyCollection, buyFont, equipFont, buyStyle, equipStyle, redeemShopCode, getGiftsSummary } from '../api/decorations';
import { getMyWishlist, toggleWishlistItem } from '../api/endpoints';
import { SHOP_TAGS, SHOP_COLORS } from '../components/shop/ShopItemFlagsFields.jsx';
import ShopTryOn from '../components/shop/ShopTryOn.jsx';
import ShopTrades from '../components/shop/ShopTrades.jsx';
import { nameStyleProps } from '../utils/nameStyle';
import { useLiveRefresh } from '../utils/liveRefresh';
import { trackMissionEvent } from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import { useStore } from '../store/useStore';
import { getShopHistory, giftShopItem } from '../api/contentx';
import ShopCardsTab from '../cards/ShopCardsTab.jsx';
import { CardBack } from '../cards/CardView.jsx';
import { cardsCosmetics, cardsBuyCosmetic, cardsEquipCosmetic } from '../cards/api';
import { isFeatureEnabled } from '../utils/features';
import '../styles/shop.css';
import '../styles/shop-room.css';
import '../styles/contentx.css';
import '../styles/cards.css';

// Loja do Project Club.
//
// Organização inspirada nas lojas de comunidade (menu de categorias à
// esquerda, vitrine com destaques/novidades/exclusivos, cards grandes e
// detalhe sem sair da página), com a identidade do Project Club. As cores
// vêm do tema que a pessoa escolheu (.shop-room deriva as suas variáveis
// das variáveis de tema), então no escuro a Loja fica escura também.
//
// Tudo é real: o preço final (com desconto de Assinante) vem calculado do
// servidor, a compra manda o preço que a pessoa confirmou e o servidor
// recusa se o valor mudou, e o que se compra cai direto no inventário.

const CARDS_WAR_ON = isFeatureEnabled('cardsWar');
const DEFAULT_BACK = 'back:classico';
const BUY = { deco: buyDecoration, effect: buyEffect, font: buyFont, style: buyStyle };
const EQUIP = { deco: equipDecoration, effect: equipEffect, font: equipFont, style: equipStyle };
const styleKey = (i) => i?.data?.style || (i?.key || '').replace(/^style:/, '') || null;
const fontValue = (i) => (i?.data?.family ? JSON.stringify({ id: i.id, family: i.data.family, url: i.data.url || null }) : null);

const gemOnly = (i) => i.priceGems != null && i.priceCoins == null && !i.exclusiveTier && i.kind !== 'back';
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const errOf = (e) => e?.response?.data || {};
const errMsg = (e) => errOf(e).error || 'Não deu certo, tente de novo.';
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const KIND = {
  deco: { label: 'Moldura de avatar', plural: 'Molduras de avatar', icon: 'frame', blurb: 'Fica em volta da sua foto em todo lugar: chat, lista de membros, mini perfil e perfil completo.' },
  effect: { label: 'Efeito de perfil', plural: 'Efeitos de perfil', icon: 'sparkles', blurb: 'Uma animação que passa por cima do seu mini perfil e do perfil completo quando alguém abre (e de novo a cada 30 segundos).' },
  font: { label: 'Fonte do nome', plural: 'Fontes do nome', icon: 'font', blurb: 'Muda a fonte do seu nome no perfil, no mini perfil, no chat e na lista de membros. Vale no lugar da fonte grátis escolhida no perfil.' },
  style: { label: 'Estilo de perfil', plural: 'Estilos de perfil', icon: 'palette', blurb: 'Muda o visual inteiro do seu perfil e do mini perfil: fundo, botões, barras, seções e fontes.' },
  back: { label: 'Verso de carta', plural: 'Versos de cartas', icon: 'cards', blurb: 'Verso das suas cartas na Guerra das Cartas: aparece no seu baralho, na sua mão para o oponente e nas pilhas da mesa.' },
};
const TIER_LABEL = { SUBSCRIBER: 'Assinante', SUPER: 'Super Assinante' };
const RARITY_LABEL = { COMUM: 'Comum', INCOMUM: 'Incomum', RARA: 'Rara', EPICA: 'Épica', LENDARIA: 'Lendária', MITICA: 'Mítica' };
const SORTS = [
  { id: 'foryou', label: 'Para você' },
  { id: 'recent', label: 'Novidades' },
  { id: 'trending', label: 'Em alta' },
  { id: 'popular', label: 'Mais populares' },
  { id: 'cheap', label: 'Menor preço' },
  { id: 'expensive', label: 'Maior preço' },
  { id: 'name', label: 'Nome (A–Z)' },
  { id: 'shuffle', label: 'Embaralhado' },
];
// "Para você": pontua cada item pelo que a pessoa já tem/curte (mesma
// coleção, mesmo tipo, lista de desejos, novidades) — nada de dado externo.
function forYouScore(item, ctx) {
  if (item.owned) return -100;
  let score = 0;
  const owned = ctx.ownedStats || {};
  if (item.collectionId && owned.collections?.has(item.collectionId)) score += 6;
  score += Math.min(4, owned.kinds?.[item.kind] || 0);
  if (ctx.inWish?.(item)) score += 8;
  if (item.limited && item.remaining > 0) score += 3;
  if (item.featured) score += 2;
  if (Date.now() - new Date(item.createdAt).getTime() < 14 * 86400000) score += 2;
  score += Math.min(3, (item.popularity || 0) / 10);
  if (item.locked) score -= 5;
  return score;
}
// Embaralhar estável enquanto a semente não muda (botão "Embaralhar!").
const seededRank = (id, seed) => {
  let h = seed >>> 0;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0;
  return h;
};
const AVAIL = [
  { id: 'all', label: 'Tudo' },
  { id: 'available', label: 'À venda' },
  { id: 'owned', label: 'Adquiridos' },
  { id: 'equipped', label: 'Equipados' },
  { id: 'exclusive', label: 'Exclusivos' },
];
const PRICE_RANGES = [
  { id: 'all', label: 'Qualquer preço' },
  { id: 'free', label: 'Grátis', test: (p) => p === 0 },
  { id: 'low', label: 'Até 250', test: (p) => p > 0 && p <= 250 },
  { id: 'mid', label: '251 a 1.000', test: (p) => p > 250 && p <= 1000 },
  { id: 'high', label: 'Acima de 1.000', test: (p) => p > 1000 },
];
const CURRENCIES = [
  { id: 'all', label: 'Moedas e gemas' },
  { id: 'coins', label: 'Moedas' },
  { id: 'gems', label: 'Gemas' },
];

// Preço que a pessoa paga numa moeda: { base, final, discount } ou null.
function priceOf(item, currency) {
  const p = item.pricing?.[currency];
  if (p && p.final !== null && p.final !== undefined) return p;
  const base = currency === 'gems' ? item.priceGems : item.priceCoins;
  if (base === null || base === undefined) return null;
  return { base, final: base, discount: 0 };
}
const sellsIn = (item) => ['coins', 'gems'].filter((c) => priceOf(item, c));
// Preço de comparação (ordenar/filtrar): moedas; só gemas vale 100x.
const comparePrice = (i) => {
  const c = priceOf(i, 'coins'); if (c) return c.final;
  const g = priceOf(i, 'gems'); return g ? g.final * 100 : Infinity;
};
const isNew = (i, now) => i.createdAt && now - new Date(i.createdAt).getTime() < 14 * 86400000;

// Versos de cartas (Guerra das Cartas) entram na mesma vitrine.
function allItems(data) {
  const backs = (data?.cosmetics?.items || [])
    .filter((c) => c.kind === 'BACK' && (c.owned || (c.source === 'SHOP' && c.priceGems)))
    .map((c) => ({
      id: c.id, key: c.key, kind: 'back', name: c.name, rarity: c.rarity, priceCoins: null,
      priceGems: c.source === 'SHOP' ? c.priceGems : null, owned: !!c.owned, createdAt: c.createdAt || 0, popularity: 0,
    }));
  return [
    ...(data?.decorations || []).map((d) => ({ ...d, kind: 'deco' })),
    ...(data?.effects || []).map((e) => ({ ...e, kind: 'effect' })),
    ...(data?.fonts || []).map((f) => ({ ...f, kind: 'font' })),
    ...(data?.styles || []).map((st) => ({ ...st, kind: 'style' })),
    ...backs,
  ];
}

// "2d 4h" / "3h 12min" / "45s" — contagem regressiva das ofertas.
function countdown(target, now) {
  const ms = new Date(target).getTime() - now;
  if (!(ms > 0)) return null;
  const d = Math.floor(ms / 86400000); const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return m > 0 ? `${m}min ${s}s` : `${s}s`;
}
function useNow(enabled) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}
function useEscape(onClose) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
}

export default function LojaPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [section, setSection] = useState(() => (params.get('tab') === 'trocas' ? 'trades' : CARDS_WAR_ON && params.get('cat') === 'versos' ? 'back' : 'home'));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('foryou');
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [wish, setWish] = useState(() => new Set());
  const [colorF, setColorF] = useState('');
  const [tagF, setTagF] = useState('');
  useEffect(() => {
    getMyWishlist().then((d) => setWish(new Set((d.wishlist || []).map((w) => `${w.kind}:${w.id}`)))).catch(() => {});
  }, []);
  const [avail, setAvail] = useState('all');
  const [currency, setCurrency] = useState('all');
  const [range, setRange] = useState('all');
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null); // { item | collection, currency }
  const [giftFor, setGiftFor] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const mainRef = useRef(null);

  const load = useCallback(async (ctx) => {
    try {
      const [d, cos] = await Promise.all([getShop(), CARDS_WAR_ON ? cardsCosmetics().catch(() => null) : null]);
      if (!ctx || ctx.ok()) { setData({ ...d, cosmetics: cos }); setLoadError(''); }
    } catch (e) { if (!ctx) setLoadError(errMsg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { trackMissionEvent('SHOP_VISIT').catch(() => {}); }, []);
  useLiveRefresh(load, { key: 'loja' });
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const flash = (text, tone = 'ok') => {
    clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  };

  const items = useMemo(() => allItems(data), [data]);
  const collections = useMemo(() => data?.collections || [], [data]);
  const supporter = data?.supporter || { tier: 'NONE', discount: 0 };
  const isEquipped = useCallback((i) => (i.kind === 'back' ? i.key === (data?.cosmetics?.equipped?.back || DEFAULT_BACK)
    : i.kind === 'deco' ? i.id === data?.equippedId
      : i.kind === 'font' ? i.id === data?.equippedFontId
        : i.kind === 'style' ? !!data?.equippedStyle && styleKey(i) === data.equippedStyle
          : i.id === data?.equippedEffectId), [data]);
  const now = useNow(collections.some((c) => c.offer));

  const go = (s) => {
    setSection(s); setQuery('');
    if (s !== section) { setAvail('all'); setCurrency('all'); setRange('all'); }
    mainRef.current?.scrollTo?.({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };

  // ---- ações ----
  const purchase = async ({ item, collection, currency: cur }, expected) => {
    const target = item || collection;
    setBusy(`buy:${target.id}`);
    try {
      let r;
      if (collection) r = await buyCollection(collection.id, cur, expected);
      else if (item.kind === 'back') r = await cardsBuyCosmetic(item.id);
      else r = await BUY[item.kind](item.id, cur, expected);
      setConfirm(null);
      setData((d) => (d && r && r.coins !== undefined ? { ...d, coins: r.coins, gems: r.gems } : d));
      flash(collection ? `Coleção "${collection.name}" adicionada aos seus itens.` : `"${item.name}" agora é seu. Já está no seu inventário.`);
      await load();
      return { ok: true };
    } catch (e) {
      const b = errOf(e);
      if (b.code === 'PRICE_CHANGED') { await load(); return { ok: false, priceChanged: b.price, error: b.error }; }
      if (b.code === 'SOLD_OUT') { setConfirm(null); await load(); flash('Esgotado! Alguém levou a última cópia.', 'bad'); return { ok: false }; }
      if (b.code === 'ALREADY_OWNED') { setConfirm(null); await load(); flash('Você já tem esse item.', 'info'); return { ok: false }; }
      return { ok: false, error: errMsg(e) };
    } finally { setBusy(''); }
  };

  const equip = async (item, on) => {
    setBusy(`eq:${item.kind}:${item.id}`);
    try {
      if (item.kind === 'back') {
        await cardsEquipCosmetic(on ? item.key : DEFAULT_BACK);
        flash(on ? `Verso "${item.name}" em uso nas suas partidas.` : 'Voltou para o verso Clássico.');
      } else {
        const r = await EQUIP[item.kind](on ? item.id : null);
        if (r.user) setUser((u) => ({ ...u, ...r.user }));
        flash(on ? `"${item.name}" equipado.` : `"${item.name}" removido do perfil (continua no seu inventário).`);
      }
      await load();
    } catch (e) { flash(errMsg(e), 'bad'); }
    setBusy('');
  };

  const inWish = useCallback((i) => wish.has(`${i.kind}:${i.id}`), [wish]);
  const toggleWish = async (item) => {
    if (item.kind === 'back') return;
    const key = `${item.kind}:${item.id}`;
    const on = !wish.has(key);
    setWish((w) => { const n = new Set(w); if (on) n.add(key); else n.delete(key); return n; });
    try {
      await toggleWishlistItem(item.kind, item.id, on);
      flash(on ? `"${item.name}" na sua lista de desejos. Seus amigos podem ver e te presentear.` : `"${item.name}" saiu da lista de desejos.`, 'info');
    } catch (e) {
      setWish((w) => { const n = new Set(w); if (on) n.delete(key); else n.add(key); return n; });
      flash(errMsg(e), 'bad');
    }
  };
  const ownedStats = useMemo(() => {
    const kinds = {}; const cols = new Set();
    items.forEach((i) => { if (i.owned) { kinds[i.kind] = (kinds[i.kind] || 0) + 1; if (i.collectionId) cols.add(i.collectionId); } });
    return { kinds, collections: cols };
  }, [items]);
  const ctx = {
    user, data, supporter, busy, isEquipped, now, open: setDetail, equip, askBuy: (item, cur) => setConfirm({ item, currency: cur }), gift: setGiftFor,
    inWish, toggleWish, ownedStats, shuffleSeed, colorF, setColorF, tagF, setTagF,
    variantsOf: (i) => (i.variantGroup ? items.filter((x) => x.kind === i.kind && x.variantGroup === i.variantGroup) : []),
    share: (i) => { try { navigator.clipboard.writeText(`${window.location.origin}/loja?item=${i.kind}:${i.id}`); flash('Link do item copiado.', 'info'); } catch { /* sem área de transferência */ } }, reshuffle: () => { setSort('shuffle'); setShuffleSeed(Math.floor(Math.random() * 1e9)); },
  };

  // Link de item compartilhado: /loja?item=deco:ID
  const itemParam = params.get('item');
  const itemHandled = useRef(false);
  useEffect(() => {
    if (!data || !itemParam || itemHandled.current) return;
    itemHandled.current = true;
    const [k, id] = itemParam.split(':');
    const it = items.find((i) => i.kind === k && i.id === id);
    if (it) setDetail(it); else flash('Esse item não está mais na Loja.', 'info');
  }, [data, itemParam, items]);
  // "Adquira este visual" (perfil de alguém): /loja?look=deco:ID,style:KEY&from=Nome
  const lookParam = params.get('look');
  useEffect(() => { if (lookParam) setSection('look'); }, [lookParam]);

  // Link "Presentear" vindo da Lista de desejos de um amigo: /loja?gift=deco:ID&to=USER
  const giftParam = params.get('gift');
  const giftTo = params.get('to');
  const giftHandled = useRef(false);
  useEffect(() => {
    if (!data || !giftParam || giftHandled.current) return;
    giftHandled.current = true;
    const [k, id] = giftParam.split(':');
    const it = items.find((i) => i.kind === k && i.id === id);
    if (it) setGiftFor({ ...it, presetTo: giftTo || null });
    else flash('Esse item não está mais à venda.', 'info');
  }, [data, giftParam, giftTo, items]);

  // ---- navegação ----
  const count = (k) => items.filter((i) => i.kind === k).length;
  const exclusives = items.filter((i) => i.exclusiveTier);
  const limiteds = items.filter((i) => i.limited);
  const ownedItems = items.filter((i) => i.owned);
  const nav = [
    { group: 'Descobrir', items: [
      { id: 'home', label: 'Início', icon: 'house' },
      { id: 'collections', label: 'Coleções', icon: 'grid', n: collections.length },
      { id: 'tryon', label: 'Provador', icon: 'user' },
    ] },
    { group: 'Categorias', items: [
      { id: 'deco', label: KIND.deco.plural, icon: 'frame', n: count('deco') },
      { id: 'effect', label: KIND.effect.plural, icon: 'sparkles', n: count('effect') },
      ...(count('font') > 0 ? [{ id: 'font', label: KIND.font.plural, icon: 'font', n: count('font') }] : []),
      ...(count('style') > 0 ? [{ id: 'style', label: KIND.style.plural, icon: 'palette', n: count('style') }] : []),
      ...(CARDS_WAR_ON && count('back') > 0 ? [{ id: 'back', label: KIND.back.plural, icon: 'cards', n: count('back') }] : []),
      ...(CARDS_WAR_ON ? [{ id: 'cards', label: 'Pacotes de cartas', icon: 'bag' }] : []),
    ] },
    { group: 'Especiais', items: [
      ...(limiteds.length > 0 ? [{ id: 'limited', label: 'Limitados', icon: 'star', n: limiteds.filter((i) => i.remaining > 0).length }] : []),
      { id: 'exclusive', label: 'Exclusivos de apoio', icon: 'crown', n: exclusives.length },
      { id: 'gems', label: 'Exclusivos de gemas', icon: 'gem', n: items.filter(gemOnly).length },
      { id: 'plans', label: 'Comparar planos', icon: 'star' },
    ] },
    { group: 'Você', items: [
      { id: 'owned', label: 'Meus itens', icon: 'inbox', n: ownedItems.length },
      { id: 'wishlist', label: 'Lista de desejos', icon: 'heart', n: items.filter(inWish).length },
      { id: 'gifts', label: 'Presentes e códigos', icon: 'gift' },
      { id: 'trades', label: 'Trocas', icon: 'swap' },
      { id: 'history', label: 'Histórico', icon: 'clock' },
    ] },
  ];
  const collection = section.startsWith('col:') ? collections.find((c) => c.id === section.slice(4)) : null;
  const searching = query.trim().length > 0;

  let content;
  if (!data) content = loadError ? <LoadFailed text={loadError} retry={() => load()} /> : <Skeleton />;
  else if (searching) content = <Catalog title={`Resultados para "${query.trim()}"`} list={items} {...{ query, sort, setSort, avail, setAvail, currency, setCurrency, range, setRange }} ctx={ctx} />;
  else if (collection) content = <CollectionPage c={collection} items={items.filter((i) => i.collectionId === collection.id)} onBack={() => go('collections')} onBuy={(cur) => setConfirm({ collection, currency: cur })} ctx={ctx} />;
  else if (section === 'home') content = <Home items={items} collections={collections} go={go} ctx={ctx} />;
  else if (section === 'collections') content = <CollectionsPage collections={collections} items={items} go={go} now={now} />;
  else if (section === 'limited') content = <Catalog title="Itens limitados" subtitle="Estoque contado: quando acaba, só dá pra conseguir trocando com quem tem. Cada cópia tem um número de série (#1, #2…)." list={limiteds} {...{ query, sort, setSort, avail, setAvail, currency, setCurrency, range, setRange }} ctx={ctx} />;
  else if (section === 'trades') content = <ShopTrades flash={flash} onWallet={(w) => setData((d) => (d ? { ...d, coins: w.coins ?? d.coins, gems: w.gems ?? d.gems } : d))} reload={load} />;
  else if (KIND[section]) content = <Catalog title={KIND[section].plural} subtitle={KIND[section].blurb} list={items.filter((i) => i.kind === section)} {...{ query, sort, setSort, avail, setAvail, currency, setCurrency, range, setRange }} ctx={ctx} />;
  else if (section === 'exclusive') content = <ExclusivePage list={exclusives} ctx={ctx} />;
  else if (section === 'owned') content = <OwnedPage list={ownedItems} go={go} ctx={ctx} />;
  else if (section === 'wishlist') content = <WishlistPage list={items.filter(inWish)} go={go} ctx={ctx} />;
  else if (section === 'gifts') content = <GiftsPage go={go} onWallet={(w) => setData((d) => (d ? { ...d, coins: w.coins ?? d.coins, gems: w.gems ?? d.gems } : d))} reload={load} flash={flash} />;
  else if (section === 'plans') content = <PlansPage supporter={supporter} />;
  else if (section === 'gems') content = <GemsPage list={items.filter(gemOnly)} ctx={ctx} />;
  else if (section === 'tryon') content = <ShopTryOn items={items} user={user} data={data} ctx={ctx} />;
  else if (section === 'look') content = <LookPage look={lookParam} from={params.get('from')} items={items} ctx={ctx} />;
  else if (section === 'cards') content = <ShopCardsTab onWallet={(w) => setData((d) => (d ? { ...d, coins: w.coins, gems: w.gems } : d))} />;
  else content = <ShopHistory />;

  return (
    <div className="shop-scroll shop-room">
      <div className="room-layout">
        <aside className="room-nav" aria-label="Categorias da loja">
          <div className="room-brand">
            <span className="room-brand-ico"><Ico name="store" size={18} /></span>
            <div><strong>Loja</strong><small>Project Club</small></div>
          </div>
          <nav className="room-nav-scroll">
            {nav.map((g) => (
              <div key={g.group} className="room-nav-group">
                <span className="room-nav-label">{g.group}</span>
                {g.items.map((n) => {
                  const active = !searching && (section === n.id || (n.id === 'collections' && !!collection));
                  return (
                    <button key={n.id} type="button" className={`room-nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => go(n.id)}>
                      <Ico name={n.icon} size={17} />
                      <span>{n.label}</span>
                      {n.n > 0 && <em>{n.n}</em>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <SupporterCard supporter={supporter} compact />
        </aside>

        <main className="room-main" ref={mainRef}>
          <header className="room-top">
            <label className="room-search">
              <Ico name="search" size={17} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar molduras, efeitos, fontes, estilos…" aria-label="Buscar na loja" />
              {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><Ico name="close" size={14} /></button>}
            </label>
            <div className="room-wallet" aria-label="Seu saldo">
              <span className="room-bal coins" title="Moedas"><Ico name="coin" size={18} /> {fmt(data?.coins)}</span>
              <span className="room-bal gems" title="Gemas"><Ico name="gem" size={18} /> {fmt(data?.gems)}</span>
            </div>
          </header>
          <div className="room-content">{content}</div>
        </main>
      </div>

      {toast && <div className={`room-toast ${toast.tone}`} role="status" aria-live="polite"><Ico name={toast.tone === 'bad' ? 'close' : 'check'} size={16} strokeWidth={2.4} /> {toast.text}</div>}
      {detail && (
        <ItemDetail
          initial={detail} items={items} collections={collections} onClose={() => setDetail(null)}
          openCollection={(id) => { setDetail(null); go(`col:${id}`); }} ctx={ctx}
        />
      )}
      {confirm && <ConfirmPurchase req={confirm} data={data} busy={!!busy} onCancel={() => setConfirm(null)} onConfirm={purchase} />}
      {giftFor && (
        <GiftModal
          item={giftFor} data={data} onClose={() => setGiftFor(null)}
          onDone={(r, name) => { setGiftFor(null); setData((d) => (d ? { ...d, coins: r.coins ?? d.coins, gems: r.gems ?? d.gems } : d)); flash(`Presente enviado para ${name}!`); }}
        />
      )}
    </div>
  );
}

// ---------- Apoio ----------
function SupporterCard({ supporter, compact }) {
  const tier = supporter?.tier || 'NONE';
  if (tier === 'NONE') {
    return (
      <div className={`room-supporter is-none${compact ? ' compact' : ''}`}>
        <span className="room-supporter-ico"><Ico name="crown" size={16} /></span>
        <div>
          <strong>Apoie o Project Club</strong>
          <small>Assinantes têm 15% de desconto em itens elegíveis e itens exclusivos.</small>
        </div>
      </div>
    );
  }
  return (
    <div className={`room-supporter tier-${tier.toLowerCase()}${compact ? ' compact' : ''}`}>
      <span className="room-supporter-ico"><Ico name="crown" size={16} /></span>
      <div>
        <strong>{TIER_LABEL[tier]}</strong>
        <small>{supporter.discount}% de desconto aplicado automaticamente nos itens elegíveis.</small>
      </div>
    </div>
  );
}

// ---------- Início ----------
function Home({ items, collections, go, ctx }) {
  const featuredCols = collections.filter((c) => c.featured);
  const forSale = items.filter((i) => !i.exclusiveTier);
  const featured = items.filter((i) => i.featured);
  const spotlight = (featured.length ? featured : [...forSale].sort((a, b) => b.popularity - a.popularity)).slice(0, 8);
  const newest = [...forSale].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const popular = [...forSale].filter((i) => i.popularity > 0).sort((a, b) => b.popularity - a.popularity).slice(0, 8);
  const exclusives = items.filter((i) => i.exclusiveTier).slice(0, 8);
  const limited = items.filter((i) => i.limited && i.remaining > 0).sort((a, b) => a.remaining - b.remaining).slice(0, 8);
  return (
    <div className="room-stack">
      {featuredCols.length > 0 ? <HeroCarousel list={featuredCols} items={items} go={go} now={ctx.now} /> : (
        <section className="room-hero-plain">
          <span className="room-kicker"><Ico name="sparkles" size={14} /> Loja do Project Club</span>
          <h1>Deixe seu perfil com a sua cara</h1>
          <p>Molduras para o avatar, efeitos animados no perfil e coleções completas. Veja como fica antes de comprar.</p>
          <button type="button" className="room-btn primary" onClick={() => go('deco')}>Explorar a loja</button>
        </section>
      )}
      {(ctx.data?.banners || []).length > 0 && (
        <div className="room-banners">
          {ctx.data.banners.map((b) => (
            <button key={b.id} type="button" className="room-banner" style={{ '--bn': b.accentColor || '#7c3aed', backgroundImage: b.imageUrl ? `url(${proxyImage(b.imageUrl)})` : undefined }}
              onClick={() => b.collectionId && go(`col:${b.collectionId}`)}
            >
              {b.badge && <span className="room-banner-badge">{b.badge}</span>}
              <span className="room-banner-text"><strong>{b.title}</strong>{b.subtitle && <small>{b.subtitle}</small>}</span>
              {b.buttonLabel && <span className="room-banner-btn">{b.buttonLabel}</span>}
            </button>
          ))}
        </div>
      )}
      {ctx.supporter.tier !== 'NONE' && <SupporterCard supporter={ctx.supporter} />}
      <Shelf title={featured.length ? 'Em destaque' : 'Os favoritos da comunidade'} list={spotlight} ctx={ctx} />
      {limited.length > 0 && <Shelf title="Limitados — enquanto durar o estoque" hint="Acabou, só por troca" list={limited} onMore={() => go('limited')} ctx={ctx} />}
      <Shelf title="Novidades" list={newest} onMore={() => go('deco')} moreLabel="Ver catálogo" ctx={ctx} />
      {collections.filter((c) => c.featured).slice(0, 4).map((c) => {
        const colItems = items.filter((i) => i.collectionId === c.id).slice(0, 8);
        return colItems.length > 0 && <Shelf key={c.id} title={c.name} list={colItems} onMore={() => go(`col:${c.id}`)} moreLabel={`Página da loja – ${c.name}`} ctx={ctx} />;
      })}
      {exclusives.length > 0 && <Shelf title="Exclusivos de apoio" hint="Liberados para Assinantes e Super Assinantes" list={exclusives} onMore={() => go('exclusive')} ctx={ctx} />}
      {collections.length > 0 && (
        <section className="room-section">
          <SectionHead title="Coleções" onMore={() => go('collections')} />
          <CollectionTiles collections={collections.slice(0, 6)} items={items} go={go} now={ctx.now} />
        </section>
      )}
      {popular.length > 0 && featured.length > 0 && <Shelf title="Mais populares" list={popular} ctx={ctx} />}
      <section className="room-section">
        <SectionHead title="Categorias" />
        <div className="room-cats">
          {['deco', 'effect', ...['font', 'style'].filter((k) => items.some((i) => i.kind === k)), ...(CARDS_WAR_ON && items.some((i) => i.kind === 'back') ? ['back'] : [])].map((k) => (
            <button key={k} type="button" className={`room-cat k-${k}`} onClick={() => go(k)}>
              <span className="room-cat-ico"><Ico name={KIND[k].icon} size={22} /></span>
              <strong>{KIND[k].plural}</strong>
              <small>{items.filter((i) => i.kind === k).length} itens</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionHead({ title, hint, onMore, moreLabel = 'Ver tudo' }) {
  return (
    <div className="room-section-head">
      <div><h2>{title}</h2>{hint && <small>{hint}</small>}</div>
      {onMore && <button type="button" className="room-link" onClick={onMore}>{moreLabel} <Ico name="arrowRight" size={14} /></button>}
    </div>
  );
}

function Shelf({ title, hint, list, onMore, moreLabel, ctx }) {
  if (!list.length) return null;
  return (
    <section className="room-section">
      <SectionHead title={title} hint={hint} onMore={onMore} moreLabel={moreLabel} />
      <div className="room-grid">{list.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>
    </section>
  );
}

function OfferBadge({ offer, now }) {
  if (!offer) return null;
  const active = offer.active && new Date(offer.endsAt).getTime() > now;
  const label = active ? countdown(offer.endsAt, now) : offer.startsAt ? countdown(offer.startsAt, now) : null;
  if (!label) return null;
  return <span className={`room-offer${active ? '' : ' soon'}`}><Ico name="bolt" size={12} strokeWidth={2.2} /> -{offer.discount}% · {active ? `termina em ${label}` : `começa em ${label}`}</span>;
}

function HeroCarousel({ list, items, go, now }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = list.length;
  useEffect(() => {
    if (n < 2 || paused || reduceMotion()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setIdx((i) => (i + 1) % n); }, 7000);
    return () => clearInterval(t);
  }, [n, paused]);
  const c = list[Math.min(idx, n - 1)];
  const total = items.filter((i) => i.collectionId === c.id).length;
  return (
    <section className="room-hero" style={{ '--col-accent': c.accentColor || 'var(--room-accent)' }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-roledescription="carrossel" aria-label="Coleções em destaque">
      <div key={c.id} className="room-hero-slide">
        {c.bannerUrl && <img className="room-hero-art" src={proxyImage(c.bannerUrl)} alt="" />}
        <div className="room-hero-shade" />
        <div className="room-hero-text">
          <span className="room-hero-kicker">Coleção em destaque</span>
          <OfferBadge offer={c.offer} now={now} />
          {c.logoUrl ? <img className="room-hero-logo" src={proxyImage(c.logoUrl)} alt={c.name} /> : <h1>{c.name}</h1>}
          {c.description && <p>{c.description}</p>}
          <div className="room-hero-actions">
            <button type="button" className="room-btn light" onClick={() => go(`col:${c.id}`)}>Ver coleção</button>
            <span>{total} {total === 1 ? 'item' : 'itens'}</span>
          </div>
        </div>
      </div>
      {n > 1 && (
        <div className="room-hero-dots">
          {list.map((x, i) => <button key={x.id} type="button" aria-label={`Coleção ${i + 1}: ${x.name}`} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />)}
        </div>
      )}
    </section>
  );
}

// ---------- Catálogo com busca, filtros e ordenação ----------
function Catalog({ title, subtitle, list, query = '', sort, setSort, avail, setAvail, currency, setCurrency, range, setRange, ctx }) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const rangeDef = PRICE_RANGES.find((r) => r.id === range);
  const vseen = new Set();
  const shown = list.filter((i) => {
    if (ctx.colorF && i.color !== ctx.colorF) return false;
    if (ctx.tagF && !(i.tags || []).includes(ctx.tagF)) return false;
    // Variantes de cor: um card só por grupo (as outras cores ficam nas bolinhas).
    if (i.variantGroup && !q) { const k = `${i.kind}:${i.variantGroup}`; if (vseen.has(k)) return false; vseen.add(k); }
    if (q && !`${i.name} ${i.description || ''} ${KIND[i.kind].label}`.toLowerCase().includes(q)) return false;
    if (avail === 'available' && (i.owned || i.exclusiveTier || !sellsIn(i).length)) return false;
    if (avail === 'owned' && !i.owned) return false;
    // Item de coleção oculta (fora da Loja): só aparece em "Meus itens"/"Equipados".
    if (i.inShop === false && avail !== 'owned' && avail !== 'equipped') return false;
    if (avail === 'equipped' && !ctx.isEquipped(i)) return false;
    if (avail === 'exclusive' && !i.exclusiveTier) return false;
    if (currency !== 'all' && !priceOf(i, currency)) return false;
    if (rangeDef?.test) {
      const p = priceOf(i, currency === 'gems' ? 'gems' : 'coins') || priceOf(i, 'gems');
      if (!p || !rangeDef.test(p.final)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sort === 'trending') return (b.trending || 0) - (a.trending || 0) || (b.popularity || 0) - (a.popularity || 0);
    if (sort === 'foryou') return forYouScore(b, ctx) - forYouScore(a, ctx) || new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'shuffle') return seededRank(`${a.kind}${a.id}`, ctx.shuffleSeed) - seededRank(`${b.kind}${b.id}`, ctx.shuffleSeed);
    if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR');
    if (sort === 'popular') return (b.popularity || 0) - (a.popularity || 0);
    if (sort === 'cheap') return comparePrice(a) - comparePrice(b);
    if (sort === 'expensive') return (comparePrice(b) === Infinity ? -1 : comparePrice(b)) - (comparePrice(a) === Infinity ? -1 : comparePrice(a));
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const activeFilters = (avail !== 'all') + (currency !== 'all') + (range !== 'all');
  const clear = () => { setAvail('all'); setCurrency('all'); setRange('all'); };
  return (
    <div className="room-stack">
      <div className="room-page-head">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="room-toolbar">
        <div className="room-chips" role="group" aria-label="Disponibilidade">
          {AVAIL.map((a) => <button key={a.id} type="button" className={`room-chip${avail === a.id ? ' on' : ''}`} aria-pressed={avail === a.id} onClick={() => setAvail(a.id)}>{a.label}</button>)}
        </div>
        <div className="room-toolbar-end">
          <button type="button" className={`room-btn ghost sm${filtersOpen || activeFilters > 1 ? ' on' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
            <Ico name="sliders" size={15} /> Filtros{activeFilters > (avail !== 'all' ? 1 : 0) ? ` (${(currency !== 'all') + (range !== 'all')})` : ''}
          </button>
          <label className="room-select">
            <span className="sr-only">Ordenar por</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar por">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <button type="button" className="room-btn ghost sm" onClick={ctx.reshuffle} title="Embaralhar os itens"><Ico name="swap" size={15} /> Embaralhar!</button>
        </div>
      </div>
      {filtersOpen && (
        <div className="room-filters">
          <fieldset>
            <legend>Moeda</legend>
            {CURRENCIES.map((c) => <button key={c.id} type="button" className={`room-chip${currency === c.id ? ' on' : ''}`} aria-pressed={currency === c.id} onClick={() => setCurrency(c.id)}>{c.label}</button>)}
          </fieldset>
          <fieldset>
            <legend>Preço{currency === 'gems' ? ' (gemas)' : ''}</legend>
            {PRICE_RANGES.map((r) => <button key={r.id} type="button" className={`room-chip${range === r.id ? ' on' : ''}`} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
          </fieldset>
          <fieldset>
            <legend>Cor</legend>
            <span className="room-swatches">
              {SHOP_COLORS.map(([k, hex]) => (
                <button key={k} type="button" className={`room-swatch${ctx.colorF === k ? ' on' : ''}`} style={{ background: hex }} title={k} aria-label={`Cor ${k}`} aria-pressed={ctx.colorF === k} onClick={() => ctx.setColorF(ctx.colorF === k ? '' : k)} />
              ))}
            </span>
          </fieldset>
          <fieldset>
            <legend>Temas</legend>
            {SHOP_TAGS.map(([k, l]) => <button key={k} type="button" className={`room-chip${ctx.tagF === k ? ' on' : ''}`} aria-pressed={ctx.tagF === k} onClick={() => ctx.setTagF(ctx.tagF === k ? '' : k)}>{l}</button>)}
          </fieldset>
          {(activeFilters > 0 || ctx.colorF || ctx.tagF) && <button type="button" className="room-link" onClick={() => { clear(); ctx.setColorF(''); ctx.setTagF(''); }}>Limpar filtros</button>}
        </div>
      )}
      <p className="room-count">{shown.length} {shown.length === 1 ? 'item' : 'itens'}</p>
      {shown.length === 0
        ? <Empty title="Nada encontrado" text={activeFilters ? 'Nenhum item com esses filtros.' : 'Ainda não há itens aqui. Volte em breve!'} action={activeFilters ? { label: 'Limpar filtros', onClick: clear } : null} />
        : <div className="room-grid">{shown.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>}
    </div>
  );
}

// ---------- Coleções ----------
function CollectionTiles({ collections, items, go, now }) {
  return (
    <div className="room-cols">
      {collections.map((c) => {
        const n = items.filter((i) => i.collectionId === c.id).length;
        return (
          <button key={c.id} type="button" className="room-col" style={{ '--col-accent': c.accentColor || 'var(--room-accent)' }} onClick={() => go(`col:${c.id}`)}>
            <span className="room-col-art">{c.bannerUrl ? <img src={proxyImage(c.bannerUrl)} alt="" decoding="async" /> : <Ico name="grid" size={28} />}{c.bannerUrl && c.logoUrl && <><span className="room-col-shade" /><img className="room-col-logo" src={proxyImage(c.logoUrl)} alt="" decoding="async" /></>}</span>
            <span className="room-col-info">
              <strong>{c.name}</strong>
              <small>{n} {n === 1 ? 'item' : 'itens'}</small>
              <OfferBadge offer={c.offer} now={now} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CollectionsPage({ collections, items, go, now }) {
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Coleções</h1><p>Itens que combinam entre si, com preço de pacote quando disponível.</p></div>
      {collections.length === 0 ? <Empty title="Sem coleções" text="Nenhuma coleção publicada ainda." /> : <CollectionTiles collections={collections} items={items} go={go} now={now} />}
    </div>
  );
}

function CollectionPage({ c, items, onBack, onBuy, ctx }) {
  const missing = items.filter((i) => !i.owned && !i.exclusiveTier);
  const hasBundle = c.bundlePriceCoins != null || c.bundlePriceGems != null;
  return (
    <div className="room-stack">
      <button type="button" className="room-back" onClick={onBack}><Ico name="left" size={16} /> Coleções</button>
      <section className="room-colhero" style={{ '--col-accent': c.accentColor || 'var(--room-accent)' }}>
        <div className="room-colhero-art">
          {c.bannerUrl && <img src={proxyImage(c.bannerUrl)} alt="" />}
          {c.bannerUrl && c.logoUrl && <><span className="room-colhero-artshade" /><img className="room-colhero-artlogo" src={proxyImage(c.logoUrl)} alt="" /></>}
        </div>
        <div className="room-colhero-info">
          <span className="room-kicker">Coleção</span>
          <OfferBadge offer={c.offer} now={ctx.now} />
          <h1>{c.name}</h1>
          {c.description && <p>{c.description}</p>}
          {hasBundle && (
            missing.length === 0 ? <span className="room-state owned"><Ico name="check" size={14} strokeWidth={2.4} /> Você já tem tudo</span> : (
              <div className="room-bundle">
                <span>Pacote com {missing.length === items.length ? 'tudo' : `os ${missing.length} que faltam`}</span>
                <div className="room-bundle-prices">
                  {['coins', 'gems'].map((cur) => {
                    const p = c.pricing?.[cur];
                    if (!p || p.final === null) return null;
                    return (
                      <button key={cur} type="button" className={`room-btn buy ${cur}`} disabled={ctx.busy !== ''} onClick={() => onBuy(cur)}>
                        <Ico name={cur === 'gems' ? 'gem' : 'coin'} size={16} />
                        {p.final !== p.base && <s>{fmt(p.base)}</s>} {fmt(p.final)}
                      </button>
                    );
                  })}
                </div>
                <small className="room-muted">O valor final é conferido na confirmação. Se o que falta custar menos que o pacote, você paga o menor valor.</small>
              </div>
            )
          )}
        </div>
      </section>
      {items.length === 0 ? <Empty title="Coleção vazia" text="Essa coleção ainda não tem itens." /> : <div className="room-grid">{items.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>}
    </div>
  );
}

// ---------- Exclusivos e meus itens ----------
function ExclusivePage({ list, ctx }) {
  const tier = ctx.supporter.tier;
  return (
    <div className="room-stack">
      <div className="room-page-head">
        <h1>Exclusivos de apoio</h1>
        <p>Itens que não são vendidos: ficam liberados enquanto você for Assinante ou Super Assinante. Super Assinantes também têm acesso aos itens de Assinante.</p>
      </div>
      <SupporterCard supporter={ctx.supporter} />
      {list.length === 0 ? <Empty title="Nenhum exclusivo ainda" text="A equipe ainda não publicou itens exclusivos." /> : (
        <>
          {['SUPER', 'SUBSCRIBER'].map((t) => {
            const of = list.filter((i) => i.exclusiveTier === t);
            if (!of.length) return null;
            return (
              <section key={t} className="room-section">
                <SectionHead title={`Exclusivos de ${TIER_LABEL[t]}`} hint={tier !== 'NONE' && of.every((i) => !i.locked) ? 'Liberados para você' : null} />
                <div className="room-grid">{of.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function OwnedPage({ list, go, ctx }) {
  const equipped = list.filter((i) => ctx.isEquipped(i));
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Meus itens</h1><p>Tudo que está no seu inventário. Equipe ou tire quando quiser, sem pagar de novo.</p></div>
      {list.length === 0 ? <Empty title="Inventário vazio" text="O que você comprar ou ganhar aparece aqui." action={{ label: 'Ir para a loja', onClick: () => go('home') }} /> : (
        <>
          {equipped.length > 0 && <Shelf title="Em uso agora" list={equipped} ctx={ctx} />}
          {['deco', 'effect', 'font', 'style', 'back'].map((k) => <Shelf key={k} title={KIND[k].plural} list={list.filter((i) => i.kind === k)} ctx={ctx} />)}
        </>
      )}
    </div>
  );
}

// ---------- Card ----------
function Preview({ item, user, mode = 'card' }) {
  if (item.kind === 'font') {
    const shown = { ...user, profileFont: fontValue(item) };
    if (mode === 'mini') return <MockProfile user={shown} size="mini" />;
    return (
      <div className={`room-art-font${mode !== 'card' ? ' is-big' : ''}`}>
        <span style={nameStyleProps(shown)}>{user?.displayName || 'Seu nome'}</span>
        <small style={nameStyleProps({ profileFont: fontValue(item) })}>Aa Bb Cc 123</small>
      </div>
    );
  }
  if (item.kind === 'style') {
    const key = styleKey(item);
    if (mode === 'full') return <MockProfile user={user} style={key} size="big" wide />;
    if (mode === 'phone') return <div className="room-phone"><MockProfile user={user} style={key} size="phone" mobile /></div>;
    return <MockProfile user={user} style={key} size={mode === 'card' ? 'card' : 'mini'} />;
  }
  if (item.kind === 'back') {
    return (
      <div className={`shop-art-back r-${item.rarity}${mode !== 'card' ? ' is-big' : ''}`}>
        <span className="shop-back-fan" aria-hidden="true">
          <CardBack variant={item.key} className="shop-back-shadow" />
          <CardBack variant={item.key} className="shop-back-main" />
        </span>
      </div>
    );
  }
  if (item.kind === 'deco') {
    if (mode === 'mini') return <MockProfile user={user} deco={decoValue(item)} size="mini" />;
    if (mode === 'chat') return <ChatPreview user={{ ...user, avatarDecoration: decoValue(item) }} />;
    return <div className="room-art-deco"><UserAvatar user={{ ...user, avatarDecoration: decoValue(item) }} size={mode === 'big' ? 160 : 92} /></div>;
  }
  if (mode === 'full') return <MockProfile user={user} effect={effectValue(item)} size="big" wide />;
  if (mode === 'phone') return <div className="room-phone"><MockProfile user={user} effect={effectValue(item)} size="phone" mobile /></div>;
  return <MockProfile user={user} effect={effectValue(item)} size={mode === 'card' ? 'card' : 'mini'} loop={mode !== 'card' || !reduceMotion()} />;
}

function ChatPreview({ user }) {
  return (
    <div className="room-chat-preview" aria-label="Prévia no chat">
      {[0, 1].map((n) => (
        <div key={n} className="room-chat-line">
          <UserAvatar user={user} size={40} />
          <div>
            <strong>{user?.displayName || 'Você'}</strong> <small>hoje às 21:0{n}</small>
            <p>{n ? 'ficou bonita né?' : 'testando minha moldura nova 👀'}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PriceTag({ item }) {
  const list = sellsIn(item);
  if (!list.length) return <span className="room-muted">Indisponível</span>;
  return (
    <span className="room-price">
      {list.map((cur) => {
        const p = priceOf(item, cur);
        return (
          <span key={cur} className={`room-price-one ${cur}`}>
            <Ico name={cur === 'gems' ? 'gem' : 'coin'} size={15} />
            {p.final !== p.base && <s>{fmt(p.base)}</s>}
            <b>{p.final === 0 ? 'Grátis' : fmt(p.final)}</b>
          </span>
        );
      })}
    </span>
  );
}

// Selo de item limitado: estoque restante, esgotado ou o número da sua cópia.
function LimitedFlag({ item, big }) {
  if (!item.limited) return null;
  const soldOut = item.remaining <= 0;
  return (
    <span className={`room-flag limited${soldOut ? ' out' : ''}${big ? ' big' : ''}`} title={`${fmt(item.sold)} de ${fmt(item.stock)} vendidos`}>
      <Ico name="star" size={11} strokeWidth={2.2} />
      {item.owned && item.serial ? `Sua cópia #${fmt(item.serial)}` : soldOut ? 'Esgotado' : `Limitado · ${fmt(item.remaining)} de ${fmt(item.stock)}`}
    </span>
  );
}

function StateBadge({ item, on }) {
  if (on) return <span className="room-state equipped"><Ico name="check" size={12} strokeWidth={2.6} /> Equipado</span>;
  if (item.owned) return <span className="room-state owned">{item.ownedVia === 'SUPPORTER' ? 'Liberado' : 'Adquirido'}</span>;
  if (item.locked) return <span className="room-state locked"><Ico name="lock" size={12} strokeWidth={2.2} /> Bloqueado</span>;
  return null;
}

function ItemCard({ item: base, ctx }) {
  const { user, busy, isEquipped, open, equip, askBuy, now } = ctx;
  const variants = ctx.variantsOf ? ctx.variantsOf(base) : [];
  const [shownId, setShown] = useState(base.id);
  const item = variants.find((v) => v.id === shownId) || base;
  const on = isEquipped(item);
  const discount = Math.max(...sellsIn(item).map((c) => (priceOf(item, c).base - priceOf(item, c).final > 0 ? priceOf(item, c).discount || 0 : 0)), 0);
  const cur = sellsIn(item);
  return (
    <article className={`room-card k-${item.kind}${on ? ' is-on' : ''}${item.locked ? ' is-locked' : ''}`}>
      <button type="button" className="room-card-art" onClick={() => open(item)} aria-label={`Ver detalhes de ${item.name}`}>
        <Preview item={item} user={user} />
        <span className="room-card-flags">
          {item.exclusiveTier && <span className={`room-flag excl t-${item.exclusiveTier.toLowerCase()}`}><Ico name="crown" size={11} strokeWidth={2.2} /> {TIER_LABEL[item.exclusiveTier]}</span>}
          {!item.exclusiveTier && isNew(item, now) && <span className="room-flag new">Novo</span>}
          {discount > 0 && !item.owned && <span className="room-flag off">-{discount}%</span>}
          {item.limited && <LimitedFlag item={item} />}
        </span>
        <span className="room-card-state"><StateBadge item={item} on={on} /></span>
        <span className="room-card-peek"><Ico name="eye" size={14} /> Pré-visualizar</span>
      </button>
      {item.kind !== 'back' && !item.owned && !item.exclusiveTier && (
        <button
          type="button" className={`room-wish${ctx.inWish(item) ? ' on' : ''}`} onClick={() => ctx.toggleWish(item)}
          aria-pressed={ctx.inWish(item)} aria-label={ctx.inWish(item) ? 'Tirar da lista de desejos' : 'Pôr na lista de desejos'}
          title={ctx.inWish(item) ? 'Na sua lista de desejos' : 'Adicionar à lista de desejos'}
        ><Ico name="heart" size={15} strokeWidth={2.2} /></button>
      )}
      <div className="room-card-body">
        <small>{KIND[item.kind].label}{item.rarity && RARITY_LABEL[item.rarity] ? ` · ${RARITY_LABEL[item.rarity]}` : ''}</small>
        <h3 title={item.name}>{item.name}</h3>
        {variants.length > 1 && (
          <span className="room-variants" aria-label="Outras cores">
            {variants.map((v) => (
              <button key={v.id} type="button" className={`room-variant${v.id === item.id ? ' on' : ''}`} title={v.name} aria-label={`Ver ${v.name}`}
                style={{ background: (SHOP_COLORS.find(([k]) => k === v.color) || [null, '#888'])[1] }}
                onClick={() => setShown(v.id)}
              />
            ))}
          </span>
        )}
        {item.expiresAt && <ExpiryNote at={item.expiresAt} />}
        {item.description && <p className="room-card-desc">{item.description}</p>}
        <div className="room-card-foot">
          {item.owned ? (
            on && item.key === DEFAULT_BACK ? <span className="room-muted">Verso padrão</span> : (
              <button type="button" className={`room-btn sm ${on ? 'ghost' : 'primary'}`} disabled={busy !== ''} onClick={() => equip(item, !on)}>{on ? 'Tirar' : 'Usar'}</button>
            )
          ) : item.locked ? (
            <span className="room-muted"><Ico name="lock" size={13} /> Só para {TIER_LABEL[item.exclusiveTier]}</span>
          ) : item.limited && item.remaining <= 0 ? (
            <span className="room-muted"><Ico name="swap" size={13} /> Esgotado — só por troca</span>
          ) : (
            <>
              <PriceTag item={item} />
              {cur.length > 0 && <button type="button" className="room-btn sm primary" disabled={busy !== ''} onClick={() => (cur.length === 1 ? askBuy(item, cur[0]) : open(item))}>Comprar</button>}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------- Detalhe com pré-visualização ----------
const PREVIEW_MODES = {
  deco: [['big', 'Avatar', 'user'], ['mini', 'Mini perfil', 'frame'], ['chat', 'No chat', 'chat']],
  effect: [['mini', 'Mini perfil', 'frame'], ['full', 'Perfil completo', 'monitor'], ['phone', 'Celular', 'phone']],
  font: [['big', 'Nome', 'font'], ['mini', 'Mini perfil', 'frame']],
  style: [['mini', 'Mini perfil', 'frame'], ['full', 'Perfil completo', 'monitor'], ['phone', 'Celular', 'phone']],
  back: [['big', 'Verso', 'cards']],
};

function ItemDetail({ initial, items, collections, onClose, openCollection, ctx }) {
  const item = items.find((i) => i.kind === initial.kind && i.id === initial.id) || initial;
  const { user, busy, isEquipped, equip, askBuy, gift, supporter } = ctx;
  const on = isEquipped(item);
  const modes = PREVIEW_MODES[item.kind];
  const [mode, setMode] = useState(modes[0][0]);
  const collection = collections.find((c) => c.id === item.collectionId);
  useEscape(onClose);
  const dialogRef = useRef(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  const currencies = sellsIn(item);
  return (
    <div className="room-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="room-dialog room-detail" role="dialog" aria-modal="true" aria-label={item.name} tabIndex={-1} ref={dialogRef}>
        <button type="button" className="room-close" aria-label="Fechar" onClick={onClose}><Ico name="close" size={18} /></button>
        <div className="room-detail-preview">
          <div className={`room-detail-stage m-${mode}${collection?.bannerUrl ? ' has-art' : ''}`} style={collection?.bannerUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.55)), url(${proxyImage(collection.bannerUrl)})` } : undefined}>
            {collection && <span className="room-stage-col"><Ico name="grid" size={12} /> {collection.name}</span>}
            <Preview item={item} user={user} mode={mode} />
          </div>
          {modes.length > 1 && (
            <div className="room-seg" role="tablist" aria-label="Modo de pré-visualização">
              {modes.map(([id, label, icon]) => (
                <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}><Ico name={icon} size={14} /> {label}</button>
              ))}
            </div>
          )}
          {!item.owned && <small className="room-muted center">Só uma prévia — nada muda no seu perfil até você comprar e usar.</small>}
        </div>
        <div className="room-detail-info">
          <span className="room-kicker">{KIND[item.kind].label}{item.rarity && RARITY_LABEL[item.rarity] ? ` · ${RARITY_LABEL[item.rarity]}` : ''}</span>
          <h2>{item.name}</h2>
          <div className="room-detail-badges">
            <StateBadge item={item} on={on} />
            {item.exclusiveTier && <span className={`room-flag excl t-${item.exclusiveTier.toLowerCase()}`}><Ico name="crown" size={11} strokeWidth={2.2} /> Exclusivo de {TIER_LABEL[item.exclusiveTier]}</span>}
            <LimitedFlag item={item} big />
          </div>
          {item.limited && (
            <div className="room-limited-box">
              <div className="room-limited-bar"><span style={{ width: `${Math.min(100, (item.sold / Math.max(1, item.stock)) * 100)}%` }} /></div>
              <small>{fmt(item.sold)} de {fmt(item.stock)} cópias já têm dono. Itens limitados podem ser trocados com outros jogadores em <b>Trocas</b>.</small>
            </div>
          )}
          {item.expiresAt && <ExpiryNote at={item.expiresAt} long />}
          <p>{item.description || KIND[item.kind].blurb}</p>
          {collection && <button type="button" className="room-link" onClick={() => openCollection(collection.id)}>Da coleção {collection.name} <Ico name="arrowRight" size={14} /></button>}

          {!item.owned && !item.locked && currencies.length > 0 && !(item.limited && item.remaining <= 0) && (
            <div className="room-detail-prices">
              {currencies.map((cur) => {
                const p = priceOf(item, cur);
                return (
                  <div key={cur} className={`room-detail-price ${cur}`}>
                    <span className="room-detail-price-cur"><Ico name={cur === 'gems' ? 'gem' : 'coin'} size={18} /> {cur === 'gems' ? 'Gemas' : 'Moedas'}</span>
                    <span className="room-detail-price-val">
                      {p.final !== p.base && <s>{fmt(p.base)}</s>}
                      <b>{p.final === 0 ? 'Grátis' : fmt(p.final)}</b>
                      {p.final !== p.base && <em>-{p.discount}% Assinante</em>}
                    </span>
                    <button type="button" className="room-btn primary" disabled={busy !== ''} onClick={() => askBuy(item, cur)}>Comprar</button>
                  </div>
                );
              })}
              {supporter.tier === 'NONE' && item.discountEligible !== false && item.kind !== 'back' && !item.limited && (
                <small className="room-muted">Assinantes pagam 15% a menos neste item.</small>
              )}
            </div>
          )}
          {item.locked && (
            <div className="room-locked-box">
              <Ico name="lock" size={18} />
              <span>Este item não é vendido. Ele fica liberado automaticamente para quem é {TIER_LABEL[item.exclusiveTier]}{item.exclusiveTier === 'SUBSCRIBER' ? ' ou Super Assinante' : ''}.</span>
            </div>
          )}
          <div className="room-detail-actions">
            {item.owned && !(on && item.key === DEFAULT_BACK) && (
              <button type="button" className={`room-btn lg ${on ? 'ghost' : 'primary'}`} disabled={busy !== ''} onClick={() => equip(item, !on)}>{on ? 'Tirar do perfil' : 'Usar agora'}</button>
            )}
            {item.kind !== 'back' && !item.exclusiveTier && currencies.length > 0 && !(item.limited && item.remaining <= 0) && (
              <button type="button" className="room-btn ghost lg" onClick={() => { onClose(); gift(item); }}><Ico name="gift" size={16} /> Presentear</button>
            )}
            {item.kind !== 'back' && (
              <button type="button" className="room-btn ghost lg" onClick={() => ctx.share(item)} title="Copiar link do item"><Ico name="arrowRight" size={16} /> Compartilhar</button>
            )}
            {item.kind !== 'back' && !item.owned && !item.exclusiveTier && (
              <button type="button" className={`room-btn ghost lg room-wish-btn${ctx.inWish(item) ? ' on' : ''}`} aria-pressed={ctx.inWish(item)} onClick={() => ctx.toggleWish(item)}>
                <Ico name="heart" size={16} /> {ctx.inWish(item) ? 'Na lista de desejos' : 'Lista de desejos'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Confirmação de compra ----------
function ConfirmPurchase({ req, data, busy, onCancel, onConfirm }) {
  const { item, collection } = req;
  const [currency, setCurrency] = useState(req.currency);
  const [error, setError] = useState('');
  const [changedTo, setChangedTo] = useState(null);
  useEscape(onCancel);
  const options = collection ? ['coins', 'gems'].filter((c) => collection.pricing?.[c]?.final != null) : sellsIn(item);
  const p = collection ? collection.pricing?.[currency] : priceOf(item, currency);
  if (!p) return null;
  const final = changedTo ?? p.final;
  const balance = currency === 'gems' ? data?.gems ?? 0 : data?.coins ?? 0;
  const short = final > balance;
  const cname = currency === 'gems' ? 'gemas' : 'moedas';
  const discountLabel = p.source === 'OFFER' ? 'Oferta da coleção' : 'Desconto Assinante';
  const submit = async () => {
    setError('');
    const r = await onConfirm({ item, collection, currency }, item?.kind === 'back' ? undefined : final);
    if (!r?.ok && r?.priceChanged !== undefined) { setChangedTo(r.priceChanged); setError('O preço mudou desde que você abriu. Confira o novo total e confirme de novo.'); }
    else if (!r?.ok && r?.error) setError(r.error);
  };
  return (
    <div className="room-overlay top" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="room-dialog room-confirm" role="alertdialog" aria-modal="true" aria-labelledby="room-confirm-title">
        <h2 id="room-confirm-title">Confirmar compra</h2>
        <div className="room-confirm-item">
          <span className="room-confirm-thumb">
            {collection ? (collection.bannerUrl ? <img src={proxyImage(collection.bannerUrl)} alt="" /> : <Ico name="grid" size={22} />) : <Ico name={KIND[item.kind].icon} size={22} />}
          </span>
          <div><strong>{collection ? `Coleção ${collection.name}` : item.name}</strong><small>{collection ? 'Pacote' : KIND[item.kind].label}</small></div>
        </div>
        {options.length > 1 && (
          <div className="room-seg full" role="radiogroup" aria-label="Pagar com">
            {options.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={currency === c} className={currency === c ? 'on' : ''} onClick={() => { setCurrency(c); setChangedTo(null); setError(''); }}>
                <Ico name={c === 'gems' ? 'gem' : 'coin'} size={15} /> {c === 'gems' ? 'Gemas' : 'Moedas'}
              </button>
            ))}
          </div>
        )}
        <dl className="room-receipt">
          <div><dt>Preço</dt><dd>{fmt(p.base)} {cname}</dd></div>
          {p.final !== p.base && <div className="disc"><dt>{discountLabel} (-{p.discount}%)</dt><dd>−{fmt(p.base - p.final)}</dd></div>}
          {collection && <div className="note"><dt>Se o que falta custar menos que o pacote, você paga o menor valor.</dt><dd /></div>}
          <div className="total"><dt>Total</dt><dd>{final === 0 ? 'Grátis' : `${fmt(final)} ${cname}`}</dd></div>
          <div className="bal"><dt>Seu saldo</dt><dd>{fmt(balance)} → {short ? '—' : fmt(balance - final)}</dd></div>
        </dl>
        {short && <p className="room-warn" role="alert">Saldo insuficiente: faltam {fmt(final - balance)} {cname}. Ganhe mais no baú diário e nas missões.</p>}
        {error && <p className="room-warn" role="alert">{error}</p>}
        <div className="room-confirm-actions">
          <button type="button" className="room-btn ghost lg" onClick={onCancel}>Cancelar</button>
          <button type="button" className="room-btn primary lg" disabled={busy || short} onClick={submit} autoFocus>
            {busy ? 'Comprando…' : final === 0 ? 'Pegar grátis' : `Pagar ${fmt(final)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Presentear ----------
function GiftModal({ item, data, onClose, onDone }) {
  const friends = useStore((s) => s.friends);
  const accepted = useMemo(() => friends.filter((f) => f.status === 'ACCEPTED' && f.user).map((f) => f.user)
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '', 'pt-BR')), [friends]);
  const [q, setQ] = useState('');
  const [toId, setToId] = useState(item.presetTo || null);
  const [currency, setCurrency] = useState(sellsIn(item)[0] || 'coins');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEscape(onClose);
  const term = q.trim().toLowerCase();
  const list = term ? accepted.filter((u) => `${u.displayName} ${u.username}`.toLowerCase().includes(term)) : accepted;
  const p = priceOf(item, currency);
  const balance = currency === 'gems' ? data?.gems : data?.coins;
  const friend = accepted.find((u) => u.id === toId);
  const short = p && balance != null && balance < p.final;
  const send = async () => {
    if (!friend || !p) return;
    setBusy(true); setError('');
    try {
      const r = await giftShopItem({ kind: item.kind, id: item.id, toUserId: friend.id, currency, note, expectedPrice: p.final });
      onDone(r, friend.displayName);
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="room-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="room-dialog room-gift" role="dialog" aria-modal="true" aria-label={`Presentear ${item.name}`}>
        <button type="button" className="room-close" aria-label="Fechar" onClick={onClose}><Ico name="close" size={18} /></button>
        <span className="room-gift-ico"><Ico name="gift" size={22} /></span>
        <h2>Presentear "{item.name}"</h2>
        <p className="room-muted">Você paga com a sua carteira e o amigo recebe o item na hora, com um aviso.</p>
        {accepted.length === 0 ? <Empty title="Sem amigos ainda" text="Adicione amigos em Social para poder presentear." /> : (
          <>
            <label className="room-search">
              <Ico name="search" size={16} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar amigo" aria-label="Buscar amigo" />
            </label>
            <ul className="room-friends" role="listbox" aria-label="Amigos">
              {list.slice(0, 50).map((u) => (
                <li key={u.id}>
                  <button type="button" role="option" aria-selected={toId === u.id} className={toId === u.id ? 'on' : ''} onClick={() => setToId(u.id)}>
                    <UserAvatar user={u} size={30} /><span className="truncate">{u.displayName}</span>
                    {toId === u.id && <Ico name="check" size={15} strokeWidth={2.6} />}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="room-muted room-friends-none">Nenhum amigo com esse nome.</li>}
            </ul>
            <label className="room-field">
              <span>Mensagem (opcional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Ex.: Feliz aniversário!" />
            </label>
            {sellsIn(item).length > 1 && (
              <div className="room-seg full" role="radiogroup" aria-label="Pagar com">
                {sellsIn(item).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={currency === c} className={currency === c ? 'on' : ''} onClick={() => setCurrency(c)}>
                    <Ico name={c === 'gems' ? 'gem' : 'coin'} size={15} /> {fmt(priceOf(item, c).final)}
                  </button>
                ))}
              </div>
            )}
            {short && <p className="room-warn">Saldo insuficiente nessa moeda.</p>}
            {error && <p className="room-warn">{error}</p>}
            <button type="button" className="room-btn primary lg block" disabled={!friend || busy || short} onClick={send}>
              <Ico name="gift" size={16} /> {busy ? 'Enviando…' : friend ? `Enviar por ${fmt(p?.final)} ${currency === 'gems' ? 'gemas' : 'moedas'}` : 'Escolha um amigo'}
            </button>
          </>
        )}
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
  if (!data) return <div className="room-stack">{[0, 1, 2].map((i) => <div key={i} className="room-skel" style={{ height: 64 }} />)}</div>;
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Histórico</h1><p>Suas compras, presentes enviados e presentes recebidos.</p></div>
      {error && <p className="room-warn">{error}</p>}
      {(data.received || []).length > 0 && (
        <section className="room-section">
          <SectionHead title="Presentes recebidos" />
          <ul className="room-history">
            {data.received.map((n) => (
              <li key={n.id}>
                <span className="room-history-ico gift"><Ico name="gift" size={18} /></span>
                <div><strong className="truncate">{n.title}</strong><small>{n.body}</small></div>
                <time>{when(n.createdAt)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="room-section">
        <SectionHead title="Compras e presentes enviados" />
        {data.purchases.length === 0 ? <Empty title="Nada por aqui" text="Suas compras e presentes aparecem aqui." /> : (
          <ul className="room-history">
            {data.purchases.map((t) => (
              <li key={t.id}>
                <span className={`room-history-ico ${t.kind === 'GIFT' ? 'gift' : ''}`}><Ico name={t.kind === 'GIFT' ? 'gift' : 'bag'} size={18} /></span>
                <div><strong className="truncate">{t.label}</strong><small>{when(t.createdAt)}</small></div>
                <span className="room-history-cost">
                  {t.coins !== 0 && <span className="coins"><Ico name="coin" size={14} /> {fmt(Math.abs(t.coins))}</span>}
                  {t.gems !== 0 && <span className="gems"><Ico name="gem" size={14} /> {fmt(Math.abs(t.gems))}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.hasMore && <button type="button" className="room-btn ghost" disabled={loadingMore} onClick={more}>{loadingMore ? 'Carregando…' : 'Ver mais'}</button>}
      </section>
    </div>
  );
}

// ---------- Estados ----------
function Empty({ title, text, action }) {
  return (
    <div className="room-empty">
      <span className="room-empty-ico"><Ico name="store" size={22} /></span>
      <strong>{title}</strong>
      <span>{text}</span>
      {action && <button type="button" className="room-btn ghost sm" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
function Skeleton() {
  return (
    <div className="room-stack" aria-busy="true" aria-label="Carregando a loja">
      <div className="room-skel" style={{ height: 280, borderRadius: 20 }} />
      <div className="room-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="room-skel" style={{ height: 290 }} />)}</div>
    </div>
  );
}
function LoadFailed({ text, retry }) {
  return <Empty title="Não deu para abrir a loja" text={text} action={{ label: 'Tentar de novo', onClick: retry }} />;
}

// ---------- Itens com prazo (recompensa de missão / código) ----------
function ExpiryNote({ at, long }) {
  const ms = new Date(at).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(ms / 86400000));
  const text = ms <= 0 ? 'Expirou' : days <= 1 ? `Expira em ${Math.max(1, Math.ceil(ms / 3600000))} h` : `Expira em ${days} dias`;
  return (
    <span className={`room-expiry${days <= 3 ? ' soon' : ''}`} title={new Date(at).toLocaleString('pt-BR')}>
      <Ico name="clock" size={12} /> {text}{long ? ' — comprar deixa ele pra sempre.' : ''}
    </span>
  );
}

// ---------- Lista de desejos ----------
function WishlistPage({ list, go, ctx }) {
  return (
    <div className="room-stack">
      <div className="room-page-head">
        <h1>Lista de desejos</h1>
        <p>Os itens que você marcou com o coração. Seus amigos veem essa lista no seu perfil e podem te presentear.</p>
      </div>
      {list.length === 0
        ? <Empty title="Sua lista está vazia" text="Toque no coração de qualquer item da Loja pra guardar aqui." action={{ label: 'Explorar a loja', onClick: () => go('home') }} />
        : <div className="room-grid">{list.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>}
    </div>
  );
}

// ---------- Presentes e códigos (inventário de presentes) ----------
function GiftsPage({ go, onWallet, reload, flash }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  useEffect(() => { getGiftsSummary().then(setSummary).catch(() => setSummary({ given: 0, received: 0, tiers: [] })); }, []);
  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true); setResult(null);
    try {
      const r = await redeemShopCode(code.trim());
      onWallet(r);
      const parts = [];
      if (r.reward.coins) parts.push(`${fmt(r.reward.coins)} moedas`);
      if (r.reward.gems) parts.push(`${fmt(r.reward.gems)} gemas`);
      if (r.reward.item) parts.push(`"${r.reward.item.name}"${r.reward.item.expiresAt ? ` (até ${new Date(r.reward.item.expiresAt).toLocaleDateString('pt-BR')})` : ''}`);
      setResult({ ok: true, text: `Código resgatado! Você ganhou ${parts.join(', ')}.` });
      flash('Código resgatado!');
      setCode('');
      reload();
    } catch (err) { setResult({ ok: false, text: errMsg(err) }); }
    setBusy(false);
  };
  const next = summary?.tiers?.find((t) => !t.reached);
  const pct = next ? Math.min(100, Math.round(((summary.given || 0) / next.need) * 100)) : 100;
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Presentes e códigos</h1><p>Resgate códigos que a equipe distribui e acompanhe sua insígnia de presentes.</p></div>

      <section className="room-panel room-redeem">
        <div className="room-redeem-head">
          <span className="room-gift-ico"><Ico name="tag" size={20} /></span>
          <div><h2>Resgatar código</h2><p className="room-muted">Recebeu um código em um evento, sorteio ou da equipe? Insira abaixo.</p></div>
        </div>
        <form className="room-redeem-form" onSubmit={submit}>
          <input
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} placeholder="PC-XXXX-XXXX"
            aria-label="Código" autoComplete="off" spellCheck={false}
          />
          <button type="submit" className="room-btn primary" disabled={busy || !code.trim()}>{busy ? 'Resgatando…' : 'Resgatar'}</button>
        </form>
        {result && <p className={result.ok ? 'room-ok' : 'room-warn'} role="status">{result.text}</p>}
      </section>

      <section className="room-panel room-giftbadge">
        <div className="room-redeem-head">
          <span className="room-gift-ico"><Ico name="gift" size={20} /></span>
          <div>
            <h2>Insígnia de Presentes</h2>
            <p className="room-muted">
              {!summary ? 'Carregando…' : next
                ? `Dê ${next.need - (summary.given || 0)} ${next.need - (summary.given || 0) === 1 ? 'presente' : 'presentes'} para desbloquear a insígnia ${next.name}!`
                : 'Você chegou ao nível máximo. Lenda!'}
            </p>
          </div>
          {summary && <span className="room-giftbadge-count">{summary.given}/{next?.need ?? summary.given} presentes</span>}
        </div>
        <div className="room-limited-bar"><span style={{ width: `${pct}%` }} /></div>
        <ol className="room-gifttiers">
          {(summary?.tiers || []).map((t) => (
            <li key={t.level} className={t.reached ? 'on' : ''}>
              <span className={`room-gifttier-ico lv${t.level}`}><Ico name="gift" size={16} /></span>
              <strong>{t.name}</strong>
              <small>Presenteou {t.need}x</small>
            </li>
          ))}
        </ol>
        <small className="room-muted">Sua insígnia aparece no seu perfil (Estatísticas) e sobe conforme você presenteia amigos. Presentes grátis não contam.</small>
        <div className="room-redeem-actions">
          <button type="button" className="room-btn primary" onClick={() => go('home')}><Ico name="gift" size={15} /> Enviar um presente</button>
          <button type="button" className="room-btn ghost" onClick={() => go('history')}><Ico name="clock" size={15} /> Presentes enviados e recebidos</button>
        </div>
      </section>
    </div>
  );
}

// ---------- Comparar planos (apoio) ----------
const PLAN_ROWS = [
  { group: 'Exiba o seu estilo' },
  { label: 'Insígnia de apoiador no perfil', v: [false, 'Assinante', 'Super Assinante'] },
  { label: 'Itens exclusivos de Assinante', v: [false, true, true] },
  { label: 'Itens exclusivos de Super Assinante', v: [false, false, true] },
  { group: 'Loja e recompensas' },
  { label: 'Desconto em itens elegíveis da Loja', v: [false, '15%', '15%'] },
  { label: 'Bônus nas moedas das missões', v: [false, '1,2x', '1,5x'] },
  { label: 'Presentear amigos e resgatar códigos', v: [true, true, true] },
  { group: 'Personalização (grátis pra todo mundo)' },
  { label: 'Temas coloridos e tema personalizado', v: [true, true, true] },
  { label: 'Estilos de perfil, molduras e efeitos (comprando)', v: [true, true, true] },
  { label: 'Mural do perfil e lista de desejos', v: [true, true, true] },
];
function PlansPage({ supporter }) {
  const cur = supporter?.tier || 'NONE';
  const cols = [['NONE', 'Membro'], ['SUBSCRIBER', 'Assinante'], ['SUPER', 'Super Assinante']];
  const cell = (v) => (v === true ? <Ico name="check" size={16} strokeWidth={2.6} /> : v === false ? <span className="room-plan-no">—</span> : <b>{v}</b>);
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Compare os planos</h1><p>O que muda pra quem apoia o Project Club. Tudo que é personalização básica continua grátis.</p></div>
      <div className="room-plans-wrap">
        <table className="room-plans">
          <thead>
            <tr>
              <th scope="col">Recursos</th>
              {cols.map(([id, label]) => (
                <th key={id} scope="col" className={cur === id ? 'mine' : ''}>
                  <span className={`room-plan-name t-${id.toLowerCase()}`}>{id !== 'NONE' && <Ico name="crown" size={14} />} {label}</span>
                  {cur === id && <small>Seu plano</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAN_ROWS.map((r) => (r.group ? (
              <tr key={r.group} className="grp"><th colSpan={4} scope="colgroup">{r.group}</th></tr>
            ) : (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.v.map((v, i) => <td key={cols[i][0]} className={cur === cols[i][0] ? 'mine' : ''}>{cell(v)}</td>)}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <p className="room-muted">A assinatura é paga: pra assinar, abra um ticket ou fale com a equipe. Gemas são a moeda da plataforma e servem pra Loja, não pra assinatura.</p>
    </div>
  );
}

// ---------- Exclusivos de gemas ----------
function GemsPage({ list, ctx }) {
  return (
    <div className="room-stack">
      <section className="room-gems-hero">
        <div>
          <h1>Exclusivos de gemas</h1>
          <p>Itens que só saem por gemas. Ganhe gemas nas missões semanais, no baú e em eventos.</p>
          <a className="room-btn ghost" href="/missoes"><Ico name="bolt" size={15} /> Ir pras missões</a>
        </div>
        <span className="room-gems-orb"><Ico name="gem" size={54} /></span>
      </section>
      {list.length === 0 ? <Empty title="Nada por aqui ainda" text="A equipe ainda não colocou itens só de gemas." /> : <div className="room-grid">{list.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>}
    </div>
  );
}

// ---------- "Adquira este visual" ----------
function LookPage({ look, from, items, ctx }) {
  const wanted = String(look || '').split(',').map((p) => p.split(':')).filter((p) => p.length === 2);
  const list = wanted.map(([k, id]) => items.find((i) => i.kind === k && (k === 'style' ? (i.data?.style || (i.key || '').replace(/^style:/, '')) === id : i.id === id))).filter(Boolean);
  return (
    <div className="room-stack">
      <div className="room-page-head"><h1>Visual de {from || 'alguém'}</h1><p>Os itens da Loja que essa pessoa está usando agora.</p></div>
      {list.length === 0 ? <Empty title="Nenhum item da Loja" text="Esse visual usa itens que não estão mais à venda (ou exclusivos)." /> : <div className="room-grid">{list.map((i) => <ItemCard key={`${i.kind}:${i.id}`} item={i} ctx={ctx} />)}</div>}
    </div>
  );
}
