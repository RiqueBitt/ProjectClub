import { useEffect, useRef, useState } from 'react';
import AchievementIcon from '../AchievementIcon.jsx';
import UiIcon from '../UiIcon.jsx';
import { profileStyleClass } from '../../utils/profileStyle';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useLiveRefresh, sameData } from '../../utils/liveRefresh';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext.jsx';
import { createConversation, sendFriendRequest, assignRole, unassignRole, voteProfile, listApprovedTestimonials, writeTestimonial, listScraps, writeScrap, deleteScrap, toggleFan, registerProfileVisit, toggleTrait, sendRelationshipRequest, endRelationship as endRelationshipApi, listPhotosByOwner, voteProfilePoll, upcomingBirthdaysAmongFriends } from '../../api/endpoints';
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
import BadgeIcon from '../BadgeIcon.jsx';
import { nameStyleProps, nameStyleClassName } from '../../utils/nameStyle';
import cancelIcon from '../../assets/icons/close-x.png';
import likeIcon from '../../assets/icons/like.png';
import dislikeIcon from '../../assets/icons/dislike.png';
import youtubeIcon from '../../assets/icons/social-youtube.png';
import steamIcon from '../../assets/icons/social-steam.png';
import robloxIcon from '../../assets/icons/social-roblox.png';
import xIcon from '../../assets/icons/social-x.png';
import { proxyImage } from '../../utils/imageProxy';
import { getProfileSummary } from '../../api/profileSummary';
import { peekSummary, peekProfile } from '../../api/profileCache';
import { visibleProfileSectionOrder } from '../../utils/profileSections';
import FeaturedModpackSection from '../FeaturedModpackSection.jsx';
import ProfileGamesSection from '../games/ProfileGamesSection.jsx';
import ProfilePet from '../pet/ProfilePet.jsx';
import { lookQuery, shareProfile, IgnoreButton } from '../profile/ProfileActions.jsx';
import { useProfileExtras, MuralCard, RecentActivityCard, StatBadgesCard, WishlistCard, MuralEditorModal } from '../profile/ProfileExtras.jsx';
import '../../styles/profile.css';
import '../../styles/profile-edit.css';
import '../../styles/profile-layout.css';
import BannerImage from '../ProfileBanner.jsx';
import ImageCropperModal from './ImageCropperModal.jsx';
import ProfileShowcaseModal, { parseShowcase } from './ProfileShowcaseModal.jsx';
import { GameCapsule } from '../games/GameLibraryParts.jsx';
import ProfileCards from '../../cards/ProfileCards.jsx';
import { isFeatureEnabled } from '../../utils/features';
import { PROFILE_BANNER_ASPECT } from '../ProfileBanner.jsx';
import { canViewProfileImage, viewProfileImage } from '../../utils/viewProfileImage';
import ReportDialog from './ReportDialog.jsx';
import { updateProfile, uploadAvatar, uploadBanner, reportUserProfile } from '../../api/endpoints';

// PfIcon/PfCard moveram pra profileParts.jsx (re-exportados aqui).
import { PfIcon, PfCard } from './profileParts.jsx';
import { looksLikeGif, isGifByContent, GIF_AVATAR_MAX_MB } from '../../utils/gifDetect';
import { conversationPath } from '../../utils/prettyLinks';
import { getReputation } from '../../api/community';
import RoleIcon from '../RoleIcon.jsx';
export { PfIcon, PfCard };

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

// Perfil completo em duas partes (redesenho de nov/2026, pedido do dono:
// "mais organizado e minimalista"). À esquerda fica quem a pessoa é — Sobre,
// cargos, conexões, amigos em comum — sempre à vista. À direita, o resto em
// abas, pra não virar uma página sem fim. Cada seção (chave de
// profileSections.js) cai num lugar; a ordem DENTRO de cada um continua
// sendo a que a pessoa escolheu em Configurações → Colunas.
const PF_ASIDE = 'aside';
const PF_TABS = [
  { id: 'overview', label: 'Visão geral', icon: 'grid' },
  { id: 'games', label: 'Jogos', icon: 'bolt' },
  { id: 'badges', label: 'Conquistas', icon: 'trophy' },
  { id: 'wall', label: 'Recados', icon: 'chat' },
];
const PF_SECTION_TAB = {
  about: PF_ASIDE, roles: PF_ASIDE, connections: PF_ASIDE, mutual_friends: PF_ASIDE, relationship: PF_ASIDE, traits: PF_ASIDE, member_since: PF_ASIDE,
  polls: 'overview', album: 'overview',
  community_activity: 'games', featured_modpack: 'games',
  achievements: 'badges',
  scraps: 'wall', testimonials: 'wall', visitors: 'wall',
};

// Tela estreita (celular, tablet, janela pequena): não cabe coluna ao lado,
// então o "Sobre" vira a primeira aba. Mesma medida do CSS (profile-layout.css).
const PF_NARROW_QUERY = '(max-width: 1020px)';
const PF_ABOUT_TAB = { id: 'about', label: 'Sobre', icon: 'user' };
function useNarrowScreen() {
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(PF_NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia?.(PF_NARROW_QUERY);
    if (!mq) return undefined;
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

// Rendered once at the app root (see MainApp.jsx) and driven entirely by
// `viewingProfileUserId` in the zustand store — call `openProfile(userId)`
// from anywhere (message author avatar, member list, your own user panel)
// to pop it open, no prop drilling needed.
// Aniversários não aparecem mais na interface (segurança de dados).
const HIDE_BIRTHDAYS = true;

// Contêiner com rolagem mais próximo (o modal rola por dentro, não a página).
function scrollParent(el) {
  for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

// Seções pesadas do perfil (recados, depoimentos, fotos, posts) só são
// buscadas quando aparecem na tela (ou chegam a 400px de aparecer) —
// antes tudo era buscado ao abrir, mesmo o que a pessoa nunca rolou até
// ver. `refFor(chave)` vai no elemento da seção; `on[chave]` vira true
// quando ela apareceu. Recomeça a cada perfil aberto.
function useLazySections(resetKey) {
  const [state, setState] = useState({ key: resetKey, on: {} });
  const on = state.key === resetKey ? state.on : {};
  const onRef = useRef(on);
  onRef.current = on;
  const cbs = useRef({});
  const observers = useRef({});
  useEffect(() => () => { Object.values(observers.current).forEach((o) => o.disconnect()); observers.current = {}; }, []);
  const turnOn = (key) => setState((st) => {
    const cur = st.key === resetKey ? st.on : {};
    return cur[key] ? st : { key: resetKey, on: { ...cur, [key]: true } };
  });
  const refFor = (key) => {
    const id = `${resetKey}:${key}`;
    if (!cbs.current[id]) {
      cbs.current[id] = (el) => {
        observers.current[id]?.disconnect();
        delete observers.current[id];
        if (!el || onRef.current[key]) return;
        if (typeof IntersectionObserver === 'undefined') { turnOn(key); return; }
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) { io.disconnect(); delete observers.current[id]; turnOn(key); }
        }, { root: scrollParent(el), rootMargin: '400px 0px' });
        io.observe(el);
        observers.current[id] = io;
      };
    }
    return cbs.current[id];
  };
  return { on, refFor };
}

