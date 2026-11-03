const express = require('express');
const mobileUpdate = require('../services/mobileUpdate');

// Público (sem login): o app pergunta antes mesmo de a pessoa entrar.
// Só devolve informação pública (as mesmas das releases do GitHub).
const router = express.Router();

// GET /api/mobile/update?native=v1.2.3&current=<versão do conteúdo>
router.get('/update', async (req, res) => {
  const native = String(req.query.native || '').slice(0, 40);
  const current = String(req.query.current || '').slice(0, 80);
  let manifest;
  try {
    manifest = await mobileUpdate.getManifest();
  } catch {
    // GitHub fora do ar: ainda responde a versão do conteúdo, sem exigir .apk.
    manifest = { webVersion: mobileUpdate.readWebVersion() };
  }
  res.set('Cache-Control', 'no-cache');
  res.json(mobileUpdate.decideUpdate({ native, current, manifest }));
});

module.exports = router;
