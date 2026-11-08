import { useStore } from '../store/useStore';
import { setConversationPinned } from '../api/endpoints';

// "Fixar conversa" — até MAX_PINNED_DMS conversas no topo da lista de DMs.
// O estado mora no servidor (ConversationMember.pinnedAt), então vale em
// todo aparelho da conta; aqui só tem a ordenação e a ação otimista.
export const MAX_PINNED_DMS = 10;

const lastAt = (c) => new Date(c.lastMessage?.createdAt || c.updatedAt || 0).getTime();

// Fixadas primeiro (na ordem em que foram fixadas), depois o resto pela
// mensagem mais recente.
export function compareConversations(a, b) {
  const pa = a.pinnedAt ? new Date(a.pinnedAt).getTime() : null;
  const pb = b.pinnedAt ? new Date(b.pinnedAt).getTime() : null;
  if (pa !== null && pb !== null) return pa - pb;
  if (pa !== null) return -1;
  if (pb !== null) return 1;
  return lastAt(b) - lastAt(a);
}

export const sortConversations = (list) => [...list].sort(compareConversations);

export const countPinned = (list) => list.reduce((n, c) => n + (c.pinnedAt ? 1 : 0), 0);

function patchPinned(conversationId, pinnedAt) {
  const st = useStore.getState();
  st.setConversations(st.conversations.map((c) => (c.id === conversationId ? { ...c, pinnedAt } : c)));
}

// Liga/desliga o fixar com atualização otimista; desfaz se o servidor recusar.
export async function toggleConversationPin(conversation) {
  const st = useStore.getState();
  const pin = !conversation.pinnedAt;
  if (pin && countPinned(st.conversations) >= MAX_PINNED_DMS) {
    st.pushNotice(`Você pode fixar no máximo ${MAX_PINNED_DMS} conversas. Desafixe uma para fixar outra.`);
    return;
  }
  const before = conversation.pinnedAt || null;
  patchPinned(conversation.id, pin ? new Date().toISOString() : null);
  try {
    const { pinnedAt } = await setConversationPinned(conversation.id, pin);
    patchPinned(conversation.id, pinnedAt || null);
  } catch (err) {
    patchPinned(conversation.id, before);
    st.pushNotice(err?.response?.data?.error || 'Não foi possível fixar a conversa.');
  }
}

// Itens do menu de contexto (clique direito) de uma conversa na lista.
export function conversationMenuItems(conversation, extra = []) {
  return [
    { label: conversation.pinnedAt ? 'Desafixar conversa' : 'Fixar conversa', icon: 'pin', onClick: () => toggleConversationPin(conversation) },
    ...extra,
  ];
}

// Socket 'conversation:pin' (mesma conta fixou/desafixou em outro aparelho).
export function applyRemotePin({ conversationId, pinnedAt }) {
  if (!conversationId) return;
  if (!useStore.getState().conversations.some((c) => c.id === conversationId)) return;
  patchPinned(conversationId, pinnedAt || null);
}
