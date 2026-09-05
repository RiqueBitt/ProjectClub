import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { listServerStickers, createServerSticker, deleteServerSticker } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import { usePromptDialog } from '../../utils/usePromptDialog.jsx';
import cancelIcon from '../../assets/icons/cancel.png';

const NAME_RE = /^[a-zA-Z0-9_ ]{2,32}$/;
const MAX_MB = 5;

// Item pedido: "sistema de figurinhas... podendo criar no painel da
// staff" — mesmo padrão visual/UX de EmojiManagerModal.jsx, mas mais
// simples (o modelo Sticker só tem nome/imagem — sem categoria nem
// restrição por cargo, diferente de emoji).
export default function StickerManagerModal({ onClose }) {
  const [stickers, setStickers] = useState([]);
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
      const { stickers } = await listServerStickers();
      setStickers(stickers);
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
      await createServerSticker(file, name.trim());
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

  const remove = async (sticker) => {
    if (!(await confirmAsync(`Excluir a figurinha "${sticker.name}"?`))) return;
    await deleteServerSticker(sticker.id);
    await refresh();
    const { stickers: fresh } = await listServerStickers();
    setServerStickers(fresh);
  };

  return (
    <Modal title="Figurinhas da comunidade" onClose={onClose} width="700px">
      {DialogElement}
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
          <button className="btn-primary emoji-upload-btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Enviando...' : 'Enviar figurinha'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}

        <hr />

        {loading ? (
          <div className="dim">Carregando figurinhas...</div>
        ) : stickers.length === 0 ? (
          <div className="dim">Nenhuma figurinha personalizada ainda.</div>
        ) : (
          <div className="emoji-grid sticker-manage-grid">
            {stickers.map((s) => (
              <div key={s.id} className="emoji-manage-item sticker-manage-item">
                <img src={s.url} alt={s.name} title={s.name} />
                <span className="truncate emoji-name-label">{s.name}</span>
                <button className="icon-btn-small" title="Excluir" onClick={() => remove(s)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
