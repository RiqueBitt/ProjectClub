import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { createConversation } from '../api/endpoints';
import UserAvatar from './UserAvatar.jsx';
import { STATUS_COLOR } from '../utils/status';

// Item pedido: "menuzinho lateral" com os amigos — clicar num amigo vai
// DIRETO pra conversa com ele, sem precisar abrir o perfil e depois
// clicar em "Enviar mensagem" no meio do caminho. Mora do lado da lista
// de Amigos/Mensagens (ver AmigosPage.jsx), sempre visível, não é mais
// uma aba que precisa trocar pra ver.
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
    <aside className="friends-side-rail">
      <div className="friends-side-rail-title">Amigos — {accepted.length}</div>
      {accepted.length === 0 && <div className="dim friends-side-rail-empty">Você ainda não tem amigos adicionados.</div>}
      <div className="friends-side-rail-list">
        {accepted.map((f) => {
          const status = presence[f.id]?.status || f.status || 'OFFLINE';
          return (
            <button key={f.id} type="button" className="friends-side-rail-item" onClick={() => openDM(f.id)} title={`Conversar com ${f.displayName}`}>
              <div className="avatar small friends-side-rail-avatar">
                <UserAvatar user={f} size={32} />
                <span className="status-dot" style={{ background: STATUS_COLOR[status] || STATUS_COLOR.OFFLINE }} />
              </div>
              <span className="truncate">{f.displayName}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
