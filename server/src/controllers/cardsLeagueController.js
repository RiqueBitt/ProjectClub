// Jogo de Cartas — Draft, chefão semanal e liga de clãs (etapa 4).
const L = require('../cards/league');
const C = require('./cardsController');

const { handle } = C;
const active = async (req) => { await C.requireActivePlayer(req.user.id); return req.user.id; };

const draft = handle(async (req, res) => res.json(await L.draftView(req.user.id)));
const startDraft = handle(async (req, res) => res.json(await L.startDraft(await active(req))));
const pickDraft = handle(async (req, res) => res.json(await L.pickDraft(await active(req), req.body?.index)));
const playDraft = handle(async (req, res) => res.json(await L.playDraft(await active(req))));
const retireDraft = handle(async (req, res) => res.json(await L.retireDraft(await active(req))));

const boss = handle(async (req, res) => res.json(await L.bossView(req.user.id)));
const startBoss = handle(async (req, res) => res.json(await L.startBoss(await active(req))));
const claimBoss = handle(async (req, res) => res.json(await L.claimBoss(await active(req), req.body?.bossId)));

const league = handle(async (req, res) => res.json(await L.leagueView(req.user.id)));

module.exports = { draft, startDraft, pickDraft, playDraft, retireDraft, boss, startBoss, claimBoss, league };
