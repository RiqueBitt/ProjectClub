import { lazy, Suspense } from 'react';

const InicioPage = lazy(() => import('./InicioPage.jsx'));
const CommunityEventsPage = lazy(() => import('./CommunityEventsPage.jsx'));

// "Central" (nov/2026, pedido do dono): página única, sem abas. As
// Novidades (anúncios da staff, com banner e texto) aparecem direto na
// Visão geral e os eventos num calendário na coluna da direita
// (InicioPage.jsx). A página de Eventos continua existindo só pra abrir
// um evento (/evento/<titulo>) e pra staff criar/editar eventos
// (/comunidade/eventos) — ela não é mais uma aba.
export default function AnunciosEventosPage({ tab = 'geral' }) {
  return (
    <div className="hub-frame central-hub">
      <Suspense fallback={<div className="pk-page" />}>
        {tab === 'eventos' ? <CommunityEventsPage /> : <InicioPage />}
      </Suspense>
    </div>
  );
}
