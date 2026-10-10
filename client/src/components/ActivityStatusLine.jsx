import { useStore } from '../store/useStore';
import { activityArtUrl, ACTIVITY_VERB } from '../utils/activityArt';
import '../styles/socialx.css';

// Linha curta "Jogando X" / "Ouvindo X" / "Usando X" (com a arte do
// jogo/capa) logo abaixo do nome no mini perfil. O cartão detalhado
// (ActivityBadge) continua mais embaixo, com tempo e progresso.
const PATHS = {
  game: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.2 2l1.3-1.5h7l1.3 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6Z',
  spotify: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  app: 'M3 5h18v12H3zM8 21h8M12 17v4',
};

export default function ActivityStatusLine({ userId }) {
  const activity = useStore((s) => s.activities[userId]);
  if (!activity?.name) return null;
  const art = activityArtUrl(activity);
  const wide = activity.type === 'game' && art?.startsWith('/api/proxy/steam/');
  return (
    <div className={`sx-status-line sx-status-${activity.type}`} title={`${ACTIVITY_VERB[activity.type] || 'Jogando'} ${activity.name}`}>
      {art ? (
        <img className={`sx-status-art${wide ? ' is-wide' : ''}`} src={art} alt="" />
      ) : (
        <span className="sx-status-glyph" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[activity.type] || PATHS.game} /></svg>
        </span>
      )}
      <span className="sx-status-text">
        {ACTIVITY_VERB[activity.type] || 'Jogando'} <b>{activity.name}</b>
        {activity.type === 'spotify' && activity.detail && <span className="sx-status-detail"> · {activity.detail}</span>}
      </span>
    </div>
  );
}
