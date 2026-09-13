const express = require('express');
const ctrl = require('../controllers/adminController');
const announcementCtrl = require('../controllers/announcementController');
const appCatalogCtrl = require('../controllers/appCatalogController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { uploadImage } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);

router.get('/stats', ctrl.getStats);
router.get('/audit-log', ctrl.listAuditLog);

router.get('/community', ctrl.getCommunitySettings);
router.patch('/community', ctrl.updateCommunitySettings);
router.post('/community/icon', uploadImage.single('icon'), ctrl.uploadCommunityIcon);
router.post('/community/banner', uploadImage.single('banner'), ctrl.uploadCommunityBanner);
router.get('/system-toggles', ctrl.getSystemToggles);
router.patch('/system-toggles', ctrl.adminUpdateSystemToggles);
router.post('/maintenance', ctrl.setMaintenanceMode);
router.post('/announcements', announcementCtrl.createAnnouncement);
router.post('/announcements/:id/banner', uploadImage.single('banner'), announcementCtrl.uploadAnnouncementBanner);
router.get('/announcements', announcementCtrl.listAnnouncements);

router.get('/users', ctrl.listUsers);
router.get('/users/:id/security-info', ctrl.getUserSecurityInfo);
router.patch('/users/:id', ctrl.updateUserAdmin);
router.post('/users/:id/ban', ctrl.banUser);
router.delete('/users/:id/ban', ctrl.unbanUser);
router.post('/users/:id/suspend', ctrl.suspendUser);
router.delete('/users/:id/suspend', ctrl.unsuspendUser);
router.patch('/users/:id/role', ctrl.setPlatformRole);
router.delete('/users/:id', ctrl.deleteUserAccount);
router.patch('/users/:id/level', ctrl.setUserLevel);
router.post('/users/:id/xp', ctrl.addUserXp);
router.post('/users/:id/currency', ctrl.addUserCurrency);
router.post('/users/:id/badges', ctrl.grantBadge);
router.delete('/users/:id/badges/:badgeId', ctrl.revokeBadge);

router.get('/badges', ctrl.listBadges);
router.post('/badges', ctrl.createBadgeType);
router.patch('/badges/:id', ctrl.updateBadgeType);
router.post('/badges/:id/icon', uploadImage.single('icon'), ctrl.uploadBadgeIcon);
router.delete('/badges/:id', ctrl.deleteBadgeType);

// Catálogo de apps/jogos (aba "Apps") — banner, ícone, descrição e
// espaço necessário, tudo editável pela staff sem precisar de deploy.
router.get('/app-catalog', appCatalogCtrl.listAdminAppCatalog);
router.post('/app-catalog', appCatalogCtrl.createAppCatalogItem);
router.patch('/app-catalog/:id', appCatalogCtrl.updateAppCatalogItem);
router.post('/app-catalog/:id/banner', uploadImage.single('banner'), appCatalogCtrl.uploadAppCatalogBanner);
router.post('/app-catalog/:id/icon', uploadImage.single('icon'), appCatalogCtrl.uploadAppCatalogIcon);
router.delete('/app-catalog/:id', appCatalogCtrl.deleteAppCatalogItem);
// Item pedido: "as screenshots... adicionadas, removidas e editadas
// pelo painel da staff, sem precisar alterar o código".
router.post('/app-catalog/:id/screenshots', uploadImage.single('screenshot'), appCatalogCtrl.addAppScreenshot);
router.patch('/app-catalog/:id/screenshots/reorder', appCatalogCtrl.reorderAppScreenshots);
router.delete('/app-catalog/screenshots/:screenshotId', appCatalogCtrl.deleteAppScreenshot);

// Automod de DM — lista de sinalizações pendentes + visualização secreta
// da conversa inteira quando a staff decide analisar um caso.
router.get('/automod-flags', ctrl.listAutomodFlags);
router.get('/automod-flags/:id/conversation', ctrl.getFlaggedConversation);
router.post('/automod-flags/:id/resolve', ctrl.resolveAutomodFlag);

// Denúncias manuais (feitas por usuário, ver controllers/reportController.js
// pra criação) — mesmo padrão de 3 rotas acima, pra "Formulário e aprovação
// manual".
router.get('/reports', ctrl.listReports);
router.get('/reports/:id/context', ctrl.getReportedContext);
router.post('/reports/:id/resolve', ctrl.resolveReport);

// Sistema de segurança "isca" (honeypot) — ver middleware/honeypot.js.
router.get('/honeypot/hits', ctrl.listHoneypotHits);
router.get('/honeypot/blocked', ctrl.listBlockedIps);
router.delete('/honeypot/blocked/:ip', ctrl.unblockIp);

// "Reload User" — ver services/presenceStore.js e adminController.js.
router.post('/reload-user-presence', ctrl.reloadUserPresence);

module.exports = router;
