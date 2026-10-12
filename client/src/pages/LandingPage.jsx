import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../assets/icons/logo-project-club.png';
import { Ico } from '../components/PagesKit.jsx';
import '../styles/landing.css';

// Página inicial pública (vitrine + download).
// Estilo editorial: fundo claro, título enorme em fonte condensada,
// legendas pequenas em caixa alta, uma faixa escura no meio e os apps do
// Project Club com a arte de verdade de cada um. Só duas animações:
// revelar ao rolar e a esteira dos apps — as duas param com "reduzir
// movimento" ligado no sistema.

const DOWNLOADS_BASE = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download';
const DOWNLOADS = {
  windows: `${DOWNLOADS_BASE}/ProjectClub-Setup-Windows.exe`,
  linux: `${DOWNLOADS_BASE}/ProjectClub-Linux.AppImage`,
  android: `${DOWNLOADS_BASE}/ProjectClub.apk`,
};

// Apps da aba Apps, com a arte publicada em /public/apps/<id>/.
const APPS = [
  { id: 'gameproject', name: 'GameProject', what: 'Criação de jogos 2D e 3D', color: '#818CF8' },
  { id: 'photoproject', name: 'PhotoProject', what: 'Editor de imagem', color: '#A855F7' },
  { id: 'projectmc', name: 'ProjectMC', what: 'Launcher de Minecraft', color: '#A3E635' },
  { id: 'hyproject', name: 'HyProject', what: 'Launcher de Hytale', color: '#FACC15' },
  { id: 'davinciproject', name: 'CutProject', what: 'Editor de vídeo', color: '#F87171' },
  { id: 'waveproject', name: 'WaveProject', what: 'Editor de áudio', color: '#22D3EE' },
  { id: 'texelproject', name: 'TexelProject', what: 'Pintura de texturas 3D', color: '#FB923C' },
  { id: 'forgeproject', name: 'ForgeProject', what: 'Modelagem e render 3D', color: '#4ADE80' },
  { id: 'canvasproject', name: 'CanvasProject', what: 'Pintura digital', color: '#F472B6' },
];

const ICONS = {
  windows: 'M3 5.5 10 4.5v7H3zM12 4.2 21 3v8.5h-9zM3 13h7v6.5L3 18.5zM12 13h9V21l-9-1.2z',
  linux: 'M12 3c-2.2 0-3.5 1.8-3.5 4.3 0 1.5-.6 2.6-1.6 4C5.6 13 5 14.6 5 16c0 2.8 3 5 7 5s7-2.2 7-5c0-1.4-.6-3-1.9-4.7-1-1.4-1.6-2.5-1.6-4C15.5 4.8 14.2 3 12 3Z',
  android: 'M6 9h12v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM6 9a6 6 0 0 1 12 0M8.5 4 7 2M15.5 4 17 2M9.5 6.5h.01M14.5 6.5h.01M4 10v5M20 10v5M9 19v3M15 19v3',
  browser: 'M3 6h18v13H3zM3 10h18M6 8h.01M8.5 8h.01',
};
function Mark({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
  );
}

function useReveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = document.querySelectorAll('.lp-reveal');
    // A própria página (.lp) é o que rola, então ela é a raiz do observador.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { root: document.querySelector('.lp'), threshold: 0.08 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// Mostra "Windows", "Linux" ou "Android" no botão principal conforme o
// sistema de quem está lendo. Quem está no iPhone/Mac vê "pelo navegador".
function detectPlatform() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return null;
}
const PLATFORM_LABEL = { windows: 'Windows', linux: 'Linux', android: 'Android' };

