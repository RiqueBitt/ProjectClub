import { lazy, Suspense } from 'react';
import HubTabs, { ANNOUNCE_EVENTS_TABS } from '../components/HubTabs.jsx';
import { useSectionBadges, sectionCount } from '../utils/sectionBadges';

const AnunciosPage = lazy(() => import('./AnunciosPage.jsx'));
const CommunityEventsPage = lazy(() => import('./CommunityEventsPage.jsx'));

// "Novidades" (antes "Anúncios e Eventos") — um canal só, com abas internas pra não misturar
// comunicado comum com informação de evento. Cada aba é a página que já
// existia, com os mesmos dados (StaffAnnouncement / Event + RSVP),
// permissões (staff publica, todos leem) e links (/anuncios,
// /comunidade/eventos, /evento/<slug>, /eventos/<id>).
export default function AnunciosEventosPage({ tab = 'anuncios' }) {
  const badges = useSectionBadges();
  const fresh = (key) => (key === tab ? 0 : sectionCount(badges, key));
  return (
    <div className="hub-frame ae-hub">
      <HubTabs
        tabs={ANNOUNCE_EVENTS_TABS} value={tab} label="Novidades"
        extra={{ anuncios: { count: fresh('anuncios') }, eventos: { count: fresh('eventos') } }}
      />
      <Suspense fallback={<div className="pk-page" />}>
        {tab === 'eventos' ? <CommunityEventsPage /> : <AnunciosPage />}
      </Suspense>
    </div>
  );
}
