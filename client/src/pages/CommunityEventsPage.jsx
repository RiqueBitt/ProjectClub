import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { createEvent } from '../api/endpoints';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { FeaturedGlyph } from '../components/FeaturedChannels.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/channels.css';
import EventRsvp from '../components/EventRsvp.jsx';
import { useMarkSectionSeen } from '../utils/sectionBadges';
import '../styles/socialx.css';
import '../styles/contentx.css';

// Visão: lista (abas por situação) ou calendário do mês. Lembra a escolha.
const VIEW_KEY = 'eventsView';
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Dias (no fuso de quem vê) em que o evento aparece no calendário: do
// início até o fim (no máximo 14 dias, pra evento sem fim não lotar o mês).
function eventDays(ev) {
  const start = ev.startsAt ? new Date(ev.startsAt) : null;
  if (!start || isNaN(start.getTime())) return [];
  const end = ev.endsAt ? new Date(ev.endsAt) : start;
  const out = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < 14 && d <= end; i += 1) { out.push(dayKey(d)); d.setDate(d.getDate() + 1); }
  return out.length ? out : [dayKey(start)];
}

function CalIcon({ d, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}
const ICON_LIST = 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01';
const ICON_CAL = 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4';
const ICON_LEFT = 'm15 18-6-6 6-6';
const ICON_RIGHT = 'm9 18 6-6-6-6';
const ICON_BELL = 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0';

// Calendário do mês com os eventos; clicar num dia mostra os eventos dele.
function EventsCalendar({ events, now, focusId, onRsvp }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(() => dayKey(new Date()));
  const byDay = useMemo(() => {
    const map = {};
    for (const ev of events || []) for (const k of eventDays(ev)) (map[k] ||= []).push(ev);
    return map;
  }, [events]);
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const lead = (first.getDay() + 6) % 7; // começa na segunda
    const startDate = new Date(first); startDate.setDate(1 - lead);
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const total = Math.ceil((lead + daysInMonth) / 7) * 7; // só as semanas do mês
    return Array.from({ length: total }, (_, i) => { const d = new Date(startDate); d.setDate(startDate.getDate() + i); return d; });
  }, [cursor]);
  const todayKey = dayKey(new Date());
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const monthLabel = cap(cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  const move = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const pickedEvents = byDay[picked] || [];
  const noDate = (events || []).filter((ev) => !ev.startsAt);
  const pickedLabel = cap(new Date(`${picked}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));

  return (
    <div className="cxe-cal-wrap">
      <section className="cxe-cal" aria-label="Calendário de eventos">
        <header className="cxe-cal-head">
          <button type="button" className="cxe-cal-nav" onClick={() => move(-1)} aria-label="Mês anterior"><CalIcon d={ICON_LEFT} /></button>
          <h2>{monthLabel}</h2>
          <button type="button" className="cxe-cal-nav" onClick={() => move(1)} aria-label="Próximo mês"><CalIcon d={ICON_RIGHT} /></button>
          <button type="button" className="cx-btn ghost cxe-cal-today" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setPicked(todayKey); }}>Hoje</button>
        </header>
        <div className="cxe-cal-grid" role="grid">
          {WEEKDAYS.map((w) => <span key={w} className="cxe-cal-wd" role="columnheader">{w}</span>)}
          {cells.map((d) => {
            const k = dayKey(d);
            const list = byDay[k] || [];
            const out = d.getMonth() !== cursor.getMonth();
            return (
              <button
                key={k} type="button" role="gridcell"
                className={`cxe-cal-day${out ? ' out' : ''}${k === todayKey ? ' today' : ''}${k === picked ? ' picked' : ''}${list.length ? ' has' : ''}`}
                onClick={() => setPicked(k)} aria-label={`${d.getDate()}${list.length ? `, ${list.length} evento(s)` : ''}`} aria-pressed={k === picked}
              >
                <span className="cxe-cal-num">{d.getDate()}</span>
                <span className="cxe-cal-evs">
                  {list.slice(0, 2).map((ev) => <span key={ev.id} className={`cxe-cal-ev s-${ev.status.toLowerCase()}`}>{ev.title}</span>)}
                  {list.length > 2 && <span className="cxe-cal-more">+{list.length - 2}</span>}
                </span>
                {list.length > 0 && <span className="cxe-cal-dots" aria-hidden="true">{list.slice(0, 3).map((ev) => <i key={ev.id} className={`s-${ev.status.toLowerCase()}`} />)}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="cxe-cal-day-list">
        <h3 className="cxe-cal-day-title">{pickedLabel}</h3>
        {pickedEvents.length === 0 ? (
          <div className="cxf-empty-inline">
            <span className="cxf-empty-inline-icon"><CalIcon d={ICON_CAL} size={18} /></span>
            <div><strong>Nenhum evento nesse dia</strong><span>Escolha um dia marcado no calendário.</span></div>
          </div>
        ) : (
          <div className="cev-grid">
            {pickedEvents.map((ev) => <EventCard key={ev.id} ev={ev} now={now} highlighted={ev.id === focusId} onRsvp={onRsvp} />)}
          </div>
        )}
        {noDate.length > 0 && <p className="cxe-cal-nodate">{noDate.length === 1 ? '1 evento sem data marcada aparece só na lista.' : `${noDate.length} eventos sem data marcada aparecem só na lista.`}</p>}
      </section>
    </div>
  );
}

// Canal em destaque "Eventos": os eventos da comunidade (os mesmos do
// Início e do Painel da staff), separados em Acontecendo / Em breve /
// Encerrados e atualizados ao vivo. A staff cria eventos rápidos aqui
// mesmo; banner, ícone e edição completa continuam no Painel.

const TABS = [
  { key: 'ACTIVE', label: 'Acontecendo' },
  { key: 'UPCOMING', label: 'Em breve' },
  { key: 'ENDED', label: 'Encerrados' },
];
const STATUS_LABEL = { ACTIVE: 'Ao vivo', UPCOMING: 'Em breve', ENDED: 'Encerrado' };

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// "começa em 3 dias", "termina em 5 horas"...
function relative(iso, now) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (isNaN(diff)) return null;
  const abs = Math.abs(diff);
  const units = [[86400000, 'dia', 'dias'], [3600000, 'hora', 'horas'], [60000, 'minuto', 'minutos']];
  for (const [ms, one, many] of units) {
    if (abs >= ms) { const n = Math.floor(abs / ms); return `${n} ${n === 1 ? one : many}`; }
  }
  return 'instantes';
}

function EventCard({ ev, now, highlighted, onRsvp }) {
  const voice = useVoice();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  // Veio de um link (/eventos/<id>): rola até o cartão e destaca.
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [highlighted]);
  const copyLink = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/eventos/${ev.id}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => {});
  };
  const starts = formatDate(ev.startsAt);
  const ends = formatDate(ev.endsAt);
  let when = null;
  if (ev.status === 'UPCOMING' && ev.startsAt && new Date(ev.startsAt).getTime() > now) when = `Começa em ${relative(ev.startsAt, now)}`;
  else if (ev.status === 'ACTIVE' && ev.endsAt && new Date(ev.endsAt).getTime() > now) when = `Termina em ${relative(ev.endsAt, now)}`;
  const longText = (ev.description || '').length > 220;

  return (
    <article ref={ref} className={`cev-card status-${ev.status.toLowerCase()}${highlighted ? ' sx-ev-highlight' : ''}`}>
      <div className="cev-banner">
        {ev.bannerUrl
          ? <img src={proxyImage(ev.bannerUrl)} alt="" loading="lazy" />
          : <div className="cev-banner-empty"><FeaturedGlyph name="calendar" size={30} /></div>}
        <span className={`cev-status cev-status-${ev.status.toLowerCase()}`}>
          {ev.status === 'ACTIVE' && <span className="cev-pulse" aria-hidden="true" />}
          {STATUS_LABEL[ev.status] || ev.status}
        </span>
      </div>
      <div className="cev-body">
        <div className="cev-title-row">
          {ev.iconUrl && <img className="cev-icon" src={proxyImage(ev.iconUrl)} alt="" />}
          <h3>{ev.title}</h3>
        </div>
        {when && <div className="cev-when">{when}</div>}
        {(starts || ends) && (
          <div className="cev-dates">
            <FeaturedGlyph name="calendar" size={14} />
            <span>{starts || '—'}{ends ? ` até ${ends}` : ''}</span>
          </div>
        )}
        {ev.description && (
          <p className={`cev-desc${open || !longText ? ' is-open' : ''}`}>{ev.description}</p>
        )}
        {longText && (
          <button type="button" className="cev-more" onClick={() => setOpen((v) => !v)}>{open ? 'Mostrar menos' : 'Ler mais'}</button>
        )}
        <EventRsvp event={ev} onChange={(rsvp) => onRsvp(ev.id, rsvp)} />
        {ev.voiceChannel && ev.status !== 'ENDED' && (
          <button
            type="button" className="cev-join"
            onClick={() => { voice?.joinChannel(null, ev.voiceChannel.id, ev.voiceChannel.name, ev.voiceChannel.type || 'VOICE'); navigate(`/channels/${ev.voiceChannel.id}`); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
            {ev.status === 'ACTIVE' ? `Entrar na call · ${ev.voiceChannel.name}` : `Call do evento: ${ev.voiceChannel.name}`}
          </button>
        )}
        {ev.rsvp?.mine === 'GOING' && ev.status === 'UPCOMING' && ev.startsAt && new Date(ev.startsAt).getTime() > now && (
          <div className="cxe-remind"><CalIcon d={ICON_BELL} size={14} /> Você recebe um lembrete 15 minutos antes.</div>
        )}
        <div className="sx-ev-foot">
          {ev.createdBy?.displayName && <div className="cev-by">Por {ev.createdBy.displayName}</div>}
          <button type="button" className="sx-ev-share" onClick={copyLink}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
            {copied ? 'Link copiado' : 'Copiar link'}
          </button>
        </div>
      </div>
    </article>
  );
}

function QuickCreate({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const now = Date.now();
      const status = startsAt && new Date(startsAt).getTime() > now ? 'UPCOMING' : 'ACTIVE';
      await createEvent({ title, description, startsAt: startsAt || null, endsAt: endsAt || null, status });
      onCreated?.();
      onClose();
    } catch (err) { setError(err.response?.data?.error || 'Não foi possível criar o evento.'); }
    finally { setSaving(false); }
  };

  return (
    <form className="cev-create" onSubmit={submit}>
      <div className="cev-create-head">
        <h3>Novo evento</h3>
        <span className="dim">Banner e ícone você coloca depois, no Painel.</span>
      </div>
      <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required placeholder="Ex.: Campeonato de sexta" /></label>
      <label>Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} required placeholder="O que vai rolar, como participar, prêmios..." /></label>
      <div className="cev-create-dates">
        <label>Começa<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <label>Termina<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="cev-create-actions">
        <button type="button" className="cx-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="cx-btn primary" disabled={saving}>{saving ? 'Criando...' : 'Criar evento'}</button>
      </div>
    </form>
  );
}

export default function CommunityEventsPage() {
  const navigate = useNavigate();
  useMarkSectionSeen('eventos'); // abriu Eventos: apaga a bolinha "novo"
  const { user } = useAuth();
  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  const { events, reload, patchEvent } = useCommunityEvents();
  const [params] = useSearchParams();
  const focusId = params.get('evento');
  const [tab, setTab] = useState(null);
  const [creating, setCreating] = useState(false);
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* sem localStorage */ } };
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  const groups = useMemo(() => {
    const by = { ACTIVE: [], UPCOMING: [], ENDED: [] };
    for (const ev of events || []) (by[ev.status] || by.UPCOMING).push(ev);
    by.UPCOMING.sort((a, b) => new Date(a.startsAt || a.createdAt) - new Date(b.startsAt || b.createdAt));
    return by;
  }, [events]);
  // Abre na primeira aba que tem algo (prioridade: acontecendo agora).
  // Link direto pra um evento abre na aba dele.
  const focusTab = focusId ? (events || []).find((e) => e.id === focusId)?.status : null;
  const activeTab = tab || (focusTab && groups[focusTab] ? focusTab : null) || TABS.find((t) => groups[t.key].length > 0)?.key || 'UPCOMING';
  const list = groups[activeTab];

  return (
    <div className="cx-page">
      <div className="cx-inner">
        <header className="cx-hero cx-hero-eventos">
          <span className="cx-hero-icon"><FeaturedGlyph name="calendar" size={26} /></span>
          <div className="cx-hero-text">
            <span className="cx-eyebrow">Canal em destaque</span>
            <h1>Eventos</h1>
            <p>Campeonatos, encontros e novidades da comunidade. Fique de olho para não perder nada.</p>
          </div>
          {isStaff && (
            <div className="cx-hero-actions">
              <button type="button" className="cx-btn primary" onClick={() => setCreating((v) => !v)}>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                Criar evento
              </button>
              <button type="button" className="cx-btn ghost" onClick={() => navigate('/admin?tab=events')}>Gerenciar</button>
            </div>
          )}
        </header>

        {creating && <QuickCreate onClose={() => setCreating(false)} onCreated={reload} />}

        <div className="cxe-viewbar">
          <div className="cxe-view-toggle" role="group" aria-label="Modo de visualização">
            <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><CalIcon d={ICON_LIST} /> Lista</button>
            <button type="button" className={view === 'calendar' ? 'active' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><CalIcon d={ICON_CAL} /> Calendário</button>
          </div>
        </div>

        {view === 'calendar' && (events === null
          ? <div className="cx-skeleton cxe-cal-skel" />
          : <EventsCalendar events={events} now={now} focusId={focusId} onRsvp={(id, rsvp) => patchEvent(id, { rsvp })} />)}

        {view === 'list' && (<>
        <div className="cx-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
              className={`cx-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}
            >
              {t.key === 'ACTIVE' && <span className="cev-pulse small" aria-hidden="true" />}
              {t.label}
              <span className="cx-tab-count">{events ? groups[t.key].length : '–'}</span>
            </button>
          ))}
        </div>

        {events === null && (
          <div className="cev-grid">
            {[0, 1, 2].map((i) => <div key={i} className="cx-skeleton cev-skeleton" />)}
          </div>
        )}
        {events !== null && list.length === 0 && (
          <div className="cx-empty">
            <span className="cx-empty-icon"><FeaturedGlyph name="calendar" size={26} /></span>
            <h3>{activeTab === 'ACTIVE' ? 'Nada acontecendo agora' : activeTab === 'UPCOMING' ? 'Nenhum evento marcado' : 'Nenhum evento encerrado'}</h3>
            <p>{isStaff ? 'Crie um evento para movimentar a comunidade.' : 'Quando a equipe marcar um evento, ele aparece aqui.'}</p>
          </div>
        )}
        {events !== null && list.length > 0 && (
          <div className="cev-grid">
            {list.map((ev) => (
              <EventCard key={ev.id} ev={ev} now={now} highlighted={ev.id === focusId} onRsvp={(id, rsvp) => patchEvent(id, { rsvp })} />
            ))}
          </div>
        )}
        </>)}
      </div>
    </div>
  );
}
