import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import '../../styles/auth-characters.css';

// ---------------------------------------------------------------------
// Turminha das telas de login/inscrição: quatro bichinhos que acompanham
// o que a pessoa faz no formulário.
//
//   Lila  — pílula alta lilás com anteninha (a curiosa)
//   Coral — quadradão fofinho de bochechas (o tímido)
//   Menta — cúpula com topete de folhinhas (a tranquila)
//   Mel   — bolinha amarela saltitante (o caçula)
//
//   parado    → respiram, piscam (às vezes juntos), trocam olhares,
//               a Lila mexe a antena, o Mel dá pulinhos…
//   digitando → se inclinam pro campo e os olhos seguem o cursor do texto
//   senha     → tapam os olhos com as mãozinhas / fecham os olhos sorrindo
//   "mostrar" → com a senha à mostra, a Lila espia com um olho só
//               (o Coral continua tapando e o Mel olha feio pra ela)
//   erro      → susto (pulinho + tremida) e depois biquinho emburrado
//   sucesso   → pulo de comemoração com brilhinhos
//
// Movimento: o olhar, o rosto e a inclinação são molas simuladas num
// único requestAnimationFrame que escreve direto no DOM (nada de
// re-render por quadro; o mouse fica numa ref). Pulos e tremidas usam a
// Web Animations API; expressões trocam por atributos + transições CSS.
// Só transform/opacity animam. prefers-reduced-motion e html[data-lite]
// ("modo calmo") desligam tudo que se mexe sozinho: as expressões de
// cada estado continuam, paradas, olhando pro formulário.
// Puramente decorativo: aria-hidden.
// ---------------------------------------------------------------------

const VB = { x: 38, y: 0, w: 416, h: 244 };
const FLOOR = 228;
const INK = '#1d1631';

// Coordenadas no viewBox. Tudo que gira/escala é desenhado na origem
// local e posicionado pelo grupo pai (assim o CSS usa origem 0 0).
const CHARS = [
  {
    id: 'lila', cx: 191, w: 82,
    top: '#cbc6ff', base: '#a39bff', mitt: '#ebe8ff', deep: '#7467e8', lid: '#a8a0ff', cheek: '#ff8cc6',
    body: 'M150 214 V86 A41 41 0 0 1 232 86 V214 Q232 228 218 228 H164 Q150 228 150 214 Z',
    bodyTop: 45,
    eye: 'ball', eyes: [{ x: 174, y: 97 }, { x: 208, y: 97 }], r: 12, pr: 6.1, pMax: 5,
    brow: 19, mouth: { x: 191, y: 125, s: 1 },
    blush: [{ x: 161, y: 115 }, { x: 221, y: 115 }], blushR: [7, 4],
    hand: 1, rest: [[158, 168], [224, 168]], up: [[149, 104], [233, 104]], chin: [216, 124],
    lean: 6, k: 80, z: 0.6, face: 6, antenna: { x: 191, y: 46 },
  },
  {
    id: 'menta', cx: 296, w: 148,
    top: '#b4f3e0', base: '#74dcc1', mitt: '#dcfbf1', deep: '#3db497', cheek: '#ffa0b8',
    body: 'M222 228 V184 C222 140 254 118 296 118 C338 118 370 140 370 184 V228 Z',
    bodyTop: 118,
    eye: 'dot', eyes: [{ x: 280, y: 164 }, { x: 313, y: 164 }], r: 6, pr: 5.4, pMax: 3.2,
    brow: 14, mouth: { x: 296, y: 184, s: 0.95 },
    blush: [{ x: 266, y: 181 }, { x: 327, y: 181 }], blushR: [8, 4.5],
    hand: 1, rest: [[232, 206], [360, 206]], up: [[226, 160], [366, 160]], chin: [318, 196],
    lean: 3.4, k: 55, z: 0.72, face: 7, tuft: { x: 296, y: 120 },
  },
  {
    id: 'coral', cx: 116, w: 108,
    top: '#ffc0b0', base: '#ff917b', mitt: '#ffe6de', deep: '#ec6853', cheek: '#ff5f86',
    body: 'M62 158 Q62 128 92 128 H140 Q170 128 170 158 V214 Q170 228 156 228 H76 Q62 228 62 214 Z',
    bodyTop: 128,
    eye: 'bean', eyes: [{ x: 101, y: 168 }, { x: 132, y: 168 }], r: 7, pr: 7, pMax: 2.6,
    brow: 17, mouth: { x: 116, y: 189, s: 1.05 },
    blush: [{ x: 86, y: 187 }, { x: 147, y: 187 }], blushR: [9.5, 5.5],
    hand: 1.05, rest: [[72, 204], [160, 204]], up: [[63, 150], [169, 150]], chin: [140, 198],
    lean: 4.6, k: 120, z: 0.55, face: 6,
  },
  {
    id: 'mel', cx: 396, w: 66,
    top: '#fff0bf', base: '#ffd977', mitt: '#fffaea', deep: '#f0b443', lid: '#ffdd86', cheek: '#ff8a7a',
    body: 'M363 211 C363 185 378 170 396 170 C414 170 429 185 429 211 C429 224 419 228 396 228 C373 228 363 224 363 211 Z',
    bodyTop: 170,
    eye: 'ball', eyes: [{ x: 386, y: 195 }, { x: 407, y: 195 }], r: 8.4, pr: 4.9, pMax: 3,
    brow: 13, mouth: { x: 396, y: 211, s: 0.78 },
    blush: [{ x: 376, y: 207 }, { x: 417, y: 207 }], blushR: [5, 3],
    hand: 0.98, coverIn: 2.5, rest: [[372, 214], [420, 214]], up: [[364, 192], [428, 192]], chin: [410, 212],
    lean: 8, k: 190, z: 0.42, face: 4, sprout: { x: 396, y: 171 },
  },
];
const BY_ID = Object.fromEntries(CHARS.map((c) => [c.id, c]));
// Ordem de desenho (de trás pra frente).
const DRAW = ['lila', 'menta', 'coral', 'mel'].map((id) => BY_ID[id]);

