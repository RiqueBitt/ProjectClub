import IconGlyph from './IconGlyph.jsx';
import PageIcon from './PageIcons.jsx';
import { proxyImage } from '../utils/imageProxy';

// Item pedido: "a cor selecionada deve alterar somente a cor do
// ícone... não deve alterar a borda, fundo ou outros elementos" —
// reaproveita a mesma técnica de mask-image do IconGlyph.jsx (o
// ícone vira uma "máscara" preenchida com a cor escolhida, em vez de
// um <img> normal com fundo colorido atrás dele) — assim a cor só
// tinge o próprio desenho do ícone, nunca o quadrado ao redor.
export default function ClanIcon({ icon, color, size = '100%' }) {
  if (!icon) return <span style={{ color, display: 'inline-flex' }}><PageIcon name="shield" size={typeof size === 'number' ? Math.round(size * 0.8) : 22} /></span>;
  return <IconGlyph src={proxyImage(icon.url)} size={size} style={{ color }} />;
}
