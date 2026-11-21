import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MINIJOGOS } from './catalog.js';

// Botão "Atividades" na barra de digitação (do lado do emoji): ações
// rápidas — "Mostrar cartão" manda o cartão da carteira no chat — e a
// grade dos Mini-Jogos (clicar abre o jogo direto no player).
export default function MiniJogosComposerButton({ onShowCard }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (!open) setError(''); }, [open]);
  const games = [...MINIJOGOS].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));

  const showCard = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onShowCard(); setOpen(false); } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível mostrar o cartão.');
    } finally { setBusy(false); }
  };

  return (
    <div className="mj-composer" ref={ref}>
      <button type="button" className={`icon-btn chat-composer-btn ${open ? 'on' : ''}`} title="Atividades" aria-label="Atividades" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><circle cx="17" cy="7.2" r="3.3" /><path d="M7.2 13.5l3.3 5.7H4z" /><path d="M17 13.5l3.4 3.4-3.4 3.4-3.4-3.4z" />
        </svg>
      </button>
      {open && (
        <div className="mj-composer-pop" role="dialog" aria-label="Atividades">
          <div className="mj-composer-head"><strong>Atividades</strong></div>
          {onShowCard && (
            <div className="mj-composer-actions">
              <button type="button" className="mj-composer-action" onClick={showCard} disabled={busy}>
                <span className="mj-composer-action-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></svg>
                </span>
                <span className="mj-composer-action-text">
                  <strong>{busy ? 'Mostrando…' : 'Mostrar cartão'}</strong>
                  <small>Manda o seu cartão da carteira no chat</small>
                </span>
              </button>
              {error && <p className="mj-composer-error">{error}</p>}
            </div>
          )}
          <div className="mj-composer-head mj-composer-sub"><strong>Mini-Jogos</strong><button type="button" onClick={() => { setOpen(false); navigate('/minijogos'); }}>Ver todos</button></div>
          <div className="mj-composer-grid">
            {games.map((g) => (
              <button key={g.slug} type="button" className="mj-composer-game" title={g.name} onClick={() => { setOpen(false); navigate(`/minijogos?jogo=${g.slug}`); }}>
                <img src={g.icon} alt="" loading="lazy" draggable="false" />
                <span>{g.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
