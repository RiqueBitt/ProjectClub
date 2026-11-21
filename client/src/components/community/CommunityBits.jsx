import { useEffect, useState } from 'react';
import { Ico } from '../PagesKit.jsx';
import '../../styles/community4.css';

// Peças pequenas compartilhadas pelas telas da Fase 4 (comunidade e economia).

export const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');

// "3d 4h" / "2h 10min" / "5min" até `target` (atualiza a cada 30s).
export function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (!(ms > 0)) return 'agora';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}min` : `${Math.max(1, m)}min`;
}

export function Countdown({ to, prefix = 'termina em' }) {
  const left = useCountdown(to);
  if (!left) return null;
  return <span className="c4-countdown"><Ico name="clock" size={14} /> {prefix} {left}</span>;
}

export function ProgressBar({ value = 0, max = 100, label, tone = 'brand' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  return (
    <div className={`c4-bar tone-${tone}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// Aviso rápido (some sozinho). Devolve [elemento, mostrar(texto, tipo)].
export function useFlash() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 3800);
    return () => clearTimeout(t);
  }, [msg]);
  const el = msg ? <div className={`c4-flash ${msg.tone}`} role="status">{msg.text}</div> : null;
  return [el, (text, tone = 'ok') => setMsg({ text, tone })];
}

// Janela simples (Esc ou clique fora fecha).
export function Dialog({ title, onClose, children, footer, width = 440 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="pk-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="c4-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <header className="c4-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="c4-icon-btn" onClick={onClose} aria-label="Fechar"><Ico name="close" size={18} /></button>
        </header>
        <div className="c4-dialog-body">{children}</div>
        {footer && <footer className="c4-dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function SectionCard({ icon, title, aside, children, className = '' }) {
  return (
    <section className={`pk-card c4-card ${className}`}>
      <header className="c4-card-head">
        <h3 className="pk-section-title">{icon && <Ico name={icon} size={18} />} {title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
