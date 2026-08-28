import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal.jsx';
import { searchUsers, createConversation, uploadConversationIcon } from '../../api/endpoints';
import UserAvatar from '../UserAvatar.jsx';
import { useStore } from '../../store/useStore';
import cancelIcon from '../../assets/icons/cancel.png';

export default function NewDMModal({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [groupIconFile, setGroupIconFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const upsertConversation = useStore((s) => s.upsertConversation);

  // Matches the server's own rule (isGroup = memberIds.length > 2, see
  // conversationController.createConversation) — 2+ *other* people selected
  // means you + them is 3 or more total, which is exactly "a group".
  // Picking just one other person is always a plain 1:1 DM instead.
  const isGroup = selected.length > 1;

  const onSearch = async (e) => {
    const q = e.target.value;
    setQuery(q);
    if (q.trim().length < 2) return setResults([]);
    const { users } = await searchUsers(q);
    setResults(users.filter((u) => !selected.some((s) => s.id === u.id)));
  };

  const toggleSelect = (user) => {
    setSelected((s) => (s.some((u) => u.id === user.id) ? s.filter((u) => u.id !== user.id) : [...s, user]));
    setResults((r) => r.filter((u) => u.id !== user.id));
  };

  const start = async () => {
    if (selected.length === 0) return;
    setError('');
    setCreating(true);
    try {
      const { conversation } = await createConversation(selected.map((u) => u.id), isGroup ? (groupName.trim() || undefined) : undefined);
      // The group itself has to exist first (needs an id) before a photo
      // can be attached to it — a second request right after creation,
      // same two-step pattern as any other "create then decorate" flow in
      // this app (e.g. creating a server, then uploading its icon).
      let final = conversation;
      if (isGroup && groupIconFile) {
        try {
          const { conversation: withIcon } = await uploadConversationIcon(conversation.id, groupIconFile);
          final = withIcon;
        } catch { /* group still works fine without a custom photo — not fatal */ }
      }
      upsertConversation(final);
      onClose();
      navigate(`/conversations/${final.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível criar a conversa.');
      setCreating(false);
    }
  };

  return (
    <Modal title="Selecionar amigos" onClose={onClose}>
      <div className="selected-chips">
        {selected.map((u) => (
          <span key={u.id} className="chip" onClick={() => toggleSelect(u)}>{u.displayName} <img className="ui-icon-sm" src={cancelIcon} alt="x" /></span>
        ))}
      </div>
      <input placeholder="Digite um nome de usuário" value={query} onChange={onSearch} autoFocus />
      <ul className="user-search-results">
        {results.map((u) => (
          <li key={u.id} onClick={() => toggleSelect(u)}>
            <div className="avatar small">
              <UserAvatar user={u} size={32} />
            </div>
            {u.displayName} <span className="dim">@{u.username}</span>
          </li>
        ))}
      </ul>

      {isGroup && (
        <div className="new-group-fields">
          <label>
            Nome do grupo (opcional)
            <input placeholder={selected.map((u) => u.displayName).join(', ')} value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={100} />
          </label>
          <label className="btn-secondary new-group-photo-btn">
            {groupIconFile ? `Foto selecionada: ${groupIconFile.name}` : 'Escolher foto do grupo (opcional)'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => setGroupIconFile(e.target.files[0] || null)} />
          </label>
          <p className="dim">Sem foto, o grupo usa um mosaico com as fotos dos primeiros membros.</p>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}
      <button className="btn-primary" disabled={selected.length === 0 || creating} onClick={start}>
        {creating ? '...' : `Criar ${isGroup ? 'grupo' : 'DM'}`}
      </button>
    </Modal>
  );
}
