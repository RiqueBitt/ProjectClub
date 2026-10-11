import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import DecorationsAdminTab from './DecorationsAdminTab.jsx';
import { Ico } from './PagesKit.jsx';
import { MockProfile, effectValue } from './shop/ShopPreviews.jsx';
import { proxyImage } from '../utils/imageProxy';
import {
  adminListEffects, adminSaveEffect, adminDeleteEffect,
  adminListCollections, adminSaveCollection, adminDeleteCollection,
} from '../api/decorations';
import '../styles/shop.css';

const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';
const priceText = (i) => [i.priceCoins != null && `${i.priceCoins} moedas`, i.priceGems != null && `${i.priceGems} gemas`].filter(Boolean).join(' · ') || 'Sem preço';

// Painel da staff → Loja: sub-abas Molduras / Efeitos de perfil / Coleções.
export default function ShopAdminTab() {
  const [sub, setSub] = useState('molduras');
  const [collections, setCollections] = useState([]);
  const loadCollections = useCallback(() => adminListCollections().then((d) => setCollections(d.items || [])).catch(() => {}), []);
  useEffect(() => { loadCollections(); }, [loadCollections]);
  return (
    <div className="deco-admin">
      <div className="shopadm-tabs" role="tablist">
        {[['molduras', 'Molduras', 'frame'], ['efeitos', 'Efeitos de perfil', 'sparkles'], ['colecoes', 'Coleções', 'grid']].map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} className={sub === id ? 'active' : ''} onClick={() => setSub(id)}>
            <Ico name={icon} size={15} /> {label}
          </button>
        ))}
      </div>
      {sub === 'molduras' && <DecorationsAdminTab collections={collections} />}
      {sub === 'efeitos' && <EffectsAdmin collections={collections} />}
      {sub === 'colecoes' && <CollectionsAdmin items={collections} reload={loadCollections} />}
    </div>
  );
}

// ---------- Efeitos de perfil ----------
const FX_EMPTY = {
  name: '', priceCoins: '800', priceGems: '', collectionId: '', active: true, sortOrder: 0,
  scale: 1, offsetX: 0, offsetY: 0, opacity: 0.85, duration: 4,
  mScale: 1, mOffsetX: 0, mOffsetY: 0, mOpacity: 0.85, mDuration: 4,
};

