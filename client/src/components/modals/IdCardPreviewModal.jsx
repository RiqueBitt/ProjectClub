import { useState } from 'react';
import Modal from '../Modal.jsx';
import { uploadIdCard } from '../../api/endpoints';

// Shown right after picking a file for the "Placa de identificação" (see
// User.idCardUrl) — a quick "here's how it'll look, keep it?" step before
// actually uploading, since this shows in your own sidebar all the time
// and picking the wrong file/frame of a GIF isn't something you want to
// only notice after the fact.
export default function IdCardPreviewModal({ file, onClose, onSaved }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const previewUrl = URL.createObjectURL(file);

  const confirm = async () => {
    setUploading(true);
    setError('');
    try {
      const { user } = await uploadIdCard(file);
      onSaved(user);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar a placa de identificação.');
      setUploading(false);
    }
  };

  return (
    <Modal title="Selecionar placa de identificação" onClose={onClose} width="380px">
      <div className="id-card-preview-wrap">
        <img src={previewUrl} alt="" className="id-card-preview-img" />
        <p className="dim">É assim que sua placa vai aparecer no fundo da sua linha, na lista de membros de qualquer servidor — outras pessoas também vão ver essa imagem ali.</p>
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn-link" onClick={onClose} disabled={uploading}>Cancelar</button>
          <button className="btn-primary" onClick={confirm} disabled={uploading}>{uploading ? 'Enviando...' : 'Usar esta imagem'}</button>
        </div>
      </div>
    </Modal>
  );
}
