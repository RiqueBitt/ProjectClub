// A role's `color` field (server/prisma/schema.prisma: Role.color, a plain
// String) is normally a solid "#rrggbb" hex, but can also hold a full CSS
// gradient string ("linear-gradient(...)") when the role was created with a
// gradient — see the "Cor em degradê" toggle in RoleManagerModal.jsx. No
// schema change was needed for this: both forms are just strings, and
// anywhere the color is used as a `background` (role dots, chip fills) a
// gradient already works with zero special-casing. The one place that needs
// help is anywhere the color is used as *text* color — plain CSS `color`
// can't hold a gradient, so that needs the background-clip-text trick below.

export function isGradientColor(color) {
  return typeof color === 'string' && color.startsWith('linear-gradient(');
}

// For role-colored text (member names, mention chips, role chip labels).
export function roleTextStyle(color) {
  if (!color) return undefined;
  if (isGradientColor(color)) {
    return { backgroundImage: color, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };
  }
  return { color };
}

// For role chips that also need a border — `border-color` can't hold a
// gradient either, so a gradient role's chip border falls back to the
// gradient's first stop color while the label text itself still renders
// the full gradient via roleTextStyle above.
export function roleChipStyle(color) {
  if (!color) return undefined;
  const borderColor = isGradientColor(color) ? gradientStops(color)[0] : color;
  return { borderColor, ...roleTextStyle(color) };
}

// "linear-gradient(135deg, #ff0000, #0000ff)" -> ['#ff0000', '#0000ff']
// Falls back to two copies of the solid color (or the default gray) so the
// two gradient-stop pickers in RoleManagerModal always have sane starting
// values, whether the role currently has a solid or gradient color.
export function gradientStops(color) {
  if (!isGradientColor(color)) return [color || '#99AAB5', color || '#99AAB5'];
  const m = color.match(/linear-gradient\([^,]+,\s*([^,]+),\s*([^)]+)\)/);
  return m ? [m[1].trim(), m[2].trim()] : ['#99AAB5', '#99AAB5'];
}

export function makeGradient(a, b) {
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(153,170,181,${alpha})`; // falls back to the default role gray
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// A soft, low-opacity version of a role's color (or, for a gradient role,
// the same gradient with both stops faded) — used as a mention chip's box
// fill so it reads as "this role's color, but weak", while the chip's text
// (see roleTextStyle above) stays at full strength.
export function roleWeakBackground(color, alpha = 0.2) {
  if (!color) return undefined;
  if (isGradientColor(color)) {
    const [a, b] = gradientStops(color);
    return `linear-gradient(135deg, ${hexToRgba(a, alpha)}, ${hexToRgba(b, alpha)})`;
  }
  return hexToRgba(color, alpha);
}

// Every role starts with this exact gray (server/prisma/schema.prisma:
// Role.color @default("#99AAB5"), same fallback used in the color picker in
// RoleManagerModal.jsx) — treated as "no real color set", same as Discord:
// a role stuck on this default gray doesn't tint a member's name, so name
// coloring skips it and keeps looking further down the role hierarchy.
export const DEFAULT_ROLE_COLOR = '#99AAB5';

export function isDefaultRoleColor(color) {
  return !color || color.toLowerCase() === DEFAULT_ROLE_COLOR.toLowerCase();
}

// The role that should actually tint a member's displayed name: the
// highest-position role they hold that has a real (non-default) color —
// skipping over any higher role still stuck on the default gray, same as
// Discord. Returns null if the member holds no colored role at all, in
// which case their name just renders in the normal text color.
export function highestColoredRole(member, roles) {
  const mine = (roles || [])
    .filter((r) => !r.isDefault && member?.roleIds?.includes(r.id) && !isDefaultRoleColor(r.color))
    .sort((a, b) => b.position - a.position);
  return mine[0] || null;
}
