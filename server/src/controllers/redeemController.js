const crypto = require('crypto');
const prisma = require('../config/prisma');

// Códigos de resgate (igual ao "Resgatar códigos" do Discord): a staff cria
// um código que dá moedas, gemas e/ou um item da Loja (com prazo opcional).
// Cada pessoa resgata cada código uma vez; maxUses limita o total.
// Também: resumo de presentes (insígnia de presentes, igual ao Discord).

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40);
const ledger = () => require('../services/economyLedger');

// Tentativas erradas: no máximo 10 por 10 min por pessoa (evita chutar código).
const attempts = new Map();
function tooMany(userId) {
  const now = Date.now();
  const list = (attempts.get(userId) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(userId, list);
  return list.length >= 10;
}
const miss = (userId) => attempts.set(userId, [...(attempts.get(userId) || []), Date.now()]);

// POST /decorations/redeem { code }
async function redeem(req, res, next) {
  try {
    const userId = req.user.id;
    if (tooMany(userId)) return res.status(429).json({ error: 'Muitas tentativas. Espere uns minutos e tente de novo.' });
    const code = cleanCode(req.body?.code);
    if (code.length < 4) { miss(userId); return res.status(400).json({ error: 'Digite o código completo.' }); }
    const row = await prisma.redeemCode.findUnique({ where: { code } });
    if (!row) { miss(userId); return res.status(404).json({ error: 'Código inválido. Confira se digitou certinho.' }); }
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return res.status(410).json({ error: 'Esse código já expirou.' });

    let item = null;
    try {
      item = await prisma.$transaction(async (tx) => {
        const used = await tx.redeemCodeUse.findUnique({ where: { codeId_userId: { codeId: row.id, userId } } });
        if (used) throw fail('Você já resgatou esse código.', 409);
        const r = await tx.redeemCode.updateMany({ where: { id: row.id, uses: { lt: row.maxUses } }, data: { uses: { increment: 1 } } });
        if (r.count === 0) throw fail('Esse código já foi usado o máximo de vezes.', 410);
        await tx.redeemCodeUse.create({ data: { codeId: row.id, userId } });
        const data = {};
        if (row.rewardCoins > 0) data.coins = { increment: row.rewardCoins };
        if (row.rewardGems > 0) data.gems = { increment: row.rewardGems };
        if (Object.keys(data).length) await tx.user.update({ where: { id: userId }, data });
        if (row.itemKind && row.itemId) {
          const g = await require('../services/shopTimed').grantTimed(tx, userId, row.itemKind, row.itemId, row.itemDays || null);
          if (g) return { kind: row.itemKind, id: g.item.id, name: g.item.name, expiresAt: g.expiresAt, already: !!g.already };
        }
        return null;
      });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      if (e.code === 'P2002') return res.status(409).json({ error: 'Você já resgatou esse código.' });
      throw e;
    }
    if (row.rewardCoins || row.rewardGems) {
      ledger().recordTransaction(userId, { kind: 'CODE', label: `Código resgatado: ${code}`, coins: row.rewardCoins, gems: row.rewardGems });
    }
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, gems: true } });
    res.json({ ok: true, reward: { coins: row.rewardCoins, gems: row.rewardGems, item }, ...me });
  } catch (err) { next(err); }
}

// GET /decorations/gifts-summary — insígnia de presentes e progresso.
async function giftsSummary(req, res, next) {
  try {
    const { giftsGiven, tierFor, describeStat, STAT_TIERS } = require('./profileExtrasController');
    const [given, received] = await Promise.all([
      giftsGiven(req.user.id),
      prisma.userNotice.count({ where: { userId: req.user.id, kind: 'GIFT' } }).catch(() => 0),
    ]);
    const t = STAT_TIERS.gifts;
    res.json({
      given, received,
      badge: describeStat(tierFor('gifts', given)),
      tiers: t.steps.map((s, i) => ({ level: i + 1, name: t.names[i], need: s, reached: given >= s })),
    });
  } catch (err) { next(err); }
}

// ---------- Staff ----------
async function adminList(req, res, next) {
  try {
    const codes = await prisma.redeemCode.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ codes });
  } catch (err) { next(err); }
}

async function adminCreate(req, res, next) {
  try {
    const b = req.body || {};
    const int = (v, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : 0; };
    let code = cleanCode(b.code);
    if (!code) code = `PC-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if (code.length < 4) return res.status(400).json({ error: 'O código precisa de pelo menos 4 letras/números.' });
    const data = {
      code,
      note: b.note ? String(b.note).trim().slice(0, 120) : null,
      rewardCoins: int(b.rewardCoins, 10000000),
      rewardGems: int(b.rewardGems, 100000),
      maxUses: Math.max(1, int(b.maxUses, 1000000) || 1),
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      createdById: req.user.id,
    };
    if (data.expiresAt && Number.isNaN(data.expiresAt.getTime())) data.expiresAt = null;
    const kind = ['deco', 'effect', 'font', 'style'].includes(b.itemKind) ? b.itemKind : null;
    if (kind && b.itemId) {
      const { findItem, isLimited } = require('./shopController');
      const it = await findItem(prisma, kind, b.itemId);
      if (!it) return res.status(400).json({ error: 'Item não encontrado.' });
      if (isLimited(it)) return res.status(400).json({ error: 'Itens limitados não podem sair por código (o estoque é contado).' });
      data.itemKind = kind; data.itemId = it.id;
      data.itemDays = int(b.itemDays, 3650) || null;
    }
    if (!data.rewardCoins && !data.rewardGems && !data.itemId) return res.status(400).json({ error: 'Escolha pelo menos uma recompensa (moedas, gemas ou item).' });
    const created = await prisma.redeemCode.create({ data });
    res.status(201).json({ code: created });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Já existe um código igual.' });
    next(err);
  }
}

async function adminRemove(req, res, next) {
  try {
    await prisma.redeemCode.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Código não encontrado.' });
    next(err);
  }
}

module.exports = { redeem, giftsSummary, adminList, adminCreate, adminRemove };
