// Acessórios da turminha do login (AuthCharacters.jsx). Tudo desenhado em
// SVG aqui (nada de imagem gerada), no mesmo traço liso e simples da turma
// (sem brilhos nem risquinhos de enfeite). NADA é sorteado: cada bichinho começa
// com o seu e a pessoa troca tocando/clicando nele — a escolha fica salva
// no navegador.
//
// Cada acessório: { id, label, anchor, sway?, art(c, uid) }.
//   anchor 'head' → desenhado em volta do topo da cabeça (0,0 = topo);
//   anchor 'face' → desenhado no rosto (acompanha o olhar), ex.: óculos;
//   anchor 'sides'→ em volta da cabeça toda (fone), 0,0 = topo.
// sway = balança sozinho num ritmo fixo (antena, broto, flor).

export const DEFAULT_ACC = { lila: 'bow', menta: 'headphones', coral: 'cap', mel: 'sprout' };

const S = (c) => Math.max(0.72, Math.min(1.15, c.w / 100));

const ACCS = [
  {
    id: 'bow', label: 'Laço', anchor: 'head',
    art: (c) => (
      <g transform={`translate(${-c.w * 0.18} 4) rotate(-14) scale(${S(c)})`}>
        <path d="M-2 -10 L-16 -18 Q-19 -10 -16 -2 Z" fill={c.cheek} stroke={c.deep} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M2 -10 L16 -18 Q19 -10 16 -2 Z" fill={c.cheek} stroke={c.deep} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="0" cy="-10" r="4.6" fill={c.deep} />
      </g>
    ),
  },
  {
    id: 'headphones', label: 'Fone', anchor: 'sides',
    art: (c) => {
      const hw = c.w / 2 - 1; const ey = c.eyes[0].y - c.bodyTop + 2;
      return (
        <g>
          <path d={`M${-hw} ${ey} C${-hw} ${-12} ${hw} ${-12} ${hw} ${ey}`} fill="none" stroke="#2a2440" strokeWidth="5" strokeLinecap="round" />
          {[-1, 1].map((sd) => (
            <g key={sd} transform={`translate(${sd * hw} ${ey})`}>
              <rect x={-7} y={-11} width="14" height="22" rx="7" fill="#2a2440" />
              <rect x={sd > 0 ? -7 : -1} y={-8} width="8" height="16" rx="4" fill={c.cheek} />
            </g>
          ))}
        </g>
      );
    },
  },
  {
    id: 'cap', label: 'Boné', anchor: 'head',
    art: (c) => {
      const s = S(c);
      return (
        <g transform={`translate(0 5) scale(${s})`}>
          <path d="M-24 -2 C-24 -20 24 -20 24 -2 Z" fill={c.deep} />
          <path d="M18 -3 C30 -4 40 -1 42 3 C32 4 22 2 14 1 Z" fill={c.deep} stroke="#1d1631" strokeWidth="1" strokeOpacity=".3" />
        </g>
      );
    },
  },
  {
    id: 'sprout', label: 'Broto', anchor: 'head', sway: true,
    art: (c) => (
      <g transform={`translate(0 3) scale(${S(c)})`}>
        <path d="M0 2 C0 -6 2 -12 1 -20" fill="none" stroke={c.deep} strokeWidth="2.8" strokeLinecap="round" />
        <path d="M1 -14 C-6 -17 -11 -12 -12 -7 C-5 -7 0 -10 1 -14 Z" fill="#8fd16a" stroke="#3d7a2a" strokeWidth="1.4" />
        <path d="M1 -20 C-2 -27 2 -33 8 -34 C8 -27 5 -22 1 -20 Z" fill="#b6ea8a" stroke="#3d7a2a" strokeWidth="1.4" />
      </g>
    ),
  },
  {
    id: 'partyHat', label: 'Chapéu de festa', anchor: 'head',
    art: (c) => (
      <g transform={`translate(${c.w * 0.06} 5) rotate(8) scale(${S(c)})`}>
        <path d="M-13 0 L0 -32 L13 0 Z" fill="#ffd977" stroke={c.deep} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M-9.5 -9 L9.5 -9 M-5.8 -18 L5.8 -18" stroke={c.cheek} strokeWidth="3.4" />
        <circle cx="0" cy="-33" r="4.4" fill={c.cheek} />
      </g>
    ),
  },
  {
    id: 'crown', label: 'Coroa', anchor: 'head',
    art: (c) => (
      <g transform={`translate(0 4) scale(${S(c)})`}>
        <path d="M-15 0 L-17 -17 L-8 -9 L0 -21 L8 -9 L17 -17 L15 0 Z" fill="#ffd34d" stroke="#b8860b" strokeWidth="1.6" strokeLinejoin="round" />
        <rect x="-15" y="-4" width="30" height="4" fill="#e6b422" />
        <circle cx="0" cy="-11" r="2.6" fill={c.cheek} />
        <circle cx="-9" cy="-6" r="1.8" fill="#7ec8ff" />
        <circle cx="9" cy="-6" r="1.8" fill="#7ec8ff" />
      </g>
    ),
  },
  {
    id: 'glasses', label: 'Óculos', anchor: 'face',
    art: (c) => {
      const [a, b] = c.eyes; const r = c.r + 3.2;
      return (
        <g>
          <circle cx={a.x} cy={a.y} r={r} fill="#fff" fillOpacity=".08" stroke="#2a2440" strokeWidth="2.6" />
          <circle cx={b.x} cy={b.y} r={r} fill="#fff" fillOpacity=".08" stroke="#2a2440" strokeWidth="2.6" />
          <path d={`M${a.x + r} ${a.y - 1} Q${(a.x + b.x) / 2} ${a.y - 5} ${b.x - r} ${b.y - 1}`} fill="none" stroke="#2a2440" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
    },
  },
  {
    id: 'antenna', label: 'Antena', anchor: 'head', sway: true,
    art: (c, uid) => (
      <g transform={`translate(0 3) scale(${S(c)})`}>
        <path d="M0 1 C0 -9 4 -16 9 -27" fill="none" stroke={c.deep} strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="10" cy="-30" r="13" fill={`url(#${uid}-bulb)`} className="pcc-antenna-glow" />
        <circle cx="10" cy="-30" r="6" fill="#ffd977" />
      </g>
    ),
  },
  {
    id: 'ears', label: 'Orelhinhas', anchor: 'head',
    art: (c) => (
      <g transform={`translate(0 6) scale(${S(c)})`}>
        {[-1, 1].map((sd) => (
          <g key={sd} transform={`translate(${sd * 13} -2) rotate(${sd * 16})`} className={`pcc-ear pcc-ear-${sd > 0 ? 'r' : 'l'}`}>
            <ellipse cx="0" cy="-12" rx="8" ry="15" fill={c.base} stroke={c.deep} strokeWidth="1.5" />
            <ellipse cx="0" cy="-11" rx="3.6" ry="8.5" fill={c.cheek} opacity=".75" />
          </g>
        ))}
      </g>
    ),
  },
  {
    id: 'horn', label: 'Chifre de unicórnio', anchor: 'head',
    art: (c) => (
      <g transform={`translate(0 4) scale(${S(c)})`}>
        <path d="M-5.5 2 C-5 -11 -1 -21 2 -27 C5 -19 4 -7 4 2 Z" fill="#fff4c2" stroke={c.deep} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M-4.6 -4 L3.6 -6 M-3.6 -11 L3 -13 M-2 -18 L2.4 -19.5" stroke={c.cheek} strokeWidth="1.8" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: 'flower', label: 'Florzinha', anchor: 'head', sway: true,
    art: (c) => (
      <g transform={`translate(${c.w * 0.22} ${Math.min(14, c.w * 0.1)}) scale(${S(c)})`}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="0" cy="-6.5" rx="4.4" ry="6.5" transform={`rotate(${a})`} fill="#fff" stroke={c.deep} strokeWidth="1.1" />
        ))}
        <circle r="4" fill="#ffd34d" stroke="#d99b1a" strokeWidth="1" />
      </g>
    ),
  },
  {
    id: 'tophat', label: 'Cartola', anchor: 'head',
    art: (c) => (
      <g transform={`translate(${-c.w * 0.04} 5) rotate(-6) scale(${S(c)})`}>
        <ellipse cx="0" cy="-1" rx="20" ry="4.5" fill="#2a2440" />
        <path d="M-12 -1 L-11 -26 Q0 -29 11 -26 L12 -1 Z" fill="#2a2440" />
        <path d="M-11.6 -9 Q0 -11 11.6 -9 L11.8 -4 Q0 -6 -11.8 -4 Z" fill={c.cheek} />
      </g>
    ),
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

// Escolhas salvas no navegador (sem conta, sem servidor).
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
export function Accessory({ c, id, uid, reg, where }) {
  const a = ACCESSORIES[id];
  if (!a || a.id === 'none') return null;
  if ((where === 'face') !== (a.anchor === 'face')) return null;
  const art = a.art(c, uid);
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
