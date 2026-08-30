import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import gameIcon from '../assets/icons/activity-game.png';
import spotifyIcon from '../assets/icons/activity-spotify.png';
import appIcon from '../assets/icons/activity-app.png';

// Item pedido: "Rich Presence" (jogo/Spotify/app aberto) — mostra o que
// a pessoa está jogando (nome + logo + tempo jogando), ouvindo no
// Spotify (nome da música + artista + progresso), ou qual programa tem
// aberto (VS Code etc), igual o Discord já faz. Só aparece quando o
// app de DESKTOP dela detectou alguma coisa (ver desktop/
// activityDetector.js) — não existe nada disso na web/Android, então
// pra quem só usa por ali, esse componente simplesmente nunca aparece
// (activity vem undefined).
const ICON_BY_TYPE = { game: gameIcon, spotify: spotifyIcon, app: appIcon };
const TITLE_BY_TYPE = { game: 'Jogando', spotify: 'Ouvindo Spotify', app: 'Usando' };

function formatElapsed(startedAt) {
  const mins = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}min`;
}

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ActivityBadge({ userId }) {
  const activity = useStore((s) => s.activities[userId]);
  // Só pra forçar o "há X minutos"/progresso da música a se atualizar
  // sozinho enquanto o card fica aberto na tela, sem precisar de um
  // aviso novo do servidor a cada segundo.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!activity) return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [activity]);

  if (!activity) return null;

  if (activity.type === 'game' || activity.type === 'app') {
    return (
      <div className="activity-badge">
        <div className="activity-badge-icon">
          {activity.imageUrl ? <img src={activity.imageUrl} alt="" /> : <img src={ICON_BY_TYPE[activity.type]} alt="" className="activity-badge-icon-fallback" />}
        </div>
        <div className="activity-badge-text">
          <div className="activity-badge-title">{TITLE_BY_TYPE[activity.type]}</div>
          <div className="activity-badge-name truncate">{activity.name}</div>
          <div className="activity-badge-detail">{formatElapsed(activity.startedAt)}</div>
        </div>
      </div>
    );
  }

  // Spotify — mostra o progresso avançando sozinho entre um aviso e
  // outro do app de desktop (que só reenvia a cada ~8s), calculando a
  // partir de quando esse aviso chegou, não só mostrando o número
  // parado que veio.
  const elapsedSinceUpdate = Date.now() - (activity.startedAt || Date.now());
  const currentProgress = (activity.progressMs || 0) + elapsedSinceUpdate;
  const progressPct = activity.durationMs ? Math.min(100, (currentProgress / activity.durationMs) * 100) : 0;

  return (
    <div className="activity-badge activity-badge-spotify">
      <div className="activity-badge-icon">
        <img src={spotifyIcon} alt="" className="activity-badge-icon-fallback" />
      </div>
      <div className="activity-badge-text">
        <div className="activity-badge-title">Ouvindo Spotify</div>
        <div className="activity-badge-name truncate">{activity.name}</div>
        {activity.detail && <div className="activity-badge-detail truncate">{activity.detail}</div>}
        {activity.durationMs > 0 && (
          <>
            <div className="activity-badge-progress-bar"><div style={{ width: `${progressPct}%` }} /></div>
            <div className="activity-badge-progress-time">
              <span>{formatMs(currentProgress)}</span>
              <span>{formatMs(activity.durationMs)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
