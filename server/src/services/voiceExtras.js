// Ajudantes puros (sem banco/rede) para os extras de chamada de voz:
//  I. Reações rápidas — validação do emoji + limite anti-spam.
//  N. Gravação com consentimento — a máquina de estados do pedido de
//     gravação (só começa depois de TODO MUNDO aceitar; qualquer recusa
//     cancela). Nada de gravação escondida/sem consentimento.
//
// A lógica fica aqui, pura e testável, e o server/src/sockets/index.js só
// chama estas funções (ver server/test/voice-extras.test.js).

// Mesmo conjunto do cliente (client/src/utils/voicePrefs.js).
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮'];

function isValidReaction(emoji) {
  return typeof emoji === 'string' && QUICK_REACTIONS.includes(emoji);
}

// ---------- Consentimento de gravação (N) ----------

// Cria o estado inicial de um pedido de gravação. `participantIds` é quem
// está na sala no momento do pedido (inclui quem pediu — que já conta como
// tendo aceitado, já que foi ele quem iniciou).
function createRecordingRequest({ requesterId, requesterName, participantIds, now = Date.now() }) {
  const ids = [...new Set((participantIds || []).map(String))];
  if (!ids.includes(String(requesterId))) ids.push(String(requesterId));
  const consents = {};
  ids.forEach((id) => { consents[id] = id === String(requesterId) ? 'accepted' : 'pending'; });
  return {
    requesterId: String(requesterId),
    requesterName: requesterName || 'Alguém',
    startedAt: now,
    consents,          // userId -> 'pending' | 'accepted' | 'declined'
    status: 'pending', // 'pending' | 'recording' | 'denied' | 'cancelled' | 'stopped'
  };
}

// Registra a resposta de uma pessoa. Devolve o estado novo (não muta o
// anterior). Respostas de quem não estava na lista são ignoradas.
function applyConsent(request, userId, accepted) {
  if (!request || request.status !== 'pending') return request;
  const id = String(userId);
  if (!(id in request.consents)) return request;
  const consents = { ...request.consents, [id]: accepted ? 'accepted' : 'declined' };
  let status = 'pending';
  if (Object.values(consents).some((v) => v === 'declined')) status = 'denied';
  else if (Object.values(consents).every((v) => v === 'accepted')) status = 'recording';
  return { ...request, consents, status };
}

// Alguém saiu da sala enquanto o pedido estava pendente: tira a pessoa da
// votação. Se os que sobraram já aceitaram todos, a gravação começa.
function dropParticipant(request, userId) {
  if (!request || request.status !== 'pending') return request;
  const id = String(userId);
  if (!(id in request.consents)) return request;
  const consents = { ...request.consents };
  delete consents[id];
  let status = 'pending';
  const values = Object.values(consents);
  if (values.length === 0) status = 'cancelled';
  else if (values.some((v) => v === 'declined')) status = 'denied';
  else if (values.every((v) => v === 'accepted')) status = 'recording';
  return { ...request, consents, status };
}

function allAccepted(request) {
  return !!request && Object.values(request.consents).every((v) => v === 'accepted') && Object.keys(request.consents).length > 0;
}

function pendingUserIds(request) {
  if (!request) return [];
  return Object.entries(request.consents).filter(([, v]) => v === 'pending').map(([id]) => id);
}

module.exports = {
  QUICK_REACTIONS,
  isValidReaction,
  createRecordingRequest,
  applyConsent,
  dropParticipant,
  allAccepted,
  pendingUserIds,
};
