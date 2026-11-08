// Cupons de desconto da Loja.
//
// A staff cria cupons de porcentagem (PERCENT, 1–100%) ou valor fixo
// (FIXED, em moedas), com validade, limite de usos e preço mínimo. Cada
// pessoa usa cada cupom uma vez só (CouponUse único). O desconto é aplicado
// DENTRO da transação da compra (shopController): se a compra falhar, o uso
// do cupom é desfeito junto.
//
// Vale só pra compras com moedas. As assinaturas (Assinante/Super) não têm
// preço calculado no código — a staff ativa manualmente — então não entram.
const { deps, httpError, intIn } = require('./common');

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
const MAX_FIXED = 1_000_000;
const MAX_LIST = 200;

function normalizeCode(raw) {
  const c = String(raw || '').trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** Quanto o cupom desconta de `price` (nunca mais que o preço). */
function discountFor(coupon, price) {
  const p = Math.max(0, Math.trunc(price) || 0);
  if (!coupon || p <= 0) return 0;
  if (coupon.kind === 'FIXED') return Math.min(p, Math.max(0, coupon.value));
  const pct = Math.min(100, Math.max(0, coupon.value));
  return Math.min(p, Math.floor((p * pct) / 100));
}

/** Motivo pelo qual o cupom não serve (ou null se serve). */
function problemWith(coupon, { price, now = new Date(), alreadyUsed = false } = {}) {
  if (!coupon || !coupon.active) return 'Cupom inválido ou desativado.';
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return 'Esse cupom já venceu.';
  if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.uses >= coupon.maxUses) return 'Esse cupom já esgotou.';
  if (alreadyUsed) return 'Você já usou esse cupom.';
  if (coupon.minPrice && price < coupon.minPrice) return `Esse cupom vale para compras a partir de ${coupon.minPrice} moedas.`;
  if (discountFor(coupon, price) <= 0) return 'Esse cupom não dá desconto nessa compra.';
  return null;
}

/** Prévia pra tela de confirmação (não usa o cupom). */
async function preview(userId, { code, price }, over = {}) {
  const d = deps(over);
  const c = normalizeCode(code);
  if (!c) throw httpError(400, 'Código de cupom inválido.');
  const p = intIn(price, 0, 100_000_000);
  if (p === null) throw httpError(400, 'Preço inválido.');
  const coupon = await d.db.coupon.findUnique({ where: { code: c } });
  const used = coupon ? await d.db.couponUse.findUnique({ where: { couponId_userId: { couponId: coupon.id, userId } } }) : null;
  const problem = problemWith(coupon, { price: p, now: d.now, alreadyUsed: !!used });
  if (problem) throw httpError(400, problem, { code: 'COUPON_INVALID' });
  const discount = discountFor(coupon, p);
  return { code: c, kind: coupon.kind, value: coupon.value, discount, final: p - discount };
}

/**
 * Usa o cupom dentro da transação `tx` da compra. Devolve
 * { couponId, code, discount, final }. Qualquer problema lança erro 400 —
 * e a transação inteira (débito, item) é desfeita.
 */
async function applyInTx(tx, { code, userId, price, currency = 'coins', target = null }, now = new Date()) {
  if (currency !== 'coins') throw httpError(400, 'Cupons valem só para compras com moedas.', { code: 'COUPON_INVALID' });
  const c = normalizeCode(code);
  if (!c) throw httpError(400, 'Código de cupom inválido.', { code: 'COUPON_INVALID' });
  const coupon = await tx.coupon.findUnique({ where: { code: c } });
  const used = coupon ? await tx.couponUse.findUnique({ where: { couponId_userId: { couponId: coupon.id, userId } } }) : null;
  const problem = problemWith(coupon, { price, now, alreadyUsed: !!used });
  if (problem) throw httpError(400, problem, { code: 'COUPON_INVALID' });
  // Concorrência otimista: só conta o uso se ninguém usou entre a leitura e agora.
  const r = await tx.coupon.updateMany({ where: { id: coupon.id, uses: coupon.uses, active: true }, data: { uses: { increment: 1 } } });
  if (r.count !== 1) throw httpError(409, 'O cupom acabou de ser usado por outra pessoa. Tente de novo.', { code: 'COUPON_RACE' });
  const discount = discountFor(coupon, price);
  try {
    await tx.couponUse.create({ data: { couponId: coupon.id, userId, discount, target: target ? String(target).slice(0, 120) : null } });
  } catch (err) {
    if (err?.code === 'P2002') throw httpError(400, 'Você já usou esse cupom.', { code: 'COUPON_INVALID' });
    throw err;
  }
  return { couponId: coupon.id, code: c, discount, final: price - discount };
}

// ---------- Staff ----------
async function adminList(over = {}) {
  const d = deps(over);
  const coupons = await d.db.coupon.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_LIST });
  return { coupons };
}

async function adminCreate(staffId, body = {}, over = {}) {
  const d = deps(over);
  const code = normalizeCode(body.code);
  if (!code) throw httpError(400, 'Código inválido: use de 3 a 32 letras, números, "-" ou "_".');
  const kind = body.kind === 'FIXED' ? 'FIXED' : 'PERCENT';
  const value = kind === 'PERCENT' ? intIn(body.value, 1, 100) : intIn(body.value, 1, MAX_FIXED);
  if (!value) throw httpError(400, kind === 'PERCENT' ? 'Desconto de 1 a 100%.' : 'Desconto em moedas inválido.');
  const maxUses = body.maxUses === '' || body.maxUses === null || body.maxUses === undefined ? null : intIn(body.maxUses, 1, 1_000_000);
  if (body.maxUses && !maxUses) throw httpError(400, 'Limite de usos inválido.');
  const minPrice = body.minPrice === '' || body.minPrice === null || body.minPrice === undefined ? null : intIn(body.minPrice, 1, MAX_FIXED);
  let expiresAt = null;
  if (body.expiresAt) {
    expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= d.now) throw httpError(400, 'A validade precisa ser uma data no futuro.');
  }
  try {
    const coupon = await d.db.coupon.create({
      data: { code, kind, value, maxUses, minPrice, expiresAt, note: String(body.note || '').trim().slice(0, 120) || null, createdById: staffId },
    });
    return { coupon };
  } catch (err) {
    if (err?.code === 'P2002') throw httpError(409, 'Já existe um cupom com esse código.');
    throw err;
  }
}

async function adminSetActive(id, active, over = {}) {
  const d = deps(over);
  const c = await d.db.coupon.findUnique({ where: { id: String(id || '') } });
  if (!c) throw httpError(404, 'Cupom não encontrado.');
  const coupon = await d.db.coupon.update({ where: { id: c.id }, data: { active: !!active } });
  return { coupon };
}

module.exports = { normalizeCode, discountFor, problemWith, preview, applyInTx, adminList, adminCreate, adminSetActive };
