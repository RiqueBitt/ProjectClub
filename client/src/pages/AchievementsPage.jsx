import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { listAchievements } from '../api/endpoints';
import { RARITY_LABEL, RARITY_COLOR } from '../utils/achievementRarity';
import defaultIcon from '../assets/icons/nav-achievements.png';
import { proxyImage } from '../utils/imageProxy';

// Página "Conquistas" — grid com todas, indicando desbloqueadas vs
// bloqueadas (com barra de progresso pras bloqueadas). O catálogo em si
// vive no banco agora (staff edita pelo painel) — essa tela só lista o
// que a rota pública devolve, já com o progresso calculado.
export default function AchievementsPage() {
  const { socket } = useSocket() || {};
  const [achievements, setAchievements] = useState(null);

  const refresh = () => listAchievements().then((d) => setAchievements(d.achievements));
  useEffect(() => { refresh(); }, []);

  // Tempo real: quando desbloqueia uma nova (ver SocketContext.jsx que já
  // repassa isso globalmente) ou quando a staff edita o catálogo, essa
  // tela — se estiver aberta — atualiza sozinha.
  useEffect(() => {
    if (!socket) return;
    const onUnlock = () => refresh();
    const onCatalogUpdate = () => refresh();
    socket.on('achievement:unlocked', onUnlock);
    socket.on('achievement:catalog-update', onCatalogUpdate);
    return () => {
      socket.off('achievement:unlocked', onUnlock);
      socket.off('achievement:catalog-update', onCatalogUpdate);
    };
  }, [socket]);

  if (!achievements) return <div className="achievements-page"><p className="dim">Carregando...</p></div>;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="achievements-page">
      <div className="achievements-page-header">
        <h1><img className="achievements-page-title-icon" src={defaultIcon} alt="" /> Conquistas</h1>
        <p className="dim">{unlockedCount} de {achievements.length} desbloqueadas</p>
      </div>
      <div className="achievements-grid">
        {achievements.map((a) => (
          <div key={a.id} className={`achievement-card ${a.unlocked ? 'unlocked' : 'locked'}`} style={{ '--rarity-color': RARITY_COLOR[a.rarity] }}>
            <img className="achievement-card-icon" src={proxyImage(a.iconUrl) || defaultIcon} alt="" />
            <div className="achievement-card-body">
              <div className="achievement-card-top">
                <span className="achievement-card-name">{a.name}</span>
                <span className="achievement-card-rarity" style={{ color: RARITY_COLOR[a.rarity] }}>{RARITY_LABEL[a.rarity]}</span>
              </div>
              <p className="achievement-card-desc">{a.description}</p>
              {a.unlocked ? (
                <span className="achievement-card-unlocked-at dim">Desbloqueada em {new Date(a.unlockedAt).toLocaleDateString('pt-BR')}</span>
              ) : (
                <div className="achievement-card-progress-wrap">
                  <div className="achievement-card-progress-track">
                    <div className="achievement-card-progress-fill" style={{ width: `${Math.floor((a.progress / a.target) * 100)}%` }} />
                  </div>
                  <span className="dim achievement-card-progress-label">{a.progress}/{a.target}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
