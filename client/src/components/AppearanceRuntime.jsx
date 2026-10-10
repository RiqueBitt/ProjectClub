// Tudo que "Personalizar layout" precisa rodar fora da tela de
// Configurações: aplica as preferências no <html> (useApplyAppearance,
// usado em App.jsx) e os extras da casca do app (AppShellExtras, montado
// em MainApp.jsx): link "Pular para o conteúdo", modo foco, botão no
// topo, enfeite sazonal, fundo animado, arrastar a largura da coluna,
// memória de página/rolagem e atalhos de voltar/avançar no app desktop.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import {
  applyLayoutPrefs, sameLayoutPrefs, isDefaultLayoutPrefs, SEASONS,
  SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, rememberPath, saveScrollPosition, readScrollPosition,
} from '../utils/appearance';
import '../styles/appearance.css';

// Ícones locais (traço, mesmo estilo de PageIcons.jsx).
const ICONS = {
  focus: 'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4',
  unfocus: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18M15 3v18',
  natal: 'M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5',
  anonovo: 'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6z',
  carnaval: 'M3 8c3-2 6-2 9 0s6 2 9 0M5 12.5c2.5 1.6 4.8 1.7 7 .4M12 13c2.2 1.3 4.5 1.2 7-.4M8 16.5l-1 4M16 16.5l1 4M12 17v4',
  halloween: 'M12 7c-4.4 0-8 3-8 6.8S7.6 20 12 20s8-2.4 8-6.2S16.4 7 12 7zM12 7V4.5c0-.8.6-1.5 1.5-1.5M9 12.5l1 1.2M15 12.5l-1 1.2M9 16.5c1.8 1 4.2 1 6 0',
  aniversario: 'M4 21h16M5 21v-7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v7M5 16.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 13V9M12 6.5c-.8 0-1.3-.6-1.3-1.3S12 3 12 3s1.3 1.5 1.3 2.2-.5 1.3-1.3 1.3z',
};

function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const isEditable = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Aplica as preferências no <html> sempre que mudam (em qualquer tela,
// inclusive login). Também adota as preferências salvas na conta assim
// que elas chegam do servidor.
export function useApplyAppearance() {
  const layoutPrefs = useStore((s) => s.layoutPrefs);
  const reducedMotion = useStore((s) => !!s.userSettings?.reducedMotion);
  const serverPrefs = useStore((s) => s.userSettings?.layoutPrefs);
  const settingsLoaded = useStore((s) => !!s.userSettings);
  const adoptedRef = useRef(false);
  const [mqTick, setMqTick] = useState(0);

  // Muda junto quando o sistema liga/desliga "reduzir movimento".
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setMqTick((n) => n + 1);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    applyLayoutPrefs(layoutPrefs, { reducedMotion });
  }, [layoutPrefs, reducedMotion, mqTick]);

  // A conta é a fonte de verdade: na primeira carga, usa o que está
  // salvo lá; se a conta ainda não tem nada e este aparelho já tem algo
  // diferente do padrão, sobe o valor local pra conta.
  useEffect(() => {
    if (!settingsLoaded || adoptedRef.current) return;
    adoptedRef.current = true;
    const { layoutPrefs: local, setLayoutPrefs } = useStore.getState();
    if (serverPrefs && typeof serverPrefs === 'object') {
      if (!sameLayoutPrefs(serverPrefs, local)) setLayoutPrefs(serverPrefs, { local: true });
    } else if (!isDefaultLayoutPrefs(local)) {
      setLayoutPrefs({}, { delay: 0 });
    }
  }, [settingsLoaded, serverPrefs]);
}

// ---------- Fundo animado ----------
function GradientBackdrop() {
  return (
    <div className="pc-anim-bg pc-anim-bg-gradient" aria-hidden="true">
      <span className="pc-blob pc-blob-a" />
      <span className="pc-blob pc-blob-b" />
      <span className="pc-blob pc-blob-c" />
    </div>
  );
}

// Partículas lentas num canvas pequeno: ~20 quadros por segundo, pausa
// com a aba escondida, poucas partículas — quase nada de CPU.
function ParticlesBackdrop() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0; let h = 0;
    let parts = [];
    const color = () => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#5865f2';
    let brand = color();
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(46, Math.round((w * h) / 42000));
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 1 + Math.random() * 2.6,
        vx: (Math.random() - 0.5) * 0.18, vy: -0.08 - Math.random() * 0.22,
        a: 0.18 + Math.random() * 0.4,
      }));
    };
    resize();
    let timer = null; let raf = null; let frame = 0;
    const draw = () => {
      frame += 1;
      if (frame % 60 === 0) brand = color();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = brand;
      for (const p of parts) {
        p.x += p.vx * 3; p.y += p.vy * 3;
        if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w; }
        if (p.x < -6) p.x = w + 6; else if (p.x > w + 6) p.x = -6;
        ctx.globalAlpha = p.a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    const loop = () => {
      timer = setTimeout(() => { raf = requestAnimationFrame(() => { draw(); loop(); }); }, 50);
    };
    const stop = () => { clearTimeout(timer); cancelAnimationFrame(raf); timer = null; };
    const onVisibility = () => { if (document.hidden) stop(); else if (!timer) loop(); };
    draw(); loop();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return <canvas ref={canvasRef} className="pc-anim-bg pc-anim-bg-particles" aria-hidden="true" />;
}

