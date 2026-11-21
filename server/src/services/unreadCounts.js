// Contador de mensagens não lidas por canal (bolinha vermelha com número,
// igual ao Discord). Tudo numa consulta agrupada só (nunca uma por canal),
// usando o índice (channelId, createdAt) da Message: conta as mensagens de
// OUTRAS pessoas depois da última leitura de cada canal. Canal nunca aberto
// conta a partir de `floor` (conta criada / limite de dias), e o número
// mostrado para em 99+ no cliente.
// @prisma/client só é carregado quando precisa (os testes rodam sem o
// cliente gerado e passam um `Prisma` falso).
const prismaSql = () => require('@prisma/client').Prisma; // eslint-disable-line global-require

const UNREAD_LOOKBACK_DAYS = 14;

function unreadFloor(userCreatedAt, now = Date.now()) {
  return new Date(Math.max(now - UNREAD_LOOKBACK_DAYS * 86400000, new Date(userCreatedAt || 0).getTime()));
}

async function countUnreadByChannel(prisma, { userId, channelIds, floor }, Prisma = prismaSql()) {
  if (!channelIds?.length) return [];
  return prisma.$queryRaw`
    SELECT m.channelId AS channelId, COUNT(*) AS cnt
    FROM Message m
    LEFT JOIN ChannelReadState r ON r.channelId = m.channelId AND r.userId = ${userId}
    WHERE m.channelId IN (${Prisma.join(channelIds)})
      AND m.deleted = false
      AND m.threadId IS NULL
      AND m.authorId <> ${userId}
      AND m.createdAt > ${floor}
      AND (r.lastReadAt IS NULL OR m.createdAt > r.lastReadAt)
    GROUP BY m.channelId`;
}

// Junta tudo no formato que o cliente recebe:
// { [channelId]: { lastMessageAt, myReadAt, unreadMentions, lastMentionAt, unreadCount } }
function mergeChannelStates({ visible = [], reads = [], lasts = [], mentionRows = [], unreadRows = [] }) {
  const states = {};
  visible.forEach((id) => { states[id] = { lastMessageAt: null, myReadAt: null, unreadMentions: 0, lastMentionAt: null, unreadCount: 0 }; });
  reads.forEach((r) => { if (states[r.channelId]) states[r.channelId].myReadAt = r.lastReadAt; });
  lasts.forEach((l) => { if (l.channelId && states[l.channelId]) states[l.channelId].lastMessageAt = l._max?.createdAt ?? null; });
  mentionRows.forEach((r) => {
    if (!states[r.channelId]) return;
    states[r.channelId].unreadMentions = Number(r.cnt) || 0;
    states[r.channelId].lastMentionAt = r.lastAt;
  });
  unreadRows.forEach((r) => {
    if (!states[r.channelId]) return;
    // Menção também é mensagem não lida: o total nunca fica menor que elas.
    states[r.channelId].unreadCount = Math.max(Number(r.cnt) || 0, states[r.channelId].unreadMentions);
  });
  return states;
}

// Aviso leve de "mensagem nova" pra sala da comunidade (só canal sem
// restrição de permissão — canal privado nunca vaza). Sem conteúdo: o
// cliente só soma +1 no contador do canal.
function activityPayload(message, channelId) {
  return { channelId, messageId: message.id, authorId: message.authorId, createdAt: message.createdAt };
}

module.exports = { UNREAD_LOOKBACK_DAYS, unreadFloor, countUnreadByChannel, mergeChannelStates, activityPayload };
