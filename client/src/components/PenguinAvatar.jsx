// Avatares de pinguim (tema Club Penguin) — desenhados em SVG puro, então
// não dependem de nenhum arquivo de imagem nem de upload: a "foto" do
// usuário vira o pseudo-URL "penguin:<cor>" (ver PENGUIN_COLORS abaixo),
// gravado no mesmo campo avatarUrl de sempre — UserAvatar.jsx reconhece
// esse prefixo e desenha o SVG no lugar da tag <img>.

export const PENGUIN_COLORS = {
  blue: '#3EA0E0', red: '#E0524B', green: '#5CB85C', yellow: '#F0C93E',
  pink: '#EF7DB8', purple: '#9B6FD1', orange: '#F0954E', black: '#4A4A52',
};

const PENGUIN_PREFIX = 'penguin:';

export function isPenguinAvatarUrl(url) {
  return typeof url === 'string' && url.startsWith(PENGUIN_PREFIX);
}

export function penguinAvatarUrl(colorKey) {
  return `${PENGUIN_PREFIX}${colorKey}`;
}

export function penguinColorFromUrl(url) {
  const key = url.slice(PENGUIN_PREFIX.length);
  return PENGUIN_COLORS[key] || PENGUIN_COLORS.blue;
}

export default function PenguinAvatar({ color = PENGUIN_COLORS.blue, size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      {/* corpo */}
      <ellipse cx="32" cy="36" rx="20" ry="24" fill={color} />
      {/* barriga */}
      <ellipse cx="32" cy="40" rx="12" ry="16" fill="#FFFFFF" />
      {/* asas */}
      <ellipse cx="13" cy="34" rx="5" ry="12" fill={color} />
      <ellipse cx="51" cy="34" rx="5" ry="12" fill={color} />
      {/* pés */}
      <ellipse cx="24" cy="58" rx="6" ry="3" fill="#F5A623" />
      <ellipse cx="40" cy="58" rx="6" ry="3" fill="#F5A623" />
      {/* olhos */}
      <circle cx="25" cy="24" r="4" fill="#FFFFFF" />
      <circle cx="39" cy="24" r="4" fill="#FFFFFF" />
      <circle cx="26" cy="25" r="2" fill="#1C1E21" />
      <circle cx="40" cy="25" r="2" fill="#1C1E21" />
      {/* bico */}
      <path d="M27 30 Q32 37 37 30 Q32 33 27 30 Z" fill="#F5A623" />
    </svg>
  );
}
