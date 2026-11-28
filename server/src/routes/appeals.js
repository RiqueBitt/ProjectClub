const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const { requireAuth } = require('../middleware/auth');
const { requireStaff } = require('../services/staffOps');
const ctrl = require('../controllers/appealsController');

// Revisão de banimento/suspensão (Fase 5) — ver services/appeals.js.
const router = express.Router();

// Pessoa punida (sem sessão, por IP): ver o estado é leve; pedir revisão é
// raro (e de qualquer forma é um só por punição).
const readLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  store: createRateLimitStore('appeal-read'),
  message: { error: 'Muitas tentativas. Espere alguns minutos.' },
});
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  store: createRateLimitStore('appeal-submit'),
  message: { error: 'Muitos pedidos. Tente novamente mais tarde.' },
});
// Equipe: por conta.
const staffLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`, store: createRateLimitStore('appeal-staff'),
  message: { error: 'Muitas ações seguidas. Espere um pouco.' },
});

router.get('/mine', readLimiter, ctrl.mine);
router.post('/', submitLimiter, ctrl.submit);
router.get('/staff', requireAuth, requireStaff, staffLimiter, ctrl.listForStaff);
router.post('/staff/:id/accept', requireAuth, requireStaff, staffLimiter, ctrl.accept);
router.post('/staff/:id/deny', requireAuth, requireStaff, staffLimiter, ctrl.deny);

module.exports = router;
