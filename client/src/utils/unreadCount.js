// Bolinha vermelha do canal: só quando a mensagem é PRA VOCÊ — alguém te
// marcou (@você, um cargo seu, @everyone/@here) ou respondeu uma mensagem
// sua. O número é quantas dessas estão esperando. Mensagem comum de outra
// pessoa não acende o vermelho (pedido do dono, nov/2026: "só aparece se a
// pessoa me responder ou me marcar"). Vale até em canal silenciado; canal
// aberto não mostra.
export function channelUnreadBadge(channel, { active = false } = {}) {
  if (!channel || active) return null;
  const mentions = Math.max(0, Number(channel.unreadMentions) || 0);
  if (mentions <= 0) return null;
  const label = mentions > 99 ? '99+' : String(mentions);
  const title = mentions === 1 ? '1 menção ou resposta pra você' : `${mentions} menções ou respostas pra você`;
  return { count: mentions, mentions, label, title, mention: true };
}

// Junta os badges de uma lista de canais (ex.: categoria recolhida).
export function sumUnread(channels = []) {
  let count = 0; let mentions = 0;
  for (const ch of channels) {
    const m = Math.max(0, Number(ch?.unreadMentions) || 0);
    mentions += m;
    count += Math.max(Number(ch?.unreadCount) || 0, m);
  }
  return { count, mentions };
}
