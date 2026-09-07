import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { proxyImage } from '../utils/imageProxy';

// Visualização ampliada de imagem/GIF/vídeo (item pedido) — abre ao
// clicar em qualquer imagem enviada no chat (anexo ou GIF colado, ver
// Message.jsx) ou no botão de expandir de um vídeo. Zoom por clique
// (alterna 1x/2.5x) e roda do mouse pra imagem/GIF; vídeo usa os
// próprios controles nativos em vez de zoom. Botões de fechar e
// baixar.
export default function ImageLightbox() {
  const image = useStore((s) => s.lightboxImage);
  const closeLightbox = useStore((s) => s.closeLightbox);
  const [zoomed, setZoomed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!image) return;
    setZoomed(false);
    setDownloading(false);
    const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [image, closeLightbox]);

  if (!image) return null;

  const filename = image.filename || image.url.split('/').pop() || 'arquivo';
  const isVideo = (image.mimeType || '').startsWith('video/');

  // BUG CORRIGIDO ("clico em baixar e abre uma tela que não faz
  // nada"): um <a href download> só baixa de verdade quando o
  // arquivo é do MESMO domínio do site — pra qualquer coisa vinda de
  // outro domínio (o armazenamento externo que guarda as imagens e
  // vídeos enviados), o navegador ignora o atributo download por
  // segurança (regra do próprio navegador, não é nada configurável
  // aqui) e simplesmente abre o arquivo numa aba nova em vez de
  // baixar — e como vídeo não é algo que <img> consegue mostrar (o
  // lightbox nem tinha suporte a vídeo nenhum antes), essa aba nova
  // não mostrava nada, exatamente como descrito. Buscando o arquivo
  // e construindo o download a partir dos bytes já baixados
  // (blob) contorna essa trava do navegador, então o download
  // acontece de verdade, direto, sem abrir nada.
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(proxyImage(image.url));
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Se o download por blob falhar por qualquer motivo (rede,
      // CORS bloqueando a leitura em si), like último recurso abre
      // numa aba nova — pelo menos a pessoa consegue salvar manualmente
      // (clique direito → salvar como), em vez de não acontecer nada.
      window.open(image.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="lightbox-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}>
      <div className="lightbox-toolbar">
        <button type="button" className="lightbox-btn" title="Baixar" onClick={download} disabled={downloading}>
          {downloading ? '⬇ Baixando...' : '⬇ Baixar'}
        </button>
        <button type="button" className="lightbox-btn" title="Fechar" onClick={closeLightbox}>✕ Fechar</button>
      </div>
      {isVideo ? (
        <video
          className="lightbox-image lightbox-video"
          src={image.url}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          className={`lightbox-image ${zoomed ? 'zoomed' : ''}`}
          src={image.url}
          alt={filename}
          onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
          onWheel={(e) => { if (e.deltaY < 0 && !zoomed) setZoomed(true); if (e.deltaY > 0 && zoomed) setZoomed(false); }}
        />
      )}
    </div>
  );
}
