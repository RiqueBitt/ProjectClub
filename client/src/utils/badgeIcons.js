// Insígnias como ícones de traço coloridos (mesmo estilo Lucide dos ícones
// do app), em vez das imagens PNG antigas. Cada tipo de insígnia tem um
// ícone e uma cor. Insígnia criada pela equipe com imagem enviada (fora de
// /badges/) continua com a imagem; o resto cai num ícone genérico na cor
// da raridade.
import { RARITY_COLOR } from './badgeRarity.js';

export const BADGE_ICON_PATHS = {
  crown: ['M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z', 'M5 21h14'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
  gavel: ['m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8', 'm16 16 6-6', 'm8 8 6-6', 'm9 7 8 8', 'm21 11-8-8'],
  handshake: ['m11 17 2 2a1 1 0 1 0 3-3', 'm14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4', 'm21 3 1 11h-2', 'M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3', 'M3 4h8'],
  bug: ['m8 2 1.88 1.88', 'M14.12 3.88 16 2', 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1', 'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6', 'M12 20v-9', 'M6.53 9C4.6 8.8 3 7.1 3 5', 'M6 13H2', 'M3 21c0-2.1 1.7-3.9 3.8-4', 'M20.97 5c0 2.1-1.6 3.8-3.5 4', 'M22 13h-4', 'M17.2 17c2.1.1 3.8 1.9 3.8 4'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  gem: ['M6 3h12l4 6-10 13L2 9Z', 'M11 3 8 9l4 13 4-13-3-6', 'M2 9h20'],
  sparkles: ['M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z', 'M20 3v4', 'M22 5h-4', 'M4 17v2', 'M5 18H3'],
  flask: ['M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2', 'M8.5 2h7', 'M7 16h10'],
  sprout: ['M7 20h10', 'M10 20c5.5-2.5.8-6.4 3-10', 'M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z', 'M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z'],
  cake: ['M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8', 'M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1', 'M2 21h20', 'M7 8v3', 'M12 8v3', 'M17 8v3', 'M7 4h.01', 'M12 4h.01', 'M17 4h.01'],
  award: ['m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526', 'M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z'],
};

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
