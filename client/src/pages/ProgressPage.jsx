import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import RankPage from './RankPage.jsx';
import AchievementsPage from './AchievementsPage.jsx';
import { LEVEL_REWARDS } from '../utils/levelRewards';
import '../styles/progress-page.css';

// Item pedido: "Ranks e Conquistas ficam dentro da mesma categoria
// (Progresso)... além disso haverá uma aba extra chamada de
// recompensas" — três abas dentro de UMA categoria só na barra lateral
// (antes eram duas entradas separadas — ver MainSidebar.jsx). Ranks e
// Conquistas continuam sendo os mesmos componentes de sempre
// (RankPage.jsx/AchievementsPage.jsx), só passaram a viver dentro
// desta casca com abas em vez de terem rota própria na sidebar.
const TABS = [
  { key: 'ranks', label: '🏆 Ranks' },
  { key: 'achievements', label: '🎖️ Conquistas' },
  { key: 'rewards', label: '🎁 Recompensas' },
];

export default function ProgressPage() {
  const [tab, setTab] = useState('ranks');

  return (
    <div className="progress-page">
      <div className="progress-page-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`progress-page-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ranks' && <RankPage />}
      {tab === 'achievements' && <AchievementsPage />}
      {tab === 'rewards' && <RewardsTab />}
    </div>
  );
}

// Item pedido: "mostra todas as recompensas adquiridas ao atingir
// níveis específicos" — cada recompensa do catálogo (ver
// utils/levelRewards.js) aparece desbloqueada ou bloqueada de acordo
// com o próprio nível da pessoa, com quanto falta pra próxima.
function RewardsTab() {
  const { user } = useAuth();
  const level = user?.accountLevel || 0;
  const sorted = [...LEVEL_REWARDS].sort((a, b) => a.level - b.level);

  return (
    <div className="rewards-tab">
      <p className="dim rewards-tab-intro">Recompensas que você libera conforme sobe de nível na comunidade.</p>
      <div className="rewards-tab-list">
        {sorted.map((r) => {
          const unlocked = level >= r.level;
          return (
            <div key={r.level} className={`rewards-tab-item ${unlocked ? 'unlocked' : 'locked'}`}>
              <span className="rewards-tab-item-icon">{unlocked ? r.icon : '🔒'}</span>
              <div className="rewards-tab-item-info">
                <div className="rewards-tab-item-title">
                  {r.title}
                  <span className="rewards-tab-item-level">Nível {r.level}</span>
                </div>
                <p className="dim">{r.description}</p>
                {!unlocked && <p className="rewards-tab-item-missing">Faltam {r.level - level} {r.level - level === 1 ? 'nível' : 'níveis'}.</p>}
              </div>
              {unlocked && <span className="rewards-tab-item-check">✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
