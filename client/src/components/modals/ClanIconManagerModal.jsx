import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { listClanIcons, createClanIcon, deleteClanIcon } from '../../api/endpoints';
import { proxyImage } from '../../utils/imageProxy';
import { usePromptDialog } from '../../utils/usePromptDialog.jsx';
import cancelIcon from '../../assets/icons/cancel.png';

const MAX_MB = 5;

// Item pedido: "ícones personalizados [de clã]... criados através do
// Painel da Staff... definir o nome... disponibilizar pros usuários"
// — mesmo padrão de EmojiManagerModal.jsx, mais simples (sem coleção
// nem permissão por cargo — todo mundo que cria um clã pode usar
// qualquer ícone já disponibilizado).
export default function ClanIconManagerModal({ onClose }) {
  const [icons, setIcons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { confirmAsync, DialogElement } = usePromptDialog();

  const refresh = async () => {
    setLoading(true);
    try {
      const { icons } = await listClanIcons();
      setIcons(icons);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

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
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32));
  };

  const upload = async () => {
    setError('');
    if (!file) { setError('Escolha ou arraste uma imagem.'); return; }
    if (!name.trim()) { setError('Dê um nome ao ícone.'); return; }
    setUploading(true);
    try {
      await createClanIcon(file, name.trim());
      setName(''); setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível enviar o ícone.');
    } finally {
      setUploading(false);
    }
  };

  const remove = async (icon) => {
    if (!(await confirmAsync(`Excluir o ícone "${icon.name}"?`))) return;
    await deleteClanIcon(icon.id);
    await refresh();
  };

  return (
    <Modal title="Ícones de clã" onClose={onClose} width="700px">
      {DialogElement}
      <div className="emoji-manager">
        <p className="dim">Ícones criados aqui ficam disponíveis pra qualquer dono escolher ao criar ou editar um clã.</p>
        <div
          className={`emoji-dropzone ${dragOver ? 'drag-over' : ''} ${previewUrl ? 'has-preview' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileInputRef.current?.click()}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="" className="emoji-dropzone-preview" />
          ) : (
            <div className="emoji-dropzone-hint">
              <span className="emoji-dropzone-icon">⚔️</span>
              Arraste uma imagem aqui ou clique para escolher
              <span className="dim">PNG, JPG, GIF ou WEBP · até {MAX_MB}MB</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
        </div>
        <div className="emoji-upload-fields">
          <label>
            NOME
            <input placeholder="Nome do ícone" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          </label>
          <button className="btn-primary emoji-upload-btn" onClick={upload} disabled={uploading}>
            {uploading ? 'Enviando...' : 'Enviar ícone'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <hr />
        {loading ? (
          <div className="dim">Carregando ícones...</div>
        ) : icons.length === 0 ? (
          <div className="dim">Nenhum ícone de clã ainda.</div>
        ) : (
          <div className="emoji-grid">
            {icons.map((icon) => (
              <div key={icon.id} className="emoji-manage-item">
                <img src={proxyImage(icon.url)} alt={icon.name} title={icon.name} />
                <span className="truncate emoji-name-label">{icon.name}</span>
                <button className="icon-btn-small" title="Excluir" onClick={() => remove(icon)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
