// Qualidade automática da Praça: o Club Penguin roda a 24 quadros por segundo
// e a lógica do jogo conta quadros (subir o FPS deixaria tudo mais rápido).
// O que dá pra garantir é o ritmo constante: se o aparelho começa a perder
// quadros (o navegador demorando mais que um quadro do jogo pra desenhar), a
// qualidade baixa um nível; estável por um tempo, sobe de novo. O nível que
// funcionou fica salvo pro próximo acesso.
import { useEffect, useState } from 'react';

const LEVELS = ['best', 'high', 'medium'];
const KEY = 'pc.praca.quality';
const FRAME_MS = 1000 / 24;
const WINDOW_MS = 4000;
const STEP_UP_AFTER = 30_000;

function readSaved() {
  try {
    const v = localStorage.getItem(KEY);
    return LEVELS.includes(v) ? v : null;
  } catch { return null; }
}

function save(v) {
  try { localStorage.setItem(KEY, v); } catch { /* ok */ }
}

/** Nível inicial: o salvo, ou "high" em tela muito densa (celular), senão "best". */
function initialLevel() {
  const saved = readSaved();
  if (saved) return saved;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return dpr >= 2.5 ? 'high' : 'best';
}

/**
 * Mede o ritmo dos quadros do navegador enquanto `enabled` e devolve a
 * qualidade que o jogo deve usar.
 */
export function useAdaptiveQuality(enabled) {
  const [level, setLevel] = useState(initialLevel);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.requestAnimationFrame) return undefined;
    let raf = 0;
    let last = 0;
    let winStart = 0;
    let frames = 0;
    let slow = 0;
    let lostMs = 0;
    let stableSince = performance.now();
    let current = level;

    const step = (dir) => {
      const i = LEVELS.indexOf(current);
      const next = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + dir))];
      if (next !== current) {
        current = next;
        save(next);
        setLevel(next);
      }
      stableSince = performance.now();
    };

    const tick = (now) => {
      raf = window.requestAnimationFrame(tick);
      if (document.hidden) { last = 0; return; }
      if (last) {
        const dt = now - last;
        // pausas enormes (aba trocada, alerta) não contam
        if (dt < 1000) {
          frames += 1;
          if (dt > FRAME_MS * 1.25) { slow += 1; lostMs += dt - FRAME_MS; }
        }
      } else {
        winStart = now;
      }
      last = now;
      if (now - winStart >= WINDOW_MS) {
        const lostShare = lostMs / Math.max(1, now - winStart);
        // mais de 12% do tempo atrasado: o jogo engasga → baixa a qualidade
        if (frames > 10 && lostShare > 0.12) step(1);
        else if (lostShare < 0.02 && now - stableSince > STEP_UP_AFTER) step(-1);
        winStart = now;
        frames = 0;
        slow = 0;
        lostMs = 0;
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return level;
}
