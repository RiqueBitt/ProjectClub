// Acessórios da turminha do login (AuthCharacters.jsx). Tudo desenhado em
// SVG aqui (nada de imagem gerada), no mesmo traço QUADRADO da turma: só
// retas, retângulos e triângulos, nada de curva.
//
// Cor: sempre o CONTRÁRIO do corpo. Bichinho preto usa acessório branco e
// bichinho branco usa acessório preto (no celular, fundo preto, inverte
// junto). Quem pinta é o CSS (auth-characters.css), por classe:
//   .a  → peça principal: cor do rosto, com bordinha da cor do corpo
//         (assim o acessório aparece tanto em cima do corpo quanto no fundo)
//   .d  → detalhe: cor do corpo (faixa, joia, listra…)
//   .ln → traço (haste, armação): cor do rosto
//   .le → bordinha por baixo do traço: cor do corpo
//
// NADA é sorteado: cada bichinho começa com o seu e a pessoa troca tocando
// nele — a escolha fica salva no navegador.
//
// Cada acessório: { id, label, anchor, sway?, art(c) }.
//   anchor 'head' → em volta do topo da cabeça (0,0 = meio do topo);
//   anchor 'face' → no rosto (acompanha o olhar): óculos, bigode…

export const DEFAULT_ACC = { lila: 'bow', menta: 'headphones', coral: 'cap', mel: 'sprout' };

// Tamanho acompanha o bichinho (o grandão usa acessório maior).
const S = (c) => Math.max(0.85, Math.min(1.5, c.w / 80));
const sc = (c, x = 0, y = 0) => `translate(${x} ${y}) scale(${S(c)})`;

// Traço com bordinha (haste, arco, armação).
const Line = ({ d, w = 3 }) => (
  <>
    <path className="le" d={d} strokeWidth={w + 3} />
    <path className="ln" d={d} strokeWidth={w} />
  </>
);

