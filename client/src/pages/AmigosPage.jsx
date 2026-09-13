import { useState } from 'react';
import FriendsPanel from '../components/FriendsPanel.jsx';
import DMConversationsList from '../components/DMConversationsList.jsx';
import ClansPage from './ClansPage.jsx';

// Sistema/menu completo de Social: gerenciar amizades (FriendsPanel, já
// existente), a lista de conversas diretas (antiga DMSidebar), e agora
// também Clubes (antigo sistema de Clãs, renomeado — ver ClansPage.jsx),
// tudo num único lugar com abas internas — igual à área de Chat, mas
// para o universo social. Abrir uma conversa (aba "Mensagens") navega
// para /conversations/:id, que continua sendo a própria ChatWindow.
//
// Item pedido: "Renomear a categoria Amigos para Social... Dentro de
// Social, criar as abas: Amigos / Mensagens / Clubes."
export default function AmigosPage() {
  const [tab, setTab] = useState('amigos'); // 'amigos' | 'mensagens' | 'clubes'

  return (
    <div className="amigos-page">
      <div className="amigos-page-tabs">
        <button type="button" className={`amigos-page-tab ${tab === 'amigos' ? 'active' : ''}`} onClick={() => setTab('amigos')}>
          Amigos
        </button>
        <button type="button" className={`amigos-page-tab ${tab === 'mensagens' ? 'active' : ''}`} onClick={() => setTab('mensagens')}>
          Mensagens
        </button>
        <button type="button" className={`amigos-page-tab ${tab === 'clubes' ? 'active' : ''}`} onClick={() => setTab('clubes')}>
          Clubes
        </button>
      </div>
      <div className="amigos-page-content">
        {tab === 'amigos' && <FriendsPanel />}
        {tab === 'mensagens' && <DMConversationsList />}
        {tab === 'clubes' && <ClansPage />}
      </div>
    </div>
  );
}
