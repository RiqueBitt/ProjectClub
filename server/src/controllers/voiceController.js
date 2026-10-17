// Cadeia de provedores de voz — controller (item pedido).
//
// /api/voice/join DECIDE qual provedor da cadeia está ativo (ver services/voiceDecision.js) e devolve
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
const voiceHealth = require('../services/voiceHealth');
const voiceStore = require('../services/voiceRoomStore');

// Disjuntor/saúde dos provedores (services/voiceHealth.js). O teste ativo do
// servidor de mídia próprio começa no primeiro uso (não roda em teste).
let probeStarted = false;
function health(req) {
  const t = voiceHealth.tracker();
  if (!probeStarted) {
    probeStarted = true;
    const io = req?.app?.get?.('io');
    t.startProbe({ onChange: () => { try { io?.to('community').emit('voice:provider-changed', { reason: 'health' }); } catch { /* ok */ } } });
  }
  return t;
}

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

// Nome de sala determinístico e seguro pros provedores (servidor próprio,
// LiveKit, TRTC, Daily, Jitsi). Todo mundo do mesmo canal cai na mesma sala.
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

// Decide o provedor ativo AGORA (global), lendo uso/override/desativados/saúde.
async function currentDecision(req) {
  const [usageByProvider, override, disabled, unhealthy] = await Promise.all([
    usage.getAllUsage(),
    overrideStore.getOverride(),
    overrideStore.getDisabled(),
    health(req).getUnhealthy().catch(() => []),
  ]);
  return { usageByProvider, override, disabled, unhealthy };
}

// Failover do cliente detectado pelo servidor: a mesma pessoa pede /join do
// MESMO canal de novo em poucos segundos, agora SEM o provedor que acabou de
// receber (o cliente faz isso quando o provedor não conecta — ex.: servidor
// de mídia sem ICE). Conta como falha daquele provedor, sem precisar
// de cliente novo.
const LASTJOIN_TTL = 60;
const lastJoinKey = (userId, channel) => `voice:lastjoin:${userId}:${channel}`;
async function detectClientFailover(req, userId, channelName, clientReady) {
  if (!clientReady.length) return null;
  try {
    const { redis } = require('../config/redis');
    const raw = await redis.get(lastJoinKey(userId, channelName));
    if (!raw) return null;
    const last = JSON.parse(raw);
    if (!last || !last.p || !Array.isArray(last.ready)) return null;
    if (last.ready.includes(last.p) && !clientReady.includes(last.p)) {
      await health(req).recordFailure(last.p, userId, 'client-failover');
      return last.p;
    }
  } catch { /* opcional */ }
  return null;
}
async function rememberJoin(userId, channelName, provider, clientReady) {
  try {
    const { redis } = require('../config/redis');
    await redis.set(lastJoinKey(userId, channelName), JSON.stringify({ p: provider, ready: clientReady }), 'EX', LASTJOIN_TTL);
  } catch { /* opcional */ }
}

// Avisa quem está NESTE canal pra trocar de provedor junto (o cliente refaz
// /api/voice/join ao receber e migra sem sair da sala).
function notifyRoomMigrate(req, channelName, provider) {
  try {
    const io = req.app.get('io');
    if (io) io.to(`voice:${channelName}`).emit('voice:provider-changed', { active: provider, channelId: channelName, reason: 'room' });
  } catch { /* não é fatal — o poll do cliente resolve */ }
}

// Fixação recentíssima conta como "sala ativa" (alguém entrando agora).
const STICKY_FRESH_MS = 90 * 1000;

