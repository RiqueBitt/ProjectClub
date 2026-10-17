import coinSrc from '../assets/icons/currency-coin.png';
import gemSrc from '../assets/icons/currency-gem.png';

// Ícones das moedas (moeda dourada "PC") e das gemas (gema verde-água
// lapidada), enviados pelo dono. Usados em todo lugar que mostra saldo, preço ou
// recompensa — Ico (PagesKit) e Icon (cartas) desenham estes quando o ícone
// pedido é "coin"/"gem". Só muda o visual: valores e saldos são os mesmos.

const img = (src, cls) => function CurrencyImg({ size = 16, className = '', title }) {
  return (
    <img
      className={`pc-currency ${cls} ${className}`} src={src} width={size} height={size} draggable="false"
      alt={title || ''} aria-hidden={title ? undefined : 'true'} decoding="async"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle' }}
    />
  );
};

export const CoinIcon = img(coinSrc, 'is-coin');
export const GemIcon = img(gemSrc, 'is-gem');

// Versões de traço (uma cor) para menus/navegação, no mesmo desenho.
export const COIN_LINE = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.6l1.3 2.65 2.9.42-2.1 2.05.5 2.9L12 14.25l-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z';
export const GEM_LINE = 'M7 3.5h10l4.5 5.2L12 21 2.5 8.7zM2.5 8.7h19M9.6 8.7 12 21l2.4-12.3M7 3.5l2.6 5.2L12 3.5l2.4 5.2L17 3.5';
