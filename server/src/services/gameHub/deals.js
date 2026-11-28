// Game Hub → Promoções: Steam e GOG em reais (preço da loja brasileira),
// grátis da semana na Epic (e os próximos) e as promoções da Epic pelo
// CheapShark (só existe em dólar — vai marcado "US$").
//
// Cada loja é buscada e guardada separada (30 min): se uma cair, as outras
// continuam aparecendo, e a que caiu mostra a última lista boa.
const { fetchJson, cached } = require('./remote');
const covers = require('./covers');

const TTL = 30 * 60 * 1000;
const URLS = {
  steam: 'https://store.steampowered.com/api/featuredcategories?cc=br&l=portuguese',
  gog: 'https://catalog.gog.com/v1/catalog?limit=24&order=desc%3Atrending&discounted=eq%3Atrue&productType=in%3Agame%2Cpack&page=1&countryCode=BR&locale=pt-BR&currencyCode=BRL',
  epicFree: 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR',
  epicDeals: 'https://www.cheapshark.com/api/1.0/deals?storeID=25&pageSize=30&onSaleOnly=1&sortBy=Deal%20Rating',
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const steamHeader = (appId) => `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

// ---------- Steam ----------
function parseSteam(json) {
  const seen = new Set();
  const out = [];
  for (const group of ['specials', 'top_sellers', 'new_releases']) {
    for (const it of json?.[group]?.items || []) {
      const id = num(it?.id);
      if (!id || seen.has(id) || !it.discounted || !(it.discount_percent > 0)) continue;
      seen.add(id);
      const final = num(it.final_price); const base = num(it.original_price);
      out.push({
        store: 'steam', id: `steam:${id}`, title: String(it.name || '').slice(0, 120),
        image: it.header_image || it.large_capsule_image || steamHeader(id),
        url: `https://store.steampowered.com/app/${id}/`, steamAppId: id,
        price: { final: final == null ? null : final / 100, base: base == null ? null : base / 100, currency: it.currency || 'BRL', discount: it.discount_percent },
        free: final === 0,
        endsAt: it.discount_expiration ? new Date(it.discount_expiration * 1000).toISOString() : null,
      });
    }
  }
  return out;
}

// ---------- GOG ----------
function parseGog(json) {
  return (json?.products || []).map((p) => {
    const final = num(p?.price?.finalMoney?.amount); const base = num(p?.price?.baseMoney?.amount);
    const discount = Math.abs(parseInt(String(p?.price?.discount || '').replace(/[^\d-]/g, ''), 10)) || (base && final != null ? Math.round((1 - final / base) * 100) : 0);
    return {
      store: 'gog', id: `gog:${p.id}`, title: String(p.title || '').slice(0, 120),
      image: p.coverHorizontal || null, url: p.storeLink || null,
      price: { final, base, currency: p?.price?.finalMoney?.currency || 'BRL', discount },
      free: final === 0, endsAt: null,
    };
  }).filter((d) => d.title && d.url && d.price.discount > 0);
}

// ---------- Epic (grátis) ----------
function epicSlug(e) {
  const pick = (list) => (list || []).find((m) => m?.pageType === 'productHome')?.pageSlug || (list || [])[0]?.pageSlug;
  return pick(e?.catalogNs?.mappings) || pick(e?.offerMappings) || (e?.productSlug ? String(e.productSlug).replace(/\/home$/, '') : null);
}
function epicImage(e) {
  const imgs = e?.keyImages || [];
  return (imgs.find((k) => k.type === 'OfferImageWide') || imgs.find((k) => k.type === 'DieselStoreFrontWide') || imgs.find((k) => k.type === 'Thumbnail') || imgs[0])?.url || null;
}
function parseEpicFree(json, now = new Date()) {
  const free = []; const upcoming = [];
  for (const e of json?.data?.Catalog?.searchStore?.elements || []) {
    const slug = epicSlug(e);
    const base = num(e?.price?.totalPrice?.originalPrice);
    const item = (window) => ({
      store: 'epic', id: `epic:${e.id || slug || e.title}`, title: String(e.title || '').slice(0, 120),
      image: epicImage(e), url: slug ? `https://store.epicgames.com/pt-BR/p/${slug}` : 'https://store.epicgames.com/pt-BR/free-games',
      price: { final: 0, base: base ? base / 100 : null, currency: e?.price?.totalPrice?.currencyCode || 'BRL', discount: 100 },
      free: true, startsAt: window.startDate || null, endsAt: window.endDate || null,
    });
    const isFree = (w) => w?.discountSetting?.discountPercentage === 0;
    for (const w of e?.promotions?.promotionalOffers?.[0]?.promotionalOffers || []) {
      if (isFree(w) && new Date(w.startDate) <= now && new Date(w.endDate) > now) { free.push(item(w)); break; }
    }
    for (const w of e?.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers || []) {
      if (isFree(w) && new Date(w.startDate) > now) { upcoming.push(item(w)); break; }
    }
  }
  return { free, upcoming };
}

