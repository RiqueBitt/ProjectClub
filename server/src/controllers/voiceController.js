// Voz — controller. A plataforma usa SÓ o servidor de mídia próprio
// (media-server/, mediasoup + coturn): /api/voice/join confere o acesso à
// sala (canal/DM/clã) e devolve as credenciais dele (provider "projectclub").
// A antiga cadeia de provedores (LiveKit/Daily/TRTC/Jitsi) foi removida.
const prisma = require('../config/prisma');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const tokens = require('../services/voiceTokens');
const credentials = require('../services/voiceCredentials');

const PROVIDER = 'projectclub';

// Regra de acesso à sala: clã (ser membro),
// DM (ser da conversa), ou canal da comunidade (VER + CONNECT). Lança um
// erro com .status pra virar a resposta HTTP certa.
async function assertRoomAccess(req, channelName) {
  const clean = String(channelName || '').trim();
  if (!clean) { const e = new Error('Informe o canal.'); e.status = 400; throw e; }
  if (clean.length > 128) { const e = new Error('Canal inválido.'); e.status = 400; throw e; }

  if (clean.startsWith('clan:')) {
    const clanId = clean.slice('clan:'.length);
    if (req.user.clanId !== clanId) { const e = new Error('Você não é membro deste clã.'); e.status = 403; throw e; }
  } else if (clean.startsWith('dm:')) {
    const conversationId = clean.slice('dm:'.length);
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.user.id } },
    }).catch(() => null);
    if (!member) { const e = new Error('Você não faz parte desta conversa.'); e.status = 403; throw e; }
  } else {
    const channel = await prisma.channel.findUnique({ where: { id: clean } });
    if (!channel) { const e = new Error('Canal de voz não encontrado.'); e.status = 404; throw e; }
    const perms = await getEffectivePermissions(req.user.id, channel.id, channel);
    if (!has(perms, 'VIEW_CHANNEL') || !has(perms, 'CONNECT')) {
      const e = new Error('Você não tem permissão para entrar neste canal.'); e.status = 403; throw e;
    }
  }
  return clean;
}

// Nome de sala determinístico e indecifrável: o mesmo canal sempre cai na
// mesma sala do servidor de mídia, mas ninguém de fora consegue adivinhar.
// TEM que ser igual ao mediaControl.mediaRoomName (teste voice-moderacao).
// JITSI_ROOM_SALT continua aceito (nome antigo) pra não mudar as salas.
function roomNameFor(channelName) {
  const secret = process.env.VOICE_ROOM_SALT || process.env.JITSI_ROOM_SALT || process.env.JWT_ACCESS_SECRET || 'projectclub';
  const h = require('crypto').createHmac('sha256', secret).update(String(channelName)).digest('hex').slice(0, 24);
  return `pc_${h}`;
}

const isServerConfigured = (env = process.env) => tokens.isConfigured(env);

// GET /api/voice/join?channelName=...
// Devolve { provider: 'projectclub', channelName, projectclub: { url, token, room, identity, iceServers } }.
// Clientes antigos podem mandar ?clientReady=... (lista de provedores que
// sabiam usar) — é ignorado: a resposta é sempre do servidor próprio.
async function getJoin(req, res, next) {
  try {
    const channelName = await assertRoomAccess(req, req.query.channelName);
    // Permissões de mídia (falar/vídeo/palco/mudo da moderação) que vão no
    // token, e limite de usuários do canal (cheio → 403 'channel-full').
    const joinPolicy = await require('../services/voiceJoinPolicy').evaluate(req.user, channelName);
    if (joinPolicy.error) return res.status(joinPolicy.error.status).json({ error: joinPolicy.error.message, code: joinPolicy.error.code });
    const userId = req.user.id;
    const name = req.user.displayName || req.user.username || String(userId);
    const creds = tokens.mintProjectClub({ room: roomNameFor(channelName), userId, name, claims: joinPolicy.claims });
    if (!creds) {
      return res.status(503).json({ error: 'O servidor de voz não está configurado. Avise a equipe.', code: 'voice-unavailable' });
    }
    return res.json({ provider: PROVIDER, channelName, reserveMode: false, activeReason: 'own', projectclub: creds });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// POST /api/voice/report  { provider?, code?, channelName? }
// Telemetria: o cliente avisa que a conexão com o servidor de voz falhou
// (ex.: sem ICE). Só registra no log (no máximo 1 aviso por pessoa a cada
// 30s) — não muda nada na voz. Mantido também por compatibilidade com
// clientes antigos que ainda chamam a rota.
const REPORT_WINDOW_MS = 30 * 1000;
const lastReport = new Map();
async function postReport(req, res) {
  const { ok, code, channelName } = req.body || {};
  if (ok === true) return res.json({ ok: true, counted: false });
  const uid = req.user?.id || '?';
  const now = Date.now();
  if (now - (lastReport.get(uid) || 0) < REPORT_WINDOW_MS) return res.json({ ok: true, counted: false });
  lastReport.set(uid, now);
  if (lastReport.size > 5000) lastReport.clear();
  const reason = String(code || 'client').replace(/[^\w:.-]/g, '').slice(0, 60) || 'client';
  const ch = String(channelName || '').replace(/[^\w:.-]/g, '').slice(0, 80);
  console.warn(`[voz] cliente ${uid} não conectou no servidor de voz (${reason})${ch ? ` canal ${ch}` : ''}`);
  return res.json({ ok: true, counted: true });
}

// ---- Painel da staff: "Servidor de voz" (só administradores) ----

function serverStatus() {
  return {
    provider: PROVIDER,
    label: 'Project Club (servidor próprio)',
    configured: isServerConfigured(),
    fields: credentials.describe(PROVIDER),
  };
}

// GET /api/voice/server — status + chaves (segredos mascarados).
async function getServer(req, res) {
  res.json(serverStatus());
}

// POST /api/voice/server/config { values: { ENV: 'valor' | '' } }
// Salva (criptografado), aplica na hora e devolve o status atualizado.
async function postServerConfig(req, res, next) {
  try {
    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'Envie os valores das chaves.' });
    await credentials.save(PROVIDER, values);
    console.log(`[voz] ${req.user?.username || req.user?.id} atualizou as chaves do servidor de voz pelo painel.`);
    res.json(serverStatus());
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

module.exports = { getJoin, postReport, getServer, postServerConfig, assertRoomAccess, roomNameFor, isServerConfigured };
