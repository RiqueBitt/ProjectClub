const { generateToken, isConfigured } = require('../services/agoraToken');

// Item pedido: migração pro Agora.io. O cliente chama isso toda vez que
// vai entrar num canal de voz (ver client/src/context/VoiceContext.jsx)
// — nunca guarda um token de longa duração, sempre pede um novo e
// fresco na hora de entrar. `channelName` é obrigatório (o ID do canal
// de voz ou "dm:<conversationId>"); `req.user.id` já vem da própria
// sessão autenticada, ninguém pode pedir token em nome de outra pessoa.
async function getToken(req, res, next) {
  try {
    if (!isConfigured()) {
      return res.status(503).json({ error: 'Chamadas de voz não estão configuradas no servidor ainda (Agora.io).' });
    }
    const { channelName } = req.query;
    if (!channelName?.trim()) return res.status(400).json({ error: 'Informe o canal.' });

    // Item pedido: "Somente usuários que fazem parte daquele clan
    // poderão acessar e utilizar esses canais" — a voz do clã
    // reaproveita esse mesmo endpoint (ver VoiceContext.jsx,
    // channelName = "clan:<id>"), então a checagem de acesso pra essa
    // sala específica precisa acontecer aqui — sem isso, qualquer
    // pessoa logada poderia pedir um token pra entrar na voz de um
    // clã do qual não é membro nenhum.
    const clean = channelName.trim();
    if (clean.startsWith('clan:')) {
      const clanId = clean.slice('clan:'.length);
      if (req.user.clanId !== clanId) {
        return res.status(403).json({ error: 'Você não é membro deste clã.' });
      }
    }

    const token = generateToken(clean, req.user.id);
    res.json({ token, appId: process.env.AGORA_APP_ID, uid: req.user.id });
  } catch (err) { next(err); }
}

module.exports = { getToken };
