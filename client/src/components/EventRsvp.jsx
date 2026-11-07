import { useState } from 'react';
import { setEventRsvp } from '../api/social';
import UserAvatar from './UserAvatar.jsx';
import '../styles/socialx.css';

// "Eu vou" / "Talvez" / "Não vou" num evento, com contagem e os rostos de
// quem vai. Clicar de novo na mesma resposta desfaz.
const OPTIONS = [
  { key: 'GOING', label: 'Eu vou', icon: 'M20 6 9 17l-5-5' },
  { key: 'MAYBE', label: 'Talvez', icon: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01' },
  { key: 'NO', label: 'Não vou', icon: 'M6 6l12 12M18 6 6 18' },
];

export default function EventRsvp({ event, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rsvp = event.rsvp || { counts: { GOING: 0, MAYBE: 0, NO: 0 }, going: [], maybe: [], mine: null };
  const ended = event.status === 'ENDED';

  const pick = async (key) => {
    if (busy || ended) return;
    const next = rsvp.mine === key ? null : key;
    // Otimista: mexe na contagem na hora.
    const counts = { ...rsvp.counts };
    if (rsvp.mine) counts[rsvp.mine] = Math.max(0, counts[rsvp.mine] - 1);
    if (next) counts[next] += 1;
    onChange?.({ ...rsvp, counts, mine: next });
    setBusy(true); setError('');
    try {
      const r = await setEventRsvp(event.id, next);
      onChange?.({ ...r.rsvp, mine: r.mine ?? null });
    } catch (err) {
      onChange?.(rsvp);
      setError(err.response?.data?.error || 'Não deu pra salvar sua resposta.');
    }
    setBusy(false);
  };

  const faces = [...(rsvp.going || []), ...(rsvp.maybe || [])].slice(0, 6);
  const goingCount = rsvp.counts.GOING || 0;
  const maybeCount = rsvp.counts.MAYBE || 0;

  return (
    <div className="sx-rsvp">
      {!ended && (
        <div className="sx-rsvp-buttons" role="group" aria-label="Você vai?">
          {OPTIONS.map((o) => (
            <button
              key={o.key} type="button" disabled={busy}
              className={`sx-rsvp-btn sx-rsvp-${o.key.toLowerCase()}${rsvp.mine === o.key ? ' is-on' : ''}`}
              aria-pressed={rsvp.mine === o.key} onClick={() => pick(o.key)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={o.icon} /></svg>
              {o.label}
              <span className="sx-rsvp-count">{rsvp.counts[o.key] || 0}</span>
            </button>
          ))}
        </div>
      )}
      {(goingCount > 0 || maybeCount > 0) && (
        <div className="sx-rsvp-people">
          <span className="sx-faces">
            {faces.map((u) => <UserAvatar key={u.id} user={u} size={22} />)}
          </span>
          <span className="sx-rsvp-summary">
            {goingCount > 0 && <><b>{goingCount}</b> {ended ? (goingCount === 1 ? 'foi' : 'foram') : (goingCount === 1 ? 'vai' : 'vão')}</>}
            {goingCount > 0 && maybeCount > 0 && ' · '}
            {maybeCount > 0 && <><b>{maybeCount}</b> talvez</>}
          </span>
        </div>
      )}
      {error && <span className="sx-rsvp-error">{error}</span>}
    </div>
  );
}
