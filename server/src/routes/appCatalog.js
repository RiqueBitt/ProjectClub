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