function AnimatedBackground({ mode }) {
  // O atributo no <html> já leva em conta o "reduzir movimento".
  const [active, setActive] = useState(() => document.documentElement.getAttribute('data-pc-anim-bg'));
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setActive(html.getAttribute('data-pc-anim-bg'));
    read();
    const obs = new MutationObserver(read);
    obs.observe(html, { attributes: true, attributeFilter: ['data-pc-anim-bg'] });
    return () => obs.disconnect();
  }, [mode]);
  if (active === 'gradient') return <GradientBackdrop />;
  if (active === 'particles') return <ParticlesBackdrop />;
  return null;
}

// ---------- Portal pra dentro da barra do topo ----------
// Procura o container de ações do topo (TopSearchBar) e acompanha se
// ele for recriado; sem ele, o botão não aparece (nada quebra).
function useTopBarSlot() {
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    const find = () => {
      const el = document.querySelector('.app-shell .top-search-bar-actions');
      setSlot((prev) => (prev === el ? prev : el));
    };
    find();
    const shell = document.querySelector('.app-shell');
    if (!shell) return undefined;
    const obs = new MutationObserver(find);
    obs.observe(shell, { childList: true, subtree: false });
    const topBar = shell.querySelector('.top-search-bar');
    if (topBar) obs.observe(topBar, { childList: true });
    return () => obs.disconnect();
  }, []);
  return slot;
}

function TopBarExtras({ focusMode, onToggleFocus, season }) {
  const slot = useTopBarSlot();
  if (!slot) return null;
  const info = season ? SEASONS[season] : null;
  return createPortal(
    <span className="pc-topbar-extras">
      {info && (
        <span className={`pc-season-badge pc-season-${season}`} title={`${info.label}: ${info.greeting}`} role="img" aria-label={info.greeting}>
          <Icon name={season} size={16} />
        </span>
      )}
      <button
        type="button"
        className={`top-search-bar-icon-btn pc-focus-btn ${focusMode ? 'is-on' : ''}`}
        onClick={onToggleFocus}
        aria-pressed={focusMode}
        title={focusMode ? 'Sair do modo foco (Esc)' : 'Modo foco (Ctrl+Shift+F)'}
        aria-label={focusMode ? 'Sair do modo foco' : 'Ativar modo foco'}
      >
        <Icon name={focusMode ? 'unfocus' : 'focus'} />
      </button>
    </span>,
    slot,
  );
}

