import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PublicFooter, PublicHeader, usePublicScrollChrome } from './public/PublicChrome.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/landing.css';
import '../styles/landing-mono.css';

// Página inicial pública (vitrine + download).
//
// Visual preto e branco, minimalista (landing-mono.css): nome gigante na
// abertura, seções alternando branco e preto, faixa de palavras correndo,
// apps em grade, download em lista e perguntas em sanfona. Animações:
// letras subindo, frases entrando palavra por palavra, cursor que inverte
// as cores e botões "magnéticos".
// Com "reduzir movimento" ligado, tudo aparece parado.

const DOWNLOADS_BASE = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download';
const DOWNLOADS = {
  windows: `${DOWNLOADS_BASE}/ProjectClub-Setup-Windows.exe`,
  linux: `${DOWNLOADS_BASE}/ProjectClub-Linux.AppImage`,
  // ProjectClub.apk = app Android nativo (mesmo pacote do app antigo, que atualiza para ele).
  android: `${DOWNLOADS_BASE}/ProjectClub.apk`,
};

// O que aparece na vitrine por enquanto: o próprio Project Club, o Mod
// Manager e o RPG Blackout. `note` é a linha de baixo; `art: 'type'` desenha
// o nome em letras (sem print) no lugar da captura.
const APPS = [
  { id: 'projectclub', verb: 'Comunidade', shot: '02-chat', name: 'Project Club', what: 'Comunidade com chat, voz e fórum', color: '#5b8cff', line: 'Canais de texto e de voz, amigos, conquistas, loja e economia, no computador, no celular e no navegador.', note: 'Grátis para Windows, Linux, Android e navegador.' },
  { id: 'modmanager', verb: 'Mods', shot: '01-biblioteca', name: 'Mod Manager', what: 'Gerenciador de mods', color: '#ff5c93', line: 'Um lugar só para os mods dos seus jogos da Steam, Epic Games e GOG, do Minecraft e do Hytale, com modpacks que entram quando o jogo abre e saem quando ele fecha.', note: 'Vem no app para computador.' },
  { id: 'blackout', verb: 'RPG', art: 'type', name: 'RPG Blackout', what: 'RPG de mesa', color: '#ff3b3b', line: 'O compêndio do BLACKOUT abre direto no Project Club, no computador e no celular, para quem está na mesa.', note: 'Para quem participa da instância BLACKOUT.' },
];

// Os programas de criação saíram da vitrine por enquanto (continuam no app).
// Pra voltar com eles, é só juntar esta lista na de cima.
// eslint-disable-next-line no-unused-vars
const CREATIVE_APPS = [
  { id: 'gameproject', verb: 'Jogos', shot: '09-jogo-rodando', name: 'GameProject', what: 'Criação de jogos 2D e 3D', color: '#818CF8', line: 'Cenas, física, animação e scripts num editor só. Aperte F5 e o jogo roda ali mesmo.', base: 'Godot Engine' },
  { id: 'photoproject', verb: 'Fotos', shot: '08-pincel-camadas', name: 'PhotoProject', what: 'Editor de imagem', color: '#A855F7', line: 'Camadas, máscaras, ajustes e arquivos do Photoshop abrindo do jeito que foram salvos.', base: 'Patchy' },
  { id: 'projectmc', verb: 'Minecraft', shot: '08-loja-de-mods', name: 'ProjectMC', what: 'Launcher de Minecraft', color: '#A3E635', line: 'Instâncias separadas, mods do Modrinth e do CurseForge e o Java certo para cada versão.', base: 'X Minecraft Launcher' },
  { id: 'hyproject', verb: 'Hytale', shot: '07-painel', name: 'HyProject', what: 'Launcher de Hytale', color: '#FACC15', line: 'Instala, atualiza e organiza perfis e mods, com as novidades do jogo na tela inicial.', base: 'HyPrism' },
  { id: 'davinciproject', verb: 'Vídeo', shot: '03-clipe-selecionado', name: 'CutProject', what: 'Editor de vídeo', color: '#F87171', line: 'Linha do tempo com várias faixas, cor, títulos e exportação pronta para as redes.', base: 'Sprocket' },
  { id: 'waveproject', verb: 'Música e voz', shot: '11-efeitos-em-tempo-real', name: 'WaveProject', what: 'Editor de áudio', color: '#22D3EE', line: 'Grave, corte e limpe voz, música e podcast com efeitos em tempo real.', base: 'Audacity' },
  { id: 'texelproject', verb: 'Texturas 3D', shot: '08-vista-de-cima', name: 'TexelProject', what: 'Pintura de texturas 3D', color: '#FB923C', line: 'Pinte direto no modelo, com materiais PBR, camadas e máscaras.', base: 'ArmorPaint' },
  { id: 'forgeproject', verb: 'Modelos 3D', shot: '07-shading', name: 'ForgeProject', what: 'Modelagem e render 3D', color: '#4ADE80', line: 'Modele, anime e renderize. Tudo que o Blender faz, com a cara do clube.', base: 'Bforartists' },
  { id: 'canvasproject', verb: 'Desenho', shot: '06-predefinicoes-de-pincel', name: 'CanvasProject', what: 'Pintura digital', color: '#F472B6', line: 'Pincéis que parecem tinta, mesa digitalizadora, quadrinhos e animação quadro a quadro.', base: 'Krita' },
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

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function detectPlatform() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/linux/i.test(ua)) return 'linux';
  return null;
}
const PLATFORM_LABEL = { windows: 'Windows', linux: 'Linux', android: 'Android' };

