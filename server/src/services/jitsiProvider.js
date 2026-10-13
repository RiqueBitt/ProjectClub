// Emissão de "credenciais" do Jitsi para uma chamada — o provedor de
// mídia reserva (fallback) quando o Agora está perto do limite mensal.
//
// Usamos a Jitsi IFrame External API (https://<domínio>/external_api.js)
// contra um domínio CONFIGURÁVEL (padrão: meet.jit.si, público e gratuito).
// NÃO hospedamos Jitsi (a stack completa não cabe no Square Cloud) — só
// embutimos uma conferência do domínio configurado dentro do nosso app.
//
// VARIÁVEIS DE AMBIENTE (todas opcionais):
//  - JITSI_DOMAIN       domínio do Jitsi (padrão meet.jit.si).
//  - JITSI_ROOM_SALT    segredo pra embaralhar o nome da sala (ver abaixo).
//  - JITSI_APP_ID /     se preenchidos, o domínio exige JWT e nós assinamos
//    JITSI_APP_SECRET   um (fluxo autenticado). Sem eles, usamos o fluxo
//                       anônimo público (meet.jit.si funciona assim).
//
// SEGREDOS: JITSI_APP_SECRET nunca sai daqui (só assina o JWT). O nome da
// sala é um hash com salt do servidor, então o domínio público não "vaza"
// salas adivinháveis a partir do id do canal. Nunca mandamos nossos tokens
// de autenticação (sessão/JWT do app) pro Jitsi.
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { jitsiRoomName } = require('./voiceUsage');

const DEFAULT_DOMAIN = 'meet.jit.si';

function getDomain() {
  const d = (process.env.JITSI_DOMAIN || DEFAULT_DOMAIN).trim();
  // Só o host, sem esquema/barra — a External API espera só o domínio.
  return d.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// Salt do nome da sala: dedicado (JITSI_ROOM_SALT) ou, na falta dele, o
// próprio segredo de JWT do app — que já é secreto e único por instalação.
// Assim o nome da sala é sempre imprevisível, mesmo sem configurar nada.
function getRoomSalt() {
  return process.env.JITSI_ROOM_SALT || env.JWT_ACCESS_SECRET || 'projectclub-jitsi';
}

function requiresJwt() {
  return !!(process.env.JITSI_APP_ID && process.env.JITSI_APP_SECRET);
}

// Assina um JWT no formato que o Jitsi espera (quando o domínio exige
// autenticação). `moderator` controla se a pessoa entra como moderadora.
function mintJwt({ room, userId, displayName, moderator = true }) {
  const appId = process.env.JITSI_APP_ID;
  const secret = process.env.JITSI_APP_SECRET;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: appId,
    iss: appId,
    // 'sub' = domínio/tenant aceito; o domínio decide. '*' é o mais comum
    // pra deployments self-hosted simples; se o seu exigir outro, ajuste
    // via JITSI_SUB.
    sub: process.env.JITSI_SUB || '*',
    room,
    exp: now + 4 * 60 * 60, // 4h — folga de sobra pra qualquer chamada
    nbf: now - 10,
    context: {
      user: {
        id: String(userId),
        name: displayName || 'Membro',
        moderator: moderator ? 'true' : 'false',
      },
    },
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

// Monta as informações que o cliente precisa pra entrar numa sala do Jitsi
// referente a `callId` (o mesmo id de canal/DM/clã que o Agora já usa).
function roomInfo({ callId, userId, displayName }) {
  const domain = getDomain();
  const room = jitsiRoomName(callId, getRoomSalt());
  const info = { domain, room, jwt: null };
  if (requiresJwt()) {
    try {
      info.jwt = mintJwt({ room, userId, displayName });
    } catch {
      // Se a assinatura falhar por config ruim, cai pro anônimo em vez de
      // quebrar a chamada inteira.
      info.jwt = null;
    }
  }
  return info;
}

module.exports = { getDomain, getRoomSalt, requiresJwt, mintJwt, roomInfo, DEFAULT_DOMAIN };
