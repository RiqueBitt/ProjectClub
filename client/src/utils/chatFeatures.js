// Helpers puros dos recursos de chat: tópicos (threads), mensagens do
// sistema (fixou uma mensagem), status personalizado e "pular pra
// mensagem antiga". Sem React/DOM — testados em test/chat-recursos.test.js.

// ---------- tópicos ----------
// Raiz de tópico de canal de texto: mensagem com título que responde a
// outra (post de fórum tem título mas não tem replyToId).
export function isThreadRoot(m) {
  return !!(m && m.channelId && m.title && m.replyToId);
}

export function threadRoomKey(threadId) {
  return `thread:${threadId}`;
}

export function isThreadArchived(m) {
  return !!(m && (m.archived || m.threadArchivedAt));
}

export function threadReplyLabel(count) {
  const n = Number(count) || 0;
  if (n === 0) return 'Nenhuma resposta';
  return n === 1 ? '1 resposta' : `${n > 999 ? '999+' : n} respostas`;
}

// message:update de outros lugares (reação, edição) não traz a prévia da
// última resposta — mantém a que já tinha enquanto ela for a mesma.
export function mergeThreadSummary(prev, next) {
  if (!prev || !next || next.threadLastReply !== undefined) return next;
  if (prev.threadLastReply && prev.threadLastReplyId && prev.threadLastReplyId === next.threadLastReplyId) {
    return { ...next, threadLastReply: prev.threadLastReply };
  }
  return next;
}

// Nome sugerido pro tópico a partir do texto da mensagem.
export function suggestThreadName(content, max = 60) {
  const clean = String(content || '')
    .replace(/<a?:(\w+):[\w-]+>/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// ---------- mensagens do sistema ----------
export function parseSystemMessage(embed) {
  if (!embed || typeof embed !== 'string' || !embed.includes('"system"')) return null;
  try {
    const data = JSON.parse(embed);
    return data && typeof data.system === 'string' ? data : null;
  } catch { return null; }
}

// ---------- status personalizado ----------
export const STATUS_DURATIONS = [
  { id: '30m', label: '30 minutos', minutes: 30 },
  { id: '1h', label: '1 hora', minutes: 60 },
  { id: '4h', label: '4 horas', minutes: 240 },
  { id: 'today', label: 'Hoje' },
  { id: 'never', label: 'Nunca' },
];

// Corpo do PATCH /users/me/custom-status pra cada opção. "Hoje" = fim do
// dia no fuso de quem escolheu (o servidor não sabe o fuso).
export function statusExpiryPayload(optionId, now = new Date()) {
  const opt = STATUS_DURATIONS.find((o) => o.id === optionId);
  if (!opt || opt.id === 'never') return { durationMinutes: null };
  if (opt.id === 'today') {
    const end = new Date(now.getTime());
    end.setHours(23, 59, 59, 999);
    return { expiresAt: end.toISOString() };
  }
  return { durationMinutes: opt.minutes };
}

// "Some em 25 min" / "Some às 23:59" / "Some amanhã às 08:00" / null.
export function describeStatusExpiry(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return null;
  const diffMin = Math.round((at.getTime() - now.getTime()) / 60000);
  if (diffMin <= 0) return null;
  if (diffMin < 60) return `Some em ${diffMin} min`;
  const hhmm = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) return `Some às ${hhmm}`;
  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return `Some amanhã às ${hhmm}`;
  return `Some em ${at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hhmm}`;
}

// ---------- pular pra mensagem antiga ----------
// A janela "around" já encosta na lista carregada? (então dá pra juntar
// sem deixar buraco no meio).
export function windowReachesLoaded(windowMessages, loaded) {
  if (!windowMessages?.length) return false;
  if (!loaded?.length) return true;
  const ids = new Set(loaded.map((m) => m.id));
  if (windowMessages.some((m) => ids.has(m.id))) return true;
  const newest = windowMessages[windowMessages.length - 1];
  return new Date(newest.createdAt) >= new Date(loaded[0].createdAt);
}
