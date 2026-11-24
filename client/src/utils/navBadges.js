import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useClaimableMissions } from './missionBadge';

// Números das bolinhas de navegação (Amigos, Economia, Notificações).
// Usado pelos canais em destaque (FeaturedChannels.jsx) e pela barra de
// baixo do celular (MobileTabBar.jsx). Antes morava no Normal2Sidebar.jsx,
// junto do menu de botões que virou canais em destaque.
export function useBadges(user) {
  const myRoleIds = useMyRoleIds(user?.id);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const claimableMissions = useClaimableMissions(); // missões prontas pra resgatar
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user?.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user?.id, myRoleIds)).length;
  return (to) => {
    if (to === '/progresso') return claimableMissions; // missões (moraram na Economia até nov/2026)
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };
}
