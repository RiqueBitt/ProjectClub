import { useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { updateCategory, deleteCategory, uploadCategoryIcon } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext.jsx';
import { getMyCommunityPermissions } from '../../utils/permissions';
import OverwriteEditor from '../permissions/OverwriteEditor.jsx';
import IconPickerField, { iconValueFrom, saveIcon } from '../IconPickerField.jsx';
import { cleanChannelName, CHANNEL_NAME_MAX } from '../../utils/channelName';
import '../../styles/channels.css';

// Same shape/behavior as EditChannelModal.jsx's permissions section — see
// its comments for the tri-state (neutral/allow/deny) rationale. Any
// channel inside this category that doesn't define its own overwrite for a
// given role/member inherits whatever is set here (see
// server/src/services/permissions.js's applyOverwrites: category layer is
// applied first, then the channel's own overwrites on top of it).
// BUG CORRIGIDO: este modal ainda usava `server.id`/`server.roles` (resto
// do EmberCord, de quando havia vários servidores) — ninguém passa
// `server`, então abrir "Permissões da categoria" quebrava na hora.
// Agora lê cargos/membros do store e chama a API pelo id da categoria.
export default function EditCategoryModal({ category, onClose, onDeleted }) {
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(() => iconValueFrom(category));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const { user } = useAuth();
  const myPerms = getMyCommunityPermissions(roles, members, user?.id, user?.platformRole);
  const [tab, setTab] = useState('overview');
  const [permsDirty, setPermsDirty] = useState(false);
  const tryClose = () => { if (permsDirty && !confirm('Você tem permissões não salvas. Sair mesmo assim?')) return; onClose(); };
  const switchTab = (t) => { if (tab === 'perms' && permsDirty && !confirm('Descartar as permissões não salvas?')) return; setPermsDirty(false); setTab(t); };

  const save = async () => {
    const cleanName = cleanChannelName(name);
    if (!cleanName) { setSaveError('Dê um nome à categoria.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await updateCategory(category.id, { name: cleanName });
      await saveIcon({ id: category.id, initial: iconValueFrom(category), value: icon, update: updateCategory, upload: uploadCategoryIcon });
      onClose();
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Excluir esta categoria? Os canais dentro dela não serão excluídos.')) return;
    await deleteCategory(category.id);
    onDeleted?.();
    onClose();
  };

  return (
    <Modal title={`Editar categoria — ${category.name}`} onClose={tryClose} width={tab === 'perms' ? '900px' : '640px'}>
      <nav className="pm-tabs pm-tabs-top">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => switchTab('overview')}>Visão geral</button>
        <button type="button" className={tab === 'perms' ? 'active' : ''} onClick={() => switchTab('perms')}>Permissões</button>
      </nav>
      {tab === 'perms' ? (
        <OverwriteEditor kind="category" targetId={category.id} myPerms={myPerms} onDirtyChange={setPermsDirty} />
      ) : (
      <div className="settings-grid channel-form">
        <label>
          NOME DA CATEGORIA
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CHANNEL_NAME_MAX} />
        </label>
        <IconPickerField value={icon} onChange={setIcon} hint="Aparece ao lado do nome da categoria. Emoji ou imagem PNG, GIF ou WebP de até 1 MB." />
        {saveError && <div className="auth-error">{saveError}</div>}
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>

        <hr />
        <button className="btn-danger" onClick={remove}>Excluir categoria</button>
      </div>
      )}
    </Modal>
  );
}
