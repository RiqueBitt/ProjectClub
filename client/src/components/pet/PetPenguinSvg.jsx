import { useId } from 'react';
import { PENGUIN_COLORS } from '../PenguinAvatar.jsx';
import '../../styles/fase8.css';

// Mascote pinguim do perfil (Fase 8) — mesmo estilo do PenguinAvatar (SVG
// puro, sem imagens), com estágios de evolução, acessórios e animações
// leves em CSS (respira, pisca, mexe as asas). Tudo desenhado num quadro de
// 120×120; o estágio só muda a escala (os pés ficam sempre no chão) e os
// detalhes (penugem do filhote, aura do lendário).

const STAGE_SCALE = [0.7, 0.85, 1, 1];

export const PET_MOODS = { feliz: 'Feliz', tranquilo: 'Tranquilo', carente: 'Com saudade' };

function Accessory({ id }) {
  switch (id) {
    case 'gorro':
      return (
        <g>
          <path d="M33 46 Q34 18 60 17 Q86 18 87 46 Z" fill="#E0524B" />
          <rect x="31" y="40" width="58" height="9" rx="4.5" fill="#F5F5F5" />
          <circle cx="60" cy="15" r="6" fill="#F5F5F5" />
        </g>
      );
    case 'laco':
      return (
        <g transform="translate(78 30) rotate(18)">
          <path d="M0 0 L-13 -8 L-13 8 Z" fill="#EF7DB8" />
          <path d="M0 0 L13 -8 L13 8 Z" fill="#EF7DB8" />
          <circle r="4" fill="#D9539A" />
        </g>
      );
    case 'fone':
      return (
        <g>
          <path d="M28 54 Q28 18 60 18 Q92 18 92 54" fill="none" stroke="#2B2D33" strokeWidth="5" strokeLinecap="round" />
          <rect x="22" y="44" width="11" height="18" rx="5" fill="#3EA0E0" />
          <rect x="87" y="44" width="11" height="18" rx="5" fill="#3EA0E0" />
        </g>
      );
    case 'cartola':
      return (
        <g>
          <rect x="44" y="4" width="32" height="30" rx="3" fill="#24252B" />
          <rect x="44" y="24" width="32" height="6" fill="#B33B3B" />
          <ellipse cx="60" cy="34" rx="27" ry="5" fill="#24252B" />
        </g>
      );
    case 'coroa':
      return (
        <g>
          <path d="M40 34 L42 14 L51 24 L60 10 L69 24 L78 14 L80 34 Z" fill="#F4C430" stroke="#C99A12" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="60" cy="26" r="3" fill="#E0524B" />
          <circle cx="48" cy="29" r="2" fill="#3EA0E0" />
          <circle cx="72" cy="29" r="2" fill="#5CB85C" />
        </g>
      );
    case 'oculos':
      return (
        <g fill="none" stroke="#2B2D33" strokeWidth="2.2">
          <circle cx="50" cy="50" r="8.5" />
          <circle cx="70" cy="50" r="8.5" />
          <path d="M58.5 50 Q60 48 61.5 50" />
        </g>
      );
    case 'oculos-sol':
      return (
        <g>
          <rect x="40" y="44" width="18" height="11" rx="5" fill="#17181C" />
          <rect x="62" y="44" width="18" height="11" rx="5" fill="#17181C" />
          <path d="M58 48 L62 48" stroke="#17181C" strokeWidth="2.5" />
          <path d="M43 47 L49 47" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      );
    case 'cachecol':
      return (
        <g>
          <path d="M31 62 Q60 74 89 62 L89 70 Q60 82 31 70 Z" fill="#5CB85C" />
          <path d="M72 70 L78 92 L69 92 L64 72 Z" fill="#4A9E4A" />
          <path d="M40 66 L42 72 M52 69 L53 75 M64 69 L64 75 M76 66 L75 72" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.5" />
        </g>
      );
    case 'gravata':
      return (
        <g transform="translate(60 67)">
          <path d="M0 0 L-12 -7 L-12 7 Z" fill="#9B6FD1" />
          <path d="M0 0 L12 -7 L12 7 Z" fill="#9B6FD1" />
          <circle r="3.5" fill="#7C4FB8" />
        </g>
      );
    case 'peixe':
      return (
        <g transform="translate(98 84) rotate(-20)">
          <ellipse cx="0" cy="0" rx="9" ry="5" fill="#8FC9F0" />
          <path d="M8 0 L15 -5 L15 5 Z" fill="#8FC9F0" />
          <circle cx="-4" cy="-1" r="1.3" fill="#1C1E21" />
        </g>
      );
    case 'balao':
      return (
        <g className="pet-balloon">
          <path d="M96 76 Q104 56 104 36" fill="none" stroke="#6B6B73" strokeWidth="1" />
          <ellipse cx="104" cy="24" rx="10" ry="12" fill="#E0524B" />
          <path d="M101 36 L104 39 L107 36 Z" fill="#E0524B" />
          <ellipse cx="100" cy="19" rx="2.5" ry="4" fill="#FFFFFF" fillOpacity="0.5" />
        </g>
      );
    default:
      return null;
  }
}

