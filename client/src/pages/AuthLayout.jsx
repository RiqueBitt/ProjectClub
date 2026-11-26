import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';
import { ArrowLeftIcon } from '../components/auth/AuthIcons.jsx';
import AuthCharacters from '../components/auth/AuthCharacters.jsx';
import { useIconStunts, playIconStunt } from '../components/auth/iconStunts.js';
import '../styles/auth-mono.css';

const SHOWCASE_APPS = ['gameproject', 'photoproject', 'projectmc', 'hyproject', 'davinciproject', 'waveproject', 'texelproject', 'forgeproject', 'canvasproject'];
// Mesma faixa e mesma frase do site de download (LandingPage, .lp-mono).
const MARQUEE = ['Chat', 'Voz', 'Fórum', 'Mods', 'RPG'];
const STATEMENT = 'Comunidade, mods e RPG. De graça.';

// Nome com as letras subindo de dentro de uma máscara (igual ao site).
function Wordmark({ text, offset = 0 }) {
  return (
    <span className="pc-wm-line">
      {[...text].map((ch, i) => (
        <span key={i} className="pc-wm-mask"><span className="pc-wm-ch" style={{ '--i': i + offset }}>{ch}</span></span>
      ))}
    </span>
  );
}

const isNativeApp = () =>
  typeof window !== 'undefined' && (!!window.electronAPI || !!window.Capacitor?.isNativePlatform?.());

// A turma de bonequinhos fica na vitrine (PC) ou em cima do formulário
// (celular) — uma instância só, no lugar certo pra largura atual.
const WIDE_QUERY = '(min-width: 1024px)';
function useIsWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return undefined;
    const update = () => setWide(mq.matches);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return wide;
}

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
// characters: mostra a turminha (AuthCharacters). reaction: { type:
// 'error' | 'success', key } pra eles reagirem ao resultado do formulário.
export default function AuthLayout({ title, subtitle, children, footer, wide = false, showcase = true, characters = true, reaction = null }) {
  const appsRef = useIconStunts();
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('auth-no-zoom');
    return () => html.classList.remove('auth-no-zoom');
  }, []);

  const native = isNativeApp();
  const isWide = useIsWide();
  const charsInShowcase = characters && showcase && isWide;
  const charsAboveForm = characters && !charsInShowcase;

  return (
    <div className={`pc-auth pc-auth-mono${wide ? ' pc-auth-wide' : ''}${showcase ? '' : ' pc-auth-solo'}`}>
      <div className="pc-auth-glow" aria-hidden="true" />
      {/* O grão é maior que a tela (pra poder "tremer"); a moldura recorta,
          senão ele aumentava a área rolável do <body> e qualquer rolagem
          por código (scrollIntoView, foco) empurrava a tela pro lado. */}
      <div className="pc-auth-grain-clip" aria-hidden="true"><div className="pc-auth-grain" /></div>

      {showcase && (
        <aside className={`pc-auth-showcase${charsInShowcase ? ' pc-auth-showcase-chars' : ''}`} aria-hidden="true">
          <div className="pc-brand">
            <img src={logo} alt="" className="pc-brand-mark" />
            <span>Project Club</span>
          </div>

          {charsInShowcase && (
            <div className="pc-showcase-chars"><AuthCharacters reaction={reaction} /></div>
          )}

          <div className="pc-showcase-copy">
            <h2 className="pc-showcase-title" aria-label="Project Club">
              <Wordmark text="Project" />
              <Wordmark text="Club" offset={7} />
            </h2>
            <p className="pc-statement" aria-label={STATEMENT}>
              {STATEMENT.split(' ').map((w, i) => <span key={i} aria-hidden="true" style={{ '--i': i }}>{w} </span>)}
            </p>
          </div>

          <div className="pc-showcase-apps" ref={appsRef}>
            {SHOWCASE_APPS.map((id, i) => (
              <img key={id} src={`/apps/${id}/icon.png`} alt="" style={{ '--i': i }} loading="lazy" data-app={id} onPointerEnter={(e) => playIconStunt(e.currentTarget)} />
            ))}
          </div>

          <div className="pc-marquee">
            {[false, true].map((rev) => (
              <div key={String(rev)} className={`pc-marquee-row${rev ? ' is-rev' : ''}`}>
                {[0, 1].map((k) => (
                  <span key={k} className="pc-marquee-track">
                    {MARQUEE.map((w) => <span key={w} className="pc-marquee-item">{w}<i>✳</i></span>)}
                  </span>
                ))}
              </div>
            ))}
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
          {/* Celular/tablet: a turma fica à direita, no mesmo "chão" da
              linha "▶ project club" do cabeçalho. */}
          {charsAboveForm && <AuthCharacters reaction={reaction} className="pc-auth-chars-mobile" align="right" />}
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
