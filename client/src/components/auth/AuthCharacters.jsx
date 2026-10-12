import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/auth-characters.css';

// ---------------------------------------------------------------------
// Turminha das telas de login/inscrição: quatro bonequinhos geométricos
// que acompanham o que a pessoa faz no formulário.
//
//   parado        → piscam, "respiram" e seguem o mouse com os olhos
//   digitando     → se inclinam pro campo e os olhos seguem o cursor do
//                   texto (posição medida com canvas na fonte do campo)
//   senha         → fecham os olhos / olham pro outro lado, educados
//   "mostrar"     → com a senha visível, o roxo dá uma espiadinha
//   erro          → tremem, boca em "O" e sobrancelha brava (~1,2s)
//   sucesso       → pulinho feliz antes de entrar
//
// Tudo SVG + transform/opacity (nada de layout por quadro). O movimento
// do mouse é agrupado em requestAnimationFrame. prefers-reduced-motion e
// html[data-lite] desligam animações contínuas, inclinação e o
// acompanhamento do mouse — os estados (olhos fechados, sorriso...) ficam.
// Puramente decorativo: aria-hidden.
// ---------------------------------------------------------------------

const VB = { x: 0, y: 26, w: 372, h: 280 };

// Coordenadas no viewBox. `face` = centro do rosto (base do cálculo do
// olhar); olhos com `ball` têm esclera branca, os outros são só pupilas.
const CHARS = [
  {
    id: 'roxo', fill: '#7c5cff', shade: '#6a49f2', lean: 1.15, brows: true,
    body: 'M66 302 V52 Q66 40 78 40 H176 Q188 40 188 52 V302 Z',
    eyes: [{ x: 106, y: 100 }, { x: 148, y: 100 }], ball: true, r: 11.5, pr: 5.2,
    mouth: { x: 127, y: 132 }, breath: 0,
  },
  {
    id: 'breu', fill: '#26262d', shade: '#1c1c22', lean: 0.95, brows: true, outline: true, lid: '#f5f5f7',
    body: 'M170 302 V136 Q170 118 188 118 H252 Q270 118 270 136 V302 Z',
    eyes: [{ x: 202, y: 164 }, { x: 238, y: 164 }], ball: true, r: 10, pr: 4.6,
    mouth: { x: 220, y: 192 }, breath: -1.1,
  },
  {
    id: 'laranja', fill: '#ff8a3d', shade: '#f2782a', lean: 0.55,
    body: 'M28 302 A100 100 0 0 1 228 302 Z',
    eyes: [{ x: 108, y: 252 }, { x: 148, y: 252 }], ball: false, pr: 6,
    mouth: { x: 128, y: 278 }, breath: -2.3,
  },
  {
    id: 'amarelo', fill: '#ffd23f', shade: '#f5c321', lean: 0.8,
    body: 'M252 302 V198 A46 46 0 0 1 344 198 V302 Z',
    eyes: [{ x: 284, y: 200 }, { x: 314, y: 200 }], ball: false, pr: 5.4,
    mouth: { x: 299, y: 226 }, breath: -0.6,
  },
];

