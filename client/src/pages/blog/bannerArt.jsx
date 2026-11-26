import { useId } from 'react';
import { Accessory } from '../../components/auth/authAccessories.jsx';

// Banners do Blog: uma cena desenhada em SVG pra cada artigo, com a turminha
// do login (os mesmos bichinhos quadrados e os mesmos acessórios) fazendo
// alguma coisa do assunto. Tudo em código, preto e branco, de borda reta —
// nada de imagem gerada.
//
// Tela de 640×400 (16:10), chão em y=340. No banner largo (21:9) a cena fica
// no meio e o chão continua pros lados. Quem pinta é o CSS (blog.css), por
// classe, a partir de duas cores do banner (--fg traço, --bg fundo):
//   bb-f  cheio na cor do traço        bb-b  cheio na cor do fundo
//   bb-o  fundo com contorno           bb-fo cheio com contorno
//   bb-s  só traço                     bb-sb traço na cor do fundo
//   bb-dim  cheio bem clarinho (linhas de texto de mentira)
//   bb-tx / bb-txb  letra grande; bb-mono / bb-monob  letra de máquina
// Artigo novo sem cena própria cai na `placa` (a turma segurando o símbolo).

const FLOOR = 340;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const noReg = () => undefined;

// Os quatro, nos tamanhos do login.
const CAST = {
  lila: { w: 82, h: 140 },
  menta: { w: 152, h: 104, solid: true },
  coral: { w: 104, h: 102, solid: true },
  mel: { w: 66, h: 64 },
};

const MOUTHS = {
  smile: 'M-7 -1.5 Q0 6 7 -1.5',
  soft: 'M-4.5 0 Q0 3.5 4.5 0',
  cat: 'M-8 -1 Q-4 4 0 -0.5 Q4 4 8 -1',
  flat: 'M-4.5 0.5 H4.5',
  wavy: 'M-8 0.5 Q-6 -2.5 -2.7 0.5 Q0 3 2.7 0.5 Q6 -2.5 8 0.5',
  smirk: 'M-6 1.5 Q1 4.5 7.5 -2.5',
};
const FILLED = {
  grin: 'M-8 -2.5 Q0 -0.5 8 -2.5 Q7 8 0 8.5 Q-7 8 -8 -2.5 Z',
  big: 'M-10 -3 Q0 -1 10 -3 Q9 11 0 11.5 Q-9 11 -10 -3 Z',
};
const EYE_PATHS = {
  happy: 'M-6.5 2.5 Q0 -5.5 6.5 2.5',
  closed: 'M-6.5 -0.5 Q0 4.5 6.5 -0.5',
};

// Mãozinha quadrada (a turma é de borda reta).
export function Mitt({ x, y, k = 1 }) {
  return <rect className="bb-mitt" x={x - 8 * k} y={y - 7 * k} width={16 * k} height={14 * k} />;
}

// Um bichinho parado. `hands`: [esquerda, direita], cada uma 'rest' (no
// corpo), 'up' (levantada do lado), 'out' (esticada do lado) ou [x, y];
// null = sem mão. `lift` tira do chão (pulando).
function Mini({ who, x, y = FLOOR, k = 1, acc = 'none', eyes = 'open', mouth = 'smile', look = [0, 0], hands = ['rest', 'rest'], lift = 0 }) {
  const base = CAST[who];
  const w = base.w * k; const h = base.h * k;
  const floor = y - lift; const top = floor - h;
  const eyeYf = h > w * 1.3 ? 0.3 : h < w * 0.8 ? 0.42 : 0.38;
  const gapf = h > w * 1.3 ? 0.15 : 0.19;
  const er = Math.max(4.5, w * Math.min(0.12, (h * 0.13) / w));
  const r = er * 1.12; const pr = er * 0.62; const pMax = clamp(er * 0.4, 2, 5.2);
  const eyeY = top + h * eyeYf;
  const eyesAt = [{ x: x - w * gapf, y: eyeY }, { x: x + w * gapf, y: eyeY }];
  const m = { x, y: eyeY + w * 0.21, s: clamp(w / 110, 0.62, 1.12) };
  const c = { id: who, cx: x, bodyTop: top, w, h, eyes: eyesAt, r, pr, mouth: m };
  const hk = clamp(w / 100, 0.8, 1.15);
  const handAt = (spec, side) => {
    if (!spec) return null;
    if (Array.isArray(spec)) return spec;
    if (spec === 'up') return [x + side * (w / 2 + 6 * hk), eyeY - 6];
    if (spec === 'out') return [x + side * (w / 2 + 9 * hk), floor - h * 0.42];
    return [x + side * w * 0.38, floor - 14 * hk];
  };
  const ek = r / 9;
  return (
    <g className="bb-char" data-solid={base.solid || undefined}>
      <rect className="bb-shadow" x={x - w * (lift ? 0.3 : 0.46)} y={y - 3} width={w * (lift ? 0.6 : 0.92)} height={6} />
      <g className="bb-hop" style={{ animationDelay: `${Math.round((x / 640) * 160)}ms` }}>
        <rect className="bb-body" x={x - w / 2} y={top} width={w} height={h} />
        <Accessory c={c} id={acc} reg={noReg} where="head" />
        {eyesAt.map((e, i) => {
          const kind = eyes === 'wink' ? (i ? 'closed' : 'open') : eyes;
          if (kind === 'squeeze') {
            const sd = i === 0 ? 1 : -1;
            return <path key={i} className="bb-line" strokeWidth={2.8} d={`M${e.x - 5 * sd * ek} ${e.y - 5 * ek} L${e.x + 5 * sd * ek} ${e.y} L${e.x - 5 * sd * ek} ${e.y + 5 * ek}`} />;
          }
          if (EYE_PATHS[kind]) {
            return <path key={i} className="bb-line" transform={`translate(${e.x} ${e.y}) scale(${ek})`} strokeWidth={2.8 / ek} d={EYE_PATHS[kind]} />;
          }
          return <ellipse key={i} className="bb-face" cx={e.x + look[0] * pMax} cy={e.y + look[1] * pMax} rx={pr * 0.95} ry={pr * 1.15} />;
        })}
        <g transform={`translate(${m.x + look[0] * pMax * 0.5} ${m.y}) scale(${m.s})`}>
          {mouth === 'o' && <ellipse className="bb-face" cx="0" cy="2" rx="3.6" ry="4.4" />}
          {FILLED[mouth] && <path className="bb-face bb-line" strokeWidth="1.5" d={FILLED[mouth]} />}
          {MOUTHS[mouth] && <path className="bb-line" strokeWidth={2.8 / m.s} d={MOUTHS[mouth]} />}
        </g>
        <Accessory c={c} id={acc} reg={noReg} where="face" />
        {hands && hands.map((spec, i) => {
          const p = handAt(spec, i ? 1 : -1);
          return p ? <Mitt key={i} x={p[0]} y={p[1]} k={hk} /> : null;
        })}
      </g>
    </g>
  );
}

