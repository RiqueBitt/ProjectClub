import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { cardsLobby } from './api';

// Cartão do convite de batalha no chat/DM (link /cartas?sala=CODIGO):
// "Fulano está chamando você para uma batalha", vagas, regras e o botão
// de entrar. Atualiza sozinho enquanto a sala está aberta.
const SWORDS = 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2';

export default function BattleInviteCard({ code }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [lobby, setLobby] = useState(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => cardsLobby(code).then((d) => { if (alive) setLobby(d.lobby); }).catch(() => { if (alive) setLobby(null); });
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [code]);
  if (lobby === null) return null;
  if (lobby === undefined) return <div className="bic bic-loading" aria-hidden="true" />;
  const filled = lobby.slots.filter((s) => s.user || s.bot).length;
  const mine = lobby.host?.id === user?.id;
  const open = lobby.status === 'OPEN';
  const inside = lobby.mySlot >= 0;
  const go = () => navigate(lobby.status === 'STARTED' && lobby.matchId ? (inside ? `/cartas?partida=${lobby.matchId}` : `/cartas?assistir=${lobby.matchId}`) : `/cartas?sala=${lobby.code}`);
  return (
    <div className={`bic is-${lobby.status.toLowerCase()}`} role="link" tabIndex={0} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <span className="bic-glow" aria-hidden="true" />
      <span className="bic-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SWORDS} /></svg></span>
      <span className="bic-body">
        <span className="bic-label">Arena de Cartas · {lobby.format === '2V2' ? '2 vs 2' : '1 vs 1'}{lobby.custom ? ' · Personalizada' : ''}</span>
        <span className="bic-title">
          {mine ? 'Sua sala de batalha' : <><b data-no-translate>{lobby.host?.displayName}</b> está chamando você para uma batalha!</>}
        </span>
        <span className="bic-meta">
          <span className="bic-avatars">
            {lobby.slots.map((s) => (s.user ? <UserAvatar key={s.index} user={s.user} size={22} /> : <span key={s.index} className={`bic-seat${s.bot ? ' is-bot' : ''}`}>{s.bot ? 'B' : '+'}</span>))}
          </span>
          <span>{filled}/{lobby.slots.length} jogadores</span>
          <span className={`bic-chip${lobby.rewards === 'none' ? ' is-none' : ''}`}>{lobby.rewards === 'none' ? 'Sem recompensas' : 'Vale moedas'}</span>
          {lobby.rules?.deckMode === 'ALL' && <span className="bic-chip">Baralho aleatório</span>}
          {lobby.rules && <span className="bic-chip">{lobby.rules.startHp} de vida</span>}
        </span>
      </span>
      <button type="button" className="bic-btn" onClick={(e) => { e.stopPropagation(); go(); }} disabled={!open && !(lobby.status === 'STARTED' && lobby.matchId)}>
        {open ? (inside ? 'Abrir sala' : 'Entrar na batalha') : lobby.status === 'STARTED' ? (inside ? 'Voltar à partida' : 'Assistir') : 'Encerrada'}
      </button>
    </div>
  );
}