// Expressão de cada um em cada modo: olhos (open | closed | happy |
// squint | wide), boca e pra onde olham ('target' = mouse/cursor,
// 'away' = pro outro lado, 'front' = pra frente).
const MOODS = {
  idle: {
    roxo: { eyes: 'open', mouth: 'smile', look: 'target' },
    breu: { eyes: 'open', mouth: 'flat', look: 'target' },
    laranja: { eyes: 'open', mouth: 'smile', look: 'target' },
    amarelo: { eyes: 'open', mouth: 'line', look: 'target' },
  },
  typing: {
    roxo: { eyes: 'open', mouth: 'smile', look: 'target' },
    breu: { eyes: 'open', mouth: 'smile', look: 'target' },
    laranja: { eyes: 'open', mouth: 'grin', look: 'target' },
    amarelo: { eyes: 'open', mouth: 'smile', look: 'target' },
  },
  password: {
    roxo: { eyes: 'open', mouth: 'flat', look: 'away' },
    breu: { eyes: 'open', mouth: 'flat', look: 'away' },
    laranja: { eyes: 'closed', mouth: 'flat', look: 'away' },
    amarelo: { eyes: 'closed', mouth: 'line', look: 'away' },
  },
  peek: {
    roxo: { eyes: 'peek', mouth: 'smirk', look: 'target' },
    breu: { eyes: 'closed', mouth: 'flat', look: 'away' },
    laranja: { eyes: 'closed', mouth: 'flat', look: 'away' },
    amarelo: { eyes: 'open', mouth: 'line', look: 'roxo' },
  },
  error: {
    roxo: { eyes: 'wide', mouth: 'frown', look: 'target', angry: true },
    breu: { eyes: 'wide', mouth: 'frown', look: 'target', angry: true },
    laranja: { eyes: 'wide', mouth: 'o', look: 'target' },
    amarelo: { eyes: 'wide', mouth: 'o', look: 'target' },
  },
  success: {
    roxo: { eyes: 'happy', mouth: 'big', look: 'front' },
    breu: { eyes: 'happy', mouth: 'big', look: 'front' },
    laranja: { eyes: 'happy', mouth: 'big', look: 'front' },
    amarelo: { eyes: 'happy', mouth: 'big', look: 'front' },
  },
};

const MOUTHS = {
  line: { d: 'M-8 0 H8', stroke: true },
  flat: { d: 'M-5 0 H5', stroke: true },
  smile: { d: 'M-8 -2 Q0 6 8 -2', stroke: true },
  grin: { d: 'M-9 -3 Q0 8 9 -3', stroke: true },
  smirk: { d: 'M-7 1 Q2 4 9 -4', stroke: true },
  frown: { d: 'M-8 4 Q0 -3 8 4', stroke: true },
  big: { d: 'M-10 -3 Q0 13 10 -3 Z', stroke: false },
  o: { ellipse: true },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

// Pisca cada um num ritmo próprio.
function useBlinks(enabled) {
  const [blinking, setBlinking] = useState({});
  useEffect(() => {
    if (!enabled) return undefined;
    const timers = [];
    CHARS.forEach((c, i) => {
      const loop = () => {
        const t = setTimeout(() => {
          setBlinking((b) => ({ ...b, [c.id]: true }));
          const t2 = setTimeout(() => {
            setBlinking((b) => ({ ...b, [c.id]: false }));
            // De vez em quando, uma piscada dupla.
            if (Math.random() < 0.18) {
              const t3 = setTimeout(() => {
                setBlinking((b) => ({ ...b, [c.id]: true }));
                timers.push(setTimeout(() => setBlinking((b) => ({ ...b, [c.id]: false })), 110));
              }, 140);
              timers.push(t3);
            }
            loop();
          }, 120);
          timers.push(t2);
        }, 1800 + Math.random() * 3800 + i * 300);
        timers.push(t);
      };
      loop();
    });
    return () => timers.forEach(clearTimeout);
  }, [enabled]);
  return blinking;
}

function Mouth({ kind, x, y, color }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Object.entries(MOUTHS).map(([k, m]) => (
        m.ellipse
          ? <ellipse key={k} className="pcc-mouth" data-on={kind === k || undefined} cx="0" cy="2" rx="5" ry="6.5" fill={color} />
          : (
            <path
              key={k} className="pcc-mouth" data-on={kind === k || undefined} d={m.d}
              fill={m.stroke ? 'none' : color} stroke={color} strokeWidth={m.stroke ? 3 : 1.5}
              strokeLinecap="round" strokeLinejoin="round"
            />
          )
      ))}
    </g>
  );
}

