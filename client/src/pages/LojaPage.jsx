import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico } from '../components/PagesKit.jsx';
import { listDecorations, buyDecoration, equipDecoration } from '../api/decorations';
import { useLiveRefresh } from '../utils/liveRefresh';
import '../styles/shop.css';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';

// Loja — por enquanto vende molduras de avatar (criadas pela staff em
// Painel da staff → Molduras), pagas com moedas ou gemas.
export default function LojaPage() {
  const { user, setUser } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async (ctx) => {
    try {
      const d = await listDecorations();
      if (!ctx || ctx.ok()) setData(d);
    } catch (e) { if (!ctx) setNotice({ bad: true, text: errMsg(e) }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, { key: 'loja' });

  const flash = (text, bad = false) => { setNotice({ text, bad }); setTimeout(() => setNotice(null), 3500); };

  const buy = async (d, currency) => {
    setBusy(`${d.id}:${currency}`);
    try {
      await buyDecoration(d.id, currency);
      flash(`"${d.name}" é sua! Clique em Usar pra colocar no avatar.`);
      await load();
    } catch (e) { flash(errMsg(e), true); }
    setBusy('');
  };
  const equip = async (id) => {
    setBusy(`eq:${id}`);
    try {
      const r = await equipDecoration(id);
      if (r.user) setUser((u) => ({ ...u, ...r.user }));
      flash(id ? 'Moldura aplicada no seu avatar.' : 'Moldura removida.');
      await load();
    } catch (e) { flash(errMsg(e), true); }
    setBusy('');
  };

  const items = data?.items || [];
  const shown = preview || items.find((d) => d.id === data?.equippedId) || null;
  const previewUser = { ...user, avatarDecoration: shown ? { id: shown.id, url: shown.imageUrl, s: shown.scale, x: shown.offsetX, y: shown.offsetY } : null };

  return (
    <div className="shop-scroll">
    <div className="shop-page">
      <header className="shop-hero">
        <div className="shop-hero-text">
          <span className="shop-kicker"><Ico name="sparkle" size={14} /> Loja</span>
          <h1>Molduras de avatar</h1>
          <p>Deixe sua foto com a sua cara. A moldura aparece em todo lugar: chat, lista de membros e perfil.</p>
          <div className="shop-balances">
            <span className="shop-bal coins"><Ico name="coin" size={16} /> {fmt(data?.coins)} moedas</span>
            <span className="shop-bal gems"><Ico name="gem" size={16} /> {fmt(data?.gems)} gemas</span>
          </div>
        </div>
        <div className="shop-hero-preview">
          <UserAvatar user={previewUser} size={112} />
          <strong>{user?.displayName}</strong>
          <small>{shown ? shown.name : 'Sem moldura'}{preview ? ' (prévia)' : ''}</small>
          {data?.equippedId && (
            <button type="button" className="shop-btn ghost" disabled={!!busy} onClick={() => equip(null)}>Tirar moldura</button>
          )}
        </div>
      </header>

      {notice && <div className={`shop-notice${notice.bad ? ' bad' : ''}`} role="status">{notice.text}</div>}

      {!data ? (
        <div className="shop-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="shop-card skeleton" />)}</div>
      ) : items.length === 0 ? (
        <div className="shop-empty">Nenhuma moldura à venda ainda. Volte em breve!</div>
      ) : (
        <div className="shop-grid">
          {items.map((d) => {
            const equipped = d.id === data.equippedId;
            const cardUser = { ...user, avatarDecoration: { id: d.id, url: d.imageUrl, s: d.scale, x: d.offsetX, y: d.offsetY } };
            return (
              <article
                key={d.id} className={`shop-card${equipped ? ' equipped' : ''}`}
                onMouseEnter={() => setPreview(d)} onMouseLeave={() => setPreview(null)}
                onFocus={() => setPreview(d)} onBlur={() => setPreview(null)}
              >
                <div className="shop-card-art"><UserAvatar user={cardUser} size={84} /></div>
                <h3>{d.name}</h3>
                {d.owned ? (
                  <button type="button" className={`shop-btn${equipped ? ' ghost' : ' primary'}`} disabled={equipped || !!busy} onClick={() => equip(d.id)}>
                    {equipped ? 'Em uso' : 'Usar'}
                  </button>
                ) : (
                  <div className="shop-prices">
                    {d.priceCoins != null && (
                      <button type="button" className="shop-btn coins" disabled={!!busy || data.coins < d.priceCoins} onClick={() => buy(d, 'coins')}>
                        <Ico name="coin" size={15} /> {fmt(d.priceCoins)}
                      </button>
                    )}
                    {d.priceGems != null && (
                      <button type="button" className="shop-btn gems" disabled={!!busy || data.gems < d.priceGems} onClick={() => buy(d, 'gems')}>
                        <Ico name="gem" size={15} /> {fmt(d.priceGems)}
                      </button>
                    )}
                    {d.priceCoins == null && d.priceGems == null && <span className="shop-muted">Indisponível</span>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
