// Backend → servidor de mídia próprio (media-server/): ordens em tempo real
// que precisam valer NA MÍDIA, não só na interface — igual ao Discord, onde
// o mudo do servidor corta o áudio no servidor de voz mesmo que o cliente
// esteja adulterado.
//
//   POST <MEDIA_SERVER_URL em http(s)>/control   header x-media-secret
//   { room, peerId, action: 'pause-audio'|'resume-allowed'|'kick'|'set-perms', perms?, reason? }
//
// Nunca lança: falha de rede/tempo esgotado vira { ok:false, error } e a
// chamada segue (as permissões também vão nas claims do próximo token, e o
// servidor de mídia guarda a ordem pra quem reconectar com token antigo).
const crypto = require('crypto');

const ACTIONS = new Set(['pause-audio', 'resume-allowed', 'kick', 'set-perms']);

// wss://midia.exemplo.com/ws → https://midia.exemplo.com/control
function controlUrl(env = process.env) {
  const raw = String(env.MEDIA_SERVER_URL || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'ws:') u.protocol = 'http:';
    else if (u.protocol === 'wss:') u.protocol = 'https:';
    u.pathname = '/control'; u.search = ''; u.hash = '';
    return u.toString();
  } catch { return null; }
}

// Nome da sala no servidor de mídia pra um canal do Project Club. TEM que
// ser igual ao voiceController.roomNameFor (o teste
// server/test/voice-moderacao.test.js confere) — duplicado aqui pra este
// serviço não depender do controller (que carrega prisma/cadeia inteira).
function mediaRoomName(channelName, env = process.env) {
  const secret = env.JITSI_ROOM_SALT || env.JWT_ACCESS_SECRET || 'projectclub';
  const h = crypto.createHmac('sha256', secret).update(String(channelName)).digest('hex').slice(0, 24);
  return `pc_${h}`;
}

async function sendControl({ room, channelId, peerId, action, perms, reason } = {}, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 3000, log = console } = {}) {
  try {
    if (!ACTIONS.has(action)) return { ok: false, error: 'ação inválida' };
    const url = controlUrl(env);
    const secret = env.MEDIA_SERVER_SECRET;
    if (!url || !secret) return { ok: false, skipped: true, error: 'servidor de mídia não configurado' };
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'fetch indisponível' };
    const roomName = room || (channelId ? mediaRoomName(channelId, env) : null);
    if (!roomName || !peerId) return { ok: false, error: 'sala/pessoa ausente' };
    const body = { room: roomName, peerId: String(peerId), action };
    if (perms && typeof perms === 'object') body.perms = perms;
    if (reason) body.reason = String(reason).slice(0, 32);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* ok */ } }, timeoutMs);
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-media-secret': secret },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      let data = null;
      try { data = await r.json(); } catch { /* corpo vazio */ }
      if (!r.ok) return { ok: false, status: r.status, error: data?.error || `HTTP ${r.status}` };
      return { ok: true, status: r.status, found: !!data?.found, data };
    } finally { clearTimeout(timer); }
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'tempo esgotado' : (err?.message || String(err));
    try { log.warn?.(`[voz] controle do servidor de mídia falhou (${action}): ${msg}`); } catch { /* ok */ }
    return { ok: false, error: msg };
  }
}

// Estado de moderação → ordem pro servidor de mídia. Ensurdecer do servidor
// também silencia (igual ao Discord: quem foi ensurdecido não fala).
function moderationOrder({ serverMuted = false, serverDeafened = false } = {}) {
  const perms = { serverMuted: !!(serverMuted || serverDeafened), serverDeafened: !!serverDeafened };
  if (perms.serverMuted) return { action: 'pause-audio', perms };
  return { action: 'resume-allowed', perms };
}

module.exports = { sendControl, controlUrl, mediaRoomName, moderationOrder, ACTIONS };
