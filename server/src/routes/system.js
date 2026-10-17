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
const LATEST_YML = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download/latest.yml';
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
const { recordError } = require('../services/errorRing');
const recentErrors = new Map();
// Rota sem login obrigatório: se vier um token válido, guarda de quem era
// a tela (só o id) no ErrorLog; token ausente/inválido não muda nada.
const { verifyAccessToken } = require('../services/tokens');
function optionalUserId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try { return verifyAccessToken(header.slice(7))?.sub || null; } catch { return null; }
}
// Faxina do limite por IP: sem isso o Map guardava pra sempre uma entrada
// por IP que já mandou erro um dia (vazamento de memória lento).
const sweepRecentErrors = setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [ip, list] of recentErrors) {
    if (!list.length || list[list.length - 1] < cutoff) recentErrors.delete(ip);
  }
}, 5 * 60 * 1000);
sweepRecentErrors.unref?.();

// Guarda de conexão do app Android (ConnectionGuard.java): a página
// principal recebeu 502/503/504 do proxy da hospedagem enquanto o servidor
// reiniciava num deploy, o /api/health respondeu logo depois e o app
// recarregou sozinho ("falso alarme"). Ninguém ficou travado — não é erro
// pra aparecer na aba Saúde/ErrorLog; vai só pro log como aviso curto.
function isRecoveredDeployBlip(b) {
  return b?.where === 'android-conexao'
    && /\bhttp 50[234]\b/.test(String(b.message || ''))
    && /falso alarme/.test(String(b.message || ''));
}

router.post('/client-error', express.json({ limit: '16kb' }), (req, res) => {
  const ip = req.ip || 'x';
  const now = Date.now();
  const list = (recentErrors.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 10) return res.status(204).end();
  list.push(now); recentErrors.set(ip, list);
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const clip = (v, n) => String(v || '').slice(0, n).replace(/\s+/g, ' ');
  if (isRecoveredDeployBlip(b)) {
    console.info(`[android-conexao] ${clip(b.message, 120)} (deploy/reinício, recuperado sozinho) | ${clip(b.version, 40)}`);
    return res.status(204).end();
  }
  recordError('client', {
    where: b.where, path: b.path, message: b.message, stack: b.stack,
    userAgent: req.get('user-agent'), userId: optionalUserId(req),
  });
  console.warn(`[erro-de-tela] ${clip(b.where, 40)} ${clip(b.path, 120)} | ${clip(b.message, 300)} | ${clip(b.stack, 900)} | componentes: ${clip(b.componentStack, 900)} | ${clip(b.version, 40)}`);
  res.status(204).end();
});

module.exports = router;
module.exports.isRecoveredDeployBlip = isRecoveredDeployBlip;
