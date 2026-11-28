import { useEffect, useMemo, useRef, useState } from 'react';
import UserProfileModal from '../modals/UserProfileModal.jsx';
import MiniProfileCard from '../MiniProfileCard.jsx';
import '../../styles/profile-editor.css';

// Editor de perfil (estilo Discord): à esquerda os controles (os mesmos de
// antes, que salvam sozinhos), à direita a prévia AO VIVO do perfil completo
// ou do miniperfil, já com o que está sendo digitado. Aberto pelo botão
// "Editar perfil" do seu perfil, do miniperfil ou da sua foto lá embaixo.
// O conteúdo (children) e o estado vêm do UserSettingsModal em mode="profile".
const SECTIONS = [
  { id: 'PROFILE', label: 'Perfil e miniperfil', hint: 'Foto, banner, nome, bio, cores e conexões' },
  { id: 'PROFILE_CONTENT', label: 'Conteúdo do perfil', hint: 'Conquistas em destaque, álbum e enquetes' },
  { id: 'COLUMNS', label: 'Ordem das seções', hint: 'O que aparece no perfil completo e em que ordem' },
];

export default function ProfileEditorFrame({ user, form, tab, setTab, onClose, savePill, children }) {
  const [view, setView] = useState('full'); // 'full' | 'mini'
  const [menuOpen, setMenuOpen] = useState(false);
  const [sideHidden, setSideHidden] = useState(false);
  const menuRef = useRef(null);
  // O usuário salvo + o que ainda está no formulário (salva sozinho em ~1s).
  const previewUser = useMemo(() => ({ ...user, ...form }), [user, form]);
  const current = SECTIONS.find((x) => x.id === tab) || SECTIONS[0];

  // Esc fecha (se não tiver outra janela por cima, ex.: recorte de imagem).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menuOpen) { setMenuOpen(false); return; }
      if (document.querySelector('.modal-overlay:not(.pf-embedded)')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, menuOpen]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <div className="pe-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`pe-box${sideHidden ? ' is-side-hidden' : ''}`} role="dialog" aria-modal="true" aria-label="Editar perfil">
        <aside className="pe-side" aria-label="Opções do perfil">
          <div className="pe-side-head">
            <div className="pe-section-pick" ref={menuRef}>
              <button type="button" className="pe-section-btn" aria-haspopup="listbox" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
                <span>{current.label}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {menuOpen && (
                <div className="pe-section-menu" role="listbox" aria-label="Parte do perfil">
                  {SECTIONS.map((x) => (
                    <button
                      key={x.id} type="button" role="option" aria-selected={x.id === tab}
                      className={`pe-section-item${x.id === tab ? ' is-current' : ''}`}
                      onClick={() => { setTab(x.id); setMenuOpen(false); }}
                    >
                      <strong>{x.label}</strong>
                      <small>{x.hint}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="pe-save">{savePill}</span>
            <button type="button" className="pe-icon-btn" onClick={() => setSideHidden(true)} title="Esconder opções" aria-label="Esconder opções">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13 17 5-5-5-5M6 17l5-5-5-5" /></svg>
            </button>
          </div>
          <div className="pe-side-body">{children}</div>
        </aside>

        <section className="pe-preview" aria-label="Prévia do perfil">
          <div className="pe-preview-bar">
            {sideHidden && (
              <button type="button" className="pe-icon-btn" onClick={() => setSideHidden(false)} title="Mostrar opções" aria-label="Mostrar opções">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5" /></svg>
              </button>
            )}
            <div className="pe-view-toggle" role="tablist" aria-label="O que mostrar na prévia">
              <button type="button" role="tab" aria-selected={view === 'full'} className={view === 'full' ? 'is-on' : ''} onClick={() => setView('full')}>Perfil completo</button>
              <button type="button" role="tab" aria-selected={view === 'mini'} className={view === 'mini' ? 'is-on' : ''} onClick={() => setView('mini')}>Miniperfil</button>
            </div>
            <span className="pe-preview-note">Prévia ao vivo · salva sozinho</span>
          </div>
          <div className="pe-stage">
            {view === 'full' ? (
              <div className="pe-full"><UserProfileModal embedded previewUser={previewUser} /></div>
            ) : (
              <div className="pe-mini"><MiniProfileCard preview={previewUser} /></div>
            )}
          </div>
        </section>

        <button type="button" className="pe-close" onClick={onClose} aria-label="Fechar editor de perfil" title="Fechar (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </div>
  );
}