// Bloco "carregando" de uma seção que ainda não chegou.
function PfLazySkeleton() {
  return <span className="pf-sk" style={{ height: 56, margin: '4px 0' }} aria-hidden="true" />;
}

// "Denunciar" perfil: denúncia rápida (ReportDialog.jsx) — um clique no
// motivo + detalhes opcionais. Vai pra mesma fila de denúncias da staff
// (Painel → Denúncias).
function ReportProfileDialog({ user, onClose }) {
  return (
    <ReportDialog
      title={`Denunciar o perfil de ${user.displayName}`}
      subtitle={<>@{user.username}</>}
      onSubmit={(category, details) => reportUserProfile(user.id, category, details)}
      onClose={onClose}
    />
  );
}

// `embedded` + `previewUser`: desenha o próprio perfil dentro do Editor de
// perfil (ProfileEditorFrame), com as mudanças ainda não salvas por cima.
export default function UserProfileModal({ embedded = false, previewUser = null } = {}) {
  const storeProfileUserId = useStore((s) => s.viewingProfileUserId);
  const userId = embedded ? previewUser?.id : storeProfileUserId;
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
  const [badgeListOpen, setBadgeListOpen] = useState(false); // false | true | id da insígnia clicada
  // Edição direto no próprio perfil (rodada 7): nome, bio, foto, banner
  // e a vitrine. null = não está editando.
  const [nameDraft, setNameDraft] = useState(null);
  const [bioDraft, setBioDraft] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [cropper, setCropper] = useState(null);
  const [showcaseOpen, setShowcaseOpen] = useState(false);
  // Extras (Mural, Lista de desejos, Atividade recente, Estatísticas, Nota).
  const [extras, setExtras] = useProfileExtras(userId);
  const [muralOpen, setMuralOpen] = useState(false);
  useEffect(() => { setMuralOpen(false); }, [userId]);
  useEffect(() => { setNameDraft(null); setBioDraft(null); setInlineError(''); setShowcaseOpen(false); }, [userId]);
  // Aba ativa do perfil (Visão geral / Jogos / Conquistas / Recados) —
  // volta pra primeira sempre que abre outro perfil.
  // (null = a primeira que existir: "Sobre" no celular, "Visão geral" no computador.)
  const [activeTab, setActiveTab] = useState(null);
  useEffect(() => { setActiveTab(null); }, [userId]);
  const narrow = useNarrowScreen();
  // Menu "Mais" (compartilhar, ignorar, denunciar…) e se a pessoa tem jogos.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [gamesHas, setGamesHas] = useState(false);
  useEffect(() => { setMoreOpen(false); setGamesHas(false); }, [userId]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => { if (!moreRef.current?.contains(e.target)) setMoreOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [moreOpen]);
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

  // Seções carregadas só quando aparecem na tela (ver useLazySections).
  const { on: lazyOn, refFor: lazyRef } = useLazySections(userId);
  // Quais seções preguiçosas já chegaram (pra mostrar "carregando" e não
  // "nada ainda" enquanto a resposta não vem).
  const [lazyDoneState, setLazyDoneState] = useState({ key: userId, done: {} });
  const lazyDone = lazyDoneState.key === userId ? lazyDoneState.done : {};
  const markLazyDone = (forUser, k) => setLazyDoneState((st) => {
    if (forUser !== userIdRef.current) return st;
    const cur = st.key === forUser ? st.done : {};
    return cur[k] ? st : { key: forUser, done: { ...cur, [k]: true } };
  });
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Cabeçalho (perfil + "seguir" + traços + enquetes + visitantes) numa
  // requisição só — ver api/profileSummary.js. Antes eram 5 separadas.
  const applySummary = (r) => {
    if (r.fan) setFanStatus((prev) => (sameData(prev, r.fan) ? prev : r.fan));
    if (r.traits) setTraitStatus((prev) => (sameData(prev, r.traits) ? prev : r.traits));
    if (r.polls?.polls) setProfilePolls((prev) => (sameData(prev, r.polls.polls) ? prev : r.polls.polls));
    if (r.visitors) setVisitorsData((prev) => (sameData(prev, r.visitors) ? prev : r.visitors));
  };
  useEffect(() => {
    if (!userId) { setData(null); return; }
    // Já visto (perfil completo ou miniperfil): mostra na hora e atualiza
    // por trás — ver api/profileCache.js. Só mostra o esqueleto de
    // "carregando" quando não há NADA desse usuário ainda.
    const cachedSummary = peekSummary(userId);
    const cachedProfile = cachedSummary?.profile || peekProfile(userId);
    let alive = true;
    // Depois dos efeitos abaixo que zeram "sou fã"/enquetes/visitantes ao
    // trocar de perfil (rodam em seguida, na mesma passada).
    if (cachedSummary) queueMicrotask(() => { if (alive) applySummary(cachedSummary); });
    if (cachedProfile) {
      setData(cachedProfile);
      if (cachedProfile.activity) useStore.getState().setActivity(userId, cachedProfile.activity);
      setLoading(false);
    } else setLoading(true);
    getProfileSummary(userId, { isMe: userId === me.id }).then((summary) => {
      if (!alive) return;
      const result = summary.profile;
      applySummary(summary);
      setData(result);
      // BUG CORRIGIDO ("meu perfil não mostra jogo/Spotify"): o
      // ActivityBadge só lê do estado atualizado AO VIVO pelo socket
      // (activities no store) — nunca era alimentado com o que o
      // próprio pedido de perfil já trazia (result.activity). Se
      // nenhum aviso ao vivo tivesse chegado ainda desde que a página
      // carregou, o badge ficava vazio mesmo com a atividade
      // existindo de verdade no servidor.
      if (result?.activity) useStore.getState().setActivity(userId, result.activity);
    }).catch(() => { if (alive && !cachedProfile) setData(null); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  // A seção "Atividade em clubes" (posts do Fórum) saiu junto com o Fórum (nov/2026).

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
    if (!lazyOn.testimonials) { setTestimonials([]); setTestimonialTotal(0); return; }
    listApprovedTestimonials(userId).then((d) => { setTestimonials(d.testimonials); setTestimonialTotal(d.total ?? d.testimonials.length); }).catch(() => setTestimonials([])).finally(() => markLazyDone(userId, 'testimonials'));
  }, [userId, lazyOn.testimonials]);

  const [scraps, setScraps] = useState([]);
  const [scrapTotal, setScrapTotal] = useState(0);
  const [scrapDraft, setScrapDraft] = useState('');
  const [scrapSending, setScrapSending] = useState(false);
  const [scrapListOpen, setScrapListOpen] = useState(false);
  useEffect(() => {
    if (!userId) { setScraps([]); setScrapTotal(0); return; }
    if (!lazyOn.scraps) { setScraps([]); setScrapTotal(0); return; }
    listScraps(userId).then((d) => { setScraps(d.scraps); setScrapTotal(d.total ?? d.scraps.length); }).catch(() => setScraps([])).finally(() => markLazyDone(userId, 'scraps'));
  }, [userId, lazyOn.scraps]);

  const [fanStatus, setFanStatus] = useState({ count: 0, isFan: false });
  useEffect(() => {
    // Valor real chega junto do cabeçalho (applySummary).
    setFanStatus({ count: 0, isFan: false });
  }, [userId]);

  // Fase 4: reputação (agradecimentos recebidos) — contador na fileira de números.
  const [reputation, setReputation] = useState(null);
  useEffect(() => {
    setReputation(null);
    if (!userId) return;
    getReputation(userId).then((r) => setReputation(r.total)).catch(() => setReputation(null));
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
      // Cargos ficam na coluna da esquerda, sempre à vista.
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
  }, [roleMenuOpen]);

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

  // Aplica o que o servidor devolveu na conta (AuthContext) e no perfil aberto.
  const applyMine = (updated) => {
    if (!updated) return;
    setMe((m) => ({ ...m, ...updated }));
    setData((d) => (d ? { ...d, user: { ...d.user, ...updated } } : d));
  };
  const saveInline = async (patch, done) => {
    setInlineSaving(true);
    setInlineError('');
    try {
      const { user: updated } = await updateProfile(patch);
      applyMine(updated);
      done?.();
    } catch (err) {
      setInlineError(err?.response?.data?.error || 'Não foi possível salvar. Tente de novo.');
    } finally {
      setInlineSaving(false);
    }
  };
  const submitName = () => {
    const v = (nameDraft || '').trim();
    if (!v) { setInlineError('O nome não pode ficar vazio.'); return; }
    if (v === data?.user?.displayName) { setNameDraft(null); return; }
    saveInline({ displayName: v }, () => setNameDraft(null));
  };
  const submitBio = () => {
    const v = (bioDraft || '').slice(0, 190);
    if (v === (data?.user?.bio || '')) { setBioDraft(null); return; }
    saveInline({ bio: v }, () => setBioDraft(null));
  };
  // Foto/banner: mesmos envios de Configurações (GIF vai direto pra não
  // perder a animação; imagem passa pelo recortador).
  const isGif = looksLikeGif;
  const pickAvatarFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    // GIF: editor só enquadra (sem canvas) e o servidor recorta todos os
    // quadros — a animação continua (ver utils/gifDetect e Configurações).
    if (await isGifByContent(file)) {
      if (file.size > GIF_AVATAR_MAX_MB * 1024 * 1024) { setInlineError(`GIF grande demais: o limite para foto de perfil é ${GIF_AVATAR_MAX_MB} MB.`); return; }
      setInlineError('');
      setCropper({
        file, mode: 'frame', gif: true, aspectRatio: 1, shape: 'circle', title: 'Ajustar avatar (GIF)', preview: 'avatar',
        onConfirm: async (outFile, framing) => { const { user: u } = await uploadAvatar(outFile, framing); applyMine(u); setCropper(null); },
      });
      return;
    }
    setCropper({
      file, aspectRatio: 1, shape: 'circle', title: 'Ajustar avatar', preview: 'avatar',
      onConfirm: async (cropped) => { const { user: u } = await uploadAvatar(cropped); applyMine(u); setCropper(null); },
    });
  };
  const pickBannerFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    const gif = isGif(file);
    if (gif && file.size > 25 * 1024 * 1024) { setInlineError('GIF grande demais: o limite é 25 MB.'); return; }
    setCropper({
      file, mode: gif ? 'frame' : 'crop', aspectRatio: PROFILE_BANNER_ASPECT, shape: 'rect', preview: 'banner', title: 'Ajustar banner do perfil',
      onConfirm: async (outFile, framing) => { const { user: u } = await uploadBanner(outFile, framing); applyMine(u); setCropper(null); },
    });
  };

  // Item pedido: mais sistemas estilo Orkut — traços (confiável/legal/
  // sexy), visitantes de perfil, relacionamento, e prévia do álbum de
  // fotos, tudo carregado junto do resto do perfil.
  const [traitStatus, setTraitStatus] = useState(null);
  useEffect(() => {
    // Valor real chega junto do cabeçalho (applySummary).
    setTraitStatus(null);
  }, [userId]);

  const toggleTraitStatus = (trait) => {
    toggleTrait(userId, trait).then(setTraitStatus).catch(() => {});
  };

  // Visitantes só carrega quando é O MEU PRÓPRIO perfil (é a única
  // pessoa que pode ver essa lista — checado no servidor também).
  const [visitorsData, setVisitorsData] = useState({ visits: [], totalVisits: 0 });
  useEffect(() => {
    // Valor real chega junto do cabeçalho (applySummary, só no próprio perfil).
    setVisitorsData({ visits: [], totalVisits: 0 });
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
    if (!userId || !lazyOn.album) { setPhotoPreview([]); setPhotoTotal(0); return; }
    // BUG CORRIGIDO ("álbum fica feio, ocupa espaço e quebra os
    // outros"): com o layout de colunas (multi-column), uma seção
    // "não quebrável" (break-inside: avoid) e alta — 6 fotos, várias
    // linhas — desequilibrava visualmente as outras colunas ao lado.
    // 3 fotos numa fileira única é bem mais previsível e compacto —
    // igual outras redes fazem (uma prévia rápida, não a galeria
    // inteira).
    listPhotosByOwner(userId).then((d) => { setPhotoPreview(d.photos.slice(0, 3)); setPhotoTotal(d.total); }).catch(() => {}).finally(() => markLazyDone(userId, 'album'));
  }, [userId, lazyOn.album]);

  const user = embedded && data?.user && previewUser ? { ...data.user, ...previewUser } : data?.user;
  const liveUps = liveUpsOverride ?? data?.totalUps ?? 0;
  const status = presence?.status || user?.status || 'ONLINE';

  const openDM = async () => {
    try {
      const { conversation } = await createConversation([userId]);
      closeProfile();
      navigate(conversationPath(conversation));
    } catch (err) {
      // Privacidade de DM / bloqueio: o servidor recusa com uma mensagem
      // pronta — antes isso virava um erro silencioso no console.
      useStore.getState().pushNotice?.(err?.response?.data?.error || 'Não foi possível abrir a conversa.');
    }
  };

  const [reportOpen, setReportOpen] = useState(false);

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
    // Valor real chega junto do cabeçalho (applySummary).
    setProfilePolls([]);
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
    // Aniversários escondidos da interface (segurança de dados) — não busca mais.
    if (HIDE_BIRTHDAYS || !userId || !isMe) { setBirthdays({ today: [], upcoming: [] }); return; }
    upcomingBirthdaysAmongFriends().then(setBirthdays).catch(() => {});
  }, [userId, isMe]);

  // Tempo real: cabeçalho (1 requisição, ver api/profileSummary.js) a cada
  // 30s — 60s com o socket conectado (Ups/atividade já chegam por evento).
  // As seções pesadas só se já foram abertas (apareceram na tela), num
  // ritmo mais leve. Em silêncio: o modal continua aberto, na mesma
  // aba/scroll, sem skeleton e sem apagar o recado sendo digitado.
  useLiveRefresh(async (ctx) => {
    const summary = await getProfileSummary(userId, { isMe });
    if (!ctx.ok() || !summary?.profile) return;
    const result = summary.profile;
    setData((prev) => (sameData(prev, result) ? prev : result));
    applySummary(summary);
    if (result.activity) useStore.getState().setActivity(userId, result.activity);
  }, { enabled: !!userId, key: userId, interval: 30000, realtimeInterval: 60000 });

  useLiveRefresh(async (ctx) => {
    const { put } = ctx;
    const jobs = [];
    if (isMe && !HIDE_BIRTHDAYS) jobs.push(upcomingBirthdaysAmongFriends().then(put(setBirthdays)));
    if (lazyOn.album) jobs.push(listPhotosByOwner(userId).then((d) => { put(setPhotoPreview)(d.photos.slice(0, 3)); put(setPhotoTotal)(d.total); }));
    if (lazyOn.scraps) jobs.push(listScraps(userId).then((d) => { put(setScraps)(d.scraps); put(setScrapTotal)(d.total ?? d.scraps.length); }));
    if (lazyOn.testimonials) jobs.push(listApprovedTestimonials(userId).then((d) => { put(setTestimonials)(d.testimonials); put(setTestimonialTotal)(d.total ?? d.testimonials.length); }));
    await Promise.allSettled(jobs);
  }, { enabled: !!userId, key: userId, interval: 60000, realtimeInterval: 120000 });

  // Banner do perfil completo: estica o banner pra trás do cabeçalho até
  // logo depois de onde termina o texto (nome + tags/cargo do clube), e o
  // esmaecido fica só nessa pontinha — não "come" metade da imagem.
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
      (user.bio || isMe) && (
        <PfCard
          icon="user" title="Sobre" className="profile-ig-bio"
          action={isMe && bioDraft === null && (
            <button type="button" className="pf-link" onClick={() => { setInlineError(''); setBioDraft(user.bio || ''); }}>{user.bio ? 'Editar' : 'Adicionar'}</button>
          )}
        >
          {isMe && bioDraft !== null ? (
            <div className="pfe-bio-editor">
              <textarea
                value={bioDraft} maxLength={190} rows={4} autoFocus aria-label="Sua bio"
                placeholder="Conte um pouco sobre você"
                onChange={(e) => setBioDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setBioDraft(null); } if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitBio(); }}
              />
              <div className="pfe-row">
                <span className="pfe-count">{bioDraft.length}/190</span>
                <button type="button" className="pf-btn ghost" onClick={() => setBioDraft(null)}>Cancelar</button>
                <button type="button" className="pf-btn" disabled={inlineSaving} onClick={submitBio}>{inlineSaving ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </div>
          ) : user.bio ? (
            <div className="pf-bio profile-section-body">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
          ) : (
            <PfEmpty icon="user">Você ainda não escreveu uma bio.</PfEmpty>
          )}
        </PfCard>
      )
    ),
    achievements: (
      (isMe || data.displayedAchievements?.length > 0) && (
        <PfCard
          icon="trophy" title="Em destaque" count={data.displayedAchievements?.length}
          action={isMe && <button type="button" className="pf-link" onClick={() => setShowcaseOpen(true)}>Editar vitrine</button>}
        >
          {data.displayedAchievements?.length > 0 ? (
            <div className="pf-tiles">
              {data.displayedAchievements.map((a) => (
                <div key={a.id} className="pf-tile" title={a.description}>
                  <span className="pf-tile-icon">
                    <AchievementIcon achievement={a} size={30} tile={false} />
                  </span>
                  <span className="pf-tile-name">{a.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <PfEmpty icon="trophy">
              {isMe ? 'Nenhuma conquista em destaque ainda.' : 'Nenhuma conquista em destaque ainda.'}
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
        innerRef={lazyRef('album')}
        action={(photoTotal > 3 || isMe) && (
          <button className="pf-link" onClick={() => setAlbumOpen(true)}>
            {isMe ? 'Ver álbum completo' : `Ver mais (${photoTotal})`}
          </button>
        )}
      >
        {!lazyDone.album && <PfLazySkeleton />}
        {lazyDone.album && photoPreview.length === 0 && (
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
    // Fórum removido do app (nov/2026): a seção de posts não aparece mais.
    community_activity: null,
    roles: (
      member && (memberRoles.length > 0 || canManageRoles) && (
        <PfCard icon="shield" title="Cargos na comunidade" count={memberRoles.length} innerRef={rolesSectionRef}>
          <div className="pf-roles profile-roles-row">
            {visibleRoles.map((r) => (
              <span key={r.id} className="role-chip profile-role-chip pf-role" style={roleChipStyle(r.color)}>
                <RoleIcon icon={r.icon} />{r.name}
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
                        <RoleIcon icon={r.icon} />{r.name}
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
        innerRef={lazyRef('scraps')}
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
          {!lazyDone.scraps && <PfLazySkeleton />}
          {lazyDone.scraps && scraps.length === 0 && <PfEmpty icon="chat">Nenhum recado ainda — seja o primeiro a deixar um.</PfEmpty>}
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
        innerRef={lazyRef('testimonials')}
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
          {!lazyDone.testimonials && <PfLazySkeleton />}
          {lazyDone.testimonials && testimonials.length === 0 && <PfEmpty icon="quote">Nenhum depoimento ainda.</PfEmpty>}
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
            onClick={() => setBadgeListOpen(b.id)}
          >
            <span className="pf-tile-icon">
              <BadgeIcon badge={b} size={30} />
            </span>
            <span className="pf-tile-name">{b.name}</span>
          </button>
        ))}
      </div>
    </PfCard>
  );

  const birthdaysCard = !HIDE_BIRTHDAYS && user && isMe && (birthdays.today.length > 0 || birthdays.upcoming.length > 0) && (
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

  // Vitrine: jogos em destaque escolhidos pela pessoa (User.profileShowcase).
  const showcaseGames = user ? parseShowcase(user.profileShowcase).games : [];
  const showcaseCard = user && (showcaseGames.length > 0 || isMe) && (
    <PfCard
      icon="star" title="Jogos em destaque" count={showcaseGames.length}
      action={isMe && <button type="button" className="pf-link" onClick={() => setShowcaseOpen(true)}>Editar vitrine</button>}
    >
      {showcaseGames.length > 0 ? (
        <div className="pfe-games">
          {showcaseGames.map((g) => (
            <div key={g.gameKey} className="pfe-game" title={g.name}>
              <GameCapsule game={g} size="sm" />
              <span className="pfe-game-name">{g.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <PfEmpty icon="star" action={<button type="button" className="pf-btn" onClick={() => setShowcaseOpen(true)}><PfIcon name="plus" size={14} /> Escolher jogos</button>}>
          Mostre aqui os jogos que você mais curte.
        </PfEmpty>
      )}
    </PfCard>
  );

  // Guerra das Cartas (Jogo de Cartas): vitrine + desafiar/trocar.
  const cardsGameCard = user && isFeatureEnabled('cardsWar') && (
    <PfCard icon="star" title="Guerra das Cartas">
      <ProfileCards userId={user.id} isMe={isMe} onNavigate={closeProfile} />
    </PfCard>
  );

  // Distribui as seções visíveis (na ordem escolhida) entre a coluna da
  // esquerda e as abas.
  const visibleKeys = user ? visibleProfileSectionOrder(user.profileSectionOrder) : [];
  const tabContent = { [PF_ASIDE]: [], overview: [], games: [], badges: [], wall: [] };
  if (user && extras && !extras.failed) {
    const muralCard = <MuralCard user={user} extras={extras} isMe={isMe} onEdit={() => setMuralOpen(true)} />;
    if (isMe || extras.widgets) tabContent.overview.push(['mural', muralCard]);
    if (extras.stats?.length) tabContent.badges.push(['stat_badges', <StatBadgesCard extras={extras} />]);
    if (extras.activity && (isMe || extras.activity.length)) tabContent.games.push(['recent_activity', <RecentActivityCard extras={extras} isMe={isMe} />]);
  }
  if (user) {
    if (showcaseCard) tabContent.overview.push(['showcase_games', showcaseCard]);
    if (cardsGameCard) tabContent.overview.push(['cards_game', cardsGameCard]);
    if (badgesCard) tabContent.badges.unshift(['badges', badgesCard]);
    visibleKeys.forEach((key) => {
      const el = SECTION_ELEMENTS[key];
      const tab = PF_SECTION_TAB[key];
      if (el && tab) tabContent[tab].push([key, el]);
    });
    if (birthdaysCard) tabContent[PF_ASIDE].push(['birthdays', birthdaysCard]);
    if (extras && !extras.failed && extras.wishlist && (isMe || extras.wishlist.length)) {
      tabContent.overview.push(['wishlist', <WishlistCard user={user} extras={extras} isMe={isMe} setExtras={setExtras} />]);
    }
  }
  const showMemberSince = visibleKeys.includes('member_since');
  const createdAt = user ? new Date(user.createdAt) : null;
  const friendsSince = user && !isMe && data.friendsSince ? new Date(data.friendsSince) : null;
  const longDate = (d) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const metaLines = user ? [
    showMemberSince && !Number.isNaN(createdAt.getTime()) && ['calendar', `No Project Club desde ${longDate(createdAt)}`],
    friendsSince && !Number.isNaN(friendsSince.getTime()) && ['heart', `Amigos desde ${longDate(friendsSince)}`],
  ].filter(Boolean) : [];
  // O "Sobre": cartões da esquerda + as datas. No computador fica na coluna;
  // em tela estreita vira a primeira aba.
  const hasAbout = tabContent[PF_ASIDE].length > 0 || metaLines.length > 0;
  const aboutBody = (
    <>
      {tabContent[PF_ASIDE].map(([key, el]) => (
        <div key={key} className="pf-grid-item">{el}</div>
      ))}
      {metaLines.length > 0 && (
        <ul className="pfl-meta">
          {metaLines.map(([icon, text]) => <li key={icon}><PfIcon name={icon} size={15} /> {text}</li>)}
        </ul>
      )}
    </>
  );
  // A biblioteca de jogos carrega sozinha (ProfileGamesSection) e avisa se tem o que mostrar.
  const tabs = [
    ...(narrow && hasAbout ? [PF_ABOUT_TAB] : []),
    ...PF_TABS.filter((t) => tabContent[t.id].length > 0 || (t.id === 'games' && gamesHas)),
  ];
  const currentTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0]?.id;
  const levelPct = Math.max(0, Math.min(100, Number(data?.levelProgress ?? 0)));

  return (
    <div className={`modal-overlay profile-fullscreen-overlay${embedded ? ' pf-embedded' : ''}`} onMouseDown={(e) => { if (!embedded && e.target === e.currentTarget) closeProfile(); }}>
      <div
        className={`modal-box profile-modal-box profile-modal-fullscreen pfl ${user ? 'profile-modal-accented' : ''}${profileStyleClass(user)}`}
        style={user ? {
          ...profileAccentVars(user.profileColor),
          // Item pedido: "opacidade das caixas das colunas" — 0-100
          // salvo no banco vira 0-1 aqui (formato que rgba() espera).
          '--profile-section-opacity': user.profileSectionOpacity != null ? user.profileSectionOpacity / 100 : undefined,
        } : undefined}
      >
        {!embedded && <button className="icon-btn profile-modal-close" onClick={closeProfile} aria-label="Fechar perfil" title="Fechar"><img className="ui-icon" src={cancelIcon} alt="" /></button>}
        {/* Seu próprio perfil: atalho discreto pro Editor de perfil. */}
        {!embedded && isMe && user && (
          <button type="button" className="pf-edit-corner" onClick={() => { closeProfile(); useStore.getState().openProfileEditor(); }} title="Editar perfil">
            <PfIcon name="pencil" size={13} /> <span>Editar perfil</span>
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
            {/* Topo: banner, foto, nome e insígnias. Só o que identifica a pessoa. */}
            <div className="profile-top-row">
              <div className="profile-banner" style={{ background: user.bannerUrl ? undefined : 'transparent' }}>
                {/* Enquadramento escolhido no editor de banner (ProfileBanner.jsx). */}
                <BannerImage url={user.bannerUrl} framing={user.bannerFraming} />
                {canViewProfileImage(user.bannerUrl) && (
                  <button type="button" className="pf-image-view pf-banner-view" onClick={() => viewProfileImage(user.bannerUrl, `${user.username}-banner`)} aria-label="Ver banner em tamanho cheio" title="Ver banner" />
                )}
                {isMe && (
                  <label className="pfe-banner-edit" title="Trocar banner">
                    <PfIcon name="image" size={15} /> <span>Trocar banner</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pickBannerFile} />
                  </label>
                )}
              </div>
              <div className="profile-ig-header">
                <div className="avatar-wrap large">
                  {/* 116 = caixa de 128px menos a borda de 6px dos dois lados
                      (antes 112: sobrava um vão de 2px em volta da foto). */}
                  <div className="avatar xlarge">
                    {!isMe && canViewProfileImage(user.avatarUrl) ? (
                      <button type="button" className="pf-image-view pf-avatar-view" onClick={() => viewProfileImage(user.avatarUrl, `${user.username}-foto`)} aria-label="Ver foto de perfil em tamanho cheio" title="Ver foto de perfil">
                        <UserAvatar user={user} size={116} />
                      </button>
                    ) : <UserAvatar user={user} size={116} />}
                  </div>
                  {isMe && (
                    <label className="pfe-avatar-edit" title="Trocar foto">
                      <PfIcon name="image" size={20} />
                      <span>Trocar foto</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pickAvatarFile} />
                    </label>
                  )}
                  <PresenceDot status={status} userId={user.id} large title={STATUS_LABEL[status]} />
                </div>
                <div className="profile-ig-header-info">
                  {isMe && nameDraft !== null ? (
                    <div className="pfe-name-editor">
                      <input
                        value={nameDraft} maxLength={32} autoFocus aria-label="Nome de exibição"
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') { e.stopPropagation(); setNameDraft(null); setInlineError(''); } }}
                      />
                      <button type="button" className="pf-btn" disabled={inlineSaving} onClick={submitName}>{inlineSaving ? 'Salvando…' : 'Salvar'}</button>
                      <button type="button" className="pf-btn ghost" onClick={() => { setNameDraft(null); setInlineError(''); }}>Cancelar</button>
                    </div>
                  ) : (
                  <h2 className="profile-display-name">
                    {isMe ? (
                      <button type="button" className="pfe-name-btn" title="Clique pra mudar seu nome" onClick={() => { setInlineError(''); setNameDraft(user.displayName); }}>
                        <span className={nameStyleClassName(user, { fullEffect: true })} style={nameStyleProps(user, { fullEffect: true })}>{user.displayName}</span>
                        <span className="pfe-pencil" aria-hidden="true"><PfIcon name="pencil" size={13} /></span>
                      </button>
                    ) : (
                      <span className={nameStyleClassName(user, { fullEffect: true })} style={nameStyleProps(user, { fullEffect: true })}>{user.displayName}</span>
                    )} <PendantIcon user={user} /> <TagBadge user={user} /> <ClanTagBadge user={user} />
                    {/* Item pedido: "no dia do aniversário, mostrar no
                        perfil a indicação visual" */}
                    {!HIDE_BIRTHDAYS && data.isBirthdayToday && <span className="profile-birthday-badge pf-birthday-badge" title="Aniversário hoje!"><PfIcon name="cake" size={20} /></span>}
                  </h2>
                  )}
                  {isMe && inlineError && <div className="pfe-error" role="alert"><PfIcon name="alert" size={13} /> {inlineError}</div>}
                  <div className="profile-username">@{user.username}{user.pronouns && <span className="profile-pronouns-inline"> · {user.pronouns}</span>}</div>
                  {/* Só o status personalizado aqui — a atividade (jogo/
                      música) aparece uma vez só, na coluna da esquerda. */}
                  {(user.customStatus || user.customStatusEmoji) && (
                    <div className="profile-custom-status-balloon">
                      <ActivityIcon userId={user.id} customStatusEmoji={user.customStatusEmoji} customStatus={user.customStatus} hideActivity />
                    </div>
                  )}
                </div>
                <div className="pfx-head-side">
                  {/* Até 4 insígnias no canto de cima, perto do nome. */}
                  {data.badges?.length > 0 && (
                    <div className="pfx-head-badges" role="list" aria-label="Insígnias">
                      {data.badges.slice(0, 4).map((b) => (
                        <button type="button" role="listitem" key={b.id} className="pfx-head-badge" title={b.description ? `${b.name} — ${b.description}` : b.name} aria-label={b.name} onClick={() => setBadgeListOpen(b.id)}>
                          <BadgeIcon badge={b} size={30} tile />
                        </button>
                      ))}
                      {data.badges.length > 4 && (
                        <button type="button" className="pfx-head-badge more" title="Ver todas as insígnias" onClick={() => setBadgeListOpen(true)}>+{data.badges.length - 4}</button>
                      )}
                    </div>
                  )}
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

                {/* Uma faixa só: os números à esquerda e as ações à direita.
                    Três botões com nome; o resto vai no menu "Mais". */}
                <div className="pfl-bar">
                  <div className="pf-stats" aria-label="Números do perfil">
                    <div className="pf-stat pfl-level" title={`${levelPct}% para o próximo nível`}>
                      <span className="pf-stat-text"><b>{user.accountLevel ?? 1}</b><span>Nível</span></span>
                      <span className="profile-level-progress-track" role="progressbar" aria-label="Progresso para o próximo nível" aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelPct}>
                        <span className="profile-level-progress-fill" style={{ width: `${levelPct}%`, background: user.levelBarColor || undefined }} />
                      </span>
                    </div>
                    <div className="pf-stat">
                      <span className="pf-stat-text"><b>{liveUps}</b><span>Ups</span></span>
                    </div>
                    {reputation !== null && (
                      <div className="pf-stat" title="Agradecimentos recebidos da comunidade">
                        <span className="pf-stat-text"><b>{reputation}</b><span>Reputação</span></span>
                      </div>
                    )}
                    <div className="pf-stat">
                      <span className="pf-stat-text"><b>{fanStatus.count}</b><span>{fanStatus.count === 1 ? 'Seguidor' : 'Seguidores'}</span></span>
                    </div>
                  </div>

                  {!isMe ? (
                    <div className="pfl-actions">
                      <button type="button" className="btn-primary" onClick={openDM}>Mensagem</button>
                      <button type="button" className="btn-secondary" onClick={addFriend} disabled={friendSent}>{friendSent ? 'Solicitado' : 'Adicionar amigo'}</button>
                      <button type="button" className={`btn-secondary ${fanStatus.isFan ? 'active' : ''}`} aria-pressed={fanStatus.isFan} onClick={toggleFanStatus}>{fanStatus.isFan ? 'Seguindo' : 'Seguir'}</button>
                      <div className="profile-vote-group" role="group" aria-label="Avaliar perfil">
                        <button type="button" className={`icon-btn profile-vote-icon-btn like ${data.myVote === 1 ? 'active' : ''}`} title="Dar Up" aria-label="Dar Up" aria-pressed={data.myVote === 1} onClick={() => vote(1)}>
                          <img className="ui-icon-sm" src={likeIcon} alt="" />
                        </button>
                        <button type="button" className={`icon-btn profile-vote-icon-btn dislike ${data.myVote === -1 ? 'active' : ''}`} title={`Dar Down (${data.dislikeCount ?? 0})`} aria-label="Dar Down" aria-pressed={data.myVote === -1} onClick={() => vote(-1)}>
                          <img className="ui-icon-sm" src={dislikeIcon} alt="" /> {data.dislikeCount ?? 0}
                        </button>
                      </div>
                      <div className="pfl-more" ref={moreRef}>
                        <button type="button" className="icon-btn pfl-more-btn" aria-haspopup="menu" aria-expanded={moreOpen} aria-label="Mais opções" title="Mais opções" onClick={() => setMoreOpen((v) => !v)}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
                        </button>
                        {moreOpen && (
                          <div className="pfl-menu" role="menu">
                            {lookQuery(user) && (
                              <button type="button" role="menuitem" className="pfl-menu-item" onClick={() => { setMoreOpen(false); closeProfile(); navigate(`/loja?look=${encodeURIComponent(lookQuery(user))}&from=${encodeURIComponent(user.displayName)}`); }}>
                                <PfIcon name="sparkle" size={16} /> Adquira este visual
                              </button>
                            )}
                            <button type="button" role="menuitem" className="pfl-menu-item" onClick={() => { setMoreOpen(false); shareProfile(user); }}>
                              <PfIcon name="link" size={16} /> Compartilhar perfil
                            </button>
                            <IgnoreButton user={user} className="pfl-menu-item" role="menuitem" icon={<PfIcon name="eye" size={16} />} onDone={() => setMoreOpen(false)} />
                            <button type="button" role="menuitem" className="pfl-menu-item danger" onClick={() => { setMoreOpen(false); setReportOpen(true); }}>
                              <PfIcon name="alert" size={16} /> Denunciar perfil
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="pfl-actions">
                      {!embedded && <button type="button" className="btn-primary" onClick={() => { closeProfile(); useStore.getState().openProfileEditor(); }}>Editar perfil</button>}
                      <button type="button" className="btn-secondary" onClick={() => setShowcaseOpen(true)}>Editar vitrine</button>
                    </div>
                  )}
                </div>

                {badgeListOpen && (
                  <BadgeListModal userName={user.displayName} badges={data.badges} initialId={typeof badgeListOpen === 'string' ? badgeListOpen : undefined} onClose={() => setBadgeListOpen(false)} />
                )}

                <div className={`pfl-layout${tabs.length === 0 ? ' is-solo' : ''}`}>
                  {/* Esquerda (computador): quem a pessoa é. */}
                  {!narrow && (
                    <aside className="pfl-aside" aria-label="Sobre">
                      <div className="pfx-head-activity"><ActivityBadge userId={user.id} /></div>
                      {aboutBody}
                    </aside>
                  )}

                  {/* Direita: o resto, em abas. Todas ficam montadas (a que não
                      está aberta só fica escondida), então nada recarrega ao trocar. */}
                  <div className="pfl-main">
                    {narrow && <div className="pfx-head-activity"><ActivityBadge userId={user.id} /></div>}
                    {tabs.length > 1 && (
                      <div className="pf-tabs" role="tablist" aria-label="Seções do perfil">
                        {tabs.map((t) => (
                          <button
                            key={t.id} type="button" role="tab" id={`pf-tab-${t.id}`} aria-controls={`pf-panel-${t.id}`}
                            aria-selected={currentTab === t.id} tabIndex={currentTab === t.id ? 0 : -1}
                            className={`pf-tab${currentTab === t.id ? ' active' : ''}`}
                            onClick={() => setActiveTab(t.id)}
                            onKeyDown={(e) => {
                              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                              const i = tabs.findIndex((x) => x.id === currentTab);
                              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
                              setActiveTab(next.id);
                              requestAnimationFrame(() => document.getElementById(`pf-tab-${next.id}`)?.focus());
                            }}
                          >
                            <PfIcon name={t.icon} size={16} /> {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {narrow && hasAbout && (
                      <div
                        role="tabpanel" id="pf-panel-about" aria-labelledby={tabs.length > 1 ? 'pf-tab-about' : undefined} aria-label={tabs.length > 1 ? undefined : 'Sobre'}
                        className="pf-tabpanel pf-tabpanel-about pfl-aside" hidden={currentTab !== 'about'}
                      >
                        {aboutBody}
                      </div>
                    )}
                    {PF_TABS.map((t) => {
                      const shown = tabs.some((x) => x.id === t.id);
                      // A biblioteca de jogos fica sempre montada: é ela que diz se a aba Jogos aparece.
                      if (!shown && t.id !== 'games') return null;
                      return (
                        <div
                          key={t.id} role="tabpanel" id={`pf-panel-${t.id}`} aria-labelledby={tabs.length > 1 ? `pf-tab-${t.id}` : undefined}
                          aria-label={tabs.length > 1 ? undefined : t.label}
                          className={`pf-tabpanel pf-tabpanel-${t.id}`} hidden={!shown || currentTab !== t.id}
                        >
                          <div className={`pf-grid${t.id === 'overview' || tabContent[t.id].length === 1 ? ' single' : ''}`}>
                            {tabContent[t.id].map(([key, el]) => (
                              <div key={key} className="pf-grid-item">{el}</div>
                            ))}
                          </div>
                          {t.id === 'games' && <ProfileGamesSection userId={user.id} onContent={setGamesHas} />}
                          {/* Fase 8: mascote pinguim do perfil. */}
                          {t.id === 'games' && isFeatureEnabled('profilePet') && <ProfilePet userId={user.id} isMe={isMe} onNavigate={closeProfile} />}
                        </div>
                      );
                    })}
                  </div>
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
                        <button className="profile-scrap-item-remove" title="Apagar recado" onClick={() => { removeScrap(s.id); setScrapListOpen(false); }}><UiIcon name="x" size={14} /></button>
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

              {isMe && muralOpen && (
                <MuralEditorModal
                  extras={extras}
                  onClose={() => setMuralOpen(false)}
                  onSaved={(widgets) => setExtras((e) => ({ ...e, widgets }))}
                />
              )}
              {isMe && showcaseOpen && (
                <ProfileShowcaseModal
                  user={user}
                  displayedAchievements={data.displayedAchievements || []}
                  onClose={() => setShowcaseOpen(false)}
                  onSaved={(patch) => {
                    if (patch.user) applyMine(patch.user);
                    if (patch.displayedAchievements) {
                      setData((d) => (d ? { ...d, displayedAchievements: patch.displayedAchievements } : d));
                      setMe((m) => ({ ...m, displayedAchievements: JSON.stringify(patch.displayedAchievements.map((a) => a.key)) }));
                    }
                  }}
                />
              )}
              {!isMe && reportOpen && (
                <ReportProfileDialog user={user} onClose={() => setReportOpen(false)} />
              )}
              {isMe && cropper && (
                <ImageCropperModal
                  file={cropper.file}
                  mode={cropper.mode}
                  gif={!!cropper.gif}
                  preview={cropper.preview}
                  previewUser={user}
                  aspectRatio={cropper.aspectRatio}
                  shape={cropper.shape}
                  title={cropper.title}
                  onConfirm={cropper.onConfirm}
                  onClose={() => setCropper(null)}
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
      {/* Efeito de perfil da Loja (por cima de tudo, sem receber clique). */}
      {/* Efeitos de perfil saíram (no lugar: efeitos de texto no nome). */}
      {/* O modal de Configurações agora é renderizado uma única vez, globalmente, em MainApp.jsx — reage ao mesmo estado (settingsModalOpen) que o botão de engrenagem acima e o do cabeçalho abrem, então não precisa mais de uma instância própria aqui dentro. */}
    </div>
  );
}
