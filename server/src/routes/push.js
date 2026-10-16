const express = require('express');
const ctrl = require('../controllers/pushController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/register', ctrl.registerToken);
router.post('/unregister', ctrl.unregisterToken);
// Web Push (navegador/PWA)
router.get('/web/public-key', ctrl.webPublicKey);
router.post('/web/subscribe', ctrl.webSubscribe);
router.post('/web/unsubscribe', ctrl.webUnsubscribe);

module.exports = router;
