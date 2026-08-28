// Purely cosmetic categorization for badges (see Badge.rarity in the
// schema) — no gameplay/permission effect of any kind, just how the badge
// list modal (BadgeListModal.jsx) colors and labels each one.
export const BADGE_RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

export const RARITY_LABEL = {
  COMMON: 'Comum',
  RARE: 'Raro',
  EPIC: 'Épico',
  LEGENDARY: 'Lendário',
};

export const RARITY_COLOR = {
  COMMON: '#9aa1a8',
  RARE: '#3b9dff',
  EPIC: '#b06bff',
  LEGENDARY: '#f0b232',
};

// A badge's uploaded image (Badge.iconUrl) takes precedence over its plain
// emoji glyph (Badge.icon) wherever it's rendered — this is the one place
// that decision is made, so every consumer (profile chip, badge list
// modal, admin table) stays in sync automatically.
export function badgeHasImage(badge) {
  return !!badge?.iconUrl;
}
