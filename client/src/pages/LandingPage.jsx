import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';
import dlWindowsBlack from '../assets/icons/dl-windows-black.png';
import dlWindowsWhite from '../assets/icons/dl-windows-white.png';
import dlLinuxWhite from '../assets/icons/dl-linux-white.png';
import dlAndroidWhite from '../assets/icons/dl-android-white.png';
import dlNavegadorWhite from '../assets/icons/dl-navegador-white.png';
import dlMenuBlack from '../assets/icons/dl-menu-black.png';
import { Ico } from '../components/PagesKit.jsx';
import '../styles/landing.css';

// Página inicial pública — hero + janela de prévia + como funciona +
// recursos + sobre + estatísticas + download + CTA final + rodapé.
// Revelação suave ao rolar (useReveal abaixo) é a única animação além
// do fundo ambiente já existente — desligada de propósito se a pessoa
// tiver "reduzir movimento" ativado no sistema.
function useReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = document.querySelectorAll('.landing-reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in-view'); });
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// Publicados como assets de uma GitHub Release no repositório PÚBLICO
// separado ProjectClub-Downloads (sem nenhum código-fonte dentro, só os
// instaladores) — o repositório principal continua privado. O GitHub
// Actions do repositório principal (.github/workflows/build-apps.yml)
// publica ali automaticamente sempre que desktop/ ou client/android/
// mudam. "releases/latest/download/<nome>" é um link ESTÁVEL do próprio
// GitHub — sempre baixa o arquivo daquele nome da versão mais recente
// publicada, sem precisar saber o número da versão.
const DOWNLOADS_BASE = 'https://github.com/RiqueBitt/ProjectClub-Downloads/releases/latest/download';
const WINDOWS_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub-Setup-Windows.exe`;
const LINUX_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub-Linux.AppImage`;
const ANDROID_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub.apk`;

export default function LandingPage() {
  const navigate = useNavigate();
  useReveal();
  // Menuzinho de plataforma (item pedido) — igual o botão de download do
  // Discord: o botão principal já baixa a opção mais comum (Windows)
  // direto, e uma setinha do lado abre um menu pra escolher Linux/Mobile
  // em vez disso.
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  useEffect(() => {
    if (!platformMenuOpen) return;
    const closeOnOutsideClick = (e) => {
      if (!e.target.closest('.landing-download-split')) setPlatformMenuOpen(false);
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, [platformMenuOpen]);

  const goLogin = () => navigate('/login');
  const goRegister = () => navigate('/register');
  // A própria página é o container que rola (.lp), não a janela.
  const toTop = (e) => {
    e.preventDefault();
    document.querySelector('.lp')?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true"><span className="lp-orb o1" /><span className="lp-orb o2" /><span className="lp-grid" /></div>

      <nav className="lp-nav">
        <a className="lp-brand" href="#" onClick={toTop}>
          <img className="lp-brand-mark" src={logo} alt="" /><span>PROJECT CLUB</span>
        </a>
        <ul className="lp-nav-links">
          <li><a href="#" onClick={toTop}>Início</a></li>
          <li><a href="#como-funciona">Como funciona</a></li>
          <li><a href="#recursos">Recursos</a></li>
          <li><a href="#sobre">Sobre</a></li>
          <li><a href="#faq">FAQ</a></li>
          <li><a href="#download">Download</a></li>
        </ul>
        <div className="lp-nav-actions">
          <button className="lp-btn ghost sm" onClick={goLogin}>Entrar</button>
          <button className="lp-btn primary sm" onClick={goRegister}>Criar conta</button>
        </div>
      </nav>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow"><span className="lp-live-dot" /> Comunidade ativa agora</span>
            <h1>
              Um jeito mais <span className="lp-grad">conectado</span> de fazer parte de algo
            </h1>
            <p className="lp-sub">
              Chat em tempo real, canais de voz, Feeds com Temas e categorias, conquistas, economia e muito mais —
              tudo numa comunidade só, sem enrolação.
            </p>
            <div className="lp-cta-row">
              <button className="lp-btn primary lg" onClick={goRegister}>Criar conta grátis <Ico name="arrowRight" size={18} /></button>
              <button className="lp-btn ghost lg" onClick={goLogin}>
                <img className="lp-btn-img" src={dlNavegadorWhite} alt="" /> Entrar pelo navegador
              </button>
            </div>
            <div className="lp-download-row">
              <div className="landing-download-split lp-split">
                <a className="lp-split-main" href={WINDOWS_DOWNLOAD_URL} download>
                  <img className="lp-btn-img" src={dlWindowsBlack} alt="" /> Download App
                </a>
                <button
                  type="button"
                  className="lp-split-caret"
                  aria-label="Escolher outra plataforma"
                  aria-expanded={platformMenuOpen}
                  onClick={() => setPlatformMenuOpen((v) => !v)}
                >
                  <img className="lp-btn-img sm" src={dlMenuBlack} alt="" />
                </button>
                {platformMenuOpen && (
                  <div className="lp-platform-menu" onMouseLeave={() => setPlatformMenuOpen(false)}>
                    <a href={WINDOWS_DOWNLOAD_URL} download className="lp-platform-menu-item">
                      <img src={dlWindowsWhite} alt="" /> Windows
                    </a>
                    <a href={ANDROID_DOWNLOAD_URL} download className="lp-platform-menu-item">
                      <img src={dlAndroidWhite} alt="" /> Mobile (Android)
                    </a>
                    <a href={LINUX_DOWNLOAD_URL} download className="lp-platform-menu-item">
                      <img src={dlLinuxWhite} alt="" /> Linux
                    </a>
                  </div>
                )}
              </div>
              <p className="lp-platform-note">Ou baixe direto: Windows, Linux ou Android · Grátis</p>
            </div>
            <div className="lp-trust">
              <span><Ico name="lock" size={15} /> Sem custo nenhum</span>
              <span><Ico name="bolt" size={15} /> Conta pronta em 1 minuto</span>
              <span><Ico name="globe" size={15} /> Comunidade ativa todo dia</span>
            </div>
          </div>

          <div className="lp-window landing-reveal" aria-hidden="true">
            <div className="lp-window-bar">
              <span className="lp-dot d1" /><span className="lp-dot d2" /><span className="lp-dot d3" />
              <span className="lp-window-title">Project Club — Comunidade</span>
            </div>
            <div className="lp-window-body">
              <div className="lp-window-side">
                <div className="lp-window-grp">Navegação</div>
                <div className="lp-window-item active"><Ico name="chat" size={15} /> Comunidade</div>
                <div className="lp-window-item"><Ico name="users" size={15} /> Amigos</div>
                <div className="lp-window-item"><Ico name="news" size={15} /> Feeds</div>
                <div className="lp-window-grp">Extras</div>
                <div className="lp-window-item"><Ico name="trophy" size={15} /> Conquistas</div>
                <div className="lp-window-item"><Ico name="star" size={15} /> Ranks</div>
                <div className="lp-window-item"><Ico name="bell" size={15} /> Atualizações</div>
              </div>
              <div className="lp-window-main">
                <div className="lp-window-grid">
                  {[
                    ['Chat Geral', 'Canal de texto', 'hash'], ['Sala de Voz', 'Canal de voz', 'volume'], ['Discussão', 'Categoria de Feed', 'news'],
                    ['Veterano', 'Conquista · Rara', 'trophy'], ['Ranks', 'Nível de conta', 'star'], ['Temas', 'Organização de posts', 'grid'],
                  ].map(([name, meta, icon], i) => (
                    <div key={name} className={`lp-window-card c${i}`}>
                      <div className="lp-window-thumb"><Ico name={icon} size={22} /></div>
                      <div className="lp-window-card-name">{name}</div>
                      <div className="lp-window-card-meta">{meta}</div>
                    </div>
                  ))}
                </div>
                <div className="lp-window-online">
                  <span className="lp-live-dot" /> 3 pessoas online agora
                  <span className="lp-online-avatars"><i /><i /><i /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-stats landing-reveal">
          <div className="lp-stat"><div className="lp-stat-num">∞</div><div className="lp-stat-label">Canais e categorias</div></div>
          <div className="lp-stat"><div className="lp-stat-num">100%</div><div className="lp-stat-label">Tempo real</div></div>
          <div className="lp-stat"><div className="lp-stat-num">18</div><div className="lp-stat-label">Conquistas pra desbloquear</div></div>
          <div className="lp-stat"><div className="lp-stat-num">24/7</div><div className="lp-stat-label">Comunidade ativa</div></div>
        </div>

        <section id="como-funciona" className="lp-section">
          <div className="lp-head">
            <div className="lp-tag">Como funciona</div>
            <h2>Três passos e você já está dentro</h2>
            <p>Sem formulário complicado, sem enrolação — comece a participar em minutos.</p>
          </div>
          <div className="lp-steps">
            <div className="lp-step landing-reveal">
              <div className="lp-step-num">01</div>
              <h3>Crie sua conta</h3>
              <p>Cadastro rápido, direto pelo navegador — sem precisar instalar nada.</p>
            </div>
            <div className="lp-step landing-reveal">
              <div className="lp-step-num">02</div>
              <h3>Explore os Temas</h3>
              <p>Entre nos canais de chat e voz, e navegue pelos Temas e categorias do Feed.</p>
            </div>
            <div className="lp-step landing-reveal">
              <div className="lp-step-num">03</div>
              <h3>Participe em tempo real</h3>
              <p>Converse, publique posts, desbloqueie conquistas — tudo atualiza na hora pra todo mundo.</p>
            </div>
          </div>
        </section>

        <section id="recursos" className="lp-section">
          <div className="lp-head">
            <div className="lp-tag">Recursos</div>
            <h2>Tudo que uma comunidade precisa, num lugar só</h2>
            <p>Chat, voz, feed de posts e sistema de conquistas — pensado pra quem quer mais que só um grupo.</p>
          </div>
          <div className="lp-feat-grid">
            <div className="lp-feat landing-reveal" style={{ '--c': '#4c9fff' }}><div className="lp-feat-icon"><Ico name="volume" size={22} /></div><h3>Chat e canais de voz</h3><p>Conversa em tempo real por texto ou voz, com canais organizados por categoria.</p></div>
            <div className="lp-feat landing-reveal" style={{ '--c': '#a37cff' }}><div className="lp-feat-icon"><Ico name="news" size={22} /></div><h3>Feeds e Temas</h3><p>Publique posts organizados por Tema e categoria — discussão, dúvida, notícia e mais.</p></div>
            <div className="lp-feat landing-reveal" style={{ '--c': '#f0b232' }}><div className="lp-feat-icon"><Ico name="trophy" size={22} /></div><h3>Conquistas</h3><p>Desbloqueie conquistas conforme participa da comunidade, com raridades diferentes.</p></div>
            <div className="lp-feat landing-reveal" style={{ '--c': '#ff5c8a' }}><div className="lp-feat-icon"><Ico name="palette" size={22} /></div><h3>Perfil personalizado</h3><p>Cor de perfil, banner, conexões e conquistas em destaque — do seu jeito.</p></div>
            <div className="lp-feat landing-reveal" style={{ '--c': '#23a55a' }}><div className="lp-feat-icon"><Ico name="shield" size={22} /></div><h3>Amigos e privacidade</h3><p>Adicione amigos com controle total sobre quem pode te mandar pedido.</p></div>
            <div className="lp-feat landing-reveal" style={{ '--c': '#2fb8d6' }}><div className="lp-feat-icon"><Ico name="bolt" size={22} /></div><h3>Tempo real de verdade</h3><p>Tudo atualiza na hora pra todo mundo — sem precisar recarregar a página.</p></div>
          </div>
        </section>

        <section id="sobre" className="lp-section">
          <div className="lp-about landing-reveal">
            <div className="lp-tag">Sobre</div>
            <h2>Feito pra comunidade de verdade, não só pra mais um grupo</h2>
            <p>
              O Project Club nasceu de um jeito simples de pensar: uma comunidade não é só um monte de gente no
              mesmo lugar — é gente conversando, criando, e sendo reconhecida por isso. Por isso cada detalhe
              (dos canais de voz às conquistas que você desbloqueia) foi pensado pra fazer parte parecer mais
              com estar em casa do que com só mais uma aba aberta.
            </p>
          </div>
        </section>

        <section id="download" className="lp-section">
          <div className="lp-head">
            <div className="lp-tag">Download</div>
            <h2>Escolha como entrar</h2>
            <p>O jeito mais rápido é pelo navegador — os apps nativos ainda estão a caminho.</p>
          </div>
          <div className="lp-platforms">
            <button className="lp-platform landing-reveal featured" onClick={goLogin}>
              <span className="lp-platform-icon"><img src={dlNavegadorWhite} alt="" /></span>
              <span className="lp-platform-os">Navegador</span>
              <span className="lp-platform-fmt">Disponível agora</span>
            </button>
            <a className="lp-platform landing-reveal" href={WINDOWS_DOWNLOAD_URL} download>
              <span className="lp-platform-icon"><img src={dlWindowsWhite} alt="" /></span>
              <span className="lp-platform-os">Windows</span>
              <span className="lp-platform-fmt"><Ico name="download" size={14} /> Baixar .exe</span>
            </a>
            <a className="lp-platform landing-reveal" href={LINUX_DOWNLOAD_URL} download>
              <span className="lp-platform-icon"><img src={dlLinuxWhite} alt="" /></span>
              <span className="lp-platform-os">Linux</span>
              <span className="lp-platform-fmt"><Ico name="download" size={14} /> Baixar .AppImage</span>
            </a>
            <a className="lp-platform landing-reveal" href={ANDROID_DOWNLOAD_URL} download>
              <span className="lp-platform-icon"><img src={dlAndroidWhite} alt="" /></span>
              <span className="lp-platform-os">Android</span>
              <span className="lp-platform-fmt"><Ico name="download" size={14} /> Baixar .apk</span>
            </a>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-head">
            <div className="lp-tag">Perguntas frequentes</div>
            <h2>Ainda com dúvida?</h2>
          </div>
          <div className="lp-faq">
            <details className="lp-faq-item landing-reveal">
              <summary>Preciso pagar alguma coisa pra usar?<Ico name="plus" size={18} /></summary>
              <p>Não. Criar conta, entrar em Temas, usar chat e canais de voz é 100% gratuito — inclusive nos apps de Windows, Linux e Android.</p>
            </details>
            <details className="lp-faq-item landing-reveal">
              <summary>Funciona bem no celular?<Ico name="plus" size={18} /></summary>
              <p>Sim — pelo navegador do celular ou pelo app Android, com suporte a chamada de voz continuando em segundo plano mesmo se você sair do app.</p>
            </details>
            <details className="lp-faq-item landing-reveal">
              <summary>Meus dados ficam seguros?<Ico name="plus" size={18} /></summary>
              <p>Sim. Suporte a autenticação em duas etapas, sessões visíveis por dispositivo, e moderação ativa contra spam e abuso.</p>
            </details>
            <details className="lp-faq-item landing-reveal">
              <summary>Preciso instalar algo pra começar?<Ico name="plus" size={18} /></summary>
              <p>Não — o botão "Entrar pelo navegador" já é suficiente pra usar tudo. Os apps de Windows/Linux/Android são só uma conveniência a mais, pra quem quer notificação nativa e a chamada de voz sempre à mão.</p>
            </details>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-final landing-reveal">
            <img className="lp-final-logo" src={logo} alt="" />
            <h2>Pronto pra entrar?</h2>
            <p>Leva menos de um minuto pra criar sua conta e já estar dentro de um Tema.</p>
            <div className="lp-cta-row center">
              <button className="lp-btn primary lg" onClick={goRegister}>Criar conta <Ico name="arrowRight" size={18} /></button>
              <button className="lp-btn ghost lg" onClick={goLogin}><Ico name="login" size={18} /> Entrar agora pelo navegador</button>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-col brand">
          <div className="lp-brand"><img className="lp-brand-mark" src={logo} alt="" /><span>PROJECT CLUB</span></div>
          <div className="lp-footer-note">Feito pela comunidade, para a comunidade.</div>
        </div>
        <div className="lp-footer-col">
          <div className="lp-footer-heading">Plataforma</div>
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#sobre">Sobre</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="lp-footer-col">
          <div className="lp-footer-heading">Comece</div>
          <a href="#download">Download</a>
          <button className="lp-footer-link" onClick={goLogin}>Entrar</button>
          <button className="lp-footer-link" onClick={goRegister}>Criar conta</button>
        </div>
        <div className="lp-footer-col">
          <div className="lp-footer-heading">Legal</div>
          <button className="lp-footer-link" onClick={() => navigate('/privacidade')}>Proteção e Privacidade</button>
        </div>
      </footer>
    </div>
  );
}
