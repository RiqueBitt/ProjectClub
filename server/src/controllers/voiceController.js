// Cadeia de provedores de voz — controller (item pedido).
//
// Generaliza o antigo /api/agora/token: agora /api/voice/join DECIDE qual
// provedor da cadeia está ativo (ver services/voiceDecision.js) e devolve
// as credenciais SÓ daquele provedor, com as MESMAS checagens de acesso de
// sempre (ver canal/DM/clã). O painel da staff lê /api/voice/provider e
// controla a cadeia por /api/voice/override e /api/voice/provider/:id/toggle.
const prisma = require('../config/prisma');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const providers = require('../services/voiceProviders');
const usage = require('../services/voiceUsage');
const decision = require('../services/voiceDecision');
const overrideStore = require('../services/voiceOverrideStore');
const tokens = require('../services/voiceTokens');
const credentials = require('../services/voiceCredentials');

// Mesma regra de acesso que o agoraController usava: clã (ser membro),
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

// Nome de sala determinístico e seguro pros provedores que exigem um id de
// sala "limpo" (LiveKit/TRTC/GetStream/Daily). Todo mundo do mesmo canal
// cai na mesma sala. Mantém o channelName original pro Agora/Jitsi (que já
// aceitam o id cru, e é o que o resto do sistema sempre usou).
function roomNameFor(channelName) {
  // Sala indecifrável: no meet.jit.si público, quem souber o nome da sala
  // entra na chamada. Então derivamos o nome de um HMAC com segredo do
  // servidor — o mesmo canal sempre cai na mesma sala, mas ninguém de fora
  // consegue adivinhar. (Os provedores com token não dependem disso, mas
  // usar o mesmo id pra todos não tem custo.)
  const secret = process.env.JITSI_ROOM_SALT || process.env.JWT_ACCESS_SECRET || 'projectclub';
  const h = require('crypto').createHmac('sha256', secret).update(String(channelName)).digest('hex').slice(0, 24);
  return `pc_${h}`;
}

// Decide o provedor ativo AGORA (global), lendo uso/override/desativados.
async function currentDecision() {
  const [usageByProvider, override, disabled] = await Promise.all([
    usage.getAllUsage(),
    overrideStore.getOverride(),
    overrideStore.getDisabled(),
  ]);
  return { usageByProvider, override, disabled };
}

