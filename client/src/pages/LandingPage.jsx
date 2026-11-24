import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Ico } from '../components/PagesKit.jsx';
import { PublicFooter, PublicHeader, usePublicScrollChrome } from './public/PublicChrome.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/landing.css';

// Página inicial pública (vitrine + download).
//
// Duas peças carregam a página, o resto fica quieto de propósito:
//  1. Abertura: os apps giram numa órbita 3D em volta do nome,
//     passando por trás e pela frente das letras; a órbita inclina com
//     o mouse.
//  2. Palco dos apps: enquanto a pessoa rola, um app por vez toma a tela
//     (nome gigante, banner, o que faz) e o fundo muda para a cor dele.
// Com "reduzir movimento" ligado, a órbita fica parada e o palco vira
// uma lista comum.

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
  { id: 'projectclub', verb: 'Comunidade', shot: '01-comunidade', name: 'Project Club', what: 'Comunidade com chat, voz e fórum', color: '#5b8cff', line: 'Canais de texto e de voz, amigos, conquistas, loja e economia, no computador, no celular e no navegador.', note: 'Grátis para Windows, Linux, Android e navegador.' },
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
function usePulse() {
  const [pulse, setPulse] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/platform/pulse').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d && d.members != null) setPulse(d); }).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return pulse;
}
function useVersions() {
  const [v, setV] = useState({});
  useEffect(() => { fetch('/api/app-catalog/versions').then((r) => (r.ok ? r.json() : {})).then(setV).catch(() => {}); }, []);
  return v;
}
const fmtNum = (n) => new Intl.NumberFormat('pt-BR').format(n);