// ---------- peças ----------
// strokeWidth vai no style: no SVG o CSS da classe ganha do atributo.
const sw = (strokeWidth, style) => (strokeWidth ? { ...style, strokeWidth } : style);
const R = ({ x, y, w, h, c = 'o', strokeWidth, style, ...p }) => <rect className={`bb-${c}`} x={x} y={y} width={w} height={h} style={sw(strokeWidth, style)} {...p} />;
const P = ({ d, c = 's', strokeWidth, style, ...p }) => <path className={`bb-${c}`} d={d} style={sw(strokeWidth, style)} {...p} />;
const G = ({ points, c = 'o', strokeWidth, style, ...p }) => <polygon className={`bb-${c}`} points={points} style={sw(strokeWidth, style)} {...p} />;
const T = ({ x, y, s, c = 'tx', a = 'middle', children, ...p }) => <text className={`bb-${c}`} x={x} y={y} fontSize={s} textAnchor={a} {...p}>{children}</text>;
const Spark = ({ x, y, s = 1, c = 'f' }) => <path className={`bb-${c}`} transform={`translate(${x} ${y}) scale(${s})`} d="M0 -14 L4 -4 L14 0 L4 4 L0 14 L-4 4 L-14 0 L-4 -4 Z" />;
const poly = (cx, cy, r, n, rot = 0) => Array.from({ length: n }, (_, i) => {
  const a = ((rot + (i * 360) / n) * Math.PI) / 180;
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');
// Linhas de texto de mentira.
const Lines = ({ x, y, ws, gap = 20, h = 9, first = 'f', rest = 'dim' }) => ws.map((w, i) => <R key={i} x={x} y={y + i * gap} w={w} h={h} c={i ? rest : first} />);

function D20({ x, y, R: r }) {
  const v = (a, b) => `${(x + a * r).toFixed(1)},${(y + b * r).toFixed(1)}`;
  const hex = [[0, -1], [0.866, -0.5], [0.866, 0.5], [0, 1], [-0.866, 0.5], [-0.866, -0.5]];
  const inner = [[0, -0.42], [-0.5, 0.42], [0.5, 0.42]];
  const edges = [[0, 0], [0, 5], [0, 1], [1, 5], [1, 4], [1, 3], [2, 1], [2, 2], [2, 3]];
  return (
    <g>
      <G points={hex.map(([a, b]) => v(a, b)).join(' ')} />
      <P d={edges.map(([i, j]) => `M${v(...inner[i])} L${v(...hex[j])}`).join(' ')} />
      <G c="fo" points={inner.map(([a, b]) => v(a, b)).join(' ')} />
      <T x={x} y={y + r * 0.27} s={r * 0.4} c="txb">20</T>
    </g>
  );
}

function Gear({ x, y, r, teeth = 8, c = 'fo', hole = 'b' }) {
  const t = r * 0.42;
  return (
    <g>
      {Array.from({ length: teeth }, (_, i) => (
        <rect key={i} className={`bb-${c}`} x={-t / 2} y={-r - t * 0.62} width={t} height={t} transform={`translate(${x} ${y}) rotate(${(i * 360) / teeth})`} />
      ))}
      <G c={c} points={poly(x, y, r, teeth, 180 / teeth)} />
      <G c={hole} points={poly(x, y, r * 0.34, teeth, 180 / teeth)} />
    </g>
  );
}

// Tecla com lado de baixo (3D de borda reta).
function Key({ x, y, w, h, children, s = 30, mono = true }) {
  return (
    <g>
      <R x={x} y={y + 10} w={w} h={h - 10} c="fo" />
      <R x={x} y={y} w={w} h={h - 13} />
      <T x={x + w / 2} y={y + (h - 13) / 2 + s * 0.36} s={s} c={mono ? 'mono' : 'tx'}>{children}</T>
    </g>
  );
}

// Rostinho dentro de um quadrado (bloco da call, foto do perfil).
function TileFace({ x, y, size, solid, mouth = 'smile' }) {
  const c = solid ? 'b' : 'f';
  const e = size * 0.17; const ey = y + size * 0.42;
  return (
    <g>
      <ellipse className={`bb-${c}`} cx={x + size / 2 - e} cy={ey} rx={size * 0.05} ry={size * 0.064} />
      <ellipse className={`bb-${c}`} cx={x + size / 2 + e} cy={ey} rx={size * 0.05} ry={size * 0.064} />
      <path className={solid ? 'bb-sb bb-round' : 'bb-s bb-round'} transform={`translate(${x + size / 2} ${ey + size * 0.2}) scale(${size / 90})`} d={MOUTHS[mouth] || MOUTHS.smile} />
    </g>
  );
}

// ---------- cenas ----------
const SCENES = {
  // Destaque: “Aa” com brilho passando, coroa e estrelinhas.
  'efeitos-de-texto-na-loja': (u) => (
    <>
      <defs>
        <clipPath id={`${u}t`}><text x="262" y="292" fontSize="226" textAnchor="middle" className="bb-tx">Aa</text></clipPath>
      </defs>
      <T x={274} y={304} s={226}>Aa</T>
      <T x={262} y={292} s={226} c="txo">Aa</T>
      <g clipPath={`url(#${u}t)`}>
        {[0, 1, 2, 3, 4].map((i) => <R key={i} x={120} y={206 + i * 18} w={300} h={3 + i * 2.4} c="f" />)}
      </g>
      <Spark x={440} y={92} s={1.5} />
      <Spark x={110} y={84} s={0.9} />
      <Spark x={420} y={214} s={0.7} />
      <Spark x={160} y={46} s={0.55} />
      <Mini who="mel" x={78} lift={34} acc="star" eyes="happy" mouth="big" hands={['up', 'up']} />
      <Mini who="menta" x={530} acc="crown" eyes="happy" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
    </>
  ),

  // Mesa de RPG: dado de 20 na mesa, mestre de chapéu de mago atrás.
  'mesa-de-rpg-na-call': () => (
    <>
      <Mini who="coral" x={474} k={1.1} acc="wizard" mouth="smirk" look={[-1, 0.2]} hands={null} />
      <R x={126} y={304} w={400} h={16} />
      <R x={146} y={320} w={14} h={20} c="f" />
      <R x={492} y={320} w={14} h={20} c="f" />
      <D20 x={340} y={250} R={54} />
      <P d="M262 214 h-26 M268 232 h-40 M262 250 h-20" />
      <Mini who="mel" x={196} y={304} acc="viking" eyes="happy" mouth="big" look={[1, 0]} hands={['rest', 'up']} />
      <Mini who="lila" x={70} acc="bow" look={[1, 0.3]} hands={['rest', null]} />
      <R x={112} y={236} w={52} h={66} />
      <Lines x={122} y={250} ws={[32, 26, 30, 20]} gap={12} h={6} />
      <Mitt x={114} y={280} />
    </>
  ),

  // Molduras: moldura de 8 lados com a coral de monóculo dentro, marcas de corte.
  'molduras-em-hd': (u) => {
    const cx = 300; const cy = 180;
    return (
      <>
        <defs><clipPath id={`${u}m`}><polygon points={poly(cx, cy, 100, 8, 22.5)} /></clipPath></defs>
        <G c="fo" points={poly(cx, cy, 126, 8, 22.5)} />
        <G c="b" points={poly(cx, cy, 100, 8, 22.5)} />
        <g clipPath={`url(#${u}m)`}>
          <Mini who="coral" x={cx} y={292} k={1.15} acc="monocle" mouth="smile" look={[0.4, 0]} hands={null} />
        </g>
        {[[cx, cy - 104.5], [cx + 104.5, cy], [cx, cy + 104.5], [cx - 104.5, cy]].map(([gx, gy], i) => (
          <G key={i} c="o" points={`${gx},${gy - 11} ${gx + 11},${gy} ${gx},${gy + 11} ${gx - 11},${gy}`} />
        ))}
        <P d="M150 58 V36 H172 M428 36 H450 V58 M450 302 V324 H428 M172 324 H150 V302" />
        <T x={450} y={24} s={17} c="mono" a="end">768 PX</T>
        <Spark x={500} y={86} s={0.8} />
        <Mini who="lila" x={540} acc="bow" eyes="happy" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
      </>
    );
  },

  // Atualização: celular com o ↻ quadrado e a barra enchendo, a mel em cima.
  'atualizacao-automatica': () => (
    <>
      <R x={240} y={110} w={140} h={230} />
      <R x={290} y={119} w={40} h={6} c="f" />
      <R x={252} y={134} w={116} h={190} c="f" />
      <P c="sb" strokeWidth="9" d="M288 178 H332 V190 M332 222 H288 V210" />
      <G c="b" points="321,188 343,188 332,204" />
      <G c="b" points="277,212 299,212 288,196" />
      <R x={268} y={252} w={84} h={12} c="sbo" />
      <R x={268} y={252} w={60} h={12} c="b" />
      <T x={310} y={296} s={14} c="monob">v1.44.40</T>
      <Mini who="mel" x={310} y={110} acc="sprout" eyes="happy" mouth="big" hands={['up', 'up']} />
      <Mini who="coral" x={128} acc="cap" look={[1, -0.7]} hands={['rest', 'up']} />
      <R x={446} y={170} w={60} h={60} c="fo" />
      <P c="sb" strokeWidth="8" d="M460 200 L472 212 L492 186" />
      <Spark x={520} y={140} s={0.7} />
      <Spark x={470} y={120} s={0.45} />
    </>
  ),

  // Calls: tela compartilhada parada em cima, os quatro em blocos embaixo;
  // o anel de quem fala tem tamanho fixo.
  'calls-mais-limpas': () => (
    <>
      <R x={100} y={36} w={440} h={200} />
      <R x={100} y={36} w={440} h={26} c="fo" />
      {[114, 130, 146].map((x) => <R key={x} x={x} y={45} w={9} h={9} c="b" />)}
      <R x={436} y={88} w={38} h={38} c="f" />
      <G c="f" points="132,234 246,112 318,186 382,134 508,234" />
      {[['lila', 112, false, 'smile'], ['coral', 218, true, 'grin'], ['menta', 324, true, 'smile'], ['mel', 430, false, 'cat']].map(([n, x, solid, mouth]) => (
        <g key={n}>
          <R x={x} y={256} w={96} h={74} c={solid ? 'fo' : 'o'} />
          <TileFace x={x + 10} y={258} size={76} solid={solid} mouth={mouth} />
        </g>
      ))}
      <R x={210} y={248} w={112} h={90} c="s" />
      <R x={296} y={262} w={4} h={10} c="b" />
      <R x={302} y={258} w={4} h={14} c="b" />
      <R x={308} y={264} w={4} h={8} c="b" />
    </>
  ),

  // O que é: a turma toda junta, do jeitinho do login, e a mel dando oi.
  'o-que-e-o-project-club': () => (
    <>
      <Mini who="lila" x={275} acc="bow" look={[0.3, -0.3]} hands={['rest', 'rest']} />
      <Mini who="coral" x={190} acc="cap" eyes="happy" hands={['up', 'rest']} />
      <Mini who="menta" x={383} acc="headphones" look={[0.6, 0]} mouth="grin" />
      <Mini who="mel" x={468} acc="sprout" eyes="happy" mouth="big" hands={['up', 'up']} />
      <R x={486} y={150} w={98} h={56} c="fo" />
      <G c="fo" points="498,204 520,204 494,232" />
      <T x={535} y={190} s={34} c="txb">oi!</T>
      <Spark x={112} y={118} s={0.9} />
      <Spark x={150} y={82} s={0.5} />
    </>
  ),

  // Conta: crachá com @, foto e selo; a mel segurando a chave.
  'conta-e-inscricao': () => (
    <>
      <R x={110} y={50} w={300} h={210} />
      <R x={110} y={50} w={300} h={50} c="fo" />
      <T x={132} y={90} s={40} c="txb" a="start">@</T>
      <T x={390} y={81} s={14} c="monob" a="end">CONTA</T>
      <R x={134} y={120} w={90} h={110} />
      <TileFace x={134} y={128} size={90} solid={false} />
      <Lines x={246} y={130} ws={[132, 100, 120, 80]} gap={22} h={10} />
      <R x={350} y={208} w={40} h={40} c="fo" />
      <P c="sb" strokeWidth="6" d="M360 228 L368 236 L381 220" />
      <Mini who="mel" x={170} acc="sprout" eyes="happy" mouth="smile" look={[1, 0]} hands={['rest', null]} />
      <R x={210} y={300} w={24} h={24} />
      <R x={234} y={308} w={60} h={8} c="f" />
      <R x={272} y={316} w={7} h={11} c="f" />
      <R x={284} y={316} w={7} h={8} c="f" />
      <Mitt x={212} y={312} />
      <Mini who="lila" x={505} acc="bow" eyes="happy" mouth="big" look={[-1, -0.3]} hands={['up', 'rest']} />
    </>
  ),

  // Comunidade: um # gigante; a lila espiando pelo buraco do meio.
  comunidade: () => (
    <>
      <Mini who="lila" x={320} k={1.2} acc="bow" look={[0.4, -0.4]} hands={null} />
      <R x={232} y={60} w={34} h={280} c="fo" />
      <R x={372} y={60} w={34} h={280} c="fo" />
      <R x={170} y={128} w={300} h={34} c="fo" />
      <R x={170} y={232} w={300} h={34} c="fo" />
      <Mini who="coral" x={104} acc="cap" look={[1, -0.2]} hands={['rest', 'up']} />
      <Mini who="mel" x={436} y={128} acc="sprout" eyes="happy" mouth="big" hands={['up', 'rest']} />
      <Mini who="menta" x={548} acc="headphones" look={[-1, -0.3]} />
    </>
  ),

  // Chat: dois balões e um "digitando".
  chat: () => (
    <>
      <R x={150} y={52} w={196} h={92} />
      <G points="172,144 198,144 162,176" />
      <R x={174} y={140} w={22} h={7} c="b" />
      <Lines x={172} y={74} ws={[146, 116, 76]} gap={20} h={10} rest="f" />
      <R x={330} y={150} w={150} h={74} c="fo" />
      <G c="fo" points="430,222 456,222 470,250" />
      <R x={350} y={170} w={36} h={36} c="b" />
      <TileFace x={350} y={168} size={36} solid={false} />
      <R x={398} y={176} w={64} h={9} c="b" />
      <R x={398} y={192} w={44} h={9} c="b" />
      <R x={200} y={192} w={80} h={40} />
      {[214, 234, 254].map((x) => <R key={x} x={x} y={206} w={12} h={12} c="f" />)}
      <Mini who="coral" x={124} acc="cap" look={[1, -0.6]} />
      <Mini who="menta" x={528} acc="headphones" eyes="happy" mouth="grin" look={[-1, -0.5]} />
    </>
  ),

  // DMs: envelope grande, a mel sentada em cima, a lila acenando.
  'dms-e-grupos': () => (
    <>
      <R x={120} y={56} w={56} h={38} />
      <P d="M120 56 L148 78 L176 56" />
      <P d="M190 72 h22 M186 86 h30" />
      <R x={200} y={180} w={240} h={160} />
      <P d="M200 180 L320 268 L440 180 M200 340 L292 256 M440 340 L348 256" />
      <G c="fo" points="320,246 342,268 320,290 298,268" />
      <G c="b" points="320,260 328,268 320,276 312,268" />
      <Mini who="mel" x={320} y={180} acc="sprout" eyes="happy" mouth="big" hands={['up', 'up']} />
      <Mini who="coral" x={110} acc="cap" look={[1, -0.4]} />
      <Mini who="lila" x={532} acc="bow" eyes="happy" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
    </>
  ),

  // Voz: microfone no meio, barras de som dos dois lados.
  'voz-e-chamadas': () => (
    <>
      <R x={286} y={66} w={68} h={112} c="fo" />
      {[84, 100, 116, 132, 148].map((y) => <R key={y} x={296} y={y} w={48} h={5} c="b" />)}
      <P d="M268 136 V196 H372 V136" />
      <R x={315} y={196} w={10} h={120} c="f" />
      <R x={270} y={316} w={100} h={24} c="fo" />
      {[[198, 40], [220, 84], [242, 56], [384, 56], [406, 84], [428, 40]].map(([x, h]) => <R key={x} x={x} y={150 - h / 2} w={12} h={h} c="f" />)}
      <Mini who="coral" x={110} acc="pixelShades" mouth="o" look={[1, -0.3]} hands={['rest', 'up']} />
      <Mini who="menta" x={532} acc="headphones" eyes="happy" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
    </>
  ),

  // Perfil: cartão com capa listrada, foto, nome e o botão de amigo.
  'amigos-e-perfil': () => (
    <>
      <R x={150} y={40} w={270} h={290} />
      <R x={150} y={40} w={270} h={86} c="fo" />
      <P c="sb" d="M200 124 L256 42 M252 124 L308 42 M304 124 L360 42 M356 124 L412 42" />
      <R x={169} y={81} w={100} h={100} c="b" />
      <R x={176} y={88} w={86} h={86} c="fo" />
      <TileFace x={176} y={92} size={86} solid />
      <R x={246} y={158} w={24} h={24} c="b" />
      <R x={251} y={163} w={14} h={14} c="f" />
      <R x={176} y={194} w={150} h={18} c="f" />
      <T x={176} y={238} s={16} c="mono" a="start">@coral</T>
      <Lines x={176} y={250} ws={[200, 160]} gap={14} h={7} first="dim" />
      <R x={176} y={286} w={126} h={30} c="fo" />
      <T x={239} y={306} s={14} c="monob">+ AMIGO</T>
      <Mini who="mel" x={88} acc="partyHat" look={[1, -0.2]} />
      <Mini who="lila" x={508} acc="bow" eyes="happy" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
    </>
  ),

  // Economia: barra de XP, pilhas de moedas, a mel de coroa lá em cima.
  'economia-e-progresso': () => (
    <>
      <T x={110} y={30} s={15} c="mono" a="start">NÍVEL 7</T>
      <R x={110} y={40} w={420} h={28} />
      {Array.from({ length: 6 }, (_, i) => <R key={i} x={117 + i * 41.4} y={46} w={36} h={16} c="f" />)}
      {Array.from({ length: 8 }, (_, j) => <R key={`a${j}`} x={152} y={FLOOR - 16 * (j + 1)} w={96} h={16} c={j % 2 ? 'o' : 'fo'} />)}
      {Array.from({ length: 5 }, (_, j) => <R key={`b${j}`} x={264} y={FLOOR - 16 * (j + 1)} w={96} h={16} c={j % 2 ? 'o' : 'fo'} />)}
      <Mini who="mel" x={200} y={212} acc="crown" eyes="happy" mouth="big" hands={['up', 'up']} />
      <G c="fo" points={poly(432, 280, 60, 8, 22.5)} />
      <G c="sb" points={poly(432, 280, 46, 8, 22.5)} />
      <T x={432} y={302} s={62} c="txb">¢</T>
      <Spark x={492} y={208} s={0.6} />
      <Mini who="coral" x={556} acc="tophat" eyes="happy" look={[-1, 0]} hands={['out', 'rest']} />
    </>
  ),

  // Casas: casinha com a mel na janela e fumacinha quadrada.
  casas: () => (
    <>
      <R x={380} y={92} w={26} h={64} c="fo" />
      <G c="fo" points="186,174 315,70 444,174" />
      <R x={200} y={172} w={230} h={168} />
      <R x={290} y={254} w={50} h={86} c="fo" />
      <R x={327} y={294} w={6} h={6} c="b" />
      <R x={222} y={198} w={50} h={50} />
      <TileFace x={222} y={198} size={50} solid={false} mouth="cat" />
      <R x={358} y={198} w={50} h={50} />
      <P d="M383 198 V248 M358 223 H408" />
      <R x={392} y={70} w={10} h={10} c="o" />
      <R x={404} y={50} w={12} h={12} c="o" />
      <R x={420} y={28} w={14} h={14} c="o" />
      <Mini who="coral" x={110} acc="chef" eyes="happy" look={[1, 0]} />
      <Mini who="menta" x={536} acc="beanie" look={[-1, -0.3]} mouth="smile" />
    </>
  ),

  // Clãs: bandeira com emblema e a turma de faixa ninja igual.
  clas: () => (
    <>
      <R x={302} y={32} w={18} h={10} c="f" />
      <R x={306} y={40} w={10} h={300} c="f" />
      <P c="fo" d="M316 48 H470 L440 96 L470 144 H316 Z" />
      <G c="b" points="376,70 402,96 376,122 350,96" />
      <G c="f" points="376,86 386,96 376,106 366,96" />
      <Mini who="coral" x={168} acc="headband" mouth="flat" hands={['up', 'rest']} />
      <Mini who="lila" x={414} acc="headband" mouth="smile" look={[0, -0.2]} />
      <Mini who="mel" x={526} acc="headband" eyes="happy" mouth="big" hands={['up', 'rest']} />
    </>
  ),

  // Cinema: telão com o play, a turma olhando pra cima, pipoca com a mel.
  'cinema-e-youtube-juntos': () => (
    <>
      <R x={110} y={36} w={420} h={190} c="fo" />
      <G c="b" points="298,94 298,168 358,131" />
      <R x={130} y={204} w={380} h={6} c="b" />
      <R x={286} y={199} w={14} h={16} c="b" />
      <Mini who="coral" x={196} k={0.92} acc="cap" mouth="o" look={[0.2, -1]} />
      <Mini who="menta" x={354} k={0.9} acc="headphones" look={[0, -1]} />
      <Mini who="mel" x={476} acc="sprout" mouth="cat" look={[-0.2, -1]} hands={['rest', null]} />
      <R x={502} y={268} w={11} h={11} c="f" />
      <R x={515} y={262} w={11} h={11} c="f" />
      <R x={527} y={270} w={11} h={11} c="f" />
      <G points="500,280 542,280 535,330 507,330" />
      <P d="M514 282 L516 328 M528 282 L526 328" />
      <Mitt x={506} y={306} />
    </>
  ),

  // Biblioteca: prateleira de jogos e a coral de óculos com o controle.
  'biblioteca-de-jogos': () => {
    let x = 96;
    const cases = [[30, 110, 'fo'], [26, 96, 'o'], [34, 120, 'fo'], [28, 90, 'o'], [30, 104, 'o'], [26, 112, 'fo'], [32, 98, 'o']].map(([w, h, c]) => {
      const el = (
        <g key={x}>
          <R x={x} y={210 - h} w={w} h={h} c={c} />
          <R x={x + 5} y={210 - h + 14} w={w - 10} h={8} c={c === 'fo' ? 'b' : 'f'} />
        </g>
      );
      x += w + 4;
      return el;
    });
    return (
      <>
        <R x={86} y={210} w={290} h={14} c="fo" />
        <R x={106} y={224} w={10} h={28} c="f" />
        <R x={346} y={224} w={10} h={28} c="f" />
        {cases}
        <Mini who="mel" x={348} y={210} acc="sprout" eyes="happy" mouth="smile" look={[-1, 0]} />
        <Mini who="coral" x={500} k={1.14} acc="pixelShades" mouth="grin" hands={null} />
        <R x={440} y={298} w={120} h={40} />
        <R x={454} y={313} w={26} h={9} c="f" />
        <R x={462} y={305} w={9} h={26} c="f" />
        <R x={520} y={307} w={11} h={11} c="f" />
        <R x={536} y={318} w={11} h={11} c="f" />
        <Mitt x={442} y={324} />
        <Mitt x={558} y={324} />
      </>
    );
  },

  // Mods: engrenagens e a coral com a chave inglesa.
  'mods-e-modpacks': () => (
    <>
      <Gear x={306} y={190} r={72} />
      <Gear x={438} y={96} r={40} teeth={6} c="o" hole="f" />
      <Mini who="menta" x={534} acc="antenna" eyes="happy" mouth="grin" look={[-1, -0.6]} />
      <Mini who="coral" x={112} acc="cap" look={[1, -0.4]} hands={['rest', null]} />
      <g transform="translate(170 276) rotate(24)">
        <R x={-8} y={-112} w={16} h={112} c="fo" />
        <G c="fo" points="-24,-150 -24,-104 24,-104 24,-150 10,-150 10,-126 -10,-126 -10,-150" />
      </g>
      <Mitt x={170} y={274} />
      <Spark x={214} y={92} s={0.6} />
    </>
  ),

  // Aba Apps: grade de apps com um buraco, a lila encaixando o que falta.
  'aba-apps': () => {
    const tiles = [
      ['fo', <G key="i" c="b" points="209,108 223,80 237,108" />],
      ['o', <R key="i" x={264} y={74} w={30} h={30} c="f" />],
      ['fo', <g key="i"><R x={334} y={78} w={30} h={6} c="b" /><R x={334} y={90} w={30} h={6} c="b" /><R x={334} y={102} w={20} h={6} c="b" /></g>],
      ['o', <P key="i" strokeWidth="8" d="M209 159 H237 M223 145 V173" />],
      ['fo', <G key="i" c="b" points={poly(279, 159, 15, 8, 22.5)} />],
      ['o', <g key="i"><R x={334} y={148} w={30} h={8} c="f" /><R x={334} y={162} w={30} h={8} c="f" /></g>],
      ['fo', <G key="i" c="b" points="209,229 223,215 237,229 223,243" />],
      ['o', <G key="i" c="f" points="264,243 279,215 294,243" />],
    ];
    return (
      <>
        {tiles.map(([c, icon], i) => (
          <g key={i}>
            <R x={180 + (i % 3) * 70} y={60 + Math.floor(i / 3) * 70} w={58} h={58} c={c} />
            {icon}
          </g>
        ))}
        <R x={320} y={200} w={58} h={58} c="s" strokeDasharray="8 7" />
        <Mini who="mel" x={104} acc="partyHat" eyes="happy" look={[1, -0.5]} />
        <Mini who="lila" x={508} acc="bow" mouth="big" look={[-1, -0.4]} hands={[null, 'rest']} />
        <g transform="rotate(-8 440 198)">
          <R x={411} y={169} w={58} h={58} c="fo" />
          <Spark x={440} y={198} s={1} c="b" />
        </g>
        <Mitt x={466} y={230} />
      </>
    );
  },

  // Computador: mesa, monitor com janelas, teclado; a coral de óculos digitando.
  'app-para-computador': () => (
    <>
      <Mini who="coral" x={524} k={1.1} acc="glasses" look={[-1, -0.3]} hands={null} />
      <R x={80} y={304} w={480} h={14} c="fo" />
      <R x={100} y={318} w={12} h={22} c="f" />
      <R x={528} y={318} w={12} h={22} c="f" />
      <R x={130} y={64} w={290} h={186} c="fo" />
      <R x={142} y={76} w={266} h={162} c="b" />
      <R x={162} y={96} w={150} h={104} />
      <R x={162} y={96} w={150} h={18} c="fo" />
      <Lines x={176} y={128} ws={[100, 70, 110]} gap={18} h={8} rest="f" />
      <R x={296} y={150} w={92} h={70} c="fo" />
      <R x={308} y={166} w={50} h={8} c="b" />
      <R x={308} y={180} w={66} h={8} c="b" />
      <R x={258} y={250} w={34} h={40} c="f" />
      <R x={218} y={290} w={114} h={14} c="fo" />
      <R x={356} y={288} w={150} h={16} />
      <P d={Array.from({ length: 7 }, (_, i) => `M${368 + i * 19} 296 h9`).join(' ')} />
      <Mitt x={470} y={290} k={1.1} />
      <Mitt x={498} y={293} k={1.1} />
      <Mini who="mel" x={96} y={304} acc="antenna" eyes="happy" mouth="smile" look={[1, 0]} />
    </>
  ),

  // Android: celular com apps e um aviso saindo pela borda.
  'app-de-android': () => (
    <>
      <R x={250} y={40} w={150} h={300} />
      <R x={262} y={70} w={126} h={242} c="fo" />
      <R x={305} y={52} w={40} h={8} c="f" />
      <R x={300} y={322} w={50} h={6} c="f" />
      {Array.from({ length: 9 }, (_, i) => (
        <R key={i} x={280 + (i % 3) * 32} y={92 + Math.floor(i / 3) * 34} w={24} h={24} c={i === 4 ? 'sbo' : 'b'} />
      ))}
      <R x={280} y={208} w={88} h={64} c="b" />
      <T x={324} y={252} s={34}>PC</T>
      <R x={372} y={118} w={138} h={48} c="fo" />
      <R x={384} y={130} w={24} h={24} c="b" />
      <T x={462} y={147} s={13} c="monob">1.44.40</T>
      <Mini who="mel" x={168} acc="sprout" eyes="happy" mouth="big" hands={['up', 'up']} />
      <Mini who="lila" x={542} acc="antenna" look={[-1, -0.4]} />
    </>
  ),

  // Segurança: escudo com o certinho e a coral de capacete de guarda.
  'seguranca-e-moderacao': () => (
    <>
      <G c="fo" points="320,50 430,90 430,200 320,300 210,200 210,90" />
      <G c="sb" points="320,68 414,102 414,192 320,280 226,192 226,102" />
      <P c="sb" strokeWidth="16" d="M272 176 L308 212 L372 140" />
      <Mini who="coral" x={120} acc="viking" mouth="flat" hands={['rest', 'up']} />
      <Mini who="mel" x={512} k={1.1} acc="antenna" eyes="happy" mouth="smile" look={[-1, -0.3]} />
    </>
  ),

  // Atalhos: teclas grandes; a mel apertando a barra.
  atalhos: () => (
    <>
      <Key x={110} y={232} w={160} h={108}>Ctrl</Key>
      <T x={300} y={304} s={56}>+</T>
      <Key x={330} y={242} w={110} h={98} s={64} mono={false}>/</Key>
      <P d="M322 248 l-16 -12 M448 248 l16 -12 M385 210 v-14" />
      <Mini who="mel" x={385} y={242} acc="star" eyes="squeeze" mouth="big" hands={['up', 'up']} />
      <Mini who="lila" x={540} acc="glasses" mouth="big" look={[-1, 0]} hands={['up', 'rest']} />
    </>
  ),

  // Dúvidas: um ? de pixel e a lila pensando.
  'duvidas-comuns': () => {
    const rows = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'];
    return (
      <>
        {rows.flatMap((row, j) => [...row].map((ch, i) => (ch === '#' ? <R key={`${i}-${j}`} x={236 + i * 24} y={52 + j * 24} w={24} h={24} c="fo" /> : null)))}
        <g transform="translate(452 64) scale(0.42)">
          {rows.flatMap((row, j) => [...row].map((ch, i) => (ch === '#' ? <R key={`${i}-${j}`} x={i * 24} y={j * 24} w={24} h={24} c="o" /> : null)))}
        </g>
        <Mini who="mel" x={146} acc="sprout" mouth="o" look={[1, -1]} />
        <Mini who="lila" x={480} acc="monocle" mouth="wavy" look={[-1, -1]} hands={['up', 'rest']} />
      </>
    );
  },

  // Privacidade: cadeado LGPD na frente de um documento.
  'politica-de-privacidade': () => (
    <>
      <R x={120} y={100} w={150} h={200} />
      <Lines x={140} y={124} ws={[100, 80, 110, 60]} gap={20} h={8} />
      <P strokeWidth="26" d="M266 210 V142 H374 V210" />
      <R x={230} y={200} w={180} h={140} c="fo" />
      <R x={310} y={226} w={20} h={20} c="b" />
      <R x={316} y={242} w={8} h={30} c="b" />
      <T x={320} y={316} s={18} c="monob">LGPD</T>
      <Mini who="lila" x={510} acc="glasses" look={[-1, 0]} hands={['up', 'rest']} />
      <Spark x={450} y={120} s={0.6} />
    </>
  ),

  // Termos: folha com § e assinatura, caneta em cima.
  'termos-de-uso': () => (
    <>
      <R x={170} y={36} w={230} h={304} />
      <G c="b" points="358,32 404,32 404,78" />
      <P d="M360 36 L400 76" />
      <G c="fo" points="360,36 360,76 400,76" />
      <T x={198} y={122} s={80} a="start">§</T>
      <Lines x={200} y={150} ws={[170, 150, 165, 120, 160]} gap={22} h={10} />
      <P d="M200 300 H370" />
      <P d="M210 290 L226 268 L238 290 L252 264 L266 290 L282 276" />
      <g transform="translate(292 272) rotate(-38)">
        <G c="fo" points="-14,0 0,-6 0,6" />
        <R x={0} y={-6} w={118} h={12} c="fo" />
        <R x={88} y={-6} w={8} h={12} c="b" />
      </g>
      <Mini who="mel" x={100} acc="bowTie" eyes="happy" look={[1, -0.3]} />
      <Mini who="menta" x={526} acc="tophat" look={[-1, 0]} mouth="smile" />
    </>
  ),
};

// Artigo sem cena: a coral e a lila segurando uma placa com o símbolo.
const placa = (_u, post) => (
  <>
    <R x={314} y={226} w={12} h={114} c="f" />
    <R x={196} y={70} w={248} h={160} c="fo" />
    <T x={320} y={186} s={post.mark && post.mark.length > 2 ? 60 : 96} c="txb">{post.mark || '?'}</T>
    <Mini who="coral" x={130} acc="cap" eyes="happy" hands={['rest', 'up']} />
    <Mini who="lila" x={514} acc="bow" look={[-1, -0.3]} hands={['up', 'rest']} />
  </>
);

export const hasScene = (slug) => Boolean(SCENES[slug]);

export function BannerArt({ post }) {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '');
  const scene = SCENES[post.slug] || placa;
  return (
    <svg className="bl-art" viewBox="0 0 640 400" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <line className="bb-floor" x1="-640" y1={FLOOR} x2="1280" y2={FLOOR} />
      {scene(u, post)}
    </svg>
  );
}
