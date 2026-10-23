const prisma = require('../config/prisma');
const { normalizeTier, PERSONAL_STICKER_LIMIT } = require('../services/supporters');

// Pacote de figurinhas personalizadas: Assinante pode ter até 5 figurinhas
// próprias e Super Assinante até 15 — só quem enviou consegue usar no chat
// (igual às figurinhas pessoais do Discord). Se a assinatura acabar ou cair
// de categoria, nada é apagado: as que passarem do limite só ficam
// escondidas (contadas em `hidden`) até a pessoa voltar a assinar.

async function tierAndLimit(userId) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { supporterTier: true } });
  const tier = normalizeTier(me?.supporterTier);
  return { tier, limit: PERSONAL_STICKER_LIMIT[tier] || 0 };
}

// Nome amigável: tira extensão e caracteres estranhos, 2-32 caracteres.
function sanitizeName(raw, fallback) {
  const clean = (v) => String(v || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\p{L}\p{N}_ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
    .trim();
  let name = clean(raw);
  if (name.length < 2) name = clean(fallback);
  if (name.length < 2) name = 'figurinha';
  return name;
}

async function listMine(req, res, next) {
  try {
    const { tier, limit } = await tierAndLimit(req.user.id);
    const all = await prisma.personalSticker.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ stickers: all.slice(0, limit), hidden: Math.max(0, all.length - limit), limit, tier });
  } catch (err) { next(err); }
}

async function createPersonalSticker(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const { tier, limit } = await tierAndLimit(req.user.id);
    const count = await prisma.personalSticker.count({ where: { ownerId: req.user.id } });
    if (count >= limit) {
      const error = limit === 0
        ? `Figurinhas personalizadas são para Assinantes. Vire Assinante na Loja pra enviar até ${PERSONAL_STICKER_LIMIT.SUBSCRIBER} figurinhas suas!`
        : tier === 'SUPER'
          ? `Você já chegou no limite de ${limit} figurinhas personalizadas. Remova uma pra enviar outra.`
          : `Você já chegou no limite de ${limit} figurinhas. Vire Super Assinante pra ter até ${PERSONAL_STICKER_LIMIT.SUPER}!`;
      return res.status(403).json({ error, limit, tier });
    }
    const name = sanitizeName(req.body?.name, req.file.originalname);
    const sticker = await prisma.personalSticker.create({
      data: { ownerId: req.user.id, name, url: req.file.url },
    });
    res.status(201).json({ sticker, limit, tier });
  } catch (err) { next(err); }
}

async function deletePersonalSticker(req, res, next) {
  try {
    const sticker = await prisma.personalSticker.findUnique({ where: { id: req.params.id } });
    if (!sticker || sticker.ownerId !== req.user.id) return res.status(404).json({ error: 'Figurinha não encontrada.' });
    await prisma.personalSticker.delete({ where: { id: sticker.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listMine, createPersonalSticker, deletePersonalSticker };
