import { proxyImage } from '../utils/imageProxy';
import '../styles/profile-banner.css';

// Banner do perfil com enquadramento (editor de banner estilo Discord —
// ver ImageCropperModal.jsx). Todo lugar que mostra o banner de alguém
// usa ESTE componente, pra que o recorte escolhido no editor seja o
// mesmo em todo canto (perfil completo, painel da DM, miniperfil,
// prévia nas configurações).
//
// Proporções fixas: a moldura do editor tem exatamente a mesma
// proporção da faixa onde o banner aparece, então o que a pessoa vê
// no editor é o que aparece no perfil.
export const PROFILE_BANNER_ASPECT = 3; // perfil completo / DM / prévia
export const MINI_BANNER_ASPECT = 16 / 5; // miniperfil (320×100)

const DEFAULT_FRAMING = { x: 50, y: 50, zoom: 1 };

// "x,y,zoom" (salvo no banco) → { x, y, zoom }. Valor ausente ou
// estragado = centralizado sem zoom (igual era antes do editor).
export function parseBannerFraming(raw) {
  if (!raw || typeof raw !== 'string') return { ...DEFAULT_FRAMING };
  const [x, y, zoom] = raw.split(',').map(Number);
  if (![x, y, zoom].every(Number.isFinite)) return { ...DEFAULT_FRAMING };
  return {
    x: Math.min(100, Math.max(0, x)),
    y: Math.min(100, Math.max(0, y)),
    zoom: Math.min(4, Math.max(1, zoom)),
  };
}

export function formatBannerFraming({ x, y, zoom }) {
  return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10},${Math.round(zoom * 100) / 100}`;
}

// Como aplicar o enquadramento numa <img> dentro de uma caixa com
// overflow: hidden. object-fit: cover + object-position no ponto de
// foco, e o zoom é um scale() com origem nesse MESMO ponto — assim o
// ponto escolhido fica parado e a imagem cresce em volta dele. Funciona
// igual pra imagem estática e GIF (a animação continua), e numa caixa
// de proporção um pouco diferente o foco continua visível.
export function bannerImageStyle(framing) {
  const f = typeof framing === 'string' || !framing ? parseBannerFraming(framing) : framing;
  const pos = `${f.x}% ${f.y}%`;
  return {
    objectFit: 'cover',
    objectPosition: pos,
    transformOrigin: pos,
    transform: f.zoom > 1.001 ? `scale(${f.zoom})` : undefined,
  };
}

export default function BannerImage({ url, framing, className = '', alt = '', raw = false }) {
  if (!url) return null;
  return (
    <img
      className={`pb-banner-img ${className}`}
      src={raw ? url : proxyImage(url)}
      alt={alt}
      draggable={false}
      style={bannerImageStyle(framing)}
    />
  );
}
