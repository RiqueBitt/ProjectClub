import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import HubTabs, { ECONOMY_HUB_TABS } from '../components/HubTabs.jsx';
import { PageHero, PillTabs, EmptyState, Skeleton, Toast, Price } from '../components/PagesKit.jsx';
import {
  listCreatorItems, getMyCreatorStuff, submitCreatorItem, buyCreatorItem, reportCreatorItem, withdrawCreatorItem,
} from '../api/fase8';
import { useStore } from '../store/useStore';
import { listUsableEmojis } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import { invalidateCreatorStickers } from '../components/CreatorStickersSection.jsx';
import '../styles/pages-kit.css';
import '../styles/fase8.css';

// Loja dos criadores (Fase 8): criações dos membros (emoji, figurinha e
// moldura) aprovadas pela equipe. Quem cria recebe as moedas da venda
// menos a taxa da plataforma. Regras no servidor (services/creatorShop.js).

const KIND_LABEL = { EMOJI: 'Emoji', STICKER: 'Figurinha', FRAME: 'Moldura' };
const KIND_HINT = {
  EMOJI: 'Imagem quadrada, até 512 KB (PNG/GIF/WebP). O nome vira o código :nome: no chat.',
  STICKER: 'Imagem até 1 MB (PNG/GIF/WebP/JPG). Aparece no seletor de figurinhas de quem comprar.',
  FRAME: 'PNG/GIF/WebP transparente com o centro vazio, até 2 MB. Fica por cima do avatar de quem comprar.',
};
const STATUS_LABEL = { PENDING: 'Em análise', APPROVED: 'À venda', REJECTED: 'Recusada', REMOVED: 'Removida' };
const TABS = [
  { id: 'explorar', label: 'Explorar', icon: 'store' },
  { id: 'enviar', label: 'Enviar criação', icon: 'plus' },
  { id: 'minhas', label: 'Minhas criações', icon: 'user' },
];

function Preview({ item }) {
  return (
    <div className={`cs-preview is-${item.kind.toLowerCase()}`}>
      <span className="cs-kind">{KIND_LABEL[item.kind]}</span>
      {item.kind === 'FRAME' ? (
        <div className="cs-frame-avatar"><span /><img src={item.imageUrl} alt={item.name} loading="lazy" /></div>
      ) : <img src={item.imageUrl} alt={item.name} loading="lazy" />}
    </div>
  );
}

