// Apoio ao Project Club (Assinante / Super Assinante) e preços da Loja.
//
// Regra única usada por TODA compra da Loja (molduras, efeitos, coleções e
// presentes) — o preço final é sempre calculado aqui, no servidor, com o
// status de apoio lido do banco no momento da compra. O cliente só mostra.
//
// - Super Assinante herda tudo do Assinante (rank maior ou igual).
// - Desconto: Assinante 10%, Super Assinante 20% (itens com discountEligible).
// - Bônus de XP: Assinante +5%, Super Assinante +15% (mensagens e missões).
// - Preço mensal (mostrado na Loja → Assinatura): R$ 13,50 / R$ 20,50.
// - Nunca acumula com outro desconto: numa coleção em oferta vale o MAIOR
//   dos dois (oferta da staff ou desconto de Assinante), nunca os dois.
// - Item exclusivo (exclusiveTier) não é vendido: fica liberado enquanto a
//   pessoa tiver a categoria exigida, sem criar linha no inventário (assim
//   não duplica e some sozinho quando o status acaba).

const TIERS = ['NONE', 'SUBSCRIBER', 'SUPER'];
const TIER_RANK = { NONE: 0, SUBSCRIBER: 1, SUPER: 2 };
const TIER_LABEL = { NONE: 'Membro', SUBSCRIBER: 'Assinante', SUPER: 'Super Assinante' };
// % de desconto na Loja por categoria (SUBSCRIBER_DISCOUNT = o do Assinante,
// mantido pelo nome antigo pra quem importa).
const TIER_DISCOUNT = { NONE: 0, SUBSCRIBER: 10, SUPER: 20 };
const SUBSCRIBER_DISCOUNT = TIER_DISCOUNT.SUBSCRIBER;
// Bônus de XP (%): mensagens no chat e XP das missões.
const TIER_XP_BONUS = { NONE: 0, SUBSCRIBER: 5, SUPER: 15 };
// Preço mensal em centavos (só exibição; o pagamento é combinado com a equipe).
const TIER_PRICE_CENTS = { SUBSCRIBER: 1350, SUPER: 2050 };
// Pacote de figurinhas personalizadas: quantas figurinhas pessoais cada
// categoria pode usar no chat (as que passarem do limite ficam guardadas,
// só não aparecem pra uso — ex.: assinatura acabou ou caiu de categoria).
const PERSONAL_STICKER_LIMIT = { NONE: 0, SUBSCRIBER: 5, SUPER: 15 };

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
  return TIER_DISCOUNT[normalizeTier(tier)] || 0;
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
  return { tier: t, label: TIER_LABEL[t], discount: TIER_DISCOUNT[t] || 0, xpBonus: TIER_XP_BONUS[t] || 0 };
};

// XP com o bônus da categoria (arredonda pra baixo; sempre pelo menos o XP base).
const withXpBonus = (xp, tier) => {
  const b = TIER_XP_BONUS[normalizeTier(tier)] || 0;
  return b > 0 ? Math.max(xp, Math.floor((xp * (100 + b)) / 100)) : xp;
};

module.exports = {
  TIERS, TIER_LABEL, SUBSCRIBER_DISCOUNT, TIER_DISCOUNT, TIER_XP_BONUS, TIER_PRICE_CENTS, withXpBonus, PERSONAL_STICKER_LIMIT,
  normalizeTier, tierRank, hasSubscriberBenefits, exclusiveOf, qualifiesFor,
  supporterDiscountFor, applyPct, priceFor, bundlePriceFor, pricing, supporterInfo,
};
