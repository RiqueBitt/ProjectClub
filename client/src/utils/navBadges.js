// Bolinhas da navegação principal (contagens por destino): mensagens não
// lidas + pedidos de amizade em Amigos, missões prontas em Economia e o total
// no sino. Antes vivia em Normal2Sidebar.jsx (useBadges); agora os canais em
// destaque também usam (FeaturedChannels.jsx).
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useClaimableMissions } from './missionBadge';

export function useNavBadges(user) {
  const myRoleIds = useMyRoleIds(user?.id);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  const claimableMissions = useClaimableMissions(); // missões prontas pra resgatar
  if (!user) return () => 0;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)).length;
  return (to) => {
    if (to === '/economia') return claimableMissions;
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };
}