// Número que conta até o valor quando aparece.
function CountUp({ value }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  useEffect(() => {
    if (reducedMotion()) { setShown(value); return undefined; }
    const from = shown; const start = performance.now(); let raf = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / 900); const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{fmtNum(shown)}</>;
}

function Pulse() {
  const pulse = usePulse();
  if (!pulse || !pulse.online) return null;
  return (
    <p className="lp-pulse" aria-live="polite">
      <span className="lp-pulse-item"><i className="lp-pulse-dot" aria-hidden="true" /><b><CountUp value={pulse.online} /></b> {pulse.online === 1 ? 'pessoa online agora' : 'pessoas online agora'}</span>
    </p>
  );
}

// ---------- Busca rápida (Ctrl+K) ----------
// Pula para qualquer app, seção ou ação sem rolar a página.
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

// Texto e cor de cada personagem. O lado esquerdo da seção troca junto com a figura.
const BO_CHARS = [
  {
    id: 'bruxo', name: 'Bruxo', src: '/site/personagens/bruxo.webp',
    acc: '#ff3b3b', rgb: '255, 59, 59', glow: '170, 20, 24',
    tag: 'Pacto e maldição',
    stats: [['Poder', 92], ['Sanidade', 38], ['Vida', 54]],
  },
  {
    id: 'sacerdotisa', name: 'Sacerdotisa', src: '/site/personagens/sacerdotisa.webp',
    acc: '#f2c46b', rgb: '242, 196, 107', glow: '150, 98, 22',
    tag: 'Fé e cura',
    stats: [['Poder', 61], ['Sanidade', 88], ['Vida', 72]],
  },
];

function BlackoutTable() {
  const [hero, setHero] = useState(0);
  const [roll, setRoll] = useState(20);
  const [spin, setSpin] = useState(0);
  const timer = useRef(0);
  useEffect(() => () => clearInterval(timer.current), []);
  const doRoll = () => {
    clearInterval(timer.current);
    if (reducedMotion()) { setRoll(1 + Math.floor(Math.random() * 20)); return; }
    let n = 0;
    setSpin((x) => x + 1);
    timer.current = setInterval(() => {
      n += 1;
      setRoll(1 + Math.floor(Math.random() * 20));
      if (n > 12) clearInterval(timer.current);
    }, 55);
  };
  const crit = roll === 20 ? ' is-crit' : roll === 1 ? ' is-fail' : '';
  const ch = BO_CHARS[hero];
  return (
    <section id="blackout" className="lp-bo is-v2" aria-labelledby="bo-titulo" style={{ '--acc': ch.acc, '--acc-rgb': ch.rgb, '--glow-rgb': ch.glow }}>
      <div className="lp-bo-bg" aria-hidden="true" />
      <div className="lp-bo-glow" key={`g${hero}`} aria-hidden="true" />
      <div className="lp-bo-art">
        {BO_CHARS.map((c, i) => (
          <button key={c.id} type="button" className={`lp-bo-pick ${i === hero ? 'is-on' : ''}`} onClick={() => setHero(i)} aria-pressed={i === hero} aria-label={`Mostrar ${c.name}`} tabIndex={-1}>
            <img src={c.src} alt="" loading="lazy" />
          </button>
        ))}
        <p className="lp-bo-name" key={hero} aria-hidden="true">{BO_CHARS[hero].name}</p>
        <div className="lp-bo-tabs" role="group" aria-label="Escolher personagem">
          {BO_CHARS.map((c, i) => (
            <button key={c.id} type="button" className={i === hero ? 'is-on' : ''} aria-pressed={i === hero} onClick={() => setHero(i)}>{c.name}</button>
          ))}
        </div>
      </div>
      <div className="lp-bo-center lp-reveal">
        <p className="lp-bo-kicker">RPG de mesa dentro do clube</p>
        <h2 id="bo-titulo" className="lp-bo-title">Blackout</h2>
        <p className="lp-copy">História, espécies, classes, itens e criação de personagem num compêndio só. A ficha fica salva, sai em PDF e as rolagens acontecem ali mesmo.</p>
        <div className="lp-bo-sheet" key={`s${hero}`} aria-live="polite">
          <p className="lp-bo-who"><b>{ch.name}</b><span>{ch.tag}</span></p>
          <ul className="lp-bo-stats">
            {ch.stats.map(([k, v], i) => (
              <li key={k} style={{ '--v': v / 100, '--i': i }}><span>{k}</span><i /><b>{v}</b></li>
            ))}
          </ul>
        </div>
        <ol className="lp-bo-feats">
          <li><b>Ficha</b><span>Monta o personagem passo a passo</span></li>
          <li><b>Trilha</b><span>A classe evolui com o personagem</span></li>
          <li><b>Rolagens</b><span>Dados na hora, sem sair da mesa</span></li>
        </ol>
        <button type="button" className={`lp-d20${crit}`} onClick={doRoll} aria-label={`Rolar um d20. Último resultado: ${roll}`}>
          <svg key={spin} viewBox="0 0 100 100" aria-hidden="true">
            <path d="M50 4 92 28v44L50 96 8 72V28z" />
            <path d="M50 4 30 40h40zM8 28l22 12M92 28 70 40M30 40 50 76 70 40M8 72l42 4 42-4M50 76v20M30 40 8 72M70 40l22 32" />
          </svg>
          <b aria-live="polite">{roll}</b>
          <small>{roll === 20 ? 'Crítico!' : roll === 1 ? 'Falha crítica' : 'Clique pra rolar'}</small>
        </button>
      </div>
    </section>
  );
}

// Captura do app ou, sem captura (art: 'type'), o nome em letras grandes.
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

const AppStage = forwardRef(function AppStage({ versions }, apiRef) {
  const sectionRef = useRef(null);
  const artRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setPinned(!mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!pinned) return undefined;
    const root = document.querySelector('.lp');
    const sec = sectionRef.current;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = sec.offsetTop; const span = sec.offsetHeight - root.clientHeight;
        const p = Math.min(1, Math.max(0, (root.scrollTop - top) / Math.max(1, span)));
        sec.style.setProperty('--stage', p.toFixed(4));
        setIndex(Math.min(APPS.length - 1, Math.floor(p * APPS.length)));
      });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [pinned]);

  const goTo = (i) => {
    const root = document.querySelector('.lp'); const sec = sectionRef.current;
    if (!sec) return;
    if (!pinned) { sec.querySelectorAll('li')[i]?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); return; }
    const span = sec.offsetHeight - root.clientHeight;
    root.scrollTo({ top: sec.offsetTop + span * ((i + 0.5) / APPS.length), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  useImperativeHandle(apiRef, () => ({ goTo }));

  // Banner inclina na direção do mouse.
  const onArtMove = (e) => {
    if (reducedMotion()) return;
    const el = artRef.current; const r = el.getBoundingClientRect();
    el.style.setProperty('--rx', `${(((e.clientY - r.top) / r.height) - 0.5) * -10}deg`);
    el.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width) - 0.5) * 14}deg`);
  };
  const onArtLeave = () => { const el = artRef.current; el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); };

  if (!pinned) {
    return (
      <section id="apps" ref={sectionRef} className="lp-apps-list" aria-labelledby="apps-titulo">
        <h2 id="apps-titulo" className="lp-display is-md">Tudo numa conta só</h2>
        <p className="lp-copy">A comunidade, o gerenciador de mods dos seus jogos e o RPG Blackout, com o mesmo login.</p>
        <ul>
          {APPS.map((a) => (
            <li key={a.id} style={{ '--c': a.color }}>
              <AppArt a={a} />
              <div><strong>{a.name}</strong><span>{a.what}</span><p>{a.line}</p><small>{a.note}</small></div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const app = APPS[index];
  return (
    <section id="apps" ref={sectionRef} className="lp-stage" style={{ '--c': app.color, height: `${APPS.length * 75 + 100}vh` }} aria-labelledby="apps-titulo">
      <div className="lp-stage-pin">
        <div className="lp-stage-bg" aria-hidden="true" />
        <div className="lp-stage-head">
          <h2 id="apps-titulo" className="lp-stage-kicker">O que tem no clube</h2>
          <div className="lp-stage-chips" role="tablist" aria-label="Escolher app">
            {APPS.map((a, i) => (
              <button key={a.id} type="button" role="tab" aria-selected={i === index} className={i === index ? 'is-on' : ''} style={{ '--c': a.color }} onClick={() => goTo(i)}>{a.verb}</button>
            ))}
          </div>
        </div>

        <div className="lp-stage-copy" key={app.id}>
          <span className="lp-stage-count" aria-hidden="true">{index + 1}<i>/{APPS.length}</i></span>
          <h3 className="lp-stage-name">{app.name}</h3>
          <p className="lp-stage-what">{app.what}</p>
          <p className="lp-stage-line">{app.line}</p>
          <p className="lp-stage-base">{app.note}</p>
        </div>

        <div className="lp-stage-art" ref={artRef} onPointerMove={onArtMove} onPointerLeave={onArtLeave}>
          {APPS.map((a, i) => (
            <figure key={a.id} className={`lp-window ${i === index ? 'is-on' : ''}`} aria-hidden={i !== index}>
              <div className="lp-window-bar">
                <img src={`/apps/${a.id}/icon.png`} alt="" width="18" height="18" />
                <span>{a.name}</span>
                <i /><i /><i />
              </div>
              <AppArt a={a} className={`lp-window-shot ${a.shot || a.art ? '' : 'is-banner'}`} alt={i === index ? `${a.name} aberto` : ''} eager={i < 2} />
            </figure>
          ))}
        </div>

        <div className="lp-stage-rail" aria-hidden="true"><span /></div>
      </div>
    </section>
  );
});

// ---------- O app ao vivo (abertura) ----------
// Réplica em HTML da tela de chat do app: a conversa acontece sozinha, com
// "digitando", reação somando e quem fala na call acendendo. Sem
// movimento reduzido a conversa continua, só sem deslizar.
const LIVE_PEOPLE = {
  rique: { name: 'RiqueBitt', color: '#f08a3c', bg: 'linear-gradient(135deg,#8a1c1c,#4a0d0d)', mod: true },
  lia: { name: 'Lia', color: '#fff', bg: 'linear-gradient(135deg,#7c8cff,#4C9FFF)' },
  kaio: { name: 'Kaio', color: '#fff', bg: 'linear-gradient(135deg,#23a55a,#0f5c32)' },
  loritta: { name: 'Loritta', color: '#7cb3ff', bg: 'linear-gradient(135deg,#f0a6d8,#b05fc0)', bot: true },
};
const LIVE_SCRIPT = [
  { who: 'lia', time: '18:14', text: 'alguém pra call hoje à noite?' },
  { who: 'rique', time: '18:15', text: 'bora! abro a sala de voz às 21h', typing: 900 },
  { who: 'kaio', time: '18:16', text: 'baixei o modpack pelo Mod Manager, já tá rodando aqui', typing: 1500 },
  { who: 'loritta', time: '18:20', text: 'Lembrete: o evento de figurinhas começa amanhã 🎉', typing: 700, reactions: true },
];

function LiveAvatar({ who, size = 36 }) {
  const p = LIVE_PEOPLE[who];
  return <i className="lc-av" style={{ background: p.bg, width: size, height: size }} aria-hidden="true">{p.name[0]}</i>;
}

function LiveReactions() {
  const [party, setParty] = useState(14);
  const [like, setLike] = useState(2);
  useEffect(() => {
    const a = setTimeout(() => setParty(15), 900);
    const b = setTimeout(() => setLike(3), 1700);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return (
    <span className="lc-reacts">
      <b className={like > 2 ? 'is-mine' : ''} key={`l${like}`}>👍 {like}</b>
      <b key={`p${party}`}>🎉 {party}</b>
    </span>
  );
}

function LiveClub() {
  const [count, setCount] = useState(0);
  const [typing, setTyping] = useState(null);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    let alive = true; const timers = [];
    const wait = (ms) => new Promise((r) => { timers.push(setTimeout(r, ms)); });
    (async () => {
      await wait(700);
      while (alive) {
        for (let i = 0; i < LIVE_SCRIPT.length && alive; i += 1) {
          const m = LIVE_SCRIPT[i];
          if (m.typing) { setTyping(m.who); await wait(m.typing); setTyping(null); }
          setCount(i + 1);
          await wait(1500);
        }
        await wait(4200); if (!alive) break;
        setFading(true); await wait(500);
        setCount(0); setFading(false); await wait(600);
      }
    })();
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, []);

  return (
    <figure className="lp-hero-shot lc" aria-label="Prévia do Project Club: canal chat geral com uma conversa acontecendo e três pessoas na sala de voz">
      <div className="lc-top" aria-hidden="true"><span className="lc-hash">#</span> 🌎 | chat geral<span className="lc-online"><i />4 online</span></div>
      <div className="lc-body" aria-hidden="true">
        <aside className="lc-side">
          <p className="lc-cat">Comunidade</p>
          <p className="lc-ch is-on"># 🌎 | chat geral</p>
          <p className="lc-ch"># 🔧 | comandos</p>
          <p className="lc-ch"># 📸 | mídias</p>
          <p className="lc-cat">Canais de voz</p>
          <p className="lc-ch">🔊 ☕ | Call</p>
          <ul className="lc-voice">
            {['rique', 'lia', 'kaio'].map((w, i) => (
              <li key={w} style={{ '--d': `${i * 1.6}s` }}><LiveAvatar who={w} size={22} />{LIVE_PEOPLE[w].name}</li>
            ))}
          </ul>
        </aside>
        <div className={`lc-chat ${fading ? 'is-fading' : ''}`}>
          <p className="lc-day"><span>Hoje</span></p>
          {LIVE_SCRIPT.slice(0, count).map((m) => {
            const p = LIVE_PEOPLE[m.who];
            return (
              <div className="lc-msg" key={m.who + m.time}>
                <LiveAvatar who={m.who} />
                <div>
                  <p className="lc-meta"><b style={{ color: p.color }}>{p.name}</b>{p.mod && <span className="lc-badge">MOD</span>}{p.bot && <span className="lc-badge is-bot">BOT</span>}<time>{m.time}</time></p>
                  <p className="lc-text">{m.text}</p>
                  {m.reactions && <LiveReactions />}
                </div>
              </div>
            );
          })}
          <p className={`lc-typing ${typing ? 'is-on' : ''}`}>{typing && <><span className="lc-dots"><i /><i /><i /></span><b>{LIVE_PEOPLE[typing].name}</b> está digitando…</>}</p>
          <div className="lc-input">Conversar em # 🌎 | chat geral</div>
        </div>
      </div>
    </figure>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  useReveal();
  usePublicScrollChrome();
  const [platform] = useState(detectPlatform);
  const [copied, setCopied] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const stageRef = useRef(null);
  const versions = useVersions();
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
    { key: 'go-bo', label: 'RPG Blackout', hint: 'Fichas, classes e rolagens', glyph: '◆', run: () => jump('blackout') },
    { key: 'go-com', label: 'Comunidade', hint: 'Chat, voz, fórum e conquistas', glyph: '#', run: () => jump('comunidade') },
    { key: 'go-faq', label: 'Perguntas', hint: 'Preço, requisitos e atualizações', glyph: '?', run: () => jump('perguntas') },
    { key: 'go-blog', label: 'Blog', hint: 'O guia completo do Project Club', glyph: '¶', run: () => navigate('/blog') },
    { key: 'go-terms', label: 'Termos de privacidade', hint: 'Termos de uso e dados', glyph: '§', run: () => navigate('/termos') },
  ];

  const goLogin = () => navigate(user ? '/inicio' : '/login');
  const goRegister = () => navigate(user ? '/inicio' : '/register');
  const copyLink = async () => {
    try { await navigator.clipboard.writeText('https://projectclub.shardweb.app'); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* sem área de transferência */ }
  };

  return (
    <div className="lp">
      <a className="lp-skip" href="#conteudo">Pular para o conteúdo</a>
      <div className="lp-progress" aria-hidden="true" />
      <div className="lp-grain" aria-hidden="true" />

      <PublicHeader page="inicio" onSearch={() => setCmdOpen(true)} />

      <main id="conteudo">
        <section className="lp-hero" aria-labelledby="titulo">
          <div className="lp-hero-text">
            <h1 id="titulo" className="lp-display lp-words" aria-label="Parece Discord por fora. É nosso por dentro."><span aria-hidden="true" style={{ '--i': 0 }}>Parece</span> <span aria-hidden="true" style={{ '--i': 1 }}>Discord</span> <span aria-hidden="true" style={{ '--i': 2 }}>por</span> <span aria-hidden="true" style={{ '--i': 3 }}>fora.</span> <span aria-hidden="true" style={{ '--i': 4 }}>É</span> <span aria-hidden="true" style={{ '--i': 5 }}>nosso</span> <span aria-hidden="true" style={{ '--i': 6 }}>por</span> <span aria-hidden="true" style={{ '--i': 7 }}>dentro.</span></h1>
            <p className="lp-lede">
              O Project Club junta chat, salas de voz e fórum com o Mod Manager para os mods dos seus jogos e o RPG Blackout. Tudo de graça, no computador, no celular e no navegador.
            </p>
            <div className="lp-hero-cta">
              {platform ? (
                <a className="lp-btn is-accent is-lg" href={DOWNLOADS[platform]} download>
                  <Mark name={platform} size={20} /> Baixar para {PLATFORM_LABEL[platform]}
                </a>
              ) : (
                <button type="button" className="lp-btn is-accent is-lg" onClick={goRegister}>{user ? 'Voltar pro app' : 'Criar conta grátis'}</button>
              )}
              <a className="lp-btn is-ghost is-lg" href="#download">Outros sistemas</a>
            </div>
            <Pulse />
          </div>
          <LiveClub />
        </section>

        <AppStage ref={stageRef} versions={versions} />

        <BlackoutTable />

        <section id="comunidade" className="lp-band" aria-labelledby="com-titulo">
          <div className="lp-split">
            <h2 id="com-titulo" className="lp-display is-md lp-reveal">Conversa de verdade</h2>
            <div className="lp-reveal">
              <p className="lp-copy">
                Canais de texto e de voz, um fórum com temas, amigos, conquistas e uma economia com moedas, casas e figurinhas. Parece Discord por fora, mas é nosso por dentro: a gente decide o que entra.
              </p>
              <ul className="lp-perks">
                <li data-spot>
                  <div className="lp-perk-demo is-typing" aria-hidden="true"><span className="lp-perk-dots"><i /><i /><i /></span>Rique está digitando</div>
                  <b>Tempo real</b><p>Mensagens, voz e presença atualizam na hora, sem recarregar.</p>
                </li>
                <li data-spot>
                  <div className="lp-perk-demo is-trophy" aria-hidden="true"><span className="lp-perk-ring">18</span>conquistas, com raridades</div>
                  <b>Conquistas</b><p>18 para desbloquear, com raridades e destaque no perfil.</p>
                </li>
                <li data-spot>
                  <div className="lp-perk-demo is-profile" aria-hidden="true"><span className="lp-perk-avatar" /><span className="lp-perk-swatches"><i /><i /><i /><i /></span></div>
                  <b>Perfil seu</b><p>Cor, banner, conexões e o que você quiser mostrar.</p>
                </li>
                <li data-spot>
                  <div className="lp-perk-demo is-code" aria-hidden="true">{'482913'.split('').map((d, i) => <i key={i} style={{ '--i': i }}>{d}</i>)}</div>
                  <b>Segurança</b><p>Verificação em duas etapas, sessões por aparelho e moderação ativa.</p>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="download" className="lp-band is-tint" aria-labelledby="dl-titulo">
          <div className="lp-band-head lp-reveal">
            <h2 id="dl-titulo" className="lp-display is-md">Escolha o seu sistema</h2>
            <p className="lp-copy">No computador vem também o Mod Manager. No celular e no navegador você usa a comunidade.</p>
          </div>
          <div className="lp-dl lp-reveal">
            <a data-spot className={`lp-dl-card ${platform === 'windows' ? 'is-you' : ''}`} href={DOWNLOADS.windows} download>
              <Mark name="windows" size={28} />
              <strong>Windows</strong>
              <span>Instalador .exe para Windows 10 e 11</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <a data-spot className={`lp-dl-card ${platform === 'linux' ? 'is-you' : ''}`} href={DOWNLOADS.linux} download>
              <Mark name="linux" size={28} />
              <strong>Linux</strong>
              <span>AppImage para x86_64</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <a data-spot className={`lp-dl-card ${platform === 'android' ? 'is-you' : ''}`} href={DOWNLOADS.android} download>
              <Mark name="android" size={28} />
              <strong>Android</strong>
              <span>Arquivo .apk, instalação manual</span>
              <em>Baixar <Ico name="download" size={15} /></em>
            </a>
            <button type="button" data-spot className="lp-dl-card" onClick={goLogin}>
              <Mark name="browser" size={28} />
              <strong>Navegador</strong>
              <span>Sem instalar nada, em qualquer aparelho</span>
              <em>{user ? 'Abrir' : 'Entrar'}</em>
            </button>
          </div>
          <p className="lp-fine lp-reveal">
            Os arquivos vêm das versões publicadas no GitHub e se atualizam sozinhos depois de instalados. No Android, permita a instalação de apps fora da loja quando o sistema pedir.
          </p>
        </section>

        <section id="perguntas" className="lp-band" aria-labelledby="faq-titulo">
          <div className="lp-split">
            <h2 id="faq-titulo" className="lp-display is-md lp-reveal">Antes de entrar</h2>
            <div className="lp-faq lp-reveal">
              <details>
                <summary>Custa alguma coisa?</summary>
                <p>Não. A conta, a comunidade e todos os apps são gratuitos. Não tem plano pago nem anúncio.</p>
              </details>
              <details>
                <summary>Preciso do app para computador?</summary>
                <p>Só para o Mod Manager. A comunidade funciona no navegador e no Android também, inclusive com chamada de voz em segundo plano.</p>
              </details>
              <details>
                <summary>Como o app se atualiza?</summary>
                <p>Sozinho. O Project Club busca a versão nova ao abrir e instala quando você fecha.</p>
              </details>
              <details>
                <summary>Roda em PC fraco?</summary>
                <p>Sim. A comunidade abre em qualquer navegador atual e no Android, e o app para computador roda em Windows 10 ou 11 de 64 bits e em Linux.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="lp-end" aria-labelledby="fim-titulo">
          <h2 id="fim-titulo" className="lp-display is-lg lp-reveal">Vem pro clube</h2>
          <div className="lp-hero-cta lp-reveal">
            <button type="button" className="lp-btn is-accent is-lg" onClick={goRegister}>{user ? 'Voltar pro app' : 'Criar conta'}</button>
            <button type="button" className="lp-btn is-ghost is-lg" onClick={copyLink}>{copied ? 'Link copiado' : 'Copiar o link do site'}</button>
          </div>
        </section>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onPickApp={(i) => stageRef.current?.goTo(i)} actions={cmdActions} />

      <PublicFooter page="inicio" />
    </div>
  );
}
