const express = require('express');
const ctrl = require('../controllers/ticketsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

const router = express.Router();
router.use(requireAuth);

router.get('/mine', ctrl.listMyTickets);
router.post('/', ctrl.createTicket);
router.get('/:id', ctrl.getTicket);
router.post('/:id/messages', ctrl.addTicketMessage);

router.get('/admin/all', requirePlatformAdmin, ctrl.adminListTickets);
router.post('/:id/claim', requirePlatformAdmin, ctrl.claimTicket);
router.post('/:id/close', requirePlatformAdmin, ctrl.closeTicket);

module.exports = router;