const ACCS = [
  {
    id: 'bow', label: 'Laço', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, -c.w * 0.2, 1)}>
        <path className="a" d="M-3 -9 L-17 -17 L-17 -1 Z" />
        <path className="a" d="M3 -9 L17 -17 L17 -1 Z" />
        <path className="d" d="M-14 -11 L-10 -9 L-14 -7 Z M14 -11 L10 -9 L14 -7 Z" />
        <rect className="a" x="-4.5" y="-13.5" width="9" height="9" />
      </g>
    ),
  },
  {
    id: 'headphones', label: 'Fone', anchor: 'head',
    art: (c) => {
      const hw = c.w / 2 + 1; const ey = c.eyes[0].y - c.bodyTop + 2;
      return (
        <g>
          <Line d={`M${-hw} ${ey - 10} V-9 H${hw} V${ey - 10}`} w={4} />
          {[-1, 1].map((sd) => (
            <g key={sd} transform={`translate(${sd * hw} ${ey})`}>
              <rect className="a" x="-6" y="-11" width="12" height="22" />
              <rect className="d" x={sd > 0 ? -2 : -4} y="-6" width="6" height="12" />
            </g>
          ))}
        </g>
      );
    },
  },
  {
    id: 'cap', label: 'Boné', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <path className="a" d="M-22 0 V-11 L-15 -17 H15 L22 -11 V0 Z" />
        <rect className="a" x="16" y="-5" width="24" height="5" />
        <rect className="d" x="-3" y="-17" width="6" height="3" />
        <rect className="d" x="-22" y="-4" width="44" height="2" />
      </g>
    ),
  },
  {
    id: 'sprout', label: 'Broto', anchor: 'head', sway: true,
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <Line d="M0 0 V-22" w={2.6} />
        <path className="a" d="M0 -14 L-7 -19 L-13 -14 L-7 -9 Z" />
        <path className="a" d="M0 -22 L5 -30 L12 -25 L7 -17 Z" />
      </g>
    ),
  },
  {
    id: 'partyHat', label: 'Chapéu de festa', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, c.w * 0.1, 1)}>
        <path className="a" d="M-13 0 L0 -32 L13 0 Z" />
        <path className="d" d="M-9.3 -9 H9.3 L8.1 -12 H-8.1 Z M-5.6 -18 H5.6 L4.4 -21 H-4.4 Z" />
        <rect className="a" x="-4.5" y="-38" width="9" height="9" />
      </g>
    ),
  },
  {
    id: 'crown', label: 'Coroa', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <path className="a" d="M-17 0 V-18 L-9 -10 L0 -22 L9 -10 L17 -18 V0 Z" />
        <rect className="d" x="-2.5" y="-9" width="5" height="5" />
        <rect className="d" x="-12" y="-6" width="4" height="4" />
        <rect className="d" x="8" y="-6" width="4" height="4" />
      </g>
    ),
  },
  {
    id: 'glasses', label: 'Óculos', anchor: 'face',
    art: (c) => {
      const [a, b] = c.eyes; const r = c.r + 3;
      return (
        <g>
          <Line d={`M${a.x - r} ${a.y - r} H${a.x + r} V${a.y + r} H${a.x - r} Z`} w={2.4} />
          <Line d={`M${b.x - r} ${b.y - r} H${b.x + r} V${b.y + r} H${b.x - r} Z`} w={2.4} />
          <Line d={`M${a.x + r} ${a.y - 2} H${b.x - r}`} w={2.4} />
        </g>
      );
    },
  },
  {
    id: 'pixelShades', label: 'Óculos escuros', anchor: 'face',
    art: (c) => {
      const [a, b] = c.eyes; const r = c.r + 2.5;
      return (
        <g>
          <rect className="a" x={a.x - r - 3} y={a.y - r * 0.75} width={b.x - a.x + 2 * r + 6} height="3.4" />
          <rect className="a" x={a.x - r} y={a.y - r * 0.75} width={2 * r} height={r * 1.4} />
          <rect className="a" x={b.x - r} y={b.y - r * 0.75} width={2 * r} height={r * 1.4} />
          <rect className="d" x={a.x - r * 0.6} y={a.y - r * 0.4} width="3" height="3" />
          <rect className="d" x={b.x - r * 0.6} y={b.y - r * 0.4} width="3" height="3" />
        </g>
      );
    },
  },
  {
    id: 'antenna', label: 'Antena', anchor: 'head', sway: true,
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <Line d="M0 0 V-12 L8 -20 V-24" w={2.6} />
        <rect className="a" x="3" y="-34" width="10" height="10" />
        <rect className="d" x="6" y="-31" width="4" height="4" />
      </g>
    ),
  },
  {
    id: 'catEars', label: 'Orelhas de gato', anchor: 'head',
    art: (c) => {
      const x = Math.min(c.w * 0.32, 30);
      return (
        <g>
          {[-1, 1].map((sd) => (
            <g key={sd} transform={sc(c, sd * x, 2)}>
              <path className="a" d={`M-9 0 L${sd * 3} -18 L9 0 Z`} />
              <path className="d" d={`M-4 -2 L${sd * 2} -11 L4 -2 Z`} />
            </g>
          ))}
        </g>
      );
    },
  },
  {
    id: 'bunnyEars', label: 'Orelhas de coelho', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 2)}>
        {[-1, 1].map((sd) => (
          <g key={sd} transform={`translate(${sd * 11} 0)`}>
            <rect className="a" x="-5.5" y="-30" width="11" height="30" />
            <rect className="d" x="-2" y="-25" width="4" height="20" />
          </g>
        ))}
      </g>
    ),
  },
  {
    id: 'horn', label: 'Chifre de unicórnio', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <path className="a" d="M-6 0 L0 -28 L6 0 Z" />
        <path className="d" d="M-4.5 -6 L4.5 -9 L4 -11 L-4 -8 Z M-2.8 -15 L2.9 -17.5 L2.4 -19.4 L-2.4 -17 Z" />
      </g>
    ),
  },
  {
    id: 'tophat', label: 'Cartola', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, -c.w * 0.04, 1)}>
        <rect className="a" x="-20" y="-5" width="40" height="5" />
        <rect className="a" x="-12" y="-30" width="24" height="26" />
        <rect className="d" x="-12" y="-11" width="24" height="4" />
      </g>
    ),
  },
  {
    id: 'beanie', label: 'Gorro', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 2)}>
        <path className="a" d="M-20 0 V-14 L-12 -20 H12 L20 -14 V0 Z" />
        <rect className="a" x="-21" y="-6" width="42" height="7" />
        <rect className="d" x="-21" y="-3" width="42" height="2" />
        <rect className="d" x="-6" y="-17" width="3" height="9" />
        <rect className="d" x="3" y="-17" width="3" height="9" />
        <rect className="a" x="-5" y="-29" width="10" height="10" />
      </g>
    ),
  },
  {
    id: 'halo', label: 'Auréola', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, -12)}>
        <rect className="a" x="-17" y="-6" width="34" height="9" />
        <rect className="d" x="-12" y="-3" width="24" height="3" />
      </g>
    ),
  },
  {
    id: 'viking', label: 'Capacete viking', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 2)}>
        <path className="a" d="M-20 -14 L-30 -30 L-28 -12 Z" />
        <path className="a" d="M20 -14 L30 -30 L28 -12 Z" />
        <path className="a" d="M-20 0 V-13 L-11 -20 H11 L20 -13 V0 Z" />
        <rect className="d" x="-20" y="-5" width="40" height="3" />
        <rect className="d" x="-1.5" y="-19" width="3" height="14" />
      </g>
    ),
  },
  {
    id: 'chef', label: 'Chapéu de chef', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, 0, 1)}>
        <rect className="a" x="-13" y="-10" width="26" height="10" />
        <rect className="a" x="-18" y="-24" width="13" height="14" />
        <rect className="a" x="5" y="-24" width="13" height="14" />
        <rect className="a" x="-8" y="-32" width="16" height="20" />
        <rect className="d" x="-13" y="-4" width="26" height="2" />
      </g>
    ),
  },
  {
    id: 'wizard', label: 'Chapéu de mago', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, c.w * 0.04, 1)}>
        <rect className="a" x="-22" y="-5" width="44" height="5" />
        <path className="a" d="M-13 -5 L4 -44 L13 -5 Z" />
        <path className="d" d="M0 -26 L2.5 -21 L0 -16 L-2.5 -21 Z" />
        <rect className="d" x="-11" y="-11" width="23" height="3" />
      </g>
    ),
  },
  {
    id: 'headband', label: 'Faixa ninja', anchor: 'head',
    art: (c) => {
      const hw = c.w / 2 + 1;
      return (
        <g>
          <rect className="a" x={-hw} y="5" width={hw * 2} height="8" />
          <rect className="d" x="-4" y="7" width="8" height="4" />
          {/* Pontas do nó pra fora, do lado esquerdo (não cobre o vizinho). */}
          <path className="a" d={`M${-hw} 6 L${-hw - 14} 2 L${-hw - 12} 9 Z M${-hw} 11 L${-hw - 15} 16 L${-hw - 9} 19 Z`} />
        </g>
      );
    },
  },
  {
    id: 'star', label: 'Presilha de estrela', anchor: 'head',
    art: (c) => (
      <g transform={sc(c, c.w * 0.26, 9)}>
        <path className="a" d="M0 -11 L3 -4 L10 -4 L4.5 1 L7 9 L0 4 L-7 9 L-4.5 1 L-10 -4 L-3 -4 Z" />
        <rect className="d" x="-1.5" y="-2" width="3" height="3" />
      </g>
    ),
  },
  {
    id: 'mustache', label: 'Bigode', anchor: 'face',
    art: (c) => {
      const { x, y } = c.mouth;
      // Metade da largura do bichinho, cobrindo a boca (bigodão de verdade).
      const k = Math.max(0.8, Math.min(1.4, c.w / 72));
      return (
        <g transform={`translate(${x} ${y - 2 * k}) scale(${k})`}>
          {/* Bigodão de pixel: miolo, abas e pontas em degrau. */}
          <path className="a" style={{ strokeWidth: 0 }} d="M-5 -6 H5 V-3 H15 V0 H19 V6 H13 V3 H5 V2 H-5 V3 H-13 V6 H-19 V0 H-15 V-3 H-5 Z" />
        </g>
      );
    },
  },
  {
    id: 'bowTie', label: 'Gravata-borboleta', anchor: 'face',
    art: (c) => {
      const { x, y, s } = c.mouth;
      return (
        <g transform={`translate(${x} ${y + 15 * s}) scale(${s * 1.15})`}>
          <path className="a" d="M-3 0 L-13 -6 V6 Z" />
          <path className="a" d="M3 0 L13 -6 V6 Z" />
          <rect className="a" x="-3.5" y="-3.5" width="7" height="7" />
        </g>
      );
    },
  },
  {
    id: 'monocle', label: 'Monóculo', anchor: 'face',
    art: (c) => {
      const b = c.eyes[1]; const r = c.r + 3;
      return (
        <g>
          <Line d={`M${b.x - r} ${b.y - r} H${b.x + r} V${b.y + r} H${b.x - r} Z`} w={2.4} />
          {/* Corrente de elos quadrados descendo do canto da lente. */}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} className="a" x={b.x + r - 4 - i * 1.5} y={b.y + r + 2 + i * 5.5} width="3.6" height="3.6" />
          ))}
        </g>
      );
    },
  },
  { id: 'none', label: 'Sem acessório', anchor: 'head', art: () => null },
];

