import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { listServerStickers, createServerSticker, updateServerSticker, deleteServerSticker, listAssetCollections, createAssetCollection, updateAssetCollection, deleteAssetCollection } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import { usePromptDialog } from '../../utils/usePromptDialog.jsx';
import cancelIcon from '../../assets/icons/cancel.png';

const NAME_RE = /^[a-zA-Z0-9_ ]{2,32}$/;
const MAX_MB = 5;

// Item pedido: "sistema de figurinhas... podendo criar no painel da
// staff" — mesmo padrão visual/UX de EmojiManagerModal.jsx, incluindo
// agora o mesmo sistema de coleções dos dois lados (com ícone de
// imagem de verdade, não mais um emoji digitado).
export default function StickerManagerModal({ onClose }) {
  const [stickers, setStickers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [activeCollectionId, setActiveCollectionId] = useState('all');
  const [collectionForm, setCollectionForm] = useState(null);
  const [collectionIconPreview, setCollectionIconPreview] = useState(null);
  const [collectionError, setCollectionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const setServerStickers = useStore((s) => s.setServerStickers);
  const { confirmAsync, DialogElement } = usePromptDialog();

  const refresh = async () => {
    setLoading(true);
    try {
      const [{ stickers }, { collections }] = await Promise.all([listServerStickers(), listAssetCollections('STICKER')]);
      setStickers(stickers);
      setCollections(collections);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Object URLs precisam ser liberadas, senão a pré-visualização vaza
  // memória toda vez que um arquivo diferente é escolhido.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Mesma ideia acima, pro ícone de imagem do formulário de coleção.
  useEffect(() => {
    if (!collectionForm?.iconFile) { setCollectionIconPreview(null); return; }
    const url = URL.createObjectURL(collectionForm.iconFile);
    setCollectionIconPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [collectionForm?.iconFile]);

  const pickFile = (f) => {
    if (!f) return;
    setError('');
    if (f.size > MAX_MB * 1024 * 1024) { setError(`A imagem precisa ter no máximo ${MAX_MB}MB.`); return; }
    setFile(f);
    if (!name.trim()) {
      const base = f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_ ]/g, '_').slice(0, 32);
      if (NAME_RE.test(base)) setName(base);
    }
  };

  const nameError = name.trim().length > 0 && !NAME_RE.test(name.trim());

  const upload = async () => {
    setError('');
    if (!file) { setError('Escolha ou arraste uma imagem.'); return; }
    if (!name.trim()) { setError('Dê um nome à figurinha.'); return; }
    if (!NAME_RE.test(name.trim())) { setError('Nome inválido — use 2 a 32 letras, números, espaços ou "_".'); return; }
    setUploading(true);
    try {
      const collectionId = typeof activeCollectionId === 'string' && activeCollectionId !== 'all' && activeCollectionId !== 'none' ? activeCollectionId : null;
      await createServerSticker(file, name.trim(), collectionId);
      setName(''); setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
      const { stickers: fresh } = await listServerStickers();
      setServerStickers(fresh);
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível enviar a figurinha.');
    } finally {
      setUploading(false);
    }
  };

  const moveToCollection = async (sticker, collectionId) => {
    await updateServerSticker(sticker.id, { collectionId: collectionId || null });
    await refresh();
    const { stickers: fresh } = await listServerStickers();
    setServerStickers(fresh);
  };

  const remove = async (sticker) => {
    if (!(await confirmAsync(`Excluir a figurinha "${sticker.name}"?`))) return;
    await deleteServerSticker(sticker.id);
    await refresh();
    const { stickers: fresh } = await listServerStickers();
    setServerStickers(fresh);
  };

  // BUG CORRIGIDO ("não está dando de criar as coleção"): a validação
  // antes retornava sem avisar nada quando faltava nome ou ícone —
  // agora mostra uma mensagem visível, e qualquer erro do servidor
  // (nome duplicado, etc) também aparece em vez de falhar em silêncio.
  const saveCollection = async () => {
    setCollectionError('');
    if (!collectionForm.name.trim()) { setCollectionError('Dê um nome à coleção.'); return; }
    if (!collectionForm.id && !collectionForm.iconFile) { setCollectionError('Escolha uma imagem pra ser o ícone da coleção.'); return; }
    try {
      if (collectionForm.id) {
        await updateAssetCollection(collectionForm.id, { name: collectionForm.name.trim(), iconFile: collectionForm.iconFile });
      } else {
        await createAssetCollection('STICKER', collectionForm.name.trim(), collectionForm.iconFile);
      }
      setCollectionForm(null);
      await refresh();
    } catch (err) {
      setCollectionError(err?.response?.data?.error || 'Não foi possível salvar a coleção.');
    }
  };

  const removeCollection = async (collection) => {
    if (!(await confirmAsync(`Excluir a coleção "${collection.name}"? As figurinhas dentro dela não são apagadas, só deixam de pertencer a ela.`))) return;
    await deleteAssetCollection(collection.id);
    if (activeCollectionId === collection.id) setActiveCollectionId('all');
    await refresh();
  };

  const visibleStickers = useMemo(() => {
    if (activeCollectionId === 'all') return stickers;
    if (activeCollectionId === 'none') return stickers.filter((s) => !s.collectionId);
    return stickers.filter((s) => s.collectionId === activeCollectionId);
  }, [stickers, activeCollectionId]);

  return (
    <Modal title="Figurinhas da comunidade" onClose={onClose} width="760px">
      {DialogElement}
      <div className="emoji-manager">
        {/* Item pedido: "vai ter a mesma categoria que o emoji normal,
            aquela barra lateral" */}
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
                  clique duplo escondido de antes. */}
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
              <span className="emoji-dropzone-icon">🏷️</span>
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
              placeholder="Nome da figurinha"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              className={nameError ? 'input-error' : ''}
            />
            {nameError && <span className="field-hint error">2-32 letras, números, espaços ou "_"</span>}
          </label>
          <p className="dim" style={{ fontSize: 12 }}>
            {activeCollectionId === 'all' || activeCollectionId === 'none' ? 'Vai entrar sem coleção — clique numa coleção acima antes de enviar pra já entrar nela.' : 'Vai entrar na coleção selecionada acima.'}
          </p>
          <button className="btn-primary emoji-upload-btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Enviando...' : 'Enviar figurinha'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}

        <hr />

        {loading ? (
          <div className="dim">Carregando figurinhas...</div>
        ) : visibleStickers.length === 0 ? (
          <div className="dim">Nenhuma figurinha aqui ainda.</div>
        ) : (
          <div className="emoji-grid sticker-manage-grid">
            {visibleStickers.map((s) => (
              <div key={s.id} className="emoji-manage-item sticker-manage-item">
                <img src={s.url} alt={s.name} title={s.name} />
                <span className="truncate emoji-name-label">{s.name}</span>
                <select
                  value={s.collectionId || ''}
                  onChange={(ev) => moveToCollection(s, ev.target.value)}
                  title="Mudar coleção"
                  className="emoji-category-select"
                >
                  <option value="">Sem coleção</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="icon-btn-small" title="Excluir" onClick={() => remove(s)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
