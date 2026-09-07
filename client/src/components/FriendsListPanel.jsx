import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { createConversation } from '../api/endpoints';
import UserAvatar from './UserAvatar.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import TagBadge from './TagBadge.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import PresenceDot from './PresenceDot.jsx';
import { proxyImage } from '../utils/imageProxy';

// Item pedido: preenche a coluna da direita (terceira coluna do layout —
// mesmo espaço onde MembersList aparece num canal, e DMProfilePanel numa
// conversa) que ficava vazia/preta na página de Amigos, porque nenhuma
// rota preenchia esse slot pra "/dms" (ver MainApp.jsx). Não é um
// componente novo com tamanho próprio — usa exatamente o mesmo espaço já
// reservado no layout, só adicionando conteúdo nele, sem mudar nada do
// tamanho/posição que já existia. Clicar num amigo vai direto pra
// conversa com ele.
export default function FriendsListPanel({ onToggle }) {
  const navigate = useNavigate();
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const accepted = friends.filter((f) => f.status === 'ACCEPTED');

  const openDM = async (userId) => {
    const { conversation } = await createConversation([userId]);
    navigate(`/conversations/${conversation.id}`);
  };

  return (
    <aside className="members-list">
      <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
      <div className="member-group">
        <div className="member-group-label">Amigos — {accepted.length}</div>
        {accepted.length === 0 && <p className="dim" style={{ padding: '0 8px', fontSize: 13 }}>Você ainda não tem amigos adicionados.</p>}
        {accepted.map((f) => {
          const u = f.user;
          const status = presence[u.id]?.status || u.status || 'OFFLINE';
          return (
            <div
              key={f.id}
              className={`member-row ${u.idCardUrl ? 'has-id-card' : ''}`}
              style={u.idCardUrl ? { backgroundImage: `linear-gradient(90deg, var(--bg-secondary) 15%, transparent), url(${proxyImage(u.idCardUrl)})` } : undefined}
              onClick={() => openDM(u.id)}
              title={`Conversar com ${u.displayName}`}
            >
              <div className="avatar-wrap small">
                <UserAvatar user={u} size={32} />
                <PresenceDot status={status || 'OFFLINE'} />
              </div>
              <div className="member-row-text">
                <span className="truncate">{u.displayName}</span>
                {(u.customStatus || u.customStatusEmoji) && (
                  <span className="member-row-status truncate">
                    <StatusEmoji emoji={u.customStatusEmoji} /> {u.customStatus}
                  </span>
                )}
              </div>
              <TagBadge user={u} />
              <ClanTagBadge user={u} />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
