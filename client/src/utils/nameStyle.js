// Cosmetic-only display-name styling shown on the profile page itself (see
// schema.prisma's comment on User.profileNameFont) — never anywhere else
// (messages, member lists, mentions keep using the plain name/role color).

export const NAME_FONTS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'PIXEL', label: 'Pixel' },
  { value: 'CARTOON', label: 'Cartoon' },
  { value: 'MEDIEVAL', label: 'Medieval' },
  { value: 'HANDWRITING', label: 'Manuscrita' },
];

export const NAME_EFFECTS = [
  { value: 'SOLID', label: 'Normal (Sólido)' },
  { value: 'NEON', label: 'Néon' },
  { value: 'GRADIENT', label: 'Gradiente' },
  { value: 'POP', label: 'Pop' },
  { value: 'SKETCH', label: 'Desenho' },
];

const FONT_FAMILY = {
  NORMAL: undefined, // inherits the app's own default font
  PIXEL: "'Press Start 2P', monospace",
  CARTOON: "'Bangers', cursive",
  MEDIEVAL: "'MedievalSharp', cursive",
  HANDWRITING: "'Permanent Marker', cursive",
};

// Returns the actual inline `style` object for a <h2>/<span> rendering
// someone's styled display name — combines their chosen font-family with
// whatever their chosen effect needs (a solid color, a glowing text-shadow,
// a gradient via background-clip, etc). `color` is the one field every
// effect needs one way or another, so it's always read from
// user.profileNameColor.
export function nameStyleProps(user) {
  const font = FONT_FAMILY[user?.profileNameFont] || undefined;
  const color = user?.profileNameColor || '#F2894D';
  const color2 = user?.profileNameColor2 || '#FFFFFF';
  const effect = user?.profileNameEffect || 'SOLID';
  const base = { fontFamily: font };

  switch (effect) {
    case 'NEON':
      return { ...base, color, textShadow: `0 0 4px ${color}, 0 0 11px ${color}, 0 0 19px ${color}` };
    case 'GRADIENT':
      return {
        ...base, backgroundImage: `linear-gradient(90deg, ${color}, ${color2})`,
        backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
      };
    case 'POP':
      // color2 is the front fill, color is the outline/back layer sitting
      // behind it — both pickable, instead of a fixed white-on-color combo.
      return { ...base, color: color2, WebkitTextStroke: `2px ${color}`, textShadow: `3px 3px 0 ${color}` };
    case 'SKETCH':
      return { ...base, color, textShadow: `1px 1px 0 ${color}88, -1px -1px 0 ${color}44`, letterSpacing: '0.5px' };
    case 'SOLID':
    default:
      return { ...base, color };
  }
}
