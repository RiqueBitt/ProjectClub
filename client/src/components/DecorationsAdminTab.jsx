import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import UserAvatar from './UserAvatar.jsx';
import { adminListDecorations, adminSaveDecoration, adminDeleteDecoration } from '../api/decorations';
import '../styles/shop.css';

const EMPTY = { name: '', priceCoins: '500', priceGems: '', scale: 1.2, offsetX: 0, offsetY: 0, active: true, sortOrder: 0 };
const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';

// Painel da staff → Molduras: cria/edita molduras da Loja com prévia ao
// vivo em 3 tamanhos (chat, lista e perfil) pra acertar a posição.
export default function DecorationsAdminTab() {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => adminListDecorations().then((d) => setItems(d.items)).catch((e) => setError(errMsg(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const current = useMemo(() => (items || []).find((d) => d.id === editing), [items, editing]);
  const imageUrl = fileUrl || current?.imageUrl || '';
  const previewUser = { ...user, avatarDecoration: imageUrl ? { url: imageUrl, s: form.scale, x: form.offsetX, y: form.offsetY } : null };

  const start = (d) => {
    setError(''); setFile(null); setFileUrl('');
    if (!d) { setEditing('new'); setForm(EMPTY); return; }
    setEditing(d.id);
    setForm({
      name: d.name, priceCoins: d.priceCoins ?? '', priceGems: d.priceGems ?? '', scale: d.scale,
      offsetX: d.offsetX, offsetY: d.offsetY, active: d.active, sortOrder: d.sortOrder,
    });
  };
  const pick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setFileUrl(URL.createObjectURL(f));
  };
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setNum = (k) => (e) => setForm((s) => ({ ...s, [k]: Number(e.target.value) }));

  const save = async () => {
    if (!form.name.trim()) { setError('Dê um nome pra moldura.'); return; }
    if (editing === 'new' && !file) { setError('Escolha a imagem da moldura (PNG/GIF/WebP com fundo transparente).'); return; }
    setSaving(true); setError('');
    try {
      await adminSaveDecoration(editing === 'new' ? null : editing, form, file);
      setEditing(null); setFile(null); setFileUrl('');
      await load();
    } catch (e) { setError(errMsg(e)); }
    setSaving(false);
  };
  const remove = async (d) => {
    if (!window.confirm(`Excluir "${d.name}"? Quem comprou perde a moldura.`)) return;
    try { await adminDeleteDecoration(d.id); await load(); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div className="deco-admin">
      {error && <div className="shop-notice bad">{error}</div>}
      {editing ? (
        <div className="deco-editor">
          <div className="deco-editor-preview">
            <div className="deco-sizes">
              <UserAvatar user={previewUser} size={40} />
              <UserAvatar user={previewUser} size={64} />
              <UserAvatar user={previewUser} size={120} />
            </div>
            <small>Prévia nos tamanhos de chat, lista e perfil.</small>
          </div>
          <div className="deco-form">
            <label>Nome<input value={form.name} onChange={set('name')} maxLength={60} placeholder="Ex.: Abóbora" /></label>
            <label>Imagem (PNG, GIF ou WebP, fundo transparente, quadrada)
              <input type="file" accept="image/png,image/gif,image/webp" onChange={pick} />
            </label>
            <div className="deco-row">
              <label>Preço em moedas<input type="number" min="0" value={form.priceCoins} onChange={set('priceCoins')} placeholder="vazio = não vende" /></label>
              <label>Preço em gemas<input type="number" min="0" value={form.priceGems} onChange={set('priceGems')} placeholder="vazio = não vende" /></label>
            </div>
            <label>Tamanho da moldura em volta da foto: {Math.round(form.scale * 100)}%<input type="range" min="0.8" max="2" step="0.01" value={form.scale} onChange={setNum('scale')} /></label>
            <label>Posição horizontal: {form.offsetX}%<input type="range" min="-50" max="50" step="1" value={form.offsetX} onChange={setNum('offsetX')} /></label>
            <label>Posição vertical: {form.offsetY}%<input type="range" min="-50" max="50" step="1" value={form.offsetY} onChange={setNum('offsetY')} /></label>
            <div className="deco-row">
              <label>Ordem na loja<input type="number" value={form.sortOrder} onChange={set('sortOrder')} /></label>
              <label className="deco-check"><input type="checkbox" checked={form.active} onChange={set('active')} /> À venda</label>
            </div>
            <div className="deco-actions">
              <button type="button" className="shop-btn ghost" onClick={() => setForm((s) => ({ ...s, scale: 1.2, offsetX: 0, offsetY: 0 }))}>Centralizar</button>
              <span style={{ flex: 1 }} />
              <button type="button" className="shop-btn ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button type="button" className="shop-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar moldura'}</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="deco-admin-head">
            <button type="button" className="shop-btn primary" onClick={() => start(null)}>Nova moldura</button>
          </div>
          {!items ? <p className="shop-muted">Carregando…</p> : items.length === 0 ? (
            <p className="shop-muted">Nenhuma moldura criada ainda.</p>
          ) : (
            <div className="shop-grid">
              {items.map((d) => (
                <article key={d.id} className={`shop-card${d.active ? '' : ' off'}`}>
                  <div className="shop-card-art">
                    <UserAvatar user={{ ...user, avatarDecoration: { url: d.imageUrl, s: d.scale, x: d.offsetX, y: d.offsetY } }} size={72} />
                  </div>
                  <h3>{d.name}</h3>
                  <small className="shop-muted">
                    {d.priceCoins != null ? `${d.priceCoins} moedas` : ''}{d.priceCoins != null && d.priceGems != null ? ' · ' : ''}{d.priceGems != null ? `${d.priceGems} gemas` : ''}
                    {' · '}{d._count?.owners || 0} compras{d.active ? '' : ' · fora da loja'}
                  </small>
                  <div className="shop-prices">
                    <button type="button" className="shop-btn ghost" onClick={() => start(d)}>Editar</button>
                    <button type="button" className="shop-btn danger" onClick={() => remove(d)}>Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