function Eye({ c, x, y, state, blink, px, py, left }) {
  const ink = c.ball ? '#121216' : '#16161a';
  // "peek": um olho aberto (espiando), o outro quase fechado.
  const eff = state === 'peek' ? (left ? 'squint' : 'open') : state;
  const open = eff === 'open' || eff === 'wide' || eff === 'squint';
  let sy = 1;
  if (!open || blink) sy = 0.08;
  else if (eff === 'squint') sy = 0.3;
  const s = eff === 'wide' ? 1.22 : 1;
  const pupilScale = eff === 'wide' ? 0.72 : 1;
  const lid = eff === 'happy' ? 'M-7 3 Q0 -6 7 3' : 'M-7 -1 Q0 5 7 -1';
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="pcc-eye" style={{ transform: `scale(${s}, ${s * sy})`, opacity: open ? 1 : 0 }}>
        {c.ball && <circle r={c.r} fill="#fff" />}
        <circle
          className="pcc-pupil" r={c.pr} fill={ink}
          style={{ transform: `translate(${px}px, ${py}px) scale(${pupilScale})` }}
        />
        {c.ball && (
          <circle
            className="pcc-pupil" r={c.pr * 0.32} fill="#fff" opacity=".85"
            style={{ transform: `translate(${px + c.pr * 0.35}px, ${py - c.pr * 0.4}px)` }}
          />
        )}
      </g>
      <path
        className="pcc-lid" d={lid} fill="none" stroke={c.lid || ink} strokeWidth="3" strokeLinecap="round"
        style={{ opacity: open ? 0 : 1 }}
      />
    </g>
  );
}

const Character = memo(function Character({ c, mood, blink, look, mode, index }) {
  const { lean, fx, fy, px, py } = look;
  const ink = c.id === 'breu' ? '#f5f5f7' : '#16161a';
  const mouthColor = c.id === 'breu' ? '#f5f5f7' : '#16161a';
  return (
    <g className={`pcc-char pcc-${c.id}`} style={{ '--i': index, '--breath': `${c.breath}s` }}>
      <g className="pcc-lean" style={{ transform: `skewX(${lean}deg)` }}>
        <g className="pcc-breathe">
          <path d={c.body} fill={c.fill} />
          {c.outline && <path d={c.body} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="1.5" />}
          <g className="pcc-face" style={{ transform: `translate(${fx}px, ${fy}px)` }}>
            {c.brows && (
              <g className="pcc-brows" data-on={mood.angry || undefined}>
                <path d={`M${c.eyes[0].x - 10} ${c.eyes[0].y - 20} L${c.eyes[0].x + 7} ${c.eyes[0].y - 14}`} stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
                <path d={`M${c.eyes[1].x + 10} ${c.eyes[1].y - 20} L${c.eyes[1].x - 7} ${c.eyes[1].y - 14}`} stroke={ink} strokeWidth="3.4" strokeLinecap="round" />
              </g>
            )}
            {c.eyes.map((e, i) => (
              <Eye key={i} c={c} x={e.x} y={e.y} state={mood.eyes} blink={blink && mode !== 'success'} px={px} py={py} left={i === 0} />
            ))}
            <Mouth kind={mood.mouth} x={c.mouth.x} y={c.mouth.y} color={mouthColor} />
            {mode === 'peek' && c.id === 'breu' && (
              // Mãozinha tampando os olhos.
              <g className="pcc-hands">
                <rect x={c.eyes[0].x - 15} y={c.eyes[0].y - 11} width="30" height="20" rx="10" fill="#3a3a44" />
                <rect x={c.eyes[1].x - 15} y={c.eyes[1].y - 11} width="30" height="20" rx="10" fill="#3a3a44" />
              </g>
            )}
          </g>
        </g>
      </g>
    </g>
  );
});