export const ACCESSORIES = Object.fromEntries(ACCS.map((a) => [a.id, a]));
export const ACC_ORDER = ACCS.map((a) => a.id);

/** Próximo acessório na ordem fixa (tocar/clicar no bichinho). */
export function nextAccessory(id) {
  const i = ACC_ORDER.indexOf(id);
  return ACC_ORDER[(i + 1) % ACC_ORDER.length];
}

// Escolhas salvas no navegador (sem conta, sem servidor). Acessório que
// não existe mais (versão antiga) volta pro padrão do bichinho.
const KEY = 'pc.turma.acessorios.v1';
export function loadAccessories() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const out = { ...DEFAULT_ACC };
      for (const k of Object.keys(DEFAULT_ACC)) if (ACCESSORIES[saved[k]]) out[k] = saved[k];
      return out;
    }
  } catch { /* sem storage: fica o padrão */ }
  return { ...DEFAULT_ACC };
}
export function saveAccessories(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* sem storage */ }
}

/** Desenha o acessório `id` do bichinho `c`. `reg` liga a ref de animação. */
export function Accessory({ c, id, reg, where }) {
  const a = ACCESSORIES[id];
  if (!a || a.id === 'none') return null;
  if ((where === 'face') !== (a.anchor === 'face')) return null;
  const art = a.art(c);
  if (a.anchor === 'face') {
    return <g className="pcc-acc-face" key={a.id}><g className="pcc-acc-pop">{art}</g></g>;
  }
  return (
    <g transform={`translate(${c.cx} ${c.bodyTop})`} data-acc={a.id}>
      <g className={a.sway ? 'pcc-acc-sway' : undefined}>
        <g className="pcc-acc-hover">
          <g ref={reg(c.id, 'acc')} className="pcc-acc">
            <g className="pcc-acc-pop" key={a.id}>{art}</g>
          </g>
        </g>
      </g>
    </g>
  );
}
