import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext.jsx';
import { getUserProfile, createConversation, sendFriendRequest, assignRole, unassignRole, voteProfile, listPosts, listApprovedTestimonials, writeTestimonial, listScraps, writeScrap, deleteScrap, getFanStatus, toggleFan, registerProfileVisit, listProfileVisitors, getTraitStatus, toggleTrait, sendRelationshipRequest, endRelationship as endRelationshipApi, listPhotosByOwner, listProfilePollsByAuthor, voteProfilePoll, upcomingBirthdaysAmongFriends } from '../../api/endpoints';
import { STATUS_LABEL } from '../../utils/status';
import PresenceDot from '../PresenceDot.jsx';
import { renderRichContent } from '../../utils/richTextRender.jsx';
import { getMyCommunityPermissions, hasPermission } from '../../utils/permissions';
import { roleChipStyle } from '../../utils/roleColor';
import { profileAccentVars } from '../../utils/profileAccent';
import TagBadge from '../TagBadge.jsx';
import PendantIcon from '../PendantIcon.jsx';
import ClanTagBadge from '../ClanTagBadge.jsx';
import UserAvatar from '../UserAvatar.jsx';
import ActivityBadge from '../ActivityBadge.jsx';
import ActivityIcon from '../ActivityIcon.jsx';
import BadgeListModal from './BadgeListModal.jsx';
import PaginatedListModal from './PaginatedListModal.jsx';
import PhotoAlbumModal from './PhotoAlbumModal.jsx';
import defaultAchievementIcon from '../../assets/icons/nav-achievements.png';
import { badgeHasImage } from '../../utils/badgeRarity';
import { nameStyleProps, nameStyleClassName } from '../../utils/nameStyle';
import cancelIcon from '../../assets/icons/close-x.png';
import settingsIcon from '../../assets/icons/settings.png';
import likeIcon from '../../assets/icons/like.png';
import dislikeIcon from '../../assets/icons/dislike.png';
import youtubeIcon from '../../assets/icons/social-youtube.png';
import steamIcon from '../../assets/icons/social-steam.png';
import robloxIcon from '../../assets/icons/social-roblox.png';
import xIcon from '../../assets/icons/social-x.png';
import levelStarIcon from '../../assets/icons/level-star.png';
import { proxyImage } from '../../utils/imageProxy';
import { visibleProfileSectionOrder } from '../../utils/profileSections';
import FeaturedModpackSection from '../FeaturedModpackSection.jsx';
import '../../styles/profile.css';

// Ícones de traço do perfil (SVG, herdam a cor do texto) — mapa local pra
// não mexer no PageIcons.jsx compartilhado. Emoji vira quadradinho no Linux.
const PF_PATHS = {
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4',
  medal: 'M8 3l2 6M16 3l-2 6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 13v4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  poll: 'M5 20V10M12 20V4M19 20v-7',
  flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-3 4.5-3 8a6 6 0 0 0 6 6Z',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  cake: 'M4 21h16M5 21v-7h14v7M5 16c2 1.3 3.3 1.3 5 0 1.7 1.3 3.3 1.3 5 0 1.7 1.3 3 1.3 4 0M12 14V9M12 6.5V5',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  up: 'M12 19V5M5 12l7-7 7 7',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  play: 'M8 5v14l11-7L8 5Z',
  alert: 'M12 3 2 20h20L12 3ZM12 10v4M12 17h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
};
export function PfIcon({ name, size = 16, strokeWidth = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PF_PATHS[name]} />
    </svg>
  );
}

// Card das seções do perfil: título em frase normal com ícone, contador
// opcional e uma ação no canto (ex: "Ver tudo").
export function PfCard({ icon, title, count, action, className = '', innerRef, children }) {
  return (
    <section className={`pf-card ${className}`} ref={innerRef}>
      <header className="pf-card-head">
        <span className="pf-card-icon"><PfIcon name={icon} size={15} /></span>
        <h3 className="pf-card-title">{title}</h3>
        {count != null && count !== 0 && <span className="pf-card-count">{count}</span>}
        {action && <span className="pf-card-action">{action}</span>}
      </header>
      {children}
    </section>
  );
}

// Estado vazio pequeno, dentro de um card.
function PfEmpty({ icon, children, action }) {
  return (
    <div className="pf-empty">
      <span className="pf-empty-icon"><PfIcon name={icon} size={18} /></span>
      <span className="pf-empty-text">{children}</span>
      {action}
    </div>
  );
}

// Abas do perfil: cada seção (chave de profileSections.js) cai num grupo.
// A ordem DENTRO de cada aba continua sendo a que a pessoa escolheu em
// Configurações → Colunas.
const PF_TABS = [
  { id: 'about', label: 'Sobre', icon: 'user' },
  { id: 'activity', label: 'Atividade', icon: 'bolt' },
  { id: 'achievements', label: 'Conquistas', icon: 'trophy' },
  { id: 'wall', label: 'Recados', icon: 'chat' },
];
const PF_SECTION_TAB = {
  about: 'about', roles: 'about', connections: 'about', mutual_friends: 'about', relationship: 'about', traits: 'about', member_since: 'about',
  community_activity: 'activity', polls: 'activity', album: 'activity', featured_modpack: 'activity',
  achievements: 'achievements',
  scraps: 'wall', testimonials: 'wall', visitors: 'wall',
};

