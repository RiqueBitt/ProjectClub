const express = require('express');
const ctrl = require('../controllers/appCatalogController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Item pedido: "melhore também essa aba de apps... tudo sendo
// configurado do painel da staff" — qualquer pessoa logada vê o
// catálogo (não precisa ser staff pra isso, só pra EDITAR — ver
// routes/admin.js), então só requireAuth aqui, sem requirePlatformAdmin.
router.get('/', requireAuth, ctrl.listPublicAppCatalog);

module.exports = router;
