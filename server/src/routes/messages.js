const express = require('express');
const ctrl = require('../controllers/messageController');
const reportCtrl = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage, uploadMessageAttachments, MESSAGE_MAX_FILES } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.listMessages);
// Busca: teto próprio por conta (cada busca pode varrer bastante coisa).
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user?.id || req.ip}`,
  store: createRateLimitStore('message-search'),
  message: { error: 'Muitas buscas seguidas. Espere alguns segundos.' },
});
router.get('/search', searchLimiter, ctrl.searchMessages);
// Tópicos ativos/arquivados de um canal (painel "Tópicos").
router.get('/threads', ctrl.listThreads);
router.get('/pinned', ctrl.listPinned);
// Favoritos, menções (Caixa de Entrada) e marcar como não lida.
const extra = require('../controllers/messageExtrasController');
router.get('/saved', extra.listSaved);
router.get('/saved/ids', extra.savedIds);
router.get('/mentions', extra.listMentions);
router.get('/replies', extra.listReplies);
// Mensagens agendadas (antes de /:id pra "scheduled" não virar id).
const scheduled = require('../controllers/scheduledController');
router.get('/scheduled', scheduled.listMine);
router.post('/scheduled', scheduled.create);
router.patch('/scheduled/:id', scheduled.update);
router.delete('/scheduled/:id', scheduled.cancel);
// precheckCreateMessage roda ANTES do multer: permissão/spam são checados
// antes de qualquer anexo ser recebido e enviado pro storage.
router.post('/', ctrl.precheckCreateMessage, uploadMessageAttachments.array('attachments', MESSAGE_MAX_FILES), ctrl.createMessage);
router.post('/report', reportCtrl.createReport);
router.post('/:id/icon', uploadImage.single('icon'), ctrl.setPostIcon);
router.get('/:id/edits', ctrl.listEdits);
router.post('/:id/forward', ctrl.forwardMessage);
router.patch('/:id', ctrl.editMessage);
router.delete('/:id', ctrl.deleteMessage);
router.post('/:id/pin', ctrl.togglePin);
router.post('/:id/react', ctrl.react);
router.post('/:id/save', extra.toggleSave);
router.post('/:id/unread', extra.markUnread);
router.get('/:id/reactions/:emoji', ctrl.listReactors);
router.post('/:id/archive', ctrl.toggleArchiveTopic);

module.exports = router;
