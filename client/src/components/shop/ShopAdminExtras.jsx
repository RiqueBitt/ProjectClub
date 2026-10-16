import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { MockProfile, decoValue } from './ShopPreviews.jsx';
import ShopItemFlagsFields, { FLAGS_EMPTY, flagsFrom } from './ShopItemFlagsFields.jsx';
import UserPicker from './UserPicker.jsx';
import {
  adminListShopItems, adminSaveShopItem, adminDeleteShopItem,
  adminShopCatalog, adminGrantItem, adminRevokeItem,
} from '../../api/decorations';
import { nameStyleProps } from '../../utils/nameStyle';
import { proxyImage } from '../../utils/imageProxy';
import { PROFILE_STYLES } from '../../utils/profileStyle';

// Painel da staff → Loja: Fontes do nome, Estilos de perfil e "Dar item".

const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';
const priceText = (i) => [i.priceCoins != null && `${i.priceCoins} moedas`, i.priceGems != null && `${i.priceGems} gemas`].filter(Boolean).join(' · ') || 'Sem preço';
const stockText = (i) => (i.stock != null ? ` · limitado ${i.sold}/${i.stock}` : '');
const fontRaw = (i) => (i?.data?.family ? JSON.stringify({ id: i.id, family: i.data.family, url: i.data.url || null }) : null);
const styleKey = (i) => i?.data?.style || (i?.key || '').replace(/^style:/, '');

function useItems(kind) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = () => adminListShopItems(kind).then((d) => setItems(d.items || [])).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);
  return { items, error, setError, load };
}

// Campos comuns de preço/coleção/ordem/ativo.
function CommonFields({ form, set, collections }) {
  return (
    <>
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
      <ShopItemFlagsFields form={form} set={set} />
      <div className="deco-row">
        <label>Ordem na loja<input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></label>
        <label className="deco-check"><input type="checkbox" checked={form.active} onChange={set('active')} /> Ativo (aparece na Loja)</label>
      </div>
    </>
  );
}

