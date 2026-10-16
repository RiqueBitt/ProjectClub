import { useStore } from '../store/useStore';
import { isPenguinAvatarUrl } from '../components/PenguinAvatar.jsx';

// Ver a foto de perfil / banner em tamanho cheio — reaproveita o mesmo
// visualizador das imagens do chat (ImageLightbox.jsx: zoom, baixar e
// "Abrir original"). Avatar de pinguim é desenhado em SVG (não é um
// arquivo), então não tem o que ampliar.
export function canViewProfileImage(url) {
  return typeof url === 'string' && !!url && !isPenguinAvatarUrl(url);
}

// baseName vira o nome do arquivo ao baixar ("ana-foto.webp").
export function viewProfileImage(url, baseName = 'imagem') {
  if (!canViewProfileImage(url)) return;
  const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1];
  const safe = String(baseName).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'imagem';
  useStore.getState().openLightbox([{ url, filename: ext ? `${safe}.${ext.toLowerCase()}` : safe }], 0);
}
