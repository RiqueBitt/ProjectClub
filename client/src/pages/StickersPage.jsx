import { useEffect, useState } from 'react';
import { getStickerCollection, buyStickerCapsules, openAllCapsules, pasteSticker } from '../api/endpoints';
import { Ico, PageHero, PillTabs, EmptyState, Skeleton, Toast, Unavailable } from '../components/PagesKit.jsx';
import '../styles/stickers.css';

const TABS = ['COLECAO', 'ALBUM', 'CAPSULAS'];
const TAB_LABEL = { COLECAO: 'Coleção', ALBUM: 'Álbum', CAPSULAS: 'Cápsulas' };
const TAB_ICON = { COLECAO: 'grid', ALBUM: 'book', CAPSULAS: 'capsule' };

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

  if (unavailable) return <Unavailable icon="sticker" />;
  if (!data) {
    return (
      <div className="pk-page stk"><div className="pk-inner">
        <Skeleton rows={1} height={128} />
        <Skeleton rows={1} height={44} />
        <Skeleton rows={12} height={150} grid />
      </div></div>
    );
  }

  const pct = data.totalCatalog ? Math.round((data.distinctOwned / data.totalCatalog) * 100) : 0;

  return (
    <div className="pk-page stk">
      <div className="pk-inner">
        <PageHero
          icon="sticker" eyebrow="Coleção" title="Figurinhas"
          desc="Abra cápsulas, descubra figurinhas de todas as raridades e cole no seu álbum."
          aside={(
            <div className="stk-progress">
              <div className="stk-progress-row">
                <span>Descobertas</span>
                <strong>{data.distinctOwned}<small>/{data.totalCatalog}</small></strong>
              </div>
              <div className="stk-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <small className="stk-progress-note">{pct}% do álbum completo</small>
            </div>
          )}
        />

        <PillTabs
          label="Seções das figurinhas"
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], icon: TAB_ICON[t], count: t === 'CAPSULAS' ? data.capsuleCount : 0 }))}
        />

        {tab === 'COLECAO' && <CollectionTab data={data} />}
        {tab === 'ALBUM' && <AlbumTab data={data} page={page} setPage={setPage} onChanged={refresh} pushNotice={pushNotice} />}
        {tab === 'CAPSULAS' && <CapsulesTab data={data} onChanged={refresh} pushNotice={pushNotice} />}
      </div>
      <Toast>{notice}</Toast>
    </div>
  );
}

function StickerCard({ sticker, discovered, quantity, pasted, showRarity = true, footer }) {
  const color = sticker.rarity?.color;
  return (
    <div className={`card sticker-card stk-card ${discovered ? '' : 'locked'}`} style={color ? { '--rarity': color } : undefined}>
      <div className="stk-card-art">
        {discovered ? (
          <img src={sticker.imageUrl} alt={sticker.name} />
        ) : (
          <span className="stk-card-unknown"><Ico name="question" size={30} strokeWidth={2.2} /></span>
        )}
        {discovered && quantity > 0 && <span className="stk-qty">x{quantity}</span>}
      </div>
      <div className="stk-card-name">{discovered ? sticker.name : '???'}</div>
      {showRarity && sticker.rarity && <span className="stk-rarity-chip">{sticker.rarity.name}</span>}
      {pasted && <span className="stk-card-meta pasted"><Ico name="check" size={13} strokeWidth={2.4} /> No álbum</span>}
      {footer}
    </div>
  );
}