// Ordem de desenho: mão e pescoço antes, cabeça e rosto por cima.
const DRAW_ORDER = ['mao', 'pescoco', 'rosto', 'cabeca'];

export default function PetPenguinSvg({ color = 'blue', stage = 0, mood = 'feliz', equipped = {}, size = 120, animated = true, title }) {
  const uid = useId().replace(/:/g, '');
  const fill = PENGUIN_COLORS[color] || PENGUIN_COLORS.blue;
  const s = STAGE_SCALE[stage] ?? 1;
  const sad = mood === 'carente';
  const legendary = stage >= 3;
  const chick = stage === 0;
  return (
    <svg
      width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"
      className={`pet-svg${animated ? ' is-animated' : ''}${sad ? ' is-sad' : ''}`}
      role="img" aria-label={title || 'Pinguim'}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id={`pet-aura-${uid}`} cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="#FFE680" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFE680" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`pet-shade-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* sombra no chão */}
      <ellipse className="pet-shadow" cx="60" cy="112" rx={26 * s} ry="4" fill="#000" fillOpacity="0.16" />
      {legendary && <circle className="pet-aura" cx="60" cy="64" r="58" fill={`url(#pet-aura-${uid})`} />}
      <g transform={`translate(60 110) scale(${s}) translate(-60 -110)`}>
        <g className="pet-body">
          {/* asas */}
          <g className="pet-wing pet-wing-l"><ellipse cx="30" cy="70" rx="8" ry="19" fill={fill} transform="rotate(14 30 70)" /></g>
          <g className="pet-wing pet-wing-r"><ellipse cx="90" cy="70" rx="8" ry="19" fill={fill} transform="rotate(-14 90 70)" /></g>
          {/* corpo e barriga */}
          <ellipse cx="60" cy="70" rx="32" ry="38" fill={fill} />
          <ellipse cx="60" cy="70" rx="32" ry="38" fill={`url(#pet-shade-${uid})`} />
          <ellipse cx="60" cy="77" rx="20" ry="27" fill="#FFFFFF" />
          {legendary && <path d="M60 70 l3 6 6 1 -4.5 4 1.2 6.5 -5.7 -3 -5.7 3 1.2 -6.5 -4.5 -4 6 -1 z" fill="#F4C430" opacity="0.9" />}
          {/* penugem do filhote */}
          {chick && (
            <g fill={fill}>
              <path d="M54 34 Q56 22 60 32 Q63 21 66 34 Z" />
              <circle cx="40" cy="96" r="3" fill="#FFFFFF" fillOpacity="0.5" />
              <circle cx="80" cy="92" r="2.5" fill="#FFFFFF" fillOpacity="0.5" />
            </g>
          )}
          {/* pés */}
          <ellipse cx="48" cy="107" rx="10" ry="4" fill="#F5A623" />
          <ellipse cx="72" cy="107" rx="10" ry="4" fill="#F5A623" />
          {/* olhos */}
          <g className="pet-eyes">
            <circle cx="50" cy="50" r={chick ? 7.5 : 6.5} fill="#FFFFFF" />
            <circle cx="70" cy="50" r={chick ? 7.5 : 6.5} fill="#FFFFFF" />
            <circle cx="51" cy={sad ? 52 : 51} r={chick ? 4 : 3.2} fill="#1C1E21" />
            <circle cx="71" cy={sad ? 52 : 51} r={chick ? 4 : 3.2} fill="#1C1E21" />
            <circle cx="52.3" cy="49.5" r="1.1" fill="#FFFFFF" />
            <circle cx="72.3" cy="49.5" r="1.1" fill="#FFFFFF" />
          </g>
          {sad && (
            <g stroke="#1C1E21" strokeWidth="1.6" strokeLinecap="round">
              <path d="M43 44 L55 46" />
              <path d="M77 44 L65 46" />
            </g>
          )}
          {mood === 'feliz' && (
            <g fill="#F28AA8" fillOpacity="0.55">
              <ellipse cx="42" cy="59" rx="4" ry="2.4" />
              <ellipse cx="78" cy="59" rx="4" ry="2.4" />
            </g>
          )}
          {/* bico */}
          <path d="M53 58 Q60 68 67 58 Q60 61 53 58 Z" fill="#F5A623" />
          {DRAW_ORDER.map((slot) => (equipped?.[slot] ? <Accessory key={slot} id={equipped[slot]} /> : null))}
        </g>
      </g>
      {legendary && (
        <g className="pet-sparkles" fill="#FFD84D">
          <path d="M14 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" />
          <path d="M104 52 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z" />
          <path d="M20 86 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 z" />
        </g>
      )}
    </svg>
  );
}
