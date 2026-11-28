import { useStore } from '../store/useStore';
import StatusEmoji from './StatusEmoji.jsx';
import ActivityGlyph from './ActivityGlyph.jsx';

const TITLE_BY_TYPE = { game: 'Jogando', spotify: 'Ouvindo Spotify', app: 'Usando' };

// Item pedido: "não é pra mostrar assim {icon de jogo/música/app} •
// {status personalizado}" (correção) — só o ÍCONE da atividade antes
// da bolinha, sem o nome dela por extenso. Formato final: [ícone] •
// [status], com a bolinha só aparecendo quando os dois existem ao
// mesmo tempo — se não tiver status personalizado nenhum, o ícone
// aparece sozinho (sem bolinha sobrando); se não tiver atividade
// nenhuma, só o status aparece (sem ícone nem bolinha).
// hideActivity: perfis que já mostram a caixa grande da atividade
// (ActivityBadge) passam isso pra não repetir "Ouvindo X" duas vezes —
// aqui fica só o status personalizado. A lista de membros não passa
// (lá a linha curta é a única indicação).
export default function ActivityIcon({ userId, customStatusEmoji, customStatus, hideActivity = false }) {
  const liveActivity = useStore((s) => s.activities[userId]);
  const activity = hideActivity ? null : liveActivity;
  const hasStatus = !!(customStatusEmoji || customStatus);
  if (!activity && !hasStatus) return null;
  return (
    <span className="activity-inline-line">
      {activity && (
        // Item pedido: "não os ícones da mídia/jogo em si, sim o ícone
        // que a plataforma já tem pro app, jogo e música" — sempre o
        // ícone genérico da plataforma (ActivityGlyph), nunca a imagem
        // específica daquela atividade (capa do álbum, ícone do jogo
        // em si — que existe em activity.imageUrl, usada só no card
        // grande e detalhado de ActivityBadge.jsx, não aqui).
        <ActivityGlyph type={activity.type} title={`${TITLE_BY_TYPE[activity.type]} ${activity.name}`} />
      )}
      {/* Sem status personalizado, a linha ficaria só com o ícone —
          aí mostra "Jogando X" / "Ouvindo X" / "Usando X" por escrito. */}
      {activity && !hasStatus && (
        <span className="activity-inline-status activity-inline-verb">
          {TITLE_BY_TYPE[activity.type] === 'Ouvindo Spotify' ? 'Ouvindo' : TITLE_BY_TYPE[activity.type]} <b>{activity.name}</b>
        </span>
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