// GET /api/voice/join?channelName=...
// Devolve { provider, <creds do provedor> }.
async function getJoin(req, res, next) {
  try {
    const channelName = await assertRoomAccess(req, req.query.channelName);
    const state = await currentDecision(req);
    // O cliente anuncia quais provedores o engine dele sabe usar hoje
    // (clientReady=projectclub,livekit,jitsi). A cadeia PULA, só pra ESTE join,
    // os que ele não suporta — sem mexer no status global do painel. Sem o
    // parâmetro (ex.: cliente antigo/teste), não restringe nada.
    let clientReady = String(req.query.clientReady || '').split(',').map((s) => s.trim()).filter(Boolean);
    // App Android 1.27.2 fechava ao entrar pelo servidor próprio (corrigido
    // na versão seguinte): pra ele, pula o servidor próprio.
    if (/ProjectClub\/1\.27\.2 /.test(String(req.headers['user-agent'] || ''))) {
      clientReady = clientReady.filter((id) => id !== 'projectclub');
    }
    // App Android nativo anuncia "jitsi", mas não tem Jitsi nativo (cairia
    // em "não suportado"): pro servidor, ele só usa o servidor próprio.
    if (/ProjectClub\/\d/.test(String(req.headers['user-agent'] || '')) && clientReady.length) {
      clientReady = clientReady.filter((id) => id !== 'jitsi');
    }
    const userId = req.user.id;
    // Failover do cliente → falha do provedor anterior (pode desarmá-lo).
    const failedJustNow = await detectClientFailover(req, userId, channelName, clientReady);
    if (failedJustNow) state.unhealthy = await health(req).getUnhealthy().catch(() => state.unhealthy);
    let disabled = state.disabled;
    if (clientReady.length) {
      const unsupported = providers.PROVIDER_ORDER.filter((id) => !clientReady.includes(id));
      disabled = Array.from(new Set([...(disabled || []), ...unsupported]));
    }
    const decided = decision.decideProvider({ ...state, disabled });
    const globalProvider = decision.decideProvider(state).provider;
    // Todo mundo da MESMA call no MESMO provedor (ver resolveRoomProvider):
    //  - sala com gente num provedor que serve pra sala E pra este aparelho → entra nele;
    //  - a fixação apontava pra um provedor que ficou ruim (desarmado pelo
    //    disjuntor, desativado, estourado) → a sala inteira migra;
    //  - este aparelho não consegue usar o da sala → só migra a sala se a
    //    escolha dele for a escolha geral da cadeia (converge, nunca oscila).
    // BUG CORRIGIDO: antes a fixação era SOBRESCRITA a cada /join — quem não
    // suportava/falhava no provedor da sala regravava outro, e o próximo a
    // entrar caía nele: gente do mesmo canal em provedores diferentes.
    const stickyInfo = await overrideStore.getRoomProviderInfo(channelName);
    const sticky = stickyInfo ? stickyInfo.provider : null;
    let active = false;
    if (sticky) {
      active = Date.now() - (stickyInfo.at || 0) < STICKY_FRESH_MS
        || (await voiceStore.roomSize(channelName).catch(() => 0)) > 0;
    }
    const resolved = decision.resolveRoomProvider({
      decided: decided.provider,
      globalProvider,
      sticky,
      active,
      stickyForRoom: !!sticky && decision.usableForRoom(sticky, state),
      stickyForMe: !!sticky && decision.usableForRoom(sticky, { ...state, disabled }),
    });
    const provider = resolved.provider;
    if (resolved.write) await overrideStore.setRoomProvider(channelName, provider);
    else overrideStore.touchRoomProvider(channelName);
    if (resolved.migrate) {
      console.log(`[voz] sala ${channelName}: migrando de ${sticky} pra ${provider}`);
      notifyRoomMigrate(req, channelName, provider);
    }
    rememberJoin(userId, channelName, provider, clientReady);
    const name = req.user.displayName || req.user.username || String(userId);
    const room = roomNameFor(channelName);

    const payload = { provider, channelName, reserveMode: providers.isReserve(provider), activeReason: provider === decided.provider ? decided.reason : 'room' };

    if (provider === 'projectclub') {
      // Servidor de mídia próprio (media-server/): JWT pra sinalização +
      // servidores ICE (STUN/TURN com credencial temporária).
      const creds = tokens.mintProjectClub({ room, userId, name });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.projectclub = creds;
    } else if (provider === 'livekit') {
      const creds = tokens.mintLiveKit({ room, identity: userId, name });
      if (!creds) return fallbackJitsi(res, payload, channelName, userId, name);
      payload.livekit = creds;
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
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
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
    // Chaves novas podem ter resolvido a falha: volta a tentar o provedor.
    await health(req).reset(id).catch(() => {});
    console.log(`[voz] ${req.user?.username || req.user?.id} atualizou as chaves do provedor ${id} pelo painel.`);
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
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
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
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
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
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
// A staff informa o uso REAL do provedor neste mês (ex.: "o LiveKit já está
// em 4500 min"). A partir daí o painel reflete isso e a cadeia troca sozinha
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
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) { next(err); }
}

// POST /api/voice/report  { provider, ok?: false, code?, channelName? }
// O cliente avisa que um provedor NÃO conectou (ex.: servidor próprio sem
// ICE, LiveKit fora do ar). Falhas de pessoas
// diferentes em poucos minutos desarmam o provedor (services/voiceHealth.js).
// Qualquer usuário autenticado; limitado a 1 falha por pessoa/provedor a
// cada ~20s, e uma pessoa sozinha nunca desarma nada.
async function postReport(req, res, next) {
  try {
    const { provider, ok, code } = req.body || {};
    if (!provider || !providers.PROVIDERS[provider]) return res.status(400).json({ error: 'Provedor inválido.' });
    if (ok === true) return res.json({ ok: true, counted: false });
    const reason = String(code || 'client').replace(/[^\w:.-]/g, '').slice(0, 60) || 'client';
    const r = await health(req).recordFailure(provider, req.user.id, reason);
    if (r.tripped) broadcastProviderChanged(req, null);
    return res.json({ ok: true, counted: !!r.counted, providerDown: !!r.down });
  } catch (err) { return next(err); }
}

// POST /api/voice/provider/:id/health/reset  (admin) — volta a tentar já.
async function postHealthReset(req, res, next) {
  try {
    const { id } = req.params;
    if (!providers.PROVIDERS[id]) return res.status(400).json({ error: 'Provedor inválido.' });
    await health(req).reset(id);
    const state = await currentDecision(req);
    const panel = decision.buildPanel({ ...state, health: await health(req).describe().catch(() => null) });
    broadcastProviderChanged(req, panel.active);
    res.json(withFields(panel));
  } catch (err) { next(err); }
}

module.exports = { postReport, postHealthReset, getJoin, getProviderStatus, postOverride, postToggle, postUsage, getConfig, postConfig, assertRoomAccess, roomNameFor };
