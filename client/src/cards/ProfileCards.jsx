import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardView, Icon, UI } from './CardView.jsx';
import { cardsUserSummary } from './api';
import '../styles/cards.css';

// Vitrine da Guerra das Cartas no perfil: estatísticas, cartas mais raras e
// atalhos para desafiar ou propor uma troca.
export default function ProfileCards({ userId, isMe, onNavigate }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); cardsUserSummary(userId).then(setData).catch(() => setData({ error: true })); }, [userId]);
  if (!data) return <p className="tcg-dim">Carregando…</p>;
  if (data.error) return <p className="tcg-dim">Não foi possível carregar.</p>;
  const p = data.player;
  const go = (url) => { onNavigate?.(); navigate(url); };
  return (
    <div>
      <div className="tcg-showcase-stats">
        <span><b>{data.distinct}</b>/{data.total} cartas</span>
        {p && <span><b>{p.wins + p.pvpWins}</b> vitórias</span>}
        {p && (p.pvpWins + p.pvpLosses) > 0 && <span>Rating <b>{p.rating}</b></span>}
        {p?.bestStreak > 1 && <span>Melhor sequência <b>{p.bestStreak}</b></span>}
      </div>
      {data.showcase.length > 0 ? (
        <div className="tcg-showcase">{data.showcase.map((c) => <CardView key={c.id} card={c} size="sm" />)}</div>
      ) : <p className="tcg-dim">{isMe ? 'Você ainda não tem cartas — pegue o pacote inicial grátis na Guerra das Cartas.' : 'Ainda não começou a coleção.'}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {isMe ? (
          <button type="button" className="tcg-btn" onClick={() => go('/cartas')}><Icon d={UI.deck} />Abrir o jogo</button>
        ) : (
          <>
            <button type="button" className="tcg-btn primary" onClick={() => go(`/cartas?desafiar=${userId}`)}><Icon d={UI.sword} />Desafiar</button>
            <button type="button" className="tcg-btn" onClick={() => go(`/cartas?aba=trocas&trocar=${userId}`)}><Icon d={UI.swap} />Propor troca</button>
          </>
        )}
      </div>
    </div>
  );
}
