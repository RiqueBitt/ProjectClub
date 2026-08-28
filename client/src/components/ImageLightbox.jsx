import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';

// Visualização ampliada de imagem (item pedido) — abre ao clicar em
// qualquer imagem enviada no chat (anexo ou GIF colado, ver Message.jsx).
// Zoom por clique (alterna 1x/2.5x) e roda do mouse, botões de fechar e
// baixar. Funciona pra qualquer formato que o navegador já exibe num
// <img> normal (PNG/JPG/JPEG/GIF/WEBP) — não precisa de tratamento
// especial por extensão, é a mesma tag <img> só que em tela cheia.
export default function ImageLightbox() {
  const image = useStore((s) => s.lightboxImage);
  const closeLightbox = useStore((s) => s.closeLightbox);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!image) return;
    setZoomed(false);
    const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [image, closeLightbox]);

  if (!image) return null;

  const filename = image.filename || image.url.split('/').pop() || 'imagem';

  return (
    <div className="lightbox-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}>
      <div className="lightbox-toolbar">
        <a className="lightbox-btn" href={image.url} download={filename} title="Baixar imagem" onClick={(e) => e.stopPropagation()}>
          ⬇ Baixar
        </a>
        <button type="button" className="lightbox-btn" title="Fechar" onClick={closeLightbox}>✕ Fechar</button>
      </div>
      <img
        className={`lightbox-image ${zoomed ? 'zoomed' : ''}`}
        src={image.url}
        alt={filename}
        onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
        onWheel={(e) => { if (e.deltaY < 0 && !zoomed) setZoomed(true); if (e.deltaY > 0 && zoomed) setZoomed(false); }}
      />
    </div>
  );
}
