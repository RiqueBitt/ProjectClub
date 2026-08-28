import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { listEmojis, createEmoji, updateEmoji, deleteEmoji, listUsableEmojis } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import cancelIcon from '../../assets/icons/cancel.png';

const NAME_RE = /^[a-zA-Z0-9_]{2,32}$/;
const MAX_MB = 5;

export default function EmojiManagerModal({ onClose }) {
  const [emojis, setEmojis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Geral');
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

  const existingCategories = useMemo(
    () => [...new Set(emojis.map((e) => e.category).filter(Boolean))],
    [emojis],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      const { emojis } = await listEmojis();
      setEmojis(emojis);
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
      await createEmoji(file, { name: name.trim(), category: category.trim() || 'Geral' });
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

  const recategorize = async (emoji, next) => {
    await updateEmoji(emoji.id, { category: (next || '').trim() || 'Geral' });
    await refresh();
  };

  const setAllowedRole = async (emoji, roleId) => {
    await updateEmoji(emoji.id, { allowedRoleId: roleId || null });
    await refresh(); await refreshUsable();
  };

  const remove = async (emoji) => {
    if (!confirm(`Excluir o emoji :${emoji.name}:?`)) return;
    await deleteEmoji(emoji.id);
    await refresh(); await refreshUsable();
  };

  const grouped = emojis.reduce((acc, e) => { (acc[e.category] ||= []).push(e); return acc; }, {});

  return (
    <Modal title="Emojis da comunidade" onClose={onClose} width="700px">
      <div className="emoji-manager">
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
          <label>
            CATEGORIA
            <input
              placeholder="Geral"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              maxLength={24}
              list="emoji-category-suggestions"
            />
            <datalist id="emoji-category-suggestions">
              {existingCategories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <button className="btn-primary emoji-upload-btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Enviando...' : 'Enviar emoji'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}

        <hr />

        {loading ? (
          <div className="dim">Carregando emojis...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="dim">Nenhum emoji personalizado ainda.</div>
        ) : (
          Object.entries(grouped).map(([cat, list]) => (
            <div key={cat} className="emoji-category-block">
              <div className="permission-group-label">{cat.toUpperCase()} — {list.length}</div>
              <div className="emoji-grid">
                {list.map((e) => (
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
                      value={e.category}
                      onChange={(ev) => recategorize(e, ev.target.value)}
                      title="Mudar categoria"
                      className="emoji-category-select"
                    >
                      {[...new Set([e.category, ...existingCategories, 'Geral'])].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="icon-btn-small" title="Excluir" onClick={() => remove(e)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
