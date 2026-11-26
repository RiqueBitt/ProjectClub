import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import '../../styles/auth-characters.css';

// ---------------------------------------------------------------------
// Turminha das telas de login/inscrição: quatro bichinhos "2.5D" (volume
// de brinquedo feito com luz suave, oclusão na base, brilho especular e
// sombra de contato — tudo em SVG, só transform/opacity), JUNTINHOS, que
// acompanham o que a pessoa faz no formulário.
//
// Elenco FIXO (nov/2026): forma, cor e rosto de cada um são sempre os
// mesmos e ninguém usa acessório. Nada acontece "do nada": fora respirar
// e piscar, todo movimento é resposta ao que a pessoa faz.
//
//   curiosa (Lila)  → espia com um olho quando a senha aparece
//   tranquila(Menta)→ aperta os olhos sorrindo na senha
//   tímido  (Coral) → tapa os olhos com as mãozinhas
//   caçula  (Mel)   → tapa os olhos quase juntinho, olha feio pra Lila
//
//   parado    → respiram, piscam, os olhos seguem o mouse
//   mouse em cima → quem está embaixo do mouse sorri e cora
//   clique/toque → quem levou o "cutucão" pula rindo e os outros olham
//   digitando → se inclinam pro campo, os olhos seguem o cursor do texto e
//               cada tecla faz um deles balançar a cabeça, um de cada vez
//   senha     → tapam os olhos / fecham os olhos sorrindo
//   "mostrar" → a Lila espia com um olho só (o caçula olha feio pra ela)
//   erro      → susto (pulinho + tremida) e depois biquinho emburrado
//   sucesso   → pulo de comemoração com brilhinhos
//
// Movimento: o olhar, o rosto e a inclinação são molas simuladas num
// único requestAnimationFrame que escreve direto no DOM (nada de
// re-render por quadro; o mouse fica numa ref). Pulos e tremidas usam a
// Web Animations API; expressões trocam por atributos + transições CSS.
// prefers-reduced-motion e html[data-lite] ("modo calmo") desligam tudo
// que se mexe sozinho. Puramente decorativo: aria-hidden.
// ---------------------------------------------------------------------

const VB = { x: 38, y: 0, w: 416, h: 244 };
const FLOOR = 228;
const INK = '#1d1631';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------- cores -------------------------------

