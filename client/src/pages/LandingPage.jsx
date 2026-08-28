import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';

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

// Publicados no repositório PÚBLICO separado ProjectClub-Downloads (sem
// nenhum código-fonte dentro, só os instaladores) — o repositório
// principal continua privado. O GitHub Actions do repositório principal
// (.github/workflows/build-desktop.yml) publica ali automaticamente
// sempre que a pasta desktop/ muda, mas é um repositório normal — dá
// pra arrastar um arquivo novo lá manualmente a qualquer momento também.
const DOWNLOADS_BASE = 'https://raw.githubusercontent.com/RiqueBitt/ProjectClub-Downloads/main/download';
const WINDOWS_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub-Setup-Windows.exe`;
const LINUX_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub-Linux.AppImage`;
const ANDROID_DOWNLOAD_URL = `${DOWNLOADS_BASE}/ProjectClub.apk`;

export default function LandingPage() {
  const navigate = useNavigate();
  useReveal();

  return (
    <div className="landing-page">
      <div className="landing-bg-field" />
      <div className="landing-bg-band" />
      <div className="landing-bg-grid" />

      <nav className="landing-nav">
        <div className="landing-brand"><img className="landing-brand-mark" src={logo} alt="" /><span>PROJECT CLUB</span></div>
        <ul className="landing-nav-links">
          <li><a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Início</a></li>
          <li><a href="#como-funciona">Como funciona</a></li>
          <li><a href="#recursos">Recursos</a></li>
          <li><a href="#sobre">Sobre</a></li>
          <li><a href="#download">Download</a></li>
        </ul>
        <button className="landing-nav-cta" onClick={() => navigate('/login')}>Entrar</button>
      </nav>

      <main>
        <section className="landing-hero">
          <span className="landing-eyebrow">● Comunidade ativa agora</span>
          <h1 className="landing-pixel">
            Um jeito mais <span className="landing-grad">conectado</span><br />de fazer parte de algo
          </h1>
          <p className="landing-sub">
            Chat em tempo real, canais de voz, Feeds com Clubes e categorias, conquistas, economia e muito mais —
            tudo numa comunidade só, sem enrolação.
          </p>
          <div className="landing-cta-row">
            <button className="landing-btn-primary" onClick={() => navigate('/login')}>⬇ Entrar agora pelo navegador</button>
            <a className="landing-btn-secondary" href="#download">Ver opções de download</a>
          </div>
          <p className="landing-platform-note">Também em desenvolvimento para Windows e Android · Grátis</p>

          <div className="landing-window landing-reveal" aria-hidden="true">
            <div className="landing-window-bar">
              <span className="landing-dot d1" /><span className="landing-dot d2" /><span className="landing-dot d3" />
              <span className="landing-window-bar-title">Project Club — Comunidade</span>
            </div>
            <div className="landing-window-body">
              <div className="landing-window-side">
                <div className="landing-window-grp">Navegação</div>
                <div className="landing-window-item active">💬 Comunidade</div>
                <div className="landing-window-item">👥 Amigos</div>
                <div className="landing-window-item">📰 Feeds</div>
                <div className="landing-window-grp">Extras</div>
                <div className="landing-window-item">🏆 Conquistas</div>
                <div className="landing-window-item">⭐ Ranks</div>
                <div className="landing-window-item">🔔 Atualizações</div>
              </div>
              <div className="landing-window-main">
                <div className="landing-window-grid">
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Chat Geral</div><div className="landing-window-card-meta">Canal de texto</div></div>
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Sala de Voz</div><div className="landing-window-card-meta">Canal de voz</div></div>
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Discussão</div><div className="landing-window-card-meta">Categoria de Feed</div></div>
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Veterano</div><div className="landing-window-card-meta">Conquista · Rara</div></div>
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Ranks</div><div className="landing-window-card-meta">Nível de conta</div></div>
                  <div className="landing-window-card"><div className="landing-window-thumb" /><div className="landing-window-card-name">Clubes</div><div className="landing-window-card-meta">Organização de posts</div></div>
                </div>
                <div className="landing-window-online">
                  <span className="landing-online-dot" /> 3 pessoas online agora
                  <span className="landing-online-avatars"><i /><i /><i /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="landing-strip landing-reveal">
          <div className="landing-stat"><div className="landing-stat-num landing-pixel">∞</div><div className="landing-stat-label">Canais e categorias</div></div>
          <div className="landing-stat"><div className="landing-stat-num landing-pixel">100%</div><div className="landing-stat-label">Tempo real</div></div>
          <div className="landing-stat"><div className="landing-stat-num landing-pixel">18</div><div className="landing-stat-label">Conquistas pra desbloquear</div></div>
          <div className="landing-stat"><div className="landing-stat-num landing-pixel">24/7</div><div className="landing-stat-label">Comunidade ativa</div></div>
        </div>

        <section id="como-funciona">
          <div className="landing-section-head">
            <div className="landing-tag">Como funciona</div>
            <h2 className="landing-pixel">Três passos e você já está dentro</h2>
            <p>Sem formulário complicado, sem enrolação — comece a participar em minutos.</p>
          </div>
          <div className="landing-steps">
            <div className="landing-step landing-reveal">
              <div className="landing-step-num landing-pixel">01</div>
              <h3>Crie sua conta</h3>
              <p>Cadastro rápido, direto pelo navegador — sem precisar instalar nada.</p>
            </div>
            <div className="landing-step-line" aria-hidden="true" />
            <div className="landing-step landing-reveal">
              <div className="landing-step-num landing-pixel">02</div>
              <h3>Explore os Clubes</h3>
              <p>Entre nos canais de chat e voz, e navegue pelos Clubes e categorias do Feed.</p>
            </div>
            <div className="landing-step-line" aria-hidden="true" />
            <div className="landing-step landing-reveal">
              <div className="landing-step-num landing-pixel">03</div>
              <h3>Participe em tempo real</h3>
              <p>Converse, publique posts, desbloqueie conquistas — tudo atualiza na hora pra todo mundo.</p>
            </div>
          </div>
        </section>

        <section id="recursos">
          <div className="landing-section-head">
            <div className="landing-tag">Recursos</div>
            <h2 className="landing-pixel">Tudo que uma comunidade precisa,<br />num lugar só</h2>
            <p>Chat, voz, feed de posts e sistema de conquistas — pensado pra quem quer mais que só um grupo.</p>
          </div>
          <div className="landing-feat-grid">
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">◆</div><h3>Chat e canais de voz</h3><p>Conversa em tempo real por texto ou voz, com canais organizados por categoria.</p></div>
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">▣</div><h3>Feeds e Clubes</h3><p>Publique posts organizados por Clube e categoria — discussão, dúvida, notícia e mais.</p></div>
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">✦</div><h3>Conquistas</h3><p>Desbloqueie conquistas conforme participa da comunidade, com raridades diferentes.</p></div>
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">▲</div><h3>Perfil personalizado</h3><p>Cor de perfil, banner, conexões e conquistas em destaque — do seu jeito.</p></div>
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">☍</div><h3>Amigos e privacidade</h3><p>Adicione amigos com controle total sobre quem pode te mandar pedido.</p></div>
            <div className="landing-feat landing-reveal"><div className="landing-feat-icon">◈</div><h3>Tempo real de verdade</h3><p>Tudo atualiza na hora pra todo mundo — sem precisar recarregar a página.</p></div>
          </div>
        </section>

        <section id="sobre" className="landing-about">
          <div className="landing-about-inner landing-reveal">
            <div className="landing-tag">Sobre</div>
            <h2 className="landing-pixel">Feito pra comunidade de verdade,<br />não só pra mais um grupo</h2>
            <p>
              O Project Club nasceu de um jeito simples de pensar: uma comunidade não é só um monte de gente no
              mesmo lugar — é gente conversando, criando, e sendo reconhecida por isso. Por isso cada detalhe
              (dos canais de voz às conquistas que você desbloqueia) foi pensado pra fazer parte parecer mais
              com estar em casa do que com só mais uma aba aberta.
            </p>
          </div>
        </section>

        <section id="download" className="landing-download">
          <div className="landing-section-head">
            <div className="landing-tag">Download</div>
            <h2 className="landing-pixel">Escolha como entrar</h2>
            <p>O jeito mais rápido é pelo navegador — os apps nativos ainda estão a caminho.</p>
          </div>
          <div className="landing-platforms">
            <button className="landing-platform-card landing-reveal" onClick={() => navigate('/login')}>
              <div className="landing-platform-glyph">🌐</div>
              <div className="landing-platform-os">Navegador</div>
              <div className="landing-platform-fmt">Disponível agora</div>
            </button>
            <a className="landing-platform-card landing-reveal" href={WINDOWS_DOWNLOAD_URL} download>
              <div className="landing-platform-glyph">⊞</div>
              <div className="landing-platform-os">Windows</div>
              <div className="landing-platform-fmt">Baixar .exe</div>
            </a>
            <a className="landing-platform-card landing-reveal" href={LINUX_DOWNLOAD_URL} download>
              <div className="landing-platform-glyph">🐧</div>
              <div className="landing-platform-os">Linux</div>
              <div className="landing-platform-fmt">Baixar .AppImage</div>
            </a>
            <a className="landing-platform-card landing-reveal" href={ANDROID_DOWNLOAD_URL} download>
              <div className="landing-platform-glyph">▱</div>
              <div className="landing-platform-os">Android</div>
              <div className="landing-platform-fmt">Baixar .apk</div>
            </a>
          </div>
        </section>

        <section className="landing-final-cta landing-reveal">
          <h2 className="landing-pixel">Pronto pra entrar?</h2>
          <p>Leva menos de um minuto pra criar sua conta e já estar dentro de um Clube.</p>
          <button className="landing-btn-primary" onClick={() => navigate('/login')}>⬇ Entrar agora pelo navegador</button>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-col">
          <div className="landing-footer-brand landing-pixel">PROJECT CLUB</div>
          <div className="landing-footer-note">Feito pela comunidade, para a comunidade.</div>
        </div>
        <div className="landing-footer-col">
          <div className="landing-footer-heading">Plataforma</div>
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href="#sobre">Sobre</a>
        </div>
        <div className="landing-footer-col">
          <div className="landing-footer-heading">Comece</div>
          <a href="#download">Download</a>
          <button className="landing-footer-link-btn" onClick={() => navigate('/login')}>Entrar</button>
        </div>
      </footer>
    </div>
  );
}
