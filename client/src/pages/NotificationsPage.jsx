import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { listPendingTestimonials, respondTestimonial } from '../api/endpoints';

// Área de notificações: reúne, num só lugar, tudo que já é sinalizado
// pontualmente em outras partes do app — canais com menções não lidas,
// conversas diretas não lidas, pedidos de amizade recebidos e (item
// pedido: sistema estilo Orkut) depoimentos esperando sua aprovação —
// para que o item "Notificações" da barra lateral principal tenha, de
// fato, uma área própria com "todas as notificações", em vez de
// precisar visitar cada área separadamente para descobrir o que mudou.
export default function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id));
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id));
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming);

  // Depoimentos (item pedido) — só EU vejo os meus pendentes, por isso
  // busca sob demanda ao abrir a página, em vez de vir do estado
  // global (que é sincronizado ao vivo pro resto do app, mas isso aqui
  // é uma lista privada só minha).
  const [pendingTestimonials, setPendingTestimonials] = useState([]);
  useEffect(() => {
    listPendingTestimonials().then((d) => setPendingTestimonials(d.testimonials)).catch(() => {});
  }, []);

  const respondToTestimonial = (id, action) => {
    respondTestimonial(id, action)
      .then(() => setPendingTestimonials((prev) => prev.filter((t) => t.id !== id)))
      .catch(() => {});
  };

  const isEmpty = unreadChannels.length === 0 && unreadConversations.length === 0 && pendingIncoming.length === 0 && pendingTestimonials.length === 0;

  return (
    <div className="notifications-page">
      <h2 className="notifications-page-title">Notificações</h2>

      {isEmpty && (
        <div className="friends-empty-state">
          <div className="friends-empty-state-icon">🔔</div>
          <h3>Tudo em dia.</h3>
          <p>Você não tem notificações novas no momento.</p>
        </div>
      )}

      {pendingTestimonials.length > 0 && (
        <section className="notifications-section">
          <h3>Depoimentos pra aprovar</h3>
          <ul className="notifications-list notifications-list-testimonials">
            {pendingTestimonials.map((t) => (
              <li key={t.id} className="notifications-item notifications-item-testimonial">
                <div className="notifications-testimonial-header">
                  <span className="notifications-item-icon">📝</span>
                  <div className="notifications-testimonial-body">
                    <span className="truncate"><strong>{t.author.displayName}</strong> escreveu um depoimento:</span>
                    <span className="notifications-testimonial-text">{t.text}</span>
                  </div>
                </div>
                <div className="notifications-testimonial-actions">
                  <button className="btn-secondary" onClick={() => respondToTestimonial(t.id, 'decline')}>Recusar</button>
                  <button className="btn-primary" onClick={() => respondToTestimonial(t.id, 'approve')}>Aprovar</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingIncoming.length > 0 && (
        <section className="notifications-section">
          <h3>Pedidos de amizade</h3>
          <ul className="notifications-list">
            {pendingIncoming.map((f) => (
              <li key={f.id} className="notifications-item" onClick={() => navigate('/dms')}>
                <span className="notifications-item-icon">👥</span>
                <span className="truncate">{f.user.displayName} quer ser seu amigo</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unreadChannels.length > 0 && (
        <section className="notifications-section">
          <h3>Canais não lidos</h3>
          <ul className="notifications-list">
            {unreadChannels.map((ch) => (
              <li key={ch.id} className="notifications-item" onClick={() => navigate(`/channels/${ch.id}`)}>
                <span className="notifications-item-icon">💬</span>
                <span className="truncate">{ch.name}</span>
                {ch.unreadMentions > 0 && <span className="mention-badge">{ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unreadConversations.length > 0 && (
        <section className="notifications-section">
          <h3>Conversas não lidas</h3>
          <ul className="notifications-list">
            {unreadConversations.map((c) => {
              const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
              const name = c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName;
              return (
                <li key={c.id} className="notifications-item" onClick={() => navigate(`/conversations/${c.id}`)}>
                  <span className="notifications-item-icon">✉️</span>
                  <span className="truncate">{name}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
