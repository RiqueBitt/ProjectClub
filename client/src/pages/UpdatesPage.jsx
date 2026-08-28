import { useEffect, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { listUpdates } from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import updatesIcon from '../assets/icons/nav-updates.png';

// Seção "Atualizações" — changelog público, staff publica pelo painel
// (ver AdminPanel.jsx → UpdatesAdminTab), aparece pra todo mundo em
// tempo real (update:new/update:delete via socket).
export default function UpdatesPage() {
  const { socket } = useSocket() || {};
  const [updates, setUpdates] = useState(null);

  const refresh = () => listUpdates().then((d) => setUpdates(d.updates));
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = (entry) => setUpdates((list) => (list ? [entry, ...list] : list));
    const onDelete = ({ id }) => setUpdates((list) => (list ? list.filter((u) => u.id !== id) : list));
    socket.on('update:new', onNew);
    socket.on('update:delete', onDelete);
    return () => {
      socket.off('update:new', onNew);
      socket.off('update:delete', onDelete);
    };
  }, [socket]);

  if (!updates) return <div className="updates-page"><p className="dim">Carregando...</p></div>;

  return (
    <div className="updates-page">
      <h1><img className="achievements-page-title-icon" src={updatesIcon} alt="" /> Atualizações</h1>
      <p className="dim" style={{ marginBottom: 16 }}>Novidades e mudanças recentes da plataforma.</p>
      {updates.length === 0 ? (
        <p className="dim">Nenhuma atualização publicada ainda.</p>
      ) : (
        <div className="updates-list">
          {updates.map((u) => (
            <div key={u.id} className="update-entry-card">
              <div className="update-entry-header">
                <UserAvatar user={u.createdBy} size={28} />
                <div>
                  <div className="update-entry-title">{u.title}</div>
                  <div className="dim update-entry-meta">{u.createdBy.displayName} · {new Date(u.createdAt).toLocaleString('pt-BR')}</div>
                </div>
              </div>
              <p className="update-entry-desc">{u.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
