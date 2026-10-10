import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { createEvent } from '../api/endpoints';
import { useCommunityEvents } from '../utils/useCommunityEvents';
import { FeaturedGlyph } from '../components/FeaturedChannels.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/channels.css';
import EventRsvp from '../components/EventRsvp.jsx';
import '../styles/socialx.css';

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
  const { user } = useAuth();
  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  const { events, reload, patchEvent } = useCommunityEvents();
  const [params] = useSearchParams();
  const focusId = params.get('evento');
  const [tab, setTab] = useState(null);
  const [creating, setCreating] = useState(false);
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
      </div>
    </div>
  );
}
