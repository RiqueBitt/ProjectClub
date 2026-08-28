import { useState } from 'react';
import Modal from '../Modal.jsx';
import { createChannel, getCommunity } from '../../api/endpoints';
import { useStore } from '../../store/useStore';
import ChannelTypePicker from '../ChannelTypePicker.jsx';

const TYPES = ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE', 'RULES'];

export default function CreateChannelModal({ categoryId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('TEXT');
  const [isPrivate, setIsPrivate] = useState(false);
  const [userLimit, setUserLimit] = useState('');
  const [error, setError] = useState('');
  const isVoiceLike = type === 'VOICE' || type === 'STAGE';

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const { channel } = await createChannel({ name, type, categoryId, isPrivate, userLimit: isVoiceLike ? userLimit : undefined });
      // Atualiza na hora, sem esperar o socket channel:new voltar — dá
      // feedback instantâneo pra quem criou; o resto da comunidade recebe
      // pelo socket normalmente.
      const data = await getCommunity().catch(() => null);
      if (data) useStore.getState().setCommunityStructure({ categories: data.categories, channels: data.channels, members: data.members, roles: data.roles });
      onCreated?.(channel);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar canal.');
    }
  };

  return (
    <Modal title="Criar canal" onClose={onClose}>
      <form onSubmit={submit} className="auth-form">
        <label>
          TIPO DE CANAL
          <ChannelTypePicker types={TYPES} value={type} onChange={setType} />
        </label>
        <label>
          NOME DO CANAL
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} required autoFocus />
        </label>
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
        <button type="submit" className="btn-primary">Criar canal</button>
      </form>
    </Modal>
  );
}
