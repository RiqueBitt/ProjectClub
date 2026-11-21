// GET /api/users/:id/summary — cabeçalho do perfil completo numa requisição
// só: dados do perfil (mesmo corpo de GET /users/:id) + "sou fã" + traços +
// enquetes + visitantes (só no próprio perfil). Antes eram 5 requisições
// separadas a cada abertura (e a cada atualização ao vivo). As seções
// pesadas (recados, depoimentos, fotos, posts) continuam nas rotas
// próprias e o cliente só busca quando a seção aparece na tela.
const { runHandler } = require('../utils/internalCall');
const userCtrl = require('./userController');
const fanCtrl = require('./fanController');
const traitCtrl = require('./traitController');
const pollCtrl = require('./profilePollController');
const visitCtrl = require('./profileVisitController');

async function getProfileSummary(req, res, next) {
  try {
    const { id } = req.params;
    const isMe = id === req.user.id;
    const jobs = [
      runHandler(userCtrl.getUser, req, { params: { id } }),
      runHandler(fanCtrl.getStatus, req, { params: { targetId: id } }),
      runHandler(traitCtrl.getStatus, req, { params: { targetId: id } }),
      runHandler(pollCtrl.listByAuthor, req, { params: { authorId: id } }),
      isMe ? runHandler(visitCtrl.listVisitors, req, { params: { targetId: id } }) : null,
    ];
    const [profile, fan, traits, polls, visitors] = await Promise.all(jobs);
    if (profile.status !== 200) return res.status(profile.status).json(profile.body || { error: 'Erro ao carregar perfil.' });
    const ok = (r) => (r && r.status === 200 ? r.body : undefined);
    res.set('Cache-Control', 'private, no-cache');
    res.json({
      profile: profile.body,
      fan: ok(fan),
      traits: ok(traits),
      polls: ok(polls),
      visitors: ok(visitors),
    });
  } catch (err) { next(err); }
}

module.exports = { getProfileSummary };
