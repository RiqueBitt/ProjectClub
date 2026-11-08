const prisma = require('../config/prisma');
const { safeUpsert } = require('../utils/prismaSafe');
const { cacheGetOrSet } = require('../config/redis');

// ---------- Busca de GIFs (KLIPY, API compatível com o Tenor v2) ----------
// Antes o navegador falava direto com a KLIPY usando VITE_KLIPY_KEY, que o
// Vite só embute na hora de compilar — e o site de produção é compilado no
// CI sem essa variável, então o seletor mostrava "Busca de GIFs ainda não
// configurada" pra todo mundo. Agora a chave fica só no servidor (nunca vai
// pro navegador) e o cliente chama /api/gifs/*. Aceita KLIPY_KEY ou o nome
// antigo VITE_KLIPY_KEY, que já está configurado na hospedagem.
const KLIPY_BASE = 'https://api.klipy.com/v2';
const KLIPY_CLIENT = 'embercord';
const klipyKey = () => process.env.KLIPY_KEY || process.env.VITE_KLIPY_KEY || '';

function mapResults(data) {
  return (data?.results || []).map((r) => ({
    id: r.id,
    preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
    full: r.media_formats?.gif?.url,
  })).filter((g) => g.full);
}

async function klipy(path, params) {
  const key = klipyKey();
  if (!key) { const e = new Error('unconfigured'); e.code = 'GIF_UNCONFIGURED'; throw e; }
  const qs = new URLSearchParams({ ...params, key, client_key: KLIPY_CLIENT, media_filter: 'gif' });
  const res = await fetch(`${KLIPY_BASE}/${path}?${qs}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    // Nunca loga a URL (tem a chave) — só o status.
    console.warn(`[gifs] KLIPY /${path} respondeu ${res.status}`);
    const e = new Error('upstream'); e.code = 'GIF_UPSTREAM'; throw e;
  }
  return res.json();
}

function gifError(res, err, next) {
  if (err.code === 'GIF_UNCONFIGURED') return res.status(503).json({ error: 'Busca de GIFs não configurada.', code: 'unconfigured' });
  if (err.code === 'GIF_UPSTREAM' || err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError) {
    return res.status(502).json({ error: 'Não foi possível carregar GIFs agora.', code: 'upstream' });
  }
  return next(err);
}

async function searchGifs(req, res, next) {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 50);
    const locale = String(req.query.locale || 'pt_BR').slice(0, 10);
    const cacheKey = q ? `gifs:search:${locale}:${limit}:${q.toLowerCase()}` : `gifs:featured:${locale}:${limit}`;
    const results = await cacheGetOrSet(cacheKey, q ? 600 : 1800, async () => mapResults(
      await klipy(q ? 'search' : 'featured', q ? { q, limit, locale } : { limit, locale }),
    ));
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ results });
  } catch (err) { gifError(res, err, next); }
}

async function gifCategories(req, res, next) {
  try {
    const locale = String(req.query.locale || 'pt_BR').slice(0, 10);
    const tags = await cacheGetOrSet(`gifs:categories:${locale}`, 6 * 3600, async () => {
      const data = await klipy('categories', { locale });
      return (data?.tags || []).slice(0, 12).map((t) => ({ name: t.name, searchterm: t.searchterm, image: t.image }));
    });
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ tags });
  } catch (err) { gifError(res, err, next); }
}


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
    const gif = await safeUpsert(prisma.favoriteGif, {
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

module.exports = { listFavoriteGifs, addFavoriteGif, removeFavoriteGif, searchGifs, gifCategories, _mapResults: mapResults };
