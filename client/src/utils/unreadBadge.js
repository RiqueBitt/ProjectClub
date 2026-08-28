import { useStore, isChannelUnread, isConversationUnread } from '../store/useStore';

// Item pedido: bolinha de não lidas no ícone do app (bandeja/taskbar no
// Windows, ícone do launcher no Android) — mesma conta que já alimenta
// os números pequenos ao lado dos itens da barra lateral (ver
// MainSidebar.jsx), só que aplicada no ícone do SISTEMA OPERACIONAL em
// vez de dentro da própria janela. Chamado sempre que algo que afeta
// "quantas coisas não lidas eu tenho" muda (mensagem nova, canal lido,
// pedido de amizade respondido...). `userId` vem de quem chama (o
// AuthContext, não o Zustand — a store não guarda quem está logado).
export function updateUnreadBadge(userId) {
  try {
    if (!userId) return;
    const s = useStore.getState();
    const allChannels = [...s.channels, ...s.categories.flatMap((c) => c.channels || [])];
    const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, s.channelReadAt, userId)).length;
    const unreadConversations = s.conversations.filter((c) => isConversationUnread(c, userId)).length;
    const pendingIncoming = s.friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
    const total = unreadChannels + unreadConversations + pendingIncoming;

    // Desktop (Electron) — bolinha sobreposta no ícone da barra de
    // tarefas do Windows (setOverlayIcon), configurado em main.js.
    window.electronAPI?.setUnreadCount?.(total);

    // Android (Capacitor) — número no ícone do app na tela inicial, só
    // funciona em launchers que suportam (a maioria dos atuais suporta).
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform() === 'android') {
      import('@capawesome/capacitor-badge').then(({ Badge }) => {
        if (total > 0) Badge.set({ count: total }); else Badge.clear();
      }).catch(() => { /* plugin não instalado/disponível — não é crítico */ });
    }
  } catch { /* nunca deve derrubar o app por causa disso */ }
}
