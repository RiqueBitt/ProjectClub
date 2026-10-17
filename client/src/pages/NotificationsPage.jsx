import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds, roomKeyFor } from '../store/useStore';
import { listReminders, deleteReminder } from '../api/endpoints';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listPendingTestimonials, respondTestimonial, listPendingRelationships, respondRelationship,
  markChannelRead, markConversationRead, listEvents, listMissions,
} from '../api/endpoints';
import { getShop } from '../api/decorations';
import { useLiveRefresh } from '../utils/liveRefresh';
import { DISABLED_PROFILE_SECTIONS } from '../utils/profileSections';
import UserAvatar from '../components/UserAvatar.jsx';
import { Ico, PageHero, PillTabs, EmptyState } from '../components/PagesKit.jsx';
import '../styles/notifications.css';
import { listNotices, readAllNotices, readNotice } from '../api/contentx';
import { useSocket } from '../context/SocketContext.jsx';
import { eventPath, channelPath, conversationPath, isChannelPath, isDmPath } from '../utils/prettyLinks';

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
  { id: 'EVENTS', label: 'Eventos', icon: 'sparkles' },
  { id: 'MISSIONS', label: 'Missões', icon: 'trophy' },
  { id: 'SHOP', label: 'Loja', icon: 'store' },
  { id: 'REMINDERS', label: 'Lembretes', icon: 'clock' },
];

