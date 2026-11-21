// Mascote pinguim do perfil (Fase 8) — regras em services/pet.js.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pet = require('../services/pet');

const router = express.Router();
router.use(requireAuth);

const fail = (res, next) => (err) => {
  if (err instanceof pet.PetError) return res.status(err.status).json({ error: err.message, code: err.code });
  return next(err);
};

// Catálogo fixo (estágios + acessórios + cores).
router.get('/catalog', (req, res) => {
  res.json({ stages: pet.STAGES, accessories: pet.ACCESSORIES, colors: pet.COLORS, slots: pet.SLOTS });
});

router.get('/me', (req, res, next) => {
  pet.getOrCreatePet(req.user.id).then((r) => res.json(r)).catch(fail(res, next));
});

router.patch('/me', (req, res, next) => {
  pet.updatePet(req.user.id, { name: req.body?.name, color: req.body?.color }).then((r) => res.json(r)).catch(fail(res, next));
});

router.post('/me/care', (req, res, next) => {
  pet.careForPet(req.user.id).then((r) => res.json(r)).catch(fail(res, next));
});

router.post('/me/accessories/:id/buy', (req, res, next) => {
  pet.buyAccessory(req.user.id, String(req.params.id)).then((r) => res.json(r)).catch(fail(res, next));
});

router.post('/me/equip', (req, res, next) => {
  pet.equipAccessory(req.user.id, { slot: String(req.body?.slot || ''), accessoryId: req.body?.accessoryId ? String(req.body.accessoryId) : null })
    .then((r) => res.json(r)).catch(fail(res, next));
});

// Pinguim de outra pessoa (perfil / miniperfil).
router.get('/user/:userId', (req, res, next) => {
  pet.getPublicPet(String(req.params.userId)).then((p) => res.json({ pet: p })).catch(fail(res, next));
});

module.exports = router;
