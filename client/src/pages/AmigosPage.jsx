import { useState } from 'react';
import FriendsPanel from '../components/FriendsPanel.jsx';
import DMConversationsList from '../components/DMConversationsList.jsx';
import FriendsSideRail from '../components/FriendsSideRail.jsx';

// Sistema/menu completo de amigos: gerenciar amizades (FriendsPanel, já
// existente) e a lista de conversas diretas (antiga DMSidebar) num único
// lugar, com abas internas — igual à área de Chat, mas para o universo
// de amigos/DMs. Abrir uma conversa (aba "Mensagens") navega para
// /conversations/:id, que continua sendo a própria ChatWindow.
// Item pedido: o "menuzinho lateral" (FriendsSideRail) fica sempre
// visível do lado, independente da aba escolhida — clicar num amigo ali
// vai direto pra conversa, sem precisar passar pelo perfil no meio.
export default function AmigosPage() {
  const [tab, setTab] = useState('amigos'); // 'amigos' | 'mensagens'

  return (
    <div className="amigos-page amigos-page-with-rail">
      <div className="amigos-page-main">
        <div className="amigos-page-tabs">
          <button type="button" className={`amigos-page-tab ${tab === 'amigos' ? 'active' : ''}`} onClick={() => setTab('amigos')}>
            Amigos
          </button>
          <button type="button" className={`amigos-page-tab ${tab === 'mensagens' ? 'active' : ''}`} onClick={() => setTab('mensagens')}>
            Mensagens
          </button>
        </div>
        <div className="amigos-page-content">
          {tab === 'amigos' ? <FriendsPanel /> : <DMConversationsList />}
        </div>
      </div>
      <FriendsSideRail />
    </div>
  );
}
