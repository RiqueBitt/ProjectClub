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
    const root = document.querySelector('.lp');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { root, threshold: 0.12 });
    document.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
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
  if (!pulse) return null;
  return (
    <p className="lp-pulse" aria-live="polite">
      <span className="lp-pulse-item"><i className="lp-pulse-dot" aria-hidden="true" /><b><CountUp value={pulse.online} /></b> {pulse.online === 1 ? 'pessoa online agora' : 'pessoas online agora'}</span>
      <span className="lp-pulse-item"><b><CountUp value={pulse.members} /></b> membros</span>
      <span className="lp-pulse-item"><b><CountUp value={pulse.messagesToday} /></b> mensagens hoje</span>
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

// ---------- Abertura: órbita 3D dos apps ----------
// Cada ícone anda numa elipse em volta do título. Quando passa "atrás"
// (metade de cima da elipse) fica menor, mais escuro e abaixo das letras;
// na frente, maior e por cima. A elipse inclina conforme o mouse.
// O que gira em volta do nome: peças de tecnologia do clube (voz, chat,
// mods, dados, nuvem...) em dois anéis que giram em sentidos opostos.
const TECH = [
  { k: 'chat', c: '#5b8cff', d: 'M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5' },
  { k: 'mic', c: '#22d3ee', d: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6' },
  { k: 'pad', c: '#a78bfa', d: 'M7 8h10a5 5 0 0 1 4.6 7l-.7 1.7a2.2 2.2 0 0 1-3.8.4L15.5 15h-7l-1.6 2.1a2.2 2.2 0 0 1-3.8-.4L2.4 15A5 5 0 0 1 7 8zM7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01' },
  { k: 'mods', c: '#ff5c93', d: 'M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3h1a2 2 0 1 0 0-4H6V6a1 1 0 0 1 1-1h3z' },
  { k: 'd20', c: '#ff3b3b', d: 'M12 2.5 20.5 7.3v9.4L12 21.5 3.5 16.7V7.3zM12 2.5 8 9.5h8zM3.5 7.3 8 9.5M20.5 7.3 16 9.5M8 9.5l4 7 4-7M12 16.5v5' },
  { k: 'cloud', c: '#7dd3fc', d: 'M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18z' },
  { k: 'code', c: '#4ade80', d: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16' },
  { k: 'shield', c: '#facc15', d: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4' },
  { k: 'bolt', c: '#fb923c', d: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  { k: 'chip', c: '#c4b5fd', d: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4' },
];
const TAGS = ['Voz em HD', 'Tempo real', 'Mods', 'RPG', 'Fórum', 'Loja', 'Modpacks', 'Conquistas'];

function Orbit() {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const items = [...box.querySelectorAll('[data-ring]')];
    const rings = [...box.querySelectorAll('.lp-ring')];
    const count = { 0: 0, 1: 0 };
    items.forEach((el) => { count[el.dataset.ring] += 1; });
    const still = reducedMotion();
    let t = 0; let raf = 0; let last = performance.now();
    let tiltX = 0; let tiltY = 0; let wantX = 0; let wantY = 0;
    const onMove = (e) => {
      const r = box.getBoundingClientRect();
      wantX = ((e.clientX - r.left) / r.width - 0.5) * 2;
      wantY = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    const place = () => {
      const w = box.clientWidth; const h = box.clientHeight;
      const R = [
        { rx: Math.min(w * 0.47, 780), ry: Math.min(h * 0.26, 180), dir: 1, off: 0.1 },
        { rx: Math.min(w * 0.33, 520), ry: Math.min(h * 0.16, 110), dir: -1.35, off: 0.02 },
      ];
      rings.forEach((el, i) => {
        const r = R[i];
        el.style.width = `${r.rx * 2}px`; el.style.height = `${r.ry * 2 * (1 + tiltY * 0.3)}px`;
        el.style.transform = `translate(-50%, calc(-50% + ${(h * r.off).toFixed(1)}px)) rotate(${(tiltX * 3).toFixed(2)}deg)`;
      });
      const idx = { 0: 0, 1: 0 };
      items.forEach((el) => {
        const ring = el.dataset.ring;
        const r = R[ring];
        const i = idx[ring]++;
        const a = t * r.dir + (i / count[ring]) * Math.PI * 2 + ring * 0.4;
        const depth = Math.sin(a);
        const x = Math.cos(a) * r.rx;
        const y = depth * r.ry * (1 + tiltY * 0.3) + h * r.off + tiltX * Math.cos(a) * 22;
        const s = 0.6 + (depth + 1) * 0.27;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
        el.style.zIndex = depth > 0 ? 3 : 1;
        el.style.setProperty('--depth', ((depth + 1) / 2).toFixed(3));
      });
    };
    const loop = (now) => {
      const dt = Math.min(64, now - last); last = now;
      t += dt * 0.00011;
      tiltX += (wantX - tiltX) * 0.05; tiltY += (wantY - tiltY) * 0.05;
      place();
      raf = requestAnimationFrame(loop);
    };
    if (still) { place(); return undefined; }
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); };
  }, []);
  return (
    <div className="lp-orbit" ref={ref} aria-hidden="true">
      <span className="lp-ring is-outer" />
      <span className="lp-ring is-inner" />
      {TECH.map((it, i) => (
        <span key={it.k} data-ring="0" className="lp-orbit-item" style={{ '--c': it.c, '--i': i }}>
          <span className="lp-tech"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={it.d} /></svg></span>
        </span>
      ))}
      {TAGS.map((tg, i) => (
        <span key={tg} data-ring="1" className="lp-orbit-item is-tag" style={{ '--i': i + TECH.length }}><span className="lp-tag"><i />{tg}</span></span>
      ))}
    </div>
  );
}

// ---------- Brasas ----------
// Faíscas subindo devagar atrás do título (canvas leve, pausa fora da tela).
function Embers({ count = 70 }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || reducedMotion()) return undefined;
    const ctx = cv.getContext('2d');
    let w = 0; let h = 0; let raf = 0; let on = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => { w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const spawn = (p = {}) => Object.assign(p, {
      x: Math.random() * w, y: h + Math.random() * h * 0.6, r: 0.6 + Math.random() * 2.2,
      vy: 0.25 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 0.3, t: Math.random() * 6.28,
      hue: Math.random() < 0.72 ? 8 + Math.random() * 26 : 205 + Math.random() * 20, life: 0.4 + Math.random() * 0.6,
    });
    const ps = Array.from({ length: count }, () => { const p = spawn(); p.y = Math.random() * h; return p; });
    const tick = () => {
      if (!on) return;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of ps) {
        p.t += 0.02; p.y -= p.vy; p.x += p.vx + Math.sin(p.t) * 0.35;
        if (p.y < -10) spawn(p);
        const a = Math.max(0, Math.min(1, (p.y / h) * 1.6)) * p.life;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${a})`);
        g.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.283); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(tick); });
    io.observe(cv);
    window.addEventListener('resize', size);
    return () => { on = false; cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', size); };
  }, [count]);
  return <canvas ref={ref} className="lp-embers" aria-hidden="true" />;
}

// Faixa que corre entre as seções.
function Marquee({ words }) {
  const row = words.map((w, i) => <span key={i}>{w}<i aria-hidden="true">✦</i></span>);
  return (
    <div className="lp-marquee" aria-hidden="true">
      <div className="lp-marquee-track">{row}{row}</div>
    </div>
  );
}

// ---------- Mesa do BLACKOUT ----------
// Os dois personagens grandes e um d20 que rola de verdade (clique).
function BlackoutTable() {
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
  return (
    <section id="blackout" className="lp-bo" aria-labelledby="bo-titulo">
      <div className="lp-bo-bg" aria-hidden="true" />
      <img className="lp-bo-char is-l" src="/site/personagens/bruxo.webp" alt="" loading="lazy" />
      <img className="lp-bo-char is-r" src="/site/personagens/sacerdotisa.webp" alt="" loading="lazy" />
      <div className="lp-bo-center lp-reveal">
        <p className="lp-bo-kicker">RPG de mesa dentro do clube</p>
        <h2 id="bo-titulo" className="lp-bo-title" data-text="BLACKOUT">BLACKOUT</h2>
        <p className="lp-copy">História, espécies, classes, itens e criação de personagem num compêndio só. A ficha fica salva, sai em PDF e as rolagens acontecem ali mesmo.</p>
        <ul className="lp-bo-feats">
          <li><b>Ficha</b><span>Monta o personagem passo a passo</span></li>
          <li><b>Trilha</b><span>A classe evolui com o personagem</span></li>
          <li><b>Rolagens</b><span>Dados na hora, sem sair da mesa</span></li>
        </ul>
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

function Letters({ text, start = 0 }) {
  return (
    <span className="lp-word" aria-hidden="true">
      {[...text].map((ch, i) => <span key={i} className="lp-char" style={{ '--d': `${start + i * 55}ms` }}>{ch}</span>)}
    </span>
  );
}

// ---------- Palco dos apps ----------
// A seção é alta (um "andar" por app) e o palco fica preso na tela; a
// posição da rolagem escolhe o app. Os ícones ao lado levam direto a cada um.
const AppStage = forwardRef(function AppStage({ versions }, apiRef) {
  const sectionRef = useRef(null);
  const artRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px), (prefers-reduced-motion: reduce)');
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
          <div className="lp-hero-glow" aria-hidden="true" />
          <div className="lp-hero-grid" aria-hidden="true" />
          <Embers />
          <div className="lp-hero-stage">
            <Orbit />
            <h1 id="titulo" className="lp-display" aria-label="Project Club"><Letters text="Project" /> <Letters text="Club" start={420} /></h1>
          </div>
          <div className="lp-hero-foot">
            <p className="lp-lede">
              Uma comunidade com chat, voz e fórum, o Mod Manager para os mods dos seus jogos e o RPG Blackout. Tudo de graça.
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
          <a className="lp-scroll-hint" href="#apps" aria-label="Ver os apps"><span /></a>
        </section>

        <Marquee words={['Comunidade', 'Chat de voz', 'Mod Manager', 'Fórum', 'RPG Blackout', 'Loja', 'Conquistas', 'Amigos', 'Modpacks']} />

        <AppStage ref={stageRef} versions={versions} />

        <BlackoutTable />

        <section id="comunidade" className="lp-band" aria-labelledby="com-titulo">
          <div className="lp-split">
            <h2 id="com-titulo" className="lp-display is-md lp-reveal">Conversa de verdade</h2>
            <div className="lp-reveal">
              <p className="lp-copy">
                Canais de texto e de voz, um fórum com temas, amigos, conquistas e uma economia com moedas, casas e figurinhas. Parece Discord por fora, mas é nosso por dentro: a gente decide o que entra.
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
