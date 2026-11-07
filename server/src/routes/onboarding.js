const express = require('express');
const { requireAuth } = require('../middleware/auth');
const onboarding = require('../services/onboarding');

// Primeiros passos (checklist com moedas) + estado do tour de boas-vindas.
const router = express.Router();
router.use(requireAuth);

router.get('/', onboarding.getMine);
router.post('/claim/:step', onboarding.postClaim);
// :key = tour (visto) | dismiss (checklist escondido); body { on: false } desfaz.
router.post('/meta/:key', onboarding.postMeta);

module.exports = router;
