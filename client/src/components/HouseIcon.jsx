// Ícone de casa (iglu) em SVG — o catálogo original do bot Robbie nunca
// teve fotos reais de casa (background_image sempre nulo, só uma cor),
// então desenhamos um iglu simples usando a cor da casa em vez de mostrar
// uma caixa lisa sem nada.
export default function HouseIcon({ color = '#BFEFFF', size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="52" rx="26" ry="4" fill="rgba(0,0,0,0.08)" />
      <path d="M8 48 C8 30 18 16 32 16 C46 16 56 30 56 48 Z" fill={color} stroke="rgba(0,0,0,0.15)" strokeWidth="1.5" />
      <path d="M8 48 L56 48 L56 44 C46 41 18 41 8 44 Z" fill={color} stroke="rgba(0,0,0,0.15)" strokeWidth="1.5" opacity="0.7" />
      <path d="M26 48 L26 34 C26 30 38 30 38 34 L38 48 Z" fill="#FFFFFF" opacity="0.9" />
      <circle cx="46" cy="24" r="4" fill="#FFFFFF" opacity="0.8" />
    </svg>
  );
}
