import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { useContextMenu } from '../context/ContextMenuContext.jsx';
import { STATUS_COLOR } from '../utils/status';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import { roleTextStyle, highestColoredRole } from '../utils/roleColor';
import { nameStyleProps, hasCustomNameStyle, nameStyleClassName } from '../utils/nameStyle';
import TagBadge from './TagBadge.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import ActivityIcon from './ActivityIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import { createConversation, banMember, timeoutMember, warnMember } from '../api/endpoints';
import personIcon from '../assets/icons/person.png';
import chatIcon from '../assets/icons/chat.png';
import errorIcon from '../assets/icons/error.png';

function highestRole(member, roles) {
  const mine = (roles || []).filter((r) => !r.isDefault && member.roleIds?.includes(r.id));
  if (mine.length === 0) return null;
  return mine.reduce((best, r) => (r.position > best.position ? r : best), mine[0]);
}

export default function MembersList({ onToggle }) {
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);
  const presence = useStore((s) => s.presence);
  // Item pedido: "desativar os cargos" — quando desativado, ninguém
  // fica agrupado por cargo (todo mundo cai direto em ONLINE/OFFLINE)
  // nem tem o nome colorido pela cor do cargo.
  const cargosEnabled = !useStore((s) => s.disabledSystems).includes('cargos');

  const withStatus = members.map((m) => ({
    ...m,
    liveStatus: presence[m.user.id]?.status || m.user.status,
    role: cargosEnabled ? highestRole(m, roles) : null,
  }));
  const online = withStatus.filter((m) => m.liveStatus && m.liveStatus !== 'OFFLINE' && m.liveStatus !== 'INVISIBLE');
  const offline = withStatus.filter((m) => !online.includes(m));

  const hoisted = cargosEnabled ? (roles || []).filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position) : [];
  const groups = [];
  const used = new Set();
  for (const role of hoisted) {
    const inRole = online.filter((m) => m.role?.id === role.id);
    inRole.forEach((m) => used.add(m.user.id));
    if (inRole.length > 0) groups.push({ label: `${role.name.toUpperCase()} — ${inRole.length}`, members: inRole });
  }
  const restOnline = online.filter((m) => !used.has(m.user.id));

  return (
    <aside className="members-list">
      <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
      {groups.map((g) => (
        <MemberGroup key={g.label} label={g.label} members={g.members} roles={roles} cargosEnabled={cargosEnabled} />
      ))}
      <MemberGroup label={`ONLINE — ${restOnline.length}`} members={restOnline} roles={roles} cargosEnabled={cargosEnabled} />
      <MemberGroup label={`OFFLINE — ${offline.length}`} members={offline} roles={roles} dim cargosEnabled={cargosEnabled} />
    </aside>
  );
}

function MemberGroup({ label, members, roles, dim, cargosEnabled }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openMenu } = useContextMenu();
  if (members.length === 0) return null;

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const isAdmin = user.platformRole === 'ADMIN';
  const canBan = isAdmin || hasPermission(myPerms, 'BAN_MEMBERS');
  const canModerate = isAdmin || hasPermission(myPerms, 'MODERATE_MEMBERS');
  const canManageRoles = isAdmin || hasPermission(myPerms, 'MANAGE_ROLES');

  const openDM = async (userId) => {
    const { conversation } = await createConversation([userId]);
    navigate(`/conversations/${conversation.id}`);
  };

  const openAddRole = (userId) => useStore.getState().openProfileAddRole(userId);

  const onContextMenu = (e, m) => {
    const isTarget = m.user.id !== user.id;
    const isProtected = m.user.platformRole === 'ADMIN';
    const items = [
      { label: 'Ver perfil', icon: <img className="ui-icon-sm" src={personIcon} alt="" />, onClick: () => useStore.getState().openProfile(m.user.id) },
      { label: 'Copiar ID', icon: '🆔', onClick: () => navigator.clipboard?.writeText(m.user.publicId || m.user.id) },
      { label: 'Enviar mensagem', icon: <img className="ui-icon-sm" src={chatIcon} alt="" />, onClick: () => openDM(m.user.id), disabled: !isTarget },
    ];
    if (canManageRoles) {
      items.push({ label: 'Adicionar cargo', icon: '🏷️', onClick: () => openAddRole(m.user.id) });
    }
    if (isTarget && !isProtected && (canModerate || canBan)) {
      items.push({ divider: true });
      if (canModerate) {
        items.push({
          label: 'Aplicar silêncio temporário', icon: '🔇',
          onClick: () => { const mins = prompt('Duração (minutos):', '10'); if (mins) timeoutMember(m.user.id, { minutes: parseInt(mins, 10) }); },
        });
        items.push({
          label: 'Advertir', icon: <img className="ui-icon-sm" src={errorIcon} alt="" />,
          onClick: () => { const reason = prompt('Motivo da advertência:'); if (reason) warnMember(m.user.id, reason); },
        });
      }
      if (canBan) {
        items.push({
          label: 'Banir', icon: '🔨', danger: true,
          onClick: () => {
            if (!confirm(`Banir ${m.user.displayName}?`)) return;
            const reason = prompt('Motivo (opcional):') || undefined;
            banMember(m.user.id, { reason });
          },
        });
      }
    }
    openMenu(e, items);
  };

  return (
    <div className="member-group">
      <div className="member-group-label">{label}</div>
      {members.map((m) => (
        <div
          key={m.user.id}
          className={`member-row ${dim ? 'dim' : ''} ${m.user.idCardUrl ? 'has-id-card' : ''}`}
          style={m.user.idCardUrl ? { backgroundImage: `linear-gradient(90deg, var(--bg-secondary) 15%, transparent), url(${m.user.idCardUrl})` } : undefined}
          onContextMenu={(e) => onContextMenu(e, m)}
          onClick={(e) => useStore.getState().openMiniProfile(m.user.id, e.currentTarget.getBoundingClientRect(), 'left')}
        >
          <div className="avatar-wrap small">
            <UserAvatar user={m.user} size={32} />
            <span className="status-dot" style={{ background: STATUS_COLOR[m.liveStatus] || STATUS_COLOR.OFFLINE }} />
          </div>
          <div className="member-row-text">
            <span className={`truncate member-row-name ${hasCustomNameStyle(m.user) ? nameStyleClassName(m.user) : ''}`} style={hasCustomNameStyle(m.user) ? nameStyleProps(m.user) : roleTextStyle(cargosEnabled ? highestColoredRole(m, roles)?.color : null)}>
              {/* BUG CORRIGIDO ("ícone de cargo do lado do nome"): se o
                  ícone do cargo for uma IMAGEM enviada (caminho tipo
                  "/uploads/xyz.png"), colocar ela direto dentro do texto
                  mostrava o CAMINHO como texto literal em vez de exibir
                  a imagem — só emoji funcionava. Agora renderiza os
                  dois formatos certinho, igual já faz no editor de
                  cargos. */}
              {m.role?.icon && (m.role.icon.startsWith('/') ? <img src={m.role.icon} alt="" className="role-icon-inline" /> : <span>{m.role.icon} </span>)}
              {m.user.displayName}
            </span>
            {(m.user.customStatus || m.user.customStatusEmoji) && (
              <span className="member-row-status truncate">
                <ActivityIcon userId={m.user.id} /> <StatusEmoji emoji={m.user.customStatusEmoji} /> {m.user.customStatus}
              </span>
            )}
          </div>
          <TagBadge user={m.user} />
          <ClanTagBadge user={m.user} />
        </div>
      ))}
    </div>
  );
}
