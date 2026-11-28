import ChannelTypeIcon from './ChannelTypeIcon.jsx';
import { proxyImage } from '../utils/imageProxy';

// Ícone de um canal ou categoria: o ícone personalizado (emoji ou imagem
// pequena) quando existe; senão, o padrão do tipo (#, alto-falante...).
// Usado na lista de canais, no cabeçalho do chat e nas abas de canais.
export function hasCustomIcon(item) {
  return !!(item && (item.iconEmoji || item.iconUrl));
}

export function CustomIcon({ item, className = '' }) {
  if (item?.iconUrl) {
    return <img className={`custom-icon custom-icon-img ${className}`} src={proxyImage(item.iconUrl)} alt="" loading="lazy" draggable={false} />;
  }
  if (item?.iconEmoji) {
    return <span className={`custom-icon custom-icon-emoji ${className}`} aria-hidden="true">{item.iconEmoji}</span>;
  }
  return null;
}

export default function ChannelIcon({ channel, className = 'channel-hash', fallback = null }) {
  if (hasCustomIcon(channel)) return <CustomIcon item={channel} className={`channel-custom-icon ${className}`} />;
  if (fallback) return fallback;
  return <ChannelTypeIcon type={channel?.type} className={className} />;
}
