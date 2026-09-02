import { useEffect, useMemo, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { listAchievements } from '../api/endpoints';
import { RARITY_LABEL, RARITY_COLOR } from '../utils/achievementRarity';
import { categoryFor, CATEGORY_ORDER } from '../utils/achievementCategory';
import defaultIcon from '../assets/icons/nav-achievements.png';
import { proxyImage } from '../utils/imageProxy';

const STATUS_FILTERS = [
  { key: 'ALL', label: 'Todas' },
  { key: 'UNLOCKED', label: 'Desbloqueadas' },
  { key: 'LOCKED', label: 'Bloqueadas' },
];
const RARITY_FILTERS = ['ALL', 'COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

// Página "Conquistas" — grid com todas, indicando desbloqueadas vs
// bloqueadas (com barra de progresso pras bloqueadas). O catálogo em si
// vive no banco agora (staff edita pelo painel) — essa tela só lista o
// que a rota pública devolve, já com o progresso calculado.
//
// Item pedido: "melhore a aba deixando mais bonita e organizada,
// adicionando filtrar quais você quer ver" — filtros de status e
// raridade, agrupamento por categoria (Feeds/Perfil/Amizades/etc,
// classificação do lado do cliente, ver utils/achievementCategory.js),
// e um cabeçalho com barra de progresso geral em vez de só um texto.
export default function AchievementsPage() {
  const { socket } = useSocket() || {};
  const [achievements, setAchievements] = useState(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [rarityFilter, setRarityFilter] = useState('ALL');

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

  const filtered = useMemo(() => {
    if (!achievements) return [];
    return achievements.filter((a) => {
      if (statusFilter === 'UNLOCKED' && !a.unlocked) return false;
      if (statusFilter === 'LOCKED' && a.unlocked) return false;
      if (rarityFilter !== 'ALL' && a.rarity !== rarityFilter) return false;
      return true;
    });
  }, [achievements, statusFilter, rarityFilter]);

  const grouped = useMemo(() => {
    const byCategory = {};
    for (const a of filtered) {
      const cat = categoryFor(a.progressType);
      (byCategory[cat] ||= []).push(a);
    }
    return CATEGORY_ORDER.filter((c) => byCategory[c]?.length).map((c) => [c, byCategory[c]]);
  }, [filtered]);

  if (!achievements) return <div className="achievements-page"><p className="dim">Carregando...</p></div>;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const overallPercent = achievements.length > 0 ? Math.floor((unlockedCount / achievements.length) * 100) : 0;

  return (
    <div className="achievements-page">
      <div className="achievements-page-header">
        <h1><img className="achievements-page-title-icon" src={defaultIcon} alt="" /> Conquistas</h1>
        <div className="achievements-overall-progress">
          <div className="achievements-overall-progress-track">
            <div className="achievements-overall-progress-fill" style={{ width: `${overallPercent}%` }} />
          </div>
          <span className="dim">{unlockedCount} de {achievements.length} desbloqueadas ({overallPercent}%)</span>
        </div>
      </div>

      <div className="achievements-filters">
        <div className="achievements-filter-group">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`achievements-filter-chip ${statusFilter === f.key ? 'active' : ''}`}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="achievements-filter-group">
          {RARITY_FILTERS.map((r) => (
            <button
              key={r}
              className={`achievements-filter-chip ${rarityFilter === r ? 'active' : ''}`}
              style={r !== 'ALL' ? { '--rarity-color': RARITY_COLOR[r] } : undefined}
              onClick={() => setRarityFilter(r)}
            >
              {r === 'ALL' ? 'Todas as raridades' : RARITY_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 && <p className="dim achievements-empty-filter">Nenhuma conquista encontrada com esses filtros.</p>}

      {grouped.map(([category, items]) => (
        <div key={category} className="achievements-category-section">
          <h2 className="achievements-category-title">{category}</h2>
          <div className="achievements-grid">
            {items.map((a) => (
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
      ))}
    </div>
  );
}