// Revela blocos ao entrarem na tela (uma vez só).
function useReveal() {
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const lp = document.querySelector('.lp');
    // Só usa a .lp como raiz se ela for quem rola; senão, a janela.
    const root = lp && lp.scrollHeight > lp.clientHeight + 1 ? lp : null;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { root, threshold: 0, rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
    lp?.classList.add('is-js');
    return () => { io.disconnect(); lp?.classList.remove('is-js'); };
  }, []);
}

// ---------- Dados ao vivo ----------
// Pulso da comunidade (só números agregados) e versão publicada de cada app.
function CommandPalette({ open, onClose, onPickApp, actions }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const items = [
    ...APPS.map((a, i) => ({ key: a.id, label: a.name, hint: a.what, icon: `/apps/${a.id}/icon.png`, run: () => onPickApp(i) })),
    ...actions,
  ].filter((it) => !q || norm(`${it.label} ${it.hint}`).includes(norm(q)));
  const run = (it) => { onClose(); setTimeout(it.run, 30); };
  if (!open) return null;
  return (
    <div className="lp-cmd" role="dialog" aria-modal="true" aria-label="Busca rápida" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lp-cmd-box">
        <input
          ref={inputRef} className="lp-cmd-input" value={q} placeholder="Buscar um app, uma seção ou uma ação"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) run(items[sel]);
          }}
          aria-activedescendant={items[sel] ? `cmd-${items[sel].key}` : undefined}
        />
        <ul className="lp-cmd-list" role="listbox">
          {items.map((it, i) => (
            <li key={it.key} id={`cmd-${it.key}`} role="option" aria-selected={i === sel} className={i === sel ? 'is-on' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(it)}>
              {it.icon ? <img src={it.icon} alt="" width="28" height="28" /> : <span className="lp-cmd-glyph" aria-hidden="true">{it.glyph}</span>}
              <span><strong>{it.label}</strong><small>{it.hint}</small></span>
            </li>
          ))}
          {items.length === 0 && <li className="lp-cmd-empty">Nada encontrado. Tente "jogos", "download" ou "entrar".</li>}
        </ul>
        <p className="lp-cmd-foot"><kbd>↑</kbd><kbd>↓</kbd> para escolher, <kbd>Enter</kbd> para abrir, <kbd>Esc</kbd> para fechar</p>
      </div>
    </div>
  );
}

// Cor e ficha de exemplo de cada personagem. O lado esquerdo da seção troca
// junto com a figura. Mesma ficha da Call modo RPG (PV, Estresse, PA e Ação
// Rápida, ver components/voice/RpgTable.jsx); os valores são de exemplo.
function AppArt({ a, className = '', eager = false, alt = '' }) {
  if (a.art === 'type') {
    return (
      <div className={`lp-type-art ${className}`} style={{ '--c': a.color }} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        <img src={`/apps/${a.id}/icon.png`} alt="" width="72" height="72" />
        <strong>{a.name.replace(/^RPG\s+/i, '').toUpperCase()}</strong>
        <span>{a.what}</span>
      </div>
    );
  }
  return <img className={className} src={a.shot ? `/apps/${a.id}/shots/${a.shot}.jpg` : `/apps/${a.id}/banner.jpg`} alt={alt} loading={eager ? 'eager' : 'lazy'} />;
}

