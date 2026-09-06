import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useStore, isChannelUnread } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { createCategory, deleteCategory, reorderCategories, reorderChannels, markChannelRead } from '../api/endpoints';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import CreateChannelModal from './modals/CreateChannelModal.jsx';
import EditChannelModal from './modals/EditChannelModal.jsx';
import EditCategoryModal from './modals/EditCategoryModal.jsx';
import CommunitySettingsModal from './modals/CommunitySettingsModal.jsx';
import RoleManagerModal from './modals/RoleManagerModal.jsx';
import ModerationModal from './modals/ModerationModal.jsx';
import EmojiManagerModal from './modals/EmojiManagerModal.jsx';
import StickerManagerModal from './modals/StickerManagerModal.jsx';
import ChannelTypeIcon from './ChannelTypeIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import settingsIcon from '../assets/icons/settings.png';
import plusIcon from '../assets/icons/plus.png';
import cancelIcon from '../assets/icons/cancel.png';
import selectedIcon from '../assets/icons/selected.png';
import linkIcon from '../assets/icons/link.png';
import lockIcon from '../assets/icons/lock.png';
import { proxyImage } from '../utils/imageProxy';

const VOICE_TYPES = ['VOICE', 'STAGE'];

function VoiceChannelTimer({ startedAt }) {
  const [now, setNow] = useState(Date.now());
  // Bug corrigido: faltava o intervalo que atualiza "now" — sem isso o
  // cronômetro calculava o tempo decorrido só uma vez, na primeira
  // renderização, e nunca mais mudava sozinho (só "andava" por acidente,
  // quando outra coisa causava uma nova renderização do componente).
  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  if (!startedAt) return null;
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const label = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  return <span className="voice-channel-timer" title="Tempo com alguém neste canal de voz">{label}</span>;
}

function buildSections(categories, channels) {
  return [
    { categoryId: null, name: null, channels },
    ...categories.map((cat) => ({ categoryId: cat.id, name: cat.name, channels: cat.channels })),
  ];
}

