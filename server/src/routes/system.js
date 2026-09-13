const express = require('express');
const ctrl = require('../controllers/systemController');

// SEM requireAuth de propósito — quem chama é o GitHub Actions, não uma
// pessoa logada. A proteção é o segredo compartilhado checado dentro do
// próprio controller (ver systemController.publishRelease).
const router = express.Router();

router.post('/publish-release', ctrl.publishRelease);
router.post('/migrate-layout-style-to-discord', ctrl.migrateLayoutStyleToDiscord);

module.exports = router;
