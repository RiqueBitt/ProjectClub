import { useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { updateChannel, deleteChannel, uploadChannelIcon } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext.jsx';
import { getMyCommunityPermissions } from '../../utils/permissions';
import OverwriteEditor from '../permissions/OverwriteEditor.jsx';
import ChannelTypePicker from '../ChannelTypePicker.jsx';
import ChannelTypeIcon from '../ChannelTypeIcon.jsx';
import IconPickerField, { iconValueFrom, saveIcon } from '../IconPickerField.jsx';
import { cleanChannelName, CHANNEL_NAME_MAX } from '../../utils/channelName';
import '../../styles/channels.css';

const TYPES = ['TEXT', 'VOICE', 'ANNOUNCEMENT', 'STAGE'];

// Kept in sync with SLOW_MODE_SECONDS_OPTIONS in
// server/src/controllers/channelController.js.
const SLOW_MODE_OPTIONS = [
  { label: 'Desativado', value: '' },
  { label: '5 segundos', value: 5 },
  { label: '10 segundos', value: 10 },
  { label: '15 segundos', value: 15 },
  { label: '30 segundos', value: 30 },
  { label: '1 minuto', value: 60 },
  { label: '2 minutos', value: 120 },
  { label: '5 minutos', value: 300 },
  { label: '10 minutos', value: 600 },
  { label: '15 minutos', value: 900 },
  { label: '30 minutos', value: 1800 },
  { label: '1 hora', value: 3600 },
  { label: '2 horas', value: 7200 },
  { label: '6 horas', value: 21600 },
];

export default function EditChannelModal({ channel, onClose, onDeleted }) {
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic || '');
  const [type, setType] = useState(channel.type);
  const [isPrivate, setIsPrivate] = useState(!!channel.isPrivate);
  const [userLimit, setUserLimit] = useState(channel.userLimit ?? '');
  const [slowModeSeconds, setSlowModeSeconds] = useState(channel.slowModeSeconds ?? '');
  const { user } = useAuth();
  const categories = useStore((s) => s.categories);
  const category = categories.find((c) => c.id === channel.categoryId) || null;
  const myPerms = getMyCommunityPermissions(roles, members, user?.id, user?.platformRole);
  const [tab, setTab] = useState('overview');
  const [permsDirty, setPermsDirty] = useState(false);
  const [icon, setIcon] = useState(() => iconValueFrom(channel));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const isVoiceLike = type === 'VOICE' || type === 'STAGE';

  // "Canal privado" (aba Permissões) salva na hora, como no Discord.
  const togglePrivate = async (v) => {
    setIsPrivate(v);
    try { await updateChannel(channel.id, { isPrivate: v }); } catch { setIsPrivate(!v); }
  };
  const tryClose = () => { if (permsDirty && !confirm('Você tem permissões não salvas. Sair mesmo assim?')) return; onClose(); };
  const switchTab = (t) => { if (tab === 'perms' && permsDirty && !confirm('Descartar as permissões não salvas?')) return; setPermsDirty(false); setTab(t); };

  const save = async () => {
    const cleanName = cleanChannelName(name);
    if (!cleanName) { setSaveError('Dê um nome ao canal.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await updateChannel(channel.id, {
        name: cleanName, topic, type, isPrivate,
        userLimit: isVoiceLike ? userLimit : undefined,
        slowModeSeconds: !isVoiceLike ? (slowModeSeconds || null) : undefined,
      });
      // Ícone: só manda se mudou (o socket channel:update avisa todo mundo).
      await saveIcon({ id: channel.id, initial: iconValueFrom(channel), value: icon, update: updateChannel, upload: uploadChannelIcon });
      onClose();
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Excluir este canal?')) return;
    await deleteChannel(channel.id);
    onDeleted?.();
    onClose();
  };

  return (
    <Modal title={`Editar canal — ${channel.name}`} onClose={tryClose} width={tab === 'perms' ? '900px' : '640px'}>
      <nav className="pm-tabs pm-tabs-top">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => switchTab('overview')}>Visão geral</button>
        <button type="button" className={tab === 'perms' ? 'active' : ''} onClick={() => switchTab('perms')}>Permissões</button>
      </nav>
      {tab === 'perms' ? (
        <OverwriteEditor
          kind="channel"
          targetId={channel.id}
          channelType={type}
          category={category}
          isPrivate={isPrivate}
          onPrivateChange={togglePrivate}
          myPerms={myPerms}
          onDirtyChange={setPermsDirty}
        />
      ) : (
      <div className="settings-grid channel-form">
        <label>
          NOME DO CANAL
          {/* Nome do jeito que a pessoa escrever: maiúsculas e espaços valem. */}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CHANNEL_NAME_MAX} />
        </label>
        <IconPickerField value={icon} onChange={setIcon} defaultIcon={<ChannelTypeIcon type={type} className="icon-field-default" />} />
        <label>
          DESCRIÇÃO
          <textarea value={topic} onChange={(e) => setTopic(e.target.value.slice(0, 500))} maxLength={500} rows={3} placeholder="Do que se trata este canal?" />
          <span className="dim char-count">{topic.length}/500</span>
        </label>
        <label>
          TIPO
          <ChannelTypePicker types={TYPES} value={type} onChange={setType} />
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
        {!isVoiceLike && (
          <label>
            MODO LENTO
            <select value={slowModeSeconds} onChange={(e) => setSlowModeSeconds(e.target.value)}>
              {SLOW_MODE_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
            <span className="dim">Cada pessoa só pode mandar uma mensagem por vez, esperando esse tempo entre uma e outra. Quem tem permissão de gerenciar mensagens não é afetado.</span>
          </label>
        )}
        {saveError && <div className="auth-error">{saveError}</div>}
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>

        <hr />
        <button className="btn-danger" onClick={remove}>Excluir canal</button>
      </div>
      )}
    </Modal>
  );
}
