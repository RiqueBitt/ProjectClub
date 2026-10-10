const express = require('express');
const ctrl = require('../controllers/systemController');

// SEM requireAuth de propósito — quem chama é o GitHub Actions, não uma
// pessoa logada. A proteção é o segredo compartilhado checado dentro do
// próprio controller (ver systemController.publishRelease).
const router = express.Router();

router.post('/publish-release', ctrl.publishRelease);

// Versão mais nova do app de PC (lida do latest.yml que o electron-updater
// usa) — o botão verde de "atualizar" da barra do app compara com a dele.
const { cacheGetOrSet } = require('../config/redis');
const LATEST_YML = 'https://github.com/RiqueBitt/ProjectClub-Downloads/releases/latest/download/latest.yml';
router.get('/desktop-latest', async (_req, res) => {
  try {
    const data = await cacheGetOrSet('desktop:latest', 5 * 60, async () => {
      const r = await fetch(LATEST_YML, { redirect: 'follow', headers: { 'User-Agent': 'ProjectClub' } });
      if (!r.ok) return { version: null };
      const text = await r.text();
      const m = text.match(/^version:\s*['"]?([0-9][\w.-]*)/m);
      const d = text.match(/^releaseDate:\s*['"]?([^'"\n]+)/m);
      return { version: m ? m[1] : null, releaseDate: d ? d[1] : null };
    });
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json(data);
  } catch {
    res.json({ version: null });
  }
});

module.exports = router;
