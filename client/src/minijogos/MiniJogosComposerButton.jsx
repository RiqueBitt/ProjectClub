import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MINIJOGOS } from './catalog.js';

// Botão de Mini-Jogos na barra de digitação (do lado do emoji): abre uma
// grade com os jogos; clicar abre o jogo direto no player.
export default function MiniJogosComposerButton() {
  const [open, setOpen] = useState(false);
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
  const games = [...MINIJOGOS].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  return (
    <div className="mj-composer" ref={ref}>
      <button type="button" className={`icon-btn chat-composer-btn ${open ? 'on' : ''}`} title="Mini-Jogos" aria-label="Mini-Jogos" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><circle cx="17" cy="7.2" r="3.3" /><path d="M7.2 13.5l3.3 5.7H4z" /><path d="M17 13.5l3.4 3.4-3.4 3.4-3.4-3.4z" />
        </svg>
      </button>
      {open && (
        <div className="mj-composer-pop" role="dialog" aria-label="Mini-Jogos">
          <div className="mj-composer-head"><strong>Mini-Jogos</strong><button type="button" onClick={() => { setOpen(false); navigate('/minijogos'); }}>Ver todos</button></div>
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