export default function ChannelSidebar() {
  const { user } = useAuth();
  const { openMenu } = useContextMenu();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);
  const community = useStore((s) => s.community);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const collapsed = useStore((s) => s.channelSidebarCollapsed);
  const toggleChannelSidebar = useStore((s) => s.toggleChannelSidebar);
  const [menuOpen, setMenuOpen] = useState(false);
  const [communitySettingsOpen, setCommunitySettingsOpen] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [emojiManagerOpen, setEmojiManagerOpen] = useState(false);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const navigate = useNavigate();
  // Item pedido: cliques rápidos repetidos no MESMO canal disparavam som
  // e recarregamento várias vezes seguidas — bloqueia a navegação já no
  // clique, antes de qualquer efeito posterior, se o canal clicado já é
  // o canal ativo (nenhuma navegação de verdade acontece, então nenhum
  // som/carregamento é disparado de novo).
  const { channelId: activeChannelId } = useParams();

  const [channelModal, setChannelModal] = useState({ open: false, categoryId: null });
  const [editChannel, setEditChannel] = useState(null);
  const [editCategory, setEditCategory] = useState(null);
  const [dragChannelId, setDragChannelId] = useState(null);
  const [dragCategoryId, setDragCategoryId] = useState(null);
  const [dragOverChannelId, setDragOverChannelId] = useState(null);
  const [dragOverPosition, setDragOverPosition] = useState('before');
  const [dragOverCategoryId, setDragOverCategoryId] = useState(null);

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const canManage = hasPermission(myPerms, 'MANAGE_CHANNELS');

  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button className="icon-btn sidebar-expand-btn" title="Expandir canais" onClick={toggleChannelSidebar}>›</button>
      </aside>
    );
  }

  const addCategory = async () => {
    const name = prompt('Nome da categoria');
    if (!name) return;
    await createCategory(name);
  };

  const removeCategory = async (id) => {
    if (!confirm('Excluir esta categoria? Os canais dentro dela também serão excluídos.')) return;
    await deleteCategory(id);
  };

  const onListContextMenu = (e) => {
    if (!canManage) return;
    if (e.target.closest('.channel-item, .category-label, .voice-roster-item')) return;
    e.preventDefault();
    openMenu(e, [
      { label: 'Criar canal', icon: '#', onClick: () => setChannelModal({ open: true, categoryId: null }) },
      { label: 'Criar categoria', icon: '▾', onClick: addCategory },
    ]);
  };

  const onCategoryDrop = async (targetCategoryId) => {
    setDragOverCategoryId(null);
    if (!dragCategoryId || dragCategoryId === targetCategoryId) return;
    const ids = categories.map((c) => c.id);
    const from = ids.indexOf(dragCategoryId);
    const to = ids.indexOf(targetCategoryId);
    if (from < 0 || to < 0) return;
    const reordered = [...ids];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    await reorderCategories(reordered);
    setDragCategoryId(null);
  };

  const onChannelDrop = async (targetCategoryId, targetChannelId, position = 'before') => {
    setDragOverChannelId(null);
    setDragOverCategoryId(null);
    if (!dragChannelId) return;
    const sections = buildSections(categories, channels).map((s) => ({ ...s, channels: [...s.channels] }));
    let dragged = null;
    for (const sec of sections) {
      const idx = sec.channels.findIndex((c) => c.id === dragChannelId);
      if (idx !== -1) { dragged = sec.channels.splice(idx, 1)[0]; break; }
    }
    if (!dragged) return;
    const targetSection = sections.find((s) => s.categoryId === targetCategoryId);
    let targetIdx = targetChannelId ? targetSection.channels.findIndex((c) => c.id === targetChannelId) : targetSection.channels.length;
    if (targetIdx < 0) targetIdx = targetSection.channels.length;
    else if (position === 'after') targetIdx += 1;
    targetSection.channels.splice(targetIdx, 0, dragged);
    const order = sections.flatMap((sec) => sec.channels.map((c, i) => ({ id: c.id, categoryId: sec.categoryId, position: i })));
    await reorderChannels(order);
    setDragChannelId(null);
  };

  return (
    <aside className="sidebar">
      {community.bannerUrl && (
        <div className="sidebar-banner" style={{ backgroundImage: `url(${community.bannerUrl})` }} />
      )}
      <div className="sidebar-header" onClick={() => setMenuOpen((v) => !v)}>
        {community.iconUrl && <img className="sidebar-header-icon" src={proxyImage(community.iconUrl)} alt="" />}
        <span className="truncate">{community.name || 'Project Club'}</span>
        {canManage && (
          <button className="icon-btn sidebar-header-toggle" title="Configurações da comunidade" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}><img className="ui-icon" src={settingsIcon} alt="" /></button>
        )}
        {menuOpen && canManage && (
          <div className="dropdown-menu server-header-menu" onClick={(e) => e.stopPropagation()}>
            <button className="server-header-menu-item" onClick={() => { addCategory(); setMenuOpen(false); }}>
              Criar categoria <span className="server-header-menu-icon">📁</span>
            </button>
            <button className="server-header-menu-item" onClick={() => { setChannelModal({ open: true, categoryId: categories[0]?.id || null }); setMenuOpen(false); }}>
              Criar canal <img className="ui-icon-sm" src={plusIcon} alt="" />
            </button>
            <div className="dropdown-divider" />
            <button className="server-header-menu-item" onClick={() => { setCommunitySettingsOpen(true); setMenuOpen(false); }}>
              Configurações da comunidade <span className="server-header-menu-icon">🏳️</span>
            </button>
            <button className="server-header-menu-item" onClick={() => { setRoleManagerOpen(true); setMenuOpen(false); }}>
              Cargos <span className="server-header-menu-icon">🏷️</span>
            </button>
            <button className="server-header-menu-item" onClick={() => { setEmojiManagerOpen(true); setMenuOpen(false); }}>
              Emojis <span className="server-header-menu-icon">😀</span>
            </button>
            <button className="server-header-menu-item" onClick={() => { setStickerManagerOpen(true); setMenuOpen(false); }}>
              Figurinhas <span className="server-header-menu-icon">🏷️</span>
            </button>
            <button className="server-header-menu-item" onClick={() => { setModerationOpen(true); setMenuOpen(false); }}>
              Moderação <span className="server-header-menu-icon">🛡️</span>
            </button>
            <div className="dropdown-divider" />
            <button className="server-header-menu-item" onClick={() => { navigate('/admin'); setMenuOpen(false); }}>
              Painel administrativo <span className="server-header-menu-icon">🛠️</span>
            </button>
          </div>
        )}
      </div>

      {communitySettingsOpen && <CommunitySettingsModal onClose={() => setCommunitySettingsOpen(false)} />}
      {roleManagerOpen && <RoleManagerModal onClose={() => setRoleManagerOpen(false)} />}
      {moderationOpen && <ModerationModal onClose={() => setModerationOpen(false)} />}
      {emojiManagerOpen && <EmojiManagerModal onClose={() => setEmojiManagerOpen(false)} />}
      {stickerManagerOpen && <StickerManagerModal onClose={() => setStickerManagerOpen(false)} />}

      <nav className="sidebar-list" onContextMenu={onListContextMenu}>
        {channels.length > 0 && (
          <ChannelGroup
            channels={channels}
            categoryId={null}
            members={members}
            canManage={canManage}
            onEdit={setEditChannel}
            channelReadAt={channelReadAt}
            myUserId={user.id}
            dragChannelId={dragChannelId}
            setDragChannelId={setDragChannelId}
            dragOverChannelId={dragOverChannelId}
            setDragOverChannelId={setDragOverChannelId}
            dragOverPosition={dragOverPosition}
            setDragOverPosition={setDragOverPosition}
            onChannelDrop={onChannelDrop}
          />
        )}
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`category-block ${dragOverCategoryId === cat.id ? 'drag-over' : ''}`}
            draggable={canManage}
            onDragStart={() => setDragCategoryId(cat.id)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragCategoryId) setDragOverCategoryId(cat.id);
              else if (dragChannelId) setDragOverCategoryId(cat.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setDragOverCategoryId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragCategoryId) onCategoryDrop(cat.id);
              else if (dragChannelId) onChannelDrop(cat.id, null);
            }}
          >
            <div className="category-label">
              <span>{cat.name.toUpperCase()}</span>
              {canManage && (
                <span className="category-actions">
                  <button className="icon-btn-small" title="Criar canal nesta categoria" onClick={() => setChannelModal({ open: true, categoryId: cat.id })}><img className="ui-icon-sm" src={plusIcon} alt="+" /></button>
                  <button className="icon-btn-small" title="Permissões da categoria" onClick={() => setEditCategory(cat)}><img className="ui-icon-sm" src={settingsIcon} alt="" /></button>
                  <button className="icon-btn-small" title="Excluir categoria" onClick={() => removeCategory(cat.id)}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
                </span>
              )}
            </div>
            <ChannelGroup
              channels={cat.channels}
              categoryId={cat.id}
              members={members}
              canManage={canManage}
              onEdit={setEditChannel}
              channelReadAt={channelReadAt}
              myUserId={user.id}
              dragChannelId={dragChannelId}
              setDragChannelId={setDragChannelId}
              dragOverChannelId={dragOverChannelId}
              setDragOverChannelId={setDragOverChannelId}
              dragOverPosition={dragOverPosition}
              setDragOverPosition={setDragOverPosition}
              onChannelDrop={onChannelDrop}
            />
          </div>
        ))}
      </nav>

      {channelModal.open && (
        <CreateChannelModal
          categoryId={channelModal.categoryId}
          onClose={() => setChannelModal({ open: false, categoryId: null })}
        />
      )}
      {editChannel && <EditChannelModal channel={editChannel} onClose={() => setEditChannel(null)} />}
      {editCategory && <EditCategoryModal category={editCategory} onClose={() => setEditCategory(null)} onDeleted={() => setEditCategory(null)} />}
    </aside>
  );
}

