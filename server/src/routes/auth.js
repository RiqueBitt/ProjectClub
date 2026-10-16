const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const ctrl = require('../controllers/authController');
const oauthCtrl = require('../controllers/oauthController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, store: createRateLimitStore('auth') });
// Login is the prime brute-force/credential-stuffing target (it's also where
// the 2FA code is checked, inline, in ctrl.login), so it gets its own
// tighter, shorter-window limiter instead of sharing the more generous one
// above with registration/password-reset requests. Backed by Redis (not
// the default in-memory store) so the limit holds even across more than
// one server instance — a brute-force attempt can't just get 1 extra
// try-budget per instance behind a load balancer.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('login'),
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});
// The verification code is only 6 digits (1M combinations); scoped to the
// caller's own account so it's not a cross-account risk, but still worth
// rate-limiting against scripted guessing.
const codeLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, store: createRateLimitStore('code') });
// Entrar com Google/Discord/GitHub: início, callback e conexão pelas
// Configurações contam no mesmo balde por IP (cada login legítimo gasta
// 2 — start + callback).
const oauthLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  store: createRateLimitStore('oauth'),
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});

// Cadastro direto desativado (410) — contas novas só pelo fluxo de
// inscrição em /api/applications (ver authController.register).
router.post('/register', authLimiter, ctrl.register);
router.post('/login', loginLimiter, ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/logout', ctrl.logout);
router.post('/verify-email/send', requireAuth, authLimiter, ctrl.sendVerification);
router.post('/verify-email/confirm', requireAuth, codeLimiter, ctrl.verifyEmail);
router.post('/forgot-password', authLimiter, ctrl.forgotPassword);
router.post('/reset-password', authLimiter, ctrl.resetPassword);
router.post('/2fa/setup', requireAuth, codeLimiter, ctrl.setup2FA);
router.post('/2fa/confirm', requireAuth, codeLimiter, ctrl.confirm2FA);
router.post('/2fa/disable', requireAuth, codeLimiter, ctrl.disable2FA);
router.get('/2fa/recovery-codes', requireAuth, ctrl.recoveryCodesStatus);
router.post('/2fa/recovery-codes', requireAuth, codeLimiter, ctrl.regenerateRecoveryCodesHandler);
router.post('/change-password', requireAuth, authLimiter, ctrl.changePassword);
router.post('/delete-account', requireAuth, authLimiter, ctrl.deleteAccount);
router.post('/deactivate', requireAuth, authLimiter, ctrl.deactivateAccount);
// LGPD: baixar todos os meus dados (JSON). Limitado como as rotas sensíveis.
router.get('/export-data', requireAuth, authLimiter, require('../controllers/dataExportController').exportData);
router.get('/me', requireAuth, ctrl.me);

// OAuth (ver controllers/oauthController.js e docs/oauth.md).
router.get('/oauth/providers', oauthCtrl.listProviders);
router.post('/oauth/2fa', loginLimiter, oauthCtrl.complete2FA);
router.get('/oauth/signup', oauthCtrl.signupInfo);
router.delete('/oauth/signup', oauthCtrl.cancelSignup);
router.get('/oauth/accounts', requireAuth, oauthCtrl.listAccounts);
router.delete('/oauth/accounts/:provider', requireAuth, authLimiter, oauthCtrl.unlinkAccount);
router.get('/oauth/:provider/start', oauthLimiter, oauthCtrl.start);
router.post('/oauth/:provider/link', requireAuth, oauthLimiter, oauthCtrl.link);
router.get('/oauth/:provider/callback', oauthLimiter, oauthCtrl.callback);
router.get('/sessions', requireAuth, ctrl.listSessions);
router.delete('/sessions/other', requireAuth, ctrl.revokeOtherSessions);
router.delete('/sessions/:id', requireAuth, ctrl.revokeSession);

module.exports = router;
