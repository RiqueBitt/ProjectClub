// Rotas da Fase 4 — comunidade e economia. Cada bloco é uma camada fina
// sobre o serviço correspondente em services/community/ (a regra de negócio,
// validação e anti-abuso ficam lá). Tudo exige login; o que mexe em moedas
// respeita o interruptor "economia" da staff; escritas têm limite por conta.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('../config/rateLimitStore');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { requireSystemEnabled } = require('../middleware/systemToggle');
const { route, isStaff, httpError } = require('../services/community/common');

const io = (req) => req.app.get('io');
const over = (req) => ({ io: io(req) });

// Limite por CONTA (não por IP) — `name` separa os contadores no Redis.
function perUser(name, windowMs, limit, message) {
  return rateLimit({
    windowMs, limit, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore(`c4:${name}`),
    keyGenerator: (req) => `u:${req.user.id}`,
    message: { error: message || 'Muitas tentativas seguidas. Espere um pouco.' },
  });
}
const requireStaff = (req, res, next) => (isStaff(req.user) ? next() : res.status(403).json({ error: 'Só a staff pode fazer isso.' }));
const economy = requireSystemEnabled('economia');

function mount(app) {
  // ---------- Início: tudo da comunidade numa chamada só ----------
  const home = express.Router();
  home.use(requireAuth);
  home.get('/', route(async (req, res) => {
    const svc = (name) => require(`../services/community/${name}`);
    const settle = (p) => p.then((v) => v).catch(() => null);
    const economyOff = await require('../services/community/common').economyDisabled(require('../config/prisma')).catch(() => false);
    const [season, goals, birthdays, clans, raffle, potw] = await Promise.all([
      settle(svc('seasons').status(req.user.id, over(req))),
      settle(svc('communityGoals').progress(req.user.id, over(req))),
      settle(svc('birthdays').todayList(over(req))),
      settle(svc('clanWeekly').standings(require('../utils/spTime').weekBounds().key, over(req))),
      settle(svc('raffle').overview(req.user.id, over(req))),
      settle(svc('postOfWeek').latest(over(req))),
    ]);
    res.json({
      season: season?.season ? season : null,
      goals,
      birthdays: birthdays || [],
      clanTop: (clans || []).slice(0, 3),
      raffle: raffle && !economyOff ? { prize: raffle.prize, endsAt: raffle.endsAt, myTickets: raffle.myTickets, participants: raffle.participants } : null,
      postOfWeek: potw,
    });
  }));
  app.use('/api/community-home', home);

  // ---------- Indicação de amigos ----------
  const referrals = express.Router();
  referrals.use(requireAuth);
  referrals.get('/mine', route(async (req, res) => {
    res.json(await require('../services/community/referrals').myReferrals(req.user.id, over(req)));
  }));
  app.use('/api/referrals', referrals);

  // ---------- Retrospectiva mensal ----------
  const recap = express.Router();
  recap.use(requireAuth);
  recap.get('/', route(async (req, res) => { res.json(await require('../services/community/monthlyRecap').getRecap(req.user.id, null, over(req))); }));
  recap.get('/:month', route(async (req, res) => { res.json(await require('../services/community/monthlyRecap').getRecap(req.user.id, String(req.params.month), over(req))); }));
  app.use('/api/recap', recap);

  // ---------- Sorteio semanal ----------
  const raffle = express.Router();
  raffle.use(requireAuth, economy);
  raffle.get('/', route(async (req, res) => { res.json(await require('../services/community/raffle').overview(req.user.id, over(req))); }));
  raffle.post('/tickets', perUser('sorteio', 60_000, 10), route(async (req, res) => {
    res.json(await require('../services/community/raffle').buyTickets(req.user.id, req.body?.quantity, over(req)));
  }));
  app.use('/api/raffle', raffle);

  // ---------- Bora Jogar ----------
  const play = express.Router();
  play.use(requireAuth);
  const pg = () => require('../services/community/playGroups');
  play.get('/', route(async (req, res) => { res.json({ groups: await pg().list(req.user.id, over(req)), rules: { minSlots: pg().MIN_SLOTS, maxSlots: pg().MAX_SLOTS, maxAheadDays: pg().MAX_AHEAD_DAYS } }); }));
  play.post('/', perUser('bora-jogar', 10 * 60_000, 6, 'Muitos grupos criados seguidos. Espere um pouco.'), route(async (req, res) => {
    res.status(201).json({ group: await pg().create(req.user, req.body, over(req)) });
  }));
  const playWrite = perUser('bora-jogar-acoes', 60_000, 30);
  play.post('/:id/join', playWrite, route(async (req, res) => { res.json(await pg().join(req.user, req.params.id, over(req))); }));
  play.post('/:id/leave', playWrite, route(async (req, res) => { res.json(await pg().leave(req.user, req.params.id, over(req))); }));
  play.delete('/:id', playWrite, route(async (req, res) => { res.json(await pg().cancel(req.user, req.params.id, over(req))); }));
  app.use('/api/play-groups', play);

  // ---------- Cargos por interesse ----------
  const interests = express.Router();
  interests.use(requireAuth);
  const ir = () => require('../services/community/interestRoles');
  interests.get('/', route(async (req, res) => { res.json(await ir().catalog(req.user.id, over(req))); }));
  interests.put('/mine', perUser('interesses', 60_000, 20), route(async (req, res) => {
    res.json(await ir().setMine(req.user.id, req.body?.roleIds, over(req)));
  }));
  interests.patch('/admin/:roleId', route(async (req, res) => {
    res.json({ role: await ir().setFlag(req.user.id, req.params.roleId, req.body?.selfAssignable, over(req)) });
  }));
  app.use('/api/interest-roles', interests);

  // ---------- Metas coletivas ----------
  const goals = express.Router();
  goals.use(requireAuth);
  const cg = () => require('../services/community/communityGoals');
  goals.get('/', route(async (req, res) => { res.json(await cg().progress(req.user.id, over(req))); }));
  goals.get('/admin', requireStaff, route(async (req, res) => { res.json(await cg().adminList(over(req))); }));
  goals.post('/admin', requireStaff, route(async (req, res) => { res.json({ goal: await cg().adminSave(req.user.id, req.body, over(req)) }); }));
  goals.delete('/admin/:id', requireStaff, route(async (req, res) => { res.json(await cg().adminRemove(req.params.id, over(req))); }));
  app.use('/api/community-goals', goals);

  // ---------- Temporadas temáticas ----------
  const seasons = express.Router();
  seasons.use(requireAuth);
  seasons.get('/current', route(async (req, res) => { res.json(await require('../services/community/seasons').status(req.user.id, over(req))); }));
  seasons.post('/claim', perUser('temporada', 60_000, 10), route(async (req, res) => {
    res.json(await require('../services/community/seasons').claimDaily(req.user.id, over(req)));
  }));
  app.use('/api/seasons', seasons);

  // ---------- Cupons da Loja ----------
  const coupons = express.Router();
  coupons.use(requireAuth);
  const cp = () => require('../services/community/coupons');
  coupons.post('/preview', perUser('cupom', 60_000, 20, 'Muitas tentativas de cupom. Espere um minuto.'), route(async (req, res) => {
    res.json(await cp().preview(req.user.id, req.body || {}, over(req)));
  }));
  coupons.get('/admin', requirePlatformAdmin, route(async (req, res) => { res.json(await cp().adminList(over(req))); }));
  coupons.post('/admin', requirePlatformAdmin, route(async (req, res) => { res.status(201).json(await cp().adminCreate(req.user.id, req.body || {}, over(req))); }));
  coupons.patch('/admin/:id', requirePlatformAdmin, route(async (req, res) => { res.json(await cp().adminSetActive(req.params.id, req.body?.active, over(req))); }));
  app.use('/api/coupons', coupons);

  // ---------- Reputação ----------
  const rep = express.Router();
  rep.use(requireAuth);
  const rp = () => require('../services/community/reputation');
  rep.post('/thanks', perUser('agradecer', 60_000, 20), route(async (req, res) => {
    res.json(await rp().thank(req.user, { targetType: req.body?.targetType, targetId: req.body?.targetId }, over(req)));
  }));
  rep.get('/ranking', route(async (req, res) => { res.json(await rp().ranking({ period: req.query.period === 'all' ? 'all' : '30d' }, over(req))); }));
  rep.get('/user/:id', route(async (req, res) => { res.json(await rp().profile(String(req.params.id), over(req))); }));
  app.use('/api/reputation', rep);

  // ---------- Gorjetas ----------
  const tips = express.Router();
  tips.use(requireAuth, economy);
  tips.get('/status', route(async (req, res) => { res.json(await require('../services/community/tips').todayStatus(req.user.id, over(req))); }));
  tips.post('/', perUser('gorjeta', 60_000, 10, 'Muitas gorjetas seguidas. Espere um pouco.'), route(async (req, res) => {
    res.json(await require('../services/community/tips').tip(req.user, { messageId: req.body?.messageId, amount: req.body?.amount }, over(req)));
  }));
  app.use('/api/tips', tips);

  // ---------- Padrinhos + preferências de participação ----------
  const mentors = express.Router();
  mentors.use(requireAuth);
  mentors.get('/', route(async (req, res) => { res.json(await require('../services/community/mentors').overview(req.user, over(req))); }));
  mentors.patch('/prefs', perUser('preferencias', 60_000, 20), route(async (req, res) => {
    const body = req.body || {};
    if (body.mentorOptIn === undefined && body.birthdayOptIn === undefined) throw httpError(400, 'Nada para salvar.');
    res.json(await require('../services/community/mentors').setPrefs(req.user, body, over(req)));
  }));
  app.use('/api/mentors', mentors);
}

module.exports = { mount };
