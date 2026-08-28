import { useState } from 'react';
import { useStore } from '../store/useStore';
import {
  sendFriendRequest, respondFriendRequest, removeFriend, blockUser, searchUsers, listFriends,
} from '../api/endpoints';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';

// BUG CORRIGIDO: <img src={avatarUrl}> direto quebrava (bloqueado pela CSP
// img-src) pra quem tem avatar de pinguim, já que avatarUrl vira o
// pseudo-URL "penguin:<cor>" nesse caso, não uma URL de rede de verdade —
// ver PenguinAvatar.jsx.
function SmallAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={28} />;
  return <img src={url} alt="" />;
}
import { STATUS_COLOR, STATUS_LABEL } from '../utils/status';
import selectedIcon from '../assets/icons/selected.png';
import cancelIcon from '../assets/icons/cancel.png';

const TABS = ['ONLINE', 'ALL', 'PENDING', 'BLOCKED', 'ADD'];

export default function FriendsPanel() {
  const [tab, setTab] = useState('ONLINE');
  const friends = useStore((s) => s.friends);
  const presence = useStore((s) => s.presence);
  const setFriends = useStore((s) => s.setFriends);
  const [username, setUsername] = useState('');
  const [feedback, setFeedback] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const withStatus = (f) => ({ ...f, liveStatus: presence[f.user.id]?.status || f.user.status });

  const accepted = friends.filter((f) => f.status === 'ACCEPTED').map(withStatus);
  const online = accepted.filter((f) => f.liveStatus && f.liveStatus !== 'OFFLINE' && f.liveStatus !== 'INVISIBLE');
  const pending = friends.filter((f) => f.status === 'PENDING');
  const blocked = friends.filter((f) => f.status === 'BLOCKED');
  const knownUsernames = new Set(friends.map((f) => f.user.username));

  const sendRequestTo = async (uname) => {
    setFeedback('');
    try {
      await sendFriendRequest(uname);
      setFeedback(`Pedido de amizade enviado para ${uname}.`);
      setUsername('');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Não foi possível enviar o pedido.');
    }
  };

  const submitByUsername = (e) => {
    e.preventDefault();
    if (username.trim()) sendRequestTo(username.trim());
  };

  const onSearchChange = async (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    setUsername(q);
    if (q.trim().length < 2) return setSearchResults([]);
    const { users } = await searchUsers(q).catch(() => ({ users: [] }));
    setSearchResults(users.filter((u) => !knownUsernames.has(u.username)));
  };

  const respond = async (id, action) => {
    await respondFriendRequest(id, action);
    setFriends(
      friends
        .map((f) => (f.id === id ? { ...f, status: action === 'accept' ? 'ACCEPTED' : action.toUpperCase() } : f))
        .filter((f) => action !== 'decline' || f.id !== id)
    );
  };

  const remove = async (id) => {
    await removeFriend(id);
    setFriends(friends.filter((f) => f.id !== id));
  };

  const block = async (uname) => {
    if (!confirm(`Bloquear ${uname}? Vocês deixarão de aparecer um para o outro.`)) return;
    await blockUser(uname);
    const { friendships } = await listFriends().catch(() => ({ friendships: friends }));
    setFriends(friendships);
  };

  const list = tab === 'ONLINE' ? online : tab === 'ALL' ? accepted : tab === 'PENDING' ? pending : tab === 'BLOCKED' ? blocked : [];

  return (
    <div className="friends-panel">
      <div className="friends-tabs">
        {TABS.map((t) => (
          <button key={t} className={`friends-tab ${tab === t ? 'active' : ''} ${t === 'ADD' ? 'add-friend-tab' : ''}`} onClick={() => setTab(t)}>
            {labelFor(t)}
          </button>
        ))}
      </div>

      {tab === 'ADD' ? (
        <div className="add-friend-box">
          <h3>Adicionar amigo</h3>
          <p>Você pode adicionar amigos usando o nome de usuário deles.</p>
          <form onSubmit={submitByUsername} className="add-friend-form">
            <input
              placeholder="Digite um nome de usuário"
              value={searchQuery}
              onChange={onSearchChange}
              autoFocus
            />
            <button type="submit" className="btn-primary" disabled={!username.trim()}>Enviar pedido de amizade</button>
          </form>
          {feedback && <div className="auth-hint">{feedback}</div>}
          {searchResults.length > 0 && (
            <ul className="user-search-results">
              {searchResults.map((u) => (
                <li key={u.id} onClick={() => sendRequestTo(u.username)}>
                  <div className="avatar small" style={{ background: u.profileColor }}>
                    {u.avatarUrl ? <SmallAvatarImg url={u.avatarUrl} /> : u.displayName[0].toUpperCase()}
                  </div>
                  {u.displayName} <span className="dim">@{u.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : list.length === 0 ? (
        <div className="friends-empty-state">
          <div className="friends-empty-state-icon">{tab === 'ONLINE' ? '🌙' : tab === 'PENDING' ? '📭' : tab === 'BLOCKED' ? '🚫' : '👋'}</div>
          <h3>{emptyTitleFor(tab)}</h3>
          <p>{emptySubFor(tab)}</p>
        </div>
      ) : (
        <ul className="friends-list">
          {list.map((f) => (
            <li
              key={f.id}
              className="friend-row"
              onClick={(e) => {
                if (e.target.closest('.friend-row-actions')) return;
                useStore.getState().openMiniProfile(f.user.id, e.currentTarget.getBoundingClientRect());
              }}
            >
              <div className="avatar-wrap">
                <div className="avatar" style={{ background: f.user.profileColor }}>
                  {f.user.avatarUrl ? <SmallAvatarImg url={f.user.avatarUrl} /> : f.user.displayName[0].toUpperCase()}
                </div>
                {f.liveStatus && <span className="status-dot" style={{ background: STATUS_COLOR[f.liveStatus] }} />}
              </div>
              <div className="friend-row-info">
                <div>{f.user.displayName}</div>
                <div className="friend-row-sub">{f.status === 'PENDING' ? (f.isIncoming ? 'Pedido recebido' : 'Pedido enviado') : f.status === 'BLOCKED' ? 'Bloqueado' : STATUS_LABEL[f.liveStatus] || ''}</div>
              </div>
              <div className="friend-row-actions">
                {f.status === 'PENDING' && f.isIncoming && (
                  <>
                    <button className="icon-btn" onClick={() => respond(f.id, 'accept')} title="Aceitar"><img className="ui-icon" src={selectedIcon} alt="" /></button>
                    <button className="icon-btn" onClick={() => respond(f.id, 'decline')} title="Recusar"><img className="ui-icon" src={cancelIcon} alt="x" /></button>
                    <button className="icon-btn" onClick={() => respond(f.id, 'block')} title="Bloquear">🚫</button>
                  </>
                )}
                {f.status === 'ACCEPTED' && (
                  <button className="icon-btn" onClick={() => block(f.user.username)} title="Bloquear">🚫</button>
                )}
                {f.status !== 'PENDING' && (
                  <button className="icon-btn" onClick={() => remove(f.id)} title={f.status === 'BLOCKED' ? 'Desbloquear' : 'Remover'}><img className="ui-icon" src={cancelIcon} alt="x" /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function labelFor(t) {
  return { ONLINE: 'Online', ALL: 'Todos', PENDING: 'Pendentes', BLOCKED: 'Bloqueados', ADD: 'Adicionar amigo' }[t];
}

function emptyTitleFor(t) {
  return {
    ONLINE: 'Ninguém por aqui agora.',
    ALL: 'Nenhum amigo ainda.',
    PENDING: 'Nenhum pedido pendente.',
    BLOCKED: 'Ninguém bloqueado.',
  }[t];
}

function emptySubFor(t) {
  return {
    ONLINE: 'Assim que um amigo ficar online, ele aparece bem aqui.',
    ALL: 'Que tal adicionar alguém? Use a aba "Adicionar amigo" ali em cima.',
    PENDING: 'Pedidos enviados ou recebidos vão aparecer nesta lista.',
    BLOCKED: 'Usuários bloqueados aparecem aqui.',
  }[t];
}