// ---------- Alça pra arrastar a largura da coluna (Normal 2.0, PC) ----------
function SidebarResizeHandle() {
  const [host, setHost] = useState(null);
  const sidebarWidth = useStore((s) => s.layoutPrefs.sidebarWidth);
  useEffect(() => {
    const find = () => setHost(document.querySelector('.app-shell.layout-n2 > .n2-sidebar'));
    find();
    const shell = document.querySelector('.app-shell');
    if (!shell) return undefined;
    const obs = new MutationObserver(find);
    obs.observe(shell, { childList: true });
    return () => obs.disconnect();
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== 0 || !host) return;
    e.preventDefault();
    const html = document.documentElement;
    const rect = host.getBoundingClientRect();
    const startCss = parseFloat(getComputedStyle(host).width) || sidebarWidth;
    const ratio = rect.width / startCss || 1; // zoom da interface
    const startX = e.clientX;
    let next = startCss;
    html.setAttribute('data-pc-sidebar', '1');
    html.classList.add('pc-resizing');
    const move = (ev) => {
      next = Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startCss + (ev.clientX - startX) / ratio)));
      html.style.setProperty('--pc-sidebar-w', `${next}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      html.classList.remove('pc-resizing');
      useStore.getState().setLayoutPrefs({ sidebarWidth: next });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 24 : 8;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -step : step;
      useStore.getState().setLayoutPrefs({ sidebarWidth: Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, sidebarWidth + delta)) });
    }
  };

  if (!host) return null;
  return createPortal(
    <div
      className="pc-sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da coluna lateral"
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      title="Arraste para mudar a largura"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => useStore.getState().setLayoutPrefs({ sidebarWidth: 272 })}
    />,
    host,
  );
}

// ---------- Memória de rolagem por página ----------
const isChatPath = (p) => p.startsWith('/channels/') || p.startsWith('/conversations/');

function mainScroller() {
  const main = document.querySelector('.app-shell .app-main');
  if (!main) return null;
  let best = null; let bestArea = 0;
  main.querySelectorAll('*').forEach((el) => {
    if (el.scrollHeight <= el.clientHeight + 8 || el.closest('.message-list')) return;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') return;
    const area = el.clientWidth * el.clientHeight;
    if (area > bestArea) { best = el; bestArea = area; }
  });
  return best;
}

function useScrollMemory(pathname) {
  const lastTopRef = useRef({ path: pathname, top: 0 });
  // Guarda a rolagem atual da página (o chat cuida da própria rolagem).
  useEffect(() => {
    const onScroll = (e) => {
      const el = e.target;
      if (!(el instanceof Element) || !el.closest('.app-main') || el.closest('.message-list')) return;
      if (el.clientHeight < 200) return; // listas pequenas dentro da página
      lastTopRef.current = { path: lastTopRef.current.path, top: el.scrollTop };
    };
    document.addEventListener('scroll', onScroll, true);
    const onHide = () => {
      const { path, top } = lastTopRef.current;
      if (!isChatPath(path)) saveScrollPosition(path, top);
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  useEffect(() => {
    // Saindo da página anterior: salva onde ela estava.
    const prev = lastTopRef.current;
    if (prev.path !== pathname && !isChatPath(prev.path)) saveScrollPosition(prev.path, prev.top);
    lastTopRef.current = { path: pathname, top: 0 };
    rememberPath(pathname);
    if (isChatPath(pathname)) return undefined;
    const saved = readScrollPosition(pathname);
    if (!saved) return undefined;
    // A página pode demorar pra carregar o conteúdo: tenta por até ~2,5s,
    // e desiste se a pessoa começar a rolar sozinha.
    let tries = 0; let cancelled = false;
    const cancel = () => { cancelled = true; };
    window.addEventListener('wheel', cancel, { once: true, passive: true });
    window.addEventListener('touchstart', cancel, { once: true, passive: true });
    window.addEventListener('keydown', cancel, { once: true });
    const id = setInterval(() => {
      tries += 1;
      const el = mainScroller();
      if (!cancelled && el && el.scrollHeight - el.clientHeight >= saved - 4) {
        el.scrollTo({ top: saved, behavior: 'instant' });
        lastTopRef.current = { path: pathname, top: saved };
        cancelled = true;
      }
      if (cancelled || tries > 25) clearInterval(id);
    }, 100);
    return () => {
      clearInterval(id);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, [pathname]);
}

// ---------- Casca do app ----------
export default function AppShellExtras() {
  const location = useLocation();
  const navigate = useNavigate();
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const animatedBg = useStore((s) => s.layoutPrefs.animatedBg);
  const seasonal = useStore((s) => s.layoutPrefs.seasonal);
  const [season, setSeason] = useState(() => document.documentElement.getAttribute('data-pc-season') || null);

  useScrollMemory(location.pathname);

  // Estação atual (o atributo é calculado em applyLayoutPrefs).
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setSeason(html.getAttribute('data-pc-season') || null);
    read();
    const obs = new MutationObserver(read);
    obs.observe(html, { attributes: true, attributeFilter: ['data-pc-season'] });
    return () => obs.disconnect();
  }, [seasonal]);

  // Modo foco → classe no <html> (o CSS esconde as colunas laterais).
  useEffect(() => {
    document.documentElement.classList.toggle('pc-focus-mode', focusMode);
    return () => document.documentElement.classList.remove('pc-focus-mode');
  }, [focusMode]);

  // Atalhos: Ctrl+Shift+F (modo foco), Esc (sai do foco) e, no app
  // desktop, Alt+← / Alt+→ e os botões laterais do mouse (voltar/avançar).
  useEffect(() => {
    const isDesktopApp = !!window.electronAPI;
    const onKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'f') {
        e.preventDefault();
        const { focusMode: on, setFocusMode: setOn } = useStore.getState();
        setOn(!on);
        return;
      }
      if (e.key === 'Escape' && useStore.getState().focusMode && !e.defaultPrevented) {
        // Esc fecha primeiro qualquer janela/menu aberto; só depois sai do foco.
        if (isEditable(e.target) || document.querySelector('.modal-overlay, [role="dialog"], [role="menu"]')) return;
        useStore.getState().setFocusMode(false);
        return;
      }
      if (isDesktopApp && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (isEditable(e.target)) return;
        e.preventDefault();
        navigate(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const onMouseUp = (e) => {
      if (!isDesktopApp || (e.button !== 3 && e.button !== 4)) return;
      e.preventDefault();
      navigate(e.button === 3 ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [navigate]);

  const skipToContent = (e) => {
    e.preventDefault();
    const main = document.querySelector('.app-shell .app-main');
    if (!main) return;
    const target = main.querySelector('textarea, [contenteditable="true"]') || main;
    if (target === main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
  };

  return (
    <>
      <a href="#conteudo" className="pc-skip-link" onClick={skipToContent}>Pular para o conteúdo</a>
      <AnimatedBackground mode={animatedBg} />
      <TopBarExtras focusMode={focusMode} onToggleFocus={() => setFocusMode(!focusMode)} season={season} />
      {!focusMode && <SidebarResizeHandle />}
    </>
  );
}
