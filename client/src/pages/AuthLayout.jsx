import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';
import { ArrowLeftIcon } from '../components/auth/AuthIcons.jsx';

const isNativeApp = () =>
  typeof window !== 'undefined' && (!!window.electronAPI || !!window.Capacitor?.isNativePlatform?.());

// Moldura de TODAS as telas de autenticação (login, inscrição, senha,
// verificação). No PC: vitrine da comunidade à esquerda + formulário à
// direita. No celular/tablet: uma coluna, marca compacta no topo.
//
// Correções de layout que moram aqui:
// - A tela é o próprio container de rolagem (position:fixed + overflow),
//   em vez de depender de body/#root rolarem. Antes, no app desktop, o
//   formulário ficava dentro de .app-routes-container (overflow:hidden,
//   abaixo da barra de título) e a parte de baixo da inscrição ficava
//   inalcançável.
// - html.auth-no-zoom agora existe de verdade no CSS (ver global.css):
//   o zoom 1.2 do PC não é aplicado nessas telas.
export default function AuthLayout({ title, subtitle, children, footer, wide = false, showcase = true }) {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('auth-no-zoom');
    return () => html.classList.remove('auth-no-zoom');
  }, []);

  const native = isNativeApp();

  return (
    <div className={`pc-auth${wide ? ' pc-auth-wide' : ''}${showcase ? '' : ' pc-auth-solo'}`}>
      <div className="pc-auth-glow" aria-hidden="true" />

      {showcase && (
        <aside className="pc-auth-showcase" aria-hidden="true">
          <div className="pc-brand">
            <img src={logo} alt="" className="pc-brand-mark" />
            <span>Project Club</span>
          </div>

          <div className="pc-showcase-copy">
            <h2>O seu clubinho no coração da internet.</h2>
            <p>Chat, voz, feeds, casas e figurinhas, numa comunidade só.</p>
          </div>

          <div className="pc-preview">
            <div className="pc-preview-bar">
              <span /><span /><span />
              <b># geral</b>
            </div>
            <div className="pc-preview-body">
              <div className="pc-msg"><i className="a1" /><div><b>Lia</b><p>alguém pra call hoje à noite?</p></div></div>
              <div className="pc-msg"><i className="a2" /><div><b>Rafa</b><p>bora! abro a sala de voz às 21h</p></div></div>
              <div className="pc-msg"><i className="a3" /><div><b>Nico</b><p>terminei o álbum de figurinhas!</p></div></div>
              <div className="pc-preview-voice"><span className="pc-live-dot" /> Sala de voz · 3 conectados</div>
            </div>
          </div>
        </aside>
      )}

      <main className="pc-auth-main">
        <div className="pc-auth-top">
          <div className="pc-brand pc-brand-compact">
            <img src={logo} alt="" className="pc-brand-mark" />
            <span>Project Club</span>
          </div>
          {!native && (
            <Link to="/" className="pc-back"><ArrowLeftIcon width={16} height={16} /> Início</Link>
          )}
        </div>

        <section className="pc-auth-panel" aria-labelledby="pc-auth-title">
          <header className="pc-auth-head">
            <h1 id="pc-auth-title">{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </header>
          {children}
          {footer && <footer className="pc-auth-foot">{footer}</footer>}
        </section>
      </main>
    </div>
  );
}
