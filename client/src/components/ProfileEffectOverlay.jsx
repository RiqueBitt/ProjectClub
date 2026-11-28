import { useEffect, useRef, useState } from 'react';
import { proxyImage } from '../utils/imageProxy';
import '../styles/profile-effect.css';

// Efeito de perfil (Loja): animação transparente que passa por cima do
// perfil inteiro / miniperfil. Aparece ao abrir e depois a cada 30s,
// fica visível pela duração definida pela staff e some com fade.
// User.profileEffect = JSON {id,url,d:{s,x,y,o,t},m:{s,x,y,o,t}}
// (d = computador, m = celular).
const cache = new Map();
export function parseProfileEffect(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw.url ? raw : null;
  if (cache.has(raw)) return cache.get(raw);
  let v = null;
  try { const o = JSON.parse(raw); if (o?.url) v = o; } catch { v = null; }
  cache.set(raw, v);
  return v;
}

const REPEAT_MS = 30000;
const FADE_MS = 600;
const isMobileNow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// variant: 'full' (perfil em tela cheia, fixo na tela) | 'mini' | 'box'
// (preenche o pai — usado nas prévias da loja/painel).
// mobile: força o ajuste de celular (true) ou computador (false); sem
// valor, decide pela largura da tela.
// loop: na prévia do painel, repete sem esperar 30s.
export default function ProfileEffectOverlay({ effect, variant = 'box', mobile, loop = false, className = '' }) {
  const fx = parseProfileEffect(effect);
  const [run, setRun] = useState(0); // muda a key pra reiniciar a animação
  const [visible, setVisible] = useState(false);
  const [autoMobile, setAutoMobile] = useState(isMobileNow);
  const timers = useRef([]);

  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 700px)');
    if (!mq) return undefined;
    const on = () => setAutoMobile(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const useMobile = mobile ?? autoMobile;
  const cfg = (fx && (useMobile ? fx.m : fx.d)) || fx?.d || {};
  const dur = Math.max(1, Number(cfg.t) || 4) * 1000;
  const url = fx?.url;

  useEffect(() => {
    if (!url) return undefined;
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
    const reduce = reducedMotion();
    let stopped = false;
    const play = () => {
      if (stopped) return;
      clear();
      // Aba escondida: não toca; volta quando a pessoa voltar pra aba.
      if (document.hidden) return;
      setRun((n) => n + 1);
      setVisible(true);
      later(() => setVisible(false), dur);
      // Movimento reduzido: aparece uma vez só.
      if (!reduce) later(play, loop ? dur + FADE_MS + 800 : REPEAT_MS);
    };
    play();
    const onVis = () => { if (!document.hidden && !reduce) play(); else if (document.hidden) { clear(); setVisible(false); } };
    if (!reduce) document.addEventListener('visibilitychange', onVis);
    return () => { stopped = true; clear(); document.removeEventListener('visibilitychange', onVis); };
  }, [url, dur, loop]);

  if (!fx) return null;
  const s = Math.min(3, Math.max(0.3, Number(cfg.s) || 1));
  const x = Number(cfg.x) || 0;
  const y = Number(cfg.y) || 0;
  const o = Math.min(1, Math.max(0.1, Number(cfg.o) || 0.85));
  return (
    <div className={`pfx-layer pfx-${variant} ${className}`} aria-hidden="true">
      <img
        key={run}
        className="pfx-img" src={proxyImage(url)} alt="" draggable="false" decoding="async"
        style={{
          opacity: visible ? o : 0,
          transition: `opacity ${FADE_MS}ms ease`,
          width: `${s * 100}%`, height: `${s * 100}%`,
          transform: `translate(calc(-50% + ${x}%), calc(-50% + ${y}%))`,
        }}
      />
    </div>
  );
}
