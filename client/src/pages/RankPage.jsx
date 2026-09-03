import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { getRank, listLeaderboard } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import levelStarIcon from '../assets/icons/level-star.png';

// REPAGINADO: página de Ranks toda refeita — antes era um cartão simples
// + uma tabela HTML crua reaproveitando .admin-table. Agora tem um
// cartão "herói" com o próprio nível em destaque (avatar grande, barra
// de progresso com brilho) e um ranking em cartões (não mais tabela),
// com medalha nos 3 primeiros e a própria linha destacada. Nenhuma
// chamada de API mudou — só a apresentação.
//
// Item pedido depois: "melhore o menu de ranks deixando mais bonito e
// melhorando o código ao todo" — título temático por faixa de nível
// (Novato/Veterano/Lenda/etc, ver titleForLevel em levelsCatalog.js —
// antes o "nome do nível" era sempre literalmente "Lv.X", redundante
// com o número já mostrado no distintivo ao lado). Quem não está no
// top 50 agora se vê no fim da lista mesmo assim (ver outsideTop50,
// separado visualmente do resto).
const MEDAL = ['🥇', '🥈', '🥉'];

export default function RankPage() {
  const { user } = useAuth();
  const [rank, setRank] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    getRank().then(setRank).catch(() => {});
    listLeaderboard().then((d) => setLeaderboard(d.leaderboard)).catch(() => {});
  }, []);

  if (!rank) return <div className="rank-page"><p className="dim">Carregando...</p></div>;

  return (
    <div className="rank-page">
      <div className="rank-page-header">
        <img className="ui-icon" src={levelStarIcon} alt="" />
        <h1>Nível &amp; Rank</h1>
      </div>

      <div className="rank-hero-card">
        <div className="rank-hero-avatar-wrap">
          <UserAvatar user={user} size={72} />
          <span className="rank-hero-level-badge">Nv. {user.accountLevel ?? rank.level}</span>
        </div>
        <div className="rank-hero-info">
          <div className="rank-hero-name">{user.displayName}</div>
          <div className="rank-hero-level-name">
            <span className="rank-hero-title-chip">{rank.levelTitle}</span>
            <span className="dim">{rank.levelName}</span>
          </div>
          <div className="rank-hero-stats">
            <span className="rank-hero-stat">🏆 Posição <strong>#{rank.position}</strong></span>
            <span className="rank-hero-stat">✨ <strong>{rank.xp.toLocaleString('pt-BR')}</strong> XP</span>
          </div>
          {!rank.isMaxLevel ? (
            <>
              <div className="rank-progress-bar rank-hero-progress-bar">
                <div className="rank-progress-fill" style={{ width: `${rank.progress}%` }} />
              </div>
              <p className="dim rank-hero-progress-label">
                {rank.xpInLevel.toLocaleString('pt-BR')} / {rank.xpNeeded.toLocaleString('pt-BR')} XP para o Nível {rank.nextLevel}
              </p>
            </>
          ) : (
            <p className="rank-hero-maxed">Nível máximo alcançado! 🎉</p>
          )}
        </div>
      </div>

      <div className="rank-leaderboard-section">
        <h4>Ranking da comunidade</h4>
        <div className="rank-leaderboard-list">
          {leaderboard.map((u, i) => (
            <Fragment key={u.id}>
              {u.outsideTop50 && <div className="rank-leaderboard-separator dim">⋯</div>}
              <div className={`rank-leaderboard-row ${u.id === user.id ? 'me' : ''} ${i < 3 && !u.outsideTop50 ? `top-${i + 1}` : ''}`}>
                <span className="rank-leaderboard-position">{u.outsideTop50 ? `#${rank.position}` : (MEDAL[i] || `#${i + 1}`)}</span>
                <UserAvatar user={u} size={36} />
                <span className="rank-leaderboard-name truncate">{u.displayName}</span>
                <span className="rank-leaderboard-level">Nv. {u.accountLevel}</span>
                <span className="rank-leaderboard-xp">{u.accountXp.toLocaleString('pt-BR')} XP</span>
              </div>
            </Fragment>
          ))}
          {leaderboard.length === 0 && <p className="dim" style={{ padding: 16, textAlign: 'center' }}>Ninguém no ranking ainda.</p>}
        </div>
      </div>
    </div>
  );
}
