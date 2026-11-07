import { achievementVisual } from '../utils/achievementIcons.js';
import { proxyImage } from '../utils/imageProxy';

// Ícone de conquista (ver utils/achievementIcons.js). `tile` põe o fundinho
// na cor da raridade, igual às insígnias. `locked` deixa em cinza.
export default function AchievementIcon({ achievement, size = 32, tile = true, locked = false, className = '' }) {
  const v = achievementVisual(achievement);
  if (v.kind === 'image') {
    return <img className={className} src={proxyImage(v.url)} alt="" width={size} height={size} loading="lazy" style={locked ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined} />;
  }
  const color = locked ? '#80848e' : v.color;
  const inner = tile ? Math.round(size * 0.62) : size;
  const svg = (
    <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-achievement-icon={v.icon}
      className={tile ? undefined : className || undefined}>
      {v.paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
  if (!tile) return svg;
  return (
    <span className={`ach-ico-tile ${className}`.trim()}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: `${color}26`, boxShadow: `inset 0 0 0 1px ${color}40`, display: 'inline-grid', placeItems: 'center', flex: '0 0 auto' }}>
      {svg}
    </span>
  );
}