// Rendered once at the app root (see MainApp.jsx) and driven entirely by
// `viewingProfileUserId` in the zustand store — call `openProfile(userId)`
// from anywhere (message author avatar, member list, your own user panel)
// to pop it open, no prop drilling needed.
export default function UserProfileModal() {
  const userId = useStore((s) => s.viewingProfileUserId);
  const profileAutoOpenRoleMenu = useStore((s) => s.profileAutoOpenRoleMenu);
  const clearProfileAutoOpenRoleMenu = useStore((s) => s.clearProfileAutoOpenRoleMenu);
  const closeProfile = useStore((s) => s.closeProfile);
  const presence = useStore((s) => (userId ? s.presence[userId] : null));
  // Ups em tempo real (item pedido) — usa o valor que já veio no fetch
  // inicial (data.totalUps) até chegar uma atualização por socket
  // (ver SocketContext.jsx → user:ups-update), que sobrescreve na hora.
  const liveUpsOverride = useStore((s) => (userId ? s.upsByUserId[userId] : undefined));
  const usableEmojis = useStore((s) => s.usableEmojis);
  // Bio isn't scoped to any one server (unlike chat messages), so it just
  // gets this user's own accessible custom emoji set — no @mentions here,
  // there's no channel/member list for a profile bio to mention against.
  const bioEmojiMap = Object.fromEntries(usableEmojis.map((e) => [e.name, e.url]));
  const { user: me, setUser: setMe } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [friendSent, setFriendSent] = useState(false);
  const [badgeListOpen, setBadgeListOpen] = useState(false);
  // Aba ativa do perfil (Sobre / Atividade / Conquistas / Recados) —
  // volta pra primeira sempre que abre outro perfil.
  const [activeTab, setActiveTab] = useState('about');
  useEffect(() => { setActiveTab('about'); }, [userId]);
  // Item pedido: "centralizar em Configurações" — tag da comunidade
  // voltou pra lá (UserSettingsModal.jsx), removida daqui.
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [rolesExpanded, setRolesExpanded] = useState(false);
  const [roleMenuStyle, setRoleMenuStyle] = useState(null);
  const roleAddBtnRef = useRef(null);
  const roleMenuRef = useRef(null);
  const rolesSectionRef = useRef(null);

  // Cargos são mostrados sempre agora — pulled straight from the live
  // `members`/`roles` stores (não do fetch avulso de getUserProfile), pra
  // reagir na hora a mudanças de cargo pelo socket, igual à lista de membros.
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const member = members.find((m) => m.user.id === userId);
  const myCommunityPerms = getMyCommunityPermissions(roles, members, me.id, me.platformRole);
  const canManageRoles = hasPermission(myCommunityPerms, 'MANAGE_ROLES');
  const memberRoles = member ? roles.filter((r) => !r.isDefault && member.roleIds?.includes(r.id)) : [];
  const assignableRoles = member ? roles.filter((r) => !r.isDefault && !member.roleIds?.includes(r.id)) : [];
  const roleSearchResults = roleSearch.trim()
    ? assignableRoles.filter((r) => r.name.toLowerCase().includes(roleSearch.trim().toLowerCase()))
    : assignableRoles;

  // Discord-style truncation: past this many chips, collapse the rest
  // behind a "..." pill instead of letting a heavily-decorated member's
  // profile balloon into an endless wall of role chips.
  const ROLES_PREVIEW_COUNT = 6;
  const visibleRoles = rolesExpanded ? memberRoles : memberRoles.slice(0, ROLES_PREVIEW_COUNT);
  const hiddenRolesCount = memberRoles.length - visibleRoles.length;

  const addRole = (roleId) => {
    assignRole(userId, roleId).catch(() => {});
    setRoleMenuOpen(false);
    setRoleSearch('');
  };
  const removeRole = (roleId) => { unassignRole(userId, roleId).catch(() => {}); };

  useEffect(() => {
    if (!userId) { setData(null); return; }
    setLoading(true);
    getUserProfile(userId).then((result) => {
      setData(result);
      // BUG CORRIGIDO ("meu perfil não mostra jogo/Spotify"): o
      // ActivityBadge só lê do estado atualizado AO VIVO pelo socket
      // (activities no store) — nunca era alimentado com o que o
      // próprio pedido de perfil já trazia (result.activity). Se
      // nenhum aviso ao vivo tivesse chegado ainda desde que a página
      // carregou, o badge ficava vazio mesmo com a atividade
      // existindo de verdade no servidor.
      if (result?.activity) useStore.getState().setActivity(userId, result.activity);
    }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [userId]);

  // NOVO (fusão com o Reddit clone — item 5): atividade em Comunidades —
  // posts recentes da pessoa + Ups (soma dos scores) num cantinho do
  // próprio perfil, igual ao Reddit mostra na página de qualquer usuário.
  const [redditActivity, setRedditActivity] = useState(null);
  useEffect(() => {
    if (!userId) { setRedditActivity(null); return; }
    listPosts({ authorId: userId, sort: 'new' }).then((d) => setRedditActivity(d.posts)).catch(() => setRedditActivity([]));
  }, [userId]);

  // Item pedido: sistemas estilo Orkut — depoimentos, recados (scraps)
  // e "sou fã", carregados junto do resto do perfil, mesmo padrão dos
  // outros useEffect acima.
  const [testimonials, setTestimonials] = useState([]);
  const [testimonialTotal, setTestimonialTotal] = useState(0);
  const [testimonialDraft, setTestimonialDraft] = useState('');
  const [testimonialSending, setTestimonialSending] = useState(false);
  const [testimonialListOpen, setTestimonialListOpen] = useState(false);
  useEffect(() => {
    if (!userId) { setTestimonials([]); setTestimonialTotal(0); return; }
    listApprovedTestimonials(userId).then((d) => { setTestimonials(d.testimonials); setTestimonialTotal(d.total ?? d.testimonials.length); }).catch(() => setTestimonials([]));
  }, [userId]);

  const [scraps, setScraps] = useState([]);
  const [scrapTotal, setScrapTotal] = useState(0);
  const [scrapDraft, setScrapDraft] = useState('');
  const [scrapSending, setScrapSending] = useState(false);
  const [scrapListOpen, setScrapListOpen] = useState(false);
  useEffect(() => {
    if (!userId) { setScraps([]); setScrapTotal(0); return; }
    listScraps(userId).then((d) => { setScraps(d.scraps); setScrapTotal(d.total ?? d.scraps.length); }).catch(() => setScraps([]));
  }, [userId]);

  const [fanStatus, setFanStatus] = useState({ count: 0, isFan: false });
  useEffect(() => {
    if (!userId) { setFanStatus({ count: 0, isFan: false }); return; }
    getFanStatus(userId).then(setFanStatus).catch(() => {});
  }, [userId]);

  const submitTestimonial = () => {
    if (!testimonialDraft.trim() || testimonialSending) return;
    setTestimonialSending(true);
    writeTestimonial(userId, testimonialDraft.trim())
      .then(() => { setTestimonialDraft(''); useStore.getState().pushNotice('Depoimento enviado! Fica visível assim que a pessoa aprovar.'); })
      .catch((err) => useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível enviar o depoimento.'))
      .finally(() => setTestimonialSending(false));
  };

  const submitScrap = () => {
    if (!scrapDraft.trim() || scrapSending) return;
    setScrapSending(true);
    writeScrap(userId, scrapDraft.trim())
      .then((d) => { setScraps((prev) => [d.scrap, ...prev]); setScrapTotal((t) => t + 1); setScrapDraft(''); })
      .catch((err) => useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível deixar o recado.'))
      .finally(() => setScrapSending(false));
  };

  const removeScrap = (id) => {
    deleteScrap(id).then(() => { setScraps((prev) => prev.filter((s) => s.id !== id)); setScrapTotal((t) => Math.max(0, t - 1)); }).catch(() => {});
  };

  const toggleFanStatus = () => {
    toggleFan(userId).then(setFanStatus).catch(() => {});
  };

  // Opened via openProfileAddRole (MembersList.jsx's "Adicionar cargo") —
  // jump straight to the role section instead of making the admin scroll
  // down and click "+" themselves: expand the full role list (in case the
  // member already has several) and pop the add-role dropdown open. Only
  // fires once member/canManageRoles are actually resolved, then clears the
  // flag so it doesn't reopen every time this component re-renders.
  useEffect(() => {
    if (!profileAutoOpenRoleMenu || !member) return;
    if (canManageRoles) {
      // Cargos ficam na aba "Sobre" — garante que ela esteja aberta.
      setActiveTab('about');
      setRolesExpanded(true);
      setRoleMenuOpen(true);
      setTimeout(() => rolesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
    clearProfileAutoOpenRoleMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileAutoOpenRoleMenu, member, canManageRoles]);

  // Bug fix: this dropdown used to be `position: absolute` inside the
  // profile card, which itself scrolls inside `.modal-box` on mobile (see
  // global.css's mobile `.modal-box { overflow-y: auto }`) — the "+" button
  // sits fairly low in that scrolling card, so the dropdown opening
  // downward from it routinely ran past the bottom of the modal and got
  // clipped by that overflow, making it unusable. Now it's measured off
  // the button's real on-screen position and rendered `position: fixed`
  // through a portal straight into <body> (see the createPortal below) —
  // flipping to open upward when there isn't room below, same fix already
  // applied to the message reaction/emoji pickers.
  const ROLE_MENU_WIDTH = 220;
  const ROLE_MENU_MAX_HEIGHT = 260;
  useEffect(() => {
    if (!roleMenuOpen) { setRoleMenuStyle(null); return; }
    const btn = roleAddBtnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - ROLE_MENU_WIDTH - 8));
    let top = rect.bottom + 4;
    if (top + ROLE_MENU_MAX_HEIGHT > window.innerHeight - 8) {
      top = Math.max(8, rect.top - ROLE_MENU_MAX_HEIGHT - 4);
    }
    setRoleMenuStyle({ position: 'fixed', top: `${top}px`, left: `${left}px` });
    // activeTab: o botão "+" só existe na aba Sobre — remede quando ela abre.
  }, [roleMenuOpen, activeTab]);

  useEffect(() => {
    if (!roleMenuOpen) return;
    const onDocDown = (e) => {
      if (roleMenuRef.current?.contains(e.target) || roleAddBtnRef.current?.contains(e.target)) return;
      setRoleMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('touchstart', onDocDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('touchstart', onDocDown);
    };
  }, [roleMenuOpen]);

  const isMe = userId === me.id;

  // Item pedido: mais sistemas estilo Orkut — traços (confiável/legal/
  // sexy), visitantes de perfil, relacionamento, e prévia do álbum de
  // fotos, tudo carregado junto do resto do perfil.
  const [traitStatus, setTraitStatus] = useState(null);
  useEffect(() => {
    if (!userId) { setTraitStatus(null); return; }
    getTraitStatus(userId).then(setTraitStatus).catch(() => {});
  }, [userId]);

  const toggleTraitStatus = (trait) => {
    toggleTrait(userId, trait).then(setTraitStatus).catch(() => {});
  };

  // Visitantes só carrega quando é O MEU PRÓPRIO perfil (é a única
  // pessoa que pode ver essa lista — checado no servidor também).
  const [visitorsData, setVisitorsData] = useState({ visits: [], totalVisits: 0 });
  useEffect(() => {
    if (!userId || !isMe) { setVisitorsData({ visits: [], totalVisits: 0 }); return; }
    listProfileVisitors(userId).then(setVisitorsData).catch(() => {});
  }, [userId, isMe]);

  // Registra a visita ao abrir o perfil de OUTRA pessoa — uma vez por
  // abertura, "dispara e esquece" (não precisa de estado nem de
  // resposta, só avisa o servidor).
  useEffect(() => {
    if (userId && !isMe) registerProfileVisit(userId).catch(() => {});
  }, [userId, isMe]);

  const requestRelationship = () => {
    sendRelationshipRequest(userId)
      .then(() => useStore.getState().pushNotice(`Pedido de namoro enviado pra ${user.displayName}!`))
      .catch((err) => useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível enviar o pedido.'));
  };

  const breakUpRelationship = () => {
    if (!confirm('Terminar o relacionamento confirmado?')) return;
    endRelationshipApi().then(() => setMe((m) => ({ ...m, relationshipPartnerId: null }))).catch(() => {});
  };

  // Item pedido: prévia de 6 fotos no perfil (3 numa linha, 3 na
  // outra) — a galeria completa abre num modal à
  // parte (igual "ver mais" dos recados/depoimentos).
  const [photoPreview, setPhotoPreview] = useState([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [albumOpen, setAlbumOpen] = useState(false);
  useEffect(() => {
    if (!userId) { setPhotoPreview([]); setPhotoTotal(0); return; }
    // BUG CORRIGIDO ("álbum fica feio, ocupa espaço e quebra os
    // outros"): com o layout de colunas (multi-column), uma seção
    // "não quebrável" (break-inside: avoid) e alta — 6 fotos, várias
    // linhas — desequilibrava visualmente as outras colunas ao lado.
    // 3 fotos numa fileira única é bem mais previsível e compacto —
    // igual outras redes fazem (uma prévia rápida, não a galeria
    // inteira).
    listPhotosByOwner(userId).then((d) => { setPhotoPreview(d.photos.slice(0, 3)); setPhotoTotal(d.total); }).catch(() => {});
  }, [userId]);

  const user = data?.user;
  const liveUps = liveUpsOverride ?? data?.totalUps ?? 0;
  const status = presence?.status || user?.status || 'ONLINE';

  const openDM = async () => {
    const { conversation } = await createConversation([userId]);
    closeProfile();
    navigate(`/conversations/${conversation.id}`);
  };

  const addFriend = async () => {
    if (!user) return;
    try { await sendFriendRequest(user.username); setFriendSent(true); } catch { /* already friends / pending — non-fatal */ }
  };

  // Optimistic: flip the counts/myVote locally right away, then reconcile
  // with the server's real numbers — voting feels instant instead of
  // waiting on a round-trip, same pattern the message-reaction UI uses.
  const vote = async (value) => {
    if (!data || isMe) return;
    const prev = { likeCount: data.likeCount, dislikeCount: data.dislikeCount, myVote: data.myVote, totalUps: data.totalUps };
    const wasSame = data.myVote === value;
    const next = { ...prev };
    if (prev.myVote === 1) next.likeCount -= 1;
    if (prev.myVote === -1) next.dislikeCount -= 1;
    if (!wasSame) {
      if (value === 1) next.likeCount += 1;
      else next.dislikeCount += 1;
      next.myVote = value;
    } else {
      next.myVote = 0;
    }
    // Ups totais reagem junto (feedback instantâneo pra quem votou,
    // além do tempo real que o dono do perfil recebe via socket).
    next.totalUps = (data.totalUps ?? 0) + (next.likeCount - prev.likeCount);
    setData((d) => ({ ...d, ...next }));
    try {
      const result = await voteProfile(userId, value);
      setData((d) => (d ? { ...d, ...result } : d));
    } catch (err) {
      // Revert the optimistic update AND actually tell the user it failed —
      // silently swallowing this made the button look like it "does
      // nothing" when the request errored (e.g. server/database out of
      // sync), instead of surfacing a reason.
      console.error('[voteProfile] falhou:', err);
      setData((d) => (d ? { ...d, ...prev } : d));
      useStore.getState().pushNotice(err.response?.data?.error || 'Não foi possível registrar seu voto. Tente novamente.');
    }
  };

  // Item pedido: mais sistemas estilo Orkut — enquetes de perfil,
  // aniversariantes entre amigos. Hooks aqui em cima de propósito,
  // ANTES do guarda "if (!userId) return null" logo abaixo — colocar
  // hooks depois dele quebra o React (número de hooks chamados muda
  // dependendo se o modal está aberto ou fechado), foi exatamente o
  // bug corrigido na resposta anterior.
  // Item pedido: "centralizar em Configurações" — criar/apagar
  // enquete moveu pra lá (UserSettingsModal.jsx, aba Conteúdo). Aqui
  // no perfil fica só a leitura + votação.
  const [profilePolls, setProfilePolls] = useState([]);
  useEffect(() => {
    if (!userId) { setProfilePolls([]); return; }
    listProfilePollsByAuthor(userId).then((d) => setProfilePolls(d.polls)).catch(() => setProfilePolls([]));
  }, [userId]);

  const submitPollVote = (pollId, optionId) => {
    voteProfilePoll(pollId, optionId).then((d) => {
      setProfilePolls((prev) => prev.map((p) => (p.id === pollId ? d.poll : p)));
    }).catch(() => {});
  };

  // Aniversariantes — só busca quando é O MEU PRÓPRIO perfil (é uma
  // lista sobre OS MEUS amigos, não faz sentido em perfil alheio).
  const [birthdays, setBirthdays] = useState({ today: [], upcoming: [] });
  useEffect(() => {
    if (!userId || !isMe) { setBirthdays({ today: [], upcoming: [] }); return; }
    upcomingBirthdaysAmongFriends().then(setBirthdays).catch(() => {});
  }, [userId, isMe]);

  if (!userId) return null;

                /* Item pedido: "sistema igual da Steam" — a pessoa escolhe
                  a ordem das seções do próprio perfil (Configurações →
                  Colunas). SECTION_ELEMENTS é um mapa "chave da seção ->
                  elemento JSX já pronto" (o conteúdo de cada seção é
                  EXATAMENTE o mesmo de antes, só reorganizado nesse
                  formato pra poder ser reordenado). Agora cada seção vira
                  um card e cai numa das abas (PF_SECTION_TAB) — a ordem
                  escolhida continua valendo dentro de cada aba. */
  // BUG CORRIGIDO ("TypeError: can't access property bio, user is
  // undefined"): antes do refactor, todo esse JSX só existia DENTRO de
  // {!loading && user && (...)} — o React só processa (avalia) JSX
  // aninhado quando o elemento pai é de fato renderizado, então nunca
  // rodava com `user` vazio. Agora que isso virou um OBJETO JS comum,
  // construído incondicionalmente toda vez que o componente
  // renderiza, `user.bio` e companhia são avaliados de VERDADE mesmo
  // durante o carregamento inicial (antes do fetch do perfil
  // terminar, quando `data`/`user` ainda são undefined) — daí o erro.
  // `user &&` aqui garante que o objeto só é construído de verdade
  // quando `user` já existe; enquanto carrega, vira um objeto vazio
  // (nenhuma seção tenta ler nada de undefined).
  const firstName = user?.displayName?.split(' ')[0] || '';
  const SECTION_ELEMENTS = user ? {
    about: (
      user.bio && (
        <PfCard icon="user" title="Sobre" className="profile-ig-bio">
          <div className="pf-bio profile-section-body">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
        </PfCard>
      )
    ),
    achievements: (
      (isMe || data.displayedAchievements?.length > 0) && (
        <PfCard icon="trophy" title="Conquistas em destaque" count={data.displayedAchievements?.length}>
          {data.displayedAchievements?.length > 0 ? (
            <div className="pf-tiles">
              {data.displayedAchievements.map((a) => (
                <div key={a.id} className="pf-tile" title={a.description}>
                  <span className="pf-tile-icon">
                    <img src={a.iconUrl ? proxyImage(a.iconUrl) : defaultAchievementIcon} alt="" />
                  </span>
                  <span className="pf-tile-name">{a.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <PfEmpty icon="trophy">
              {isMe ? 'Nenhuma conquista em destaque — escolha em Configurações → Perfil.' : 'Nenhuma conquista em destaque ainda.'}
            </PfEmpty>
          )}
        </PfCard>
      )
    ),
    album: (
      <PfCard
        icon="image"
        title="Álbum de fotos"
        count={photoTotal}
        action={(photoTotal > 3 || isMe) && (
          <button className="pf-link" onClick={() => setAlbumOpen(true)}>
            {isMe ? 'Ver álbum completo' : `Ver mais (${photoTotal})`}
          </button>
        )}
      >
        {photoPreview.length === 0 && (
          <PfEmpty
            icon="image"
            action={isMe && <button className="pf-btn" onClick={() => setAlbumOpen(true)}><PfIcon name="plus" size={14} /> Adicionar foto</button>}
          >
            {isMe ? 'Você ainda não tem fotos no álbum.' : 'Nenhuma foto ainda.'}
          </PfEmpty>
        )}
        {photoPreview.length > 0 && (
          <div className="pf-photos">
            {photoPreview.map((p) => {
              const isVid = p.url.match(/\.(mp4|webm|mov|mkv)$/i);
              return (
                <button key={p.id} className="pf-photo" onClick={() => setAlbumOpen(true)}>
                  {isVid ? <video src={p.url} muted /> : <img src={proxyImage(p.url)} alt="" />}
                  {isVid && <span className="pf-photo-play"><PfIcon name="play" size={14} /></span>}
                </button>
              );
            })}
          </div>
        )}
      </PfCard>
    ),
    polls: (
      (profilePolls.length > 0 || isMe) && (
        <PfCard icon="poll" title="Enquetes" count={profilePolls.length}>
          {/* Item pedido: "centralizar em Configurações" —
              criar/apagar enquete agora só em Configurações
              → Conteúdo. Aqui no perfil fica só a exibição +
              votação, pra quem visita poder participar. */}
          {profilePolls.length === 0 && (
            <PfEmpty icon="poll">{isMe ? 'Nenhuma enquete ainda — crie uma em Configurações → Conteúdo.' : 'Nenhuma enquete ainda.'}</PfEmpty>
          )}
          <div className="pf-polls">
            {profilePolls.map((poll) => (
              <div key={poll.id} className="pf-poll">
                <div className="pf-poll-question">{poll.question}</div>
                {poll.options.map((opt) => (
                  <button
                    key={opt.id}
                    className={`pf-poll-option ${poll.myVoteOptionId === opt.id ? 'active' : ''}`}
                    onClick={() => submitPollVote(poll.id, opt.id)}
                  >
                    <span className="pf-poll-bar" style={{ width: `${opt.percent}%` }} />
                    <span className="pf-poll-text">{opt.text}</span>
                    <span className="pf-poll-percent">{opt.percent}%</span>
                  </button>
                ))}
                <div className="pf-poll-total">{poll.totalVotes} {poll.totalVotes === 1 ? 'voto' : 'votos'}</div>
              </div>
            ))}
          </div>
        </PfCard>
      )
    ),
    // Item pedido: coluna "Modpack preferido" (modpack ou mod em destaque).
    featured_modpack: (
      (isMe || data.featuredItem) && (
        <FeaturedModpackSection
          Card={PfCard}
          item={data.featuredItem || null}
          isMe={isMe}
          onChanged={(featuredItem) => setData((d) => (d ? { ...d, featuredItem } : d))}
          onOpenModpack={() => { closeProfile(); navigate('/jogos/mods'); }}
        />
      )
    ),
    community_activity: (
      redditActivity?.length > 0 && (
        <PfCard icon="flame" title="Atividade em clubes" count={`${redditActivity.reduce((sum, p) => sum + p.score, 0)} Ups`}>
          <div className="pf-list">
            {redditActivity.slice(0, 5).map((post) => (
              <button
                key={post.id}
                className="pf-post"
                onClick={() => { closeProfile(); navigate(`/posts/${post.id}`); }}
              >
                <span className="pf-post-score"><PfIcon name="up" size={12} strokeWidth={2.4} />{post.score}</span>
                <span className="pf-post-info">
                  <span className="pf-post-title">{post.title}</span>
                  <span className="pf-post-club">c/{post.community.name}</span>
                </span>
                <span className="pf-post-arrow"><PfIcon name="arrow" size={14} /></span>
              </button>
            ))}
          </div>
        </PfCard>
      )
    ),
    roles: (
      member && (memberRoles.length > 0 || canManageRoles) && (
        <PfCard icon="shield" title="Cargos na comunidade" count={memberRoles.length} innerRef={rolesSectionRef}>
          <div className="pf-roles profile-roles-row">
            {visibleRoles.map((r) => (
              <span key={r.id} className="role-chip profile-role-chip pf-role" style={roleChipStyle(r.color)}>
                {r.icon ? `${r.icon} ` : ''}{r.name}
                {canManageRoles && (
                  <button
                    type="button"
                    className="profile-role-remove pf-role-remove"
                    title="Remover cargo"
                    onClick={() => removeRole(r.id)}
                  ><PfIcon name="close" size={11} strokeWidth={2.6} /></button>
                )}
              </span>
            ))}
            {hiddenRolesCount > 0 && (
              <button
                type="button"
                className="role-chip profile-role-more pf-role-more"
                title={`Ver todos os ${memberRoles.length} cargos`}
                onClick={() => setRolesExpanded(true)}
              >
                +{hiddenRolesCount}…
              </button>
            )}
            {rolesExpanded && memberRoles.length > ROLES_PREVIEW_COUNT && (
              <button type="button" className="role-chip profile-role-more pf-role-more" onClick={() => setRolesExpanded(false)}>
                mostrar menos
              </button>
            )}
            {canManageRoles && (
              <div className="profile-role-add-wrap">
                <button
                  ref={roleAddBtnRef}
                  type="button"
                  className="role-chip profile-role-add pf-role-add"
                  title="Adicionar cargo"
                  onClick={() => setRoleMenuOpen((v) => !v)}
                ><PfIcon name="plus" size={13} strokeWidth={2.4} /></button>
                {roleMenuOpen && createPortal(
                  <div ref={roleMenuRef} className="profile-role-menu" style={roleMenuStyle || {}}>
                    <input
                      className="profile-role-menu-search"
                      placeholder="Buscar cargo..."
                      value={roleSearch}
                      onChange={(e) => setRoleSearch(e.target.value)}
                      autoFocus
                    />
                    {roleSearchResults.length === 0 && (
                      <div className="empty-hint">{assignableRoles.length === 0 ? 'Nenhum outro cargo disponível.' : 'Nenhum cargo encontrado.'}</div>
                    )}
                    {roleSearchResults.map((r) => (
                      <button
                        type="button"
                        key={r.id}
                        className="profile-role-menu-item"
                        style={roleChipStyle(r.color)}
                        onClick={() => addRole(r.id)}
                      >
                        {r.icon ? `${r.icon} ` : ''}{r.name}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>
            )}
          </div>
        </PfCard>
      )
    ),
    // "Membro desde" virou um bloquinho na fileira de números (logo
    // abaixo do cabeçalho) — continua respeitando se a pessoa ocultou.
    member_since: null,
    connections: (
      (user.youtubeUrl || user.steamUrl || user.robloxUrl || user.xUrl) && (
        <PfCard icon="link" title="Conexões">
          <div className="pf-connections">
            {user.youtubeUrl && (
              <a className="pf-connection" href={user.youtubeUrl} target="_blank" rel="noreferrer" title="YouTube">
                <img src={youtubeIcon} alt="" /> YouTube
              </a>
            )}
            {user.steamUrl && (
              <a className="pf-connection" href={user.steamUrl} target="_blank" rel="noreferrer" title="Steam">
                <img src={steamIcon} alt="" /> Steam
              </a>
            )}
            {user.robloxUrl && (
              <a className="pf-connection" href={user.robloxUrl} target="_blank" rel="noreferrer" title="Roblox">
                <img src={robloxIcon} alt="" /> Roblox
              </a>
            )}
            {user.xUrl && (
              <a className="pf-connection" href={user.xUrl} target="_blank" rel="noreferrer" title="X (Twitter)">
                <img src={xIcon} alt="" /> X
              </a>
            )}
          </div>
        </PfCard>
      )
    ),
    mutual_friends: (
      !isMe && data.mutualFriends?.length > 0 && (
        <PfCard icon="users" title="Amigos em comum" count={data.mutualFriends.length}>
          <div className="pf-people">
            {data.mutualFriends.map((f) => (
              <div key={f.id} className="pf-person">
                <UserAvatar user={f} size={28} />
                <span className="pf-person-name">{f.displayName}</span>
              </div>
            ))}
          </div>
        </PfCard>
      )
    ),
    relationship: (
      (!isMe || me.relationshipPartnerId) ? (
        <PfCard icon="heart" title="Relacionamento">
          {!isMe && (data.relationshipPartner ? (
            <div className="pf-relationship">
              <span className="pf-relationship-icon"><PfIcon name="heart" size={16} /></span>
              <span>Namorando com</span>
              <UserAvatar user={data.relationshipPartner} size={22} />
              <b>{data.relationshipPartner.displayName}</b>
            </div>
          ) : (
            <button className="pf-btn" onClick={requestRelationship}><PfIcon name="heart" size={14} /> Pedir em namoro</button>
          ))}
          {isMe && me.relationshipPartnerId && (
            <div className="pf-relationship">
              <span className="pf-relationship-icon"><PfIcon name="heart" size={16} /></span>
              <span>Em um relacionamento confirmado</span>
              <button className="pf-link danger" onClick={breakUpRelationship}>Terminar</button>
            </div>
          )}
        </PfCard>
      ) : null
    ),
    // Item pedido: mais sistemas estilo Orkut — traços,
    // relacionamento, álbum de fotos, visitantes.
    traits: (
      !isMe && traitStatus ? (
        <PfCard icon="sparkle" title={`O que acham de ${firstName}`}>
          <div className="pf-traits">
            {[
              { key: 'TRUSTWORTHY', label: 'Confiável' },
              { key: 'COOL', label: 'Legal' },
              { key: 'SEXY', label: 'Sexy' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`pf-trait ${traitStatus[key]?.voted ? 'active' : ''}`}
                onClick={() => toggleTraitStatus(key)}
              >
                {label} <b>{traitStatus[key]?.count ?? 0}</b>
              </button>
            ))}
          </div>
        </PfCard>
      ) : null
    ),
    // Item pedido: "sistema igual tinha no Orkut" — recados no mural e
    // depoimentos (o antigo botão de "sou fã" virou "Seguir", movido pra
    // cima, perto de Ups).
    scraps: (
      <PfCard
        icon="chat"
        title="Recados"
        count={scrapTotal}
        className="pf-card-scraps"
        action={scrapTotal > 3 && (
          // Item pedido: mais de 3 recados -> "ver mais" abre todos,
          // paginados 100 por página.
          <button className="pf-link" onClick={() => setScrapListOpen(true)}>Ver todos ({scrapTotal})</button>
        )}
      >
        <div className="pf-composer">
          <input
            value={scrapDraft}
            onChange={(e) => setScrapDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitScrap()}
            placeholder={isMe ? 'Escreva no seu próprio mural...' : `Deixe um recado pra ${user.displayName}...`}
            maxLength={300}
          />
          <button className="pf-send" disabled={!scrapDraft.trim() || scrapSending} onClick={submitScrap} title="Enviar recado">
            <PfIcon name="send" size={15} /> <span>Enviar</span>
          </button>
        </div>
        <div className="pf-scraps">
          {scraps.length === 0 && <PfEmpty icon="chat">Nenhum recado ainda — seja o primeiro a deixar um.</PfEmpty>}
          {scraps.slice(0, 3).map((s) => (
            <div key={s.id} className="pf-scrap">
              <UserAvatar user={s.author} size={32} />
              <div className="pf-scrap-body">
                <span className="pf-scrap-author">{s.author.displayName}</span>
                <span className="pf-scrap-text">{s.text}</span>
              </div>
              {(s.authorId === me.id || isMe) && (
                <button className="pf-scrap-remove" title="Apagar recado" onClick={() => removeScrap(s.id)}><PfIcon name="close" size={13} strokeWidth={2.2} /></button>
              )}
            </div>
          ))}
        </div>
      </PfCard>
    ),
    testimonials: (
      <PfCard
        icon="quote"
        title="Depoimentos"
        count={testimonialTotal}
        action={testimonialTotal > 3 && (
          <button className="pf-link" onClick={() => setTestimonialListOpen(true)}>Ver mais ({testimonialTotal})</button>
        )}
      >
        {!isMe && (
          <div className="pf-composer pf-composer-col">
            <textarea
              value={testimonialDraft}
              onChange={(e) => setTestimonialDraft(e.target.value)}
              placeholder={`Escreva um depoimento pra ${user.displayName}... (fica visível só depois que a pessoa aprovar)`}
              maxLength={1000}
              rows={2}
            />
            <button className="pf-send" disabled={!testimonialDraft.trim() || testimonialSending} onClick={submitTestimonial}>
              <PfIcon name="send" size={15} /> <span>Enviar depoimento</span>
            </button>
          </div>
        )}
        <div className="pf-scraps">
          {testimonials.length === 0 && <PfEmpty icon="quote">Nenhum depoimento ainda.</PfEmpty>}
          {testimonials.slice(0, 3).map((t) => (
            <div key={t.id} className="pf-scrap">
              <UserAvatar user={t.author} size={32} />
              <div className="pf-scrap-body">
                <span className="pf-scrap-author">{t.author.displayName}</span>
                <span className="pf-scrap-text">{t.text}</span>
              </div>
            </div>
          ))}
        </div>
      </PfCard>
    ),
    visitors: (
      isMe && (
        <PfCard icon="eye" title="Quem visitou seu perfil" count={visitorsData.totalVisits}>
          {visitorsData.visits.length === 0 && <PfEmpty icon="eye">Ninguém visitou seu perfil ainda.</PfEmpty>}
          <div className="pf-people">
            {visitorsData.visits.slice(0, 8).map((v) => (
              <div key={v.id} className="pf-person">
                <UserAvatar user={v.visitor} size={28} />
                <span className="pf-person-name">{v.visitor.displayName}</span>
                {v.visitCount > 1 && <span className="pf-person-meta">{v.visitCount}x</span>}
              </div>
            ))}
          </div>
        </PfCard>
      )
    ),
  } : {};

  // Insígnias e aniversariantes não entram na ordem personalizada — ficam
  // fixos no começo das abas Conquistas e Sobre.
  const badgesCard = user && data.badges?.length > 0 && (
    <PfCard
      icon="medal"
      title="Insígnias"
      count={data.badges.length}
      action={<button className="pf-link" onClick={() => setBadgeListOpen(true)}>Ver detalhes</button>}
    >
      <div className="pf-tiles">
        {data.badges.map((b) => (
          <button
            type="button"
            key={b.id}
            className="pf-tile"
            title={b.description || b.name}
            onClick={() => setBadgeListOpen(true)}
          >
            <span className="pf-tile-icon">
              {badgeHasImage(b) ? <img src={proxyImage(b.iconUrl)} alt="" /> : b.icon}
            </span>
            <span className="pf-tile-name">{b.name}</span>
          </button>
        ))}
      </div>
    </PfCard>
  );

  const birthdaysCard = user && isMe && (birthdays.today.length > 0 || birthdays.upcoming.length > 0) && (
    <PfCard icon="cake" title="Aniversariantes">
      {birthdays.today.length > 0 && (
        <div className="pf-birthday-today"><PfIcon name="cake" size={15} /> Hoje: {birthdays.today.map((f) => f.displayName).join(', ')}</div>
      )}
      {birthdays.upcoming.length > 0 && (
        <div className="pf-people">
          {birthdays.upcoming.map((f) => (
            <div key={f.id} className="pf-person">
              <UserAvatar user={f} size={28} />
              <span className="pf-person-name">{f.displayName}</span>
              <span className="pf-person-meta">{String(f.day).padStart(2, '0')}/{String(f.month).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      )}
    </PfCard>
  );

  // Distribui as seções visíveis (na ordem escolhida) pelas abas.
  const visibleKeys = user ? visibleProfileSectionOrder(user.profileSectionOrder) : [];
  const tabContent = { about: [], activity: [], achievements: [], wall: [] };
  if (user) {
    if (badgesCard) tabContent.achievements.push(['badges', badgesCard]);
    visibleKeys.forEach((key) => {
      const el = SECTION_ELEMENTS[key];
      const tab = PF_SECTION_TAB[key];
      if (el && tab) tabContent[tab].push([key, el]);
    });
    if (birthdaysCard) tabContent.about.push(['birthdays', birthdaysCard]);
  }
  const tabCounts = {
    achievements: user ? (data.badges?.length || 0) + (data.displayedAchievements?.length || 0) : 0,
    wall: scrapTotal,
  };
  const tabs = PF_TABS.filter((t) => tabContent[t.id].length > 0);
  const currentTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0]?.id;
  const currentCards = currentTab ? tabContent[currentTab] : [];
  const showMemberSince = visibleKeys.includes('member_since');
  const createdAt = user ? new Date(user.createdAt) : null;

  return (
    <div className="modal-overlay profile-fullscreen-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeProfile(); }}>
      <div
        className={`modal-box profile-modal-box profile-modal-fullscreen ${user ? 'profile-modal-accented' : ''}`}
        style={user ? {
          ...profileAccentVars(user.profileColor),
          // Item pedido: "opacidade das caixas das colunas" — 0-100
          // salvo no banco vira 0-1 aqui (formato que rgba() espera).
          '--profile-section-opacity': user.profileSectionOpacity != null ? user.profileSectionOpacity / 100 : undefined,
        } : undefined}
      >
        <button className="icon-btn profile-modal-close" onClick={closeProfile}><img className="ui-icon" src={cancelIcon} alt="x" /></button>
        {isMe && (
          <button className="icon-btn profile-modal-edit" onClick={() => useStore.getState().openSettings()} title="Editar perfil">
            <img className="ui-icon" src={settingsIcon} alt="" />
          </button>
        )}
        {loading && (
          <div className="pf-skeleton" aria-label="Carregando perfil">
            <div className="pf-sk pf-sk-banner" />
            <div className="pf-sk-row">
              <div className="pf-sk pf-sk-avatar" />
              <div className="pf-sk-lines"><span className="pf-sk" /><span className="pf-sk" /><span className="pf-sk" /></div>
            </div>
            <div className="pf-sk-cards"><span className="pf-sk" /><span className="pf-sk" /><span className="pf-sk" /><span className="pf-sk" /></div>
          </div>
        )}
        {!loading && user && (
          <>
            <div className="profile-top-row">
              <div className="profile-banner" style={{ background: user.bannerUrl ? undefined : 'transparent' }}>
                {user.bannerUrl && <img src={proxyImage(user.bannerUrl)} alt="" />}
              </div>
              <div className="profile-ig-header">
                <div className="avatar-wrap large">
                  <div className="avatar xlarge">
                    <UserAvatar user={user} size={112} />
                  </div>
                  <PresenceDot status={status} large title={STATUS_LABEL[status]} />
                </div>
                <div className="profile-ig-header-info">
                  <h2 className="profile-display-name">
                    <span className={nameStyleClassName(user, { fullEffect: true })} style={nameStyleProps(user, { fullEffect: true })}>{user.displayName}</span> <PendantIcon user={user} /> <TagBadge user={user} /> <ClanTagBadge user={user} />
                    {/* Item pedido: "no dia do aniversário, mostrar no
                        perfil a indicação visual" */}
                    {data.isBirthdayToday && <span className="profile-birthday-badge pf-birthday-badge" title="Aniversário hoje!"><PfIcon name="cake" size={20} /></span>}
                  </h2>
                  <div className="profile-username">@{user.username}{user.pronouns && <span className="profile-pronouns-inline"> · {user.pronouns}</span>}</div>
                  <div className="profile-custom-status-balloon">
                    <ActivityIcon userId={user.id} customStatusEmoji={user.customStatusEmoji} customStatus={user.customStatus} />
                  </div>
                  <ActivityBadge userId={user.id} />
                </div>
              </div>
            </div>

            <div className="profile-modal-body">
              <div className="pf">
                {/* Item pedido: "Privacidade do perfil... O servidor deve
                    verificar essa configuração antes de devolver
                    informações" — profileRestricted vem PRONTO do backend
                    (getUser em userController.js), calculado a partir da
                    configuração de QUEM É O DONO do perfil; aqui só avisa
                    visualmente, sem revelar qual privacidade exata a
                    pessoa escolheu nem tentar "adivinhar" o que falta. */}
                {!isMe && data.profileRestricted && (
                  <div className="pf-notice profile-restricted-notice">
                    <span className="pf-notice-icon"><PfIcon name="lock" size={16} /></span>
                    Esta pessoa limitou quem pode ver os detalhes completos do perfil — você está vendo só as informações públicas.
                  </div>
                )}
                {/* Barra de nível redesenhada — mostra XP atual/necessário
                    e o número de porcentagem, não só uma barrinha muda. */}
                <div className="profile-level-bar-wrap">
                  <div className="profile-level-bar-labels">
                    <span className="profile-level-bar-chip"><img className="ui-icon-sm" src={levelStarIcon} alt="" /> Nível {user.accountLevel ?? 1}</span>
                    <span className="dim">{data.levelProgress ?? 0}% para o próximo nível</span>
                  </div>
                  <div className="profile-level-progress-track">
                    <div className="profile-level-progress-fill" style={{ width: `${data.levelProgress ?? 0}%`, background: user.levelBarColor || undefined }} />
                  </div>
                </div>

                {!isMe && (
                  <div className="profile-ig-actions-row">
                    <div className="profile-actions profile-ig-actions">
                      <button className="btn-primary" onClick={openDM}>Enviar mensagem</button>
                      <button className="btn-secondary" onClick={addFriend} disabled={friendSent}>
                        {friendSent ? 'Solicitado' : 'Adicionar amigo'}
                      </button>
                      <button className={`btn-secondary ${fanStatus.isFan ? 'active' : ''}`} onClick={toggleFanStatus}>
                        {fanStatus.isFan ? 'Seguindo' : 'Seguir'}
                      </button>
                    </div>
                    {/* Botões de voto num grupo próprio (antes ficavam
                        espremidos ao lado dos botões grandes). */}
                    <div className="profile-vote-group">
                      <button
                        type="button"
                        className={`icon-btn profile-vote-icon-btn like ${data.myVote === 1 ? 'active' : ''}`}
                        title="Dar Up"
                        onClick={() => vote(1)}
                      >
                        <img className="ui-icon-sm" src={likeIcon} alt="" />
                      </button>
                      <button
                        type="button"
                        className={`icon-btn profile-vote-icon-btn dislike ${data.myVote === -1 ? 'active' : ''}`}
                        title={`Dar Down (${data.dislikeCount ?? 0})`}
                        onClick={() => vote(-1)}
                      >
                        <img className="ui-icon-sm" src={dislikeIcon} alt="" /> {data.dislikeCount ?? 0}
                      </button>
                    </div>
                  </div>
                )}

                {/* Números do perfil em bloquinhos (antes ficavam soltos no
                    cabeçalho, em caixa alta). Ups atualiza em tempo real. */}
                <div className="pf-stats">
                  <div className="pf-stat">
                    <span className="pf-stat-icon"><PfIcon name="up" size={16} strokeWidth={2.2} /></span>
                    <span className="pf-stat-text"><b>{liveUps}</b><span>Ups</span></span>
                  </div>
                  <div className="pf-stat">
                    <span className="pf-stat-icon"><PfIcon name="star" size={16} /></span>
                    <span className="pf-stat-text"><b>{user.accountLevel ?? 1}</b><span>Nível</span></span>
                  </div>
                  {/* Item pedido: "seguir" do lado de Ups — o número fica
                      junto dos outros contadores; o botão fica junto dos
                      outros botões de ação. */}
                  <div className="pf-stat">
                    <span className="pf-stat-icon"><PfIcon name="users" size={16} /></span>
                    <span className="pf-stat-text"><b>{fanStatus.count}</b><span>{fanStatus.count === 1 ? 'Seguidor' : 'Seguidores'}</span></span>
                  </div>
                  {data.badges?.length > 0 && (
                    <button type="button" className="pf-stat pf-stat-btn" onClick={() => setBadgeListOpen(true)} title="Ver insígnias">
                      <span className="pf-stat-icon"><PfIcon name="medal" size={16} /></span>
                      <span className="pf-stat-text"><b>{data.badges.length}</b><span>Insígnias</span></span>
                    </button>
                  )}
                  {!isMe && data.mutualFriends?.length > 0 && (
                    <div className="pf-stat">
                      <span className="pf-stat-icon"><PfIcon name="users" size={16} /></span>
                      <span className="pf-stat-text"><b>{data.mutualFriends.length}</b><span>Em comum</span></span>
                    </div>
                  )}
                  {showMemberSince && (
                    <div className="pf-stat" title={`Membro desde ${createdAt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}`}>
                      <span className="pf-stat-icon"><PfIcon name="calendar" size={16} /></span>
                      <span className="pf-stat-text">
                        <b className="pf-stat-date">{(() => { const m = createdAt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${createdAt.getFullYear()}`; })()}</b>
                        <span>Entrou em</span>
                      </span>
                    </div>
                  )}
                </div>

                {badgeListOpen && (
                  <BadgeListModal userName={user.displayName} badges={data.badges} onClose={() => setBadgeListOpen(false)} />
                )}

                {tabs.length > 1 && (
                  <div className="pf-tabs" role="tablist">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={currentTab === t.id}
                        className={`pf-tab ${currentTab === t.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(t.id)}
                      >
                        <PfIcon name={t.icon} size={16} />
                        {t.label}
                        {tabCounts[t.id] > 0 && <span className="pf-tab-count">{tabCounts[t.id]}</span>}
                      </button>
                    ))}
                  </div>
                )}

                <div className={`pf-grid ${currentCards.length === 1 ? 'single' : ''}`} key={currentTab}>
                  {currentCards.map(([key, el]) => (
                    <div key={key} className="pf-grid-item">{el}</div>
                  ))}
                </div>
              </div>

              {scrapListOpen && (
                <PaginatedListModal
                  title={`Recados de ${user.displayName}`}
                  emptyLabel="Nenhum recado ainda."
                  onClose={() => setScrapListOpen(false)}
                  fetchPage={(page) => listScraps(userId, page).then((d) => ({ items: d.scraps, totalPages: d.totalPages }))}
                  renderItem={(s) => (
                    <div key={s.id} className="profile-scrap-item">
                      <UserAvatar user={s.author} size={28} />
                      <div className="profile-scrap-item-body">
                        <span className="profile-scrap-item-author">{s.author.displayName}</span>
                        <span className="profile-scrap-item-text">{s.text}</span>
                      </div>
                      {(s.authorId === me.id || isMe) && (
                        <button className="profile-scrap-item-remove" title="Apagar recado" onClick={() => { removeScrap(s.id); setScrapListOpen(false); }}>✕</button>
                      )}
                    </div>
                  )}
                />
              )}

              {testimonialListOpen && (
                <PaginatedListModal
                  title={`Depoimentos de ${user.displayName}`}
                  emptyLabel="Nenhum depoimento ainda."
                  onClose={() => setTestimonialListOpen(false)}
                  fetchPage={(page) => listApprovedTestimonials(userId, page).then((d) => ({ items: d.testimonials, totalPages: d.totalPages }))}
                  renderItem={(t) => (
                    <div key={t.id} className="profile-testimonial-item">
                      <UserAvatar user={t.author} size={32} />
                      <div className="profile-testimonial-item-body">
                        <span className="profile-testimonial-item-author">{t.author.displayName}</span>
                        <span className="profile-testimonial-item-text">{t.text}</span>
                      </div>
                    </div>
                  )}
                />
              )}

              {albumOpen && (
                <PhotoAlbumModal
                  ownerId={userId}
                  ownerName={user.displayName}
                  isMe={isMe}
                  onClose={() => setAlbumOpen(false)}
                />
              )}
            </div>
          </>
        )}
        {!loading && !user && (
          <div className="profile-modal-error pf-error">
            <span className="pf-error-icon"><PfIcon name="alert" size={26} /></span>
            <div className="profile-modal-error-title">Não foi possível carregar este perfil</div>
            <div className="dim">Tente fechar e abrir de novo em alguns instantes.</div>
          </div>
        )}
      </div>
      {/* O modal de Configurações agora é renderizado uma única vez, globalmente, em MainApp.jsx — reage ao mesmo estado (settingsModalOpen) que o botão de engrenagem acima e o do cabeçalho abrem, então não precisa mais de uma instância própria aqui dentro. */}
    </div>
  );
}
