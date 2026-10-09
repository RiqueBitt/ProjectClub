import { useState } from 'react';
import { useStore } from '../store/useStore';
import {
  sendFriendRequest, respondFriendRequest, removeFriend, blockUser, searchUsers, listFriends, createConversation,
} from '../api/endpoints';
import { useNavigate } from 'react-router-dom';
// UserAvatar já trata avatar de pinguim (pseudo-URL "penguin:<cor>").
import UserAvatar from './UserAvatar.jsx';
import SocialIcon from './SocialIcons.jsx';
import { STATUS_LABEL } from '../utils/status';
import PresenceDot from './PresenceDot.jsx';

const TABS = ['ONLINE', 'ALL', 'PENDING', 'BLOCKED', 'ADD'];

export default function FriendsPanel() {
  const [tab, setTab] = useState('ONLINE');
  const navigate = useNavigate();
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
  const counts = { ONLINE: online.length, ALL: accepted.length, PENDING: pending.length, BLOCKED: blocked.length };

  const openDM = async (userId) => {
    try {
      const { conversation } = await createConversation([userId]);
      navigate(`/conversations/${conversation.id}`);
    } catch { /* sem DM: a pessoa pode ter bloqueado DMs */ }
  };

  return (
    <div className="friends-panel fx">
      <div className="fx-bar">
        <div className="fx-filters" role="tablist" aria-label="Filtrar amigos">
          {TABS.filter((t) => t !== 'ADD').map((t) => (
            <button
              key={t} type="button" role="tab" aria-selected={tab === t}
              className={`fx-filter${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}
            >
              {labelFor(t)}
              {counts[t] > 0 && <span className={`fx-count${t === 'PENDING' && pending.some((f) => f.isIncoming) ? ' alert' : ''}`}>{counts[t]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className={`fx-add${tab === 'ADD' ? ' active' : ''}`} onClick={() => setTab('ADD')}>
          <SocialIcon name="add" size={17} /> Adicionar amigo
        </button>
      </div>

      {tab === 'ADD' ? (
        <section className="fx-addbox">
          <h2>Adicionar amigo</h2>
          <p>Procure pelo nome de usuário ou ClubTag. O pedido aparece para a pessoa na hora.</p>
          <form onSubmit={submitByUsername} className="fx-addform">
            <span className="fx-addfield">
              <SocialIcon name="search" size={17} />
              <input
                placeholder="Nome de usuário"
                value={searchQuery}
                onChange={onSearchChange}
                autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false}
              />
            </span>
            <button type="submit" className="fx-primary" disabled={!username.trim()}>Enviar pedido</button>
          </form>
          {feedback && <p className="fx-feedback" role="status">{feedback}</p>}
          {searchResults.length > 0 && (
            <ul className="fx-results">
              {searchResults.map((u) => (
                <li key={u.id}>
                  <UserAvatar user={u} size={36} />
                  <span className="fx-names">
                    <strong className="truncate">{u.displayName}</strong>
                    <span className="truncate">@{u.username}</span>
                  </span>
                  <button type="button" className="fx-ghost" onClick={() => sendRequestTo(u.username)}>
                    <SocialIcon name="add" size={16} /> Adicionar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : list.length === 0 ? (
        <div className="fx-empty">
          <span className="fx-empty-icon"><SocialIcon name={tab === 'ONLINE' ? 'moon' : tab === 'PENDING' ? 'inbox' : tab === 'BLOCKED' ? 'block' : 'wave'} size={30} /></span>
          <h3>{emptyTitleFor(tab)}</h3>
          <p>{emptySubFor(tab)}</p>
          {(tab === 'ALL' || tab === 'ONLINE') && (
            <button type="button" className="fx-primary" onClick={() => setTab('ADD')}>Adicionar amigo</button>
          )}
        </div>
      ) : (
        <ul className="fx-grid">
          {list.map((f) => (
            <li key={f.id} className={`fx-card${f.status === 'PENDING' && f.isIncoming ? ' is-incoming' : ''}`}>
              <button
                type="button" className="fx-who"
                onClick={(e) => useStore.getState().openMiniProfile(f.user.id, e.currentTarget.getBoundingClientRect())}
              >
                <span className="fx-avatar">
                  <UserAvatar user={f.user} size={44} />
                  {f.liveStatus && f.status === 'ACCEPTED' && <PresenceDot status={f.liveStatus} />}
                </span>
                <span className="fx-names">
                  <strong className="truncate">{f.user.displayName}</strong>
                  <span className="truncate">
                    {f.status === 'PENDING' ? (f.isIncoming ? 'Quer ser seu amigo' : 'Pedido enviado')
                      : f.status === 'BLOCKED' ? 'Bloqueado'
                        : (f.user.customStatus || STATUS_LABEL[f.liveStatus] || '')}
                  </span>
                </span>
              </button>
              <div className="fx-actions">
                {f.status === 'PENDING' && f.isIncoming && (
                  <>
                    <button type="button" className="fx-icon ok" onClick={() => respond(f.id, 'accept')} title="Aceitar" aria-label="Aceitar"><SocialIcon name="check" /></button>
                    <button type="button" className="fx-icon" onClick={() => respond(f.id, 'decline')} title="Recusar" aria-label="Recusar"><SocialIcon name="close" /></button>
                    <button type="button" className="fx-icon danger" onClick={() => respond(f.id, 'block')} title="Bloquear" aria-label="Bloquear"><SocialIcon name="block" /></button>
                  </>
                )}
                {f.status === 'PENDING' && !f.isIncoming && (
                  <button type="button" className="fx-icon" onClick={() => remove(f.id)} title="Cancelar pedido" aria-label="Cancelar pedido"><SocialIcon name="close" /></button>
                )}
                {f.status === 'ACCEPTED' && (
                  <>
                    <button type="button" className="fx-icon brand" onClick={() => openDM(f.user.id)} title="Enviar mensagem" aria-label="Enviar mensagem"><SocialIcon name="chat" /></button>
                    <button type="button" className="fx-icon" onClick={() => remove(f.id)} title="Remover amigo" aria-label="Remover amigo"><SocialIcon name="trash" /></button>
                    <button type="button" className="fx-icon danger" onClick={() => block(f.user.username)} title="Bloquear" aria-label="Bloquear"><SocialIcon name="block" /></button>
                  </>
                )}
                {f.status === 'BLOCKED' && (
                  <button type="button" className="fx-ghost" onClick={() => remove(f.id)}>Desbloquear</button>
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
    ALL: 'Que tal adicionar alguém? Procure pelo nome de usuário.',
    PENDING: 'Pedidos enviados ou recebidos vão aparecer nesta lista.',
    BLOCKED: 'Usuários bloqueados aparecem aqui.',
  }[t];
}
