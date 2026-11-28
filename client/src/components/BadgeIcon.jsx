import { badgeVisual } from '../utils/badgeIcons.js';
import { proxyImage } from '../utils/imageProxy';

// Uma insígnia desenhada como ícone colorido (ver utils/badgeIcons.js).
// `tile` põe um fundinho na cor da insígnia, como os ícones de categoria.
export default function BadgeIcon({ badge, size = 20, tile = false, className = '' }) {
  const v = badgeVisual(badge);
  if (v.kind === 'image') {
    return <img className={`badge-ico-img ${className}`.trim()} src={proxyImage(v.url)} alt="" width={size} height={size} />;
  }
  const inner = tile ? Math.round(size * 0.62) : size;
  const svg = (
    <svg
      className={tile ? 'badge-ico-svg' : `badge-ico-svg ${className}`.trim()}
      width={inner} height={inner}
      viewBox="0 0 24 24" fill="none" stroke={v.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" data-badge-icon={v.icon}
    >
      {v.paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
  if (!tile) return svg;
  return (
    <span
      className={`badge-ico-tile ${className}`.trim()}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: `${v.color}26`, display: 'inline-grid', placeItems: 'center', flex: '0 0 auto' }}
    >
      {svg}
    </span>
  );
}
