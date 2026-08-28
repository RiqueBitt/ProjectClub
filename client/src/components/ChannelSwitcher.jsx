import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import ChannelTypeIcon from './ChannelTypeIcon.jsx';

// Navegação entre os chats disponíveis (Geral | Mídia | Fotos | ...) —
// fica bem onde antes aparecia o dropdown com nome/descrição do canal
// (ver ChatWindow.jsx), como uma fileira de abas horizontais. Clicar
// numa aba troca o conteúdo da conversa ali mesmo, sem abrir nenhum
// menu — a lista de abas é a estrutura real de canais da comunidade
// (categorias "soltas" numa fileira só), não um menu separado.
export default function ChannelSwitcher({ currentChannelId }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);

  const all = [...channels, ...categories.flatMap((c) => c.channels || [])];
  if (!all.length) return null;

  const go = (id) => {
    if (id !== currentChannelId) navigate(`/channels/${id}`);
  };

  return (
    <div className="channel-tabs">
      {all.map((ch) => {
        const unread = isChannelUnread(ch, channelReadAt, user.id);
        const active = ch.id === currentChannelId;
        return (
          <button
            type="button"
            key={ch.id}
            className={`channel-tab ${active ? 'active' : ''} ${unread ? 'unread' : ''}`}
            onClick={() => go(ch.id)}
          >
            <ChannelTypeIcon type={ch.type} />
            <span className="truncate">{ch.name}</span>
            {ch.unreadMentions > 0 && (
              <span className="mention-badge">{ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}</span>
            )}
            {!(ch.unreadMentions > 0) && unread && <span className="unread-dot" />}
          </button>
        );
      })}
    </div>
  );
}
