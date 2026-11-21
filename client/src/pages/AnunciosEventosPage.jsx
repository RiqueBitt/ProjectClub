import { lazy, Suspense } from 'react';
import HubTabs, { CENTRAL_TABS } from '../components/HubTabs.jsx';
import { useSectionBadges, sectionCount } from '../utils/sectionBadges';

const InicioPage = lazy(() => import('./InicioPage.jsx'));
const AnunciosPage = lazy(() => import('./AnunciosPage.jsx'));
const CommunityEventsPage = lazy(() => import('./CommunityEventsPage.jsx'));

// "Central" (nov/2026, pedido do dono): Início + Anúncios + Eventos numa
// área só, com abas. Antes eram o Início e o canal "Novidades" (que já
// juntava Anúncios e Eventos). Cada aba é a página que já existia, com os
// mesmos dados (StaffAnnouncement / Event + RSVP), permissões (staff
// publica, todos leem) e links (/inicio, /anuncios, /comunidade/eventos,
// /evento/<slug>, /eventos/<id>).
export default function AnunciosEventosPage({ tab = 'geral' }) {
  const badges = useSectionBadges();
  const fresh = (key) => (key === tab ? 0 : sectionCount(badges, key));
  return (
    <div className="hub-frame ae-hub central-hub">
      <HubTabs
        tabs={CENTRAL_TABS} value={tab} label="Central"
        extra={{ anuncios: { count: fresh('anuncios') }, eventos: { count: fresh('eventos') } }}
      />
      <Suspense fallback={<div className="pk-page" />}>
        {tab === 'eventos' ? <CommunityEventsPage /> : tab === 'anuncios' ? <AnunciosPage /> : <InicioPage />}
      </Suspense>
    </div>
  );
}
