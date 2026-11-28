import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

export function focusableIn(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.hasAttribute('inert') && el.getClientRects().length > 0);
}

// Prende o Tab dentro de `ref` enquanto `active`, fecha com Esc (onEscape)
// e devolve o foco pra quem estava focado antes ao desmontar.
export function useFocusTrap(ref, { active = true, onEscape, initialFocus } = {}) {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement;
    const root = ref.current;
    const focusFirst = () => {
      const target = (initialFocus && root?.querySelector(initialFocus)) || focusableIn(root)[0] || root;
      try { target?.focus({ preventScroll: true }); } catch { /* ok */ }
    };
    const t = setTimeout(focusFirst, 0);
    const onKey = (e) => {
      if (!ref.current) return;
      if (e.key === 'Escape' && escRef.current) {
        e.preventDefault();
        e.stopPropagation();
        escRef.current(e);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusableIn(ref.current);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const inside = ref.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        try { previous.focus({ preventScroll: true }); } catch { /* ok */ }
      }
    };
  }, [active, ref, initialFocus]);
}