function EffectsAdmin({ collections }) {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(FX_EMPTY);
  const [mode, setMode] = useState('d'); // d = computador, m = celular
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => adminListEffects().then((d) => setItems(d.items)).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const current = useMemo(() => (items || []).find((d) => d.id === editing), [items, editing]);
  const imageUrl = fileUrl || current?.imageUrl || '';
  const fx = imageUrl ? effectValue({ ...form, id: 'preview', imageUrl }) : null;

  const start = (d) => {
    setError(''); setFile(null); setFileUrl(''); setMode('d');
    if (!d) { setEditing('new'); setForm(FX_EMPTY); return; }
    setEditing(d.id);
    const f = {};
    Object.keys(FX_EMPTY).forEach((k) => { f[k] = d[k] ?? FX_EMPTY[k]; });
    f.priceCoins = d.priceCoins ?? ''; f.priceGems = d.priceGems ?? ''; f.collectionId = d.collectionId || '';
    setForm(f);
  };
  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setFileUrl(URL.createObjectURL(f));
  };
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setNum = (k) => (e) => setForm((s) => ({ ...s, [k]: Number(e.target.value) }));
  const k = (n) => (mode === 'm' ? `m${n[0].toUpperCase()}${n.slice(1)}` : n);

  const save = async () => {
    if (!form.name.trim()) { setError('Dê um nome pro efeito.'); return; }
    if (editing === 'new' && !file) { setError('Escolha a animação (GIF, WebP ou PNG animado, com fundo transparente).'); return; }
    setSaving(true); setError('');
    try {
      await adminSaveEffect(editing === 'new' ? null : editing, form, file);
      setEditing(null); setFile(null); setFileUrl('');
      await load();
    } catch (e) { setError(errMsg(e)); }
    setSaving(false);
  };
  const remove = async (d) => {
    if (!window.confirm(`Excluir "${d.name}"? Quem comprou perde o efeito.`)) return;
    try { await adminDeleteEffect(d.id); await load(); } catch (e) { setError(errMsg(e)); }
  };
  const copyOther = () => setForm((s) => {
    const from = mode === 'm' ? '' : 'm';
    const to = mode === 'm' ? 'm' : '';
    const n = { ...s };
    ['scale', 'offsetX', 'offsetY', 'opacity', 'duration'].forEach((x) => {
      const src = from ? `m${x[0].toUpperCase()}${x.slice(1)}` : x;
      const dst = to ? `m${x[0].toUpperCase()}${x.slice(1)}` : x;
      n[dst] = s[src];
    });
    return n;
  });

  if (editing) {
    return (
      <>
        {error && <div className="shop-notice bad">{error}</div>}
        <div className="fx-editor">
          <div className="fx-previews">
            <div className="fx-mode" role="tablist" aria-label="Ajuste para">
              <button type="button" className={mode === 'd' ? 'active' : ''} onClick={() => setMode('d')}>Computador</button>
              <button type="button" className={mode === 'm' ? 'active' : ''} onClick={() => setMode('m')}>Celular</button>
            </div>
            {!fx && <p className="shop-muted">Escolha a animação pra ver a prévia.</p>}
            {fx && mode === 'd' && (
              <>
                <span className="fx-preview-label">Perfil completo (computador)</span>
                <MockProfile user={user} effect={fx} size="mini" wide mobile={false} />
                <span className="fx-preview-label">Mini perfil</span>
                <div className="fx-previews-row"><MockProfile user={user} effect={fx} size="mini" mobile={false} /></div>
              </>
            )}
            {fx && mode === 'm' && (
              <>
                <span className="fx-preview-label">Celular (390px)</span>
                <PhoneFrame><MockProfile user={user} effect={fx} size="phone" mobile /></PhoneFrame>
              </>
            )}
            <small className="shop-muted">A prévia repete sem parar; no perfil de verdade aparece ao abrir e depois a cada 30 segundos.</small>
          </div>
          <div className="deco-form">
            <label>Nome<input value={form.name} onChange={set('name')} maxLength={60} placeholder="Ex.: Chuva de estrelas" /></label>
            <label>Animação (GIF, WebP ou PNG animado, fundo transparente)
              <input type="file" accept="image/png,image/gif,image/webp" onChange={pick} />
            </label>
            <div className="deco-row">
              <label>Preço em moedas<input type="number" min="0" value={form.priceCoins} onChange={set('priceCoins')} placeholder="vazio = não vende" /></label>
              <label>Preço em gemas<input type="number" min="0" value={form.priceGems} onChange={set('priceGems')} placeholder="vazio = não vende" /></label>
            </div>
            <label>Coleção
              <select value={form.collectionId} onChange={set('collectionId')}>
                <option value="">Nenhuma</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <span className="fx-preview-label">Ajuste no {mode === 'm' ? 'celular' : 'computador'}</span>
            <label>Tamanho: {Math.round(form[k('scale')] * 100)}%<input type="range" min="0.3" max="3" step="0.01" value={form[k('scale')]} onChange={setNum(k('scale'))} /></label>
            <label>Posição horizontal: {form[k('offsetX')]}%<input type="range" min="-100" max="100" step="1" value={form[k('offsetX')]} onChange={setNum(k('offsetX'))} /></label>
            <label>Posição vertical: {form[k('offsetY')]}%<input type="range" min="-100" max="100" step="1" value={form[k('offsetY')]} onChange={setNum(k('offsetY'))} /></label>
            <label>Opacidade: {Math.round(form[k('opacity')] * 100)}%<input type="range" min="0.1" max="1" step="0.01" value={form[k('opacity')]} onChange={setNum(k('opacity'))} /></label>
            <label>Duração na tela: {form[k('duration')]}s<input type="range" min="1" max="20" step="0.5" value={form[k('duration')]} onChange={setNum(k('duration'))} /></label>
            <div className="deco-row">
              <label>Ordem na loja<input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></label>
              <label className="deco-check"><input type="checkbox" checked={form.active} onChange={set('active')} /> À venda</label>
            </div>
            <div className="deco-actions">
              <button type="button" className="shop-btn ghost" onClick={copyOther}>Copiar do {mode === 'm' ? 'computador' : 'celular'}</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="shop-btn ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="shop-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar efeito'}</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {error && <div className="shop-notice bad">{error}</div>}
      <div className="deco-admin-head"><button type="button" className="shop-btn primary" onClick={() => start(null)}>Novo efeito</button></div>
      {!items ? <p className="shop-muted">Carregando…</p> : items.length === 0 ? <p className="shop-muted">Nenhum efeito criado ainda.</p> : (
        <div className="shop-grid">
          {items.map((d) => (
            <article key={d.id} className={`shop-card${d.active ? '' : ' off'}`}>
              <div className="shop-card-art"><MockProfile user={user} effect={effectValue(d)} /></div>
              <h3>{d.name}</h3>
              <small className="shop-muted">{priceText(d)} · {d._count?.owners || 0} compras{d.active ? '' : ' · fora da loja'}</small>
              <div className="shop-prices">
                <button type="button" className="shop-btn ghost" onClick={() => start(d)}>Editar</button>
                <button type="button" className="shop-btn danger" onClick={() => remove(d)}>Excluir</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// Celular sempre com 390px de largura de verdade, encolhido pra caber.
function PhoneFrame({ children }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / 390)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="fx-phone-wrap" style={{ height: 640 * scale }}>
      <div style={{ width: 390, height: 640, transform: `scale(${scale})`, transformOrigin: 'top center', flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ---------- Coleções ----------
const COL_EMPTY = { name: '', description: '', accentColor: '#5865f2', active: true, featured: true, sortOrder: 0, bundlePriceCoins: '', bundlePriceGems: '', removeLogo: false };

function CollectionsAdmin({ items, reload }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(COL_EMPTY);
  const [files, setFiles] = useState({ banner: null, logo: null });
  const [urls, setUrls] = useState({ banner: '', logo: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = items.find((c) => c.id === editing);

  const start = (c) => {
    setError(''); setFiles({ banner: null, logo: null }); setUrls({ banner: '', logo: '' });
    if (!c) { setEditing('new'); setForm(COL_EMPTY); return; }
    setEditing(c.id);
    setForm({
      name: c.name, description: c.description || '', accentColor: c.accentColor || '#5865f2', active: c.active, featured: c.featured,
      sortOrder: c.sortOrder, bundlePriceCoins: c.bundlePriceCoins ?? '', bundlePriceGems: c.bundlePriceGems ?? '', removeLogo: false,
    });
  };
  const pick = (key) => (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFiles((s) => ({ ...s, [key]: f }));
    setUrls((s) => ({ ...s, [key]: URL.createObjectURL(f) }));
    if (key === 'logo') setForm((s) => ({ ...s, removeLogo: false }));
  };
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    if (!form.name.trim()) { setError('Dê um nome pra coleção.'); return; }
    setSaving(true); setError('');
    try {
      await adminSaveCollection(editing === 'new' ? null : editing, form, files);
      setEditing(null);
      await reload();
    } catch (e) { setError(errMsg(e)); }
    setSaving(false);
  };
  const remove = async (c) => {
    if (!window.confirm(`Excluir a coleção "${c.name}"? Os itens continuam na loja, só saem da coleção.`)) return;
    try { await adminDeleteCollection(c.id); await reload(); } catch (e) { setError(errMsg(e)); }
  };

  if (editing) {
    const banner = urls.banner || current?.bannerUrl;
    const logo = form.removeLogo ? '' : (urls.logo || current?.logoUrl);
    return (
      <>
        {error && <div className="shop-notice bad">{error}</div>}
        <div className="fx-editor">
          <div className="fx-previews">
            <span className="fx-preview-label">Prévia do destaque</span>
            <div className="col-admin-banner" style={{ '--col-accent': form.accentColor }}>
              {banner && <img className="bg" src={urls.banner || proxyImage(banner)} alt="" />}
              <div className="shade" />
              <div className="txt">
                {logo ? <img src={urls.logo || proxyImage(logo)} alt="" /> : <strong>{form.name || 'Nome da coleção'}</strong>}
              </div>
            </div>
            <small className="shop-muted">Banner largo (ideal 1500×500). Pra colocar itens na coleção, edite a moldura ou o efeito e escolha a coleção.</small>
          </div>
          <div className="deco-form">
            <label>Nome<input value={form.name} onChange={set('name')} maxLength={60} placeholder="Ex.: Noite estrelada" /></label>
            <label>Descrição<textarea value={form.description} onChange={set('description')} maxLength={400} /></label>
            <label>Banner (imagem larga)<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pick('banner')} /></label>
            <div className="deco-row">
              <label>Logo (opcional, fundo transparente)<input type="file" accept="image/png,image/gif,image/webp" onChange={pick('logo')} /></label>
              <label>Cor de destaque<input type="color" value={form.accentColor} onChange={set('accentColor')} /></label>
            </div>
            {(current?.logoUrl || urls.logo) && (
              <label className="deco-check"><input type="checkbox" checked={form.removeLogo} onChange={set('removeLogo')} /> Remover logo (mostra o nome)</label>
            )}
            <div className="deco-row">
              <label>Pacote em moedas<input type="number" min="0" value={form.bundlePriceCoins} onChange={set('bundlePriceCoins')} placeholder="vazio = sem pacote" /></label>
              <label>Pacote em gemas<input type="number" min="0" value={form.bundlePriceGems} onChange={set('bundlePriceGems')} placeholder="vazio = sem pacote" /></label>
            </div>
            <div className="deco-row">
              <label>Ordem<input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></label>
              <label className="deco-check"><input type="checkbox" checked={form.active} onChange={set('active')} /> Visível na loja</label>
            </div>
            <label className="deco-check"><input type="checkbox" checked={form.featured} onChange={set('featured')} /> Mostrar no carrossel de Destaques</label>
            <div className="deco-actions">
              <span style={{ flex: 1 }} />
              <button type="button" className="shop-btn ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="shop-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar coleção'}</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {error && <div className="shop-notice bad">{error}</div>}
      <div className="deco-admin-head"><button type="button" className="shop-btn primary" onClick={() => start(null)}>Nova coleção</button></div>
      {items.length === 0 ? <p className="shop-muted">Nenhuma coleção criada ainda.</p> : (
        <div className="shop-col-grid">
          {items.map((c) => (
            <div key={c.id} className="shop-card" style={{ padding: 0, opacity: c.active ? 1 : 0.6 }}>
              <div className="col-admin-banner" style={{ '--col-accent': c.accentColor || 'var(--brand)', borderRadius: 0, border: 0 }}>
                {c.bannerUrl && <img className="bg" src={proxyImage(c.bannerUrl)} alt="" />}
                <div className="shade" />
                <div className="txt"><strong>{c.name}</strong></div>
              </div>
              <div className="shop-card-info">
                <small>{(c._count?.decorations || 0) + (c._count?.effects || 0)} itens{c.featured ? ' · em destaque' : ''}{c.active ? '' : ' · oculta'}</small>
                <div className="shop-prices">
                  <button type="button" className="shop-btn ghost" onClick={() => start(c)}>Editar</button>
                  <button type="button" className="shop-btn danger" onClick={() => remove(c)}>Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
