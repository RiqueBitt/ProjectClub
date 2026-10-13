// Decisão de provedor de mídia (Agora ⇆ Jitsi) e emissão de credenciais
// por provedor. Ver services/voiceUsage.js e services/jitsiProvider.js.
//
//  GET /api/voice/provider  -> { provider, reason, minutesUsed, limit }
//      Só a decisão/observabilidade. Sem segredos. Usado pra:
//        - o cliente decidir por qual provedor conectar;
//        - o cliente, EM chamada, saber se precisa trocar na hora;
//        - o painel/admin ver quanto do mês já foi usado.
//
//  GET /api/voice/join?channelName=<id>  -> { provider, agora?, jitsi? }
//      Faz a MESMA checagem de acesso do /api/agora/token e, conforme o
//      provedor escolhido, devolve o token do Agora OU as infos da sala do
//      Jitsi (domínio + nome de sala com hash + jwt opcional). É o "fluxo
//      de entrada" unificado que diz ao cliente com o que conectar.
const prisma = require('../config/prisma');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const { generateToken, isConfigured } = require('../services/agoraToken');
const voiceUsage = require('../services/voiceUsage');
const jitsiProvider = require('../services/jitsiProvider');

// Mesma regra de acesso do agoraController (canal de comunidade, voz de clã
// ou chamada de DM). Devolve null se liberado, ou { status, error } se não.
async function checkChannelAccess(req, clean) {
  if (!clean || !clean.trim()) return { status: 400, error: 'Informe o canal.' };
  clean = clean.trim();
  if (clean.length > 128) return { status: 400, error: 'Canal inválido.' };

  if (clean.startsWith('clan:')) {
    const clanId = clean.slice('clan:'.length);
    if (req.user.clanId !== clanId) return { status: 403, error: 'Você não é membro deste clã.' };
  } else if (clean.startsWith('dm:')) {
    const conversationId = clean.slice('dm:'.length);
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.user.id } },
    }).catch(() => null);
    if (!member) return { status: 403, error: 'Você não faz parte desta conversa.' };
  } else {
    const channel = await prisma.channel.findUnique({ where: { id: clean } });
    if (!channel) return { status: 404, error: 'Canal de voz não encontrado.' };
    const perms = await getEffectivePermissions(req.user.id, channel.id, channel);
    if (!has(perms, 'VIEW_CHANNEL') || !has(perms, 'CONNECT')) {
      return { status: 403, error: 'Você não tem permissão para entrar neste canal.' };
    }
  }
  return null;
}

// Decisão atual (sem segredos). Nunca falha "feio": se algo der errado,
// assume Agora como padrão seguro (contanto que esteja configurado).
async function currentDecision() {
  try {
    return await voiceUsage.getDecision({ agoraConfigured: isConfigured() });
  } catch {
    return voiceUsage.decideProvider({ minutesUsed: 0, limit: voiceUsage.limitFromEnv(), agoraConfigured: isConfigured() });
  }
}

async function getProvider(req, res, next) {
  try {
    const decision = await currentDecision();
    res.json({
      provider: decision.provider,
      reason: decision.reason,
      minutesUsed: decision.minutesUsed,
      limit: decision.limit,
      threshold: decision.threshold,
    });
  } catch (err) { next(err); }
}

async function getJoin(req, res, next) {
  try {
    const { channelName } = req.query;
    const access = await checkChannelAccess(req, channelName);
    if (access) return res.status(access.status).json({ error: access.error });
    const clean = channelName.trim();

    const decision = await currentDecision();
    const base = {
      provider: decision.provider,
      reason: decision.reason,
      minutesUsed: decision.minutesUsed,
      limit: decision.limit,
    };

    if (decision.provider === 'agora') {
      // Agora precisa estar configurado pra essa via existir.
      if (!isConfigured()) {
        // Sem Agora E sem forçar Jitsi explicitamente: a decisão já teria
        // vindo 'jitsi' (agoraConfigured=false), então aqui é raro — mas
        // por garantia, cai pro Jitsi em vez de 503.
        const jitsi = jitsiProvider.roomInfo({ callId: clean, userId: req.user.id, displayName: req.user.displayName });
        return res.json({ ...base, provider: 'jitsi', reason: 'agora-nao-configurado', jitsi });
      }
      const token = generateToken(clean, req.user.id);
      return res.json({ ...base, agora: { token, appId: process.env.AGORA_APP_ID, uid: req.user.id } });
    }

    // Jitsi (reserva): nome de sala com hash + jwt opcional. Nunca expõe
    // o App Secret; o jwt só vem quando o domínio exige (envs presentes).
    const jitsi = jitsiProvider.roomInfo({ callId: clean, userId: req.user.id, displayName: req.user.displayName });
    return res.json({ ...base, jitsi });
  } catch (err) { next(err); }
}

module.exports = { getProvider, getJoin, checkChannelAccess };
