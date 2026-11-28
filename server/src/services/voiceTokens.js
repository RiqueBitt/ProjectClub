// Credenciais de voz do servidor de mídia PRÓPRIO (media-server/,
// mediasoup + coturn) — o único provedor de voz da plataforma. TUDO
// assinado aqui no servidor: os segredos (MEDIA_SERVER_SECRET, TURN_SECRET)
// NUNCA vão pro cliente; só o token já pronto e de curta duração vai, na rota
// /api/voice/join, e só pra quem tem acesso àquela sala.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ---- Servidor de mídia PRÓPRIO (media-server/, mediasoup + coturn) ----
//
// JWT curto (HS256 com MEDIA_SERVER_SECRET) que o servidor de mídia aceita
// na conexão wss://.../ws?token=... — carrega só quem é (sub = userId), em
// qual sala, o nome de exibição e um `jti` (id da sessão: o servidor de mídia
// usa pra diferenciar "o MESMO aparelho reconectando" de "OUTRO aparelho da
// mesma pessoa" e acabar com o ping-pong entre os dois).
// 8h: o token também é usado nas RECONEXÕES (queda de wi-fi no meio da call)
// — com 2h, quem caísse depois de 2h de chamada era recusado (4401) e saía.
// Continua valendo só pra aquela sala e aquela pessoa.
const MEDIA_TOKEN_TTL_SECONDS = 8 * 60 * 60;

// Credenciais TURN temporárias no esquema do coturn `use-auth-secret`
// (TURN REST API): usuário = "<expira>:<userId>", senha = base64(HMAC-SHA1
// (TURN_SECRET, usuário)). Nunca sai um segredo permanente pro navegador.
// URLs TURN válidas, sem repetição, na ordem: UDP → TCP → TLS (turns:). O
// navegador tenta todas; UDP primeiro é o caminho com menos latência, TCP/TLS
// (porta 443/5349) salvam quem está atrás de firewall corporativo/escolar.
function turnUrls(env = process.env) {
  const all = [env.TURN_URLS, env.TURNS_URLS].map((v) => String(v || '')).join(',')
    .split(',').map((u) => u.trim()).filter((u) => /^turns?:[^\s]+$/i.test(u));
  const rank = (u) => (/^turns:/i.test(u) ? 2 : /transport=tcp/i.test(u) ? 1 : 0);
  return [...new Set(all)].sort((a, b) => rank(a) - rank(b));
}

function turnCredentials(userId, env = process.env, now = Date.now()) {
  const secret = env.TURN_SECRET;
  const urls = turnUrls(env);
  if (!secret || !urls.length) return null;
  const ttl = Number(env.TURN_TTL_SECONDS) > 0 ? Number(env.TURN_TTL_SECONDS) : 12 * 60 * 60;
  const username = `${Math.floor(now / 1000) + ttl}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}

function iceServersFor(userId, env = process.env, now = Date.now()) {
  const servers = [];
  const stun = String(env.STUN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (stun.length) servers.push({ urls: stun });
  const turn = turnCredentials(userId, env, now);
  if (turn) servers.push(turn);
  // Sem STUN próprio configurado, usa um público só pra descobrir o IP
  // (o TURN, que retransmite mídia, é sempre o nosso).
  if (!stun.length) servers.unshift({ urls: ['stun:stun.l.google.com:19302'] });
  return servers;
}

// Claims de PERMISSÃO de mídia (ver services/voiceJoinPolicy.js): o
// servidor de mídia recusa publicar o microfone sem canSpeak, câmera/tela
// sem canVideo, e mantém o mic pausado com serverMuted. Só entram campos
// conhecidos e com o tipo certo; sem `claims`, o token sai como antes (o
// servidor de mídia trata a ausência como "tudo permitido").
function mediaClaims(claims) {
  if (!claims || typeof claims !== 'object') return {};
  const out = {};
  for (const k of ['canSpeak', 'canVideo', 'serverMuted', 'serverDeafened']) {
    if (typeof claims[k] === 'boolean') out[k] = claims[k];
  }
  if (claims.role === 'speaker' || claims.role === 'audience') out.role = claims.role;
  return out;
}

// O servidor de voz está configurado? (URL + segredo do media-server.)
function isConfigured(env = process.env) {
  return !!String(env.MEDIA_SERVER_URL || '').trim() && !!String(env.MEDIA_SERVER_SECRET || '').trim();
}

function mintProjectClub({ room, userId, name, claims } = {}, env = process.env, now = Date.now()) {
  const url = String(env.MEDIA_SERVER_URL || '').trim();
  const secret = env.MEDIA_SERVER_SECRET;
  if (!url || !secret || !room || !userId) return null;
  const nowSec = Math.floor(now / 1000);
  const token = jwt.sign({
    sub: String(userId), room: String(room), name: String(name || userId).slice(0, 64),
    ...mediaClaims(claims),
    jti: crypto.randomBytes(9).toString('base64url'),
    iat: nowSec, exp: nowSec + MEDIA_TOKEN_TTL_SECONDS,
  }, secret, { algorithm: 'HS256' });
  return { url, token, room: String(room), identity: String(userId), iceServers: iceServersFor(userId, env, now) };
}

module.exports = {
  MEDIA_TOKEN_TTL_SECONDS,
  isConfigured,
  mintProjectClub,
  mediaClaims,
  turnCredentials,
  turnUrls,
  iceServersFor,
};
