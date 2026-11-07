import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { listEmojis, createEmoji, updateEmoji, deleteEmoji, listUsableEmojis, listAssetCollections, createAssetCollection, updateAssetCollection, deleteAssetCollection } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import { usePromptDialog } from '../../utils/usePromptDialog.jsx';
import cancelIcon from '../../assets/icons/cancel.png';

const NAME_RE = /^[a-zA-Z0-9_]{2,32}$/;
const MAX_MB = 5;

export default function EmojiManagerModal({ onClose }) {
  const [emojis, setEmojis] = useState([]);
  const [collections, setCollections] = useState([]);
  const [collectionIconPreview, setCollectionIconPreview] = useState(null);
  const [activeCollectionId, setActiveCollectionId] = useState('all'); // 'all' | null (sem coleção) | id
  const [collectionForm, setCollectionForm] = useState(null); // { id?, name, icon } | null — null = fechado
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const fileInputRef = useRef(null);
  const setUsableEmojis = useStore((s) => s.setUsableEmojis);
  const storeRoles = useStore((s) => s.roles);
  const roles = (storeRoles || []).filter((r) => !r.isDefault);
  const { confirmAsync, DialogElement } = usePromptDialog();

  const refresh = async () => {
    setLoading(true);
    try {
      const [{ emojis }, { collections }] = await Promise.all([listEmojis(), listAssetCollections('EMOJI')]);
      setEmojis(emojis);
      setCollections(collections);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Object URLs need to be released, or the preview thumbnail leaks memory
  // every time a different file is picked.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Mesma ideia acima, pro ícone de imagem escolhido no formulário de
  // coleção — precisa de seu próprio useEffect (não pode reaproveitar
  // o de cima, que já cuida de um arquivo diferente).
  useEffect(() => {
    if (!collectionForm?.iconFile) { setCollectionIconPreview(null); return; }
    const url = URL.createObjectURL(collectionForm.iconFile);
    setCollectionIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [collectionForm?.iconFile]);

  const refreshUsable = () => listUsableEmojis().then((d) => setUsableEmojis(d.emojis)).catch(() => {});

  // Auto-fills the name field from the file's own filename (sanitized to
  // match the server's naming rules) so uploading "party-parrot.gif" doesn't
  // leave the name field empty and force an extra manual step — matches the
  // instinctive "drag file in, it's basically ready" feel this was missing.
  const pickFile = (f) => {
    if (!f) return;
    setError('');
    if (f.size > MAX_MB * 1024 * 1024) { setError(`A imagem precisa ter no máximo ${MAX_MB}MB.`); return; }
    setFile(f);
    if (!name.trim()) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32);
      if (NAME_RE.test(base)) setName(base);
    }
  };

  const nameError = name.trim().length > 0 && !NAME_RE.test(name.trim());

  const upload = async () => {
    setError('');
    if (!file) { setError('Escolha ou arraste uma imagem.'); return; }
    if (!name.trim()) { setError('Dê um nome ao emoji.'); return; }
    if (!NAME_RE.test(name.trim())) { setError('Nome inválido — use 2 a 32 letras, números ou "_".'); return; }
    setUploading(true);
    try {
      const collectionId = typeof activeCollectionId === 'string' && activeCollectionId !== 'all' && activeCollectionId !== 'none' ? activeCollectionId : null;
      await createEmoji(file, { name: name.trim(), collectionId });
      setName(''); setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
      await refreshUsable();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível enviar o emoji.');
    } finally {
      setUploading(false);
    }
  };

  const rename = async (emoji, next) => {
    const trimmed = (next || '').trim();
    if (!trimmed || trimmed === emoji.name) { setEditingId(null); return; }
    if (!NAME_RE.test(trimmed)) {
      useStore.getState().pushNotice('Nome inválido — use 2 a 32 letras, números ou "_".');
      setEditingId(null);
      return;
    }
    await updateEmoji(emoji.id, { name: trimmed }).catch(() => {});
    setEditingId(null);
    await refresh(); await refreshUsable();
  };

  const moveToCollection = async (emoji, collectionId) => {
    await updateEmoji(emoji.id, { collectionId: collectionId || null });
    await refresh();
  };

  const setAllowedRole = async (emoji, roleId) => {
    await updateEmoji(emoji.id, { allowedRoleId: roleId || null });
    await refresh(); await refreshUsable();
  };

  const remove = async (emoji) => {
    if (!(await confirmAsync(`Excluir o emoji :${emoji.name}:?`))) return;
    await deleteEmoji(emoji.id);
    await refresh(); await refreshUsable();
  };

  // Item pedido: "sistema de coleções... o icon/logo das coleções são
  // imagem como .png" — um formulário pequeno reaproveitado tanto pra
  // criar quanto pra editar (collectionForm.id presente = editando
  // uma já existente).
  //
  // BUG CORRIGIDO ("não está dando de criar as coleção"): a validação
  // que checava nome/ícone preenchidos simplesmente RETORNAVA sem
  // fazer nada e sem avisar nada se algo estivesse faltando — clicar
  // em "Criar" parecia não ter efeito nenhum, sem nenhuma pista do
  // motivo. Agora mostra uma mensagem de erro visível nesses casos, e
  // qualquer erro que o servidor devolver (nome duplicado, etc)
  // também aparece, em vez de falhar silenciosamente.
  const [collectionError, setCollectionError] = useState('');
  const saveCollection = async () => {
    setCollectionError('');
    if (!collectionForm.name.trim()) { setCollectionError('Dê um nome à coleção.'); return; }
    if (!collectionForm.id && !collectionForm.iconFile) { setCollectionError('Escolha uma imagem pra ser o ícone da coleção.'); return; }
    try {
      if (collectionForm.id) {
        await updateAssetCollection(collectionForm.id, { name: collectionForm.name.trim(), iconFile: collectionForm.iconFile });
      } else {
        await createAssetCollection('EMOJI', collectionForm.name.trim(), collectionForm.iconFile);
      }
      setCollectionForm(null);
      await refresh();
    } catch (err) {
      setCollectionError(err?.response?.data?.error || 'Não foi possível salvar a coleção.');
    }
  };

  const removeCollection = async (collection) => {
    if (!(await confirmAsync(`Excluir a coleção "${collection.name}"? Os emojis dentro dela não são apagados, só deixam de pertencer a ela.`))) return;
    await deleteAssetCollection(collection.id);
    if (activeCollectionId === collection.id) setActiveCollectionId('all');
    await refresh();
  };

  const visibleEmojis = useMemo(() => {
    if (activeCollectionId === 'all') return emojis;
    if (activeCollectionId === 'none') return emojis.filter((e) => !e.collectionId);
    return emojis.filter((e) => e.collectionId === activeCollectionId);
  }, [emojis, activeCollectionId]);

  return (
    <Modal title="Emojis da comunidade" onClose={onClose} width="760px">
      {DialogElement}
      <div className="emoji-manager">
        {/* Item pedido: "vai ter a mesma categoria que o emoji normal,
            aquela barra lateral" — mesma ideia do rail de categorias
            do EmojiPicker, aqui em formato de linha de chips (o modal
            é mais largo que alto, uma barra lateral de verdade não
            caberia bem). */}
        <div className="asset-collection-rail">
          <button type="button" className={`asset-collection-chip ${activeCollectionId === 'all' ? 'active' : ''}`} onClick={() => setActiveCollectionId('all')}>
            Todos
          </button>
          <button type="button" className={`asset-collection-chip ${activeCollectionId === 'none' ? 'active' : ''}`} onClick={() => setActiveCollectionId('none')}>
            Sem coleção
          </button>
          {collections.map((c) => (
            <div key={c.id} className={`asset-collection-chip-wrap ${activeCollectionId === c.id ? 'active' : ''}`}>
              <button type="button" className="asset-collection-chip" onClick={() => setActiveCollectionId(c.id)}>
                <img src={c.iconUrl} alt="" className="asset-collection-chip-icon" /> {c.name}
              </button>
              {/* Item pedido: "poder apagar categorias e mudar o ícone
                  delas" — botão de editar explícito, em vez de só o
                  clique duplo escondido de antes (mantido como atalho
                  extra, mas ninguém precisa mais adivinhar que ele
                  existe pra conseguir editar ou excluir uma coleção). */}
              <button type="button" className="asset-collection-edit-btn" title="Editar coleção" onClick={() => { setCollectionError(''); setCollectionForm({ id: c.id, name: c.name, iconUrl: c.iconUrl, iconFile: null }); }}>✎</button>
            </div>
          ))}
          <button type="button" className="asset-collection-chip asset-collection-add" onClick={() => { setCollectionError(''); setCollectionForm({ name: '', iconFile: null, iconUrl: null }); }}>
            + Nova coleção
          </button>
        </div>

        {collectionForm && (
          <div className="asset-collection-form">
            <h4>{collectionForm.id ? 'Editar coleção' : 'Nova coleção'}</h4>
            <div className="asset-collection-form-row">
              <label className="asset-collection-icon-picker">
                {(collectionIconPreview || collectionForm.iconUrl) ? (
                  <img src={collectionIconPreview || collectionForm.iconUrl} alt="" />
                ) : (
                  <span className="dim">Ícone</span>
                )}
                <input type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => setCollectionForm({ ...collectionForm, iconFile: e.target.files?.[0] || null })} />
              </label>
              <input placeholder="Nome da coleção" maxLength={32} value={collectionForm.name} onChange={(e) => setCollectionForm({ ...collectionForm, name: e.target.value })} />
            </div>
            {collectionError && <div className="form-error">{collectionError}</div>}
            <div className="asset-collection-form-actions">
              <div className="asset-collection-form-actions-main">
                <button type="button" className="btn-primary" onClick={saveCollection}>{collectionForm.id ? 'Salvar' : 'Criar'}</button>
                <button type="button" className="btn-secondary" onClick={() => setCollectionForm(null)}>Cancelar</button>
              </div>
              {collectionForm.id && (
                <button type="button" className="btn-danger-text" onClick={() => { const c = collections.find((x) => x.id === collectionForm.id); removeCollection(c); setCollectionForm(null); }}>Excluir esta coleção</button>
              )}
            </div>
          </div>
        )}


        <div
          className={`emoji-dropzone ${dragOver ? 'drag-over' : ''} ${previewUrl ? 'has-preview' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="emoji-dropzone-preview" />
          ) : (
            <div className="emoji-dropzone-hint">
              <span className="emoji-dropzone-icon">🖼️</span>
              Arraste uma imagem aqui ou clique para escolher
              <span className="dim">PNG, JPG, GIF ou WEBP · até {MAX_MB}MB</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        <div className="emoji-upload-fields">
          <label>
            NOME
            <input
              placeholder="nome_do_emoji"
              value={name}
              onChange={(e) => setName(e.target.value.replace(/\s+/g, '_'))}
              maxLength={32}
              className={nameError ? 'input-error' : ''}
            />
            {nameError && <span className="field-hint error">2-32 letras, números ou "_"</span>}
          </label>
          <p className="dim" style={{ fontSize: 12 }}>
            {activeCollectionId === 'all' || activeCollectionId === 'none' ? 'Vai entrar sem coleção — clique numa coleção acima antes de enviar pra já entrar nela.' : `Vai entrar na coleção selecionada acima.`}
          </p>
          <button className="btn-primary emoji-upload-btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Enviando...' : 'Enviar emoji'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}

        <hr />

        {loading ? (
          <div className="dim">Carregando emojis...</div>
        ) : visibleEmojis.length === 0 ? (
          <div className="dim">Nenhum emoji aqui ainda.</div>
        ) : (
          <div className="emoji-grid">
            {visibleEmojis.map((e) => (
              <div key={e.id} className="emoji-manage-item">
                <img src={e.url} alt={e.name} title={`:${e.name}:`} />
                {editingId === e.id ? (
                  <input
                    className="emoji-inline-rename"
                    defaultValue={e.name}
                    autoFocus
                    maxLength={32}
                    onBlur={(ev) => rename(e, ev.target.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') ev.target.blur(); if (ev.key === 'Escape') setEditingId(null); }}
                  />
                ) : (
                  <span className="truncate emoji-name-label" title="Clique para renomear" onClick={() => setEditingId(e.id)}>
                    :{e.name}:
                  </span>
                )}
                <select value={e.allowedRoleId || ''} onChange={(ev) => setAllowedRole(e, ev.target.value)} title="Quem pode usar">
                  <option value="">Todos podem usar</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select
                  value={e.collectionId || ''}
                  onChange={(ev) => moveToCollection(e, ev.target.value)}
                  title="Mudar coleção"
                  className="emoji-category-select"
                >
                  <option value="">Sem coleção</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="icon-btn-small" title="Excluir" onClick={() => remove(e)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
