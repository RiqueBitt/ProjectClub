import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCommunityHome, claimSeasonGift, errText } from '../../api/community';
import { useSocket } from '../../context/SocketContext.jsx';
import { useStore } from '../../store/useStore';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { Ico } from '../PagesKit.jsx';
import ClanIcon from '../ClanIcon.jsx';
import { Countdown, ProgressBar, fmt } from './CommunityBits.jsx';

// Seções da Fase 4 no Início: temporada temática, metas coletivas da
// semana, Post da semana, pódio dos Clubes e atalhos de participação.
// Uma chamada só (/community-home); cada parte some sozinha se não tiver
// nada pra mostrar.

export function useCommunityHome() {
  const [data, setData] = useState(null);
  const { socket } = useSocket() || {};
  const load = useCallback(() => getCommunityHome().then(setData).catch(() => setData((d) => d || {})), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(() => load(), { interval: 60000 });
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('goals:reached', load);
    return () => { socket.off('goals:reached', load); };
  }, [socket, load]);
  return { data, reload: load };
}

function SeasonBanner({ season, onClaimed }) {
  const [busy, setBusy] = useState(false);
  if (!season?.season) return null;
  const s = season.season;
  const claim = async () => {
    setBusy(true);
    try {
      const r = await claimSeasonGift();
      useStore.getState().pushNotice(r.coins ? `Presente de ${s.label}: +${r.coins} moedas!${r.achievementUnlocked ? ' E uma conquista nova!' : ''}` : `Presente de ${s.label} resgatado!`);
      onClaimed();
    } catch (e) { useStore.getState().pushNotice(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className={`c4-season c4-season-${s.key}`} aria-label={`Temporada: ${s.label}`}>
      <div className="c4-season-text">
        <small>Temporada · {s.when}</small>
        <h2>{s.greeting}</h2>
        <p>Passe aqui todo dia durante {s.label} pra pegar um presente. No primeiro, você ganha a conquista da temporada.</p>
      </div>
      {season.claimedToday
        ? <span className="c4-season-done"><Ico name="check" size={16} /> Presente de hoje resgatado{season.daysClaimed > 1 ? ` · ${season.daysClaimed} dias` : ''}</span>
        : <button type="button" className="pk-btn lg c4-season-btn" disabled={busy} onClick={claim}><Ico name="gift" size={18} /> {busy ? 'Abrindo…' : `Pegar presente (+${s.dailyCoins})`}</button>}
    </section>
  );
}

function GoalsCard({ goals }) {
  if (!goals?.goals?.length) return null;
  const participated = goals.myPoints >= goals.minContribution;
  return (
    <section className="home-section c4-home-goals">
      <header className="home-section-head">
        <h2><Ico name="flame" size={17} /> Metas da comunidade</h2>
        <Countdown to={goals.endsAt} prefix="semana termina em" />
      </header>
      <div className="c4-goals">
        {goals.goals.map((g) => (
          <div key={g.id} className={`c4-goal ${g.reached ? 'is-done' : ''}`}>
            <div className="c4-goal-top">
              <strong>{g.title || g.label}</strong>
              {g.reached ? <span className="pk-chip green"><Ico name="check" size={13} /> Batida!</span> : <span className="c4-goal-pct">{g.percent}%</span>}
            </div>
            <ProgressBar value={g.value} max={g.target} label={g.title || g.label} tone={g.reached ? 'green' : 'brand'} />
            <small>{fmt(g.rawValue)} / {fmt(g.target)} {g.label}{g.rewardCoins ? ` · ${g.rewardCoins} moedas pra quem participar` : ''}</small>
          </div>
        ))}
      </div>
      <p className="c4-small">{participated ? 'Você já está participando desta semana. Valeu!' : 'Mande mensagens e entre em call pra participar das recompensas.'}</p>
    </section>
  );
}

export function HomeCommunityMain({ home }) {
  const { data, reload } = home;
  return (
    <>
      <SeasonBanner season={data?.season} onClaimed={reload} />
      <GoalsCard goals={data?.goals} />
    </>
  );
}

export function HomeCommunitySide({ home }) {
  const navigate = useNavigate();
  const { data } = home;
  const links = [
    { icon: 'bolt', label: 'Bora Jogar', hint: 'Marque uma jogatina', to: '/participar' },
    { icon: 'gift', label: 'Sorteio', hint: data?.raffle ? `Prêmio: ${fmt(data.raffle.prize)} moedas` : 'Toda semana', to: '/sorteio' },
    { icon: 'calendar', label: 'Retrospectiva', hint: 'Seu mês em números', to: '/retrospectiva' },
    { icon: 'tag', label: 'Interesses', hint: 'Seus jogos e assuntos', to: '/participar?aba=interesses' },
    { icon: 'users', label: 'Convidar amigos', hint: 'Ganhe moedas', to: '/participar?aba=convites' },
  ];
  return (
    <>
      {data?.clanTop?.length > 0 && (
        <section className="home-section home-card">
          <header className="home-section-head">
            <h2><Ico name="trophy" size={17} /> Clubes da semana</h2>
            <button type="button" className="home-link" onClick={() => navigate('/clans/mine?aba=competicao')}>Ver</button>
          </header>
          <ol className="c4-podium">
            {data.clanTop.map((c) => (
              <li key={c.clanId}>
                <span className={`c4-rank-pos pos-${c.rank}`}>{c.rank}</span>
                <span className="c4-clan-icon"><ClanIcon icon={c.icon} color={c.iconColor} size={22} /></span>
                <span className="truncate">{c.name}</span>
                <strong>{fmt(c.points)} pts</strong>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="home-section home-card">
        <header className="home-section-head"><h2><Ico name="users" size={17} /> Participar</h2></header>
        <div className="c4-quick">
          {links.map((l) => (
            <button key={l.label} type="button" className="c4-quick-link" onClick={() => navigate(l.to)}>
              <span className="c4-quick-icon"><Ico name={l.icon} size={17} /></span>
              <span className="c4-quick-text"><strong>{l.label}</strong><small className="truncate">{l.hint}</small></span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
