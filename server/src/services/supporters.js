// Apoio ao Project Club (Assinante / Super Assinante) e preços da Loja.
//
// Regra única usada por TODA compra da Loja (molduras, efeitos, coleções e
// presentes) — o preço final é sempre calculado aqui, no servidor, com o
// status de apoio lido do banco no momento da compra. O cliente só mostra.
//
// - Super Assinante herda tudo do Assinante (rank maior ou igual).
// - Desconto de Assinante: 15% nos itens com discountEligible = true.
// - Nunca acumula com outro desconto: numa coleção em oferta vale o MAIOR
//   dos dois (oferta da staff ou desconto de Assinante), nunca os dois.
// - Item exclusivo (exclusiveTier) não é vendido: fica liberado enquanto a
//   pessoa tiver a categoria exigida, sem criar linha no inventário (assim
//   não duplica e some sozinho quando o status acaba).

const TIERS = ['NONE', 'SUBSCRIBER', 'SUPER'];
const TIER_RANK = { NONE: 0, SUBSCRIBER: 1, SUPER: 2 };
const TIER_LABEL = { NONE: 'Membro', SUBSCRIBER: 'Assinante', SUPER: 'Super Assinante' };
const SUBSCRIBER_DISCOUNT = 15; // %

const normalizeTier = (t) => (TIERS.includes(t) ? t : 'NONE');
const tierRank = (t) => TIER_RANK[normalizeTier(t)];
const hasSubscriberBenefits = (t) => tierRank(t) >= TIER_RANK.SUBSCRIBER;
// Categoria exigida por um item exclusivo (null/qualquer outra coisa = não exclusivo).
const exclusiveOf = (item) => (item?.exclusiveTier === 'SUBSCRIBER' || item?.exclusiveTier === 'SUPER' ? item.exclusiveTier : null);
const qualifiesFor = (tier, required) => !required || tierRank(tier) >= TIER_RANK[required];

// Desconto (%) que a pessoa tem direito num item que custa algo.
function supporterDiscountFor(tier, item) {
  if (!hasSubscriberBenefits(tier)) return 0;
  if (item && item.discountEligible === false) return 0;
  return SUBSCRIBER_DISCOUNT;
}

// Aplica um % de desconto. Arredonda o desconto pra baixo (a pessoa nunca
// paga mais do que o preço cheio menos o desconto anunciado arredondado).
function applyPct(price, pct) {
  if (price === null || price === undefined) return null;
  if (!(pct > 0)) return price;
  return Math.max(0, price - Math.floor((price * pct) / 100));
}

// Preço de um item avulso numa moeda: { base, discount, final, source }.
// base null = não vendido nessa moeda.
function priceFor(item, currency, tier) {
  const base = currency === 'gems' ? item?.priceGems : item?.priceCoins;
  if (base === null || base === undefined) return { base: null, discount: 0, final: null, source: null };
  const discount = supporterDiscountFor(tier, item);
  return { base, discount, final: applyPct(base, discount), source: discount ? 'SUBSCRIBER' : null };
}

// Preço do pacote de uma coleção: o melhor entre a oferta ativa e o
// desconto de Assinante (não acumulam).
function bundlePriceFor(col, currency, tier, offer) {
  const base = currency === 'gems' ? col?.bundlePriceGems : col?.bundlePriceCoins;
  if (base === null || base === undefined) return { base: null, discount: 0, final: null, source: null };
  const offerPct = offer?.active ? Number(offer.discount) || 0 : 0;
  const subPct = supporterDiscountFor(tier, col);
  if (offerPct <= 0 && subPct <= 0) return { base, discount: 0, final: base, source: null };
  // Oferta da staff arredonda pra cima (comportamento antigo mantido).
  const viaOffer = offerPct > 0 ? Math.max(0, Math.ceil((base * (100 - offerPct)) / 100)) : Infinity;
  const viaSub = subPct > 0 ? applyPct(base, subPct) : Infinity;
  return viaSub < viaOffer
    ? { base, discount: subPct, final: viaSub, source: 'SUBSCRIBER' }
    : { base, discount: offerPct, final: viaOffer, source: 'OFFER' };
}

// Objeto enviado à Loja junto com o item (o cliente só exibe isso).
function pricing(item, tier) {
  const coins = priceFor(item, 'coins', tier);
  const gems = priceFor(item, 'gems', tier);
  return { coins, gems, discount: Math.max(coins.discount, gems.discount) };
}

const supporterInfo = (tier) => {
  const t = normalizeTier(tier);
  return { tier: t, label: TIER_LABEL[t], discount: hasSubscriberBenefits(t) ? SUBSCRIBER_DISCOUNT : 0 };
};

module.exports = {
  TIERS, TIER_LABEL, SUBSCRIBER_DISCOUNT,
  normalizeTier, tierRank, hasSubscriberBenefits, exclusiveOf, qualifiesFor,
  supporterDiscountFor, applyPct, priceFor, bundlePriceFor, pricing, supporterInfo,
};
