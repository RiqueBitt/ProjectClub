// Geração dos tokens/credenciais de cada provedor da cadeia de voz
// (item pedido). TUDO assinado aqui no servidor — os segredos
// (MEDIA_SERVER_SECRET, LIVEKIT_API_SECRET, TRTC_SECRET_KEY, etc) NUNCA
// vão pro cliente; só o token já pronto e de curta duração vai, na rota
// /api/voice/join, e só pra quem tem acesso àquela sala.
//
// Nenhuma dessas funções fala com o serviço externo (exceto o Daily, que
// PRECISA da REST deles pra mintar o token — e por isso fica atrás do
// gate DAILY_API_KEY). Isso mantém o join rápido e deixa as outras
// testáveis só pela ESTRUTURA do token, sem depender dos serviços ao vivo.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const zlib = require('zlib');

// Validade padrão dos tokens de mídia (24h) — de sobra pra qualquer
// chamada realista, nunca eterno.
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

// ---------------- LiveKit ----------------
// Access token do LiveKit = JWT HS256 assinado com o LIVEKIT_API_SECRET,
// com a grant `video` (roomJoin + nome da sala). É exatamente o que o
// livekit-server-sdk produz por baixo — feito à mão com jsonwebtoken pra
// não depender de instalar o SDK do servidor.
function mintLiveKit({ room, identity, name } = {}, env = process.env) {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const url = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url || !room || !identity) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: apiKey,                // identifica a chave de API
    sub: identity,              // identidade do participante (nosso userId)
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    name: name || identity,
    // Grant de vídeo: entrar na sala `room`, podendo publicar e assinar.
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const token = jwt.sign(payload, apiSecret, { algorithm: 'HS256' });
  return { url, token, room, identity };
}

// ---------------- TRTC (Tencent) ----------------
// UserSig do TRTC: esquema HMAC-SHA256 + zlib(deflate) + base64 "URL-safe"
// que a Tencent documenta (mesmo algoritmo do GenerateTestUserSig oficial).
function trtcHmacSha256({ sdkAppId, secretKey, userId, currTime, expire }) {
  const content =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expire}\n`;
  return crypto.createHmac('sha256', secretKey).update(content).digest('base64');
}

function mintTRTCUserSig({ userId, roomId } = {}, env = process.env, now = Date.now()) {
  const sdkAppId = env.TRTC_SDK_APP_ID;
  const secretKey = env.TRTC_SECRET_KEY;
  if (!sdkAppId && sdkAppId !== 0) return null;
  if (!secretKey || !userId) return null;
  const currTime = Math.floor(now / 1000);
  const expire = TOKEN_TTL_SECONDS;
  const sig = trtcHmacSha256({ sdkAppId, secretKey, userId: String(userId), currTime, expire });
  const obj = {
    'TLS.ver': '2.0',
    'TLS.identifier': String(userId),
    'TLS.sdkappid': Number(sdkAppId),
    'TLS.expire': expire,
    'TLS.time': currTime,
    'TLS.sig': sig,
  };
  const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(obj), 'utf8'));
  // base64 "URL-safe" da Tencent: + / = viram * - _
  const userSig = compressed
    .toString('base64')
    .replace(/\+/g, '*')
    .replace(/\//g, '-')
    .replace(/=/g, '_');
  return {
    sdkAppId: Number(sdkAppId),
    userSig,
    userId: String(userId),
    roomId: roomId || userId,
  };
}

// ---------------- Jitsi ----------------
// Fallback final e gratuito no meet.jit.si público — normalmente NÃO
// precisa de token. Se o dono um dia hospedar um Jitsi próprio com JWT
// (JITSI_APP_ID + JITSI_APP_SECRET), mintamos um JWT compatível; senão,
// jwt fica null e o cliente entra sem token mesmo.
function mintJitsi({ room, userId, name } = {}, env = process.env) {
  const domain = env.JITSI_DOMAIN || 'meet.jit.si';
  const appId = env.JITSI_APP_ID;
  const appSecret = env.JITSI_APP_SECRET;
  let token = null;
  if (appId && appSecret && room) {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign({
      aud: appId,
      iss: appId,
      sub: domain,
      room,
      exp: now + TOKEN_TTL_SECONDS,
      nbf: now,
      context: { user: { id: String(userId || ''), name: name || String(userId || '') } },
    }, appSecret, { algorithm: 'HS256' });
  }
  return { domain, room, jwt: token };
}

// ---------------- Daily ----------------
// O token de reunião do Daily SÓ pode ser mintado pela REST deles, que
// exige a DAILY_API_KEY (que o dono ainda não tem). Enquanto não tiver,
// `mintDaily` devolve o roomUrl sem token (gated:true) — e a cadeia nem
// chega a escolher o Daily (ver voiceProviders.isAvailable + o gate).
// Com a chave presente, mintamos de verdade via POST /v1/meeting-tokens.
async function mintDaily({ roomName, userName } = {}, env = process.env) {
  const apiKey = env.DAILY_API_KEY;
  const roomUrl = env.DAILY_ROOM_URL;
  const domain = env.DAILY_DOMAIN;
  if (!apiKey) {
    return { roomUrl, domain, token: null, gated: true };
  }
  const resolvedRoom = roomName || (roomUrl ? roomUrl.split('/').pop() : null);
  const resp = await fetch('https://api.daily.co/v1/meeting-tokens', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        room_name: resolvedRoom,
        user_name: userName || undefined,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Daily REST falhou (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return { roomUrl, domain, token: data.token, gated: false };
}

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
  TOKEN_TTL_SECONDS,
  MEDIA_TOKEN_TTL_SECONDS,
  mintProjectClub,
  mediaClaims,
  turnCredentials,
  turnUrls,
  iceServersFor,
  mintLiveKit,
  mintTRTCUserSig,
  mintJitsi,
  mintDaily,
  _trtcHmacSha256: trtcHmacSha256,
};
