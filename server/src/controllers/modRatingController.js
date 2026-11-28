// Avaliações de mods (estrelas + texto curto) — ver services/modRatings.js.
const ratings = require('../services/modRatings');

function handle(err, res, next) {
  if (err instanceof ratings.RatingError) return res.status(err.status).json({ error: err.message });
  return next(err);
}

// GET /mods/mods/:modioModId/ratings — resumo (média, quantidade,
// distribuição), a avaliação da própria pessoa e as que têm texto.
async function getRatings(req, res, next) {
  try {
    const modioModId = req.params.modioModId;
    const [summary, mine, reviews] = await Promise.all([
      ratings.summaryFor(modioModId),
      ratings.myRating(req.user.id, modioModId),
      ratings.listReviews(modioModId),
    ]);
    res.json({ summary, mine, reviews });
  } catch (err) { handle(err, res, next); }
}

// PUT /mods/games/:modioGameId/mods/:modioModId/rating { stars, review? }
async function putRating(req, res, next) {
  try {
    const { modioGameId, modioModId } = req.params;
    const body = req.body || {};
    const saved = await ratings.upsertRating({
      userId: req.user.id, modioModId, modioGameId, stars: body.stars, review: body.review,
    });
    const summary = await ratings.summaryFor(modioModId);
    res.json({ mine: { id: saved.id, stars: saved.stars, review: saved.review || null, updatedAt: saved.updatedAt }, summary });
  } catch (err) { handle(err, res, next); }
}

// DELETE /mods/mods/:modioModId/rating — tira a própria avaliação.
async function deleteMyRating(req, res, next) {
  try {
    const { removed } = await ratings.removeRating({ userId: req.user.id, modioModId: req.params.modioModId });
    const summary = await ratings.summaryFor(req.params.modioModId);
    res.json({ removed, summary });
  } catch (err) { handle(err, res, next); }
}

// DELETE /mods/ratings/:ratingId — dona da avaliação ou ADMIN (moderação
// do texto, mesma regra de apagar comentário).
async function deleteRating(req, res, next) {
  try {
    res.json(await ratings.deleteRatingById({ ratingId: req.params.ratingId, actor: req.user }));
  } catch (err) { handle(err, res, next); }
}

module.exports = { getRatings, putRating, deleteMyRating, deleteRating };