export default function LandingPage() {
  const navigate = useNavigate();
  useReveal();
  const [platform] = useState(detectPlatform);
  const [copied, setCopied] = useState(false);

  const goLogin = () => navigate('/login');
  const goRegister = () => navigate('/register');
  const toTop = (e) => {
    e.preventDefault();
    document.querySelector('.lp')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText('https://projectclub.squareweb.app'); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* sem área de transferência */ }
  };

  const year = new Date().getFullYear();

  return (
    <div className="lp">
      <a className="lp-skip" href="#conteudo">Pular para o conteúdo</a>

      <header className="lp-top">
        <a className="lp-logo" href="#" onClick={toTop} aria-label="Project Club, início">
          <img src={logo} alt="" width="34" height="34" />
        </a>
        <nav className="lp-menu" aria-label="Seções">
          <a href="#apps">Apps</a>
          <a href="#comunidade">Comunidade</a>
          <a href="#download">Download</a>
          <a href="#perguntas">Perguntas</a>
        </nav>
        <div className="lp-top-actions">
          <button type="button" className="lp-link" onClick={goLogin}>Entrar</button>
          <button type="button" className="lp-btn is-dark is-sm" onClick={goRegister}>Criar conta</button>
        </div>
      </header>

      <main id="conteudo">
        {/* ---------- Abertura ---------- */}
        <section className="lp-hero" aria-labelledby="titulo">
          <div className="lp-hero-shapes" aria-hidden="true">
            {APPS.slice(0, 6).map((a, i) => (
              <img key={a.id} className={`lp-shape s${i + 1}`} src={`/apps/${a.id}/icon.png`} alt="" loading="lazy" />
            ))}
          </div>
          <h1 id="titulo" className="lp-display"><span>Project</span> <span>Club</span></h1>
          <div className="lp-hero-foot">
            <p className="lp-lede">
              Uma comunidade com chat, voz e fórum, e um app para computador que instala e atualiza os nossos programas de criação: jogos, imagem, vídeo, áudio e 3D. Tudo de graça, feito por quem usa.
            </p>
            <div className="lp-hero-cta">
              {platform ? (
                <a className="lp-btn is-accent is-lg" href={DOWNLOADS[platform]} download>
                  <Mark name={platform} size={20} /> Baixar para {PLATFORM_LABEL[platform]}
                </a>
              ) : (
                <button type="button" className="lp-btn is-accent is-lg" onClick={goRegister}>Criar conta grátis <Ico name="arrowRight" size={18} /></button>
              )}
              <a className="lp-btn is-ghost is-lg" href="#download">Outros sistemas</a>
            </div>
            <span className="lp-eyebrow">▶ comunidade · apps · grátis</span>
          </div>
        </section>

        {/* ---------- Apps (faixa escura) ---------- */}
        <section id="apps" className="lp-band is-dark" aria-labelledby="apps-titulo">
          <div className="lp-band-head lp-reveal">
            <span className="lp-eyebrow">▶ a aba apps</span>
            <h2 id="apps-titulo" className="lp-display is-md">Nove programas,<br />um só lugar</h2>
            <p className="lp-copy">
              Cada um é um projeto de código aberto conhecido, com o nome e a cara do Project Club. Você instala pelo app para computador, e as atualizações chegam por lá, sem procurar instalador por aí.
            </p>
          </div>
          <div className="lp-marquee" aria-hidden="true">
            <div className="lp-marquee-track">
              {[...APPS, ...APPS].map((a, i) => (
                <img key={`${a.id}-${i}`} src={`/apps/${a.id}/banner.jpg`} alt="" loading="lazy" style={{ '--c': a.color }} />
              ))}
            </div>
          </div>
          <ul className="lp-apps lp-reveal">
            {APPS.map((a) => (
              <li key={a.id} style={{ '--c': a.color }}>
                <img src={`/apps/${a.id}/icon.png`} alt="" width="44" height="44" loading="lazy" />
                <span className="lp-app-name">{a.name}</span>
                <span className="lp-app-what">{a.what}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Comunidade ---------- */}
        <section id="comunidade" className="lp-band" aria-labelledby="com-titulo">
          <div className="lp-split">
            <div className="lp-reveal">
              <span className="lp-eyebrow">▶ a comunidade</span>
              <h2 id="com-titulo" className="lp-display is-md">Conversa de<br />verdade</h2>
            </div>
            <div className="lp-reveal">
              <p className="lp-copy">
                Canais de texto e de voz, um fórum com temas e categorias, amigos, conquistas e uma economia com moedas, casas e figurinhas. Parece Discord por fora, mas é nosso por dentro: a gente decide o que entra.
              </p>
              <dl className="lp-facts">
                <div><dt>Tempo real</dt><dd>Mensagens, voz e presença atualizam na hora, sem recarregar.</dd></div>
                <div><dt>Conquistas</dt><dd>18 para desbloquear, com raridades e destaque no perfil.</dd></div>
                <div><dt>Perfil seu</dt><dd>Cor, banner, conexões e o que você quiser mostrar.</dd></div>
                <div><dt>Segurança</dt><dd>Verificação em duas etapas, sessões por aparelho e moderação ativa.</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* ---------- Download ---------- */}
        <section id="download" className="lp-band is-tint" aria-labelledby="dl-titulo">
          <div className="lp-band-head lp-reveal">
            <span className="lp-eyebrow">▶ download</span>
            <h2 id="dl-titulo" className="lp-display is-md">Escolha o seu<br />sistema</h2>
            <p className="lp-copy">O app para computador é o que instala os programas da aba Apps. No celular e no navegador você usa a comunidade.</p>
          </div>
          <div className="lp-dl lp-reveal">
            <a className={`lp-dl-card ${platform === 'windows' ? 'is-you' : ''}`} href={DOWNLOADS.windows} download>
              <Mark name="windows" size={28} />
              <strong>Windows</strong>
              <span>Instalador .exe · Windows 10 e 11</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <a className={`lp-dl-card ${platform === 'linux' ? 'is-you' : ''}`} href={DOWNLOADS.linux} download>
              <Mark name="linux" size={28} />
              <strong>Linux</strong>
              <span>AppImage · x86_64</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <a className={`lp-dl-card ${platform === 'android' ? 'is-you' : ''}`} href={DOWNLOADS.android} download>
              <Mark name="android" size={28} />
              <strong>Android</strong>
              <span>Arquivo .apk · instalação manual</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <button type="button" className="lp-dl-card" onClick={goLogin}>
              <Mark name="browser" size={28} />
              <strong>Navegador</strong>
              <span>Sem instalar nada, em qualquer aparelho</span>
              <em>Entrar <Ico name="arrowRight" size={15} /></em>
            </button>
          </div>
          <p className="lp-fine lp-reveal">
            Os arquivos vêm das versões publicadas no GitHub e se atualizam sozinhos depois de instalados. No Android, permita a instalação de apps fora da loja quando o sistema pedir.
          </p>
        </section>

        {/* ---------- Perguntas ---------- */}
        <section id="perguntas" className="lp-band" aria-labelledby="faq-titulo">
          <div className="lp-split">
            <div className="lp-reveal">
              <span className="lp-eyebrow">▶ perguntas</span>
              <h2 id="faq-titulo" className="lp-display is-md">Antes de<br />entrar</h2>
            </div>
            <div className="lp-faq lp-reveal">
              <details>
                <summary>Custa alguma coisa?<Ico name="plus" size={18} /></summary>
                <p>Não. A conta, a comunidade e todos os apps são gratuitos. Não tem plano pago nem anúncio.</p>
              </details>
              <details>
                <summary>Os apps são de vocês?</summary>
                <p>São versões dos projetos de código aberto que a gente usa (Godot, Krita, Blender, Audacity e outros), com o nome e o tema do Project Club e integrados ao app. O código de cada um fica público no GitHub, com os créditos e a licença original.</p>
              </details>
              <details>
                <summary>Preciso do app para computador?</summary>
                <p>Só para instalar os programas da aba Apps. A comunidade funciona no navegador e no Android também, inclusive com chamada de voz em segundo plano.</p>
              </details>
              <details>
                <summary>Como o app se atualiza?</summary>
                <p>Sozinho. O Project Club busca a versão nova ao abrir, e cada programa da aba Apps mostra um botão de atualizar quando sai uma versão.</p>
              </details>
              <details>
                <summary>E os meus dados?</summary>
                <p>Ficam no nosso servidor, com verificação em duas etapas opcional e sessões visíveis por aparelho. Os detalhes estão na página de <button type="button" className="lp-inline" onClick={() => navigate('/privacidade')}>proteção e privacidade</button>.</p>
              </details>
            </div>
          </div>
        </section>

        {/* ---------- Fechamento ---------- */}
        <section className="lp-band is-dark is-end" aria-labelledby="fim-titulo">
          <span className="lp-eyebrow">▶ é isso</span>
          <h2 id="fim-titulo" className="lp-display is-lg">Vem pro<br />clube</h2>
          <div className="lp-hero-cta">
            <button type="button" className="lp-btn is-accent is-lg" onClick={goRegister}>Criar conta <Ico name="arrowRight" size={18} /></button>
            <button type="button" className="lp-btn is-ghost-light is-lg" onClick={copyLink}>{copied ? 'Link copiado' : 'Copiar o link do site'}</button>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-foot-brand">
          <img src={logo} alt="" width="28" height="28" />
          <span>Project Club</span>
          <small>Comunidade e apps de criação, feitos pela comunidade.</small>
        </div>
        <nav className="lp-foot-nav" aria-label="Rodapé">
          <a href="#apps">Apps</a>
          <a href="#comunidade">Comunidade</a>
          <a href="#download">Download</a>
          <a href="#perguntas">Perguntas</a>
          <a href="https://github.com/RiqueBitt/ProjectClub" target="_blank" rel="noreferrer">GitHub</a>
          <button type="button" className="lp-link" onClick={() => navigate('/privacidade')}>Privacidade</button>
        </nav>
        <div className="lp-foot-meta">
          <span>© {year} Project Club</span>
          <a href="#" onClick={toTop}>Topo ↑</a>
        </div>
      </footer>
    </div>
  );
}
