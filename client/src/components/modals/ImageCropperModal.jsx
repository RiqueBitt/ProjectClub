import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';

// Item pedido: "quando for colocar uma foto/banner no perfil, abra um
// menu pra você selecionar a área que você quer mostrar... tipo vai
// mostrar um retângulo, quadrado, etc, aí você vai encaixar a imagem
// do jeito que quiser" — antes, o arquivo escolhido no seletor do
// sistema ia direto pro upload, sem nenhuma chance de posicionar; se
// a foto fosse mais larga/alta que a área de exibição, o
// enquadramento automático (object-fit: cover) podia cortar
// exatamente a parte que a pessoa queria mostrar, sem ela poder
// escolher.
//
// aspectRatio = largura/altura da moldura (1 = quadrado/avatar, valor
// maior = banner mais largo). shape = 'circle' só muda a MÁSCARA
// visual durante a edição (um círculo por cima, sugerindo "isso vira
// redondo") — o recorte em si é sempre um retângulo, a máscara
// redonda de verdade já é aplicada depois, na exibição (UserAvatar.jsx).
const PREVIEW_SIZE = 320; // largura de referência da moldura na tela, independente do tamanho final do arquivo
const OUTPUT_WIDTH = 800; // tamanho final do arquivo gerado — grande o suficiente pra não ficar borrado em nenhum lugar que a imagem aparece

export default function ImageCropperModal({ file, aspectRatio = 1, shape = 'rect', title = 'Ajustar imagem', onConfirm, onClose }) {
  const [imgEl, setImgEl] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [baseScale, setBaseScale] = useState(1);
  const dragRef = useRef(null); // { startX, startY, startOffset }
  const containerRef = useRef(null);

  const frameWidth = PREVIEW_SIZE;
  const frameHeight = PREVIEW_SIZE / aspectRatio;

  // Carrega a imagem escolhida uma vez, calcula a escala mínima pra
  // ela cobrir a moldura inteira (equivalente a object-fit: cover),
  // que é o ponto de partida — a pessoa só aumenta o zoom a partir
  // daqui, nunca diminui a ponto de sobrar área vazia na moldura.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scaleToFillWidth = frameWidth / img.naturalWidth;
      const scaleToFillHeight = frameHeight / img.naturalHeight;
      const minScale = Math.max(scaleToFillWidth, scaleToFillHeight);
      setBaseScale(minScale);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setImgEl(img);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Não deixa arrastar a ponto de aparecer área vazia dentro da
  // moldura — limita o offset ao "sobra" de imagem além do tamanho
  // da moldura, nos dois eixos.
  const clampOffset = (next, currentZoom) => {
    if (!imgEl) return next;
    const scale = baseScale * currentZoom;
    const scaledW = imgEl.naturalWidth * scale;
    const scaledH = imgEl.naturalHeight * scale;
    const maxX = Math.max(0, (scaledW - frameWidth) / 2);
    const maxY = Math.max(0, (scaledH - frameHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  };

  const onPointerDown = (e) => {
    const point = e.touches ? e.touches[0] : e;
    dragRef.current = { startX: point.clientX, startY: point.clientY, startOffset: offset };
  };

  useEffect(() => {
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - drag.startX;
      const dy = point.clientY - drag.startY;
      setOffset(clampOffset({ x: drag.startOffset.x + dx, y: drag.startOffset.y + dy }, zoom));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, imgEl, baseScale]);

  const onZoomChange = (value) => {
    const nextZoom = Number(value);
    setZoom(nextZoom);
    setOffset((prev) => clampOffset(prev, nextZoom));
  };

  const confirm = () => {
    if (!imgEl) return;
    const scale = baseScale * zoom;
    // Área (no espaço da imagem ORIGINAL, em pixels reais do arquivo)
    // que corresponde exatamente ao que está visível dentro da
    // moldura na tela agora — o centro da moldura, na escala atual,
    // deslocado pelo offset que a pessoa arrastou.
    const srcW = frameWidth / scale;
    const srcH = frameHeight / scale;
    const srcX = imgEl.naturalWidth / 2 - offset.x / scale - srcW / 2;
    const srcY = imgEl.naturalHeight / 2 - offset.y / scale - srcH / 2;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_WIDTH / aspectRatio;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const outFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
      onConfirm(outFile);
    }, 'image/jpeg', 0.92);
  };

  return (
    <Modal title={title} onClose={onClose} width={`${frameWidth + 60}px`}>
      <div className="image-cropper">
        <div
          ref={containerRef}
          className={`image-cropper-frame ${shape === 'circle' ? 'circle' : ''}`}
          style={{ width: frameWidth, height: frameHeight }}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
        >
          {imgEl && (
            <img
              src={imgEl.src} alt="" draggable={false}
              className="image-cropper-img"
              style={{
                width: imgEl.naturalWidth * baseScale * zoom,
                height: imgEl.naturalHeight * baseScale * zoom,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          {shape === 'circle' && <div className="image-cropper-circle-mask" />}
        </div>
        <label className="image-cropper-zoom-row">
          Zoom
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(e) => onZoomChange(e.target.value)} />
        </label>
        <p className="dim" style={{ fontSize: 12, textAlign: 'center' }}>Arraste a imagem pra posicionar</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={!imgEl}>Usar esta imagem</button>
        </div>
      </div>
    </Modal>
  );
}