// reaction: { type: 'error' | 'success', key: number } — muda a `key`
// pra disparar de novo a mesma reação.
export default function AuthCharacters({ reaction = null, scope = '.pc-auth-panel', className = '' }) {
  const svgRef = useRef(null);
  const [calm, setCalm] = useState(prefersCalm);
  const focus = useFormFocus(scope);
  const [pointer, setPointer] = useState(null);
  const [react, setReact] = useState(null);
  const blinking = useBlinks(!calm);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setCalm(prefersCalm());
    mq?.addEventListener?.('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lite'] });
    return () => { mq?.removeEventListener?.('change', update); mo.disconnect(); };
  }, []);

  // Mouse (agrupado por quadro). Desligado no modo calmo.
  useEffect(() => {
    if (calm) { setPointer(null); return undefined; }
    let raf = 0;
    let last = null;
    const onMove = (e) => {
      if (e.pointerType === 'touch') return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setPointer(last); });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, [calm]);

  // Reações temporárias (erro ~1,2s; sucesso fica até a página sair).
  useEffect(() => {
    if (!reaction?.type) return undefined;
    setReact(reaction.type);
    if (reaction.type === 'error') {
      const t = setTimeout(() => setReact(null), 1250);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [reaction?.type, reaction?.key]);

  let mode = 'idle';
  if (react) mode = react;
  else if (focus.peek) mode = 'peek';
  else if (focus.kind === 'password') mode = 'password';
  else if (focus.kind === 'text') mode = 'typing';

  const target = focus.caret || pointer;

  // Converte o alvo (página) pra coordenadas do viewBox e calcula, pra
  // cada um, a inclinação, o deslocamento do rosto e das pupilas.
  const svgRect = svgRef.current?.getBoundingClientRect();
  const looks = useMemo(() => {
    const out = {};
    let tx = null; let ty = null;
    if (target && svgRect && svgRect.width > 0) {
      // preserveAspectRatio = xMidYMax meet
      const scale = Math.min(svgRect.width / VB.w, svgRect.height / VB.h);
      const offX = (svgRect.width - VB.w * scale) / 2;
      const offY = svgRect.height - VB.h * scale;
      tx = VB.x + (target.x - svgRect.left - offX) / scale;
      ty = VB.y + (target.y - svgRect.top - offY) / scale;
    }
    CHARS.forEach((c) => {
      const mood = MOODS[mode][c.id];
      const ex = (c.eyes[0].x + c.eyes[1].x) / 2;
      const ey = c.eyes[0].y;
      let dx = 0; let dy = 0; let lean = 0;
      if (mood.look === 'target' && tx != null) {
        dx = tx - ex; dy = ty - ey;
        lean = calm ? 0 : clamp(dx / 32, -8, 8) * c.lean * (mode === 'typing' || mode === 'peek' ? 1.1 : 0.7);
      } else if (mood.look === 'away') {
        dx = -120; dy = -70;
        lean = calm ? 0 : -5 * c.lean;
      } else if (mood.look === 'roxo') {
        // O amarelo olha desconfiado pro roxo que está espiando.
        dx = 127 - ex; dy = 100 - ey;
        lean = calm ? 0 : -3;
      } else if (mood.look === 'front') {
        dx = 0; dy = 30;
      } else if (tx == null && mode === 'idle') {
        dx = 40; dy = 10; // olhar padrão: um pouquinho pro formulário
      }
      if (mode === 'peek' && c.id === 'roxo') lean = calm ? 0 : clamp(lean + 6, -12, 12);
      if (mode === 'error') lean = 0;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist; const ny = dy / dist;
      const maxP = c.ball ? c.r - c.pr - 1.2 : 4.2;
      const pAmt = Math.min(maxP, dist * 0.06);
      const fAmt = Math.min(c.id === 'laranja' ? 9 : 6, dist * 0.04);
      out[c.id] = {
        lean: -lean, fx: nx * fAmt, fy: ny * fAmt * 0.7,
        px: nx * pAmt, py: ny * pAmt,
      };
    });
    return out;
    // svgRect muda a cada render; os números de entrada é que importam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, target?.x, target?.y, calm, svgRect?.left, svgRect?.top, svgRect?.width, svgRect?.height]);

  const reactKey = react ? `${react}-${reaction?.key ?? 0}` : 'none';

  return (
    <div
      className={`pcc-stage ${className}`}
      data-mode={mode}
      data-calm={calm || undefined}
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        className="pcc-svg"
        viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
        preserveAspectRatio="xMidYMax meet"
        focusable="false"
      >
        <ellipse cx="186" cy="303" rx="176" ry="7" fill="rgba(0,0,0,.45)" />
        <g key={reactKey} className="pcc-group">
          {CHARS.map((c, i) => (
            <Character
              key={c.id} c={c} index={i} mode={mode} mood={MOODS[mode][c.id]}
              blink={!!blinking[c.id]} look={looks[c.id]}
            />
          ))}
        </g>
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
