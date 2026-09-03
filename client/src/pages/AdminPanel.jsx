import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import UserSecurityInfoModal from '../components/modals/UserSecurityInfoModal.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import IconGlyph from '../components/IconGlyph.jsx';
import staffIcon from '../assets/icons/nav-staff.png';
import editIcon from '../assets/icons/nav-edit.png';
import confirmIcon from '../assets/icons/nav-confirm.png';
import closeIcon from '../assets/icons/nav-close.png';
import giftIcon from '../assets/icons/nav-gift.png';
import achievementsDefaultIconUrl from '../assets/icons/nav-achievements.png';
import { RARITY_LABEL as ACHIEVEMENT_RARITY_LABEL } from '../utils/achievementRarity';
import Modal from '../components/Modal.jsx';
import RoleManagerModal from '../components/modals/RoleManagerModal.jsx';
import CreateChannelModal from '../components/modals/CreateChannelModal.jsx';
import { useStore } from '../store/useStore';
import { roleChipStyle } from '../utils/roleColor';
import {
  adminGetStats, adminListAuditLog,
  adminListUsers, adminUpdateUser, adminBanUser, adminUnbanUser, adminSuspendUser, adminUnsuspendUser, adminSetPlatformRole,
  adminListBadges, adminGrantBadge, adminRevokeBadge, adminCreateBadge, adminUpdateBadge, adminDeleteBadge, adminUploadBadgeIcon,
  adminSetUserLevel, adminAddUserXp, adminAddUserCurrency,
  getPlatformStatus, adminSetMaintenanceMode,
  adminCreateAnnouncement, adminUploadAnnouncementBanner, adminListAnnouncements,
  adminGetAlbumLayout, adminUpdateAlbumSettings, adminUpsertAlbumSlot, adminAssignStickerPosition,
  adminListChests, adminCreateChest, adminUpdateChest, adminDeleteChest,
  adminListHouseCatalog, adminCreateHouse, adminUpdateHouse, adminDeleteHouse,
  listMapBackgrounds, adminCreateMapBackground, adminUpdateMapBackground, adminDeleteMapBackground,
  adminSetStarterHouse, adminClearStarterHouse, adminSetStarterMap, adminClearStarterMap,
  adminListHouseGroups, adminSetHouseGroup, adminDeleteHouseGroup,
  adminListFurnitureCatalog, adminCreateFurniture, adminUpdateFurniture, adminDeleteFurniture,
  adminListFurnitureCategories, adminCreateFurnitureCategory,
  getSystemToggles, adminUpdateSystemToggles,
  adminListHouseComments, adminDeleteHouseCommentMod,
  adminListApplications, approveApplication, rejectApplication,
  adminListAutomodFlags, adminGetFlaggedConversation, adminResolveAutomodFlag,
  getCommunitySettings, deleteCommunity,
  getCommunity,
  adminListHoneypotHits, adminListBlockedIps, adminUnblockIp, adminReloadUserPresence, adminDeleteUserAccount,
  adminListAchievements, adminCreateAchievement, adminUpdateAchievement, adminUploadAchievementIcon, adminDeleteAchievement,
  listUpdates, createUpdate, updateUpdateEntry, deleteUpdateEntry,
  listEvents, createEvent, updateEvent, deleteEvent, uploadEventBanner, uploadEventIcon,
  createCategory, updateCategory, deleteCategory, reorderCategories,
  deleteChannel, reorderChannels,
} from '../api/endpoints';
import HouseIcon from '../components/HouseIcon.jsx';
import { BADGE_RARITIES, RARITY_LABEL, RARITY_COLOR, badgeHasImage } from '../utils/badgeRarity';
import { proxyImage } from '../utils/imageProxy';

const TAB_LABEL = {
  stats: '📊 Estatísticas', users: '👥 Usuários', badges: '🏅 Insígnias', inscricoes: '📝 Inscrições',
  logs: '📜 Registro de auditoria', maintenance: '🚧 Manutenção', announcements: '📢 Mensagem', album: '📖 Álbum de Figurinhas',
  economia: '💰 Economia', casas: '🧊 Casas e Móveis', sistema: '⚙️ Sistema', moderacao: '💬 Moderação de Recados',
  automodDm: '🚩 Moderação de DMs', feeds: '📰 Feeds', honeypot: '🕸️ Segurança (Honeypot)',
  roles: '🎭 Cargos', channels: '# Canais e Categorias',
  achievements: '🏆 Conquistas', updates: '📰 Atualizações', events: '🎉 Eventos', reload: '🔄 Reload',
};

const TAB_GROUPS = [
  { label: 'Visão geral', tabs: ['stats', 'inscricoes', 'users', 'badges'] },
  { label: 'Estrutura da comunidade', tabs: ['roles', 'channels', 'achievements'] },
  { label: 'Conteúdo', tabs: ['feeds', 'economia', 'casas', 'album', 'updates', 'events'] },
  { label: 'Moderação', tabs: ['moderacao', 'automodDm', 'logs', 'honeypot'] },
  { label: 'Comunicação', tabs: ['announcements'] },
  { label: 'Sistema', tabs: ['sistema', 'maintenance', 'reload'] },
];

