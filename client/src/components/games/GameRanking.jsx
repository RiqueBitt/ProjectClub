import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/game-ranking.css';

// Ranking por jogo (server/src/services/gameRanking.js): horas jogadas entre
// quem deixou a biblioteca visível pra você (todos + amigos + você).
const hours = (s) => { const h = s / 3600; return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1).replace('.', ',')} h` : `${Math.max(1, Math.round(s / 60))} min`; };

export default function GameRanking() {
  const [games, setGames] = useState(null);
  const [open, setOpen] = useState(null);
  const [players, setPlayers] = useState(null);
  useEffect(() => { api.get('/games/ranking').then(({ data }) => setGames(data.games || [])).catch(() => setGames([])); }, []);
  useEffect(() => {
    if (!open) return;
    setPlayers(null);
    api.get(`/games/ranking/${encodeURIComponent(open)}`).then(({ data }) => setPlayers(data.players || [])).catch(() => setPlayers([]));
  }, [open]);
  if (!games || games.length === 0) return null;
  return (
    <section className="grk" aria-label="Ranking por jogo">
      <h2 className="grk-title">Ranking por jogo</h2>
      <p className="grk-sub">Horas jogadas pela galera (só quem deixou a biblioteca visível pra você).</p>
      <div className="grk-games">
        {games.map((g) => (
          <button key={g.gameKey} type="button" className={`grk-game${open === g.gameKey ? ' active' : ''}`} onClick={() => setOpen(open === g.gameKey ? null : g.gameKey)} aria-expanded={open === g.gameKey}>
            {g.iconUrl ? <img src={g.iconUrl} alt="" loading="lazy" /> : <span className="grk-noicon" aria-hidden="true">🎮</span>}
            <span className="grk-name">{g.name}</span>
            <span className="grk-meta">{hours(g.totalSeconds)} · {g.players} {g.players === 1 ? 'pessoa' : 'pessoas'}</span>
          </button>
        ))}
      </div>
      {open && (
        <ol className="grk-players">
          {players === null ? <li className="grk-sub">Carregando…</li> : players.map((p) => (
            <li key={p.user.id}>
              <span className={`grk-pos pos-${p.position}`}>{p.position}</span>
              <UserAvatar user={p.user} size={28} />
              <span className="grk-pname">{p.user.displayName || p.user.username}</span>
              <strong>{hours(p.totalSeconds)}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