function Explore({ flash, onWallet }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState('novos');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const setUsableEmojis = useStore((s) => s.setUsableEmojis);

  const load = useCallback(() => {
    listCreatorItems({ kind: kind || undefined, sort, q: q.trim() || undefined })
      .then((d) => { setData(d); onWallet(d.coins); })
      .catch(() => setData({ items: [], coins: 0, error: true }));
  }, [kind, sort, q, onWallet]);
  useEffect(() => { const t = window.setTimeout(load, q ? 300 : 0); return () => window.clearTimeout(t); }, [load, q]);

  const buy = async (item) => {
    if (!window.confirm(`Comprar ${KIND_LABEL[item.kind].toLowerCase()} "${item.name}" por ${item.priceCoins} moedas?`)) return;
    setBusy(item.id);
    try {
      const r = await buyCreatorItem(item.id);
      if (r.coins != null) onWallet(r.coins);
      setData((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, owned: true, sales: i.sales + 1 } : i)) }));
      if (item.kind === 'STICKER') invalidateCreatorStickers();
      if (item.kind === 'EMOJI') listUsableEmojis().then((e) => setUsableEmojis(e.emojis)).catch(() => {});
      flash(item.kind === 'FRAME' ? 'Moldura comprada! Equipe na Loja › Inventário ou nas configurações do perfil.'
        : item.kind === 'EMOJI' ? `Emoji comprado! Use :${item.name}: no chat.` : 'Figurinha comprada! Ela já aparece no seletor de figurinhas.');
    } catch (err) {
      flash(err?.response?.data?.error || 'Não foi possível comprar agora.');
    } finally { setBusy(null); }
  };

  const report = async (item) => {
    const reason = window.prompt(`Por que denunciar "${item.name}"?`);
    if (!reason) return;
    try { await reportCreatorItem(item.id, reason); flash('Denúncia enviada. Obrigado! A equipe vai analisar.'); } catch (err) { flash(err?.response?.data?.error || 'Não foi possível denunciar.'); }
  };

  return (
    <>
      <div className="cs-toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo nome…" aria-label="Buscar criações" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="">Tudo</option>
          <option value="EMOJI">Emojis</option>
          <option value="STICKER">Figurinhas</option>
          <option value="FRAME">Molduras</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="novos">Mais novos</option>
          <option value="populares">Mais vendidos</option>
          <option value="preco">Menor preço</option>
        </select>
      </div>
      {!data ? <Skeleton rows={8} height={210} grid /> : data.items.length === 0 ? (
        <EmptyState icon="sparkles" title="Nada por aqui ainda" text="Seja a primeira pessoa a vender uma criação! Envie na aba “Enviar criação”." />
      ) : (
        <div className="cs-grid">
          {data.items.map((item) => (
            <article key={item.id} className="cs-card">
              <Preview item={item} />
              <h4 title={item.name}>{item.kind === 'EMOJI' ? `:${item.name}:` : item.name}</h4>
              <span className="cs-by">por {item.creator?.displayName || 'alguém'} · {item.sales} {item.sales === 1 ? 'venda' : 'vendas'}</span>
              <div className="cs-actions">
                <Price value={item.priceCoins} />
                {item.mine ? <span className="cs-status APPROVED">Sua criação</span>
                  : item.owned ? <span className="cs-status APPROVED">Você tem</span>
                    : <button type="button" className="pet-btn primary" disabled={busy === item.id || data.coins < item.priceCoins} onClick={() => buy(item)}>{busy === item.id ? 'Comprando…' : 'Comprar'}</button>}
              </div>
              {!item.mine && <button type="button" className="cs-report" onClick={() => report(item)}>Denunciar</button>}
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function Submit({ flash, onDone }) {
  const [kind, setKind] = useState('STICKER');
  const [name, setName] = useState('');
  const [price, setPrice] = useState(50);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const fee = Math.ceil((Number(price) || 0) * 0.1);
  const submit = async (e) => {
    e.preventDefault();
    if (!file) { flash('Escolha a imagem da criação.'); return; }
    setBusy(true);
    try {
      await submitCreatorItem({ kind, name, price: Number(price), description, file });
      flash('Criação enviada! A equipe vai analisar e você recebe um aviso.');
      setName(''); setDescription(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onDone();
    } catch (err) {
      flash(err?.response?.data?.error || 'Não foi possível enviar agora.');
    } finally { setBusy(false); }
  };

  return (
    <form className="cs-form" onSubmit={submit}>
      <div className="cs-kinds" role="radiogroup" aria-label="Tipo de criação">
        {Object.keys(KIND_LABEL).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <label>
        Imagem
        <input ref={fileRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <span className="cs-hint">{KIND_HINT[kind]}</span>
      </label>
      {preview && <Preview item={{ kind, name, imageUrl: preview }} />}
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required placeholder={kind === 'EMOJI' ? 'ex.: pinguim_feliz' : 'ex.: Pinguim dançando'} />
      </label>
      <label>
        Preço (moedas)
        <input type="number" min={10} max={5000} step={1} value={price} onChange={(e) => setPrice(e.target.value)} required />
        <span className="cs-hint">Você recebe {Math.max(0, (Number(price) || 0) - fee)} moedas por venda (taxa da plataforma: 10%).</span>
      </label>
      <label>
        Descrição (opcional)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
      </label>
      <p className="cs-hint">Envie só criações suas. Nada de conteúdo impróprio, marcas registradas ou imagens de outras pessoas sem permissão — a equipe recusa ou remove.</p>
      <button type="submit" className="pet-btn primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar para análise'}</button>
    </form>
  );
}

function Mine({ flash, reloadKey }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { getMyCreatorStuff().then(setData).catch(() => setData({ submissions: [], purchases: [], earnings: 0 })); }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  const withdraw = async (item) => {
    if (!window.confirm(`Apagar "${item.name}"?`)) return;
    try { await withdrawCreatorItem(item.id); load(); } catch (err) { flash(err?.response?.data?.error || 'Não foi possível apagar.'); }
  };
  if (!data) return <Skeleton rows={4} />;
  const sold = data.submissions.reduce((s, i) => s + (i.sales || 0), 0);
  return (
    <>
      <div className="cs-earnings">
        <div><b>{data.earnings.toLocaleString('pt-BR')}</b>moedas ganhas</div>
        <div><b>{sold}</b>vendas</div>
        <div><b>{data.submissions.filter((i) => i.status === 'APPROVED').length}</b>à venda</div>
      </div>
      <h3>Minhas criações</h3>
      {data.submissions.length === 0 ? <EmptyState compact icon="sparkles" title="Você ainda não enviou nada" text="Envie um emoji, figurinha ou moldura e ganhe moedas a cada venda." /> : (
        <div className="cs-list">
          {data.submissions.map((i) => (
            <div key={i.id} className="cs-row">
              <img src={i.imageUrl} alt="" loading="lazy" />
              <div className="cs-row-main">
                <span><b>{i.name}</b> · {KIND_LABEL[i.kind]} · {i.priceCoins} moedas</span>
                <span><span className={`cs-status ${i.status}`}>{STATUS_LABEL[i.status] || i.status}</span>{i.status === 'APPROVED' ? ` · ${i.sales} vendas · ${i.earnings} moedas` : ''}</span>
                {i.rejectReason && i.status !== 'APPROVED' && <small>Motivo: {i.rejectReason}</small>}
              </div>
              {i.status !== 'APPROVED' && <div className="cs-row-actions"><button type="button" className="pet-btn danger" onClick={() => withdraw(i)}>Apagar</button></div>}
            </div>
          ))}
        </div>
      )}
      <h3 style={{ marginTop: 18 }}>Comprados</h3>
      {data.purchases.length === 0 ? <EmptyState compact icon="bag" title="Nenhuma compra ainda" /> : (
        <div className="cs-list">
          {data.purchases.map((i) => (
            <div key={i.id} className="cs-row">
              <img src={i.imageUrl} alt="" loading="lazy" />
              <div className="cs-row-main">
                <span><b>{i.kind === 'EMOJI' ? `:${i.name}:` : i.name}</b> · {KIND_LABEL[i.kind]}</span>
                <small>por {i.creator?.displayName || 'alguém'}{i.status !== 'APPROVED' ? ' · removido pela equipe' : ''}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function LojaCriadoresPage() {
  useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'explorar';
  const [coins, setCoins] = useState(null);
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const timer = useRef(0);
  const flash = useCallback((m) => { setToast(m); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setToast(''), 4000); }, []);
  const onWallet = useCallback((c) => setCoins(c), []);
  const go = (id) => setParams(id === 'explorar' ? {} : { aba: id });

  return (
    <div className="pk-page">
      <HubTabs tabs={ECONOMY_HUB_TABS} value="criadores" label="Economia e Loja" />
      <div className="pk-inner">
        <PageHero
          icon="sparkles" eyebrow="Feito pela comunidade" title="Loja dos criadores"
          desc="Emojis, figurinhas e molduras criados pelos membros. Cada compra ajuda quem criou (90% vai pra pessoa)."
          aside={coins != null ? <Price value={coins} /> : null}
        />
        <Toast>{toast}</Toast>
        <PillTabs tabs={TABS} value={tab} onChange={go} label="Seções da Loja dos criadores" className="small" />
        <div style={{ marginTop: 12 }}>
          {tab === 'explorar' && <Explore flash={flash} onWallet={onWallet} />}
          {tab === 'enviar' && <Submit flash={flash} onDone={() => { setReloadKey((k) => k + 1); go('minhas'); }} />}
          {tab === 'minhas' && <Mine flash={flash} reloadKey={reloadKey} />}
        </div>
      </div>
    </div>
  );
}
