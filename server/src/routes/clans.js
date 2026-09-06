const express = require('express');
const clanCtrl = require('../controllers/clanController');
const iconCtrl = require('../controllers/clanIconController');
const msgCtrl = require('../controllers/clanMessageController');
const { requireAuth } = require('../middleware/auth');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth);

// Item pedido: "ícones personalizados... criados através do Painel da
// Staff" — antes das rotas com :id genérico, pra "icons" nunca ser
// interpretado como um id de clã.
router.get('/icons', iconCtrl.listClanIcons);
router.post('/icons', uploadImage.single('icon'), iconCtrl.createClanIcon);
router.delete('/icons/:id', iconCtrl.deleteClanIcon);

router.get('/', clanCtrl.listPublicClans);
router.get('/mine', clanCtrl.getMyClan);
router.post('/', clanCtrl.createClan);
router.get('/:id', clanCtrl.getClan);
router.patch('/:id', clanCtrl.updateClan);
router.post('/:id/join', clanCtrl.joinClan);
router.post('/leave', clanCtrl.leaveClan);
router.post('/:id/transfer', clanCtrl.transferOwnership);
router.patch('/:id/members/:userId/role', clanCtrl.setMemberRole);
router.delete('/:id/members/:userId', clanCtrl.kickMember);
router.patch('/:id/requests/:requestId', clanCtrl.respondJoinRequest);
router.post('/:id/tags', clanCtrl.createClanTag);
router.delete('/:id/tags/:tagId', clanCtrl.deleteClanTag);
router.patch('/me/tag', clanCtrl.setMyClanTag);

router.get('/:id/messages', msgCtrl.listClanMessages);
router.post('/:id/messages', msgCtrl.sendClanMessage);
router.delete('/:id/messages/:messageId', msgCtrl.deleteClanMessage);

module.exports = router;