export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('stats');
  // Reformulação do painel (item pedido: "melhorando organização, menus,
  // navegação... facilidade de gerenciamento") — com quase 20 ferramentas
  // diferentes, achar a certa rolando uma lista comprida era o principal
  // ponto de atrito. Busca filtra por nome na hora; grupos recolhem
  // sozinhos (exceto o que tem a aba ativa) pra sobrar mais espaço de
  // tela pra quem já sabe onde quer ir.
  const [navQuery, setNavQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const toggleGroup = (label) => setCollapsedGroups((s) => ({ ...s, [label]: !s[label] }));

  const normalizedQuery = navQuery.trim().toLowerCase();
  const visibleGroups = TAB_GROUPS
    .map((group) => ({
      ...group,
      tabs: normalizedQuery ? group.tabs.filter((t) => TAB_LABEL[t].toLowerCase().includes(normalizedQuery)) : group.tabs,
    }))
    .filter((group) => group.tabs.length > 0);

  const currentGroupLabel = TAB_GROUPS.find((g) => g.tabs.includes(tab))?.label;

  if (user.platformRole !== 'ADMIN') {
    return <div className="admin-panel"><div className="dim" style={{ padding: 24 }}>Acesso restrito a administradores da plataforma.</div></div>;
  }

  return (
    <div className="admin-panel admin-panel-modern">
      <div className="admin-panel-header">
        <h1><IconGlyph src={staffIcon} size={22} /> Painel da Equipe</h1>
        <p className="dim">Ferramentas administrativas da plataforma — visíveis só para a equipe.</p>
      </div>
      <div className="admin-panel-body">
        <nav className="admin-nav">
          <input
            className="admin-nav-search"
            placeholder="Buscar ferramenta..."
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
          />
          <div className="admin-nav-group">
            <div className="admin-nav-group-label">Ferramentas</div>
            <button className="admin-nav-item" onClick={() => navigate('/admin/interface-editor')}>🎨 Editor de Interface</button>
          </div>
          {visibleGroups.map((group) => {
            const isCollapsed = !normalizedQuery && collapsedGroups[group.label] && group.label !== currentGroupLabel;
            return (
              <div key={group.label} className="admin-nav-group">
                <button type="button" className="admin-nav-group-label admin-nav-group-toggle" onClick={() => toggleGroup(group.label)}>
                  <span>{group.label}</span>
                  <span className="admin-nav-group-chevron">{isCollapsed ? '▸' : '▾'}</span>
                </button>
                {!isCollapsed && group.tabs.map((t) => (
                  <button key={t} className={`admin-nav-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
            );
          })}
          {normalizedQuery && visibleGroups.length === 0 && (
            <p className="dim admin-nav-empty">Nenhuma ferramenta encontrada.</p>
          )}
        </nav>
        <div className="admin-content">
          {currentGroupLabel && (
            <div className="admin-content-breadcrumb dim">{currentGroupLabel} <span>›</span> {TAB_LABEL[tab]}</div>
          )}
          {tab === 'stats' && <StatsTab />}
          {tab === 'inscricoes' && <ApplicationsTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'badges' && <BadgesTab />}
          {tab === 'logs' && <LogsTab />}
          {tab === 'maintenance' && <MaintenanceTab />}
          {tab === 'announcements' && <AnnouncementsTab />}
          {tab === 'album' && <AlbumLayoutTab />}
          {tab === 'economia' && <EconomyAdminTab />}
          {tab === 'casas' && <HousesAdminTab />}
          {tab === 'sistema' && <SystemTab />}
          {tab === 'moderacao' && <ModerationTab />}
          {tab === 'automodDm' && <AutomodDmTab />}
          {tab === 'feeds' && <FeedsAdminTab />}
          {tab === 'roles' && <RolesAdminTab />}
          {tab === 'channels' && <ChannelsAdminTab />}
          {tab === 'achievements' && <AchievementsAdminTab />}
          {tab === 'updates' && <UpdatesAdminTab />}
          {tab === 'events' && <EventsAdminTab />}
          {tab === 'honeypot' && <HoneypotAdminTab />}
          {tab === 'reload' && <ReloadAdminTab />}
        </div>
      </div>
    </div>
  );
}

// Segurança "isca" (honeypot) — mostra quem tentou acessar rotas que só
// scanners automatizados conhecem (/wp-admin, /.env, /phpmyadmin, etc) e
// os IPs banidos automaticamente por causa disso, com botão pra
// desbloquear manualmente (útil se um IP compartilhado/corporativo cair
// aqui sem querer).
function HoneypotAdminTab() {
  const [hits, setHits] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [subTab, setSubTab] = useState('blocked');

  const refresh = () => {
    adminListBlockedIps().then((d) => setBlocked(d.blocked));
    adminListHoneypotHits().then((d) => setHits(d.hits));
  };
  useEffect(() => { refresh(); }, []);

  const unblock = async (ip) => {
    await adminUnblockIp(ip);
    setBlocked((list) => list.filter((b) => b.ip !== ip));
  };

  return (
    <div>
      <h2>🕸️ Segurança (Honeypot)</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Rotas falsas (/wp-admin, /.env, /phpmyadmin e outras) que só scanners automatizados tentam acessar —
        gente de verdade usando o site nunca bate nelas. Quem tenta é banido automaticamente e recebe dados falsos
        em vez de qualquer informação real.
      </p>
      <div className="mod-tabs">
        <button className={`mod-tab ${subTab === 'blocked' ? 'active' : ''}`} onClick={() => setSubTab('blocked')}>IPs bloqueados</button>
        <button className={`mod-tab ${subTab === 'hits' ? 'active' : ''}`} onClick={() => setSubTab('hits')}>Histórico de tentativas</button>
      </div>

      {subTab === 'blocked' && (
        blocked === null ? <p className="dim">Carregando...</p> : blocked.length === 0 ? (
          <p className="dim">Nenhum IP bloqueado — nenhum scanner caiu na isca ainda.</p>
        ) : (
          <div className="admin-users-list">
            {blocked.map((b) => (
              <div key={b.id} className="admin-user-row">
                <div className="admin-user-row-info">
                  <div className="admin-user-row-name">{b.ip}</div>
                  <div className="admin-user-row-meta dim">
                    {b.reason} · {b.hitCount} tentativa{b.hitCount === 1 ? '' : 's'} · desde {new Date(b.createdAt).toLocaleString('pt-BR')}
                  </div>
                </div>
                <button className="btn-secondary" onClick={() => unblock(b.ip)}>Desbloquear</button>
              </div>
            ))}
          </div>
        )
      )}

      {subTab === 'hits' && (
        hits === null ? <p className="dim">Carregando...</p> : hits.length === 0 ? (
          <p className="dim">Nenhuma tentativa registrada ainda.</p>
        ) : (
          <div className="audit-log-list">
            {hits.map((h) => (
              <div key={h.id} className="audit-log-entry">
                <span className="audit-action">{h.ip}</span> tentou <code>{h.method} {h.path}</code>
                <div className="audit-meta">{h.userAgent || 'sem user-agent'} · {new Date(h.createdAt).toLocaleString('pt-BR')}</div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// "Reload" — força todo mundo a aparecer offline até recarregar a
// página (ver presenceStore.clearAll() no backend pro porquê disso é
// seguro: só mexe num cache temporário de presença, nunca em sessão,
// token ou dado de conta). Útil depois de um deploy/restart, quando o
// status de presença de quem já estava conectado pode ter ficado
// dessincronizado.
function ReloadAdminTab() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const runReloadUser = async () => {
    if (!confirm('Isso faz TODO MUNDO aparecer offline temporariamente, até recarregar a página. Ninguém é desconectado, nenhum dado é apagado. Continuar?')) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await adminReloadUserPresence();
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível executar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>🔄 Reload</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Ferramentas de sincronização — corrigem estados que podem ter ficado dessincronizados sem precisar mexer
        conta por conta.
      </p>
      <div className="settings-block">
        <h4>Reload User</h4>
        <p className="dim">
          Atualiza o status de presença (online/ausente/ocupado/offline) de todo mundo de uma vez — todo usuário
          aparece <b>temporariamente offline</b> pros outros até recarregar a página, quando volta a ficar online
          normalmente sozinho. Ninguém é desconectado, nenhuma sessão é encerrada, nenhum dado é alterado — só o
          cache de presença é limpo.
        </p>
        <button className="btn-secondary" disabled={busy} onClick={runReloadUser}>
          {busy ? 'Executando...' : 'Reload User'}
        </button>
        {result && <p className="dim" style={{ marginTop: 8 }}>Feito — {result.cleared} conexão(ões) de presença foram limpas.</p>}
        {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

// Gestão de Cargos — a UI de verdade (RoleManagerModal.jsx) já existia e
// já funcionava contra as rotas reais de /community/roles (criar, editar
// permissões, cor, ícone, reordenar, excluir — tudo já validado na
// auditoria de segurança anterior contra escalonamento de privilégio),
// só nunca tinha um jeito de abrir ela: ela vivia dentro do
// ChannelSidebar.jsx antigo, que não é mais renderizado em lugar nenhum
// desde a troca pra MainSidebar. Esta aba só reconecta o botão — o modal
// em si não precisou de nenhuma mudança.
function RolesAdminTab() {
  const roles = useStore((s) => s.roles);
  const [managerOpen, setManagerOpen] = useState(false);
  const realRoles = roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);

  return (
    <div>
      <h2>🎭 Cargos da comunidade</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Crie cargos, defina cor/ícone, escolha as permissões e a ordem de exibição. As mudanças salvam na hora e
        aparecem pra todo mundo (mesmas rotas usadas pelo restante do app — nenhum dado fica só na tela).
      </p>
      <button className="btn-primary" onClick={() => setManagerOpen(true)}>Gerenciar cargos</button>

      <div className="admin-users-list" style={{ marginTop: 16 }}>
        {realRoles.length === 0 && <p className="dim">Nenhum cargo criado ainda (além do cargo padrão @todos).</p>}
        {realRoles.map((r) => (
          <div key={r.id} className="admin-user-row">
            <span className="role-chip" style={roleChipStyle(r.color)}>{r.icon ? `${r.icon} ` : ''}{r.name}</span>
            <span className="dim" style={{ marginLeft: 'auto' }}>posição {r.position}</span>
          </div>
        ))}
      </div>

      {managerOpen && <RoleManagerModal onClose={() => setManagerOpen(false)} />}
    </div>
  );
}

// Gestão de Canais e Categorias — mesma história do RolesAdminTab: o
// backend (categoryController.js/channelController.js) e o modal de criar
// canal (CreateChannelModal.jsx) já existiam prontos, só sem nenhum ponto
// de entrada na interface atual. Reordenar aqui troca as POSIÇÕES reais
// no banco (via reorderChannels/reorderCategories — a mesma rota
// transacional já auditada), não é só uma ordem visual local.
function ChannelsAdminTab() {
  const categories = useStore((s) => s.categories);
  const uncategorized = useStore((s) => s.channels);
  const [creatingFor, setCreatingFor] = useState(undefined); // categoryId (ou null pra "sem categoria") — undefined = fechado
  const [error, setError] = useState('');

  const sortedCategories = [...categories].sort((a, b) => a.position - b.position);

  // BUG CORRIGIDO ("criar categoria não funciona" / "não dá pra excluir
  // canal"): essas ações chamavam a API e ficavam esperando o evento de
  // socket (category:new, channel:delete...) voltar pra atualizar a
  // tela — igual o resto do app já faz. Só que aqui, sem NENHUM
  // try/catch, qualquer erro (nome inválido, sessão expirada, etc.)
  // ficava completamente silencioso: a pessoa clicava, nada acontecia
  // na tela, e não tinha nenhuma mensagem dizendo por quê. Agora toda
  // ação: (1) mostra o erro de verdade se falhar, e (2) já busca a
  // comunidade atualizada e escreve direto no estado global assim que
  // termina — mesmo padrão que CreateChannelModal.jsx já usava —, então
  // a tela muda na hora, sem depender só do socket chegar de volta.
  const refreshAfter = async (action) => {
    setError('');
    try {
      await action();
      const data = await getCommunity();
      useStore.getState().setCommunityStructure({
        categories: data.categories, channels: data.channels, members: data.members, roles: data.roles,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível concluir essa ação.');
    }
  };

  const addCategory = () => {
    const name = prompt('Nome da nova categoria:');
    if (!name?.trim()) return;
    refreshAfter(() => createCategory(name.trim()));
  };

  const renameCategory = (cat) => {
    const name = prompt('Novo nome da categoria:', cat.name);
    if (!name?.trim() || name === cat.name) return;
    refreshAfter(() => updateCategory(cat.id, name.trim()));
  };

  const removeCategory = (cat) => {
    if (!confirm(`Excluir a categoria "${cat.name}"? Os canais dela ficam sem categoria (não são apagados).`)) return;
    refreshAfter(() => deleteCategory(cat.id));
  };

  const removeChannel = (ch) => {
    if (!confirm(`Excluir o canal "${ch.name}"? Todas as mensagens dele são perdidas — isso não pode ser desfeito.`)) return;
    refreshAfter(() => deleteChannel(ch.id));
  };

  const moveCategory = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sortedCategories.length) return;
    const order = sortedCategories.map((c) => c.id);
    [order[index], order[target]] = [order[target], order[index]];
    refreshAfter(() => reorderCategories(order));
  };

  const moveChannel = (categoryId, list, index, direction) => {
    const sorted = [...list].sort((a, b) => a.position - b.position);
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
    const order = sorted.map((ch, i) => ({ id: ch.id, categoryId: categoryId ?? null, position: i }));
    refreshAfter(() => reorderChannels(order));
  };

  const renderChannelRow = (categoryId, list, ch, i) => (
    <div key={ch.id} className="admin-user-row">
      <span className="dim" style={{ width: 18, textAlign: 'center' }}>{ch.type === 'VOICE' || ch.type === 'STAGE' ? '🔊' : '#'}</span>
      <div className="admin-user-row-info"><div className="admin-user-row-name">{ch.name}</div></div>
      <button className="btn-link" disabled={i === 0} onClick={() => moveChannel(categoryId, list, i, -1)}>▲</button>
      <button className="btn-link" disabled={i === list.length - 1} onClick={() => moveChannel(categoryId, list, i, 1)}>▼</button>
      <button className="btn-link danger" onClick={() => removeChannel(ch)}>Excluir</button>
    </div>
  );

  return (
    <div>
      <h2># Canais e Categorias</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Crie, exclua e reordene os canais e categorias da comunidade. A ordem aqui é a mesma que todo mundo vê na
        barra lateral — mover um item já salva a posição real no banco.
      </p>
      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="admin-badges-toolbar">
        <button className="btn-secondary" onClick={addCategory}>+ Nova categoria</button>
        <button className="btn-secondary" onClick={() => setCreatingFor(null)}>+ Canal sem categoria</button>
      </div>

      {sortedCategories.map((cat, ci) => (
        <div key={cat.id} className="settings-block" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ flex: 1 }}>{cat.name}</b>
            <button className="btn-link" disabled={ci === 0} onClick={() => moveCategory(ci, -1)}>▲</button>
            <button className="btn-link" disabled={ci === sortedCategories.length - 1} onClick={() => moveCategory(ci, 1)}>▼</button>
            <button className="btn-link" onClick={() => renameCategory(cat)}>Renomear</button>
            <button className="btn-link" onClick={() => setCreatingFor(cat.id)}>+ Canal</button>
            <button className="btn-link danger" onClick={() => removeCategory(cat)}>Excluir</button>
          </div>
          <div style={{ marginTop: 8 }}>
            {(cat.channels || []).length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nenhum canal nesta categoria.</p>}
            {[...(cat.channels || [])].sort((a, b) => a.position - b.position).map((ch, i, list) => renderChannelRow(cat.id, list, ch, i))}
          </div>
        </div>
      ))}

      <div className="settings-block" style={{ marginTop: 14 }}>
        <b>Sem categoria</b>
        <div style={{ marginTop: 8 }}>
          {uncategorized.length === 0 && <p className="dim" style={{ fontSize: 13 }}>Nenhum canal solto.</p>}
          {[...uncategorized].sort((a, b) => a.position - b.position).map((ch, i, list) => renderChannelRow(null, list, ch, i))}
        </div>
      </div>

      {creatingFor !== undefined && (
        <CreateChannelModal categoryId={creatingFor} onClose={() => setCreatingFor(undefined)} />
      )}
    </div>
  );
}

// Gestão de Conquistas — o catálogo agora vive no banco (Achievement),
// staff edita nome/descrição/raridade/meta/tipo de progresso e pode
// trocar o ícone individual de cada uma (upload próprio sobrescreve o
// ícone padrão de medalha usado no resto do app). Tudo em tempo real —
// qualquer edição emite achievement:catalog-update (ver
// achievementsController.js), então quem estiver na tela de Conquistas
// vê a mudança na hora.
function AchievementsAdminTab() {
  const [achievements, setAchievements] = useState(null);
  const [rarities, setRarities] = useState([]);
  const [progressTypes, setProgressTypes] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => adminListAchievements().then((d) => {
    setAchievements(d.achievements);
    setRarities(d.rarities);
    setProgressTypes(d.progressTypes);
  }).catch(() => setAchievements([]));
  useEffect(() => { refresh(); }, []);

  const remove = async (a) => {
    if (!confirm(`Excluir a conquista "${a.name}"? Quem já desbloqueou mantém o histórico, mas ela some do catálogo.`)) return;
    try {
      await adminDeleteAchievement(a.id);
      refresh();
    } catch (err) { setError(err.response?.data?.error || 'Erro ao excluir.'); }
  };

  if (!achievements) return <p className="dim">Carregando...</p>;

  return (
    <div>
      <h2>🏆 Conquistas</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Crie, edite e defina a raridade das conquistas. O ícone padrão (medalha) é usado em qualquer uma sem ícone
        próprio — dá pra trocar individualmente clicando em "Editar".
      </p>
      {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
      <button className="btn-secondary" style={{ marginBottom: 12 }} onClick={() => setCreating(true)}>+ Nova conquista</button>
      {creating && (
        <AchievementForm
          progressTypes={progressTypes}
          rarities={rarities}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); refresh(); }}
        />
      )}
      <div className="admin-users-list">
        {achievements.map((a) => (
          <div key={a.id}>
            <div className="admin-user-row">
              <img src={proxyImage(a.iconUrl) || achievementsDefaultIconUrl} alt="" style={{ width: 32, height: 32 }} />
              <div className="admin-user-row-info">
                <div className="admin-user-row-name">{a.name} {!a.enabled && <span className="dim">(desativada)</span>}</div>
                <div className="admin-user-row-meta dim">{ACHIEVEMENT_RARITY_LABEL[a.rarity]} · {a.progressType} · meta {a.target}</div>
              </div>
              <button className="btn-secondary" onClick={() => setEditingId(editingId === a.id ? null : a.id)}>Editar</button>
              <button className="btn-danger" onClick={() => remove(a)}>Excluir</button>
            </div>
            {editingId === a.id && (
              <AchievementForm
                achievement={a}
                progressTypes={progressTypes}
                rarities={rarities}
                onClose={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); refresh(); }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AchievementForm({ achievement, progressTypes, rarities, onClose, onSaved }) {
  const isEdit = !!achievement;
  const [key, setKey] = useState(achievement?.key || '');
  const [name, setName] = useState(achievement?.name || '');
  const [description, setDescription] = useState(achievement?.description || '');
  const [rarity, setRarity] = useState(achievement?.rarity || 'COMMON');
  const [progressType, setProgressType] = useState(achievement?.progressType || progressTypes[0]);
  const [target, setTarget] = useState(achievement?.target || 1);
  const [enabled, setEnabled] = useState(achievement?.enabled ?? true);
  const [iconFile, setIconFile] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      let id = achievement?.id;
      if (isEdit) {
        await adminUpdateAchievement(id, { name, description, rarity, progressType, target, enabled });
      } else {
        const { achievement: created } = await adminCreateAchievement({ key, name, description, rarity, progressType, target });
        id = created.id;
      }
      if (iconFile) await adminUploadAchievementIcon(id, iconFile);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Erro ao salvar.'); }
  };

  return (
    <form onSubmit={submit} className="settings-block communities-inline-form">
      {!isEdit && <label>CHAVE (identificador interno)<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="ex: super_fa" required /></label>}
      <label>NOME<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
      <label>DESCRIÇÃO<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} required /></label>
      <label>RARIDADE
        <select value={rarity} onChange={(e) => setRarity(e.target.value)}>
          {rarities.map((r) => <option key={r} value={r}>{ACHIEVEMENT_RARITY_LABEL[r]}</option>)}
        </select>
      </label>
      <label>TIPO DE PROGRESSO
        <select value={progressType} onChange={(e) => setProgressType(e.target.value)}>
          {progressTypes.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label>META (valor pra desbloquear)<input type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} required /></label>
      <label className="checkbox-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Ativa (aparece no catálogo)</label>
      <label>ÍCONE (opcional — usa a medalha padrão se não escolher nenhum)
        <input type="file" accept="image/*" onChange={(e) => setIconFile(e.target.files[0])} />
      </label>
      {error && <div className="auth-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary">Salvar</button>
      </div>
    </form>
  );
}

// Gestão de Atualizações (changelog) — publica, aparece pra todo mundo em
// tempo real (update:new via socket), staff pode excluir depois.
// Item pedido: "número de atualiza vai pra v1.0, estilo de versão" +
// "poder editar elas" + "adicione os - ** __ que deixa mais bonito".
function UpdatesAdminTab() {
  const [updates, setUpdates] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('');
  const [error, setError] = useState('');

  const refresh = () => listUpdates().then((d) => setUpdates(d.updates));
  useEffect(() => { refresh(); }, []);

  // Sugere a próxima versão automaticamente com base na última
  // publicada (v1.0 -> v1.1, e assim por diante) — só quando a pessoa
  // ainda não começou a digitar uma versão própria, e só ao entrar em
  // modo de CRIAR (não ao editar, onde já mostramos a versão real
  // daquela entrada).
  useEffect(() => {
    if (editingId || !updates || version) return;
    const last = updates[0]?.version;
    const match = last?.match(/^v?(\d+)\.(\d+)$/i);
    setVersion(match ? `v${match[1]}.${Number(match[2]) + 1}` : (updates.length === 0 ? 'v1.0' : ''));
  }, [updates, editingId]);

  const resetForm = () => { setEditingId(null); setTitle(''); setDescription(''); setVersion(''); setError(''); };

  const startEdit = (u) => {
    setEditingId(u.id); setTitle(u.title); setDescription(u.description); setVersion(u.version || '');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (editingId) {
        await updateUpdateEntry(editingId, { title, description, version });
      } else {
        await createUpdate({ title, description, version });
      }
      resetForm();
      refresh();
    } catch (err) { setError(err.response?.data?.error || 'Erro ao salvar.'); }
  };

  const remove = async (id) => {
    if (!confirm('Excluir essa atualização?')) return;
    await deleteUpdateEntry(id);
    if (editingId === id) resetForm();
    refresh();
  };

  if (!updates) return <p className="dim">Carregando...</p>;

  return (
    <div>
      <h2>📰 Atualizações</h2>
      <p className="dim" style={{ marginBottom: 16 }}>Publique novidades e mudanças recentes — aparece pra todo mundo em tempo real.</p>
      <form onSubmit={submit} className="settings-block communities-inline-form">
        <div className="display-name-row">
          <label style={{ flex: 1 }}>TÍTULO<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required /></label>
          <label style={{ maxWidth: 110 }}>VERSÃO<input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.0" maxLength={30} /></label>
        </div>
        <label>
          DESCRIÇÃO
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} required />
        </label>
        <p className="dim" style={{ fontSize: 12, marginTop: -4 }}>Dá pra usar **negrito**, __sublinhado__ e linhas começando com "- " pra fazer uma lista.</p>
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <button type="submit" className="btn-primary">{editingId ? 'Salvar edição' : 'Publicar'}</button>
          {editingId && <button type="button" className="btn-secondary" onClick={resetForm}>Cancelar edição</button>}
        </div>
      </form>
      <div className="admin-users-list" style={{ marginTop: 16 }}>
        {updates.map((u) => (
          <div key={u.id} className="admin-user-row">
            <div className="admin-user-row-info">
              <div className="admin-user-row-name">{u.title}{u.version ? ` · ${u.version}` : ''}</div>
              <div className="admin-user-row-meta dim">{new Date(u.createdAt).toLocaleString('pt-BR')} · {u.createdBy.displayName}</div>
            </div>
            <button className="btn-secondary" onClick={() => startEdit(u)}>Editar</button>
            <button className="btn-danger" onClick={() => remove(u.id)}>Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Item pedido: "sistema de eventos integrado ao painel da Staff —
// somente usuários autorizados... poderão criar, editar ou excluir".
// Mesmo padrão exato de UpdatesAdminTab acima, com mais campos: banner/
// ícone (upload separado, precisa do evento já criado — mesmo padrão de
// createPost + uploadPostImage), datas e status editável inline.
function EventsAdminTab() {
  const [events, setEvents] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState('');

  const refresh = () => listEvents().then((d) => setEvents(d.events));
  useEffect(() => { refresh(); }, []);

  const publish = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await createEvent({ title, description, startsAt: startsAt || undefined, endsAt: endsAt || undefined });
      setTitle(''); setDescription(''); setStartsAt(''); setEndsAt('');
      refresh();
    } catch (err) { setError(err.response?.data?.error || 'Erro ao criar evento.'); }
  };

  const changeStatus = async (id, status) => {
    await updateEvent(id, { status });
    refresh();
  };

  const onBanner = async (id, e) => {
    const file = e.target.files[0]; if (!file) return;
    await uploadEventBanner(id, file);
    refresh();
  };

  const onIcon = async (id, e) => {
    const file = e.target.files[0]; if (!file) return;
    await uploadEventIcon(id, file);
    refresh();
  };

  const remove = async (id) => {
    if (!confirm('Excluir esse evento?')) return;
    await deleteEvent(id);
    refresh();
  };

  if (!events) return <p className="dim">Carregando...</p>;

  return (
    <div>
      <h2>🎉 Eventos</h2>
      <p className="dim" style={{ marginBottom: 16 }}>Crie e gerencie eventos — aparecem automaticamente na categoria Início pra todo mundo.</p>
      <form onSubmit={publish} className="settings-block communities-inline-form">
        <label>TÍTULO<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required /></label>
        <label>DESCRIÇÃO<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} required /></label>
        <div className="display-name-row">
          <label>INÍCIO (opcional)<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label>FIM (opcional)<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary">Criar evento</button>
      </form>
      <div className="admin-users-list" style={{ marginTop: 16 }}>
        {events.map((ev) => (
          <div key={ev.id} className="admin-user-row">
            <div className="admin-user-row-info">
              <div className="admin-user-row-name">{ev.title}</div>
              <div className="admin-user-row-meta dim">Criado por {ev.createdBy.displayName}</div>
            </div>
            <select value={ev.status} onChange={(e) => changeStatus(ev.id, e.target.value)}>
              <option value="UPCOMING">Em breve</option>
              <option value="ACTIVE">Ativo</option>
              <option value="ENDED">Encerrado</option>
            </select>
            <label className="btn-secondary">Banner<input type="file" accept="image/*" hidden onChange={(e) => onBanner(ev.id, e)} /></label>
            <label className="btn-secondary">Ícone<input type="file" accept="image/*" hidden onChange={(e) => onIcon(ev.id, e)} /></label>
            <button className="btn-danger" onClick={() => remove(ev.id)}>Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Gestão de Feeds (comunidades tipo subreddit — ver a fusão com o Reddit
// clone) — a staff pode excluir qualquer comunidade daqui, mesmo sem ter
// sido quem criou (poder de moderação da plataforma). Apagar remove
// também todos os posts/comentários/votos dela em cascata (ver onDelete:
// Cascade no schema.prisma).
function FeedsAdminTab() {
  const communities = useStore((s) => s.clubs);
  const [deletingSlug, setDeletingSlug] = useState(null);

  const remove = async (community) => {
    if (!confirm(`Excluir o Clube "${community.name}"? Isso apaga todos os posts e comentários dele e não pode ser desfeito.`)) return;
    setDeletingSlug(community.slug);
    try {
      await deleteCommunity(community.slug);
      // Não precisa remover manualmente da lista — o evento de socket
      // club:delete (ver SocketContext.jsx) já atualiza o estado global
      // sozinho assim que o servidor confirma.
    } catch (err) {
      alert(err.response?.data?.error || 'Não foi possível excluir.');
    } finally {
      setDeletingSlug(null);
    }
  };

  return (
    <div>
      <h2>Feeds (Clubes)</h2>
      <p className="dim" style={{ marginBottom: 16 }}>
        Gerencie os Clubes do Feed — só a staff pode criar/editar/excluir (crie novos direto na página de Feeds,
        no botão "+ Criar Clube"). Excluir remove os posts e comentários junto.
      </p>
      {communities.length === 0 ? (
        <p className="dim">Nenhum Clube criado ainda.</p>
      ) : (
        <div className="admin-users-list">
          {communities.map((c) => (
            <div key={c.id} className="admin-user-row">
              <span className="community-row-icon" style={{ width: 32, height: 32 }}>
                {c.iconUrl ? <img src={proxyImage(c.iconUrl)} alt="" /> : '📌'}
              </span>
              <div className="admin-user-row-info">
                <div className="admin-user-row-name">{c.name}</div>
                <div className="admin-user-row-meta dim">
                  {c.postCount} post{c.postCount === 1 ? '' : 's'} · {(c.categories || []).length} categoria{(c.categories || []).length === 1 ? '' : 's'} · criado por {c.createdBy.displayName}
                </div>
              </div>
              <button className="btn-danger" disabled={deletingSlug === c.slug} onClick={() => remove(c)}>
                {deletingSlug === c.slug ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementsTab() {
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [form, setForm] = useState({
    targetType: 'ALL', title: '', description: '', buttonLabel: '', buttonUrl: '',
  });
  const [bannerFile, setBannerFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    adminListAnnouncements().then((d) => setHistory(d.announcements));
  }, []);

  useEffect(() => {
    if (userQuery.trim().length < 2) return setUserResults([]);
    const t = setTimeout(() => {
      adminListUsers(userQuery).then((d) => setUserResults(d.users));
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery]);

  const send = async () => {
    setError('');
    if (!form.title.trim()) return setError('Título é obrigatório.');
    if (form.targetType === 'USER' && !selectedUser) return setError('Selecione um usuário.');
    setSending(true);
    try {
      const { announcement } = await adminCreateAnnouncement({
        ...form, targetUserId: selectedUser?.id || undefined,
      });
      if (bannerFile) await adminUploadAnnouncementBanner(announcement.id, bannerFile).catch(() => {});
      setSent(true);
      setForm({ targetType: 'ALL', title: '', description: '', buttonLabel: '', buttonUrl: '' });
      setSelectedUser(null);
      setBannerFile(null);
      adminListAnnouncements().then((d) => setHistory(d.announcements));
      setTimeout(() => setSent(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="settings-grid" style={{ maxWidth: 560 }}>
      <div className="settings-block">
        <h4>Enviar mensagem</h4>
        <p className="dim">
          Aparece como um aviso de tela cheia pra quem você escolher, com botão OK pra dispensar. Quem estiver offline
          vê assim que voltar a entrar.
        </p>

        <label>
          Público-alvo
          <select value={form.targetType} onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value }))}>
            <option value="ALL">Todos os usuários</option>
            <option value="USER">Um usuário específico</option>
          </select>
        </label>

        {form.targetType === 'USER' && (
          <label>
            Buscar usuário
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Nome de usuário..." />
            {selectedUser && <div className="dim">Selecionado: {selectedUser.displayName} (@{selectedUser.username})</div>}
            {userResults.length > 0 && (
              <ul className="user-search-results">
                {userResults.map((u) => (
                  <li key={u.id} onClick={() => { setSelectedUser(u); setUserResults([]); setUserQuery(''); }}>
                    {u.displayName} <span className="dim">@{u.username}</span>
                  </li>
                ))}
              </ul>
            )}
          </label>
        )}

        <label>
          Título
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={100} />
        </label>
        <label>
          Descrição (opcional)
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} maxLength={1000} />
        </label>
        <label>
          Banner (opcional)
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setBannerFile(e.target.files[0] || null)} />
        </label>
        <div className="display-name-row">
          <label>Texto do botão (opcional)<input value={form.buttonLabel} onChange={(e) => setForm((f) => ({ ...f, buttonLabel: e.target.value }))} maxLength={40} /></label>
          <label>Link do botão (opcional)<input value={form.buttonUrl} onChange={(e) => setForm((f) => ({ ...f, buttonUrl: e.target.value }))} placeholder="https://..." /></label>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {sent && <div className="dim">Mensagem enviada!</div>}
        <button className="btn-primary" disabled={sending} onClick={send}>{sending ? 'Enviando...' : 'Enviar mensagem'}</button>
      </div>

      <div className="settings-block">
        <h4>Histórico</h4>
        <table className="admin-table">
          <thead><tr><th>Título</th><th>Alvo</th><th>Visualizações</th><th>Enviada em</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td>{a.title}</td>
                <td className="dim">{a.targetType}</td>
                <td className="dim">{a._count?.dismissals ?? 0}</td>
                <td className="dim">{new Date(a.createdAt).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaintenanceTab() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = () => getPlatformStatus().then((d) => { setStatus(d); setMessage(d.maintenanceMessage || ''); });
  useEffect(() => { refresh(); }, []);

  const toggle = async () => {
    setSaving(true);
    try {
      const d = await adminSetMaintenanceMode(!status.maintenanceMode, message);
      setStatus(d);
    } finally {
      setSaving(false);
    }
  };

  if (!status) return <div className="dim">Carregando...</div>;

  return (
    <div className="settings-grid" style={{ maxWidth: 480 }}>
      <div className="settings-block">
        <h4>Modo "Em reforma"</h4>
        <p className="dim">
          Quando ativado, só a equipe (ADMIN/MODERATOR) consegue usar a plataforma normalmente — todo o resto vê uma
          tela de manutenção. A equipe também vê essa tela primeiro, com um botão pra entrar mesmo assim.
        </p>
        <p>
          Status atual: <b className={status.maintenanceMode ? 'text-danger' : ''}>{status.maintenanceMode ? 'Em manutenção' : 'Normal'}</b>
        </p>
        <label>
          Mensagem exibida na tela de manutenção (opcional)
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Já estamos arrumando algumas coisas por aqui. Volte daqui a pouco!" />
        </label>
        <button className={status.maintenanceMode ? 'btn-secondary' : 'btn-danger'} disabled={saving} onClick={toggle}>
          {saving ? 'Salvando...' : status.maintenanceMode ? 'Desativar manutenção' : 'Ativar manutenção'}
        </button>
      </div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { adminGetStats().then((d) => setStats(d.stats)); }, []);
  if (!stats) return <div className="dim">Carregando...</div>;
  const cards = [
    ['Usuários', stats.userCount],
    ['Servidores', stats.serverCount],
    ['Servidores públicos', stats.publicServerCount],
    ['Mensagens enviadas', stats.messageCount],
    ['Contas banidas', stats.bannedCount],
    ['Novos usuários (24h)', stats.newUsersLast24h],
  ];
  return (
    <div className="admin-stats-grid">
      {cards.map(([label, value]) => (
        <div key={label} className="admin-stat-card">
          <div className="admin-stat-value">{value}</div>
          <div className="dim">{label}</div>
        </div>
      ))}
    </div>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState([]);
  const [badgeMenuFor, setBadgeMenuFor] = useState(null);
  const [actionsMenuFor, setActionsMenuFor] = useState(null);
  const [securityInfoFor, setSecurityInfoFor] = useState(null);
  const [deleteAccountFor, setDeleteAccountFor] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try { const { users } = await adminListUsers(q); setUsers(users); } finally { setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(refresh, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { adminListBadges().then((d) => setBadges(d.badges)).catch(() => {}); }, []);

  const editUser = async (u) => {
    const displayName = prompt('Nome de exibição:', u.displayName);
    if (!displayName) return;
    await adminUpdateUser(u.id, { displayName });
    await refresh();
  };

  const ban = async (u) => {
    const reason = prompt(`Banir ${u.displayName} da plataforma. Motivo:`);
    if (reason === null) return;
    await adminBanUser(u.id, reason || undefined);
    await refresh();
  };

  const unban = async (u) => { await adminUnbanUser(u.id); await refresh(); };

  const suspend = async (u) => {
    const hours = prompt('Suspender por quantas horas?', '24');
    if (!hours) return;
    const reason = prompt('Motivo (opcional):') || undefined;
    await adminSuspendUser(u.id, Number(hours), reason);
    await refresh();
  };

  const unsuspend = async (u) => { await adminUnsuspendUser(u.id); await refresh(); };

  const changeRole = async (u, role) => { await adminSetPlatformRole(u.id, role); await refresh(); };

  const toggleBadge = async (u, badgeId, has) => {
    if (has) await adminRevokeBadge(u.id, badgeId); else await adminGrantBadge(u.id, badgeId);
    await refresh();
  };

  const [economyModalFor, setEconomyModalFor] = useState(null);

  return (
    <div>
      <input className="admin-search-input" placeholder="Buscar usuário..." value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? <div className="dim">Carregando...</div> : (
        <div className="admin-users-list">
          {users.map((u) => {
            const suspended = u.suspendedUntil && new Date(u.suspendedUntil) > new Date();
            const statusLabel = u.isPlatformBanned ? 'Banido' : suspended ? 'Suspenso' : 'Ativo';
            const statusClass = u.isPlatformBanned ? 'banned' : suspended ? 'suspended' : 'active';
            const userBadges = badges.filter((b) => (u.badgeIds || []).includes(b.id));
            return (
              <div key={u.id} className="admin-user-row">
                <UserAvatar user={u} size={40} />
                <div className="admin-user-row-info">
                  <div className="admin-user-row-name">
                    {u.displayName} <span className="dim">@{u.username}</span>
                    <span className={`admin-user-status-pill ${statusClass}`}>
                      {statusLabel}{suspended && ` até ${new Date(u.suspendedUntil).toLocaleDateString('pt-BR')}`}
                    </span>
                  </div>
                  <div className="admin-user-row-meta">
                    <span className="dim">🏆 Nível {u.accountLevel || 1}</span>
                    {userBadges.length > 0 && (
                      <span className="admin-user-badge-chips">
                        {userBadges.map((b) => (
                          <span key={b.id} title={b.name}>{badgeHasImage(b) ? <img className="admin-badge-icon-preview" src={proxyImage(b.iconUrl)} alt="" /> : b.icon}</span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>

                <select className="admin-user-role-select" value={u.platformRole} onChange={(e) => changeRole(u, e.target.value)}>
                  <option value="USER">Usuário</option>
                  <option value="MODERATOR">Moderador</option>
                  <option value="ADMIN">Administrador</option>
                </select>

                <span style={{ position: 'relative' }}>
                  <button className="btn-secondary" onClick={() => { setActionsMenuFor(actionsMenuFor === u.id ? null : u.id); setBadgeMenuFor(null); }}>Ações ▾</button>
                  {actionsMenuFor === u.id && (
                    <div className="role-picker mod-action-menu">
                      <button onClick={() => { editUser(u); setActionsMenuFor(null); }}><IconGlyph src={editIcon} size={14} /> Editar perfil</button>
                      <button onClick={() => { setBadgeMenuFor(u.id); setActionsMenuFor(null); }}>🏅 Insígnias</button>
                      <button onClick={() => { setEconomyModalFor(u); setActionsMenuFor(null); }}>💰 Nível, XP e moedas</button>
                      <button onClick={() => { setSecurityInfoFor(u.id); setActionsMenuFor(null); }}>🔒 Informações confidenciais</button>
                      <div className="dropdown-divider" />
                      {u.isPlatformBanned ? (
                        <button onClick={() => { unban(u); setActionsMenuFor(null); }}>Desbanir</button>
                      ) : (
                        <button className="danger" onClick={() => { ban(u); setActionsMenuFor(null); }}>Banir</button>
                      )}
                      {suspended ? (
                        <button onClick={() => { unsuspend(u); setActionsMenuFor(null); }}>Reativar (cancelar suspensão)</button>
                      ) : (
                        <button className="danger" onClick={() => { suspend(u); setActionsMenuFor(null); }}>Suspender</button>
                      )}
                      {me.platformRole === 'ADMIN' && u.id !== me.id && (
                        <>
                          <div className="dropdown-divider" />
                          <button className="danger" onClick={() => { setDeleteAccountFor(u); setActionsMenuFor(null); }}>🗑️ Excluir conta (irreversível)</button>
                        </>
                      )}
                    </div>
                  )}
                </span>
                <span style={{ position: 'relative' }}>
                  {badgeMenuFor === u.id && (
                    <div className="role-picker mod-action-menu">
                      {badges.map((b) => {
                        const has = (u.badgeIds || []).includes(b.id);
                        return (
                          <button key={b.id} className={has ? 'has-badge' : ''} onClick={() => toggleBadge(u, b.id, has)}>
                            {has ? '✅' : '➕'} {badgeHasImage(b) ? <img className="admin-badge-icon-preview" src={proxyImage(b.iconUrl)} alt="" /> : b.icon} {b.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {securityInfoFor && <UserSecurityInfoModal userId={securityInfoFor} onClose={() => setSecurityInfoFor(null)} />}
      {economyModalFor && (
        <UserEconomyModal
          user={economyModalFor}
          onClose={() => setEconomyModalFor(null)}
          onSaved={refresh}
        />
      )}
      {deleteAccountFor && (
        <DeleteAccountConfirmModal
          user={deleteAccountFor}
          onClose={() => setDeleteAccountFor(null)}
          onDeleted={() => { setDeleteAccountFor(null); refresh(); }}
        />
      )}
    </div>
  );
}

// Confirmação forte pra excluir conta — a staff precisa DIGITAR o
// @usuário exato (não é só clicar "confirmar"), igual GitHub/outras
// plataformas fazem pra ações destrutivas de verdade. O backend também
// valida esse mesmo texto de novo (nunca confia só na tela), então nem
// uma chamada direta na API sem passar por aqui teria como pular essa
// checagem.
function DeleteAccountConfirmModal({ user, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setDeleting(true);
    setError('');
    try {
      await adminDeleteUserAccount(user.id, confirmText);
      onDeleted();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível excluir.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal title="Excluir conta — ação irreversível" onClose={onClose}>
      <form onSubmit={submit} className="settings-grid">
        <p>
          Isso apaga <b>permanentemente</b> a conta de <b>{user.displayName}</b> (@{user.username}) — mensagens,
          posts, comentários, conversas, amizades, conquistas, casas, figurinhas, tudo. Não tem como desfazer.
        </p>
        <p>Digite <code>{user.username}</code> pra confirmar:</p>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={user.username} autoFocus />
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-link" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-danger" disabled={deleting || confirmText !== user.username}>
            {deleting ? 'Excluindo...' : 'Excluir permanentemente'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Substitui os 4 prompt() separados (nível/XP/moedas/gemas) por um único
// modal de verdade — mais fácil de usar e não trava o navegador com
// caixinhas de diálogo feias uma atrás da outra.
function UserEconomyModal({ user, onClose, onSaved }) {
  const [level, setLevel] = useState(String(user.accountLevel || 1));
  const [xpDelta, setXpDelta] = useState('0');
  const [coinsDelta, setCoinsDelta] = useState('0');
  const [gemsDelta, setGemsDelta] = useState('0');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const newLevel = parseInt(level, 10);
      if (newLevel && newLevel !== user.accountLevel) await adminSetUserLevel(user.id, newLevel);
      if (parseInt(xpDelta, 10)) await adminAddUserXp(user.id, parseInt(xpDelta, 10));
      if (parseInt(coinsDelta, 10) || parseInt(gemsDelta, 10)) {
        await adminAddUserCurrency(user.id, { coins: parseInt(coinsDelta, 10) || 0, gems: parseInt(gemsDelta, 10) || 0 });
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Nível, XP e moedas — ${user.displayName}`} onClose={onClose} width="380px">
      <div className="settings-grid">
        <label>NÍVEL (1-200)<input type="number" min="1" max="200" value={level} onChange={(e) => setLevel(e.target.value)} /></label>
        <label>ADICIONAR XP (negativo remove)<input type="number" value={xpDelta} onChange={(e) => setXpDelta(e.target.value)} /></label>
        <label>ADICIONAR MOEDAS (negativo retira)<input type="number" value={coinsDelta} onChange={(e) => setCoinsDelta(e.target.value)} /></label>
        <label>ADICIONAR GEMAS (negativo retira)<input type="number" value={gemsDelta} onChange={(e) => setGemsDelta(e.target.value)} /></label>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}

const PROTECTED_BADGE_KEYS = new Set(['STAFF', 'PLATFORM_OWNER', 'NEWCOMER']);

function BadgesTab() {
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // badge object being edited, or a blank draft for "new"
  const [form, setForm] = useState({ key: '', name: '', description: '', icon: '', rarity: 'COMMON', ageYears: '', priority: '0' });
  const [error, setError] = useState('');
  const [uploadingIcon, setUploadingIcon] = useState(false);

  const refresh = () => { setLoading(true); adminListBadges().then((d) => setBadges(d.badges)).finally(() => setLoading(false)); };
  useEffect(refresh, []);

  const startCreate = () => { setEditing('new'); setForm({ key: '', name: '', description: '', icon: '', rarity: 'COMMON', ageYears: '', priority: '0' }); setError(''); };
  const startEdit = (b) => { setEditing(b.id); setForm({ key: b.key, name: b.name, description: b.description || '', icon: b.icon, rarity: b.rarity || 'COMMON', ageYears: b.ageYears || '', priority: String(b.priority ?? 0) }); setError(''); };
  const cancel = () => { setEditing(null); setError(''); };

  const save = async () => {
    setError('');
    try {
      if (editing === 'new') {
        await adminCreateBadge(form);
      } else {
        await adminUpdateBadge(editing, { name: form.name, description: form.description, icon: form.icon, rarity: form.rarity, ageYears: form.ageYears || null, priority: form.priority });
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar a insígnia.');
    }
  };

  const onIconFile = async (e) => {
    const file = e.target.files[0];
    if (!file || editing === 'new') return; // image upload only works once the badge already exists (needs an id)
    setUploadingIcon(true);
    try {
      await adminUploadBadgeIcon(editing, file);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível enviar o ícone.');
    } finally {
      setUploadingIcon(false);
    }
  };

  const removeIconImage = async () => {
    setError('');
    try {
      await adminUpdateBadge(editing, { iconUrl: null });
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível remover o ícone.');
    }
  };

  const remove = async (b) => {
    if (!confirm(`Excluir a insígnia "${b.name}"? Ela será removida de todos os perfis que a possuem.`)) return;
    try { await adminDeleteBadge(b.id); refresh(); } catch (err) { alert(err.response?.data?.error || 'Não foi possível excluir.'); }
  };

  if (loading) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <div className="admin-badges-toolbar">
        <button className="btn-primary" onClick={startCreate}>+ Nova insígnia</button>
      </div>

      {editing && (
        <div className="admin-badge-form">
          <label>
            ÍCONE (emoji, usado se não houver imagem)
            <input value={form.icon} maxLength={8} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} placeholder="🏅" />
          </label>
          {editing !== 'new' && (
            <label>
              ÍCONE (imagem, opcional — tem prioridade sobre o emoji)
              <div className="admin-badge-icon-upload">
                {badges.find((b) => b.id === editing) && badgeHasImage(badges.find((b) => b.id === editing)) && (
                  <img className="admin-badge-icon-preview" src={proxyImage(badges.find((b) => b.id === editing).iconUrl)} alt="" />
                )}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploadingIcon} onChange={onIconFile} />
                {badges.find((b) => b.id === editing) && badgeHasImage(badges.find((b) => b.id === editing)) && (
                  <button type="button" className="btn-link danger" onClick={removeIconImage}>Remover imagem</button>
                )}
              </div>
            </label>
          )}
          <label>
            NOME
            <input value={form.name} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nome da insígnia" />
          </label>
          {editing === 'new' && (
            <label>
              CHAVE (identificador único, sem espaços)
              <input value={form.key} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} placeholder="EX_MINHA_INSIGNIA" />
            </label>
          )}
          <label>
            DESCRIÇÃO (opcional)
            <input value={form.description} maxLength={140} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>
          <label>
            RARIDADE
            <select value={form.rarity} onChange={(e) => setForm((f) => ({ ...f, rarity: e.target.value }))}>
              {BADGE_RARITIES.map((r) => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
            </select>
          </label>
          <label>
            ANOS DE CONTA (opcional — concede automaticamente ao completar X anos)
            <input
              type="number" min="1" value={form.ageYears}
              onChange={(e) => setForm((f) => ({ ...f, ageYears: e.target.value }))}
              placeholder="Ex: 1 (deixe vazio se não for uma insígnia de idade)"
            />
          </label>
          <label>
            ORDEM DE EXIBIÇÃO (menor número aparece primeiro quando o usuário tem várias insígnias)
            <input
              type="number" value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              placeholder="0"
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn-link" onClick={cancel}>Cancelar</button>
            <button className="btn-primary" onClick={save}>Salvar</button>
          </div>
        </div>
      )}

      <div className="admin-badge-grid">
        {badges.map((b) => (
          <div key={b.id} className="admin-badge-card">
            <div className="admin-badge-card-icon" style={{ '--rarity-color': RARITY_COLOR[b.rarity] || RARITY_COLOR.COMMON }}>
              {badgeHasImage(b) ? <img src={proxyImage(b.iconUrl)} alt="" /> : <span>{b.icon}</span>}
            </div>
            <div className="admin-badge-card-info">
              <div className="admin-badge-card-name-row">
                <b>{b.name}</b>
                <span className="badge-rarity-tag" style={{ color: RARITY_COLOR[b.rarity] || RARITY_COLOR.COMMON, borderColor: RARITY_COLOR[b.rarity] || RARITY_COLOR.COMMON }}>
                  {RARITY_LABEL[b.rarity] || RARITY_LABEL.COMMON}
                </span>
              </div>
              <div className="dim admin-badge-card-key">{b.key}</div>
              {b.description && <p className="dim admin-badge-card-desc">{b.description}</p>}
            </div>
            <div className="admin-table-actions">
              <button className="btn-link" onClick={() => startEdit(b)}>Editar</button>
              {!PROTECTED_BADGE_KEYS.has(b.key) && (
                <button className="btn-link danger" onClick={() => remove(b)}>Excluir</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { adminListAuditLog().then((d) => setLogs(d.logs)).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="dim">Carregando...</div>;
  if (logs.length === 0) return <div className="dim">Nenhuma ação administrativa registrada ainda.</div>;

  return (
    <ul className="audit-log-list">
      {logs.map((l) => (
        <li key={l.id} className="audit-log-entry">
          <span className="audit-action">{l.action}</span>
          <span className="dim"> por {l.actor?.displayName || l.actorId}</span>
          {l.targetType && <span className="dim"> · alvo: {l.targetType} {l.targetId}</span>}
          {l.reason && <span className="dim"> · motivo: {l.reason}</span>}
          <div className="audit-meta">{new Date(l.createdAt).toLocaleString('pt-BR')}</div>
        </li>
      ))}
    </ul>
  );
}

// Editor visual do layout do álbum de figurinhas — fiel ao painel do bot
// original (Painel > Imagens > Álbum): arrastar/redimensionar até 12
// espaços numa tela de referência, liga/desliga cada um, define o fundo
// (cor sólida ou imagem por URL), o número de páginas, e atribui qual
// figurinha fica fixa em qual (página, espaço).
function AlbumLayoutTab() {
  const [layout, setLayout] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [editPage, setEditPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const surfaceRef = useRef(null);
  const dragRef = useRef(null);

  const refresh = () => adminGetAlbumLayout().then(setLayout);
  useEffect(() => { refresh(); }, []);

  if (!layout) return <div className="dim">Carregando...</div>;
  const { settings } = layout;

  const enabledSlots = layout.slots.filter((s) => s.enabled);
  const stickersOnPage = layout.stickers.filter((s) => s.assignedPage === editPage);
  const slotsWithStickers = enabledSlots.map((slot) => ({
    ...slot,
    sticker: stickersOnPage.find((s) => s.assignedSlotKey === slot.slotKey) || null,
  }));

  const previewAlbum = { settings, slots: slotsWithStickers };

  const saveSettings = async (patch) => {
    const { settings: updated } = await adminUpdateAlbumSettings(patch);
    setLayout((l) => ({ ...l, settings: updated }));
  };

  const toggleSlot = async (slotKey, enabled) => {
    const { slot } = await adminUpsertAlbumSlot(slotKey, { enabled });
    setLayout((l) => ({ ...l, slots: l.slots.map((s) => (s.slotKey === slotKey ? slot : s)) }));
  };

  const saveSlotGeometry = async (slotKey, geometry) => {
    const { slot } = await adminUpsertAlbumSlot(slotKey, geometry);
    setLayout((l) => ({ ...l, slots: l.slots.map((s) => (s.slotKey === slotKey ? slot : s)) }));
  };

  const onSlotMouseDown = (e, slot) => {
    e.stopPropagation();
    setSelectedSlot(slot.slotKey);
    const rect = surfaceRef.current.getBoundingClientRect();
    const { clientX, clientY } = e.touches ? e.touches[0] : e;
    const scaleX = settings.width / rect.width;
    const scaleY = settings.height / rect.height;
    dragRef.current = {
      slotKey: slot.slotKey, mode: 'move',
      offsetX: (clientX - rect.left) * scaleX - slot.x,
      offsetY: (clientY - rect.top) * scaleY - slot.y,
    };
  };

  const onResizeMouseDown = (e, slot) => {
    e.stopPropagation();
    setSelectedSlot(slot.slotKey);
    const { clientX, clientY } = e.touches ? e.touches[0] : e;
    dragRef.current = { slotKey: slot.slotKey, mode: 'resize', startX: clientX, startY: clientY, startW: slot.width, startH: slot.height };
  };

  const onSurfaceMouseMove = (e) => {
    if (!dragRef.current) return;
    if (e.touches) e.preventDefault();
    const rect = surfaceRef.current.getBoundingClientRect();
    const { clientX, clientY } = e.touches ? e.touches[0] : e;
    const scaleX = settings.width / rect.width;
    const scaleY = settings.height / rect.height;
    const { slotKey, mode } = dragRef.current;

    if (mode === 'move') {
      const x = Math.max(0, Math.round((clientX - rect.left) * scaleX - dragRef.current.offsetX));
      const y = Math.max(0, Math.round((clientY - rect.top) * scaleY - dragRef.current.offsetY));
      setLayout((l) => ({ ...l, slots: l.slots.map((s) => (s.slotKey === slotKey ? { ...s, x, y } : s)) }));
    } else {
      const dx = (clientX - dragRef.current.startX) * scaleX;
      const dy = (clientY - dragRef.current.startY) * scaleY;
      const width = Math.max(40, Math.round(dragRef.current.startW + dx));
      const height = Math.max(40, Math.round(dragRef.current.startH + dy));
      setLayout((l) => ({ ...l, slots: l.slots.map((s) => (s.slotKey === slotKey ? { ...s, width, height } : s)) }));
    }
  };

  const onSurfaceMouseUp = () => {
    if (!dragRef.current) return;
    const slotKey = dragRef.current.slotKey;
    dragRef.current = null;
    const slot = layout.slots.find((s) => s.slotKey === slotKey);
    if (slot) saveSlotGeometry(slotKey, { x: slot.x, y: slot.y, width: slot.width, height: slot.height });
  };

  const assignSticker = async (slotKey, stickerId) => {
    setError('');
    try {
      if (stickerId) await adminAssignStickerPosition(stickerId, editPage, slotKey);
      // Se já havia outra figurinha nesse espaço nessa página, desvincula ela.
      const current = layout.stickers.find((s) => s.assignedPage === editPage && s.assignedSlotKey === slotKey);
      if (current && current.id !== stickerId) await adminAssignStickerPosition(current.id, editPage, null);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível atribuir.');
    }
  };

  const selected = layout.slots.find((s) => s.slotKey === selectedSlot);

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <label>Página <input type="number" min={1} max={settings.totalPages} value={editPage} onChange={(e) => setEditPage(Math.max(1, parseInt(e.target.value, 10) || 1))} style={{ width: 60 }} /></label>
          <span className="dim">de {settings.totalPages}</span>
        </div>

        <div
          ref={surfaceRef}
          onMouseMove={onSurfaceMouseMove}
          onMouseUp={onSurfaceMouseUp}
          onMouseLeave={onSurfaceMouseUp}
          onTouchMove={onSurfaceMouseMove}
          onTouchEnd={onSurfaceMouseUp}
          onClick={() => setSelectedSlot(null)}
          style={{ maxWidth: 640 }}
        >
          <div
            className="album-surface admin-editing"
            style={{
              aspectRatio: `${settings.width} / ${settings.height}`,
              backgroundColor: settings.backgroundColor,
              backgroundImage: settings.backgroundImageUrl ? `url(${settings.backgroundImageUrl})` : undefined,
              backgroundSize: 'cover', backgroundPosition: 'center',
            }}
          >
            {slotsWithStickers.map((slot) => (
              <div
                key={slot.slotKey}
                className={`album-slot editable ${selectedSlot === slot.slotKey ? 'selected' : ''}`}
                style={{
                  left: `${(slot.x / settings.width) * 100}%`, top: `${(slot.y / settings.height) * 100}%`,
                  width: `${(slot.width / settings.width) * 100}%`, height: `${(slot.height / settings.height) * 100}%`,
                }}
                onMouseDown={(e) => onSlotMouseDown(e, slot)}
                onTouchStart={(e) => onSlotMouseDown(e, slot)}
              >
                {slot.sticker ? <img src={slot.sticker.imageUrl} alt="" /> : <span className="dim">{slot.slotKey}</span>}
                <span className="album-slot-resize-handle" onMouseDown={(e) => onResizeMouseDown(e, slot)} onTouchStart={(e) => onResizeMouseDown(e, slot)} />
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <div className="settings-block" style={{ marginTop: 10 }}>
            <h4>{selected.slotKey}</h4>
            <label>
              Figurinha fixa nesta página/espaço
              <select value={selected.sticker?.id || ''} onChange={(e) => assignSticker(selected.slotKey, e.target.value || null)}>
                <option value="">Vazio</option>
                {layout.stickers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {error && <div className="auth-error">{error}</div>}
          </div>
        )}
      </div>

      <div style={{ minWidth: 240 }}>
        <div className="settings-block">
          <h4>Fundo do álbum</h4>
          <label>Cor <input type="color" defaultValue={settings.backgroundColor} onBlur={(e) => saveSettings({ backgroundColor: e.target.value })} /></label>
          <label>Imagem de fundo (URL, opcional)
            <input type="text" defaultValue={settings.backgroundImageUrl || ''} placeholder="https://..." onBlur={(e) => saveSettings({ backgroundImageUrl: e.target.value || null })} />
          </label>
          <label>Total de páginas
            <input type="number" min={1} max={20} defaultValue={settings.totalPages} onBlur={(e) => saveSettings({ totalPages: parseInt(e.target.value, 10) || 1 })} style={{ width: 60 }} />
          </label>
          <label className="checkbox-row"><input type="checkbox" defaultChecked={settings.showNames} onChange={(e) => saveSettings({ showNames: e.target.checked })} /> Mostrar nome embaixo da figurinha</label>
        </div>

        <div className="settings-block">
          <h4>Espaços (até 12)</h4>
          {Array.from({ length: 12 }, (_, i) => `slot${i}`).map((key) => {
            const slot = layout.slots.find((s) => s.slotKey === key);
            const enabled = slot?.enabled ?? false;
            return (
              <label key={key} className="checkbox-row">
                <input type="checkbox" checked={enabled} onChange={(e) => toggleSlot(key, e.target.checked)} /> {key}
              </label>
            );
          })}
        </div>

        <p className="dim" style={{ fontSize: 12 }}>Arraste um espaço pra mover, puxe o cantinho ↘ pra redimensionar. As mudanças salvam sozinhas.</p>
      </div>
    </div>
  );
}

// ============================================================
// Economia — empregos, baús diários, itens da loja (equivalente aos
// comandos /edit_empregos, /edit_daily e à gestão de loja do bot Robbie).
// ============================================================
function EconomyAdminTab() {
  const [chests, setChests] = useState(null);
  const refresh = () => adminListChests().then((d) => setChests(d.chests));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const name = prompt('Nome do baú:');
    if (!name) return;
    await adminCreateChest({ name, chanceRegular: 0.1, coinsMin: 10, coinsMax: 20, ticketsMin: 0, ticketsMax: 0 });
    refresh();
  };

  const update = async (chest, field, value) => {
    await adminUpdateChest(chest.id, { [field]: value });
    refresh();
  };

  const remove = async (chest) => {
    if (!confirm(`Excluir o baú "${chest.name}"?`)) return;
    await adminDeleteChest(chest.id);
    refresh();
  };

  if (!chests) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <h4><IconGlyph src={giftIcon} size={16} /> Baús diários</h4>
      <p className="dim" style={{ fontSize: 13 }}>A soma das chances não precisa fechar em 100% — o restante cai no último baú da lista, igual ao bot original.</p>
      <div className="admin-badges-toolbar"><button className="btn-secondary" onClick={create}>+ Novo baú</button></div>
      <table className="admin-table">
        <thead><tr><th>Imagem</th><th>Nome</th><th>Chance</th><th>Moedas</th><th>Tickets</th><th>Ativo</th><th></th></tr></thead>
        <tbody>
          {chests.map((c) => (
            <tr key={c.id}>
              <td>
                {c.imageClosed && <img src={c.imageClosed} alt="" style={{ width: 32, height: 32, objectFit: 'contain', display: 'block', marginBottom: 4 }} />}
                <input placeholder="link da imagem fechada" defaultValue={c.imageClosed || ''} onBlur={(e) => update(c, 'imageClosed', e.target.value)} style={{ width: 140, fontSize: 11 }} />
                <input placeholder="link da imagem aberta" defaultValue={c.imageOpened || ''} onBlur={(e) => update(c, 'imageOpened', e.target.value)} style={{ width: 140, fontSize: 11, marginTop: 2 }} />
              </td>
              <td><input defaultValue={c.name} onBlur={(e) => update(c, 'name', e.target.value)} /></td>
              <td><input type="number" step="0.01" style={{ width: 70 }} defaultValue={c.chanceRegular} onBlur={(e) => update(c, 'chanceRegular', parseFloat(e.target.value))} /></td>
              <td>
                <input type="number" style={{ width: 60 }} defaultValue={c.coinsMin} onBlur={(e) => update(c, 'coinsMin', parseInt(e.target.value, 10))} /> -
                <input type="number" style={{ width: 60 }} defaultValue={c.coinsMax} onBlur={(e) => update(c, 'coinsMax', parseInt(e.target.value, 10))} />
              </td>
              <td>
                <input type="number" style={{ width: 50 }} defaultValue={c.ticketsMin} onBlur={(e) => update(c, 'ticketsMin', parseInt(e.target.value, 10))} /> -
                <input type="number" style={{ width: 50 }} defaultValue={c.ticketsMax} onBlur={(e) => update(c, 'ticketsMax', parseInt(e.target.value, 10))} />
              </td>
              <td><input type="checkbox" defaultChecked={c.enabled} onChange={(e) => update(c, 'enabled', e.target.checked)} /></td>
              <td><button className="btn-link danger" onClick={() => remove(c)}>Excluir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Casas e Móveis — catálogo (equivalente às telas /staff/config/casa e
// /staff/config/moveis do bot Robbie).
// ============================================================
function HousesAdminTab() {
  const [section, setSection] = useState('houses');
  return (
    <div>
      <div className="mod-tabs">
        <button className={`mod-tab ${section === 'houses' ? 'active' : ''}`} onClick={() => setSection('houses')}>🧊 Casas</button>
        <button className={`mod-tab ${section === 'groups' ? 'active' : ''}`} onClick={() => setSection('groups')}>🏘️ Grupos</button>
        <button className={`mod-tab ${section === 'furniture' ? 'active' : ''}`} onClick={() => setSection('furniture')}>🪑 Móveis</button>
        <button className={`mod-tab ${section === 'maps' ? 'active' : ''}`} onClick={() => setSection('maps')}>🖼️ Fundos</button>
      </div>
      {section === 'houses' && <HouseCatalogSection />}
      {section === 'groups' && <HouseGroupsSection />}
      {section === 'furniture' && <FurnitureCatalogSection />}
      {section === 'maps' && <MapBackgroundsSection />}
    </div>
  );
}

function HouseGroupsSection() {
  const [groups, setGroups] = useState(null);
  const refresh = () => adminListHouseGroups().then((d) => setGroups(d.groups));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const id = prompt('Número do grupo (1-1000):');
    const n = parseInt(id, 10);
    if (!n || n < 1 || n > 1000) return;
    await adminSetHouseGroup(n, { x: 0, y: 0, width: 200, height: 200 });
    refresh();
  };

  const update = async (g, field, value) => {
    await adminSetHouseGroup(g.id, { x: g.x, y: g.y, width: g.width, height: g.height, [field]: value });
    refresh();
  };

  const remove = async (g) => {
    if (!confirm(`Excluir o grupo ${g.id}? Casas ligadas a ele ficam sem grupo.`)) return;
    await adminDeleteHouseGroup(g.id);
    refresh();
  };

  if (!groups) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <p className="dim" style={{ fontSize: 13 }}>Um grupo define onde (x, y) e de que tamanho (largura, altura) a imagem da casa aparece por cima do mapa — em pixels, considerando um mapa de referência de 1000×632. Mover ou redimensionar um grupo afeta TODAS as casas do catálogo ligadas a ele de uma vez.</p>
      <div className="admin-badges-toolbar"><button className="btn-secondary" onClick={create}>+ Novo grupo</button></div>
      <table className="admin-table">
        <thead><tr><th>Grupo</th><th>X</th><th>Y</th><th>Largura</th><th>Altura</th><th>Casas</th><th></th></tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td><b>{g.id}</b></td>
              <td><input type="number" style={{ width: 70 }} defaultValue={g.x} onBlur={(e) => update(g, 'x', parseInt(e.target.value, 10) || 0)} /></td>
              <td><input type="number" style={{ width: 70 }} defaultValue={g.y} onBlur={(e) => update(g, 'y', parseInt(e.target.value, 10) || 0)} /></td>
              <td><input type="number" style={{ width: 70 }} defaultValue={g.width} onBlur={(e) => update(g, 'width', parseInt(e.target.value, 10) || 0)} /></td>
              <td><input type="number" style={{ width: 70 }} defaultValue={g.height} onBlur={(e) => update(g, 'height', parseInt(e.target.value, 10) || 0)} /></td>
              <td className="dim" style={{ fontSize: 12 }}>{g.houses.map((h) => h.name).join(', ') || '—'}</td>
              <td><button className="btn-link danger" onClick={() => remove(g)}>Excluir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MapBackgroundsSection() {
  const [maps, setMaps] = useState(null);
  const [starterMapId, setStarterMapId] = useState(null);
  const [newFile, setNewFile] = useState(null);

  const refresh = () => {
    listMapBackgrounds().then((d) => setMaps(d.maps));
    getCommunitySettings().then((d) => setStarterMapId(d.settings.starterMapId));
  };
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault();
    if (!newFile) return alert('Escolha uma imagem primeiro.');
    const id = prompt('ID único do fundo (ex.: cidade_noturna):');
    if (!id) return;
    const name = prompt('Nome:', id) || id;
    const price = prompt('Preço em moedas (0 = grátis):', '50') || '50';
    const fd = new FormData();
    fd.append('image', newFile);
    fd.append('id', id); fd.append('name', name); fd.append('price', price);
    await adminCreateMapBackground(fd);
    setNewFile(null);
    refresh();
  };

  const rename = async (m) => {
    const name = prompt('Novo nome:', m.name);
    if (!name) return;
    await adminUpdateMapBackground(m.id, { name });
    refresh();
  };

  const changePrice = async (m, price) => {
    await adminUpdateMapBackground(m.id, { price: parseInt(price, 10) || 0 });
    refresh();
  };

  const changeStock = async (m, stock) => {
    await adminUpdateMapBackground(m.id, { stock: stock === '' ? '' : parseInt(stock, 10) });
    refresh();
  };

  const makeStarter = async (m) => { await adminSetStarterMap(m.id); refresh(); };
  const clearStarter = async () => { await adminClearStarterMap(); refresh(); };

  const remove = async (m) => {
    if (!confirm(`Excluir o fundo "${m.name}"? Casas que usam ele voltam pra cor sólida padrão.`)) return;
    await adminDeleteMapBackground(m.id);
    refresh();
  };

  if (!maps) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <p className="dim" style={{ fontSize: 13 }}>Fundos que os membros podem escolher pra decorar a própria casa (aba Decorar → 🖼️ Fundo). Os 8 originais vêm do bot Robbie — dá pra cadastrar quantos mais quiser aqui. O "mapa inicial" é o que toda conta nova ganha de graça, se a casa inicial tiver grupo.</p>
      <form onSubmit={create} className="admin-badges-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="file" accept="image/*" onChange={(e) => setNewFile(e.target.files[0])} />
        <button className="btn-secondary" type="submit">+ Novo fundo</button>
      </form>
      <div className="admin-badge-grid">
        {maps.map((m) => (
          <div key={m.id} className={`card ${starterMapId === m.id ? 'starter-marked' : ''}`} style={{ padding: 14 }}>
            <img src={m.imageUrl} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8 }} />
            <div style={{ fontWeight: 700, marginTop: 6 }}>{m.name} {starterMapId === m.id && <span className="dim" style={{ fontSize: 11 }}>· inicial</span>}</div>
            <label>PREÇO (moedas)<input type="number" defaultValue={m.price} onBlur={(e) => changePrice(m, e.target.value)} /></label>
            <label>ESTOQUE (vazio = ilimitado)<input type="number" defaultValue={m.stock ?? ''} placeholder="ilimitado" onBlur={(e) => changeStock(m, e.target.value)} /></label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn-link" onClick={() => rename(m)}>Renomear</button>
              {starterMapId === m.id
                ? <button className="btn-link" onClick={clearStarter}>Remover como inicial</button>
                : <button className="btn-link" onClick={() => makeStarter(m)}>Definir como inicial</button>}
              <button className="btn-link danger" onClick={() => remove(m)}>Excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HouseCatalogSection() {
  const [houses, setHouses] = useState(null);
  const [starterHouseId, setStarterHouseId] = useState(null);
  const [newFile, setNewFile] = useState(null);
  const refresh = () => {
    adminListHouseCatalog().then((d) => setHouses(d.houses));
    getCommunitySettings().then((d) => setStarterHouseId(d.settings.starterHouseId));
  };
  useEffect(() => { refresh(); }, []);

  const create = async (e) => {
    e.preventDefault();
    const id = prompt('ID único da casa (ex.: iglu_novo):');
    if (!id) return;
    const name = prompt('Nome:', id) || id;
    const groupId = prompt('Número do grupo (1-1000, deixe vazio pra casa com fundo próprio):', '') || '';
    if (newFile) {
      const fd = new FormData();
      fd.append('image', newFile);
      fd.append('id', id); fd.append('name', name); fd.append('price', '0'); fd.append('backgroundColor', '#BFEFFF');
      if (groupId) fd.append('groupId', groupId);
      await adminCreateHouse(fd);
      setNewFile(null);
    } else {
      await adminCreateHouse({ id, name, price: 0, backgroundColor: '#BFEFFF', groupId: groupId || undefined });
    }
    refresh();
  };

  const update = async (house, field, value) => {
    await adminUpdateHouse(house.id, { [field]: value });
    refresh();
  };

  const uploadImage = async (house, file) => {
    const fd = new FormData();
    fd.append('image', file);
    await adminUpdateHouse(house.id, fd);
    refresh();
  };

  const makeStarter = async (h) => { await adminSetStarterHouse(h.id); refresh(); };
  const clearStarter = async () => { await adminClearStarterHouse(); refresh(); };

  const remove = async (house) => {
    if (!confirm(`Excluir a casa "${house.name}"? Isso também remove essa casa de quem já comprou ela (móveis colocados, curtidas e recados dela junto).`)) return;
    await adminDeleteHouse(house.id);
    refresh();
  };

  if (!houses) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <p className="dim" style={{ fontSize: 13 }}>Casas SEM grupo têm fundo próprio (imagem completa). Casas COM grupo só têm a "imagem da casa" (sprite, sem fundo) — o fundo real é o mapa que o usuário escolher, e a casa aparece por cima dele na posição do grupo (ver aba 🏘️ Grupos). A "casa inicial" é a que toda conta nova ganha de graça e ativa.</p>
      <form onSubmit={create} className="admin-badges-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="file" accept="image/*" onChange={(e) => setNewFile(e.target.files[0])} />
        <button className="btn-secondary" type="submit">+ Nova casa</button>
      </form>
      <div className="admin-badge-grid">
        {houses.map((h) => (
          <div key={h.id} className={`card ${starterHouseId === h.id ? 'starter-marked' : ''}`} style={{ padding: 14 }}>
            <div style={{ height: 90, borderRadius: 8, background: h.backgroundColor, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {h.imageUrl ? <img src={h.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <HouseIcon color="#fff" size={40} />}
            </div>
            <label className="btn-secondary" style={{ marginTop: 6, textAlign: 'center', display: 'block', cursor: 'pointer' }}>
              {h.imageUrl ? (h.groupId != null ? 'Trocar imagem da casa' : 'Trocar fundo') : (h.groupId != null ? 'Adicionar imagem da casa' : 'Adicionar fundo')}
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadImage(h, e.target.files[0])} />
            </label>
            <label>NOME<input defaultValue={h.name} onBlur={(e) => update(h, 'name', e.target.value)} /></label>
            <label>PREÇO<input type="number" defaultValue={h.price} onBlur={(e) => update(h, 'price', parseInt(e.target.value, 10))} /></label>
            <label>ESTOQUE (vazio = ilimitado)<input type="number" defaultValue={h.stock ?? ''} placeholder="ilimitado" onBlur={(e) => update(h, 'stock', e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></label>
            <label>GRUPO (vazio = fundo próprio)<input type="number" defaultValue={h.groupId ?? ''} placeholder="sem grupo" onBlur={(e) => update(h, 'groupId', e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></label>
            {h.groupId == null && <label>COR (usada se não tiver imagem)<input type="color" defaultValue={h.backgroundColor} onChange={(e) => update(h, 'backgroundColor', e.target.value)} /></label>}
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {starterHouseId === h.id
                ? <button className="btn-link" onClick={clearStarter}>Remover como inicial</button>
                : <button className="btn-link" onClick={() => makeStarter(h)}>Definir como inicial</button>}
              <button className="btn-link danger" onClick={() => remove(h)}>Excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FurnitureCatalogSection() {
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [newFile, setNewFile] = useState(null);

  const refresh = () => {
    adminListFurnitureCatalog().then((d) => setItems(d.items));
    adminListFurnitureCategories().then((d) => setCategories(d.categories));
  };
  useEffect(() => { refresh(); }, []);

  const createCategory = async () => {
    const id = prompt('ID único da categoria (ex.: eletronicos):');
    if (!id) return;
    const name = prompt('Nome:', id) || id;
    await adminCreateFurnitureCategory({ id, name });
    refresh();
  };

  const create = async (e) => {
    e.preventDefault();
    if (!newFile) return alert('Escolha uma imagem primeiro.');
    const id = prompt('ID único do móvel:');
    if (!id) return;
    const name = prompt('Nome:', id) || id;
    const categoryId = categories[0]?.id;
    if (!categoryId) return alert('Crie uma categoria primeiro.');
    const fd = new FormData();
    fd.append('image', newFile);
    fd.append('id', id); fd.append('name', name); fd.append('categoryId', categoryId);
    fd.append('price', '10'); fd.append('width', '200'); fd.append('height', '200');
    await adminCreateFurniture(fd);
    setNewFile(null);
    refresh();
  };

  const update = async (item, field, value) => {
    await adminUpdateFurniture(item.id, { [field]: value });
    refresh();
  };

  const remove = async (item) => {
    if (!confirm(`Excluir o móvel "${item.name}"?`)) return;
    await adminDeleteFurniture(item.id);
    refresh();
  };

  if (!items) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <div className="admin-badges-toolbar" style={{ gap: 8 }}>
        <button className="btn-secondary" onClick={createCategory}>+ Nova categoria</button>
        <form onSubmit={create} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="file" accept="image/*" onChange={(e) => setNewFile(e.target.files[0])} />
          <button className="btn-secondary" type="submit">+ Novo móvel</button>
        </form>
      </div>
      <div className="admin-badge-grid">
        {items.map((it) => (
          <div key={it.id} className="card" style={{ padding: 14 }}>
            <img src={it.imageUrl} alt="" style={{ width: '100%', height: 70, objectFit: 'contain' }} />
            <label>NOME<input defaultValue={it.name} onBlur={(e) => update(it, 'name', e.target.value)} /></label>
            <label>PREÇO<input type="number" defaultValue={it.price} onBlur={(e) => update(it, 'price', parseInt(e.target.value, 10))} /></label>
            <label>CATEGORIA
              <select defaultValue={it.categoryId} onChange={(e) => update(it, 'categoryId', e.target.value)}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn-link danger" onClick={() => remove(it)}>Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Sistema — liga/desliga sistemas inteiros da comunidade (adaptado do
// "disabled_systems" e do modo manutenção do bot Robbie).
// ============================================================
function SystemTab() {
  const [toggles, setToggles] = useState(null);
  const refresh = () => getSystemToggles().then(setToggles);
  useEffect(() => { refresh(); }, []);

  const toggle = async (system, enabled) => {
    await adminUpdateSystemToggles(system, enabled);
    refresh();
  };

  if (!toggles) return <div className="dim">Carregando...</div>;

  const LABELS = { economia: '💰 Economia', rank: '🏆 Rank', casas: '🧊 Casas e decoração', figurinhas: '🧷 Figurinhas e álbum', cores_perfil: '🎨 Cores personalizadas para perfil' };

  return (
    <div className="settings-grid">
      <div className="settings-block">
        <h4>Sistemas da comunidade</h4>
        <p className="dim">Desativar um sistema bloqueia o acesso pra todo mundo (menos administradores) e mostra uma tela de indisponível.</p>
        {toggles.availableSystems.map((sys) => {
          const enabled = !toggles.disabledSystems.includes(sys);
          return (
            <label key={sys} className="checkbox-row" style={{ fontSize: 14 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => toggle(sys, e.target.checked)} /> {LABELS[sys] || sys}
            </label>
          );
        })}
        {/* "Cores personalizadas para perfil" funciona diferente dos outros
            (não bloqueia rota nenhuma nem mostra tela de indisponível) — só
            esconde a opção de EDITAR a cor em Configurações → Meu perfil.
            Cores já escolhidas por quem já tinha uma continuam aparecendo
            normalmente pra todo mundo, ligado ou desligado. */}
        <p className="dim" style={{ marginTop: 4 }}>
          "Cores personalizadas para perfil" é diferente: desativar só esconde a opção de EDITAR a cor em Configurações → Meu perfil — cores já escolhidas continuam sendo exibidas normalmente.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// Moderação de Recados — livro de visitas das casas (todos os recados da
// comunidade num só lugar pra revisar/apagar).
// ============================================================
function ModerationTab() {
  const [comments, setComments] = useState(null);
  const refresh = () => adminListHouseComments().then((d) => setComments(d.comments));
  useEffect(() => { refresh(); }, []);

  const remove = async (comment) => {
    if (!confirm('Apagar este recado?')) return;
    await adminDeleteHouseCommentMod(comment.id);
    refresh();
  };

  if (!comments) return <div className="dim">Carregando...</div>;
  if (comments.length === 0) return <div className="dim">Nenhum recado ainda.</div>;

  return (
    <ul className="audit-log-list">
      {comments.map((c) => (
        <li key={c.id} className="audit-log-entry">
          <b>{c.author?.displayName}</b> escreveu na casa de <b>{c.userHouse?.user?.displayName}</b>:
          <div>{c.content}</div>
          <div className="audit-meta">
            {new Date(c.createdAt).toLocaleString('pt-BR')}
            <button className="btn-link danger" style={{ marginLeft: 10 }} onClick={() => remove(c)}>Apagar</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================
// Inscrições — formulário de entrada com aprovação da staff. A conta só é
// criada de verdade quando um admin aprova.
// ============================================================
function calcAge(birthDateStr) {
  if (!birthDateStr) return null;
  const b = new Date(birthDateStr);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function ApplicationsTab() {
  const [filter, setFilter] = useState('PENDING');
  const [applications, setApplications] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refresh = () => adminListApplications(filter === 'ALL' ? undefined : filter).then((d) => setApplications(d.applications));
  useEffect(() => { refresh(); }, [filter]);

  const approve = async (app) => {
    if (!confirm(`Aprovar a inscrição de "${app.username}"? A conta será criada e um e-mail será enviado.`)) return;
    setBusyId(app.id);
    try { await approveApplication(app.id); await refresh(); }
    catch (err) { alert(err.response?.data?.error || 'Não foi possível aprovar.'); }
    finally { setBusyId(null); }
  };

  const reject = async (app) => {
    const reason = prompt('Motivo da rejeição (opcional, vai no e-mail da pessoa):') || '';
    setBusyId(app.id);
    try { await rejectApplication(app.id, reason); await refresh(); }
    catch (err) { alert(err.response?.data?.error || 'Não foi possível rejeitar.'); }
    finally { setBusyId(null); }
  };

  if (!applications) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <div className="theme-options" style={{ marginBottom: 12 }}>
        {['PENDING', 'APPROVED', 'REJECTED', 'ALL'].map((f) => (
          <button key={f} className={`theme-swatch ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'PENDING' ? 'Pendentes' : f === 'APPROVED' ? 'Aprovadas' : f === 'REJECTED' ? 'Rejeitadas' : 'Todas'}
          </button>
        ))}
      </div>
      {applications.length === 0 && <p className="dim">Nenhuma inscrição aqui.</p>}
      <div className="ticket-list">
        {applications.map((app) => (
          <div key={app.id} className="settings-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{app.displayName} <span className="dim">@{app.username}</span></div>
                <div className="dim" style={{ fontSize: 12 }}>{app.email} · {calcAge(app.birthDate) != null ? `${calcAge(app.birthDate)} anos` : 'inscrição antiga'} · {new Date(app.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <span className={`ticket-status-chip ${app.status === 'PENDING' ? 'open' : app.status === 'APPROVED' ? 'open' : 'closed'}`}>
                {app.status === 'PENDING' ? 'Pendente' : app.status === 'APPROVED' ? 'Aprovada' : 'Rejeitada'}
              </span>
            </div>
            <div className="application-answers">
              <div><b>Como descobriu:</b> {app.answers.howFound}{app.answers.howFoundOther ? ` (${app.answers.howFoundOther})` : ''}</div>
              <div><b>Interesses:</b> {app.answers.interests?.join(', ')}</div>
              <div><b>É o quê:</b> {app.answers.roles?.join(', ')}</div>
              <div><b>Nível de tecnologia:</b> {app.answers.techLevel}</div>
              <div><b>Redes alternativas:</b> {app.answers.altSocials?.join(', ')}</div>
              <div><b>Seria membro ativo:</b> {app.answers.activeMember}</div>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}><b>Motivo:</b> {app.answers.joinReason}</div>
            </div>
            {app.status === 'PENDING' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn-primary" disabled={busyId === app.id} onClick={() => approve(app)}><IconGlyph src={confirmIcon} size={14} /> Aprovar</button>
                <button className="btn-danger" disabled={busyId === app.id} onClick={() => reject(app)}><IconGlyph src={closeIcon} size={14} /> Rejeitar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Automod de DM — lista de mensagens sinalizadas por palavra, com opção
// de abrir a conversa inteira (visualização SECRETA — o autor nunca fica
// sabendo que a staff está olhando, ver adminController.getFlaggedConversation).
function AutomodDmTab() {
  const [flags, setFlags] = useState([]);
  const [filter, setFilter] = useState('PENDING');
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null); // { flag, messages } quando analisando um caso
  const [busyId, setBusyId] = useState(null);

  const refresh = () => {
    setLoading(true);
    adminListAutomodFlags(filter === 'ALL' ? undefined : filter).then((d) => setFlags(d.flags)).finally(() => setLoading(false));
  };
  useEffect(refresh, [filter]);

  const openCase = async (flag) => {
    const data = await adminGetFlaggedConversation(flag.id);
    setViewing(data);
  };

  const resolve = async (id, status) => {
    setBusyId(id);
    try {
      await adminResolveAutomodFlag(id, status);
      setViewing(null);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <p className="dim" style={{ marginBottom: 12 }}>
        Mensagens diretas com palavras sinalizadas automaticamente. A mensagem já foi enviada
        normalmente — os dois usuários não sabem que ela foi sinalizada nem que você está
        analisando o caso. Abrir um caso mostra o histórico completo da conversa entre os dois.
      </p>
      <div className="theme-options" style={{ marginBottom: 12 }}>
        {['PENDING', 'ACTIONED', 'DISMISSED', 'ALL'].map((f) => (
          <button key={f} className={`theme-swatch ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'PENDING' ? 'Pendentes' : f === 'ACTIONED' ? 'Com ação' : f === 'DISMISSED' ? 'Ignoradas' : 'Todas'}
          </button>
        ))}
      </div>
      {!loading && flags.length === 0 && <p className="dim">Nenhuma sinalização aqui.</p>}
      <div className="ticket-list">
        {flags.map((f) => (
          <div key={f.id} className="settings-block">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {f.sender?.displayName} <span className="dim">@{f.sender?.username}</span>
                  {' → '}
                  {f.recipient?.displayName} <span className="dim">@{f.recipient?.username}</span>
                </div>
                <div className="dim" style={{ fontSize: 12 }}>Palavra: <b>{f.matchedWord}</b> · {new Date(f.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <span className={`ticket-status-chip ${f.status === 'PENDING' ? 'open' : 'closed'}`}>
                {f.status === 'PENDING' ? 'Pendente' : f.status === 'ACTIONED' ? 'Com ação' : 'Ignorada'}
              </span>
            </div>
            <p style={{ marginTop: 8, fontStyle: 'italic' }}>"{f.snippet}"</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-link" onClick={() => openCase(f)}>🔍 Analisar conversa</button>
              {f.status === 'PENDING' && (
                <button className="btn-link" disabled={busyId === f.id} onClick={() => resolve(f.id, 'DISMISSED')}>Ignorar</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {viewing && (
        <Modal onClose={() => setViewing(null)} title="Conversa completa (visualização de staff)">
          <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
            Nenhum dos dois usuários é notificado sobre essa visualização.
          </div>
          <div className="automod-conversation-view">
            {viewing.messages.map((m) => (
              <div key={m.id} className="automod-conversation-msg">
                <b>{m.author?.displayName}:</b> {m.content}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-danger" disabled={busyId === viewing.flag.id} onClick={() => resolve(viewing.flag.id, 'ACTIONED')}>
              Marcar como "ação tomada" (banir/silenciar pelo menu de Usuários)
            </button>
            <button className="btn-link" disabled={busyId === viewing.flag.id} onClick={() => resolve(viewing.flag.id, 'DISMISSED')}>Ignorar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
