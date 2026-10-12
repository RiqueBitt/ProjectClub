const { generateToken, isConfigured } = require('../services/agoraToken');
const prisma = require('../config/prisma');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');

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
    if (clean.length > 128) return res.status(400).json({ error: 'Canal inválido.' });
    if (clean.startsWith('clan:')) {
      const clanId = clean.slice('clan:'.length);
      if (req.user.clanId !== clanId) {
        return res.status(403).json({ error: 'Você não é membro deste clã.' });
      }
    } else if (clean.startsWith('dm:')) {
      // SEGURANÇA: chamada de DM — só quem é da conversa. Antes qualquer
      // pessoa logada pegava token pra QUALQUER channelName e entrava na
      // chamada (áudio/vídeo) de uma DM alheia direto pelo Agora.
      const conversationId = clean.slice('dm:'.length);
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: req.user.id } },
      }).catch(() => null);
      if (!member) return res.status(403).json({ error: 'Você não faz parte desta conversa.' });
    } else {
      // Canal de voz da comunidade: mesma regra do voice:join do socket —
      // precisa VER o canal e ter CONNECT.
      const channel = await prisma.channel.findUnique({ where: { id: clean } });
      if (!channel) {
        return res.status(404).json({ error: 'Canal de voz não encontrado.' });
      }
      const perms = await getEffectivePermissions(req.user.id, channel.id, channel);
      if (!has(perms, 'VIEW_CHANNEL') || !has(perms, 'CONNECT')) {
        return res.status(403).json({ error: 'Você não tem permissão para entrar neste canal.' });
      }
    }

    const token = generateToken(clean, req.user.id);
    res.json({ token, appId: process.env.AGORA_APP_ID, uid: req.user.id });
  } catch (err) { next(err); }
}

module.exports = { getToken };
