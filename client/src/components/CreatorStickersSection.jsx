import { useEffect, useState } from 'react';
import { listCreatorStickers } from '../api/fase8';

// Seção "Loja dos criadores" na aba Figurinhas do seletor (Fase 8): as
// figurinhas que a pessoa comprou (e as próprias aprovadas). Some quando
// não tem nenhuma. Cache curto pra não buscar a cada abertura.
let cache = null; // { at, stickers }
const TTL = 30_000;

// Chamado depois de uma compra pra próxima abertura do seletor já mostrar.
export function invalidateCreatorStickers() { cache = null; }

export default function CreatorStickersSection({ query = '', onPickSticker, onClose }) {
  const [stickers, setStickers] = useState(cache?.stickers || []);
  useEffect(() => {
    if (cache && Date.now() - cache.at < TTL) return undefined;
    let alive = true;
    listCreatorStickers()
      .then((d) => { cache = { at: Date.now(), stickers: d.stickers || [] }; if (alive) setStickers(cache.stickers); })
      .catch(() => { /* sem conexão ou sistema novo ainda sem tabela: só não mostra */ });
    return () => { alive = false; };
  }, []);
  const q = query.trim().toLowerCase();
  const list = q ? stickers.filter((s) => s.name.toLowerCase().includes(q)) : stickers;
  if (list.length === 0) return null;
  return (
    <div className="creator-stickers">
      <div className="emoji-picker-group-label creator-stickers-label"><span>Loja dos criadores</span></div>
      <div className="sticker-picker-grid">
        {list.map((s) => (
          <button key={s.id} type="button" title={s.name} onClick={() => { onPickSticker({ id: `criador-${s.id}`, name: s.name, url: s.url }); onClose?.(); }}>
            <img src={s.url} alt={s.name} loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
