import { useEffect, useState } from 'react';
import { getDonationGoal } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { DONATE_URL } from './TopSearchBar.jsx';
import { brl } from '../utils/money';
import '../styles/donation-goal.css';

// Meta de doações: barrinha verde entre o banner da comunidade e o menu
// (Início, Social...). A staff define a meta e lança as doações no Painel
// (Comunidade → Meta de doações); atualiza ao vivo pra todo mundo.
export default function DonationGoalBar() {
  const { socket } = useSocket() || {};
  const [goal, setGoal] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { getDonationGoal().then(setGoal).catch(() => {}); }, []);
  useEffect(() => {
    if (!socket?.on) return undefined;
    const onUpdate = (g) => setGoal(g);
    socket.on('donation-goal:update', onUpdate);
    return () => socket.off('donation-goal:update', onUpdate);
  }, [socket]);

  if (!goal?.enabled || !(goal.target > 0)) return null;
  const pct = Math.min(100, (goal.raised / goal.target) * 100);
  const done = goal.raised >= goal.target;
  const pctLabel = `${pct >= 10 || pct === 0 ? Math.floor(pct) : pct.toFixed(1).replace('.', ',')}%`;

  return (
    <div className={`dg${done ? ' dg-done' : ''}${open ? ' dg-open' : ''}`}>
      <button type="button" className="dg-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="dg-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
          </svg>
          <span className="truncate">{goal.title}</span>
        </span>
        <span className="dg-pct">{done ? 'Meta batida!' : pctLabel}</span>
      </button>
      <div
        className="dg-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
        aria-label={`${goal.title}: ${brl(goal.raised)} de ${brl(goal.target)}`}
      >
        <div className="dg-fill" style={{ width: `${Math.max(pct, goal.raised > 0 ? 3 : 0)}%` }} />
      </div>
      <div className="dg-amounts">
        <b>{brl(goal.raised)}</b>
        <span>de {brl(goal.target)}</span>
      </div>
      {open && (
        <div className="dg-more">
          {goal.description && <p className="dg-desc">{goal.description}</p>}
          {goal.showDonors && goal.recent?.length > 0 && (
            <ul className="dg-donors" aria-label="Últimas doações">
              {goal.recent.map((d, i) => (
                <li key={i}><span className="truncate">{d.donorName}</span><b>{brl(d.amount)}</b></li>
              ))}
            </ul>
          )}
          <a className="dg-cta" href={DONATE_URL} target="_blank" rel="noreferrer">Apoiar o Project Club</a>
        </div>
      )}
    </div>
  );
}