// HSL → hex (sem depender de nada; roda no navegador no 1º render).
function hsl(h, s, l) {
  const sn = s / 100; const ln = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
// Família de cor derivada de um matiz: claro em cima, sombra embaixo,
// luvinha bem clara e bochecha quentinha. Curva fixa = sempre harmônico.
function family(h) {
  return {
    hue: h,
    top: hsl(h, 74, 85),
    base: hsl(h, 67, 71),
    deep: hsl(h, 60, 52),
    mitt: hsl(h, 62, 94),
    lid: hsl(h, 66, 80),
    cheek: hsl((h * 0.12 + 344) % 360, 92, 73),
  };
}
// --------- formas de corpo (silhueta + proporções do rosto) ----------
// Cada forma desenha a silhueta DENTRO da caixa (cx, w, h, floor) e diz
// onde ficam olhos/boca (proporções). Assim qualquer forma cabe em
// qualquer papel, mantendo a composição (alturas variadas, sobreposição).
const SHAPES = {
  pilula(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2; const br = Math.min(hw, 16);
    const body = `M${cx - hw} ${floor - br} V${top + hw} A${hw} ${hw} 0 0 1 ${cx + hw} ${top + hw} V${floor - br} Q${cx + hw} ${floor} ${cx + hw - br} ${floor} H${cx - hw + br} Q${cx - hw} ${floor} ${cx - hw} ${floor - br} Z`;
    return { body, top, lay: { eyeYf: 0.34, gapf: 0.2, eyeRf: 0.15, mouthDyf: 0.3 } };
  },
  cupula(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2;
    const body = `M${cx - hw} ${floor} V${top + h * 0.55} C${cx - hw} ${top + h * 0.16} ${cx - hw * 0.5} ${top} ${cx} ${top} C${cx + hw * 0.5} ${top} ${cx + hw} ${top + h * 0.16} ${cx + hw} ${top + h * 0.55} V${floor} Z`;
    return { body, top, lay: { eyeYf: 0.52, gapf: 0.16, eyeRf: 0.085, mouthDyf: 0.17 } };
  },
  quadrado(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2; const tr = Math.min(hw * 0.55, 34); const brc = 14;
    const body = `M${cx - hw} ${top + tr} Q${cx - hw} ${top} ${cx - hw + tr} ${top} H${cx + hw - tr} Q${cx + hw} ${top} ${cx + hw} ${top + tr} V${floor - brc} Q${cx + hw} ${floor} ${cx + hw - brc} ${floor} H${cx - hw + brc} Q${cx - hw} ${floor} ${cx - hw} ${floor - brc} Z`;
    return { body, top, lay: { eyeYf: 0.42, gapf: 0.16, eyeRf: 0.075, mouthDyf: 0.2 } };
  },
  bolha(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2; const mid = top + h * 0.5;
    const body = `M${cx - hw} ${mid} C${cx - hw} ${top + h * 0.16} ${cx - hw * 0.45} ${top} ${cx} ${top} C${cx + hw * 0.45} ${top} ${cx + hw} ${top + h * 0.16} ${cx + hw} ${mid} C${cx + hw} ${floor - h * 0.08} ${cx + hw * 0.55} ${floor} ${cx} ${floor} C${cx - hw * 0.55} ${floor} ${cx - hw} ${floor - h * 0.08} ${cx - hw} ${mid} Z`;
    return { body, top, lay: { eyeYf: 0.46, gapf: 0.17, eyeRf: 0.12, mouthDyf: 0.22 } };
  },
  ovo(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2;
    const body = `M${cx} ${top} C${cx + hw} ${top + h * 0.05} ${cx + hw} ${top + h * 0.52} ${cx + hw * 0.92} ${top + h * 0.72} C${cx + hw * 0.82} ${floor} ${cx + hw * 0.4} ${floor} ${cx} ${floor} C${cx - hw * 0.4} ${floor} ${cx - hw * 0.82} ${floor} ${cx - hw * 0.92} ${top + h * 0.72} C${cx - hw} ${top + h * 0.52} ${cx - hw} ${top + h * 0.05} ${cx} ${top} Z`;
    return { body, top, lay: { eyeYf: 0.4, gapf: 0.16, eyeRf: 0.13, mouthDyf: 0.26 } };
  },
  feijao(cx, w, h, floor) {
    const top = floor - h; const hw = w / 2; const r = hw;
    const body = `M${cx - hw} ${top + r} a${hw} ${r} 0 0 1 ${w} 0 V${floor - r} a${hw} ${r} 0 0 1 ${-w} 0 Z`;
    return { body, top, lay: { eyeYf: 0.4, gapf: 0.19, eyeRf: 0.14, mouthDyf: 0.28 } };
  },
};
// --------------------------- rostos ---------------------------------
// Geometria concreta de um corpo a partir da forma + caixa + tipo de olho.
function geom(cx, w, h, floor, shapeName, eye) {
  const s = SHAPES[shapeName](cx, w, h, floor);
  const { lay } = s; const eyeY = s.top + h * lay.eyeYf;
  const eyeDX = w * lay.gapf; const er = Math.max(5, w * lay.eyeRf);
  // Olho grande de brinquedo: esclera, íris na cor do bichinho, pupila e
  // dois brilhos. pMax = quanto a íris anda olhando pros lados.
  const r = er * 1.12; const pr = er * 0.62; const pMax = clamp(er * 0.4, 2.6, 5.2);
  const eyes = [{ x: cx - eyeDX, y: eyeY }, { x: cx + eyeDX, y: eyeY }];
  const mouthY = eyeY + w * lay.mouthDyf;
  const blushDX = eyeDX + er * 1.0; const blushY = eyeY + er * 1.4;
  return {
    body: s.body, bodyTop: s.top, eye, eyes, r, pr, pMax,
    brow: Math.max(12, er * 1.5),
    mouth: { x: cx, y: mouthY, s: clamp(w / 110, 0.72, 1.12) },
    blush: [{ x: cx - blushDX, y: blushY }, { x: cx + blushDX, y: blushY }],
    blushR: [er * 0.78, er * 0.46],
    rest: [[cx - w * 0.42, floor - 16], [cx + w * 0.42, floor - 16]],
    up: [[cx - w * 0.52, eyeY - 4], [cx + w * 0.52, eyeY - 4]],
    chin: [cx + eyeDX + er * 0.5, mouthY + 1],
    eyeDX,
  };
}

// Elenco fixo: personalidade de MOVIMENTO + caixa (posição/altura) +
// forma + cor. As caixas se sobrepõem de propósito (turminha grudada).
// Ordem = ordem de desenho (trás → frente).
const ROLES = [
  { id: 'lila', cx: 202, w: 88, h: 136, shape: 'pilula', hue: 258, color: 'lilas', k: 80, z: 0.6, lean: 6, face: 6, lashes: true },
  { id: 'menta', cx: 302, w: 148, h: 114, shape: 'cupula', hue: 160, color: 'menta', k: 55, z: 0.72, lean: 3.4, face: 7 },
  { id: 'coral', cx: 132, w: 112, h: 102, shape: 'bolha', hue: 8, color: 'coral', k: 120, z: 0.55, lean: 4.6, face: 6 },
  { id: 'mel', cx: 386, w: 72, h: 66, shape: 'ovo', hue: 44, color: 'mel', k: 190, z: 0.42, lean: 8, face: 4, baby: true },
];

function makeCast() {
  const cast = ROLES.map((role, i) => {
    const g = geom(role.cx, role.w, role.h, FLOOR, role.shape, 'ball');
    return {
      id: role.id, idx: i, cx: role.cx, w: role.w,
      k: role.k, z: role.z, lean: role.lean, face: role.face, lashes: !!role.lashes,
      coverIn: role.baby ? g.eyeDX * 0.42 : 0,
      hand: clamp(role.w / 110, 0.85, 1.08),
      ...family(role.hue), ...g,
      shape: role.shape, colorName: role.color,
    };
  });
  const byId = Object.fromEntries(cast.map((c) => [c.id, c]));
  return { cast, byId };
}

// Expressões: olhos (open | wide | half | closed | happy | squeeze — ou
// um par, um por olho), boca, sobrancelha, mãos (rest | cover | up |
// peek), bochecha (0–3) e pra onde olham. Chaveadas por PAPEL.
const E = (eyes, mouth, o = {}) => ({ eyes, mouth, brow: 'none', hands: 'rest', blush: 1, look: 'target', ...o });
const MOODS = {
  idle: {
    lila: E('open', 'smile', { brow: 'soft' }),
    menta: E('open', 'soft', { brow: 'soft' }),
    coral: E('open', 'cat', { brow: 'soft', blush: 2 }),
    mel: E('open', 'smile', { brow: 'soft' }),
  },
  typing: {
    lila: E('open', 'grin', { brow: 'up' }),
    menta: E('open', 'smile', { brow: 'soft' }),
    coral: E('open', 'smile', { blush: 2 }),
    mel: E('wide', 'o'),
  },
  password: {
    lila: E('closed', 'smile', { brow: 'soft', look: 'away' }),
    menta: E('squeeze', 'smile', { look: 'away', blush: 2 }),
    coral: E('closed', 'cat', { hands: 'cover', blush: 3 }),
    mel: E('closed', 'soft', { hands: 'cover', blush: 2 }),
  },
  peek: {
    lila: E(['squeeze', 'open'], 'smirk', { brow: 'sly', hands: 'peek', look: 'target' }),
    menta: E('squeeze', 'wavy', { look: 'away', blush: 2 }),
    coral: E('closed', 'cat', { hands: 'cover', blush: 3 }),
    mel: E('half', 'flat', { brow: 'cross', look: { at: 'lila' } }),
  },
  // Erro em duas fases: susto e depois o biquinho emburrado.
  error: {
    lila: E('wide', 'o', { brow: 'up', blush: 0, look: 'front' }),
    menta: E('wide', 'wavy', { brow: 'up', blush: 0, look: 'front' }),
    coral: E('wide', 'o', { brow: 'up', blush: 0, look: 'front' }),
    mel: E('wide', 'o', { brow: 'up', blush: 0, look: 'front' }),
  },
  pout: {
    lila: E('half', 'pout', { brow: 'angry', look: 'form' }),
    menta: E('half', 'flat', { brow: 'cross', look: 'form' }),
    coral: E('half', 'pout', { brow: 'angry', blush: 3, look: 'form' }),
    mel: E('half', 'pout', { brow: 'angry', blush: 3, look: 'form' }),
  },
  success: {
    lila: E('happy', 'big', { brow: 'up', hands: 'up', blush: 2, look: 'front' }),
    menta: E('happy', 'grin', { blush: 2, look: 'front' }),
    coral: E('happy', 'big', { hands: 'up', blush: 3, look: 'front' }),
    mel: E('happy', 'big', { hands: 'up', blush: 3, look: 'front' }),
  },
};

// Rosto por cima do humor quando a pessoa interage (só no descanso/digitando).
const HOVER_FACE = { mouth: 'grin', brow: 'up', blush: 2 };
const POKE_FACE = { eyes: 'happy', mouth: 'big', brow: 'up', blush: 3, look: 'front' };

// Bocas (desenhadas em volta de 0,0). fill = forma cheia com linguinha.
const MOUTHS = {
  smile: { d: 'M-7 -1.5 Q0 6 7 -1.5' },
  soft: { d: 'M-4.5 0 Q0 3.5 4.5 0' },
  cat: { d: 'M-8 -1 Q-4 4 0 -0.5 Q4 4 8 -1' },
  grin: { d: 'M-8 -2.5 Q0 -0.5 8 -2.5 Q7 8 0 8.5 Q-7 8 -8 -2.5 Z', fill: true },
  big: { d: 'M-10 -3 Q0 -1 10 -3 Q9 11 0 11.5 Q-9 11 -10 -3 Z', fill: true },
  o: { ellipse: true },
  flat: { d: 'M-4.5 0.5 H4.5' },
  wavy: { d: 'M-8 0.5 Q-6 -2.5 -2.7 0.5 Q0 3 2.7 0.5 Q6 -2.5 8 0.5' },
  pout: { d: 'M-6 3.5 Q0 -3 6 3.5' },
  smirk: { d: 'M-6 1.5 Q1 4.5 7.5 -2.5' },
};

// Sobrancelhas: [deslocamento y, giro do olho esquerdo, giro do direito].
const BROWS = {
  none: null,
  soft: [0, -4, 4],
  up: [-5, -10, 10],
  angry: [3, 20, -20],
  cross: [2, 12, -12],
  sly: [0, 16, -10],
};

const SPARKLES = [
  { x: 120, y: 98, s: 1.1 }, { x: 196, y: 6, s: 0.9 },
  { x: 250, y: 58, s: 0.7 }, { x: 340, y: 96, s: 1 },
  { x: 430, y: 148, s: 0.8 }, { x: 66, y: 104, s: 0.7 },
  { x: 150, y: 40, s: 0.6 }, { x: 384, y: 130, s: 0.6 },
];
const MITTEN = 'M-7.5 6 C-9.5 0 -9 -7.5 -3.5 -9.5 C1.5 -11 7.5 -8.5 8 -2 C8.5 4 5.5 8.5 0 8.5 C-3.5 8.5 -6.5 8 -7.5 6 Z';
const SPARK = 'M0 -9 C1.2 -2.4 2.4 -1.2 9 0 C2.4 1.2 1.2 2.4 0 9 C-1.2 2.4 -2.4 1.2 -9 0 C-2.4 -1.2 -1.2 -2.4 0 -9 Z';

function prefersCalm() {
  if (typeof window === 'undefined') return true;
  const lite = document.documentElement.hasAttribute('data-lite');
  return lite || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Mede onde o cursor de texto está, em coordenadas da página.
let measureCtx = null;
function caretPoint(input) {
  const rect = input.getBoundingClientRect();
  if (input.tagName !== 'INPUT') return { x: rect.left + Math.min(rect.width, 220) * 0.5, y: rect.top + 24 };
  const style = getComputedStyle(input);
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let pos = input.value.length;
  try { if (typeof input.selectionEnd === 'number') pos = input.selectionEnd; } catch { /* type sem seleção */ }
  const before = input.value.slice(0, pos);
  const text = input.type === 'password' ? '•'.repeat(before.length) : before;
  const spacing = parseFloat(style.letterSpacing) || 0;
  const width = measureCtx.measureText(text).width + spacing * text.length;
  const padL = parseFloat(style.paddingLeft) || 0;
  const x = clamp(rect.left + padL + width - (input.scrollLeft || 0), rect.left, rect.right);
  return { x, y: rect.top + rect.height / 2 };
}

const isPasswordInput = (el) => el?.tagName === 'INPUT'
  && (el.type === 'password' || /password/i.test(el.getAttribute('autocomplete') || ''));

// O que está acontecendo no formulário (campo em foco, cursor, senha à mostra).
function useFormFocus(scopeSelector) {
  const [state, setState] = useState({ kind: 'none', caret: null, peek: false });
  useEffect(() => {
    let raf = 0;
    const scope = () => document.querySelector(scopeSelector);
    const evaluate = () => {
      raf = 0;
      const root = scope();
      if (!root) return;
      const el = document.activeElement;
      const inside = el && root.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
      // "Mostrar senha" ligado com algo digitado em QUALQUER campo de senha.
      const peek = [...root.querySelectorAll('input')].some((i) => /password/i.test(i.getAttribute('autocomplete') || '') && i.type === 'text' && i.value.length > 0);
      let kind = 'none';
      let caret = null;
      if (inside) {
        kind = isPasswordInput(el) ? 'password' : 'text';
        caret = caretPoint(el);
      } else if (peek) {
        // Senha à mostra sem foco (o olho no PC funciona passando o mouse).
        const pw = [...root.querySelectorAll('input')].find((i) => /password/i.test(i.getAttribute('autocomplete') || '') && i.type === 'text');
        if (pw) { kind = 'password'; caret = caretPoint(pw); }
      }
      setState((prev) => (prev.kind === kind && prev.peek === peek
        && Math.abs((prev.caret?.x || 0) - (caret?.x || 0)) < 0.5 && Math.abs((prev.caret?.y || 0) - (caret?.y || 0)) < 0.5
        ? prev : { kind, caret, peek }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(evaluate); };
    const events = ['focusin', 'focusout', 'input', 'keyup', 'click', 'selectionchange'];
    events.forEach((e) => document.addEventListener(e, schedule, true));
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    // O "olho" troca o type do campo (password ↔ text) sem nenhum evento.
    const mo = new MutationObserver(schedule);
    const attach = () => { const root = scope(); if (root) mo.observe(root, { attributes: true, attributeFilter: ['type'], subtree: true }); };
    attach();
    schedule();
    return () => {
      events.forEach((e) => document.removeEventListener(e, schedule, true));
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scopeSelector]);
  return state;
}

// ----------------------------- desenho ------------------------------

function Eye({ c, e, i, state, uid }) {
  const side = i === 0 ? 1 : -1; // ">" no esquerdo, "<" no direito
  const k = c.r / 9; // os traços de olho fechado acompanham o tamanho do olho
  return (
    <g transform={`translate(${e.x} ${e.y})`}>
      <g className="pcc-eye" data-state={state}>
        <g className="pcc-eye-open">
          <g className="pcc-blink">
            {/* esclera com sombrinha da pálpebra em cima (dá fundo ao olho) */}
            <circle r={c.r} fill={`url(#${uid}-scl)`} />
            <circle r={c.r} fill="none" stroke={INK} strokeOpacity=".22" strokeWidth="1" />
            <g className="pcc-pupil">
              <g className="pcc-pupil-s">
                <circle r={c.pr} fill={c.deep} />
                <circle r={c.pr} fill={`url(#${uid}-iris)`} />
                <circle r={c.pr * 0.6} fill={INK} />
                <circle cx={c.pr * 0.36} cy={-c.pr * 0.4} r={c.pr * 0.34} fill="#fff" />
                <circle cx={-c.pr * 0.38} cy={c.pr * 0.42} r={c.pr * 0.15} fill="#fff" opacity=".85" />
              </g>
            </g>
            {/* Pálpebra de verdade: desce por cima da esclera (recortada). */}
            <g clipPath={`url(#${uid}-eye-${c.id})`}>
              <path
                className="pcc-lid" fill={c.lid}
                d={`M${-c.r - 2} ${-2 * c.r - 4} H${c.r + 2} V0 Q0 3 ${-c.r - 2} 0 Z`}
              />
            </g>
          </g>
          {c.lashes && (
            // cílios no canto de fora
            <path
              d={`M${side * -c.r * 0.78} ${-c.r * 0.62} l${side * -3.4} -3 M${side * -c.r * 0.98} ${-c.r * 0.2} l${side * -4} -1`}
              stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none"
            />
          )}
        </g>
        <g transform={`scale(${k})`}>
          <path className="pcc-eye-alt pcc-eye-closed" d="M-6.5 -0.5 Q0 4.5 6.5 -0.5" />
          <path className="pcc-eye-alt pcc-eye-happy" d="M-6.5 2.5 Q0 -5.5 6.5 2.5" />
          <path className="pcc-eye-alt pcc-eye-squeeze" d={`M${-5 * side} -5 L${5 * side} 0 L${-5 * side} 5`} />
        </g>
      </g>
    </g>
  );
}

function Mouth({ c, kind }) {
  return (
    <g transform={`translate(${c.mouth.x} ${c.mouth.y}) scale(${c.mouth.s})`}>
      {Object.entries(MOUTHS).map(([k, m]) => {
        const on = kind === k || undefined;
        if (m.ellipse) return <ellipse key={k} className="pcc-mouth" data-on={on} cx="0" cy="2" rx="4.2" ry="5.2" fill="#2b1631" />;
        if (m.fill) {
          return (
            <g key={k} className="pcc-mouth" data-on={on}>
              <path d={m.d} fill="#2b1631" stroke="#2b1631" strokeWidth="1.5" strokeLinejoin="round" />
              {/* dentinhos em cima e linguinha embaixo */}
              <path d={k === 'big' ? 'M-7.5 -2.2 Q0 -0.6 7.5 -2.2 L7 0.6 Q0 2 -7 0.6 Z' : 'M-6 -1.9 Q0 -0.4 6 -1.9 L5.6 0.2 Q0 1.4 -5.6 0.2 Z'} fill="#fff" />
              <ellipse cx="0" cy={k === 'big' ? 7.6 : 5.8} rx={k === 'big' ? 5 : 3.6} ry={k === 'big' ? 2.8 : 2} fill="#ff7c98" />
            </g>
          );
        }
        return (
          <path
            key={k} className="pcc-mouth" data-on={on} d={m.d}
            fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

// Posição de cada mão em cada pose: [x, y, giro, visível].
function handPose(c, pose, i) {
  const [ex, ey] = [c.eyes[i].x, c.eyes[i].y + 3];
  const [rx, ry] = c.rest[i];
  const tilt = i === 0 ? -1 : 1;
  // Tapando: as patinhas se encostam um pouco pro meio (no caçula, quase juntas).
  if (pose === 'cover') return [ex - (c.coverIn || 0) * tilt, ey + 1 + (c.coverIn || 0), 14 * tilt, true];
  if (pose === 'up') return [c.up[i][0], c.up[i][1], 28 * tilt, true];
  if (pose === 'peek') return i === 0 ? [ex, ey, -18, true] : [c.chin[0], c.chin[1], 30, true];
  return [rx, ry, 0, false];
}

const Character = memo(function Character({ c, mood, index, reg, uid, onPoke, onHover }) {
  const eyeStates = Array.isArray(mood.eyes) ? mood.eyes : [mood.eyes, mood.eyes];
  const brow = BROWS[mood.brow];
  const handsOn = mood.hands !== 'rest';
  return (
    <g
      ref={reg(c.id, 'char')}
      className={`pcc-char pcc-${c.id}`}
      data-blush={mood.blush}
      data-shape={c.shape}
      data-color={c.colorName}
      data-touch={mood.touch || undefined}
      style={{ '--i': index, '--r': c.r }}
      onPointerDown={(ev) => { ev.preventDefault(); onPoke?.(c.id); }}
      onPointerEnter={(ev) => { if (ev.pointerType !== 'touch') onHover?.(c.id, true); }}
      onPointerLeave={() => onHover?.(c.id, false)}
    >
      <g ref={reg(c.id, 'hop')} className="pcc-hop">
        <g ref={reg(c.id, 'lean')}>
          <g className="pcc-breathe">
            <path d={c.body} fill={`url(#${uid}-g-${c.id})`} />
            <g clipPath={`url(#${uid}-b-${c.id})`}>
              {/* sombra própria embaixo/à direita e brilho em cima/à esquerda */}
              <rect x={c.cx - c.w} y={c.bodyTop - 30} width={c.w * 2} height={FLOOR - c.bodyTop + 30} fill={`url(#${uid}-sv-${c.id})`} />
              <rect x={c.cx - c.w} y={c.bodyTop - 30} width={c.w * 2} height={FLOOR - c.bodyTop + 30} fill={`url(#${uid}-sh-${c.id})`} />
              {/* oclusão suave na base (assenta no chão) */}
              <rect x={c.cx - c.w} y={FLOOR - Math.min(42, (FLOOR - c.bodyTop) * 0.4)} width={c.w * 2} height="60" fill={`url(#${uid}-occ-${c.id})`} />
              {/* brilho especular alto à esquerda (volume de brinquedo) */}
              <ellipse cx={c.cx - c.w * 0.24} cy={c.bodyTop + (FLOOR - c.bodyTop) * 0.2} rx={c.w * 0.26} ry={Math.min(30, (FLOOR - c.bodyTop) * 0.2)} fill={`url(#${uid}-sheen)`} />
              <ellipse cx={c.cx - c.w * 0.26} cy={c.bodyTop + (FLOOR - c.bodyTop) * 0.12} rx={c.w * 0.12} ry={Math.min(10, (FLOOR - c.bodyTop) * 0.08)} fill="#fff" opacity=".5" />
            </g>
            <path d={c.body} fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.2" className="pcc-rim" />

            <g ref={reg(c.id, 'face')} className="pcc-face">
              <g className="pcc-blush">
                {c.blush.map((b, i) => <ellipse key={i} cx={b.x} cy={b.y} rx={c.blushR[0] * 1.15} ry={c.blushR[1] * 1.2} fill={`url(#${uid}-ck-${c.id})`} />)}
              </g>
              <g className="pcc-brows" data-on={brow ? true : undefined}>
                {c.eyes.map((e, i) => (
                  <g key={i} transform={`translate(${e.x} ${e.y - c.brow})`}>
                    <path
                      className="pcc-brow"
                      d="M-6 0.8 Q0 -1.8 6 0.8"
                      fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round"
                      style={{ transform: brow ? `translateY(${brow[0]}px) rotate(${brow[i + 1]}deg)` : 'translateY(3px)' }}
                    />
                  </g>
                ))}
              </g>
              {c.eyes.map((e, i) => (
                <Eye key={i} c={c} e={e} i={i} state={eyeStates[i]} uid={uid} />
              ))}
              <Mouth c={c} kind={mood.mouth} />
              <g className="pcc-hands" data-on={handsOn || undefined} data-pose={mood.hands}>
                {[0, 1].map((i) => {
                  const [x, y, rot, vis] = handPose(c, mood.hands, i);
                  return (
                    <g
                      key={i} className="pcc-hand" data-slow={mood.hands === 'peek' && i === 1 ? true : undefined}
                      style={{ transform: `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${(vis ? 1 : 0.4) * c.hand * (i ? -1 : 1)}, ${(vis ? 1 : 0.4) * c.hand})`, opacity: vis ? 1 : 0 }}
                    >
                      {/* luvinha: palma, dedão e dois risquinhos de dedo */}
                      <ellipse cx="0.5" cy="3.5" rx="9" ry="8" fill="#2a1840" opacity=".24" />
                      <ellipse cx="-8.4" cy="1.5" rx="3.6" ry="2.8" transform="rotate(-35 -8.4 1.5)" fill={c.top} stroke={c.deep} strokeWidth="1.5" />
                      <path d={MITTEN} fill={`url(#${uid}-h-${c.id})`} stroke={c.deep} strokeWidth="1.9" strokeLinejoin="round" />
                      <path d="M-2.2 -7.5 V-3 M2.6 -7.2 V-3" stroke={c.deep} strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
                      <ellipse cx="-2.5" cy="-5" rx="2.6" ry="1.4" fill="#fff" opacity=".35" />
                    </g>
                  );
                })}
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  );
});

// --------------------------- componente -----------------------------

// reaction: { type: 'error' | 'success', key: number } — muda a `key`
// pra disparar de novo a mesma reação.
// align: 'center' (padrão) ou 'right' — onde a turma encosta dentro da caixa.
export default function AuthCharacters({ reaction = null, scope = '.pc-auth-panel', className = '', align = 'center' }) {
  const uid = `pcc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const svgRef = useRef(null);
  const [calm, setCalm] = useState(prefersCalm);
  const focus = useFormFocus(scope);
  const [react, setReact] = useState(null); // 'error' | 'pout' | 'success'

  // Elenco fixo (montado uma vez).
  const gen = useMemo(() => makeCast(), []);
  const { cast, byId } = gen;

  // Refs dos elementos de cada personagem (preenchidas pelo Character).
  const els = useRef({});
  const regCache = useRef({});
  const reg = useCallback((id, key) => {
    const k = `${id}.${key}`;
    if (!regCache.current[k]) {
      regCache.current[k] = (el) => {
        els.current[id] = els.current[id] || {};
        els.current[id][key] = el;
      };
    }
    return regCache.current[k];
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setCalm(prefersCalm());
    mq?.addEventListener?.('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lite'] });
    return () => { mq?.removeEventListener?.('change', update); mo.disconnect(); };
  }, []);

  // Reações (erro: susto ~0,5s + biquinho até ~1,8s; sucesso fica).
  useEffect(() => {
    if (!reaction?.type) return undefined;
    setReact(reaction.type);
    if (reaction.type === 'error') {
      const t1 = setTimeout(() => setReact('pout'), 560);
      const t2 = setTimeout(() => setReact(null), 1850);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    return undefined;
  }, [reaction?.type, reaction?.key]);

  let mode = 'idle';
  if (react) mode = react === 'pout' ? 'error' : react;
  else if (focus.peek) mode = 'peek';
  else if (focus.kind === 'password') mode = 'password';
  else if (focus.kind === 'text') mode = 'typing';
  const moodKey = react === 'pout' ? 'pout' : mode;
  // Interação: quem está embaixo do mouse e quem levou um cutucão.
  const [hoverId, setHoverId] = useState(null);
  const [poked, setPoked] = useState(null); // { id, key }
  const touchable = moodKey === 'idle' || moodKey === 'typing';
  const moods = {};
  for (const c of cast) {
    const base = MOODS[moodKey][c.id];
    if (touchable && poked?.id === c.id) moods[c.id] = { ...base, ...POKE_FACE, touch: 'poke' };
    else if (touchable && hoverId === c.id) moods[c.id] = { ...base, ...HOVER_FACE, touch: 'hover' };
    else moods[c.id] = base;
  }

  // Tudo que o laço de animação lê fica numa ref (sem re-render por quadro).
  const live = useRef({ pointer: null, caret: null, moodKey, glance: null, form: null, formAt: 0 });
  live.current.caret = focus.caret;
  live.current.moodKey = moodKey;
  live.current.poked = touchable ? poked?.id : null;

  // Pulos/tremidas (Web Animations API), escalonados por personagem.
  const play = useCallback((id, key, frames, opts) => {
    const el = els.current[id]?.[key];
    if (!el?.animate) return null;
    try { return el.animate(frames, { fill: 'none', ...opts }); } catch { return null; }
  }, []);
  const hop = useCallback((c, h, dur = 560, delay = 0, squash = 1) => {
    play(c.id, 'hop', [
      { transform: 'none', easing: 'cubic-bezier(.3,.6,.4,1)' },
      { transform: `scale(${1 + 0.07 * squash}, ${1 - 0.09 * squash})`, offset: 0.16, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `translateY(${-h}px) scale(${1 - 0.04 * squash}, ${1 + 0.06 * squash})`, offset: 0.48, easing: 'cubic-bezier(.6,0,.8,.4)' },
      { transform: 'translateY(0) scale(1, 1)', offset: 0.74, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: `scale(${1 + 0.05 * squash}, ${1 - 0.06 * squash})`, offset: 0.86 },
      { transform: 'none' },
    ], { duration: dur, delay });
    play(c.id, 'shadow', [
      { transform: 'none', opacity: 1 },
      { transform: 'scale(1.06, 1)', offset: 0.16 },
      { transform: 'scale(.6, .7)', opacity: 0.45, offset: 0.48 },
      { transform: 'none', opacity: 1, offset: 0.74 },
      { transform: 'none', opacity: 1 },
    ], { duration: dur, delay, easing: 'ease-in-out' });
  }, [play]);
  const reactKey = react ? `${react === 'pout' ? 'error' : react}-${reaction?.key ?? 0}` : null;
  useEffect(() => {
    if (calm || !reactKey) return;
    if (reactKey.startsWith('error')) {
      cast.forEach((c, i) => {
        const h = c.id === 'mel' ? 16 : c.id === 'menta' ? 7 : 11;
        play(c.id, 'hop', [
          { transform: 'none', easing: 'cubic-bezier(.2,.9,.3,1)' },
          { transform: `translateY(${-h}px) scale(.95, 1.07)`, offset: 0.16, easing: 'cubic-bezier(.6,0,.9,.5)' },
          { transform: 'scale(1.07, .92)', offset: 0.3 },
          { transform: 'translateX(-4px) rotate(-2.2deg)', offset: 0.42 },
          { transform: 'translateX(4px) rotate(2.2deg)', offset: 0.54 },
          { transform: 'translateX(-2.5px) rotate(-1.2deg)', offset: 0.66 },
          { transform: 'translateX(1.5px) rotate(.5deg)', offset: 0.8 },
          { transform: 'none' },
        ], { duration: 820, delay: i * 45, easing: 'ease-out' });
        play(c.id, 'shadow', [
          { transform: 'none' }, { transform: 'scale(.72, .8)', offset: 0.16 }, { transform: 'none', offset: 0.3 }, { transform: 'none' },
        ], { duration: 820, delay: i * 45 });
      });
    } else if (reactKey.startsWith('success')) {
      cast.forEach((c, i) => {
        const h = { lila: 26, menta: 18, coral: 30, mel: 38 }[c.id];
        hop(c, h, 720, 40 + i * 65, 1.3);
        if (c.id === 'mel') hop(c, 20, 520, 40 + i * 65 + 720, 1);
      });
    }
  }, [reactKey, calm, play, hop, cast]);

  // Cutucão (clique/toque): pula rindo e os outros olham pra ele.
  const poke = useCallback((id) => {
    const c = byId[id];
    if (!c) return;
    setPoked((p) => ({ id, key: (p?.key || 0) + 1 }));
    const others = cast.filter((o) => o.id !== id).map((o) => o.id);
    live.current.glance = { ...Object.fromEntries(others.map((o) => [o, id])), until: performance.now() + 1300 };
    if (!calm) {
      hop(c, c.id === 'mel' ? 22 : 16, 620, 0, 1.4);
      play(id, 'face', [
        { transform: 'none' }, { transform: 'scale(1.08)', offset: 0.35 }, { transform: 'none' },
      ], { duration: 620, easing: 'ease-out', composite: 'add' });
    }
  }, [byId, cast, calm, hop, play]);
  useEffect(() => {
    if (!poked) return undefined;
    const t = setTimeout(() => setPoked(null), 1100);
    return () => clearTimeout(t);
  }, [poked]);
  const hover = useCallback((id, on) => setHoverId((h) => (on ? id : h === id ? null : h)), []);

  // Digitando: cada tecla faz um deles balançar a cabeça, um de cada vez
  // (mesma ordem sempre — nada sorteado).
  useEffect(() => {
    if (calm) return undefined;
    const root = document.querySelector(scope);
    if (!root) return undefined;
    let n = 0; let lastAt = 0;
    const order = ['coral', 'lila', 'menta', 'mel'];
    const onInput = (ev) => {
      const el = ev.target;
      if (!el?.matches?.('input, textarea') || isPasswordInput(el)) return;
      const now = performance.now();
      if (now - lastAt < 90) return;
      lastAt = now;
      const id = order[n++ % order.length];
      play(id, 'hop', [
        { transform: 'none' }, { transform: 'rotate(-2deg) translateY(-2px)', offset: 0.4 }, { transform: 'none' },
      ], { duration: 260, easing: 'ease-out' });
    };
    root.addEventListener('input', onInput);
    return () => root.removeEventListener('input', onInput);
  }, [calm, scope, play]);

  // Ponteiro do mouse (só guarda; o laço lê). Desligado no modo calmo.
  useEffect(() => {
    if (calm) { live.current.pointer = null; return undefined; }
    const onMove = (e) => { if (e.pointerType !== 'touch') live.current.pointer = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [calm]);

  // Piscadas: cada um no seu ritmo.
  const blink = useCallback((id, ms = 140) => {
    const el = els.current[id]?.char;
    if (!el) return;
    el.setAttribute('data-blink', '');
    setTimeout(() => el.removeAttribute('data-blink'), ms);
  }, []);
  useEffect(() => {
    if (calm) return undefined;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    // Ritmo fixo por bichinho (cada um no seu tempo, sem sorteio).
    const every = { lila: 3400, menta: 4600, coral: 3900, mel: 2900 };
    cast.forEach((c, i) => {
      const loop = () => later(() => { blink(c.id); loop(); }, every[c.id] || 3600);
      later(loop, 700 + i * 450);
    });
    return () => timers.forEach(clearTimeout);
  }, [calm, blink, cast]);

  // Laço de animação: molas pro olhar, rosto e inclinação.
  useEffect(() => {
    const sim = {};
    cast.forEach((c) => { sim[c.id] = { lean: 0, lv: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, px: 0, py: 0, w: '' }; });
    let raf = 0;
    let last = performance.now();

    // Ponto da página → coordenadas do viewBox (xMidYMax/xMaxYMax meet).
    const toVb = (r, p) => {
      const s = Math.min(r.width / VB.w, r.height / VB.h);
      const offX = (r.width - VB.w * s) * (align === 'right' ? 1 : 0.5);
      const offY = r.height - VB.h * s;
      return { x: VB.x + (p.x - r.left - offX) / s, y: VB.y + (p.y - r.top - offY) / s };
    };
    // Ponto de referência do formulário (o 1º campo): pra onde olham por padrão.
    const formPoint = (now) => {
      const L = live.current;
      if (!L.form || now - L.formAt > 400) {
        const root = document.querySelector(scope);
        const el = root?.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, button') || root;
        if (el) {
          const fr = el.getBoundingClientRect();
          L.form = { x: fr.left + Math.min(fr.width, 260) * 0.45, y: fr.top + fr.height / 2 };
        }
        L.formAt = now;
      }
      return L.form;
    };

    const goals = (now) => {
      const svg = svgRef.current;
      const r = svg?.getBoundingClientRect();
      const L = live.current;
      const mk = L.moodKey;
      if (!r || r.width === 0) return null;
      const fp = formPoint(now);
      const form = fp ? toVb(r, fp) : { x: VB.x + VB.w + 200, y: 120 };
      const pickPt = calm ? null : (L.caret || L.pointer);
      const tgt = pickPt ? toVb(r, pickPt) : form;
      const glance = L.glance && L.glance.until > now && (mk === 'idle' || mk === 'typing') ? L.glance : null;
      const formSide = Math.sign(form.x - (VB.x + VB.w / 2)) || 1;
      const out = {};
      cast.forEach((c) => {
        const mood = L.poked === c.id ? { ...MOODS[mk][c.id], ...POKE_FACE } : MOODS[mk][c.id];
        const ex = (c.eyes[0].x + c.eyes[1].x) / 2;
        const ey = c.eyes[0].y;
        let look = mood.look;
        if (glance?.[c.id]) look = { at: glance[c.id] };
        let dx = 0; let dy = 0; let leanG = 0; let pScale = 1;
        if (look === 'target' || look === 'form') {
          const p = look === 'form' ? form : tgt;
          dx = p.x - ex; dy = p.y - ey;
          leanG = clamp(dx / 150, -1, 1) * c.lean * (mk === 'typing' ? 1.15 : 0.7);
        } else if (look === 'away') {
          dx = -150 * formSide; dy = -80;
          leanG = -c.lean * 0.75 * formSide;
        } else if (look === 'front') {
          dx = 0; dy = 60; pScale = 0.35;
        } else if (look?.at) {
          const o = byId[look.at];
          dx = (o.eyes[0].x + o.eyes[1].x) / 2 - ex; dy = o.eyes[0].y - ey;
          leanG = clamp(dx / 150, -1, 1) * c.lean * 0.6;
        }
        if (mk === 'peek' && c.id === 'lila') leanG = c.lean * 1.1 * formSide;
        if (mk === 'pout') leanG = -c.lean * 0.35 * formSide;
        if (mk === 'error' || mk === 'success') leanG = 0;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = dx / dist; const ny = dy / dist;
        const pa = c.pMax * Math.min(1, dist / 70) * pScale;
        const fa = c.face * Math.min(1, dist / 200) * (look === 'front' ? 0.3 : 1);
        out[c.id] = {
          lean: leanG, fx: nx * fa, fy: ny * fa * 0.6 + (mk === 'pout' ? -2 : 0),
          px: nx * pa, py: ny * pa * 0.85,
        };
      });
      return out;
    };

    const write = (c, s) => {
      const e = els.current[c.id];
      if (!e) return;
      const key = `${r2(s.lean)}|${r2(s.fx)}|${r2(s.fy)}|${r2(s.px)}|${r2(s.py)}`;
      if (key === s.w) return; // nada mudou: não mexe no DOM
      s.w = key;
      e.lean?.setAttribute('transform', `translate(${c.cx} ${FLOOR}) skewX(${r2(-s.lean)}) translate(${-c.cx} ${-FLOOR})`);
      if (e.face) e.face.style.transform = `translate(${r2(s.fx)}px, ${r2(s.fy)}px)`;
      const pt = `translate(${r2(s.px)}px, ${r2(s.py)}px)`;
      e.char?.querySelectorAll('.pcc-pupil').forEach((p) => { p.style.transform = pt; });
    };

    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const g = goals(now);
      if (g) {
        cast.forEach((c) => {
          const s = sim[c.id]; const t = g[c.id];
          if (calm) {
            Object.assign(s, { lean: 0, fx: t.fx, fy: t.fy, px: t.px, py: t.py });
          } else {
            // Mola levemente sub-amortecida (balancinho no fim).
            const k = c.k; const d = 2 * Math.sqrt(k) * c.z;
            s.lv += (k * (t.lean - s.lean) - d * s.lv) * dt; s.lean += s.lv * dt;
            const kf = k * 1.6; const df = 2 * Math.sqrt(kf) * Math.min(0.9, c.z + 0.15);
            s.fvx += (kf * (t.fx - s.fx) - df * s.fvx) * dt; s.fx += s.fvx * dt;
            s.fvy += (kf * (t.fy - s.fy) - df * s.fvy) * dt; s.fy += s.fvy * dt;
            const a = 1 - Math.exp(-dt * 14); // olhos: lerp suave
            s.px += (t.px - s.px) * a; s.py += (t.py - s.py) * a;
          }
          write(c, s);
        });
      }
      // Pausa quando a aba está escondida (economiza bateria/CPU).
      if (!calm && !document.hidden) raf = requestAnimationFrame(tick);
      else raf = 0;
    };

    if (calm) {
      // Modo calmo: posiciona uma vez (e de novo se a tela mudar).
      const snap = () => tick(performance.now());
      snap();
      const t = setTimeout(snap, 120);
      window.addEventListener('resize', snap);
      live.current.snap = snap;
      return () => { clearTimeout(t); window.removeEventListener('resize', snap); live.current.snap = null; };
    }
    // Retoma o laço quando a aba volta a ficar visível.
    const onVis = () => { if (!document.hidden && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);
    return () => { document.removeEventListener('visibilitychange', onVis); if (raf) cancelAnimationFrame(raf); };
  }, [calm, scope, align, cast, byId]);

  // No modo calmo, reposiciona quando muda o estado.
  useEffect(() => { live.current.snap?.(); }, [moodKey, focus.caret?.x, focus.caret?.y]);

  return (
    <div
      className={`pcc-stage ${className}`}
      data-mode={mode}
      data-mood={moodKey}
      data-calm={calm || undefined}
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        className="pcc-svg"
        viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
        preserveAspectRatio={align === 'right' ? 'xMaxYMax meet' : 'xMidYMax meet'}
        focusable="false"
      >
        <defs>
          {cast.map((c) => (
            <g key={c.id}>
              <radialGradient id={`${uid}-ck-${c.id}`}>
                <stop offset="0" stopColor={c.cheek} stopOpacity=".95" />
                <stop offset="1" stopColor={c.cheek} stopOpacity="0" />
              </radialGradient>
              <linearGradient id={`${uid}-g-${c.id}`} gradientUnits="userSpaceOnUse" x1={c.cx - c.w * 0.3} y1={c.bodyTop} x2={c.cx + c.w * 0.3} y2={FLOOR}>
                <stop offset="0" stopColor={c.top} />
                <stop offset=".5" stopColor={c.base} />
                <stop offset="1" stopColor={c.base} />
              </linearGradient>
              {/* Luvinha mais clara que o corpo, pra ler como mão em cima do rosto. */}
              <linearGradient id={`${uid}-h-${c.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c.mitt} />
                <stop offset="1" stopColor={c.top} />
              </linearGradient>
              <linearGradient id={`${uid}-sv-${c.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={c.bodyTop} x2="0" y2={FLOOR}>
                <stop offset=".4" stopColor={c.deep} stopOpacity="0" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".65" />
              </linearGradient>
              <linearGradient id={`${uid}-sh-${c.id}`} gradientUnits="userSpaceOnUse" x1={c.cx - c.w / 2} y1="0" x2={c.cx + c.w / 2} y2="0">
                <stop offset=".5" stopColor={c.deep} stopOpacity="0" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".5" />
              </linearGradient>
              {/* Oclusão de contato: escurece o pezinho pra assentar no chão. */}
              <linearGradient id={`${uid}-occ-${c.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={FLOOR - 42} x2="0" y2={FLOOR}>
                <stop offset="0" stopColor={c.deep} stopOpacity="0" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".5" />
              </linearGradient>
              <clipPath id={`${uid}-b-${c.id}`}><path d={c.body} /></clipPath>
              <clipPath id={`${uid}-eye-${c.id}`}><circle r={c.r + 0.3} /></clipPath>
            </g>
          ))}
          <radialGradient id={`${uid}-sheen`}>
            <stop offset="0" stopColor="#fff" stopOpacity=".62" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-shadow`}>
            <stop offset="0" stopColor="#000" stopOpacity=".75" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          {/* esclera: branca com sombrinha da pálpebra em cima */}
          <radialGradient id={`${uid}-scl`} cx="50%" cy="62%" r="60%">
            <stop offset=".55" stopColor="#fff" />
            <stop offset="1" stopColor="#dcd8e6" />
          </radialGradient>
          {/* íris: mais clara embaixo, como luz entrando no olho */}
          <radialGradient id={`${uid}-iris`} cx="50%" cy="75%" r="65%">
            <stop offset="0" stopColor="#fff" stopOpacity=".45" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0" stopColor="#fff" stopOpacity=".09" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-floor`} gradientUnits="userSpaceOnUse" x1={VB.x} y1="0" x2={VB.x + VB.w} y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".22" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Chão: brilho de fundo, linha e sombras de contato. */}
        <ellipse cx="246" cy={FLOOR - 64} rx="200" ry="100" fill={`url(#${uid}-glow)`} />
        <rect x={VB.x} y={FLOOR} width={VB.w} height="1" fill={`url(#${uid}-floor)`} />
        <ellipse cx="248" cy={FLOOR + 3} rx="210" ry="9" fill={`url(#${uid}-shadow)`} opacity=".55" />
        {cast.map((c) => (
          <g key={c.id} transform={`translate(${c.cx} ${FLOOR + 1.5})`}>
            <ellipse
              ref={reg(c.id, 'shadow')} className="pcc-shadow"
              rx={c.w * 0.56} ry="5.5" fill={`url(#${uid}-shadow)`}
            />
          </g>
        ))}

        <g className="pcc-group">
          {cast.map((c) => (
            <Character key={c.id} c={c} index={c.idx} mood={moods[c.id]} reg={reg} uid={uid} onPoke={poke} onHover={hover} />
          ))}
        </g>

        {mode === 'success' && (
          <g className="pcc-sparkles">
            {SPARKLES.map((s, i) => (
              <g key={i} transform={`translate(${s.x} ${s.y}) scale(${s.s})`}>
                <path className="pcc-spark" d={SPARK} fill={cast[i % cast.length].top} style={{ '--i': i }} />
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

// Pequeno ajudante pras páginas: const [reaction, react] = useReaction();
// react('error') / react('success').
export function useReaction() {
  const [reaction, setReaction] = useState(null);
  const fire = useCallback((type) => setReaction((r) => ({ type, key: (r?.key || 0) + 1 })), []);
  return [reaction, fire];
}
