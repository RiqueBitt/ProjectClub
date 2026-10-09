import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listPendingTestimonials, respondTestimonial, listPendingRelationships, respondRelationship,
  markChannelRead, markConversationRead,
} from '../api/endpoints';
import { DISABLED_PROFILE_SECTIONS } from '../utils/profileSections';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico, PageHero, PillTabs, EmptyState } from '../components/PagesKit.jsx';
import '../styles/notifications.css';

// Agrupa por dia: Hoje / Ontem / Antes (sem data também cai em "Antes").
function dayGroup(date) {
  if (!date) return 'Antes';
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return 'Hoje';
  if (d >= new Date(today.getTime() - 86400000)) return 'Ontem';
  return 'Antes';
}
const GROUPS = ['Hoje', 'Ontem', 'Antes'];

function when(date) {
  if (!date) return '';
  const d = new Date(date);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return 'agora';
  if (diff < 60) return `${Math.floor(diff)} min`;
  if (dayGroup(date) === 'Hoje') return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dayGroup(date) === 'Ontem') return `ontem, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const FILTERS = [
  { id: 'ALL', label: 'Todas', icon: 'bell' },
  { id: 'MENTIONS', label: 'Menções', icon: 'at' },
  { id: 'MESSAGES', label: 'Mensagens', icon: 'mail' },
  { id: 'REQUESTS', label: 'Pedidos', icon: 'userPlus' },
];

// Área de notificações: reúne, num só lugar, tudo que já é sinalizado
// pontualmente em outras partes do app — canais com menções não lidas,
// conversas diretas não lidas, pedidos de amizade recebidos e (item
// pedido: sistema estilo Orkut) depoimentos esperando sua aprovação —
// para que o item "Notificações" da barra lateral principal tenha, de
// fato, uma área própria com "todas as notificações", em vez de
// precisar visitar cada área separadamente para descobrir o que mudou.
export default function NotificationsPage() {
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user.id);
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);

  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds));
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id));
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming);

  // Depoimentos (item pedido) — só EU vejo os meus pendentes, por isso
  // busca sob demanda ao abrir a página, em vez de vir do estado
  // global (que é sincronizado ao vivo pro resto do app, mas isso aqui
  // é uma lista privada só minha).
  // Item pedido depois: "desativar Depoimentos, sem apagar nada" — só
  // não busca/mostra enquanto estiver na lista de desativadas; toda a
  // lógica continua intacta, pronta pra voltar assim que a chave sair
  // de DISABLED_PROFILE_SECTIONS.
  const [pendingTestimonials, setPendingTestimonials] = useState([]);
  useEffect(() => {
    if (DISABLED_PROFILE_SECTIONS.includes('testimonials')) return;
    listPendingTestimonials().then((d) => setPendingTestimonials(d.testimonials)).catch(() => {});
  }, []);

  const respondToTestimonial = (id, action) => {
    respondTestimonial(id, action)
      .then(() => setPendingTestimonials((prev) => prev.filter((t) => t.id !== id)))
      .catch(() => {});
  };

  // BUG CORRIGIDO ("terminar namoro não aparecia"): o pedido de namoro
  // podia ser ENVIADO (ver requestRelationship em UserProfileModal.jsx),
  // mas nunca existia nenhum jeito de a outra pessoa ACEITAR — a
  // função já existia na API (respondRelationship), só nunca tinha
  // sido conectada em lugar nenhum da interface. Mesmo padrão dos
  // depoimentos pendentes acima.
  // Item pedido depois: "desativar Relacionamento" — mesma ideia.
  const [pendingRelationships, setPendingRelationships] = useState([]);
  useEffect(() => {
    if (DISABLED_PROFILE_SECTIONS.includes('relationship')) return;
    listPendingRelationships().then((d) => setPendingRelationships(d.requests)).catch(() => {});
  }, []);

  const respondToRelationship = (id, action) => {
    respondRelationship(id, action)
      .then(() => setPendingRelationships((prev) => prev.filter((r) => r.id !== id)))
      .catch(() => {});
  };

  const isEmpty = unreadChannels.length === 0 && unreadConversations.length === 0 && pendingIncoming.length === 0 && pendingTestimonials.length === 0 && pendingRelationships.length === 0;

  const [filter, setFilter] = useState('ALL');
  const markChannelReadLocal = useStore((s) => s.markChannelReadLocal);
  const markConversationReadLocal = useStore((s) => s.markConversationReadLocal);

  // "Marcar todas como lidas" — mesmas chamadas que abrir o canal/conversa
  // já faz (ChatWindow.jsx), só que pra todos os não lidos de uma vez.
  // Pedidos (amizade, depoimento, namoro) continuam: precisam de resposta.
  const markAllRead = () => {
    unreadChannels.forEach((ch) => { markChannelRead(ch.id).catch(() => {}); markChannelReadLocal(ch.id); });
    unreadConversations.forEach((c) => { markConversationRead(c.id).catch(() => {}); markConversationReadLocal(c.id); });
  };

  const convName = (c) => {
    const other = !c.isGroup ? c.members.find((m) => m.id !== user.id) : null;
    return { name: c.isGroup ? (c.name || c.members.map((m) => m.displayName).join(', ')) : other?.displayName, other };
  };

  // Lista única com tipo + data, pra agrupar por dia e filtrar.
  const items = [
    ...pendingTestimonials.map((t) => ({ kind: 'testimonial', cat: 'REQUESTS', key: `t-${t.id}`, at: t.createdAt, data: t })),
    ...pendingRelationships.map((r) => ({ kind: 'relationship', cat: 'REQUESTS', key: `r-${r.id}`, at: r.createdAt, data: r })),
    ...pendingIncoming.map((f) => ({ kind: 'friend', cat: 'REQUESTS', key: `f-${f.id}`, at: f.createdAt, data: f })),
    ...unreadChannels.map((ch) => ({ kind: 'channel', cat: 'MENTIONS', key: `c-${ch.id}`, at: ch.lastMessage?.createdAt, data: ch })),
    ...unreadConversations.map((c) => ({ kind: 'conversation', cat: 'MESSAGES', key: `d-${c.id}`, at: c.lastMessage?.createdAt, data: c })),
  ];
  const counts = { ALL: items.length };
  items.forEach((it) => { counts[it.cat] = (counts[it.cat] || 0) + 1; });
  const visible = items
    .filter((it) => filter === 'ALL' || it.cat === filter)
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const canMarkAll = unreadChannels.length + unreadConversations.length > 0;

  const renderItem = (it) => {
    if (it.kind === 'testimonial') {
      const t = it.data;
      return (
        <li key={it.key} className="notifications-item notifications-item-testimonial nt-item unread" data-kind="testimonial">
          <NtIcon kind="testimonial" user={t.author} />
          <div className="nt-body">
            <div className="nt-line"><span><strong>{t.author.displayName}</strong> escreveu um depoimento pra você</span><time>{when(t.createdAt)}</time></div>
            <p className="notifications-testimonial-text nt-quote">{t.text}</p>
            <div className="notifications-testimonial-actions nt-actions">
              <button className="pk-btn sm" onClick={() => respondToTestimonial(t.id, 'decline')}>Recusar</button>
              <button className="pk-btn sm primary" onClick={() => respondToTestimonial(t.id, 'approve')}><Ico name="check" size={15} /> Aprovar</button>
            </div>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'relationship') {
      const r = it.data;
      return (
        <li key={it.key} className="notifications-item notifications-item-testimonial nt-item unread" data-kind="relationship">
          <NtIcon kind="relationship" user={r.requester} />
          <div className="nt-body">
            <div className="nt-line"><span><strong>{r.requester.displayName}</strong> te pediu em namoro!</span><time>{when(r.createdAt)}</time></div>
            <div className="notifications-testimonial-actions nt-actions">
              <button className="pk-btn sm" onClick={() => respondToRelationship(r.id, 'decline')}>Recusar</button>
              <button className="pk-btn sm primary" onClick={() => respondToRelationship(r.id, 'accept')}><Ico name="heart" size={15} /> Aceitar</button>
            </div>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'friend') {
      const f = it.data;
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="friend" onClick={() => navigate('/dms')}>
          <NtIcon kind="friend" user={f.user} />
          <div className="nt-body">
            <div className="nt-line"><span className="truncate"><strong>{f.user.displayName}</strong> quer ser seu amigo</span><time>{when(f.createdAt)}</time></div>
            <span className="nt-sub">Pedido de amizade · toque pra responder</span>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'channel') {
      const ch = it.data;
      const last = ch.lastMessage;
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="channel" onClick={() => navigate(`/channels/${ch.id}`)}>
          <NtIcon kind="channel" user={last?.author} />
          <div className="nt-body">
            <div className="nt-line">
              <span className="truncate">{last?.author ? <><strong>{last.author.displayName}</strong> mencionou você em </> : 'Menção em '}<strong>#{ch.name}</strong></span>
              <time>{when(last?.createdAt)}</time>
            </div>
            {last?.content && <span className="nt-sub truncate">{last.content}</span>}
          </div>
          {ch.unreadMentions > 0 ? <span className="mention-badge nt-badge">{ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}</span> : <span className="nt-dot" aria-label="Não lida" />}
        </li>
      );
    }
    const c = it.data;
    const { name, other } = convName(c);
    const last = c.lastMessage;
    return (
      <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="conversation" onClick={() => navigate(`/conversations/${c.id}`)}>
        <NtIcon kind="conversation" user={other} />
        <div className="nt-body">
          <div className="nt-line"><span className="truncate"><strong>{name}</strong>{c.isGroup ? ' · grupo' : ''}</span><time>{when(last?.createdAt)}</time></div>
          <span className="nt-sub truncate">{last?.content ? `${c.isGroup && last.author ? `${last.author.displayName}: ` : ''}${last.content}` : 'Nova mensagem'}</span>
        </div>
        <span className="nt-dot" aria-label="Não lida" />
      </li>
    );
  };

  return (
    <div className="notifications-page pk-page nt">
      <div className="pk-inner narrow">
        <PageHero
          icon="bell" eyebrow="Central" title="Notificações"
          desc="Menções, mensagens não lidas e pedidos que esperam sua resposta — tudo num lugar só."
          aside={canMarkAll && (
            <button className="pk-btn" onClick={markAllRead}><Ico name="checkAll" size={18} /> Marcar todas como lidas</button>
          )}
        />

        {!isEmpty && (
          <PillTabs
            className="small" label="Filtrar notificações" value={filter} onChange={setFilter}
            tabs={FILTERS.map((f) => ({ ...f, count: counts[f.id] || 0 }))}
          />
        )}

        {isEmpty && (
          <EmptyState icon="bell" title="Tudo em dia." text="Você não tem notificações novas no momento." />
        )}

        {!isEmpty && visible.length === 0 && (
          <EmptyState compact icon={FILTERS.find((f) => f.id === filter)?.icon} title="Nada por aqui" text="Nenhuma notificação neste filtro." />
        )}

        {GROUPS.map((g) => {
          const list = visible.filter((it) => dayGroup(it.at) === g);
          if (!list.length) return null;
          return (
            <section key={g} className="notifications-section nt-group">
              <h3>{g} <span>{list.length}</span></h3>
              <ul className="notifications-list nt-list">{list.map(renderItem)}</ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const KIND_ICON = { testimonial: 'pen', relationship: 'heart', friend: 'userPlus', channel: 'at', conversation: 'mail' };

// Avatar de quem gerou + selinho com o ícone do tipo; sem pessoa, só o ícone.
function NtIcon({ kind, user }) {
  return (
    <span className={`nt-icon k-${kind}`}>
      {user ? <UserAvatar user={user} size={40} /> : <span className="nt-icon-solo"><Ico name={KIND_ICON[kind]} size={20} /></span>}
      {user && <span className="nt-icon-badge"><Ico name={KIND_ICON[kind]} size={12} strokeWidth={2.4} /></span>}
    </span>
  );
}
