const { RtcTokenBuilder, RtcRole } = require('agora-token');

// Geração de token do Agora.io — item pedido: migração do sistema de
// voz próprio (mesh WebRTC, o "voice:signal" em sockets/index.js) pro
// Agora, um serviço de mídia GERENCIADO por eles (sem precisar hospedar
// nada próprio, diferente do LiveKit/Jitsi que exigiam servidor
// separado). O App ID pode até ficar no cliente sem problema, mas o
// App Certificate NUNCA pode — é a chave que "assina" o token, ficando
// só aqui no servidor. O cliente pede um token novo cada vez que entra
// numa chamada (ver rota /api/agora/token), nunca fala direto com o
// Agora sem ele.
//
// Token expira sozinho depois de um tempo (padrão: 24h) — suficiente
// pra qualquer chamada realista sem precisar renovar no meio, mas nunca
// eterno (mais seguro que um token que nunca vence).
const TOKEN_EXPIRE_SECONDS = 24 * 60 * 60;

function isConfigured() {
  return !!(process.env.AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE);
}

// `channelName` é sempre o ID do canal de voz (ou "dm:<conversationId>"
// pra chamadas de DM) — mesmo identificador que o sistema antigo já
// usava, só trocando de "quem entende esse nome" (nosso servidor de
// sinalização -> os servidores do Agora). `account` é o ID do usuário
// (UUID do Prisma) — o Agora aceita string aqui, não precisa inventar
// um UID numérico só pra isso.
function generateToken(channelName, userId) {
  if (!isConfigured()) return null;
  const now = Math.floor(Date.now() / 1000);
  return RtcTokenBuilder.buildTokenWithUserAccount(
    process.env.AGORA_APP_ID,
    process.env.AGORA_APP_CERTIFICATE,
    channelName,
    userId,
    RtcRole.PUBLISHER, // todo mundo pode falar E ouvir — o controle de quem PODE falar (ex: plateia de canal Palco) continua sendo regra nossa, do lado da aplicação, não do Agora
    now + TOKEN_EXPIRE_SECONDS,
    now + TOKEN_EXPIRE_SECONDS,
  );
}

module.exports = { generateToken, isConfigured };
