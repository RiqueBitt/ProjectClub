import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal.jsx';
import ConversationIcon from '../ConversationIcon.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import {
  searchUsers, renameConversation, uploadConversationIcon, addConversationMember, leaveConversation,
} from '../../api/endpoints';

// Opened by clicking the group's own icon/name in ChatWindow.jsx's header
// (only for a group conversation — a 1:1 DM has nothing here to configure,
// it's just the other person). Everything a member can do to a group DM:
// rename it, give it a custom photo (falls back to ConversationIcon's own
// mosaic of members otherwise), add more people, or leave.
export default function GroupSettingsModal({ conversation, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const upsertConversation = useStore((s) => s.upsertConversation);
  const removeConversation = useStore((s) => s.removeConversation);
  const [name, setName] = useState(conversation.name || '');
  const [savingName, setSavingName] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  const saveName = async () => {
    if (!name.trim() || name.trim() === conversation.name) return;
    setSavingName(true);
    try {
      const { conversation: updated } = await renameConversation(conversation.id, name.trim());
      upsertConversation(updated);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível renomear o grupo.');
    } finally {
      setSavingName(false);
    }
  };

  const onIconFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingIcon(true);
    try {
      const { conversation: updated } = await uploadConversationIcon(conversation.id, file);
      upsertConversation(updated);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar a foto.');
    } finally {
      setUploadingIcon(false);
    }
  };

  const onSearch = async (e) => {
    const q = e.target.value;
    setQuery(q);
    if (q.trim().length < 2) return setResults([]);
    const { users } = await searchUsers(q);
    const memberIds = new Set(conversation.members.map((m) => m.id));
    setResults(users.filter((u) => !memberIds.has(u.id)));
  };

  const addUser = async (u) => {
    setAddingId(u.id);
    setError('');
    try {
      const { conversation: updated } = await addConversationMember(conversation.id, u.id);
      upsertConversation(updated);
      setResults((r) => r.filter((x) => x.id !== u.id));
      setQuery('');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível adicionar essa pessoa.');
    } finally {
      setAddingId(null);
    }
  };

  const doLeave = async () => {
    if (!window.confirm('Tem certeza que quer sair deste grupo?')) return;
    setLeaving(true);
    try {
      await leaveConversation(conversation.id);
      removeConversation(conversation.id);
      onClose();
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível sair do grupo.');
      setLeaving(false);
    }
  };

  return (
    <Modal title="Configurações do grupo" onClose={onClose}>
      <div className="settings-grid">
        <div className="group-settings-icon-row">
          <ConversationIcon conversation={conversation} size="large" />
          <label className="btn-secondary">
            {uploadingIcon ? '...' : 'Trocar foto'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={uploadingIcon} onChange={onIconFile} />
          </label>
        </div>

        <label>
          Nome do grupo
          <div className="group-settings-name-row">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            <button className="btn-primary" disabled={savingName || !name.trim() || name.trim() === conversation.name} onClick={saveName}>
              {savingName ? '...' : 'Salvar'}
            </button>
          </div>
        </label>

        <label>
          Adicionar pessoas
          <input placeholder="Buscar usuário..." value={query} onChange={onSearch} />
        </label>
        {results.length > 0 && (
          <ul className="user-search-results">
            {results.map((u) => (
              <li key={u.id} onClick={() => addUser(u)}>
                <div className="avatar small">
                  <UserAvatar user={u} size={32} />
                </div>
                {u.displayName} <span className="dim">@{u.username}</span>
                {addingId === u.id && <span className="dim">Adicionando...</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="settings-block">
          <h4>Membros ({conversation.members.length})</h4>
          <ul className="group-member-list">
            {conversation.members.map((m) => (
              <li key={m.id}>
                <div className="avatar small">
                  <UserAvatar user={m} size={32} />
                </div>
                {m.displayName}{m.id === user.id && <span className="dim"> (você)</span>}
              </li>
            ))}
          </ul>
        </div>

        {error && <div className="auth-error">{error}</div>}
        <button className="btn-danger" disabled={leaving} onClick={doLeave}>{leaving ? '...' : 'Sair do grupo'}</button>
      </div>
    </Modal>
  );
}
