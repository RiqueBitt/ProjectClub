import { useState } from 'react';
import Modal from '../Modal.jsx';
import { createChannel, getCommunity, uploadChannelIcon } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import ChannelTypePicker from '../ChannelTypePicker.jsx';
import ChannelTypeIcon from '../ChannelTypeIcon.jsx';
import IconPickerField, { iconValueFrom } from '../IconPickerField.jsx';
import { cleanChannelName, CHANNEL_NAME_MAX } from '../../utils/channelName';
import '../../styles/channels.css';

const TYPES = ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'RULES'];

export default function CreateChannelModal({ categoryId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('TEXT');
  const [isPrivate, setIsPrivate] = useState(false);
  const [userLimit, setUserLimit] = useState('');
  const [error, setError] = useState('');
  const [icon, setIcon] = useState(() => iconValueFrom(null));
  const [saving, setSaving] = useState(false);
  const isVoiceLike = type === 'VOICE' || type === 'STAGE';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanName = cleanChannelName(name);
    if (!cleanName) { setError('Dê um nome ao canal.'); return; }
    setSaving(true);
    try {
      const { channel } = await createChannel({
        name: cleanName, type, categoryId, isPrivate, userLimit: isVoiceLike ? userLimit : undefined,
        // Emoji (ou emoji personalizado) vai junto; imagem nova sobe logo depois.
        iconEmoji: icon.file ? undefined : (icon.iconEmoji || undefined),
        iconUrl: icon.file || icon.iconEmoji ? undefined : (icon.iconUrl || undefined),
      });
      if (icon.file) await uploadChannelIcon(channel.id, icon.file).catch(() => {});
      // Atualiza na hora, sem esperar o socket channel:new voltar — dá
      // feedback instantâneo pra quem criou; o resto da comunidade recebe
      // pelo socket normalmente.
      const data = await getCommunity().catch(() => null);
      if (data) useStore.getState().setCommunityStructure({ categories: data.categories, channels: data.channels, members: data.members, roles: data.roles });
      onCreated?.(channel);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar canal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form onSubmit={submit} className="auth-form channel-form">
        <label>
          TIPO DE CANAL
          <ChannelTypePicker types={TYPES} value={type} onChange={setType} />
        </label>
        <label>
          NOME DO CANAL
          {/* Nome do jeito que a pessoa escrever: maiúsculas e espaços valem. */}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CHANNEL_NAME_MAX} placeholder="Ex.: Bate-papo geral" required autoFocus />
        </label>
        <IconPickerField value={icon} onChange={setIcon} defaultIcon={<ChannelTypeIcon type={type} className="icon-field-default" />} />
        {isVoiceLike && (
          <label>
            LIMITE DE USUÁRIOS (0 = sem limite)
            <input
              type="number" min="0" max="99" value={userLimit}
              onChange={(e) => setUserLimit(e.target.value)}
              placeholder="Sem limite"
            />
          </label>
        )}
        <label className="checkbox-row">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Canal privado (apenas você tem acesso inicialmente — convide outros nas configurações do canal)
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Criando...' : 'Criar canal'}</button>
      </form>
    </Modal>
  );
}
