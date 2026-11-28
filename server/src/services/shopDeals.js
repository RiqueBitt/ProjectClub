// Ofertas da Loja pra quem tem poucas moedas (engajamento, nov/2026):
//
// - Oferta da semana: toda segunda (horário de Brasília) a Loja escolhe 3
//   itens (fonte, estilo de perfil ou efeito de texto) que custam entre
//   POOL_MIN e POOL_MAX moedas e vende pela metade. A escolha é por sorteio
//   fixo da semana (hash), então todo mundo vê os mesmos 3.
// - Primeira compra: quem nunca gastou moedas na Loja (compra ou presente)
//   paga metade em moedas na primeira compra.
// Só valem em moedas e não acumulam: fica o menor preço entre oferta e o
// desconto de Assinante. O Rust repassa pro Node a cestinha com preço de
// oferta (rust/pc-server/src/routes/shop.rs), então a regra mora só aqui.
const crypto = require('crypto');
const sup = require('./supporters');

const DEAL_PCT = 50;
const FIRST_PCT = 50;
const DEAL_COUNT = 3;
const POOL_MIN = 300;
const POOL_MAX = 1200;
const POOL_KINDS = ['FONT', 'STYLE', 'TEXTFX'];
const TIME_ZONE = 'America/Sao_Paulo';

/** Segunda-feira (data de Brasília) da semana de `now`, ex.: "2026-11-23". */
function weekKey(now = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${ymd}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Quando a oferta da semana troca (próxima segunda 00:00 em Brasília = 03:00 UTC). */
function weekEndsAt(now = new Date()) {
  const d = new Date(`${weekKey(now)}T03:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

const rank = (week, id) => crypto.createHash('sha1').update(`${week}:${id}`).digest('hex');

/** Escolhe os itens da semana entre os candidatos (função pura, pra testar). */
function pickWeekly(items, week) {
  return items
    .filter((it) => POOL_KINDS.includes(it.kind) && it.active !== false && !sup.exclusiveOf(it)
      && (it.stock === null || it.stock === undefined)
      && Number.isFinite(it.priceCoins) && it.priceCoins >= POOL_MIN && it.priceCoins <= POOL_MAX)
    .sort((a, b) => (rank(week, a.id) < rank(week, b.id) ? -1 : 1))
    .slice(0, DEAL_COUNT)
    .map((it) => it.id);
}

let cache = { week: null, at: 0, ids: [] };
async function weeklyIds(db = require('../config/prisma'), now = new Date()) {
  const week = weekKey(now);
  if (cache.week === week && Date.now() - cache.at < 10 * 60_000) return cache.ids;
  const hidden = await db.shopCollection.findMany({ where: { OR: [{ showInShop: false }, { active: false }] }, select: { id: true } });
  const hiddenIds = new Set(hidden.map((c) => c.id));
  const items = await db.shopItem.findMany({
    where: { active: true, kind: { in: POOL_KINDS }, priceCoins: { gte: POOL_MIN, lte: POOL_MAX }, stock: null },
    select: { id: true, kind: true, active: true, priceCoins: true, stock: true, exclusiveTier: true, collectionId: true },
  });
  const ids = pickWeekly(items.filter((it) => !hiddenIds.has(it.collectionId)), week);
  cache = { week, at: Date.now(), ids };
  return ids;
}

/** Nunca gastou moedas na Loja (compra ou presente)? */
async function isFirstPurchase(db, userId) {
  const n = await db.economyTransaction.count({ where: { userId, kind: { in: ['SHOP', 'GIFT'] }, coins: { lt: 0 } } });
  return n === 0;
}

/** Tudo que o cálculo de preço precisa saber das ofertas pra essa pessoa. */
// Se der erro (banco fora, tabela faltando), segue sem oferta: a compra
// nunca trava por causa disso, só sai pelo preço normal.
async function context(db, userId, now = new Date()) {
  const [ids, first] = await Promise.all([
    weeklyIds(db, now).catch(() => []),
    userId ? isFirstPurchase(db, userId).catch(() => false) : false,
  ]);
  return { dealIds: new Set(ids), first, week: weekKey(now) };
}

/**
 * Igual a supporters.priceFor, mas com as ofertas: `{ base, discount, final, source }`.
 * source = 'DEAL' (oferta da semana), 'FIRST' (primeira compra), 'SUBSCRIBER' ou null.
 */
function priceFor(item, currency, tier, ctx) {
  const p = sup.priceFor(item, currency, tier);
  if (currency !== 'coins' || p.base === null || p.base <= 0 || !ctx) return p;
  const deal = ctx.dealIds?.has(item.id);
  const pct = deal ? DEAL_PCT : ctx.first ? FIRST_PCT : 0;
  if (!pct) return p;
  const fin = sup.applyPct(p.base, pct);
  if (fin >= p.final) return p;
  return { base: p.base, discount: pct, final: fin, source: deal ? 'DEAL' : 'FIRST' };
}

function pricing(item, tier, ctx) {
  const coins = priceFor(item, 'coins', tier, ctx);
  const gems = sup.priceFor(item, 'gems', tier);
  return { coins, gems, discount: Math.max(coins.discount, gems.discount) };
}

/** Texto curto do desconto pro extrato ("-50% Oferta da semana"). */
function discountLabel(p) {
  if (!p?.discount) return '';
  if (p.source === 'DEAL') return ` (-${p.discount}% Oferta da semana)`;
  if (p.source === 'FIRST') return ` (-${p.discount}% primeira compra)`;
  return ` (-${p.discount}% Assinante)`;
}

/** O que a Loja mostra sobre as ofertas. */
function summary(ctx, now = new Date()) {
  return { weekly: [...(ctx?.dealIds || [])], pct: DEAL_PCT, endsAt: weekEndsAt(now), firstPurchase: !!ctx?.first, firstPct: FIRST_PCT };
}

module.exports = {
  DEAL_PCT, FIRST_PCT, DEAL_COUNT, POOL_MIN, POOL_MAX,
  weekKey, weekEndsAt, pickWeekly, weeklyIds, isFirstPurchase, context, priceFor, pricing, discountLabel, summary,
  _test: { reset: () => { cache = { week: null, at: 0, ids: [] }; } },
};
