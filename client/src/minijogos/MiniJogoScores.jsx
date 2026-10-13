import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import UserAvatar from '../components/UserAvatar.jsx';

// Recordes dos Mini-Jogos: escuta o placar que o jogo manda (postMessage da
// mesma origem), salva no Project Club e mostra o ranking.
export function useMinijogoScores(slug) {
  const [board, setBoard] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [toast, setToast] = useState(null);
  const startRef = useRef(Date.now());
  const sentRef = useRef(0); // maior placar já enviado nesta sessão (evita repetir)

  const load = useCallback(() => {
    api.get(`/minigames/${slug}/leaderboard`).then((r) => setBoard(r.data)).catch(() => {});
    // Ranking da SEMANA (zera toda segunda; top 3 ganha moedas).
    api.get(`/minigames/${slug}/weekly`).then((r) => setWeekly(r.data)).catch(() => {});
  }, [slug]);

  // Salva o placar ATUAL do jogo (ex.: ao sair/fechar no meio da partida). O
  // servidor guarda só o melhor, então reenviar é inofensivo; mesmo assim só
  // mandamos se for maior que o último já enviado. Silencioso (sem toast),
  // porque costuma rodar na saída, quando a tela já está fechando.
  const saveFinal = useCallback((raw) => {
    const score = Math.floor(Number(raw));
    if (!Number.isFinite(score) || score <= 0 || score <= sentRef.current) return;
    sentRef.current = score;
    api.post(`/minigames/${slug}/score`, { score }).then(() => load()).catch(() => {});
  }, [slug, load]);

  useEffect(() => {
    load();
    startRef.current = Date.now();
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== 'pc-minigame-score') return;
      const score = Math.floor(Number(d.score));
      if (!Number.isFinite(score) || score <= 0) return;
      if (score > sentRef.current) sentRef.current = score;
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

  return { board, weekly, toast, saveFinal };
}

function countdown(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'fechando…';
  const d = Math.floor(ms / 86400000); const h = Math.floor((ms % 86400000) / 3600000); const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export function ScoresPanel({ board, weekly, onClose }) {
  const [tab, setTab] = useState('week');
  const isWeek = tab === 'week' && weekly;
  const list = (isWeek ? weekly?.top : board?.top) || [];
  const mine = isWeek ? weekly?.me : board?.me;
  const noScores = board && board.hasScores === false;
  return (
    <div className="mj-scores" role="dialog" aria-label="Recordes">
      <div className="mj-scores-head">
        <strong>Recordes</strong>
        <button type="button" className="mj-player-btn" onClick={onClose} aria-label="Fechar">×</button>
      </div>
      {!noScores && (
        <div className="mj-scores-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'week'} className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>Semana</button>
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>Geral</button>
        </div>
      )}
      {isWeek && weekly?.endsAt && (
        <div className="mj-scores-week">
          <span>Fecha em <b>{countdown(weekly.endsAt)}</b></span>
          <span title="Prêmio em moedas pros 3 primeiros ao fechar a semana">🥇 {weekly.prizes?.[0]} · 🥈 {weekly.prizes?.[1]} · 🥉 {weekly.prizes?.[2]} moedas</span>
        </div>
      )}
      {mine?.best > 0 && (
        <div className="mj-scores-mine">{isWeek ? 'Seu melhor da semana' : 'Seu recorde'}: <b>{mine.best.toLocaleString('pt-BR')}</b>{mine.rank ? ` · ${mine.rank}º` : ''}{mine.plays ? ` · ${mine.plays} partidas` : ''}</div>
      )}
      {noScores ? (
        <p className="mj-scores-empty">Este jogo não envia pontuação — contamos só as partidas.</p>
      ) : list.length === 0 ? (
        <p className="mj-scores-empty">{isWeek ? 'Ninguém pontuou nesta semana ainda. Seja o primeiro e leve o prêmio!' : 'Ninguém marcou pontos ainda. Seja o primeiro!'}</p>
      ) : (
        <ol className="mj-scores-list">
          {list.map((row, i) => (
            <li key={row.user?.id || i} className={isWeek && i < 3 ? `mj-scores-prize mj-scores-prize-${i + 1}` : ''}>
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

// Prêmios do ranking semanal ainda não resgatados (aparece no topo de /minijogos).
export function WeeklyPrizesBanner({ gameNames, onClaimed }) {
  const [prizes, setPrizes] = useState([]);
  const [busy, setBusy] = useState(null);
  useEffect(() => { api.get('/minigames/prizes').then((r) => setPrizes(r.data?.prizes || [])).catch(() => {}); }, []);
  if (!prizes.length) return null;
  const claim = async (p) => {
    if (busy) return;
    setBusy(p.id);
    try {
      const { data } = await api.post(`/minigames/prizes/${p.id}/claim`);
      setPrizes((l) => l.filter((x) => x.id !== p.id));
      onClaimed?.(data);
    } catch { /* já resgatado ou erro — a lista se corrige no próximo load */ } finally { setBusy(null); }
  };
  const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : '🥉');
  return (
    <section className="mj-prizes" aria-label="Prêmios do ranking semanal">
      <div className="mj-prizes-head">
        <strong>Você ficou no pódio da semana passada!</strong>
        <span className="dim">Resgate suas moedas:</span>
      </div>
      <ul className="mj-prizes-list">
        {prizes.map((p) => (
          <li key={p.id}>
            <span className="mj-prizes-medal" aria-hidden="true">{medal(p.rank)}</span>
            <span className="mj-prizes-text"><b>{p.rank}º lugar</b> em {gameNames?.[p.game] || p.game} <span className="dim">· {Number(p.score).toLocaleString('pt-BR')} pts · {p.week}</span></span>
            <button type="button" className="mj-prizes-btn" disabled={busy === p.id} onClick={() => claim(p)}>+{p.coins} moedas</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
