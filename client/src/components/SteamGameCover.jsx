import { useEffect, useState } from 'react';
import { steamCoverCandidates } from '../utils/activityArt';

// Capa de jogo da Steam na atividade ("Jogando X"), no mesmo estilo da capa
// do álbum na música: tenta a capa vertical direto do CDN da Steam e, a
// cada falha (onError), passa pra próxima opção (proxy do servidor →
// header → proxy do header). Se nenhuma carregar, mostra `fallback`
// (o ícone genérico de jogo). onShape avisa o formato da imagem que está
// valendo ('cover' vertical, 'wide' horizontal, null = nenhuma) pra caixa
// em volta acompanhar.
export default function SteamGameCover({ appId, className = '', fallback = null, onShape, alt = '', loading, prefer = 'cover' }) {
  const candidates = steamCoverCandidates(appId, prefer);
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [appId]);

  const current = candidates[index];
  useEffect(() => {
    onShape?.(current ? current.shape : null);
  }, [current?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return fallback;
  return (
    <img
      key={current.src}
      className={className}
      src={current.src}
      alt={alt}
      loading={loading}
      decoding="async"
      data-steam-appid={appId}
      data-cover-shape={current.shape}
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        // O proxy de "cover" pode devolver o header (jogo sem capa vertical).
        if (w && h) onShape?.(w > h * 1.1 ? 'wide' : 'cover');
      }}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