function ChannelGroup({
  channels, categoryId, members, canManage, onEdit, channelReadAt, myUserId,
  dragChannelId, setDragChannelId, dragOverChannelId, setDragOverChannelId,
  dragOverPosition, setDragOverPosition, onChannelDrop,
}) {
  const voice = useVoice();
  const { openMenu } = useContextMenu();
  const markChannelReadLocal = useStore((s) => s.markChannelReadLocal);
  // Item pedido: "só notifica se marcar/responder uma pessoa" —
  // isChannelUnread precisa saber meus cargos pra reconhecer uma
  // menção de CARGO (não só @meu-nome direto) como "isso é pra mim".
  const myRoleIds = members.find((m) => m.user.id === myUserId)?.roleIds || [];

  const onContextMenu = (e, ch) => {
    const items = [
      {
        label: 'Marcar como lido', icon: <img className="ui-icon-sm" src={selectedIcon} alt="" />,
        onClick: () => { markChannelRead(ch.id).catch(() => {}); markChannelReadLocal(ch.id); },
      },
      {
        label: 'Copiar link do canal', icon: <img className="ui-icon-sm" src={linkIcon} alt="" />,
        onClick: () => navigator.clipboard?.writeText(`${window.location.origin}/channels/${ch.id}`),
      },
    ];
    if (canManage) {
      items.push({ divider: true });
      items.push({ label: 'Editar canal', icon: <img className="ui-icon-sm" src={settingsIcon} alt="" />, onClick: () => onEdit(ch) });
    }
    openMenu(e, items);
  };

  const onRowDragOver = (e, ch) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragChannelId || dragChannelId === ch.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const position = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    setDragOverChannelId(ch.id);
    setDragOverPosition(position);
  };

  return (
    <>
      {channels.map((ch) => {
        const unread = isChannelUnread(ch, channelReadAt, myUserId, myRoleIds);
        const isVoiceType = VOICE_TYPES.includes(ch.type);
        const rosterEntries = isVoiceType ? (voice?.roster?.[ch.id] || []) : [];
        const isDragging = dragChannelId === ch.id;
        const isDragOver = dragOverChannelId === ch.id && dragChannelId && dragChannelId !== ch.id;
        return (
          <div key={ch.id}>
            <div
              className={`channel-drag-row ${isDragging ? 'dragging' : ''} ${isDragOver ? `drag-over drag-over-${dragOverPosition}` : ''}`}
              draggable={canManage}
              onDragStart={(e) => { e.stopPropagation(); setDragChannelId(ch.id); }}
              onDragOver={(e) => onRowDragOver(e, ch)}
              onDragLeave={() => setDragOverChannelId((id) => (id === ch.id ? null : id))}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onChannelDrop(categoryId, ch.id, dragOverPosition); }}
              onDragEnd={() => { setDragChannelId(null); setDragOverChannelId(null); }}
              onContextMenu={(e) => onContextMenu(e, ch)}
            >
              <NavLink
                to={`/channels/${ch.id}`}
                // Item pedido (ajuste do pedido anterior): voltou a só
                // NAVEGAR pro canal, sem entrar na chamada
                // automaticamente — em vez disso, a própria tela do
                // canal (VoiceChannelView.jsx) agora já mostra quem
                // está na call e um botão claro de "Entrar", tudo numa
                // prévia direto ali, sem precisar de outro clique cego
                // de propósito.
                onClick={(e) => { if (ch.id === activeChannelId) e.preventDefault(); }}
                className={({ isActive }) => `sidebar-item channel-item ${isActive ? 'active' : ''} ${unread ? 'unread' : ''}`}
              >
                {ch.unreadMentions > 0 && (
                  <span className="mention-badge" title={`${ch.unreadMentions} menção${ch.unreadMentions === 1 ? '' : 'ões'} não lida${ch.unreadMentions === 1 ? '' : 's'}`}>
                    {ch.unreadMentions > 99 ? '99+' : ch.unreadMentions}
                  </span>
                )}
                <ChannelTypeIcon type={ch.type} />
                <span className="truncate">{ch.name}</span>
                {isVoiceType && ch.userLimit > 0 && (
                  <span className="channel-user-limit" title="Limite de usuários no canal de voz">
                    {rosterEntries.length}/{ch.userLimit}
                  </span>
                )}
                {isVoiceType && rosterEntries.length > 0 && (
                  <VoiceChannelTimer startedAt={voice?.rosterStartedAt?.[ch.id]} />
                )}
                {ch.isPrivate && <span title="Canal privado"><img className="ui-icon-sm" src={lockIcon} alt="" /></span>}
                {!(ch.unreadMentions > 0) && unread && <span className="unread-dot" />}
                {canManage && (
                  <span className="channel-item-actions">
                    <button className="icon-btn-small" onClick={(e) => { e.preventDefault(); onEdit(ch); }}><img className="ui-icon-sm" src={settingsIcon} alt="" /></button>
                  </span>
                )}
              </NavLink>
            </div>
            {rosterEntries.length > 0 && (
              <div className="voice-roster">
                {rosterEntries.map((p) => {
                  const person = members.find((m) => m.user.id === p.userId)?.user;
                  const isSpeaking = !p.muted && (p.userId === myUserId ? !!voice?.localSpeaking : !!voice?.rosterSpeaking?.[ch.id]?.[p.userId]);
                  return (
                    <div key={p.userId} className={`voice-roster-item ${isSpeaking ? 'speaking' : ''}`}>
                      <div className="avatar tiny">
                        <UserAvatar user={person} size={20} />
                      </div>
                      <span className="truncate">{person?.displayName || p.userId}</span>
                      {p.muted && <span title="Mudo">🔇</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {canManage && (
        <div
          className="channel-drop-end"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onChannelDrop(categoryId, null); }}
        />
      )}
    </>
  );
}
