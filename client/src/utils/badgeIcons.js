// Insígnias como ícones de traço coloridos (estilo Tabler: contorno, traço 2,
// pontas arredondadas), em vez das imagens PNG antigas. Cada tipo de insígnia tem um
// ícone e uma cor. Insígnia criada pela equipe com imagem enviada (fora de
// /badges/) continua com a imagem; o resto cai num ícone genérico na cor
// da raridade.
import { RARITY_COLOR } from './badgeRarity.js';
import { TABLER_ICONS } from './tablerIcons.js';

// Nome lógico → desenho do Tabler Icons (ver utils/tablerIcons.js).
const ICON_NAME = {
  crown: 'crown', wrench: 'tool', shield: 'shield-check', gavel: 'gavel', handshake: 'heart-handshake',
  bug: 'bug', heart: 'heart', gem: 'diamond', sparkles: 'sparkles', flask: 'flask', sprout: 'seedling',
  cake: 'cake', award: 'award',
};
export const BADGE_ICON_PATHS = Object.fromEntries(Object.entries(ICON_NAME).map(([k, n]) => [k, TABLER_ICONS[n]]));

// Tipo de insígnia (Badge.key) → ícone + cor.
export const BADGE_TYPE_ICONS = {
  PLATFORM_OWNER: { icon: 'crown', color: '#f0b232' },
  STAFF: { icon: 'wrench', color: '#5865f2' },
  ADMIN: { icon: 'shield', color: '#ed4245' },
  MODERATOR: { icon: 'gavel', color: '#3ba55c' },
  HELPER: { icon: 'handshake', color: '#1abc9c' },
  BUG_HUNTER_GOLD: { icon: 'bug', color: '#f0b232' },
  BUG_HUNTER: { icon: 'bug', color: '#57c26a' },
  SUPPORTER: { icon: 'heart', color: '#eb459e' },
  SUPPORTER_SUBSCRIBER: { icon: 'gem', color: '#b06bff' },
  SUPPORTER_SUPER: { icon: 'sparkles', color: '#f47fff' },
  BETA_TESTER: { icon: 'flask', color: '#3b9dff' },
  NEWCOMER: { icon: 'sprout', color: '#43b581' },
};

const AGE_ICON = { icon: 'cake', color: '#faa61a' };

// Imagem que a equipe enviou de verdade (não as PNG padrão de /badges/).
export function badgeCustomImage(badge) {
  const url = badge?.iconUrl;
  if (!url) return null;
  if (/(^|\/)badges\/[A-Z0-9_]+\.png$/i.test(url)) return null;
  return url;
}

// Decide como desenhar a insígnia: { kind: 'image', url } ou
// { kind: 'icon', icon, color, paths }.
export function badgeVisual(badge) {
  const known = BADGE_TYPE_ICONS[badge?.key];
  if (known) return { kind: 'icon', ...known, paths: BADGE_ICON_PATHS[known.icon] };
  const custom = badgeCustomImage(badge);
  if (custom) return { kind: 'image', url: custom };
  if (badge?.ageYears) return { kind: 'icon', ...AGE_ICON, paths: BADGE_ICON_PATHS.cake };
  const color = RARITY_COLOR[badge?.rarity] || RARITY_COLOR.COMMON;
  return { kind: 'icon', icon: 'award', color, paths: BADGE_ICON_PATHS.award };
}
