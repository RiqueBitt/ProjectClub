import { useStore } from '../store/useStore';
import StatusEmoji from './StatusEmoji.jsx';
import gameIcon from '../assets/icons/activity-game.png';
import spotifyIcon from '../assets/icons/activity-spotify.png';
import appIcon from '../assets/icons/activity-app.png';

const ICON_BY_TYPE = { game: gameIcon, spotify: spotifyIcon, app: appIcon };
const TITLE_BY_TYPE = { game: 'Jogando', spotify: 'Ouvindo Spotify', app: 'Usando' };

// Item pedido: "não é pra mostrar assim {icon de jogo/música/app} •
// {status personalizado}" (correção) — só o ÍCONE da atividade antes
// da bolinha, sem o nome dela por extenso. Formato final: [ícone] •
// [status], com a bolinha só aparecendo quando os dois existem ao
// mesmo tempo — se não tiver status personalizado nenhum, o ícone
// aparece sozinho (sem bolinha sobrando); se não tiver atividade
// nenhuma, só o status aparece (sem ícone nem bolinha).
export default function ActivityIcon({ userId, customStatusEmoji, customStatus }) {
  const activity = useStore((s) => s.activities[userId]);
  const hasStatus = !!(customStatusEmoji || customStatus);
  if (!activity && !hasStatus) return null;
  return (
    <span className="activity-inline-line">
      {activity && (
        // Item pedido: "não os ícones da mídia/jogo em si, sim o ícone
        // que a plataforma já tem pro app, jogo e música" — sempre o
        // ícone genérico fixo (ICON_BY_TYPE), nunca a imagem
        // específica daquela atividade (capa do álbum, ícone do jogo
        // em si — que existe em activity.imageUrl, usada só no card
        // grande e detalhado de ActivityBadge.jsx, não aqui).
        <img
          src={ICON_BY_TYPE[activity.type]}
          alt=""
          className="activity-inline-icon"
          title={`${TITLE_BY_TYPE[activity.type]} ${activity.name}`}
        />
      )}
      {activity && hasStatus && <span className="activity-inline-sep">•</span>}
      {hasStatus && (
        <span className="activity-inline-status">
          {customStatusEmoji && <StatusEmoji emoji={customStatusEmoji} />} {customStatus}
        </span>
      )}
    </span>
  );
}