// Eventos/Loja/Missões não têm "lido" no servidor: guarda aqui, por
// pessoa e aparelho, até quando já foi visto (e quais missões prontas).
const RECENT_MS = 14 * 86400000;
function readSeen(userId) {
  try { const v = JSON.parse(localStorage.getItem(`nt-seen:${userId}`) || '{}'); return { at: Number(v.at) || 0, missions: Array.isArray(v.missions) ? v.missions : [] }; } catch { return { at: 0, missions: [] }; }
}
function writeSeen(userId, seen) {
  try { localStorage.setItem(`nt-seen:${userId}`, JSON.stringify({ at: seen.at, missions: seen.missions.slice(-200) })); } catch { /* sem storage */ }
}

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

  // Tempo real (11s): pedidos pendentes; canais/DMs/amigos vêm do store
  // global, que já se atualiza sozinho (ver useGlobalLiveRefresh).
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      DISABLED_PROFILE_SECTIONS.includes('testimonials') ? null : listPendingTestimonials().then((d) => put(setPendingTestimonials)(d.testimonials)),
      DISABLED_PROFILE_SECTIONS.includes('relationship') ? null : listPendingRelationships().then((d) => put(setPendingRelationships)(d.requests)),
    ]);
  });

  // Eventos novos, missões prontas pra resgatar e novidades da Loja
  // (só ao abrir esta página + atualização lenta, pra não pesar o app).
  const [extra, setExtra] = useState({ events: [], missions: [], resets: null, shop: [] });
  const [seen, setSeen] = useState(() => readSeen(user.id));
  const loadExtra = async (put) => {
    const [ev, mi, sh] = await Promise.allSettled([listEvents(), listMissions(), getShop()]);
    const next = {
      events: ev.status === 'fulfilled' ? (ev.value.events || []) : [],
      missions: mi.status === 'fulfilled' ? (mi.value.missions || []) : [],
      resets: mi.status === 'fulfilled' ? mi.value.resets || null : null,
      shop: sh.status === 'fulfilled'
        ? [...(sh.value.decorations || []).map((d) => ({ ...d, shopKind: 'Moldura' })), ...(sh.value.effects || []).map((e) => ({ ...e, shopKind: 'Efeito de perfil' })), ...(sh.value.collections || []).map((c) => ({ ...c, shopKind: 'Coleção' }))]
        : [],
    };
    (put ? put(setExtra) : setExtra)(next);
  };
  useEffect(() => { loadExtra(); }, []);
  useLiveRefresh(({ put }) => loadExtra(put), { interval: 60000, key: 'notifications-extra' });

  // Avisos salvos no servidor (lembrete de evento 15 min antes, presente
  // recebido na Loja): têm "lido" de verdade e chegam ao vivo pelo socket.
  const { socket } = useSocket() || {};
  const [notices, setNotices] = useState([]);
  useEffect(() => { listNotices().then((d) => setNotices(d.notices || [])).catch(() => {}); }, []);
  useLiveRefresh(({ put }) => listNotices().then((d) => put(setNotices)(d.notices || [])), { interval: 60000, key: 'notifications-notices' });
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = (n) => setNotices((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list]));
    socket.on('notice:new', onNew);
    return () => socket.off('notice:new', onNew);
  }, [socket]);
  const unreadNotices = notices.filter((n) => !n.readAt);
  const openNotice = (n) => {
    if (!n.readAt) {
      setNotices((list) => list.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      readNotice(n.id).catch(() => {});
    }
    // Lembrete criado a partir de uma mensagem: leva até ELA (não só o canal).
    const mid = n.data?.messageId;
    if (mid && n.link) {
      const ch = n.link.match(/^\/channels\/([^/?#]+)/); const cv = n.link.match(/^\/conversations\/([^/?#]+)/);
      if (ch) useStore.getState().setPendingJump({ roomKey: roomKeyFor({ channelId: ch[1] }), messageId: mid });
      else if (cv) useStore.getState().setPendingJump({ roomKey: roomKeyFor({ conversationId: cv[1] }), messageId: mid });
    }
    if (n.link) navigate(n.link);
  };

  // Lembretes ativos (os que ainda vão disparar) — lista própria, dá pra cancelar.
  const [reminders, setReminders] = useState([]);
  useEffect(() => { listReminders().then((d) => setReminders(d?.active || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!socket) return undefined;
    const refresh = () => listReminders().then((d) => setReminders(d?.active || [])).catch(() => {});
    socket.on('reminder:fired', refresh);
    return () => socket.off('reminder:fired', refresh);
  }, [socket]);
  const removeReminder = (id) => { deleteReminder(id).then(() => setReminders((l) => l.filter((r) => r.id !== id))).catch(() => {}); };

  const cutoff = Math.max(seen.at, Date.now() - RECENT_MS);
  const missionKey = (m) => `${m.id}|${extra.resets?.[m.period === 'WEEKLY' ? 'weekly' : 'daily'] || ''}`;
  const newEvents = extra.events.filter((e) => e.status !== 'ENDED' && new Date(e.createdAt).getTime() > cutoff);
  const readyMissions = extra.missions.filter((m) => m.completed && !m.claimed && !seen.missions.includes(missionKey(m)));
  const newShop = extra.shop.filter((it) => !it.owned && it.createdAt && new Date(it.createdAt).getTime() > cutoff).slice(0, 10);

  const recentNotices = notices.filter((n) => !n.readAt || Date.now() - new Date(n.createdAt).getTime() < RECENT_MS);
  const isEmpty = recentNotices.length === 0 && newEvents.length === 0 && readyMissions.length === 0 && newShop.length === 0 && unreadChannels.length === 0 && unreadConversations.length === 0 && pendingIncoming.length === 0 && pendingTestimonials.length === 0 && pendingRelationships.length === 0;

  const [filter, setFilter] = useState('ALL');
  const markChannelReadLocal = useStore((s) => s.markChannelReadLocal);
  const markConversationReadLocal = useStore((s) => s.markConversationReadLocal);

  // "Marcar todas como lidas" — mesmas chamadas que abrir o canal/conversa
  // já faz (ChatWindow.jsx), só que pra todos os não lidos de uma vez.
  // Pedidos (amizade, depoimento, namoro) continuam: precisam de resposta.
  const markAllRead = () => {
    const nextSeen = { at: Date.now(), missions: [...seen.missions, ...readyMissions.map(missionKey)] };
    setSeen(nextSeen);
    writeSeen(user.id, nextSeen);
    unreadChannels.forEach((ch) => { markChannelRead(ch.id).catch(() => {}); markChannelReadLocal(ch.id); });
    unreadConversations.forEach((c) => { markConversationRead(c.id).catch(() => {}); markConversationReadLocal(c.id); });
    if (unreadNotices.length) {
      setNotices((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
      readAllNotices().catch(() => {});
    }
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
    ...newEvents.map((e) => ({ kind: 'event', cat: 'EVENTS', key: `e-${e.id}`, at: e.createdAt, data: e })),
    ...readyMissions.map((m) => ({ kind: 'mission', cat: 'MISSIONS', key: `m-${m.id}`, at: new Date().toISOString(), data: m })),
    ...newShop.map((it) => ({ kind: 'shop', cat: 'SHOP', key: `s-${it.id}`, at: it.createdAt, data: it })),
    ...recentNotices.map((n) => ({ kind: 'notice', cat: n.kind === 'EVENT_REMINDER' ? 'EVENTS' : n.kind === 'GIFT' ? 'SHOP' : n.kind === 'REMINDER' ? 'REMINDERS' : n.kind === 'SCHEDULED_FAILED' ? 'MESSAGES' : 'OTHER', key: `n-${n.id}`, at: n.createdAt, data: n })),
  ];
  const counts = { ALL: items.length };
  items.forEach((it) => { counts[it.cat] = (counts[it.cat] || 0) + 1; });
  const visible = items
    .filter((it) => filter === 'ALL' || it.cat === filter)
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const canMarkAll = unreadNotices.length + unreadChannels.length + unreadConversations.length + newEvents.length + readyMissions.length + newShop.length > 0;

  const renderItem = (it) => {
    if (it.kind === 'notice') {
      const n = it.data;
      const icon = n.kind === 'GIFT' ? 'gift' : (n.kind === 'EVENT_REMINDER' || n.kind === 'REMINDER') ? 'reminder' : n.kind === 'SCHEDULED_FAILED' ? 'conversation' : 'notice';
      const lead = n.kind === 'EVENT_REMINDER' ? 'Lembrete de evento' : n.kind === 'REMINDER' ? 'Lembrete' : n.kind === 'SCHEDULED_FAILED' ? 'Agendada' : n.kind === 'GIFT' ? 'Presente' : n.kind === 'DIGEST' ? 'Resumo' : 'Aviso';
      return (
        <li key={it.key} className={`notifications-item nt-item clickable${n.readAt ? ' is-read' : ' unread'}`} data-kind={icon} onClick={() => openNotice(n)}>
          <NtIcon kind={icon} />
          <div className="nt-body">
            <div className="nt-line"><span className="truncate">{lead}: <strong>{n.title}</strong></span><time>{when(n.createdAt)}</time></div>
            {n.body && <span className="nt-sub truncate">{n.body}</span>}
          </div>
          {!n.readAt && <span className="nt-dot" aria-label="Não lida" />}
        </li>
      );
    }
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
    if (it.kind === 'event') {
      const e = it.data;
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="event" onClick={() => navigate(eventPath(e))}>
          <NtIcon kind="event" />
          <div className="nt-body">
            <div className="nt-line"><span className="truncate">{e.status === 'ACTIVE' ? 'Evento acontecendo: ' : 'Novo evento: '}<strong>{e.title}</strong></span><time>{when(e.createdAt)}</time></div>
            <span className="nt-sub truncate">{e.startsAt ? `Começa ${new Date(e.startsAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : (e.description || '').slice(0, 120)}</span>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'mission') {
      const m = it.data;
      const reward = [m.rewardCoins ? `${m.rewardCoins} moedas` : '', m.rewardGems ? `${m.rewardGems} gemas` : '', m.rewardXp ? `${m.rewardXp} XP` : ''].filter(Boolean).join(' · ');
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="mission" onClick={() => navigate('/missoes')}>
          <NtIcon kind="mission" />
          <div className="nt-body">
            <div className="nt-line"><span className="truncate">Missão concluída: <strong>{m.title}</strong></span><time>{m.period === 'WEEKLY' ? 'semanal' : 'diária'}</time></div>
            <span className="nt-sub truncate">Resgate sua recompensa{reward ? ` · ${reward}` : ''}</span>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'shop') {
      const s = it.data;
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="shop" onClick={() => navigate('/loja')}>
          <NtIcon kind="shop" />
          <div className="nt-body">
            <div className="nt-line"><span className="truncate">Novidade na Loja: <strong>{s.name || s.title || s.shopKind}</strong></span><time>{when(s.createdAt)}</time></div>
            <span className="nt-sub truncate">{s.shopKind}</span>
          </div>
          <span className="nt-dot" aria-label="Não lida" />
        </li>
      );
    }
    if (it.kind === 'channel') {
      const ch = it.data;
      const last = ch.lastMessage;
      return (
        <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="channel" onClick={() => navigate(channelPath(ch))}>
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
      <li key={it.key} className="notifications-item nt-item unread clickable" data-kind="conversation" onClick={() => navigate(conversationPath(c))}>
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
          desc="Menções, mensagens, pedidos, eventos, missões e novidades da Loja — tudo num lugar só."
          aside={canMarkAll && (
            <button className="pk-btn" onClick={markAllRead}><Ico name="checkAll" size={18} /> Marcar tudo como lido</button>
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

        {reminders.length > 0 && (filter === 'ALL' || filter === 'REMINDERS') && (
          <section className="notifications-section nt-group nt-reminders">
            <h3>Lembretes marcados <span>{reminders.length}</span></h3>
            <ul className="notifications-list nt-list">
              {reminders.map((r) => (
                <li key={r.id} className="notifications-item nt-item" data-kind="reminder">
                  <NtIcon kind="reminder" />
                  <div className="nt-body">
                    <div className="nt-line"><span className="truncate"><strong>{r.text}</strong></span><time>{new Date(r.dueAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
                    {r.link && <span className="nt-sub truncate">{isChannelPath(r.link) ? 'No canal' : isDmPath(r.link) ? 'Na conversa' : r.link}</span>}
                  </div>
                  <button type="button" className="pk-btn ghost small" onClick={() => removeReminder(r.id)} title="Cancelar lembrete">Cancelar</button>
                </li>
              ))}
            </ul>
          </section>
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

const KIND_ICON = { testimonial: 'pen', relationship: 'heart', friend: 'userPlus', channel: 'at', conversation: 'mail', event: 'sparkles', mission: 'trophy', shop: 'store', gift: 'gift', reminder: 'clock', notice: 'bell' };

// Avatar de quem gerou + selinho com o ícone do tipo; sem pessoa, só o ícone.
function NtIcon({ kind, user }) {
  return (
    <span className={`nt-icon k-${kind}`}>
      {user ? <UserAvatar user={user} size={40} /> : <span className="nt-icon-solo"><Ico name={KIND_ICON[kind]} size={20} /></span>}
      {user && <span className="nt-icon-badge"><Ico name={KIND_ICON[kind]} size={12} strokeWidth={2.4} /></span>}
    </span>
  );
}
