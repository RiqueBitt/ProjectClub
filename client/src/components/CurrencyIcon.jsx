import { useId } from 'react';

// Ícones novos das moedas e das gemas (pedido): moeda de ouro com estrela e
// gema lapidada, coloridos. Usados em todo lugar que mostra saldo, preço ou
// recompensa — Ico (PagesKit) e Icon (cartas) desenham estes quando o ícone
// pedido é "coin"/"gem". Só muda o visual: valores e saldos são os mesmos.

export function CoinIcon({ size = 16, className = '', title }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`pc-currency is-coin ${className}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <defs>
        <linearGradient id={`cr${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset=".45" stopColor="#f2a900" />
          <stop offset="1" stopColor="#a65a00" />
        </linearGradient>
        <radialGradient id={`cf${id}`} cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#ffe98a" />
          <stop offset=".55" stopColor="#ffc21a" />
          <stop offset="1" stopColor="#d98500" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10.6" fill={`url(#cr${id})`} />
      <circle cx="12" cy="12" r="8.4" fill={`url(#cf${id})`} stroke="#9a5300" strokeOpacity=".35" strokeWidth=".8" />
      <path d="M12 6.7l1.55 3.15 3.48.5-2.52 2.45.6 3.47L12 14.64l-3.11 1.63.6-3.47-2.52-2.45 3.48-.5z" fill="#fff6cc" stroke="#b06300" strokeWidth=".75" strokeLinejoin="round" />
      <path d="M6.3 9.4a6.4 6.4 0 0 1 4.4-3.9" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function GemIcon({ size = 16, className = '', title }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`pc-currency is-gem ${className}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <defs>
        <linearGradient id={`gb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9ff8ff" />
          <stop offset=".45" stopColor="#25c6ea" />
          <stop offset="1" stopColor="#1557d6" />
        </linearGradient>
      </defs>
      <path d="M7 3.4h10l4.6 5.3L12 21.2 2.4 8.7z" fill={`url(#gb${id})`} stroke="#0c4aa6" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M7 3.4l2.6 5.3h4.8L17 3.4z" fill="#d8fdff" fillOpacity=".85" />
      <path d="M2.4 8.7h7.2L12 21.2z" fill="#1e9be6" fillOpacity=".55" />
      <path d="M21.6 8.7h-7.2L12 21.2z" fill="#0e4fbf" fillOpacity=".55" />
      <path d="M9.6 8.7h4.8L12 21.2z" fill="#4fdcf5" fillOpacity=".45" />
      <path d="M18.6 1.6l.45 1.15 1.15.45-1.15.45-.45 1.15-.45-1.15-1.15-.45 1.15-.45z" fill="#fff" />
    </svg>
  );
}

// Versões de traço (uma cor) para menus/navegação, no mesmo desenho.
export const COIN_LINE = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z';
export const GEM_LINE = 'M7 3.5h10l4.5 5.2L12 21 2.5 8.7zM2.5 8.7h19M9.6 8.7 12 21l2.4-12.3M7 3.5l2.6 5.2L12 3.5l2.4 5.2L17 3.5';
