const express = require('express');
const ctrl = require('../controllers/appCatalogController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Item pedido: "melhore também essa aba de apps... tudo sendo
// configurado do painel da staff" — qualquer pessoa logada vê o
// catálogo (não precisa ser staff pra isso, só pra EDITAR — ver
// routes/admin.js), então só requireAuth aqui, sem requirePlatformAdmin.
router.get('/', requireAuth, ctrl.listPublicAppCatalog);

// Releases dos apps (público: são as mesmas informações públicas do GitHub).
// O app para computador usa isto em vez de chamar a API do GitHub direto,
// que bloqueia (HTTP 403) depois de 60 consultas por hora por IP.
const appReleases = require('../services/appReleases');

// Dados mínimos de um app para o app para computador instalar apps que
// entraram no catálogo depois da versão que a pessoa tem (ver
// ensureModule em desktop/projectMcManager.js). Só apps do Project Club.
router.get('/module/:moduleId', (req, res) => {
  const { BUILTIN_APPS } = require('../services/builtinApps');
  const app = BUILTIN_APPS.find((a) => a.moduleId === req.params.moduleId && a.released !== false);
  if (!app || !appReleases.isAllowedRepo(app.name)) return res.status(404).json({ error: 'App desconhecido' });
  res.set('Cache-Control', 'public, max-age=600');
  res.json({ displayName: app.name, repo: app.name, description: (app.description || '').split(':')[0] });
});
// Versão publicada mais recente de cada app (para a página inicial).
const LANDING_REPOS = { gameproject: 'GameProject', photoproject: 'PhotoProject', projectmc: 'ProjectMC', hyproject: 'HyProject', davinciproject: 'CutProject', waveproject: 'WaveProject', texelproject: 'TexelProject', forgeproject: 'ForgeProject', canvasproject: 'CanvasProject' };
router.get('/versions', async (_req, res) => {
  const out = {};
  await Promise.all(Object.entries(LANDING_REPOS).map(async ([id, repo]) => {
    try {
      const list = await appReleases.getReleases(repo);
      const rel = list.find((r) => !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(r.tag_name || ''));
      if (rel) out[id] = { version: rel.tag_name.replace(/^v/i, ''), date: rel.published_at };
    } catch { /* sem versão publicada ainda */ }
  }));
  res.set('Cache-Control', 'public, max-age=300');
  res.json(out);
});

router.get('/releases/:repo', async (req, res) => {
  const { repo } = req.params;
  if (!appReleases.isAllowedRepo(repo)) return res.status(404).json({ error: 'App desconhecido' });
  try {
    const releases = await appReleases.getReleases(repo);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(releases);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
