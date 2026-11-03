const express = require('express');
const ctrl = require('../controllers/conversationController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listConversations);
router.post('/', ctrl.createConversation);
router.patch('/:id', ctrl.updateConversation);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.uploadIcon);
router.post('/:id/members', ctrl.addMember);
router.delete('/:id/members/me', ctrl.leaveConversation);
router.delete('/:id/members/:userId', ctrl.removeMember);
router.post('/:id/read', ctrl.markRead);
// Fixar/desafixar a conversa no topo da lista de DMs (até 10, por conta).
router.patch('/:id/pin', ctrl.setPinned);
// Mensagens temporárias (Fase 5): desligado / 24 horas / 7 dias.
const ephemeralLimiter = require('express-rate-limit')({
  windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  store: require('../config/rateLimitStore').createRateLimitStore('dm-ephemeral'),
  message: { error: 'Você mudou isso muitas vezes. Espere alguns minutos.' },
});
router.patch('/:id/ephemeral', ephemeralLimiter, ctrl.setEphemeral);
// Solicitações de mensagem / spam: aceitar, ignorar ou marcar como spam.
router.patch('/:id/inbox', require('../services/dmInbox').setInbox);

module.exports = router;