function CollectionTab({ data }) {
  if (!data.groups.length) {
    return <EmptyState icon="sticker" title="Nenhuma figurinha no catálogo" text="Quando a equipe adicionar figurinhas, elas aparecem aqui." />;
  }
  return (
    <div className="stk-groups">
      {data.groups.map((g) => {
        const owned = g.stickers.filter((s) => s.quantity > 0 || s.pasted).length;
        const pct = g.stickers.length ? Math.round((owned / g.stickers.length) * 100) : 0;
        return (
          <section key={g.rarity.id} className="stk-group" style={{ '--rarity': g.rarity.color }}>
            <header className="stk-group-head">
              <span className="stk-rarity-chip lg">{g.rarity.name}</span>
              <span className="stk-group-count">{owned}/{g.stickers.length}</span>
              <span className="stk-mini-bar"><span style={{ width: `${pct}%` }} /></span>
            </header>
            <div className="stk-grid">
              {g.stickers.map((s) => (
                <StickerCard key={s.id} sticker={{ ...s, rarity: g.rarity }} discovered={s.quantity > 0 || s.pasted} quantity={s.quantity} pasted={s.pasted} showRarity={false} />
              ))}
            </div>
          </section>
        );
      })}
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
          ) : <span className="album-slot-plus"><Ico name="plus" size={18} strokeWidth={2.2} /></span>}
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

  const total = data.album.totalPages;
  const filled = data.album.slots.filter((s) => s.sticker).length;

  return (
    <div className="stk-album">
      <div className="pk-card stk-album-card">
        <div className="stk-pager">
          <button className="pk-btn icon" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><Ico name="left" /></button>
          <div className="stk-pager-mid">
            <strong>Página {page}<small>/{total}</small></strong>
            <span className="stk-dots" aria-hidden="true">
              {total <= 12 && Array.from({ length: total }).map((_, i) => (
                <button key={i} type="button" tabIndex={-1} className={i + 1 === page ? 'on' : ''} onClick={() => setPage(i + 1)} />
              ))}
            </span>
            <small className="stk-pager-meta">{filled}/{data.album.slots.length} espaços preenchidos</small>
          </div>
          <button className="pk-btn icon" aria-label="Próxima página" disabled={page >= total} onClick={() => setPage((p) => p + 1)}><Ico name="right" /></button>
        </div>
        <AlbumSurface album={data.album} />
      </div>

      <section>
        <h2 className="pk-section-title"><Ico name="sticker" /> Figurinhas soltas <small>{data.looseStickers.length > 0 ? '— clique em Colar pra pôr no álbum' : ''}</small></h2>
        {data.looseStickers.length > 0 ? (
          <div className="stk-grid">
            {data.looseStickers.map((s) => (
              <StickerCard
                key={s.id} sticker={{ ...s, rarity: rarityOf(data, s) }} discovered quantity={s.quantity}
                footer={<button className="pk-btn sm primary block stk-paste" onClick={() => paste(s.id)}><Ico name="plus" size={15} /> Colar</button>}
              />
            ))}
          </div>
        ) : (
          <EmptyState compact icon="capsule" title="Nenhuma figurinha solta" text="Abra cápsulas pra ganhar figurinhas novas e colar aqui." />
        )}
      </section>
    </div>
  );
}

// A figurinha solta vem sem a raridade junto — acha pelo rarityId nos grupos.
function rarityOf(data, s) {
  const id = s.rarityId;
  return data.groups.find((g) => g.rarity.id === id)?.rarity;
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

  const prices = Object.entries(data.capsulePrices);
  const unit = prices.length ? prices[0][1] / Number(prices[0][0]) : 0;

  return (
    <div className="stk-caps">
      <div className="stk-caps-top">
        <section className="pk-card stk-machine">
          <div className="stk-machine-head">
            <span className="stk-machine-icon"><Ico name="capsule" size={26} /></span>
            <div>
              <h2>Máquina de Cápsulas</h2>
              <p className="pk-muted">Compre cápsulas e ganhe figurinhas aleatórias pro seu álbum!</p>
            </div>
          </div>
          <div className="stk-packs">
            {prices.map(([qty, price]) => {
              const per = price / Number(qty);
              const save = unit && per < unit ? Math.round((1 - per / unit) * 100) : 0;
              return (
                <button key={qty} className="stk-pack" disabled={busy} onClick={() => buy(Number(qty))}>
                  {save > 0 && <span className="stk-pack-save">-{save}%</span>}
                  <span className="stk-pack-qty">{qty}x</span>
                  <span className="stk-pack-label">cápsula{Number(qty) > 1 ? 's' : ''}</span>
                  <span className="pk-price"><Ico name="coin" size={14} strokeWidth={2} />{fmt(price)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`pk-card stk-open ${data.capsuleCount > 0 ? 'ready' : ''}`}>
          <span className="stk-open-count">{data.capsuleCount}</span>
          <h3>{data.capsuleCount > 0
            ? `Você tem ${data.capsuleCount} cápsula${data.capsuleCount > 1 ? 's' : ''} fechada${data.capsuleCount > 1 ? 's' : ''}`
            : 'Nenhuma cápsula fechada'}</h3>
          {data.capsuleCount > 0
            ? <button className="pk-btn primary lg block" disabled={busy} onClick={openAll}><Ico name="sparkles" size={18} /> Abrir todas</button>
            : <p className="pk-muted">Compre um pacote ao lado pra começar.</p>}
        </section>
      </div>

      {reveal && (
        <section className="pk-card stk-reveal">
          <h2 className="pk-section-title"><Ico name="sparkles" /> Você ganhou: <small>{reveal.length} figurinha{reveal.length > 1 ? 's' : ''}</small></h2>
          <div className="stk-grid">
            {reveal.map((r, i) => {
              const rarity = data.groups.find((g) => g.rarity.id === r.rarityId)?.rarity;
              return (
                <div key={i} className="card stk-card stk-card-new" style={{ '--rarity': rarity?.color, animationDelay: `${Math.min(i, 10) * 70}ms` }}>
                  <div className="stk-card-art"><img src={r.imageUrl} alt={r.name} /></div>
                  <div className="stk-card-name">{r.name}</div>
                  {rarity && <span className="stk-rarity-chip">{rarity.name}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