// ---------- Epic (promoções, CheapShark, em dólar) ----------
function parseEpicDeals(json) {
  return (Array.isArray(json) ? json : []).map((d) => {
    const final = num(d?.salePrice); const base = num(d?.normalPrice);
    const steamAppId = num(d?.steamAppID);
    return {
      store: 'epic', id: `epicdeal:${d.gameID || d.dealID}`, title: String(d.title || '').slice(0, 120),
      // A capa certa sai do covers.js (Steam conferida → imagem do CheapShark → Twitch).
      image: d.thumb || null, steamAppId: steamAppId || null,
      url: d.dealID ? `https://www.cheapshark.com/redirect?dealID=${d.dealID}` : null,
      price: { final: round2(final), base: round2(base), currency: 'USD', discount: Math.round(num(d?.savings) || 0) },
      free: false, endsAt: null,
    };
  }).filter((d) => d.title && d.url && d.price.final > 0 && d.price.discount > 0);
}

async function source(key, url, parse, deps) {
  try {
    return await cached(`deals:${key}`, TTL, async () => parse(await fetchJson(url, deps)));
  } catch (err) {
    console.warn(`[game-hub] promoções da ${key} indisponíveis: ${err?.message || err}`);
    return null;
  }
}

async function getDeals(deps = {}) {
  const [steam, gog, epicFree, epicDeals] = await Promise.all([
    source('steam', URLS.steam, parseSteam, deps),
    source('gog', URLS.gog, parseGog, deps),
    source('epicFree', URLS.epicFree, (j) => parseEpicFree(j), deps),
    source('epicDeals', URLS.epicDeals, parseEpicDeals, deps),
  ]);
  const freeTitles = new Set((epicFree?.free || []).map((d) => d.title.toLowerCase()));
  const deals = [...(steam || []), ...(gog || []), ...(epicDeals || []).filter((d) => !freeTitles.has(d.title.toLowerCase()))]
    .sort((a, b) => (b.price.discount || 0) - (a.price.discount || 0));
  // Capas: troca "sem imagem" e endereços quebrados da Steam, e diminui as da Epic.
  const withCover = (list) => covers.resolveMany(
    list.map((d) => ({ ...d })),
    (d) => ({ name: d.title, steamAppId: d.steamAppId || null, image: d.image, prefer: 'wide' }),
    (d, c) => { d.image = c?.url || null; d.imageTall = !!c?.tall; },
    { deps },
  );
  const [free, upcoming, rest] = await Promise.all([
    withCover([...(epicFree?.free || []), ...deals.filter((d) => d.free)]),
    withCover(epicFree?.upcoming || []),
    withCover(deals.filter((d) => !d.free)),
  ]);
  return {
    free,
    upcoming,
    deals: rest,
    stores: { steam: steam !== null, gog: gog !== null, epic: epicFree !== null || epicDeals !== null },
    updatedAt: new Date().toISOString(),
  };
}

module.exports = { getDeals, parseSteam, parseGog, parseEpicFree, parseEpicDeals, URLS };
