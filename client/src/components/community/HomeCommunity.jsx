import { useCallback, useEffect, useState } from 'react';
import { getCommunityHome, claimSeasonGift, errText } from '../../api/community';
import { useSocket } from '../../context/SocketContext.jsx';
import { useStore } from '../../store/useStore';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { Ico } from '../PagesKit.jsx';
import { Countdown, fmt } from './CommunityBits.jsx';
import '../../styles/community-goals.css';

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

// Metas da comunidade no estilo dos desafios comunitários do PvZ Garden
// Warfare 2 (nov/2026): placa grossa com contorno, barra listrada enorme,
// marcos a cada 25% e o baú de recompensa na ponta.
const METRIC_ICON = { MESSAGES: 'chat', VOICE_MINUTES: 'volume', FORUM_POSTS: 'doc' };
const MARKS = [25, 50, 75];

function GoalRow({ g }) {
  const pct = g.reached ? 100 : Math.max(0, Math.min(100, g.percent || 0));
  return (
    <div className={`gw-goal${g.reached ? ' is-done' : ''}`}>
      <span className="gw-medal" aria-hidden="true"><Ico name={METRIC_ICON[g.metric] || 'flame'} size={24} /></span>
      <div className="gw-goal-main">
        <div className="gw-goal-head">
          <strong className="gw-goal-title">{g.title || g.label}</strong>
          <span className="gw-goal-num">{fmt(g.rawValue)} / {fmt(g.target)} {g.label}<b className="gw-goal-pct">{pct}%</b></span>
        </div>
        <div className="gw-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={g.title || g.label}>
          <span className="gw-fill" style={{ width: `${pct}%` }} />
          {MARKS.map((m) => (
            <span key={m} className={`gw-mark${pct >= m ? ' on' : ''}`} style={{ left: `${m}%` }} aria-hidden="true"><Ico name="star" size={14} /></span>
          ))}
        </div>
      </div>
      <span className={`gw-chest${g.reached ? ' open' : ''}`} title={g.rewardCoins ? `${g.rewardCoins} moedas pra quem participar` : 'Recompensa'}>
        <Ico name={g.reached ? 'check' : 'chest'} size={22} />
        {g.rewardCoins ? <b>+{g.rewardCoins}</b> : null}
      </span>
    </div>
  );
}

function GoalsCard({ goals }) {
  if (!goals?.goals?.length) return null;
  const min = goals.minContribution || 1;
  const mine = Math.min(min, goals.myPoints || 0);
  const participated = (goals.myPoints || 0) >= min;
  const done = goals.goals.filter((g) => g.reached).length;
  return (
    <section className="home-section gw-board" aria-label="Desafios da comunidade">
      <header className="gw-head">
        <span className="gw-ribbon"><Ico name="trophy" size={20} /> Desafios da comunidade</span>
        <span className="gw-timer"><Countdown to={goals.endsAt} prefix="termina em" /></span>
      </header>
      <p className="gw-intro">Todo mundo junto! Batam as metas da semana e quem participar leva as moedas. <strong>{done}/{goals.goals.length}</strong> batidas.</p>
      <div className="gw-goals">
        {goals.goals.map((g) => <GoalRow key={g.id} g={g} />)}
      </div>
      <footer className={`gw-me${participated ? ' ok' : ''}`}>
        <span className="gw-me-label">{participated ? <><Ico name="check" size={15} /> Você está participando!</> : 'Sua parte'}</span>
        <span className="gw-me-bar" aria-hidden="true"><span style={{ width: `${Math.round((mine / min) * 100)}%` }} /></span>
        <small>{participated ? 'Valeu por ajudar a comunidade.' : 'Mande mensagens e entre em call pra entrar nas recompensas.'}</small>
      </footer>
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

// A coluna lateral ("Clubes da semana" e "Participar") saiu da Central (nov/2026).