// GET /api/voice/join?channelName=...
// Devolve { provider, <creds do provedor> }.
async function getJoin(req, res, next) {
  try {
    const channelName = await assertRoomAccess(req, req.query.channelName);
    const state = await currentDecision();
    // O cliente anuncia quais provedores o engine dele sabe usar hoje
    // (clientReady=agora,livekit,jitsi). A cadeia PULA, só pra ESTE join,
    // os que ele não suporta — sem mexer no status global do painel. Sem o
    // parâmetro (ex.: cliente antigo/teste), não restringe nada.
    const clientReady = String(req.query.clientReady || '').split(',').map((s) => s.trim()).filter(Boolean);
    let disabled = state.disabled;
    if (clientReady.length) {
      const unsupported = providers.PROVIDER_ORDER.filter((id) => !clientReady.includes(id));
      disabled = Array.from(new Set([...(disabled || []), ...unsupported]));
    }
    const decided = decision.decideProvider({ ...state, disabled });
    const provider = decided.provider;
    const userId = req.user.id;
    const name = req.user.displayName || req.user.username || String(userId);
    const room = roomNameFor(channelName);

    const payload = { provider, channelName, reserveMode: providers.isReserve(provider), activeReason: decided.reason };

    if (provider === 'projectclub') {
      // Servidor de mídia próprio (media-server/): JWT pra sinalização +
      // servidores ICE (STUN/TURN com credencial temporária).
      const creds = tokens.mintProjectClub({ room, userId, name });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.projectclub = creds;
    } else if (provider === 'agora') {
      const creds = tokens.mintAgora(channelName, userId);
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.agora = creds;
      // Compatibilidade com o cliente antigo (campos no topo).
      payload.token = creds.token;
      payload.appId = creds.appId;
      payload.uid = creds.uid;
    } else if (provider === 'livekit') {
      const creds = tokens.mintLiveKit({ room, identity: userId, name });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.livekit = creds;
    } else if (provider === 'getstream') {
      const creds = tokens.mintGetStream({ userId, callId: room });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.getstream = creds;
    } else if (provider === 'daily') {
      try {
        const creds = await tokens.mintDaily({ roomName: null, userName: name });
        if (!creds || creds.gated || !creds.token) return fallbackJitsi(res, payload, channelName, userId, name);
        payload.daily = creds;
      } catch (err) {
        console.error('[voz] Daily mint falhou, caindo pro Jitsi:', err?.message || err);
        return fallbackJitsi(res, payload, channelName, userId, name);
      }
    } else if (provider === 'trtc') {
      const creds = tokens.mintTRTCUserSig({ userId, roomId: room });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.trtc = creds;
    } else {
      return fallbackJitsi(res, payload, channelName, userId, name);
    }

    return res.json(payload);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
}

// Monta a resposta do Jitsi (fallback final). Usado tanto quando a cadeia
// escolhe o Jitsi quanto quando o provedor escolhido falhou em mintar.
function fallbackJitsi(res, payload, channelName, userId, name) {
  const creds = tokens.mintJitsi({ room: payload.channelName ? roomNameFor(channelName) : channelName, userId, name });
  return res.json({ ...payload, provider: 'jitsi', jitsi: creds, reserveMode: true });
}

// GET /api/voice/provider — painel da staff (sem segredo nenhum).
async function getProviderStatus(req, res, next) {
  try {
    const state = await currentDecision();
    const panel = decision.buildPanel(state);
    res.json(withFields(panel));
  } catch (err) { next(err); }
}

// Quando a decisão muda por ação da equipe, avisa quem está em chamada pra
// MIGRAR de provedor sem sair da sala (re-join contínuo no cliente).
function broadcastProviderChanged(req, active) {
  try {
    const io = req.app.get('io');
    if (io) io.to('community').emit('voice:provider-changed', { active });
  } catch { /* não é fatal — a reconciliação periódica resolve */ }
}

// O painel recebe, junto, os campos de chave de cada provedor (mascarados).
function withFields(panel) {
  return { ...panel, providers: panel.providers.map((p) => ({ ...p, fields: credentials.describe(p.id) })) };
}

// GET /api/voice/provider/:id/config
async function getConfig(req, res) {
  const { id } = req.params;
  if (!providers.PROVIDERS[id]) return res.status(400).json({ error: 'Provedor inválido.' });
  res.json({ id, fields: credentials.describe(id) });
}

// POST /api/voice/provider/:id/config { values: { ENV: 'valor' | '' } }
// Salva (criptografado), aplica na hora e devolve o painel atualizado.
async function postConfig(req, res, next) {
  try {
    const { id } = req.params;
    if (!providers.PROVIDERS[id]) return res.status(400).json({ error: 'Provedor inválido.' });
    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'Envie os valores das chaves.' });
    await credentials.save(id, values);
    console.log(`[voz] ${req.user?.username || req.user?.id} atualizou as chaves do provedor ${id} pelo painel.`);
    const state = await currentDecision();
    const panel = decision.buildPanel(state);
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

// POST /api/voice/override  { provider: 'livekit' | null }  (admin)
async function postOverride(req, res, next) {
  try {
    const { provider } = req.body || {};
    if (provider && !providers.PROVIDERS[provider]) {
      return res.status(400).json({ error: 'Provedor inválido.' });
    }
    await overrideStore.setOverride(provider || null);
    const state = await currentDecision();
    const panel = decision.buildPanel(state);
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) { next(err); }
}

// POST /api/voice/provider/:id/toggle  { disabled: true|false }  (admin)
async function postToggle(req, res, next) {
  try {
    const { id } = req.params;
    if (!providers.PROVIDERS[id]) return res.status(400).json({ error: 'Provedor inválido.' });
    const disabled = !!(req.body && req.body.disabled);
    await overrideStore.setDisabled(id, disabled);
    const state = await currentDecision();
    const panel = decision.buildPanel(state);
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) {
    if (err?.message && /fallback final|inválido/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

// POST /api/voice/provider/:id/usage  { minutes }  (admin)
// A staff informa o uso REAL do provedor neste mês (ex.: "a Agora já está em
// 8500 min"). A partir daí o painel reflete isso e a cadeia troca sozinha
// quando passar do limite — antes o nosso contador começava do zero e não
// enxergava o que o provedor já tinha gastado.
async function postUsage(req, res, next) {
  try {
    const { id } = req.params;
    if (!providers.PROVIDERS[id]) return res.status(400).json({ error: 'Provedor inválido.' });
    const minutes = Number(req.body && req.body.minutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      return res.status(400).json({ error: 'Informe os minutos (número ≥ 0).' });
    }
    await usage.setCurrentUsage(id, minutes);
    const state = await currentDecision();
    const panel = decision.buildPanel(state);
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) { next(err); }
}

module.exports = { getJoin, getProviderStatus, postOverride, postToggle, postUsage, getConfig, postConfig, assertRoomAccess, roomNameFor };
