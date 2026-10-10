import { useStore } from '../store/useStore';

// Menção de canal: o texto salvo é o token "<#idDoCanal>" (não muda se o
// canal for renomeado); na tela vira um chip "#nome" clicável.
export const CHANNEL_MENTION_RE = /<#([A-Za-z0-9_-]{1,64})>/;
export const CHANNEL_MENTION_RE_G = /<#([A-Za-z0-9_-]{1,64})>/g;
export const VOICE_TYPES = ['VOICE', 'STAGE'];

export function findChannelById(id) {
  const s = useStore.getState();
  return [...(s.channels || []), ...(s.categories || []).flatMap((c) => c.channels || [])].find((c) => c.id === id) || null;
}

export function channelMentionToken(channel) {
  return `<#${channel.id}>`;
}

// Abre o canal (texto) ou a tela do canal de voz (de onde se entra na call).
export function openChannelMention(id) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', `/channels/${id}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
