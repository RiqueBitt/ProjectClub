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

// Erros de tela que o ErrorBoundary pegou no app de alguém — vão pro log
// do servidor (sem dados pessoais além da página e do erro) pra dar pra
// achar e corrigir a causa. Limite simples por IP.
const recentErrors = new Map();
router.post('/client-error', express.json({ limit: '16kb' }), (req, res) => {
  const ip = req.ip || 'x';
  const now = Date.now();
  const list = (recentErrors.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 10) return res.status(204).end();
  list.push(now); recentErrors.set(ip, list);
  const b = req.body || {};
  const clip = (v, n) => String(v || '').slice(0, n).replace(/\s+/g, ' ');
  console.warn(`[erro-de-tela] ${clip(b.where, 40)} ${clip(b.path, 120)} | ${clip(b.message, 300)} | ${clip(b.stack, 900)} | componentes: ${clip(b.componentStack, 900)} | ${clip(b.version, 40)}`);
  res.status(204).end();
});

module.exports = router;
