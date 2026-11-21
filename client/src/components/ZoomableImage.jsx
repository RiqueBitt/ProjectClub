import { useCallback, useEffect, useRef } from 'react';
import '../styles/lightbox-zoom.css';
import { cssZoom } from '../utils/cssZoom';

// Imagem ampliável do visualizador (ImageLightbox.jsx).
// Toque: pinça com dois dedos (zoom em volta do ponto entre os dedos, de 1x
// a 5x), arrastar com um dedo quando ampliada (sem deixar a imagem "sumir"
// da tela), toque duplo alterna 2,5x/1x no ponto tocado e deslizar pra baixo
// fecha (só sem zoom). PC: clique alterna 2,5x/1x no ponto clicado, roda do
// mouse amplia/reduz em volta do cursor e arrastar move a imagem ampliada.
// O transform é escrito direto no estilo (translate3d + scale) dentro de um
// requestAnimationFrame — nada de re-render do React a cada movimento.

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
const TAP_SLOP = 8;
const SWIPE_CLOSE_PX = 110;
const SWIPE_CLOSE_VELOCITY = 0.6; // px/ms
const ANIM_MS = 220;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export default function ZoomableImage({ src, alt, onClose }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  // Estado do transform (em pixels CSS, origem no centro da imagem).
  const view = useRef({ s: 1, x: 0, y: 0, swipe: 0 });
  const raf = useRef(0);
  const animTimer = useRef(0);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const mouse = useRef(null);
  const suppressClick = useRef(false);

  const write = useCallback(() => {
    raf.current = 0;
    const img = imgRef.current;
    if (!img) return;
    const { s, x, y, swipe } = view.current;
    img.style.transform = `translate3d(${x}px, ${y + swipe}px, 0) scale(${s})`;
    img.dataset.scale = s.toFixed(3);
    img.dataset.tx = x.toFixed(1);
    img.dataset.ty = y.toFixed(1);
    img.classList.toggle('is-zoomed', s > 1.01);
    const overlay = stageRef.current?.parentElement;
    if (overlay) {
      const fade = swipe > 0 ? clamp(1 - swipe / 400, 0.25, 1) : 1;
      overlay.style.setProperty('--lightbox-fade', String(fade));
    }
  }, []);
  const schedule = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(write); }, [write]);

  // Liga a transição curta (toque duplo, voltar ao lugar) só nesse instante —
  // durante o gesto o transform segue o dedo sem atraso nenhum.
  const animate = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    img.classList.add('animating');
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => img.classList.remove('animating'), ANIM_MS + 30);
  }, []);

  // Medidas em pixels CSS (o zoom da interface via CSS divide tudo).
  const metrics = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return null;
    const z = cssZoom();
    const sr = stage.getBoundingClientRect();
    const left = sr.left / z;
    const top = sr.top / z;
    // Caixa da imagem SEM o transform (offset* ignora transform): o centro
    // dela é a origem da escala.
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    return {
      z,
      cx: left + img.offsetLeft + w / 2,
      cy: top + img.offsetTop + h / 2,
      w, h,
      left, top, right: sr.right / z, bottom: sr.bottom / z,
    };
  }, []);

  // Mantém a imagem cobrindo a tela quando maior que ela, ou centralizada
  // quando menor — nunca dá pra arrastar a imagem pra fora.
  const bound = useCallback((s, x, y, m = metrics()) => {
    if (!m) return { x, y };
    const W = m.w * s;
    const H = m.h * s;
    const fit = (t, c, size, lo, hi) => {
      const min = hi - c - size / 2;
      const max = lo - c + size / 2;
      if (min > max) return (lo + hi) / 2 - c;
      return clamp(t, min, max);
    };
    return { x: fit(x, m.cx, W, m.left, m.right), y: fit(y, m.cy, H, m.top, m.bottom) };
  }, [metrics]);

  // Escala em volta de um ponto da tela (pixels CSS): o ponto da imagem
  // que estava sob ele continua sob ele.
  const zoomAround = useCallback((nextScale, px, py, base = view.current, m = metrics()) => {
    if (!m) return;
    const s1 = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const k = s1 / base.s;
    const x = px - m.cx - k * (px - m.cx - base.x);
    const y = py - m.cy - k * (py - m.cy - base.y);
    const b = bound(s1, x, y, m);
    view.current = { ...view.current, s: s1, x: b.x, y: b.y };
    schedule();
  }, [bound, metrics, schedule]);

  const reset = useCallback((anim = true) => {
    if (anim) animate();
    view.current = { s: 1, x: 0, y: 0, swipe: 0 };
    schedule();
  }, [animate, schedule]);

  const toggleAt = useCallback((clientX, clientY) => {
    const z = cssZoom();
    animate();
    if (view.current.s > 1.01) reset(false);
    else zoomAround(DOUBLE_TAP_SCALE, clientX / z, clientY / z);
  }, [animate, reset, zoomAround]);

  // Imagem nova (setas de anterior/próxima): começa sem zoom.
  useEffect(() => {
    view.current = { s: 1, x: 0, y: 0, swipe: 0 };
    lastTap.current = null;
    schedule();
  }, [src, schedule]);

  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(animTimer.current); }, []);

  // Roda do mouse (listener nativo pra poder impedir a rolagem por trás).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const z = cssZoom();
      const factor = Math.exp(-clamp(e.deltaY, -100, 100) * 0.0025);
      zoomAround(view.current.s * factor, e.clientX / z, e.clientY / z);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // ---------- toque (pointer events com pointerType touch/pen) ----------
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const z = cssZoom();
    gesture.current = {
      type: 'pinch',
      d0: Math.max(1, dist(a, b)),
      m0: { x: mid(a, b).x / z, y: mid(a, b).y / z },
      base: { ...view.current },
      metrics: metrics(),
    };
  };
  const startPan = (p) => {
    gesture.current = {
      type: view.current.s > 1.01 ? 'pan' : 'maybe-swipe',
      x0: p.x, y0: p.y, t0: performance.now(),
      base: { ...view.current },
      metrics: metrics(),
      moved: false,
    };
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      mouse.current = { x: e.clientX, y: e.clientY, base: { ...view.current }, moved: false, metrics: metrics() };
      return;
    }
    if (e.target.closest?.('button, a')) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) startPinch();
    else if (pointers.current.size === 1) startPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e) => {
    if (e.pointerType === 'mouse') {
      const m = mouse.current;
      if (!m || !(e.buttons & 1)) return;
      const z = cssZoom();
      const dx = (e.clientX - m.x) / z;
      const dy = (e.clientY - m.y) / z;
      if (!m.moved && Math.hypot(dx, dy) < 4) return;
      m.moved = true;
      if (m.base.s <= 1.01) return;
      const b = bound(m.base.s, m.base.x + dx, m.base.y + dy, m.metrics);
      view.current = { ...view.current, x: b.x, y: b.y };
      schedule();
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const z = cssZoom();
    if (g.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const m1 = { x: mid(a, b).x / z, y: mid(a, b).y / z };
      const s1 = clamp(g.base.s * (dist(a, b) / g.d0), MIN_SCALE, MAX_SCALE);
      const k = s1 / g.base.s;
      const mm = g.metrics;
      if (!mm) return;
      // Ponto da imagem sob o meio inicial dos dedos acompanha o meio atual.
      const x = m1.x - mm.cx - k * (g.m0.x - mm.cx - g.base.x);
      const y = m1.y - mm.cy - k * (g.m0.y - mm.cy - g.base.y);
      const bb = bound(s1, x, y, mm);
      view.current = { ...view.current, s: s1, x: bb.x, y: bb.y };
      g.moved = true;
      schedule();
      return;
    }
    const dx = (e.clientX - g.x0) / z;
    const dy = (e.clientY - g.y0) / z;
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    g.moved = true;
    if (g.type === 'pan') {
      const b = bound(g.base.s, g.base.x + dx, g.base.y + dy, g.metrics);
      view.current = { ...view.current, x: b.x, y: b.y };
      schedule();
    } else if (g.type === 'maybe-swipe' || g.type === 'swipe') {
      // Sem zoom: só deslizar pra baixo (fechar) mexe na imagem.
      if (g.type === 'maybe-swipe') g.type = dy > 0 && Math.abs(dy) > Math.abs(dx) ? 'swipe' : 'none';
      if (g.type === 'swipe') {
        view.current = { ...view.current, swipe: Math.max(0, dy) };
        schedule();
      }
    }
  };

  const endTouch = (e, cancelled) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      // Saiu um dos dedos da pinça: continua arrastando com o que ficou,
      // a partir de onde está (sem pulo).
      const [p] = [...pointers.current.values()];
      startPan(p);
      gesture.current.moved = true;
      lastTap.current = null;
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g || cancelled) {
      if (view.current.swipe) { view.current.swipe = 0; animate(); schedule(); }
      return;
    }
    if (g.type === 'swipe') {
      const dt = Math.max(1, performance.now() - g.t0);
      const dy = view.current.swipe;
      if (dy > SWIPE_CLOSE_PX || dy / dt > SWIPE_CLOSE_VELOCITY) { onClose(); return; }
      view.current.swipe = 0;
      animate();
      schedule();
      return;
    }
    if (g.type === 'pinch' || g.moved) {
      if (view.current.s < 1.02) reset(true);
      return;
    }
    // Toque curto: segundo toque perto do primeiro = toque duplo.
    const now = performance.now();
    const t = { x: e.clientX, y: e.clientY, at: now };
    const prev = lastTap.current;
    if (prev && now - prev.at < DOUBLE_TAP_MS && dist(prev, t) < DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      toggleAt(e.clientX, e.clientY);
      return;
    }
    lastTap.current = t;
    // Toque simples no fundo (fora da imagem) sem zoom: fecha, como antes.
    if (e.target === stageRef.current && view.current.s <= 1.01) {
      setTimeout(() => { if (lastTap.current === t) onClose(); }, DOUBLE_TAP_MS);
    }
  };

  const onClick = (e) => {
    // Toque já foi tratado pelos pointer events (toque duplo etc).
    if (e.nativeEvent?.pointerType && e.nativeEvent.pointerType !== 'mouse') return;
    if (e.detail === 0 && !e.clientX && !e.clientY) return;
    const m = mouse.current;
    mouse.current = null;
    if (m?.moved || suppressClick.current) { suppressClick.current = false; return; }
    if (e.target === imgRef.current) toggleAt(e.clientX, e.clientY);
    else if (e.target === stageRef.current && view.current.s <= 1.01) onClose();
    else if (e.target === stageRef.current) reset(true);
  };

  return (
    <div
      ref={stageRef}
      className="lightbox-stage no-swipe"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endTouch(e, false)}
      onPointerCancel={(e) => endTouch(e, true)}
      onClick={onClick}
    >
      <img
        ref={imgRef}
        className="lightbox-image lightbox-zoomable"
        src={src}
        alt={alt}
        draggable={false}
        data-scale="1"
        data-tx="0"
        data-ty="0"
        onLoad={() => { const b = bound(view.current.s, view.current.x, view.current.y); view.current = { ...view.current, ...b }; schedule(); }}
      />
    </div>
  );
}
