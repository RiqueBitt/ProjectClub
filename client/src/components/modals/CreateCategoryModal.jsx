import { useState } from 'react';
import Modal from '../Modal.jsx';
import { createCategory, uploadCategoryIcon, getCommunity } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import IconPickerField, { iconValueFrom } from '../IconPickerField.jsx';
import { cleanChannelName, CHANNEL_NAME_MAX } from '../../utils/channelName';
import '../../styles/channels.css';

// Criar categoria (antes era um prompt() do navegador): nome livre
// (maiúsculas e espaços valem) e ícone opcional.
export default function CreateCategoryModal({ onClose }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(() => iconValueFrom(null));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const cleanName = cleanChannelName(name);
    if (!cleanName) { setError('Dê um nome à categoria.'); return; }
    setSaving(true);
    setError('');
    try {
      const { category } = await createCategory({
        name: cleanName,
        iconEmoji: icon.file ? undefined : (icon.iconEmoji || undefined),
        iconUrl: icon.file || icon.iconEmoji ? undefined : (icon.iconUrl || undefined),
      });
      if (icon.file) await uploadCategoryIcon(category.id, icon.file).catch(() => {});
      // Atualiza na hora, sem esperar o socket voltar.
      const data = await getCommunity().catch(() => null);
      if (data) useStore.getState().setCommunityStructure({ categories: data.categories, channels: data.channels });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível criar a categoria.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Criar categoria" onClose={onClose} width="480px">
      <form onSubmit={submit} className="auth-form channel-form">
        <label>
          NOME DA CATEGORIA
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CHANNEL_NAME_MAX} placeholder="Ex.: Canais de Voz" required autoFocus />
        </label>
        <IconPickerField value={icon} onChange={setIcon} hint="Aparece ao lado do nome da categoria. Emoji ou imagem PNG, GIF ou WebP de até 1 MB." />
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Criando...' : 'Criar categoria'}</button>
      </form>
    </Modal>
  );
}