// Expressões: olhos (open | wide | half | closed | happy | squeeze — ou
// um par, um por olho), boca, sobrancelha, mãos (rest | cover | up |
// peek), bochecha (0–3) e pra onde olham.
const E = (eyes, mouth, o = {}) => ({ eyes, mouth, brow: 'none', hands: 'rest', blush: 1, look: 'target', ...o });
const MOODS = {
  idle: {
    lila: E('open', 'smile', { brow: 'soft' }),
    menta: E('open', 'soft', { brow: 'soft' }),
    coral: E('open', 'cat', { blush: 2 }),
    mel: E('open', 'smile'),
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
  { x: 120, y: 98, s: 1.1, c: '#fff' }, { x: 196, y: 6, s: 0.9, c: '#ffd977' },
  { x: 250, y: 58, s: 0.7, c: '#cbc6ff' }, { x: 340, y: 96, s: 1, c: '#b4f3e0' },
  { x: 430, y: 148, s: 0.8, c: '#fff' }, { x: 66, y: 104, s: 0.7, c: '#ffc0b0' },
  { x: 150, y: 40, s: 0.6, c: '#fff' }, { x: 384, y: 130, s: 0.6, c: '#ffd977' },
];
const MITTEN = 'M-7.5 6 C-9.5 0 -9 -7.5 -3.5 -9.5 C1.5 -11 7.5 -8.5 8 -2 C8.5 4 5.5 8.5 0 8.5 C-3.5 8.5 -6.5 8 -7.5 6 Z';
const SPARK = 'M0 -9 C1.2 -2.4 2.4 -1.2 9 0 C2.4 1.2 1.2 2.4 0 9 C-1.2 2.4 -2.4 1.2 -9 0 C-2.4 -1.2 -1.2 -2.4 0 -9 Z';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

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
  return (
    <g transform={`translate(${e.x} ${e.y})`}>
      <g className="pcc-eye" data-state={state}>
        <g className="pcc-eye-open">
          <g className="pcc-blink">
            {c.eye === 'ball' && <circle r={c.r} fill="#fff" />}
            <g className="pcc-pupil">
              <g className="pcc-pupil-s">
                {c.eye === 'bean'
                  ? <ellipse rx={c.pr * 0.92} ry={c.pr * 1.32} fill={INK} />
                  : <circle r={c.pr} fill={INK} />}
                <circle cx={c.pr * 0.34} cy={-c.pr * 0.42} r={c.pr * 0.36} fill="#fff" />
                <circle cx={-c.pr * 0.36} cy={c.pr * 0.4} r={c.pr * 0.15} fill="#fff" opacity=".8" />
              </g>
            </g>
            {c.eye === 'ball' && (
              // Pálpebra de verdade: desce por cima da esclera (recortada).
              <g clipPath={`url(#${uid}-eye-${c.id})`}>
                <path
                  className="pcc-lid" fill={c.lid}
                  d={`M${-c.r - 2} ${-2 * c.r - 4} H${c.r + 2} V0 Q0 3 ${-c.r - 2} 0 Z`}
                />
              </g>
            )}
          </g>
          {c.eye !== 'ball' && <path className="pcc-lidline" d={`M${-c.r - 2} ${-c.r * 0.15} H${c.r + 2}`} stroke={INK} strokeWidth="2.6" strokeLinecap="round" />}
        </g>
        <path className="pcc-eye-alt pcc-eye-closed" d="M-6.5 -0.5 Q0 4.5 6.5 -0.5" />
        <path className="pcc-eye-alt pcc-eye-happy" d="M-6.5 2.5 Q0 -5.5 6.5 2.5" />
        <path className="pcc-eye-alt pcc-eye-squeeze" d={`M${-5 * side} -5 L${5 * side} 0 L${-5 * side} 5`} />
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
  // Tapando: as patinhas se encostam um pouco pro meio (no Mel, quase juntas).
  if (pose === 'cover') return [ex - (c.coverIn || 0) * tilt, ey + 1 + (c.coverIn || 0), 14 * tilt, true];
  if (pose === 'up') return [c.up[i][0], c.up[i][1], 28 * tilt, true];
  if (pose === 'peek') return i === 0 ? [ex, ey, -18, true] : [c.chin[0], c.chin[1], 30, true];
  return [rx, ry, 0, false];
}

const Character = memo(function Character({ c, mood, index, reg, uid }) {
  const eyeStates = Array.isArray(mood.eyes) ? mood.eyes : [mood.eyes, mood.eyes];
  const brow = BROWS[mood.brow];
  const handsOn = mood.hands !== 'rest';
  return (
    <g
      ref={reg(c.id, 'char')}
      className={`pcc-char pcc-${c.id}`}
      data-blush={mood.blush}
      style={{ '--i': index, '--r': c.r }}
    >
      <g ref={reg(c.id, 'hop')} className="pcc-hop">
        <g ref={reg(c.id, 'lean')}>
          <g className="pcc-breathe">
            {c.antenna && (
              <g transform={`translate(${c.antenna.x} ${c.antenna.y})`}>
                <g className="pcc-antenna-sway">
                  <g ref={reg(c.id, 'antenna')} className="pcc-antenna">
                    <path d="M0 1 C0 -9 4 -16 9 -27" fill="none" stroke={c.deep} strokeWidth="3.2" strokeLinecap="round" />
                    <circle cx="10" cy="-30" r="13" fill={`url(#${uid}-bulb)`} className="pcc-antenna-glow" />
                    <circle cx="10" cy="-30" r="6" fill="#ffd977" />
                    <circle cx="8" cy="-32" r="1.8" fill="#fff" opacity=".9" />
                  </g>
                </g>
              </g>
            )}
            {c.tuft && (
              <g transform={`translate(${c.tuft.x} ${c.tuft.y})`}>
                <g ref={reg(c.id, 'tuft')} className="pcc-tuft">
                  <path d="M0 2 C-3 -8 -12 -14 -19 -12 C-15 -6 -9 -1 0 2 Z" fill={c.deep} />
                  <path d="M0 2 C1 -10 8 -19 16 -20 C14 -11 8 -3 0 2 Z" fill={c.base} stroke={c.deep} strokeWidth="1.5" />
                </g>
              </g>
            )}
            {c.sprout && (
              <g transform={`translate(${c.sprout.x} ${c.sprout.y})`}>
                <g ref={reg(c.id, 'tuft')} className="pcc-tuft">
                  <path d="M0 1 C-1 -5 2 -9 6 -9 C8 -9 8 -6 6 -5" fill="none" stroke={c.deep} strokeWidth="2.6" strokeLinecap="round" />
                </g>
              </g>
            )}

            <path d={c.body} fill={`url(#${uid}-g-${c.id})`} />
            <g clipPath={`url(#${uid}-b-${c.id})`}>
              {/* sombra própria embaixo/à direita e brilho em cima/à esquerda */}
              <rect x={c.cx - c.w} y={c.bodyTop - 30} width={c.w * 2} height={FLOOR - c.bodyTop + 30} fill={`url(#${uid}-sv-${c.id})`} />
              <rect x={c.cx - c.w} y={c.bodyTop - 30} width={c.w * 2} height={FLOOR - c.bodyTop + 30} fill={`url(#${uid}-sh-${c.id})`} />
              <ellipse cx={c.cx - c.w * 0.22} cy={c.bodyTop + 14} rx={c.w * 0.3} ry={Math.min(26, (FLOOR - c.bodyTop) * 0.16)} fill={`url(#${uid}-sheen)`} />
            </g>
            <path d={c.body} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.2" className="pcc-rim" />

            <g ref={reg(c.id, 'face')} className="pcc-face">
              <g className="pcc-blush">
                {c.blush.map((b, i) => <ellipse key={i} cx={b.x} cy={b.y} rx={c.blushR[0]} ry={c.blushR[1]} fill={c.cheek} />)}
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
  const moods = MOODS[moodKey];

  // Tudo que o laço de animação lê fica numa ref (sem re-render por quadro).
  const live = useRef({ pointer: null, caret: null, moodKey, glance: null, form: null, formAt: 0 });
  live.current.caret = focus.caret;
  live.current.moodKey = moodKey;

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
      CHARS.forEach((c, i) => {
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
      CHARS.forEach((c, i) => {
        const h = { lila: 26, menta: 18, coral: 30, mel: 38 }[c.id];
        hop(c, h, 720, 40 + i * 65, 1.3);
        if (c.id === 'mel') hop(c, 20, 520, 40 + i * 65 + 720, 1);
      });
      play('lila', 'antenna', [
        { transform: 'rotate(0)' }, { transform: 'rotate(-16deg)', offset: 0.25 }, { transform: 'rotate(12deg)', offset: 0.5 },
        { transform: 'rotate(-6deg)', offset: 0.75 }, { transform: 'rotate(0)' },
      ], { duration: 900, delay: 400, easing: 'ease-in-out' });
    }
  }, [reactKey, calm, play, hop]);

  // Ponteiro do mouse (só guarda; o laço lê). Desligado no modo calmo.
  useEffect(() => {
    if (calm) { live.current.pointer = null; return undefined; }
    const onMove = (e) => { if (e.pointerType !== 'touch') live.current.pointer = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [calm]);

  // Piscadas: cada um no seu ritmo (às vezes dois piscam juntos).
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
    CHARS.forEach((c, i) => {
      const loop = () => later(() => {
        blink(c.id);
        if (Math.random() < 0.2) later(() => blink(c.id), 260); // piscada dupla
        loop();
      }, 2200 + Math.random() * 3600 + i * 250);
      loop();
    });
    return () => timers.forEach(clearTimeout);
  }, [calm, blink]);

  // Micro-ações quando estão parados: trocam olhares, piscam juntos,
  // pulinho, antena, topete, amassadinho.
  useEffect(() => {
    if (calm) return undefined;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
    const PAIRS = [['lila', 'coral'], ['menta', 'mel'], ['coral', 'mel'], ['lila', 'mel'], ['lila', 'menta']];
    let n = 0;
    const act = () => {
      if (live.current.moodKey === 'idle' && !document.hidden) {
        const pick = (n++ % 2 === 0) ? 'glance' : ['hop', 'wiggle', 'tuft', 'squish', 'blink2'][Math.floor(Math.random() * 5)];
        if (pick === 'glance') {
          const [a, b] = PAIRS[Math.floor(Math.random() * PAIRS.length)];
          live.current.glance = { [a]: b, [b]: a, until: performance.now() + 1500 };
          later(() => { blink(a); blink(b); }, 900);
        } else if (pick === 'hop') {
          hop(BY_ID.mel, 14, 560);
          later(() => hop(BY_ID.mel, 8, 460), 560);
        } else if (pick === 'wiggle') {
          play('lila', 'antenna', [
            { transform: 'rotate(0)' }, { transform: 'rotate(-14deg)', offset: 0.2 }, { transform: 'rotate(11deg)', offset: 0.45 },
            { transform: 'rotate(-6deg)', offset: 0.7 }, { transform: 'rotate(2deg)', offset: 0.88 }, { transform: 'rotate(0)' },
          ], { duration: 1000, easing: 'ease-in-out' });
        } else if (pick === 'tuft') {
          play('menta', 'tuft', [
            { transform: 'none' }, { transform: 'rotate(-12deg) scale(1.08)', offset: 0.25 }, { transform: 'rotate(9deg)', offset: 0.55 },
            { transform: 'rotate(-3deg)', offset: 0.8 }, { transform: 'none' },
          ], { duration: 900, easing: 'ease-in-out' });
        } else if (pick === 'squish') {
          play('coral', 'hop', [
            { transform: 'none' }, { transform: 'scale(1.06, .93)', offset: 0.3 }, { transform: 'scale(.97, 1.04)', offset: 0.6 }, { transform: 'none' },
          ], { duration: 700, easing: 'ease-in-out' });
        } else {
          blink('lila'); blink('menta');
        }
      }
      later(act, 2600 + Math.random() * 2600);
    };
    later(act, 1800);
    return () => timers.forEach(clearTimeout);
  }, [calm, blink, hop, play]);

  // Laço de animação: molas pro olhar, rosto e inclinação.
  useEffect(() => {
    const sim = {};
    CHARS.forEach((c) => { sim[c.id] = { lean: 0, lv: 0, fx: 0, fy: 0, fvx: 0, fvy: 0, px: 0, py: 0, w: '' }; });
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
      const pick = calm ? null : (L.caret || L.pointer);
      const tgt = pick ? toVb(r, pick) : form;
      const glance = L.glance && L.glance.until > now && mk === 'idle' ? L.glance : null;
      const formSide = Math.sign(form.x - (VB.x + VB.w / 2)) || 1;
      const out = {};
      CHARS.forEach((c) => {
        const mood = MOODS[mk][c.id];
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
          const o = BY_ID[look.at];
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
        CHARS.forEach((c) => {
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
      if (!calm) raf = requestAnimationFrame(tick);
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
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [calm, scope, align]);

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
          {CHARS.map((c) => (
            <g key={c.id}>
              <linearGradient id={`${uid}-g-${c.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={c.bodyTop} x2="0" y2={FLOOR}>
                <stop offset="0" stopColor={c.top} />
                <stop offset=".55" stopColor={c.base} />
                <stop offset="1" stopColor={c.base} />
              </linearGradient>
              {/* Luvinha mais clara que o corpo, pra ler como mão em cima do rosto. */}
              <linearGradient id={`${uid}-h-${c.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={c.mitt} />
                <stop offset="1" stopColor={c.top} />
              </linearGradient>
              <linearGradient id={`${uid}-sv-${c.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={c.bodyTop} x2="0" y2={FLOOR}>
                <stop offset=".45" stopColor={c.deep} stopOpacity="0" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".7" />
              </linearGradient>
              <linearGradient id={`${uid}-sh-${c.id}`} gradientUnits="userSpaceOnUse" x1={c.cx - c.w / 2} y1="0" x2={c.cx + c.w / 2} y2="0">
                <stop offset=".55" stopColor={c.deep} stopOpacity="0" />
                <stop offset="1" stopColor={c.deep} stopOpacity=".45" />
              </linearGradient>
              <clipPath id={`${uid}-b-${c.id}`}><path d={c.body} /></clipPath>
              {c.eye === 'ball' && <clipPath id={`${uid}-eye-${c.id}`}><circle r={c.r + 0.3} /></clipPath>}
            </g>
          ))}
          <radialGradient id={`${uid}-sheen`}>
            <stop offset="0" stopColor="#fff" stopOpacity=".5" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-shadow`}>
            <stop offset="0" stopColor="#000" stopOpacity=".75" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-bulb`}>
            <stop offset=".3" stopColor="#ffd977" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffd977" stopOpacity="0" />
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
        {CHARS.map((c) => (
          <g key={c.id} transform={`translate(${c.cx} ${FLOOR + 1.5})`}>
            <ellipse
              ref={reg(c.id, 'shadow')} className="pcc-shadow"
              rx={c.w * 0.56} ry="5.5" fill={`url(#${uid}-shadow)`}
            />
          </g>
        ))}

        <g className="pcc-group">
          {DRAW.map((c) => (
            <Character key={c.id} c={c} index={CHARS.indexOf(c)} mood={moods[c.id]} reg={reg} uid={uid} />
          ))}
        </g>

        {mode === 'success' && (
          <g className="pcc-sparkles">
            {SPARKLES.map((s, i) => (
              <g key={i} transform={`translate(${s.x} ${s.y}) scale(${s.s})`}>
                <path className="pcc-spark" d={SPARK} fill={s.c} style={{ '--i': i }} />
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
