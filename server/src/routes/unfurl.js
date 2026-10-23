const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { redis } = require('../config/redis');
const { fetchPreview, fetchPreviewImage, validateUrl } = require('../services/unfurl');

// GET /api/unfurl?url=... — prévia de link (ver services/unfurl.js).
// Resultado (inclusive "sem prévia") fica 24h no Redis; a imagem da
// prévia é servida por /api/unfurl/image?u=<hash> — só URLs que saíram de
// uma prévia gerada aqui, nunca uma URL arbitrária (não vira proxy aberto).
const router = express.Router();
// (A imagem fica sem login: <img> não manda o token — e ela só serve
// URLs que saíram de uma prévia gerada aqui.)

const TTL_SECONDS = 24 * 3600;
const NEGATIVE_TTL_SECONDS = 2 * 3600;
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);

// Teto por pessoa (memória do processo): 60 prévias novas por minuto.
const perUser = new Map();
function allow(userId) {
  const now = Date.now();
  const e = perUser.get(userId);
  if (!e || now - e.start > 60000) { perUser.set(userId, { start: now, n: 1 }); return true; }
  e.n += 1;
  if (perUser.size > 5000) perUser.clear();
  return e.n <= 60;
}

// Só uma busca por URL ao mesmo tempo (várias pessoas abrindo o mesmo canal).
const inflight = new Map();

router.get('/', requireAuth, async (req, res) => {
  const u = validateUrl(req.query.url);
  if (!u) return res.status(400).json({ error: 'URL inválida.' });
  const url = u.toString();
  const key = `unfurl:v1:${hashOf(url)}`;
  try {
    const cached = await redis.get(key).catch(() => null);
    if (cached !== null) {
      res.set('Cache-Control', 'private, max-age=3600');
      return res.json({ preview: JSON.parse(cached) });
    }
    if (!allow(req.user.id)) return res.status(429).json({ error: 'Calma — prévias demais em pouco tempo.' });

    let job = inflight.get(url);
    if (!job) {
      job = fetchPreview(url).catch(() => null).finally(() => inflight.delete(url));
      inflight.set(url, job);
    }
    const preview = await job;
    let out = null;
    if (preview) {
      out = { ...preview };
      if (preview.image) {
        const imageKey = hashOf(preview.image);
        await redis.set(`unfurl:img:${imageKey}`, preview.image, 'EX', TTL_SECONDS).catch(() => {});
        out.image = `/api/unfurl/image?u=${imageKey}`;
      }
    }
    await redis.set(key, JSON.stringify(out), 'EX', out ? TTL_SECONDS : NEGATIVE_TTL_SECONDS).catch(() => {});
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ preview: out });
  } catch {
    res.json({ preview: null });
  }
});

router.get('/image', async (req, res) => {
  const id = typeof req.query.u === 'string' && /^[0-9a-f]{32}$/.test(req.query.u) ? req.query.u : null;
  if (!id) return res.status(400).end();
  try {
    const target = await redis.get(`unfurl:img:${id}`).catch(() => null);
    if (!target) return res.status(404).end();
    const img = await fetchPreviewImage(target).catch(() => null);
    if (!img) return res.status(404).end();
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(img.buffer);
  } catch {
    res.status(502).end();
  }
});

module.exports = router;
