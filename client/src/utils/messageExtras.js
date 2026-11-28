// Extras de mensagens (trazidos do Discord): reações recentes, favoritos,
// marcar como não lida, copiar link e ignorar usuários.
import { create } from 'zustand';
import { api } from '../api/client';
import { useStore } from '../store/useStore';
import { roomPath } from './prettyLinks';

// ---------- Reações recentes ----------
const RECENT_KEY = 'pc-recent-reactions';
const DEFAULT_REACTIONS = ['👍', '❤️', '😂', '🎉'];
let recentCache = null;
let topCache = {};
function readRecent() {
  if (recentCache) return recentCache;
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '{}'); recentCache = v && typeof v === 'object' ? v : {}; } catch { recentCache = {}; }
  return recentCache;
}
export function recordReaction(emoji) {
  if (!emoji) return;
  const m = readRecent();
  m[emoji] = { n: (m[emoji]?.n || 0) + 1, at: Date.now() };
  // Mantém só os 30 mais usados.
  const top = Object.entries(m).sort((a, b) => b[1].n - a[1].n).slice(0, 30);
  recentCache = Object.fromEntries(top);
  topCache = {};
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentCache)); } catch { /* sem storage */ }
}
// Os mais usados, com peso pro uso recente; completa com os padrão.
export function topReactions(n = 4) {
  if (topCache[n]) return topCache[n];
  const m = readRecent();
  const now = Date.now();
  const ranked = Object.entries(m)
    .map(([e, v]) => [e, v.n + Math.max(0, 5 - (now - v.at) / 86400000)])
    .sort((a, b) => b[1] - a[1]).map(([e]) => e);
  const list = [...new Set([...ranked, ...DEFAULT_REACTIONS])].slice(0, n);
  topCache[n] = list;
  return list;
}

// ---------- Favoritos e ignorados (estado compartilhado) ----------
export const useMsgExtras = create((set, get) => ({
  saved: new Set(),
  ignored: new Set(),
  revealed: new Set(), // mensagens de ignorados que a pessoa pediu pra ver
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    const [s, i] = await Promise.all([
      api.get('/messages/saved/ids').then((r) => r.data.ids || []).catch(() => []),
      api.get('/users/me/ignored').then((r) => r.data.ids || []).catch(() => []),
    ]);
    set({ saved: new Set(s), ignored: new Set(i) });
  },
  reveal: (id) => set((st) => ({ revealed: new Set([...st.revealed, id]) })),
}));

export async function toggleSaved(message) {
  const st = useMsgExtras.getState();
  const on = !st.saved.has(message.id);
  const next = new Set(st.saved); if (on) next.add(message.id); else next.delete(message.id);
  useMsgExtras.setState({ saved: next });
  try {
    await api.post(`/messages/${message.id}/save`, { on });
    useStore.getState().pushNotice(on ? 'Mensagem salva pra depois. Veja na Caixa de Entrada (topo) → Salvos.' : 'Mensagem removida dos salvos.');
  } catch (e) {
    const back = new Set(useMsgExtras.getState().saved); if (on) back.delete(message.id); else back.add(message.id);
    useMsgExtras.setState({ saved: back });
    useStore.getState().pushNotice(e?.response?.data?.error || 'Não foi possível favoritar.');
  }
}

export async function toggleIgnore(user) {
  const st = useMsgExtras.getState();
  const on = !st.ignored.has(user.id);
  const next = new Set(st.ignored); if (on) next.add(user.id); else next.delete(user.id);
  useMsgExtras.setState({ ignored: next });
  try {
    await api.post(`/users/${user.id}/ignore`, { on });
    useStore.getState().pushNotice(on
      ? `${user.displayName || 'Essa pessoa'} foi ignorada: as mensagens dela ficam escondidas pra você (ela não fica sabendo).`
      : `Você não ignora mais ${user.displayName || 'essa pessoa'}.`);
  } catch {
    useMsgExtras.setState({ ignored: st.ignored });
    useStore.getState().pushNotice('Não foi possível mudar isso agora.');
  }
}

export async function markUnreadFrom(message) {
  try {
    const { data } = await api.post(`/messages/${message.id}/unread`);
    const s = useStore.getState();
    if (data.channelId) {
      useStore.setState({ channelReadAt: { ...s.channelReadAt, [data.channelId]: data.lastReadAt } });
    } else if (data.conversationId) {
      s.setConversations(s.conversations.map((c) => (c.id === data.conversationId ? { ...c, lastReadAt: data.lastReadAt } : c)));
    }
    s.pushNotice('Marcado como não lido a partir desta mensagem.');
  } catch (e) {
    useStore.getState().pushNotice(e?.response?.data?.error || 'Não foi possível marcar como não lida.');
  }
}

export function messageLink(message) {
  const base = window.location.origin.startsWith('http') ? window.location.origin : 'https://projectclub.shardweb.app';
  const room = roomPath(message);
  return `${base}${room}?m=${encodeURIComponent(message.id)}`;
}
export async function copyMessageLink(message) {
  try {
    await navigator.clipboard.writeText(messageLink(message));
    useStore.getState().pushNotice('Link da mensagem copiado.');
  } catch { useStore.getState().pushNotice('Não deu pra copiar o link.'); }
}
