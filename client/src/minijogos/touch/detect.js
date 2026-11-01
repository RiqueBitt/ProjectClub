import { useCallback, useEffect, useState } from 'react';

// Controles na tela dos Mini-Jogos — detecção de aparelho de toque.
// Liga sozinho no celular/tablet (ponteiro "grosso", sem mouse) e no app
// Android (Capacitor). No PC com mouse/teclado fica desligado, mas dá pra
// ligar na mão pelo botão "Controles na tela" do player (fica salvo).

const PREF_KEY = 'minijogos:touchControls'; // 'on' | 'off' | ausente = automático

const mq = (q) => {
  try { return !!window.matchMedia?.(q).matches; } catch { return false; }
};

export function isCapacitorApp() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

// Aparelho de toque "de verdade": ponteiro principal grosso, ou só toque
// (sem nenhum ponteiro fino), ou o app Android. Notebook com tela touch e
// mouse continua contando como PC (ponteiro principal fino).
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  if (isCapacitorApp()) return true;
  if (mq('(pointer: coarse)')) return true;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  return touchPoints && !mq('(any-pointer: fine)') && !mq('(hover: hover)');
}

function readPref() {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
}

// [ligado, alternar, automático?]
export function useTouchControlsPref() {
  const [auto, setAuto] = useState(isTouchDevice);
  const [pref, setPref] = useState(readPref);

  // Trocar de ponteiro (ex.: tablet com teclado/mouse) atualiza o automático.
  useEffect(() => {
    let mql;
    try { mql = window.matchMedia('(pointer: coarse)'); } catch { return undefined; }
    const on = () => setAuto(isTouchDevice());
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);

  const enabled = pref === 'on' ? true : pref === 'off' ? false : auto;
  const toggle = useCallback(() => {
    const next = enabled ? 'off' : 'on';
    // Voltou pro padrão do aparelho? Então volta a ser automático.
    const store = (next === 'on') === auto ? null : next;
    try {
      if (store) localStorage.setItem(PREF_KEY, store);
      else localStorage.removeItem(PREF_KEY);
    } catch { /* sem storage */ }
    setPref(store);
  }, [enabled, auto]);

  return [enabled, toggle, auto];
}
