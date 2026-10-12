import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import logo from '../../assets/icons/logo-project-club.png';

// Topo e rodapé das páginas públicas (início, blog e termos). Tudo vive
// dentro de um contêiner .lp, que é quem rola (não a janela).
//
// Na página inicial os itens Apps/Comunidade/Download/Perguntas são
// âncoras da própria página; nas outras viram links para "/#secao" (a
// LandingPage rola até a seção quando abre com o hash).

const SECTIONS = [
  { id: 'apps', label: 'Apps' },
  { id: 'comunidade', label: 'Comunidade' },
  { id: 'download', label: 'Download' },
  { id: 'perguntas', label: 'Perguntas' },
];
const PAGES = [
  { to: '/blog', label: 'Blog', key: 'blog' },
  { to: '/termos', label: 'Termos de privacidade', key: 'termos' },
];

// Topo com vidro depois de rolar + barra de progresso.
export function usePublicScrollChrome() {
  useEffect(() => {
    const root = document.querySelector('.lp');
    if (!root) return undefined;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = root.scrollHeight - root.clientHeight;
        root.style.setProperty('--progress', max > 0 ? (root.scrollTop / max).toFixed(4) : '0');
        root.classList.toggle('is-scrolled', root.scrollTop > 24);
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, []);
}

function SectionLink({ id, label, onLanding, onClick }) {
  if (onLanding) return <a href={`#${id}`} onClick={onClick}>{label}</a>;
  return <Link to={`/#${id}`} onClick={onClick}>{label}</Link>;
}

// page: 'inicio' | 'blog' | 'termos' (marca o item atual)
// onSearch: quando existe, mostra o botão "Buscar" (Ctrl K)
export function PublicHeader({ page = 'inicio', onSearch, searchLabel = 'Buscar' }) {
  const navigate = useNavigate();
  const onLanding = page === 'inicio';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);
  const toTop = (e) => {
    if (!onLanding) return;
    e.preventDefault();
    document.querySelector('.lp')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header className={`lp-top ${open ? 'is-menu-open' : ''}`}>
      <Link className="lp-logo" to="/" onClick={toTop} aria-label="Project Club, início">
        <img src={logo} alt="" width="34" height="34" />
      </Link>
      <nav className="lp-menu" aria-label="Seções">
        {SECTIONS.map((s) => <SectionLink key={s.id} {...s} onLanding={onLanding} />)}
        {PAGES.map((p) => (
          <Link key={p.key} to={p.to} aria-current={page === p.key ? 'page' : undefined} className={page === p.key ? 'is-current' : ''}>{p.label}</Link>
        ))}
      </nav>
      <div className="lp-top-actions">
        {onSearch && (
          <button type="button" className="lp-search" onClick={onSearch} aria-label={`${searchLabel} (Ctrl+K)`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" /></svg>
            <span>{searchLabel}</span><kbd>Ctrl K</kbd>
          </button>
        )}
        <button type="button" className="lp-link" onClick={() => navigate('/login')}>Entrar</button>
        <button type="button" className="lp-btn is-accent is-sm" onClick={() => navigate('/register')}>Criar conta</button>
        <button
          type="button" className="lp-burger" aria-expanded={open} aria-controls="lp-sheet"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true" /><span aria-hidden="true" />
        </button>
      </div>
      {open && (
        <nav id="lp-sheet" className="lp-sheet" aria-label="Menu">
          {SECTIONS.map((s) => <SectionLink key={s.id} {...s} onLanding={onLanding} onClick={close} />)}
          {PAGES.map((p) => (
            <Link key={p.key} to={p.to} onClick={close} aria-current={page === p.key ? 'page' : undefined}>{p.label}</Link>
          ))}
          <Link to="/login" onClick={close} className="lp-sheet-login">Entrar</Link>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter({ page = 'inicio' }) {
  const onLanding = page === 'inicio';
  const year = new Date().getFullYear();
  const toTop = (e) => { e.preventDefault(); document.querySelector('.lp')?.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <footer className="lp-foot">
      <div className="lp-foot-brand">
        <img src={logo} alt="" width="28" height="28" />
        <span>Project Club</span>
        <small>Comunidade e apps de criação, feitos pela comunidade.</small>
      </div>
      <nav className="lp-foot-nav" aria-label="Rodapé">
        {SECTIONS.map((s) => <SectionLink key={s.id} {...s} onLanding={onLanding} />)}
        <Link to="/blog">Blog</Link>
        <Link to="/termos">Termos de privacidade</Link>
        <a href="https://github.com/RiqueBitt/ProjectClub" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div className="lp-foot-meta">
        <span>© {year} Project Club</span>
        <a href="#" onClick={toTop}>Voltar ao topo</a>
      </div>
    </footer>
  );
}
