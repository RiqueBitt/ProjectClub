import { UI_ICONS } from '../utils/uiIcons.js';

// Ícone de interface em traço (estilo Tabler). Herda a cor do texto
// (currentColor) e se alinha com o texto ao lado (ver .ui-stroke-icon em
// global.css — classe própria pra não pegar o tamanho fixo de .ui-icon, que
// é dos PNGs). Nome desconhecido não desenha nada.
export default function UiIcon({ name, size = 16, strokeWidth = 1.9, className = '', title }) {
  const paths = UI_ICONS[name];
  if (!paths) return null;
  return (
    <svg className={`ui-stroke-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined} data-icon={name}>
      {title && <title>{title}</title>}
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
