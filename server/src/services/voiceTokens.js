// Geração dos tokens/credenciais de cada provedor da cadeia de voz
// (item pedido). TUDO assinado aqui no servidor — os segredos
// (GETSTREAM_API_SECRET, MEDIA_SERVER_SECRET, etc) NUNCA
// vão pro cliente; só o token já pronto e de curta duração vai, na rota
// /api/voice/join, e só pra quem tem acesso àquela sala.
//
// Nenhuma dessas funções fala com o serviço externo (exceto o Daily, que
// PRECISA da REST deles pra mintar o token — e por isso fica atrás do
// gate DAILY_API_KEY). Isso mantém o join rápido e deixa as outras
// testáveis só pela ESTRUTURA do token, sem depender dos serviços ao vivo.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { generateToken: generateAgoraToken } = require('./agoraToken');

// Validade padrão dos tokens de mídia (24h) — de sobra pra qualquer
// chamada realista, nunca eterno.
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

// ---------------- Agora ----------------
// Reaproveita o minter que já existia (services/agoraToken.js).
function mintAgora(channelName, userId, env = process.env) {
  const token = generateAgoraToken(channelName, userId);
  if (!token) return null;
  return { token, appId: env.AGORA_APP_ID, uid: userId };
}

// ---------------- Stream (GetStream) ----------------
// User token do Stream = JWT HS256 { user_id } assinado com o
// GETSTREAM_API_SECRET. O cliente usa junto com a GETSTREAM_API_KEY
// (pública) pra se autenticar no Video SDK deles.
function mintGetStream({ userId, callId } = {}, env = process.env) {
  const apiKey = env.GETSTREAM_API_KEY;
  const apiSecret = env.GETSTREAM_API_SECRET;
  if (!apiKey || !apiSecret || !userId) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: String(userId),
    iat: now - 30, // folga pra relógio adiantado (o Stream recusa iat "no futuro")
    exp: now + TOKEN_TTL_SECONDS,
  };
  const token = jwt.sign(payload, apiSecret, { algorithm: 'HS256' });
  return { apiKey, token, userId: String(userId), callId: callId || null };
}

// ---- Servidor de mídia PRÓPRIO (media-server/, mediasoup + coturn) ----
//
// JWT curto (HS256 com MEDIA_SERVER_SECRET) que o servidor de mídia aceita
// na conexão wss://.../ws?token=... — carrega só quem é (sub = userId), em
// qual sala, e o nome de exibição. 2h: uma chamada longa não cai por token
// vencido (o token só é checado ao CONECTAR), e um token vazado vale pouco.
const MEDIA_TOKEN_TTL_SECONDS = 2 * 60 * 60;

// Credenciais TURN temporárias no esquema do coturn `use-auth-secret`
// (TURN REST API): usuário = "<expira>:<userId>", senha = base64(HMAC-SHA1
// (TURN_SECRET, usuário)). Nunca sai um segredo permanente pro navegador.
function turnCredentials(userId, env = process.env, now = Date.now()) {
  const secret = env.TURN_SECRET;
  const urls = String(env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
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

function mintProjectClub({ room, userId, name } = {}, env = process.env, now = Date.now()) {
  const url = String(env.MEDIA_SERVER_URL || '').trim();
  const secret = env.MEDIA_SERVER_SECRET;
  if (!url || !secret || !room || !userId) return null;
  const nowSec = Math.floor(now / 1000);
  const token = jwt.sign({
    sub: String(userId), room: String(room), name: String(name || userId).slice(0, 64),
    iat: nowSec, exp: nowSec + MEDIA_TOKEN_TTL_SECONDS,
  }, secret, { algorithm: 'HS256' });
  return { url, token, room: String(room), identity: String(userId), iceServers: iceServersFor(userId, env, now) };
}

module.exports = {
  TOKEN_TTL_SECONDS,
  MEDIA_TOKEN_TTL_SECONDS,
  mintProjectClub,
  turnCredentials,
  iceServersFor,
  mintAgora,
  mintGetStream,
};
