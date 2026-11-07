import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/hover-tip.css';

// Dica rápida com o nome dos botões que só têm ícone (barra do topo, menu
// compacto, botões de ícone em geral). O "title" nativo do navegador demora
// ~1s e aparece com a cara do sistema; aqui sai em 350ms, no visual do app.
// Pega o texto do title (e esconde o nativo enquanto a dica está aberta).
const SELECTOR = [
  '.top-search-bar-icon-btn',
  '.n2-nav.is-compact .n2-nav-item',
  '.n2-nav-toggle',
  '.icon-btn[title]',
  '.icon-btn[aria-label]',
  '[data-tip]',
].join(',');

const textOf = (el) => el.getAttribute('data-tip') || el.getAttribute('data-tip-title') || el.getAttribute('title') || el.getAttribute('aria-label') || '';

export default function HoverTip() {
  const [tip, setTip] = useState(null); // { text, x, y, below }
  const cur = useRef(null);
  const timer = useRef(0);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const restore = (el) => {
      const t = el?.getAttribute('data-tip-title');
      if (t != null) { el.setAttribute('title', t); el.removeAttribute('data-tip-title'); }
    };
    const hide = () => {
      clearTimeout(timer.current);
      restore(cur.current);
      cur.current = null;
      setTip(null);
    };
    const show = (el) => {
      const text = textOf(el).trim();
      if (!text) return;
      const r = el.getBoundingClientRect();
      const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const below = r.top < 60;
      setTip({ text, x: (r.left + r.width / 2) / z, y: (below ? r.bottom + 8 : r.top - 8) / z, below });
    };
    const over = (e) => {
      const el = e.target.closest?.(SELECTOR);
      if (el === cur.current) return;
      hide();
      if (!el || el.disabled || el.getAttribute('aria-expanded') === 'true') return;
      cur.current = el;
      // Some o title nativo enquanto a dica do app está aberta (senão aparecem as duas).
      const t = el.getAttribute('title');
      if (t != null) { el.setAttribute('data-tip-title', t); el.removeAttribute('title'); }
      timer.current = setTimeout(() => show(el), 350);
    };
    const out = (e) => {
      if (!cur.current) return;
      if (e.relatedTarget && cur.current.contains(e.relatedTarget)) return;
      hide();
    };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div className={`hover-tip${tip.below ? ' below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>,
    document.body,
  );
}
