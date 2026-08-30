import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { createConversation } from '../api/endpoints';
import UserAvatar from './UserAvatar.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import TagBadge from './TagBadge.jsx';
import { STATUS_COLOR } from '../utils/status';
import { proxyImage } from '../utils/imageProxy';

// Item pedido: "menuzinho lateral" de amigos — clicar num amigo vai
// DIRETO pra conversa com ele, sem passar pelo perfil no meio.
//
// Depois de duas tentativas de recriar o estilo da lista "ONLINE" de um
// canal por conta própria (nunca ficava 100% idêntico), a versão final
// usa a classe de VERDADE (.members-list, a mesma que MembersList.jsx
// usa) como contêiner em vez de uma classe própria — garante ficar
// idêntica de verdade (mesma largura, mesmo comportamento de ajuste),
// não uma cópia aproximada que precisa ser mantida em sincronia à mão.
//
// BUG EVITADO: a resposta de /friends vem ANINHADA
// ({ id, status, user: {...} }) — o usuário de verdade mora em
// `f.user`, nunca direto em `f` (ver server/src/controllers/
// friendController.js e o mesmo padrão já usado em FriendsPanel.jsx).
export default function FriendsSideRail() {
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
                <span className="status-dot" style={{ background: STATUS_COLOR[status] || STATUS_COLOR.OFFLINE }} />
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
            </div>
          );
        })}
      </div>
    </aside>
  );
}
