import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { eventPath } from '../utils/prettyLinks';
import { hour12Option } from '../utils/formatTime';
import '../styles/events-calendar.css';

// Calendário de eventos da Central (coluna da direita, InicioPage.jsx).
// Mês com bolinha nos dias que têm evento; clicar num dia mostra os
// eventos dele. Sem dia escolhido, mostra os próximos. Clicar num evento
// abre a página dele (/evento/<titulo>).
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a, b) => dayKey(a) === dayKey(b);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function Chevron({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

// Dias (meia-noite) em que um evento acontece: do início ao fim, no máximo 31.
function eventDays(ev) {
  if (!ev.startsAt) return [];
  const start = startOfDay(new Date(ev.startsAt));
  const end = ev.endsAt ? startOfDay(new Date(ev.endsAt)) : start;
  const days = [];
  for (let d = new Date(start); d <= end && days.length < 31; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  return days;
}

export default function EventsCalendar({ events }) {
  const navigate = useNavigate();
  const [today] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState(null);

  const list = useMemo(() => (events || []).filter((e) => e.status !== 'ENDED' || e.startsAt), [events]);
  // dia → eventos daquele dia
  const byDay = useMemo(() => {
    const map = new Map();
    for (const ev of list) {
      for (const d of eventDays(ev)) {
        const k = dayKey(d);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(ev);
      }
    }
    return map;
  }, [list]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  // Só mostra a 6ª semana se ela tiver algum dia do mês.
  const shownCells = cells[35].getMonth() === month.getMonth() ? cells : cells.slice(0, 35);

  const upcoming = useMemo(() => list
    .filter((e) => e.status === 'ACTIVE' || (e.startsAt && new Date(e.endsAt || e.startsAt) >= today))
    .sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0))
    .slice(0, 4), [list, today]);
  const shown = picked ? (byDay.get(dayKey(picked)) || []) : upcoming;

  const moveMonth = (delta) => { setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1)); setPicked(null); };
  const title = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="evcal">
      <div className="evcal-head">
        <button type="button" className="evcal-nav" onClick={() => moveMonth(-1)} aria-label="Mês anterior"><Chevron dir="left" /></button>
        <strong className="evcal-title">{title}</strong>
        <button type="button" className="evcal-nav" onClick={() => moveMonth(1)} aria-label="Próximo mês"><Chevron dir="right" /></button>
      </div>
      <div className="evcal-grid" role="grid" aria-label={`Eventos de ${title}`}>
        {WEEK.map((w, i) => <span key={`w${i}`} className="evcal-week" aria-hidden="true">{w}</span>)}
        {shownCells.map((d) => {
          const evs = byDay.get(dayKey(d)) || [];
          const live = evs.some((e) => e.status === 'ACTIVE');
          const cls = [
            'evcal-day',
            d.getMonth() !== month.getMonth() && 'is-out',
            sameDay(d, today) && 'is-today',
            evs.length > 0 && 'has-events',
            live && 'is-live',
            picked && sameDay(d, picked) && 'is-picked',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={dayKey(d)} type="button" className={cls} role="gridcell"
              aria-label={`${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}${evs.length ? `, ${evs.length} evento${evs.length === 1 ? '' : 's'}` : ''}`}
              aria-pressed={!!picked && sameDay(d, picked)}
              onClick={() => setPicked((p) => (p && sameDay(p, d) ? null : d))}
            >
              {d.getDate()}
              {evs.length > 0 && <span className="evcal-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="evcal-list-head">
        <span>{picked ? picked.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Próximos eventos'}</span>
        {picked && <button type="button" className="home-link" onClick={() => setPicked(null)}>Ver próximos</button>}
      </div>
      {events === null ? (
        <p className="evcal-empty">Carregando…</p>
      ) : shown.length === 0 ? (
        <p className="evcal-empty">{picked ? 'Nenhum evento neste dia.' : 'Nenhum evento agendado.'}</p>
      ) : (
        <ul className="evcal-list">
          {shown.map((ev) => {
            const d = ev.startsAt ? new Date(ev.startsAt) : null;
            const going = ev.rsvp?.counts?.GOING || 0;
            return (
              <li key={ev.id}>
                <button type="button" className="evcal-ev" onClick={() => navigate(eventPath(ev))}>
                  <span className={`evcal-ev-date${ev.status === 'ACTIVE' ? ' is-live' : ''}`} aria-hidden="true">
                    {ev.status === 'ACTIVE' ? <b>Ao vivo</b> : d ? <><b>{String(d.getDate()).padStart(2, '0')}</b>{d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</> : <b>—</b>}
                  </span>
                  <span className="evcal-ev-text">
                    <strong className="truncate">{ev.title}</strong>
                    <span className="truncate">
                      {d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: hour12Option() }) : ''}
                      {` · ${going} vão`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
