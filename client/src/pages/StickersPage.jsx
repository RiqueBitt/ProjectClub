import { useEffect, useState } from 'react';
import { getStickerCollection, buyStickerCapsules, openAllCapsules, pasteSticker } from '../api/endpoints';
import SystemUnavailable from '../components/SystemUnavailable.jsx';

const TABS = ['COLECAO', 'ALBUM', 'CAPSULAS'];
const TAB_LABEL = { COLECAO: '🗂️ Coleção', ALBUM: '📖 Álbum', CAPSULAS: '🎁 Cápsulas' };

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

export default function StickersPage() {
  const [tab, setTab] = useState('COLECAO');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 5000); };

  const refresh = () => getStickerCollection(page).then(setData).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  });
  useEffect(() => { refresh(); }, [page]);

  if (unavailable) return <SystemUnavailable icon="🧷" />;
  if (!data) return <div className="economy-page"><p className="dim">Carregando...</p></div>;

  return (
    <div className="economy-page">
      <div className="economy-header">
        <h1>🧷 Figurinhas</h1>
        <span className="economy-balance-chip">{data.distinctOwned}/{data.totalCatalog} descobertas</span>
      </div>
      <div className="mod-tabs">
        {TABS.map((t) => (
          <button key={t} className={`mod-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}{t === 'CAPSULAS' && data.capsuleCount > 0 ? ` (${data.capsuleCount})` : ''}
          </button>
        ))}
      </div>
      {notice && <div className="economy-notice">{notice}</div>}

      {tab === 'COLECAO' && <CollectionTab data={data} />}
      {tab === 'ALBUM' && <AlbumTab data={data} page={page} setPage={setPage} onChanged={refresh} pushNotice={pushNotice} />}
      {tab === 'CAPSULAS' && <CapsulesTab data={data} onChanged={refresh} pushNotice={pushNotice} />}
    </div>
  );
}

function StickerCard({ sticker, discovered, quantity, footer }) {
  return (
    <div className="card sticker-card" style={{ padding: 12, borderColor: discovered ? sticker.rarity?.color : undefined }}>
      {discovered ? (
        <img src={sticker.imageUrl} alt={sticker.name} style={{ width: '100%', height: 80, objectFit: 'contain' }} />
      ) : (
        <div style={{ width: '100%', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>❔</div>
      )}
      <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{discovered ? sticker.name : '???'}</div>
      {discovered && quantity !== undefined && <div className="dim" style={{ textAlign: 'center', fontSize: 12 }}>x{quantity}</div>}
      {footer}
    </div>
  );
}

function CollectionTab({ data }) {
  return (
    <div>
      {data.groups.map((g) => (
        <div key={g.rarity.id} style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: g.rarity.color, marginBottom: 8 }}>{g.rarity.name.toUpperCase()}</div>
          <div className="admin-badge-grid">
            {g.stickers.map((s) => (
              <StickerCard key={s.id} sticker={{ ...s, rarity: g.rarity }} discovered={s.quantity > 0 || s.pasted} quantity={s.quantity} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AlbumSurface({ album, onSlotClick }) {
  const { settings, slots } = album;
  return (
    <div
      className="album-surface"
      style={{
        aspectRatio: `${settings.width} / ${settings.height}`,
        backgroundColor: settings.backgroundColor,
        backgroundImage: settings.backgroundImageUrl ? `url(${settings.backgroundImageUrl})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
      }}
    >
      {slots.map((slot) => (
        <div
          key={slot.slotKey}
          className={`album-slot ${slot.sticker ? 'filled' : 'empty'} ${onSlotClick ? 'clickable' : ''}`}
          style={{
            left: `${(slot.x / settings.width) * 100}%`, top: `${(slot.y / settings.height) * 100}%`,
            width: `${(slot.width / settings.width) * 100}%`, height: `${(slot.height / settings.height) * 100}%`,
          }}
          onClick={() => onSlotClick?.(slot)}
        >
          {slot.sticker ? (
            <>
              <img src={slot.sticker.imageUrl} alt={slot.sticker.name} />
              {settings.showNames && <span className="album-slot-name">{slot.sticker.name}</span>}
            </>
          ) : <span className="album-slot-plus">➕</span>}
        </div>
      ))}
    </div>
  );
}

function AlbumTab({ data, page, setPage, onChanged, pushNotice }) {
  const paste = async (stickerId) => {
    try {
      const r = await pasteSticker(stickerId);
      pushNotice('Figurinha colada no álbum!');
      if (r.page !== page) setPage(r.page); else onChanged();
    } catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível colar.'); }
  };

  return (
    <div>
      <div className="album-pager">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Anterior</button>
        <span>Página {page}/{data.album.totalPages}</span>
        <button className="btn-secondary" disabled={page >= data.album.totalPages} onClick={() => setPage((p) => p + 1)}>Próxima ›</button>
      </div>

      <AlbumSurface album={data.album} />

      {data.looseStickers.length > 0 && (
        <>
          <h4 style={{ marginTop: 20 }}>Figurinhas soltas — clique pra colar</h4>
          <div className="admin-badge-grid">
            {data.looseStickers.map((s) => (
              <StickerCard
                key={s.id} sticker={s} discovered quantity={s.quantity}
                footer={<button className="btn-secondary" style={{ marginTop: 6, width: '100%' }} onClick={() => paste(s.id)}>🧷 Colar</button>}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CapsulesTab({ data, onChanged, pushNotice }) {
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(null);

  const buy = async (qty) => {
    setBusy(true);
    try { await buyStickerCapsules(qty); pushNotice(`Você comprou ${qty} cápsula${qty > 1 ? 's' : ''}!`); onChanged(); }
    catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível comprar.'); }
    finally { setBusy(false); }
  };

  const openAll = async () => {
    setBusy(true);
    try { const r = await openAllCapsules(); setReveal(r.results); onChanged(); }
    catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível abrir.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="settings-grid">
      <div className="settings-block">
        <h4>🎰 Máquina de Cápsulas</h4>
        <p className="dim">Compre cápsulas e ganhe figurinhas aleatórias pro seu álbum!</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(data.capsulePrices).map(([qty, price]) => (
            <button key={qty} className="btn-secondary" disabled={busy} onClick={() => buy(Number(qty))}>
              {qty}x — 🪙 {fmt(price)}
            </button>
          ))}
        </div>
      </div>

      {data.capsuleCount > 0 && (
        <div className="settings-block">
          <h4>Você tem {data.capsuleCount} cápsula{data.capsuleCount > 1 ? 's' : ''} fechada{data.capsuleCount > 1 ? 's' : ''}</h4>
          <button className="btn-primary" disabled={busy} onClick={openAll}>Abrir todas</button>
        </div>
      )}

      {reveal && (
        <div className="settings-block">
          <h4>🎉 Você ganhou:</h4>
          <div className="admin-badge-grid">
            {reveal.map((r, i) => (
              <div key={i} className="card" style={{ padding: 12 }}>
                <img src={r.imageUrl} alt={r.name} style={{ width: '100%', height: 80, objectFit: 'contain' }} />
                <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center' }}>{r.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
