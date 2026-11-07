// Bolinha vermelha com o número de mensagens novas de um canal (igual ao
// Discord). Menção conta junto e deixa a bolinha "destacada" (@).
// Canal silenciado só mostra número se tiver menção; canal aberto não mostra.
export function channelUnreadBadge(channel, { active = false, muted = false } = {}) {
  if (!channel || active) return null;
  const mentions = Math.max(0, Number(channel.unreadMentions) || 0);
  const count = Math.max(Number(channel.unreadCount) || 0, mentions);
  if (count <= 0) return null;
  if (muted && mentions === 0) return null;
  const label = count > 99 ? '99+' : String(count);
  const title = mentions > 0
    ? `${count} ${count === 1 ? 'mensagem nova' : 'mensagens novas'} (${mentions} ${mentions === 1 ? 'menção' : 'menções'})`
    : `${count} ${count === 1 ? 'mensagem nova' : 'mensagens novas'}`;
  return { count, mentions, label, title, mention: mentions > 0 };
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