// Grade dos apps (estilo portfólio): captura em preto e branco, nome,
// o que faz e duas etiquetas. A captura entra com uma cortina ao aparecer.
const AppGrid = forwardRef(function AppGrid(_props, apiRef) {
  const listRef = useRef(null);
  useImperativeHandle(apiRef, () => ({
    goTo: (i) => listRef.current?.children[i]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }),
  }));
  return (
    <section id="apps" className="lm-sec lm-apps" aria-labelledby="apps-titulo">
      <div className="lm-sec-head">
        <div>
          <p className="lm-eyebrow lp-reveal"><b>01</b>/Apps</p>
          <h2 id="apps-titulo" className="lm-h2 lp-reveal">Três apps. Uma conta.</h2>
        </div>
      </div>
      <ul className="lm-grid" ref={listRef}>
        {APPS.map((a, i) => (
          <li key={a.id} className="lm-card lp-reveal" style={{ '--i': i }}>
            <div className="lm-card-art"><AppArt a={a} eager={i === 0} alt={`${a.name}: ${a.what}`} /></div>
            <div className="lm-card-meta">
              <h3>{a.name}</h3>
              <p>{a.what}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
});

// Nome gigante: cada letra sobe de dentro de uma máscara, uma depois da outra.
function Wordmark({ text, className = '' }) {
  return (
    <span className={`lm-word ${className}`} aria-hidden="true">
      {text.split('').map((ch, i) => (
        <span key={i} className="lm-word-mask"><span className="lm-word-ch" style={{ '--i': i }}>{ch === ' ' ? '\u00a0' : ch}</span></span>
      ))}
    </span>
  );
}

// Ajusta o tamanho das letras pra o nome ocupar a largura toda, sem vazar
// (recalcula quando a fonte carrega e quando a janela muda de tamanho).
function useFitText(selector, maxWidth = Infinity) {
  useEffect(() => {
    const fit = () => document.querySelectorAll(selector).forEach((el) => {
      el.style.fontSize = '';
      if (window.innerWidth > maxWidth) return;
      const ps = getComputedStyle(el.parentElement);
      const box = el.parentElement.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
      const w = el.scrollWidth;
      if (w > 0 && box > 0) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * (box / w) * 0.995}px`;
    });
    fit();
    document.fonts?.ready?.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [selector, maxWidth]);
}

// Faixa de palavras correndo.
const MARQUEE = ['Chat', 'Voz', 'Fórum', 'Mods', 'RPG'];
function Marquee() {
  const row = (rev) => (
    <div className={`lm-marquee-row${rev ? ' is-rev' : ''}`}>
      {[0, 1].map((k) => (
        <span key={k} className="lm-marquee-track" aria-hidden={k === 1}>
          {MARQUEE.map((w) => <span key={w} className="lm-marquee-item">{w}<i aria-hidden="true">✳</i></span>)}
        </span>
      ))}
    </div>
  );
  return <div className="lm-marquee" role="presentation">{row(false)}</div>;
}

// Cursor: um ponto que inverte as cores do que passa por baixo e cresce
// (com uma palavra) em cima de links, botões e cards. Só com mouse.
function useMonoCursor() {
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia('(pointer: fine)').matches) return undefined;
    const root = document.querySelector('.lp');
    const dot = document.createElement('div');
    dot.className = 'lm-cursor'; dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); dot.appendChild(label);
    root.appendChild(dot); root.classList.add('has-cursor');
    let x = -100; let y = -100; let cx = x; let cy = y; let raf = 0;
    const tick = () => {
      cx += (x - cx) * 0.22; cy += (y - cy) * 0.22;
      dot.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onMove = (e) => {
      x = e.clientX; y = e.clientY;
      const hit = e.target.closest?.('[data-cursor], a, button, summary');
      dot.classList.toggle('is-big', !!hit);
      label.textContent = hit?.getAttribute?.('data-cursor') || '';
      dot.classList.toggle('has-label', !!label.textContent);
      // Botão "magnético": puxa um pouquinho na direção do mouse.
      root.querySelectorAll('.lm-magnet').forEach((b) => {
        const r = b.getBoundingClientRect(); const dx = e.clientX - (r.left + r.width / 2); const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < Math.max(r.width, r.height);
        b.style.transform = near ? `translate(${dx * 0.18}px, ${dy * 0.28}px)` : '';
      });
    };
    const onLeave = () => { x = -100; y = -100; };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => { cancelAnimationFrame(raf); root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave); dot.remove(); root.classList.remove('has-cursor'); };
  }, []);
}

export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useReveal();
  usePublicScrollChrome();
  useMonoCursor();
  useFitText('.lm-hero-title, .lm-end-title');
  useFitText('.lp-bo-title', 760);
  const [platform] = useState(detectPlatform);
  const [cmdOpen, setCmdOpen] = useState(false);
  const stageRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen((o) => !o); }
      else if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Mouse: --mx/--my (-1..1) na página inteira (paralaxe dos personagens) e
  // --sx/--sy (px) dentro de cada cartão com [data-spot] (luz que segue).
  useEffect(() => {
    const root = document.querySelector('.lp');
    if (!root || reducedMotion()) return undefined;
    let raf = 0; let ev = null;
    const apply = () => {
      raf = 0;
      const e = ev;
      root.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
      root.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      const card = e.target?.closest?.('[data-spot]');
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--sx', `${e.clientX - r.left}px`);
        card.style.setProperty('--sy', `${e.clientY - r.top}px`);
        card.style.setProperty('--tx', `${(((e.clientY - r.top) / r.height) - 0.5) * -8}deg`);
        card.style.setProperty('--ty', `${(((e.clientX - r.left) / r.width) - 0.5) * 10}deg`);
      }
    };
    const onMove = (e) => { ev = e; if (!raf) raf = requestAnimationFrame(apply); };
    const onLeave = (e) => { const c = e.target?.closest?.('[data-spot]'); if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--tx', '0deg'); c.style.setProperty('--ty', '0deg'); } };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerout', onLeave, { passive: true });
    return () => { root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerout', onLeave); cancelAnimationFrame(raf); };
  }, []);
  const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
  // Vindo de outra página pública com "/#secao": rola até a seção.
  useEffect(() => {
    const id = decodeURIComponent((location.hash || '').slice(1));
    if (!id) return undefined;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'auto' }), 60);
    return () => clearTimeout(t);
  }, [location.hash]);
  // Logado (abriu em /site pra ver a vitrine e os downloads): os botões
  // de entrar/criar conta levam de volta pro app.
  const { user } = useAuth() || {};
  const cmdActions = [
    { key: 'go-dl', label: 'Baixar o Project Club', hint: 'Windows, Linux e Android', glyph: '↓', run: () => jump('download') },
    { key: 'go-login', label: user ? 'Voltar pro app' : 'Entrar', hint: user ? 'Você já está logado' : 'Já tenho conta', glyph: '→', run: () => navigate(user ? '/inicio' : '/login') },
    ...(user ? [] : [{ key: 'go-reg', label: 'Criar conta', hint: 'Grátis, leva um minuto', glyph: '+', run: () => navigate('/register') }]),
    { key: 'go-bo', label: 'RPG Blackout', hint: 'Fichas, classes e rolagens', glyph: '◆', run: () => stageRef.current?.goTo(2) },
    { key: 'go-com', label: 'Comunidade', hint: 'Chat, voz, fórum e conquistas', glyph: '#', run: () => jump('comunidade') },
    { key: 'go-faq', label: 'Perguntas', hint: 'Preço, requisitos e atualizações', glyph: '?', run: () => jump('perguntas') },
    { key: 'go-blog', label: 'Blog', hint: 'O guia completo do Project Club', glyph: '¶', run: () => navigate('/blog') },
    { key: 'go-terms', label: 'Política de privacidade', hint: 'Termos de uso e dados', glyph: '§', run: () => navigate('/blog/politica-de-privacidade') },
  ];

  const goLogin = () => navigate(user ? '/inicio' : '/login');
  const goRegister = () => navigate(user ? '/inicio' : '/register');

  return (
    <div className="lp lp-mono">
      <a className="lp-skip" href="#conteudo">Pular para o conteúdo</a>
      <div className="lp-progress" aria-hidden="true" />

      <PublicHeader page="inicio" onSearch={() => setCmdOpen(true)} />

      <main id="conteudo">
        <section className="lm-hero lm-dark" aria-labelledby="titulo">
          <h1 id="titulo" className="lm-hero-title" aria-label="Project Club"><Wordmark text="Project Club" /></h1>
          <div className="lm-hero-row">
            <p className="lm-statement lm-words" aria-label="Comunidade, mods e RPG. De graça.">
              {'Comunidade, mods e RPG. De graça.'.split(' ').map((w, i) => <span key={i} aria-hidden="true" style={{ '--i': i }}>{w} </span>)}
            </p>
            <div className="lm-cta lm-hero-side">
              {platform ? (
                <a className="lm-btn is-solid lm-magnet" href={DOWNLOADS[platform]} download data-cursor="Baixar">
                  <Mark name={platform} size={18} /> Baixar para {PLATFORM_LABEL[platform]}
                </a>
              ) : (
                <button type="button" className="lm-btn is-solid lm-magnet" onClick={goRegister}>{user ? 'Voltar pro app' : 'Criar conta'}</button>
              )}
              <a className="lm-btn is-line" href="#download">Outros sistemas</a>
            </div>
          </div>
          <Marquee />
        </section>

        <AppGrid ref={stageRef} />

        <section id="comunidade" className="lm-sec lm-com" aria-labelledby="com-titulo">
          <div className="lm-sec-head">
            <div>
              <p className="lm-eyebrow lp-reveal"><b>02</b>/Comunidade</p>
              <h2 id="com-titulo" className="lm-h2 lp-reveal">Do jeito do clube.</h2>
            </div>
          </div>
          <ul className="lm-principles">
            {[
              ['De graça', 'Sem plano pago e sem anúncio.'],
              ['Tempo real', 'Chat, voz e presença na hora.'],
              ['Em todo lugar', 'Computador, celular e navegador.'],
            ].map(([t, d], i) => (
              <li key={t} className="lp-reveal" style={{ '--i': i }}>
                <span className="lm-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="download" className="lm-sec lm-dark lm-dl" aria-labelledby="dl-titulo">
          <div className="lm-sec-head">
            <div>
              <p className="lm-eyebrow lp-reveal"><b>03</b>/Download</p>
              <h2 id="dl-titulo" className="lm-h2 lp-reveal">Escolha o seu sistema.</h2>
            </div>
          </div>
          <ul className="lm-dl-list">
            {[
              { key: 'windows', name: 'Windows', desc: '.exe', href: DOWNLOADS.windows },
              { key: 'linux', name: 'Linux', desc: 'AppImage', href: DOWNLOADS.linux },
              { key: 'android', name: 'Android', desc: '.apk', href: DOWNLOADS.android },
              { key: 'browser', name: 'Navegador', desc: 'Sem instalar' },
            ].map((d, i) => {
              const inner = (
                <>
                  <span className="lm-dl-name"><Mark name={d.key} size={26} />{d.name}{platform === d.key && <em>seu sistema</em>}</span>
                  <span className="lm-dl-desc">{d.desc}</span>
                  <span className="lm-dl-go" aria-hidden="true">{d.href ? '↓' : '→'}</span>
                </>
              );
              return (
                <li key={d.key} className="lp-reveal" style={{ '--i': i }}>
                  {d.href
                    ? <a className="lm-dl-row" href={d.href} download data-cursor="Baixar">{inner}</a>
                    : <button type="button" className="lm-dl-row" onClick={goLogin} data-cursor={user ? 'Abrir' : 'Entrar'}>{inner}</button>}
                </li>
              );
            })}
          </ul>
        </section>

        <section id="perguntas" className="lm-sec lm-faq-sec" aria-labelledby="faq-titulo">
          <div className="lm-sec-head">
            <div>
              <p className="lm-eyebrow lp-reveal"><b>04</b>/Perguntas</p>
              <h2 id="faq-titulo" className="lm-h2 lp-reveal">Antes de entrar.</h2>
            </div>
          </div>
          <div className="lm-faq">
            {[
              ['Custa alguma coisa?', 'Não. A conta, a comunidade e os apps são gratuitos, sem anúncio.'],
              ['Preciso instalar?', 'Só para o Mod Manager. A comunidade funciona no navegador e no Android.'],
              ['Roda em PC fraco?', 'Sim. Abre em qualquer navegador atual, e o app roda em Windows 10 e 11 e em Linux.'],
            ].map(([q, a], i) => (
              <details key={q} className="lp-reveal" style={{ '--i': i }}>
                <summary><span>{q}</span><i aria-hidden="true" /></summary>
                <div className="lm-faq-a"><p>{a}</p></div>
              </details>
            ))}
          </div>
          <Link className="lm-more lp-reveal" to="/blog">Mais respostas no Blog <span aria-hidden="true">→</span></Link>
        </section>

        <section className="lm-end lm-dark" aria-labelledby="fim-titulo">
          <h2 id="fim-titulo" className="lm-end-title lp-reveal"><Wordmark text="Vem pro clube" /></h2>
          <div className="lm-cta lp-reveal">
            <button type="button" className="lm-btn is-solid lm-magnet" onClick={goRegister}>{user ? 'Voltar pro app' : 'Criar conta'}</button>
          </div>
        </section>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onPickApp={(i) => stageRef.current?.goTo(i)} actions={cmdActions} />

      <PublicFooter page="inicio" />
    </div>
  );
}
