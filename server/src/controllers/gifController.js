const prisma = require('../config/prisma');

async function listFavoriteGifs(req, res, next) {
  try {
    const gifs = await prisma.favoriteGif.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ gifs });
  } catch (err) { next(err); }
}

async function addFavoriteGif(req, res, next) {
  try {
    const { gifId, url, preview } = req.body;
    if (!url) return res.status(400).json({ error: 'URL do GIF é obrigatória.' });
    // A GIF favorited straight from search has a stable provider id; one
    // favorited off an already-sent chat message doesn't (it's just a
    // bare-URL message — see Message.jsx), so the URL itself is the fallback
    // dedupe key in that case.
    const key = (gifId || url).toString().slice(0, 300);
    const gif = await prisma.favoriteGif.upsert({
      where: { userId_gifId: { userId: req.user.id, gifId: key } },
      update: {},
      create: { userId: req.user.id, gifId: key, url, preview: preview || url },
    });
    res.status(201).json({ gif });
  } catch (err) { next(err); }
}

async function removeFavoriteGif(req, res, next) {
  try {
    const { gifId } = req.params;
    await prisma.favoriteGif.deleteMany({ where: { userId: req.user.id, gifId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { listFavoriteGifs, addFavoriteGif, removeFavoriteGif };
