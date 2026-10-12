import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';
import { ArrowLeftIcon } from '../components/auth/AuthIcons.jsx';

const SHOWCASE_APPS = ['gameproject', 'photoproject', 'projectmc', 'hyproject', 'davinciproject', 'waveproject', 'texelproject', 'forgeproject', 'canvasproject'];
const TICKER = ['Chat e voz', 'Fórum', 'Conquistas', 'Jogos', 'Imagem', 'Vídeo', 'Áudio', '3D'];

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
      <div className="pc-auth-grain" aria-hidden="true" />

      {showcase && (
        <aside className="pc-auth-showcase" aria-hidden="true">
          <div className="pc-brand">
            <img src={logo} alt="" className="pc-brand-mark" />
            <span>Project Club</span>
          </div>

          <div className="pc-showcase-copy">
            <span className="pc-eyebrow">▶ comunidade · apps · grátis</span>
            <h2 className="pc-showcase-title" aria-label="Project Club">
              {['Project', 'Club'].map((w, wi) => (
                <span key={w} className="pc-word">
                  {[...w].map((ch, i) => <span key={i} className="pc-char" style={{ '--d': `${wi * 360 + i * 45}ms` }}>{ch}</span>)}
                </span>
              ))}
            </h2>
            <p>Chat, voz, fórum, conquistas e nove programas de criação, numa conta só.</p>
          </div>

          <div className="pc-showcase-apps">
            {SHOWCASE_APPS.map((id, i) => (
              <img key={id} src={`/apps/${id}/icon.png`} alt="" style={{ '--i': i }} loading="lazy" />
            ))}
          </div>

          <div className="pc-ticker">
            <div className="pc-ticker-track">
              {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}<i>✦</i></span>)}
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
