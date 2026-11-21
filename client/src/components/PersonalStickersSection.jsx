import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPersonalStickers, uploadPersonalSticker, deletePersonalSticker } from '../api/endpoints';
import '../styles/personalStickers.css';

// Pacote de figurinhas personalizadas: seção "Minhas figurinhas" no topo da
// aba Figurinhas do seletor. Só a própria pessoa vê e usa as dela.
// Cache em nível de módulo: abrir/fechar o seletor não busca tudo de novo.
let cache = null; // { stickers, hidden, limit, tier }

export default function PersonalStickersSection({ query = '', onPickSticker, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(cache);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const update = (next) => { cache = next; setData(next); };

  useEffect(() => {
    let alive = true;
    listPersonalStickers()
      .then((d) => { if (alive) update({ stickers: d.stickers || [], hidden: d.hidden || 0, limit: d.limit || 0, tier: d.tier }); })
      .catch(() => { /* sem conexão: fica com o cache (ou nada) */ });
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const { stickers, hidden, limit } = data;

  if (limit === 0) {
    if (query.trim()) return null;
    return (
      <div className="personal-stickers-upsell">
        <div className="personal-stickers-upsell-text">
          <strong>Figurinhas personalizadas são para Assinantes</strong>
          <span>Envie até 5 figurinhas suas (15 no Super Assinante) e use em qualquer chat.</span>
        </div>
        <button type="button" className="personal-stickers-upsell-btn" onClick={() => { onClose?.(); navigate('/loja?secao=assinatura'); }}>
          Ver Assinatura
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? stickers.filter((s) => s.name.toLowerCase().includes(q)) : stickers;
  if (q && filtered.length === 0) return null;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadPersonalSticker(file, file.name);
      update({ ...data, stickers: [...stickers, r.sticker], limit: r.limit ?? limit });
    } catch (err) {
      window.alert(err?.response?.data?.error || 'Não foi possível enviar a figurinha.');
    } finally { setBusy(false); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Remover a figurinha "${s.name}"?`)) return;
    try {
      await deletePersonalSticker(s.id);
      update({ ...data, stickers: stickers.filter((x) => x.id !== s.id) });
    } catch (err) {
      window.alert(err?.response?.data?.error || 'Não foi possível remover a figurinha.');
    }
  };

  return (
    <div className="personal-stickers">
      <div className="emoji-picker-group-label personal-stickers-label">
        <span>Minhas figurinhas</span>
        <span className="personal-stickers-count">{stickers.length}/{limit}</span>
      </div>
      {hidden > 0 && !q && (
        <div className="personal-stickers-hidden">
          {hidden === 1 ? '1 figurinha guardada' : `${hidden} figurinhas guardadas`} — volte a assinar (ou suba de categoria) pra usar de novo.
        </div>
      )}
      <div className="sticker-picker-grid">
        {filtered.map((s) => (
          <div key={s.id} className="personal-sticker-tile">
            <button type="button" title={s.name} onClick={() => { onPickSticker({ id: s.id, name: s.name, url: s.url }); onClose?.(); }}>
              <img src={s.url} alt={s.name} />
            </button>
            <button type="button" className="personal-sticker-remove" title="Remover figurinha" aria-label={`Remover ${s.name}`} onClick={(e) => { e.stopPropagation(); remove(s); }}>×</button>
          </div>
        ))}
        {!q && stickers.length < limit && (
          <button type="button" className="personal-sticker-add" title="Enviar figurinha" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? '…' : '+'}
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={onFile} />
    </div>
  );
}
