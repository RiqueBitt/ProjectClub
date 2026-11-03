const express = require('express');
const ctrl = require('../controllers/birthdayController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/upcoming', ctrl.upcomingAmongFriends);
// Fase 4: aniversariantes de hoje que LIGARAM a comemoração (só nome/avatar,
// nunca data nem idade — ver services/community/birthdays.js).
router.get('/today', async (req, res, next) => {
  try { res.json({ users: await require('../services/community/birthdays').todayList() }); } catch (err) { next(err); }
});

module.exports = router;