const BASE = { name: '', priceCoins: '', priceGems: '', collectionId: '', active: true, sortOrder: 0, ...FLAGS_EMPTY };
function formFrom(d, extra = {}) {
  return {
    ...BASE, ...extra, name: d.name || '', priceCoins: d.priceCoins ?? '', priceGems: d.priceGems ?? '',
    collectionId: d.collectionId || '', active: !!d.active, sortOrder: d.sortOrder || 0, ...flagsFrom(d),
  };
}
const setter = (setForm) => (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

// ---------- Fontes do nome ----------
export function FontsAdmin({ collections }) {
  const { user } = useAuth();
  const { items, error, setError, load } = useItems('FONT');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BASE);
  const [fontFile, setFontFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = setter(setForm);
  const current = useMemo(() => (items || []).find((d) => d.id === editing), [items, editing]);

  const start = (d) => {
    setError(''); setFontFile(null); setPreview(null);
    if (!d) { setEditing('new'); setForm({ ...BASE, priceCoins: '600', family: '' }); return; }
    setEditing(d.id);
    setForm(formFrom(d, { family: d.data?.source === 'file' ? '' : d.data?.family || '' }));
  };
  const save = async () => {
    if (!form.name.trim()) { setError('Dê um nome pra fonte.'); return; }
    if (editing === 'new' && !fontFile && !form.family.trim()) { setError('Escreva o nome da fonte do Google Fonts ou envie o arquivo da fonte.'); return; }
    setSaving(true); setError('');
    try {
      const fields = { ...form, kind: 'FONT' };
      delete fields.sold;
      if (editing !== 'new' && !form.family.trim()) delete fields.family;
      await adminSaveShopItem(editing === 'new' ? null : editing, fields, { font: fontFile, preview });
      setEditing(null); await load();
    } catch (e) { setError(errMsg(e)); }
    setSaving(false);
  };
  const remove = async (d) => {
    if (!window.confirm(`Excluir a fonte "${d.name}"? Quem comprou perde a fonte.`)) return;
    try { await adminDeleteShopItem(d.id); await load(); } catch (e) { setError(errMsg(e)); }
  };
  // Prévia: Google Fonts pela família digitada; arquivo novo só depois de salvar.
  const previewFont = form.family?.trim() ? JSON.stringify({ id: `pv-${form.family}`, family: form.family.trim() }) : fontRaw(current);

  if (editing) {
    return (
      <>
        {error && <div className="shop-notice bad">{error}</div>}
        <div className="fx-editor">
          <div className="fx-previews">
            <span className="fx-preview-label">Prévia do nome</span>
            <div className="shopadm-font-preview">
              <strong style={nameStyleProps({ ...user, profileFont: previewFont })}>{user?.displayName || 'Seu nome'}</strong>
              <small style={nameStyleProps({ profileFont: previewFont })}>Aa Bb Cc Çç Ãã 0123456789</small>
            </div>
            <span className="fx-preview-label">Mini perfil</span>
            <MockProfile user={{ ...user, profileFont: previewFont }} size="mini" />
            {fontFile && <small className="shop-muted">Fonte por arquivo: a prévia aparece depois de salvar.</small>}
          </div>
          <div className="deco-form">
            <label>Nome na Loja<input value={form.name} onChange={set('name')} maxLength={60} placeholder="Ex.: Assombrada Deluxe" /></label>
            <label>Fonte do Google Fonts (nome exato)
              <input value={form.family} onChange={set('family')} maxLength={60} placeholder="Ex.: Creepster, Bungee Spice, Nosifer" />
            </label>
            <small className="shop-muted">Procure em fonts.google.com e copie o nome. Ou envie um arquivo abaixo (vale o arquivo).</small>
            <label>Ou arquivo da fonte (.woff2, .woff, .ttf, .otf)
              <input type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" onChange={(e) => setFontFile(e.target.files?.[0] || null)} />
            </label>
            {current?.data?.source === 'file' && !fontFile && <small className="shop-muted">Usando o arquivo enviado antes.</small>}
            <label>Imagem de prévia (opcional)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setPreview(e.target.files?.[0] || null)} /></label>
            <CommonFields form={form} set={set} collections={collections} />
            <div className="deco-actions">
              <span style={{ flex: 1 }} />
              <button type="button" className="shop-btn ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="shop-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar fonte'}</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {error && <div className="shop-notice bad">{error}</div>}
      <div className="deco-admin-head"><button type="button" className="shop-btn primary" onClick={() => start(null)}>Nova fonte</button></div>
      {!items ? <p className="shop-muted">Carregando…</p> : items.length === 0 ? <p className="shop-muted">Nenhuma fonte criada ainda.</p> : (
        <div className="shop-grid">
          {items.map((d) => (
            <article key={d.id} className={`shop-card${d.active ? '' : ' off'}`}>
              <div className="shop-card-art shopadm-font-card"><span style={nameStyleProps({ profileFont: fontRaw(d) })}>{user?.displayName || 'Seu nome'}</span></div>
              <h3>{d.name}</h3>
              <small className="shop-muted">{d.data?.family}{d.data?.source === 'file' ? ' (arquivo)' : ''} · {priceText(d)} · {d._count?.owners || 0} donos{stockText(d)}{d.active ? '' : ' · fora da loja'}</small>
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

// ---------- Estilos de perfil ----------
export function StylesAdmin({ collections }) {
  const { user } = useAuth();
  const { items, error, setError, load } = useItems('STYLE');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BASE);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = setter(setForm);
  const current = useMemo(() => (items || []).find((d) => d.id === editing), [items, editing]);

  const start = (d) => { setError(''); setPreview(null); setEditing(d.id); setForm(formFrom(d)); };
  const save = async () => {
    if (!form.name.trim()) { setError('Dê um nome pro estilo.'); return; }
    setSaving(true); setError('');
    try {
      const fields = { ...form };
      delete fields.sold;
      await adminSaveShopItem(editing, fields, { preview });
      setEditing(null); await load();
    } catch (e) { setError(errMsg(e)); }
    setSaving(false);
  };
  const [msg, setMsg] = useState('');
  const quickToggle = async (d) => {
    try {
      await adminSaveShopItem(d.id, { active: !d.active });
      setMsg(d.active ? `"${d.name}" saiu da Loja.` : `"${d.name}" está à venda na Loja.`);
      await load();
    } catch (e) { setError(errMsg(e)); }
  };

  if (editing && current) {
    const key = styleKey(current);
    return (
      <>
        {error && <div className="shop-notice bad">{error}</div>}
        <div className="fx-editor">
          <div className="fx-previews">
            <span className="fx-preview-label">Perfil completo</span>
            <MockProfile user={user} style={key} size="mini" wide />
            <span className="fx-preview-label">Mini perfil</span>
            <div className="fx-previews-row"><MockProfile user={user} style={key} size="mini" /></div>
          </div>
          <div className="deco-form">
            <label>Nome na Loja<input value={form.name} onChange={set('name')} maxLength={60} /></label>
            <small className="shop-muted">Estilo: {PROFILE_STYLES[key] || key}. O visual (cores, botões, barras) é fixo; aqui você escolhe como ele é vendido.</small>
            <label>Imagem de prévia (opcional)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setPreview(e.target.files?.[0] || null)} /></label>
            <CommonFields form={form} set={set} collections={collections} />
            <div className="deco-actions">
              <span style={{ flex: 1 }} />
              <button type="button" className="shop-btn ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="shop-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar estilo'}</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {error && <div className="shop-notice bad">{error}</div>}
      {msg && <div className="shop-notice">{msg}</div>}
      <p className="shop-muted">Os estilos começam desativados (não aparecem na Loja). Mude o preço, a coleção e o estoque direto no cartão e clique em Salvar; depois em "Ativar na Loja".</p>
      {!items ? <p className="shop-muted">Carregando…</p> : (
        <div className="shop-grid">
          {items.map((d) => (
            <article key={d.id} className={`shop-card${d.active ? '' : ' off'}`}>
              <div className="shop-card-art"><MockProfile user={user} style={styleKey(d)} /></div>
              <h3>{d.name}</h3>
              <small className="shop-muted">{priceText(d)} · {d._count?.owners || 0} donos{stockText(d)} · {d.active ? 'na Loja' : 'desativado'}</small>
              <QuickStyleEdit item={d} collections={collections} onSaved={(m) => { setMsg(m); load(); }} onError={setError} />
              <div className="shop-prices">
                <button type="button" className="shop-btn ghost" onClick={() => start(d)}>Mais opções</button>
                <button type="button" className={`shop-btn ${d.active ? 'danger' : 'primary'}`} onClick={() => quickToggle(d)}>{d.active ? 'Tirar da Loja' : 'Ativar na Loja'}</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// Edição rápida no próprio cartão: preço, coleção e estoque.
function QuickStyleEdit({ item, collections, onSaved, onError }) {
  const [f, setF] = useState(() => ({ priceCoins: item.priceCoins ?? '', priceGems: item.priceGems ?? '', collectionId: item.collectionId || '', stock: item.stock ?? '' }));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ priceCoins: item.priceCoins ?? '', priceGems: item.priceGems ?? '', collectionId: item.collectionId || '', stock: item.stock ?? '' }); }, [item]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const dirty = String(f.priceCoins) !== String(item.priceCoins ?? '') || String(f.priceGems) !== String(item.priceGems ?? '')
    || f.collectionId !== (item.collectionId || '') || String(f.stock) !== String(item.stock ?? '');
  const save = async () => {
    setBusy(true);
    try { await adminSaveShopItem(item.id, f); onSaved(`"${item.name}" salvo.`); } catch (e) { onError(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="shopadm-quick">
      <label><span><Ico name="coin" size={13} /> Moedas</span><input type="number" min="0" inputMode="numeric" value={f.priceCoins} onChange={set('priceCoins')} placeholder="não vende" /></label>
      <label><span><Ico name="gem" size={13} /> Gemas</span><input type="number" min="0" inputMode="numeric" value={f.priceGems} onChange={set('priceGems')} placeholder="não vende" /></label>
      <label className="wide"><span>Coleção</span>
        <select value={f.collectionId} onChange={set('collectionId')}>
          <option value="">Nenhuma</option>
          {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label><span>Estoque</span><input type="number" min="0" inputMode="numeric" value={f.stock} onChange={set('stock')} placeholder="ilimitado" /></label>
      <button type="button" className="shop-btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvando…' : dirty ? 'Salvar' : 'Salvo'}</button>
    </div>
  );
}

// ---------- Dar item a alguém ----------
const KIND_LABEL = { deco: 'Moldura', effect: 'Efeito', font: 'Fonte', style: 'Estilo' };

function CatalogArt({ item, user }) {
  if (item.kind === 'deco') return <UserAvatar user={{ ...user, avatarDecoration: decoValue(item) }} size={40} />;
  if (item.kind === 'effect') return <img src={proxyImage(item.imageUrl)} alt="" />;
  if (item.kind === 'font') return <span style={nameStyleProps({ profileFont: fontRaw(item) })}>Aa</span>;
  return <Ico name="palette" size={20} />;
}

export function GrantItemsAdmin() {
  const { user: me } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [kind, setKind] = useState('all');
  const [iq, setIq] = useState('');
  const [item, setItem] = useState(null);
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { adminShopCatalog().then((d) => setCatalog(d.items || [])).catch((e) => setMsg({ bad: true, text: errMsg(e) })); }, []);
  const list = (catalog || []).filter((i) => (kind === 'all' || i.kind === kind) && (!iq.trim() || i.name.toLowerCase().includes(iq.trim().toLowerCase())));
  const soldOut = item && item.stock != null && item.sold >= item.stock;

  const run = async (revoke = false, force = false) => {
    if (!item || !target) return;
    setBusy(true); setMsg(null);
    try {
      const body = { kind: item.kind, itemId: item.id, userId: target.id, note, force };
      if (revoke) {
        if (!window.confirm(`Tirar "${item.name}" de ${target.displayName}?`)) { setBusy(false); return; }
        await adminRevokeItem(body);
        setMsg({ text: `"${item.name}" foi tirado de ${target.displayName}.` });
      } else {
        const r = await adminGrantItem(body);
        setMsg({ text: `${target.displayName} ganhou "${item.name}"${r.serial ? ` (cópia #${r.serial})` : ''}. Ela recebeu um aviso.` });
        setNote('');
      }
      adminShopCatalog().then((d) => setCatalog(d.items || [])).catch(() => {});
    } catch (e) {
      const code = e?.response?.data?.code;
      if (code === 'SOLD_OUT' && !force && window.confirm('Esse limitado está esgotado. Criar uma cópia extra (aumenta o estoque em 1) pra dar mesmo assim?')) { setBusy(false); run(false, true); return; }
      setMsg({ bad: true, text: errMsg(e) });
    }
    setBusy(false);
  };

  return (
    <div className="shopadm-grant">
      <p className="shop-muted">Escolha qualquer item da Loja (inclusive desativados) e quem vai ganhar. Não cobra nada; a pessoa recebe um aviso e tudo fica no histórico da staff.</p>
      {msg && <div className={`shop-notice${msg.bad ? ' bad' : ''}`}>{msg.text}</div>}
      <div className="shopadm-grant-cols">
        <section>
          <h4>1. Item</h4>
          <div className="deco-row">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Todos os tipos</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}s</option>)}
            </select>
            <input value={iq} onChange={(e) => setIq(e.target.value)} placeholder="Buscar item" />
          </div>
          <div className="shopadm-grant-list">
            {!catalog ? <p className="shop-muted">Carregando…</p> : list.length === 0 ? <p className="shop-muted">Nenhum item.</p> : list.map((i) => (
              <button key={`${i.kind}:${i.id}`} type="button" className={item?.id === i.id && item?.kind === i.kind ? 'on' : ''} onClick={() => setItem(i)}>
                <span className="shopadm-grant-art"><CatalogArt item={i} user={me} /></span>
                <span className="shopadm-grant-name"><b>{i.name}</b><small>{KIND_LABEL[i.kind]}{i.stock != null ? ` · limitado ${i.sold}/${i.stock}` : ''}{i.active ? '' : ' · desativado'}</small></span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h4>2. Quem ganha</h4>
          <UserPicker value={target} onChange={setTarget} includeSelf />
          <label>Mensagem no aviso (opcional)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Ex.: Prêmio do evento de Halloween" /></label>
          <div className="shopadm-grant-summary">
            {item && target ? <>Dar <b>{item.name}</b> ({KIND_LABEL[item.kind]}) para <b>{target.displayName}</b>{soldOut ? ' — esgotado, vai pedir confirmação' : ''}</> : 'Escolha o item e a pessoa.'}
          </div>
          <div className="deco-actions">
            <button type="button" className="shop-btn danger" disabled={!item || !target || busy} onClick={() => run(true)}>Tirar item</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="shop-btn primary" disabled={!item || !target || busy} onClick={() => run(false)}><Ico name="gift" size={15} /> {busy ? 'Enviando…' : 'Dar item'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}

