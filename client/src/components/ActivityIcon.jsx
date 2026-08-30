import { useStore } from '../store/useStore';
import gameIcon from '../assets/icons/activity-game.png';
import spotifyIcon from '../assets/icons/activity-spotify.png';
import appIcon from '../assets/icons/activity-app.png';

const ICON_BY_TYPE = { game: gameIcon, spotify: spotifyIcon, app: appIcon };
const TITLE_BY_TYPE = { game: 'Jogando', spotify: 'Ouvindo Spotify', app: 'Usando' };

// Item pedido: ícone pequeno de jogo/app/Spotify NA FRENTE do status
// personalizado (emoji + texto) de qualquer pessoa — não é o card
// grande (ActivityBadge.jsx), é só um ícone rápido que se encaixa
// junto da linha de status existente, em qualquer lugar que já mostra
// status personalizado de alguém.
export default function ActivityIcon({ userId }) {
  const activity = useStore((s) => s.activities[userId]);
  if (!activity) return null;
  return (
    <img
      src={ICON_BY_TYPE[activity.type]}
      alt=""
      className="activity-inline-icon"
      title={`${TITLE_BY_TYPE[activity.type]} ${activity.name}`}
    />
  );
}
