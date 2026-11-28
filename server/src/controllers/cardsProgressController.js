// Jogo de Cartas — passe, baú, pó (desmanchar/criar) e cosméticos.
const P = require('../cards/progress');
const C = require('./cardsController');

const { handle } = C;

const pass = handle(async (req, res) => res.json({ pass: await P.passState(req.user.id) }));
const claimPass = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  res.json({ reward: await P.claimPass(req.user.id, req.params.level), pass: await P.passState(req.user.id) });
});
const chest = handle(async (req, res) => res.json({ chest: await P.chestState(req.user.id) }));
const openChest = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  res.json({ reward: await P.openChest(req.user.id), chest: await P.chestState(req.user.id) });
});
const disenchant = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  res.json(await P.disenchant(req.user.id, req.params.cardId, req.body?.qty, req.body?.golden === true));
});
const craft = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  res.json(await P.craft(req.user.id, req.params.cardId));
});
const cosmetics = handle(async (req, res) => res.json(await P.listCosmetics(req.user.id)));
const buyCosmetic = handle(async (req, res) => {
  await C.requireActivePlayer(req.user.id);
  await P.buyCosmetic(req.user.id, req.params.id);
  res.json(await P.listCosmetics(req.user.id));
});
const equipCosmetic = handle(async (req, res) => {
  await P.equipCosmetic(req.user.id, req.body?.key);
  res.json(await P.listCosmetics(req.user.id));
});
const dustTable = handle(async (req, res) => res.json({ dust: P.DUST_VALUES, craft: P.CRAFT_COSTS }));

module.exports = { pass, claimPass, chest, openChest, disenchant, craft, cosmetics, buyCosmetic, equipCosmetic, dustTable };
