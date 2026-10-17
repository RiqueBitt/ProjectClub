// Rede de segurança de acessibilidade pro app inteiro (sem mudar visual):
// - botão/link só com ícone e sem nome acessível, mas com `title` →
//   ganha aria-label igual ao title (leitor de tela passa a dizer "Fechar"
//   em vez de "botão");
// - <img> sem alt → alt="" (decorativa; o leitor não soletra o nome do
//   arquivo) e <svg> dentro de botão com nome → aria-hidden.
// Os componentes principais já recebem aria-label direto no código; isto
// cobre o resto (são centenas de botões). Processa só o que entra na tela,
// em lote por quadro de animação.
const CANDIDATES = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"]';
const AUTO = 'data-pc-auto-label';

function hasName(el) {
  if (el.getAttribute('aria-label')?.trim() || el.getAttribute('aria-labelledby')) return true;
  const text = (el.textContent || '').replace(/[\s​]+/g, '');
  if (text.length > 0 && !/^[×✕✖‹›«»<>…⋯·•+\-–—|]+$/.test(text)) return true;
  for (const img of el.querySelectorAll('img[alt]')) {
    const alt = img.getAttribute('alt').trim();
    if (alt && alt.length > 1) return true;
  }
  return false;
}

export function labelElement(el) {
  if (!el || el.nodeType !== 1) return;
  if (el.hasAttribute(AUTO)) {
    // Título mudou (ex.: "Silenciar" ↔ "Ativar microfone").
    const t = el.getAttribute('title')?.trim();
    if (t && t !== el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
    return;
  }
  if (!hasName(el)) {
    const title = el.getAttribute('title')?.trim() || el.getAttribute('data-tip')?.trim();
    if (title) {
      el.setAttribute('aria-label', title);
      el.setAttribute(AUTO, '');
    }
  }
  if (el.getAttribute('aria-label')) {
    for (const svg of el.querySelectorAll('svg:not([aria-hidden]):not([role="img"])')) {
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
    }
  }
}

export function processTree(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches?.(CANDIDATES)) labelElement(root);
  for (const el of root.querySelectorAll?.(CANDIDATES) || []) labelElement(el);
  const imgs = root.tagName === 'IMG' ? [root] : root.querySelectorAll?.('img:not([alt])') || [];
  for (const img of imgs) if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
}

export function startA11yRuntime(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.body || typeof MutationObserver === 'undefined') return () => {};
  const pending = new Set();
  let raf = 0;
  const flush = () => {
    raf = 0;
    for (const n of pending) processTree(n);
    pending.clear();
  };
  const schedule = () => { if (!raf) raf = (window.requestAnimationFrame || setTimeout)(flush); };
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') { if (r.target.hasAttribute?.(AUTO)) pending.add(r.target); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 1) pending.add(n);
    }
    if (pending.size) schedule();
  });
  processTree(doc.body);
  mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  return () => { mo.disconnect(); if (raf) (window.cancelAnimationFrame || clearTimeout)(raf); };
}
