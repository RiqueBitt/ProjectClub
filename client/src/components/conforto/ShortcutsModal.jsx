import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUT_GROUPS, keyLabel } from './shortcuts';
import { useFocusTrap } from './useFocusTrap';
import { getVoicePref } from '../../utils/voicePrefs';

// Tela "Atalhos de teclado" (Ctrl+/ ou ?). Diálogo modal acessível, com
// filtro por texto.
function Keys({ keys, pttKey }) {
  return (
    <span className="pc-keys">
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="pc-keys-part">
          {i > 0 && <span className="pc-keys-plus" aria-hidden="true">+</span>}
          <kbd>{keyLabel(k, { pttKey })}</kbd>
        </span>
      ))}
    </span>
  );
}

export default function ShortcutsModal({ onClose }) {
  const boxRef = useRef(null);
  const [q, setQ] = useState('');
  useFocusTrap(boxRef, { active: true, onEscape: onClose, initialFocus: '.pc-sc-search' });
  const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI;
  const pttKey = getVoicePref('pushToTalkKey') || 'Space';

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SHORTCUT_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) => (!it.desktopOnly || isDesktopApp)
        && (!needle || `${g.title} ${it.label} ${it.keys.join(' ')}`.toLowerCase().includes(needle))),
    })).filter((g) => g.items.length);
  }, [q, isDesktopApp]);

  return createPortal(
    <div className="pc-sc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className="pc-sc" role="dialog" aria-modal="true" aria-labelledby="pc-sc-title">
        <header className="pc-sc-head">
          <h2 id="pc-sc-title">Atalhos de teclado</h2>
          <button type="button" className="pc-icon-btn" onClick={onClose} aria-label="Fechar atalhos">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
          </button>
        </header>
        <input
          className="pc-sc-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar atalhos" aria-label="Filtrar atalhos"
        />
        <div className="pc-sc-body">
          {groups.length === 0 && <p className="pc-sc-empty">Nenhum atalho com “{q}”.</p>}
          {groups.map((g) => (
            <section key={g.id} className="pc-sc-group" aria-labelledby={`pc-sc-g-${g.id}`}>
              <h3 id={`pc-sc-g-${g.id}`}>{g.title}</h3>
              <ul role="list">
                {g.items.map((it) => (
                  <li key={it.id} className="pc-sc-row">
                    <span className="pc-sc-label">{it.label}</span>
                    <span className="pc-sc-combo">
                      <Keys keys={it.keys} pttKey={pttKey} />
                      {it.alt && <><span className="pc-sc-or">ou</span><Keys keys={it.alt} pttKey={pttKey} /></>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className="pc-sc-foot">Atalhos não funcionam enquanto uma janela como esta estiver aberta. No Mac, use ⌘ no lugar de Ctrl.</footer>
      </div>
    </div>,
    document.body,
  );
}
