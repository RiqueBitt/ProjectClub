// Ícones dos apps/jogos na vitrine do login ganham vida: de tempos em tempos
// um deles (ou a logo) faz um truque aleatório — balança, pula, gira, treme,
// "respira", faz jelly, dá uma piscada de brilho… Também ao passar o mouse.
// Só transform/opacity/filter via Web Animations API; respeita
// prefers-reduced-motion e o modo calmo (html[data-lite]).
import { useEffect, useRef } from 'react';

const STUNTS = {
  wiggle: [{ transform: 'rotate(0)' }, { transform: 'rotate(-12deg)', offset: .2 }, { transform: 'rotate(10deg)', offset: .45 }, { transform: 'rotate(-6deg)', offset: .7 }, { transform: 'rotate(0)' }],
  bounce: [{ transform: 'translateY(0)' }, { transform: 'translateY(-14px) scale(1.06)', offset: .35 }, { transform: 'translateY(0) scale(1, .92)', offset: .7 }, { transform: 'translateY(-4px)', offset: .85 }, { transform: 'none' }],
  spin: [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }],
  flip: [{ transform: 'rotateY(0)' }, { transform: 'rotateY(180deg)', offset: .5 }, { transform: 'rotateY(360deg)' }],
  jelly: [{ transform: 'scale(1)' }, { transform: 'scale(1.25, .75)', offset: .3 }, { transform: 'scale(.85, 1.15)', offset: .5 }, { transform: 'scale(1.1, .9)', offset: .7 }, { transform: 'scale(.97, 1.03)', offset: .85 }, { transform: 'scale(1)' }],
  shake: [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px) rotate(-3deg)', offset: .15 }, { transform: 'translateX(5px) rotate(3deg)', offset: .3 }, { transform: 'translateX(-4px)', offset: .45 }, { transform: 'translateX(4px)', offset: .6 }, { transform: 'translateX(-2px)', offset: .75 }, { transform: 'none' }],
  pulse: [{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.18)', filter: 'brightness(1.35) drop-shadow(0 0 14px rgba(255,255,255,.55))', offset: .4 }, { transform: 'scale(1)', filter: 'brightness(1)' }],
  peek: [{ transform: 'translateY(0)' }, { transform: 'translateY(6px) rotate(8deg)', offset: .3 }, { transform: 'translateY(6px) rotate(8deg)', offset: .7 }, { transform: 'none' }],
  tada: [{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(.9) rotate(-3deg)', offset: .1 }, { transform: 'scale(1.15) rotate(3deg)', offset: .3 }, { transform: 'scale(1.15) rotate(-3deg)', offset: .5 }, { transform: 'scale(1.15) rotate(3deg)', offset: .7 }, { transform: 'scale(1) rotate(0)' }],
  swing: [{ transform: 'rotate(0)', transformOrigin: 'top center' }, { transform: 'rotate(14deg)', offset: .2 }, { transform: 'rotate(-10deg)', offset: .4 }, { transform: 'rotate(6deg)', offset: .6 }, { transform: 'rotate(-3deg)', offset: .8 }, { transform: 'rotate(0)' }],
  dab: [{ transform: 'none' }, { transform: 'rotate(-20deg) translate(-6px, -4px) scale(1.08)', offset: .3 }, { transform: 'rotate(-20deg) translate(-6px, -4px) scale(1.08)', offset: .7 }, { transform: 'none' }],
  moonwalk: [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px) rotate(-4deg)', offset: .25 }, { transform: 'translateX(-20px) rotate(4deg)', offset: .5 }, { transform: 'translateX(-10px) rotate(-4deg)', offset: .75 }, { transform: 'none' }],
};
const DUR = { wiggle: 900, bounce: 800, spin: 900, flip: 1000, jelly: 900, shake: 700, pulse: 900, peek: 1200, tada: 1000, swing: 1100, dab: 1300, moonwalk: 1400 };
const NAMES = Object.keys(STUNTS);

function calm() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-lite'); } catch { return false; }
}

export function playIconStunt(el, name = NAMES[Math.floor(Math.random() * NAMES.length)]) {
  if (!el?.animate || calm()) return null;
  if (el.getAnimations?.().length) return null; // já está fazendo um
  const frames = STUNTS[name] || STUNTS.wiggle;
  try {
    el.dataset.stunt = name;
    const a = el.animate(frames, { duration: DUR[name] || 900, easing: 'ease-in-out', fill: 'none' });
    a.onfinish = () => { delete el.dataset.stunt; };
    return a;
  } catch { return null; }
}

// Sorteia um ícone (às vezes a logo da marca) a cada 1.8–3.5s.
export function useIconStunts() {
  const ref = useRef(null);
  useEffect(() => {
    if (calm()) return undefined;
    let t = 0; let alive = true;
    const tick = () => {
      if (!alive) return;
      if (!document.hidden) {
        const icons = [...(ref.current?.querySelectorAll('img') || [])];
        const brand = document.querySelector('.pc-auth-showcase .pc-brand-mark');
        const pool = brand && Math.random() < 0.15 ? [brand] : icons;
        if (pool.length) {
          const el = pool[Math.floor(Math.random() * pool.length)];
          playIconStunt(el);
          // Às vezes dois vizinhos fazem juntos ("conversinha" entre ícones).
          if (Math.random() < 0.3) { const j = icons.indexOf(el); const nb = icons[j + 1] || icons[j - 1]; if (nb) setTimeout(() => playIconStunt(nb, 'wiggle'), 160); }
        }
      }
      t = setTimeout(tick, 1800 + Math.random() * 1700);
    };
    t = setTimeout(tick, 1200);
    return () => { alive = false; clearTimeout(t); };
  }, []);
  return ref;
}
