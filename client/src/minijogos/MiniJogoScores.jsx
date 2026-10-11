import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import UserAvatar from '../components/UserAvatar.jsx';

// Recordes dos Mini-Jogos: escuta o placar que o jogo manda (postMessage da
// mesma origem), salva no Project Club e mostra o ranking.
export function useMinijogoScores(slug) {
  const [board, setBoard] = useState(null);
  const [toast, setToast] = useState(null);
  const startRef = useRef(Date.now());

  const load = useCallback(() => {
    api.get(`/minigames/${slug}/leaderboard`).then((r) => setBoard(r.data)).catch(() => {});
  }, [slug]);

  useEffect(() => {
    load();
    startRef.current = Date.now();
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'pc-minigame-score') return;
      const score = Math.floor(Number(d.score));
      if (!Number.isFinite(score) || score <= 0) return;
      api.post(`/minigames/${slug}/score`, { score }).then((r) => {
        const res = r.data || {};
        setToast(res.isRecord
          ? { title: 'Novo recorde!', text: `${score.toLocaleString('pt-BR')} pontos${res.rank ? ` · ${res.rank}º lugar` : ''}` }
          : { title: 'Partida salva', text: `${score.toLocaleString('pt-BR')} pontos · recorde ${Number(res.best || 0).toLocaleString('pt-BR')}` });
        setTimeout(() => setToast(null), 4500);
        load();
      }).catch(() => {});
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      const seconds = Math.round((Date.now() - startRef.current) / 1000);
      if (seconds >= 5) api.post(`/minigames/${slug}/play`, { seconds }).catch(() => {});
    };
  }, [slug, load]);

  return { board, toast };
}

export function ScoresPanel({ board, onClose }) {
  const list = board?.top || [];
  const mine = board?.me || null;
  return (
    <div className="mj-scores" role="dialog" aria-label="Recordes">
      <div className="mj-scores-head">
        <strong>Recordes</strong>
        <button type="button" className="mj-player-btn" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      {mine?.best > 0 && (
        <div className="mj-scores-mine">Seu recorde: <b>{mine.best.toLocaleString('pt-BR')}</b>{mine.rank ? ` · ${mine.rank}º` : ''}{mine.plays ? ` · ${mine.plays} partidas` : ''}</div>
      )}
      {board && board.hasScores === false ? (
        <p className="mj-scores-empty">Este jogo não envia pontuação — contamos só as partidas.</p>
      ) : list.length === 0 ? (
        <p className="mj-scores-empty">Ninguém marcou pontos ainda. Seja o primeiro!</p>
      ) : (
        <ol className="mj-scores-list">
          {list.map((row, i) => (
            <li key={row.user?.id || i}>
              <span className="mj-scores-pos">{i + 1}</span>
              <UserAvatar user={row.user} size={24} />
              <span className="mj-scores-name">{row.user?.displayName || row.user?.username || 'Jogador'}</span>
              <span className="mj-scores-val">{Number(row.score || 0).toLocaleString('pt-BR')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
