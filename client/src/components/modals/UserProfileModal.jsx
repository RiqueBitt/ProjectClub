import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../context/AuthContext.jsx';
import { getUserProfile, createConversation, sendFriendRequest, assignRole, unassignRole, voteProfile, listPosts, setActiveTag, listApprovedTestimonials, writeTestimonial, listScraps, writeScrap, deleteScrap, getFanStatus, toggleFan, registerProfileVisit, listProfileVisitors, getTraitStatus, toggleTrait, sendRelationshipRequest, endRelationship as endRelationshipApi, listPhotosByOwner } from '../../api/endpoints';
import { STATUS_LABEL, STATUS_COLOR } from '../../utils/status';
import { renderRichContent } from '../../utils/richTextRender.jsx';
import { getMyCommunityPermissions, hasPermission } from '../../utils/permissions';
import { roleChipStyle, gradientStops } from '../../utils/roleColor';
import { profileAccentVars } from '../../utils/profileAccent';
import TagBadge from '../TagBadge.jsx';
import UserAvatar from '../UserAvatar.jsx';
import StatusEmoji from '../StatusEmoji.jsx';
import ActivityBadge from '../ActivityBadge.jsx';
import ActivityIcon from '../ActivityIcon.jsx';
import BadgeListModal from './BadgeListModal.jsx';
import PaginatedListModal from './PaginatedListModal.jsx';
import PhotoAlbumModal from './PhotoAlbumModal.jsx';
import defaultAchievementIcon from '../../assets/icons/nav-achievements.png';
import { badgeHasImage } from '../../utils/badgeRarity';
import { nameStyleProps } from '../../utils/nameStyle';
import cancelIcon from '../../assets/icons/cancel.png';
import settingsIcon from '../../assets/icons/settings.png';
import likeIcon from '../../assets/icons/like.png';
import dislikeIcon from '../../assets/icons/dislike.png';
import youtubeIcon from '../../assets/icons/social-youtube.png';
import steamIcon from '../../assets/icons/social-steam.png';
import robloxIcon from '../../assets/icons/social-roblox.png';
import xIcon from '../../assets/icons/social-x.png';
import levelStarIcon from '../../assets/icons/level-star.png';
import { proxyImage } from '../../utils/imageProxy';
import { parseProfileSectionOrder } from '../../utils/profileSections';

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
  // Item pedido: "tag da comunidade" saiu de Configurações e mora aqui
  // dentro do próprio perfil agora (ver UserSettingsModal.jsx, onde essa
  // mesma lógica existia antes).
  const [tagSaving, setTagSaving] = useState(false);
  const pickTag = async (active) => {
    setTagSaving(true);
    try {
      const { user: updated } = await setActiveTag(active);
      setMe(updated);
    } finally {
      setTagSaving(false);
    }
  };
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
      setRolesExpanded(true);
      setRoleMenuOpen(true);
      rolesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    // Item pedido: prévia do álbum no perfil com 6 fotos (3 numa
    // linha, 3 na outra) — não 3.
    listPhotosByOwner(userId).then((d) => { setPhotoPreview(d.photos.slice(0, 6)); setPhotoTotal(d.total); }).catch(() => {});
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
  const [profilePolls, setProfilePolls] = useState([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollCreating, setPollCreating] = useState(false);
  useEffect(() => {
    if (!userId) { setProfilePolls([]); return; }
    listProfilePollsByAuthor(userId).then((d) => setProfilePolls(d.polls)).catch(() => setProfilePolls([]));
  }, [userId]);

  const submitPollVote = (pollId, optionId) => {
    voteProfilePoll(pollId, optionId).then((d) => {
      setProfilePolls((prev) => prev.map((p) => (p.id === pollId ? d.poll : p)));
    }).catch(() => {});
  };

  const createPoll = () => {
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!pollQuestion.trim() || cleanOptions.length < 2 || pollCreating) return;
    setPollCreating(true);
    createProfilePoll(pollQuestion.trim(), cleanOptions)
      .then((d) => { setProfilePolls((prev) => [d.poll, ...prev]); setPollQuestion(''); setPollOptions(['', '']); })
      .catch((err) => useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível criar a enquete.'))
      .finally(() => setPollCreating(false));
  };

  const removePoll = (pollId) => {
    if (!confirm('Apagar essa enquete?')) return;
    deleteProfilePoll(pollId).then(() => setProfilePolls((prev) => prev.filter((p) => p.id !== pollId))).catch(() => {});
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
                  formato pra poder ser reordenado) — INSÍGNIAS/TAG DA
                  COMUNIDADE/ANIVERSARIANTES continuam sempre fixas no
                  topo (não fazem sentido como "conteúdo social"
                  reordenável). CSS multi-column (ver global.css) deixa o
                  navegador distribuir visualmente em 2 colunas sozinho,
                  preservando a ordem escolhida — nenhuma lógica extra
                  daqui precisa decidir "isso vai na coluna 1 ou 2". */
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
  const SECTION_ELEMENTS = user ? {
    about: (
user.bio && (
                    <div className="profile-section profile-ig-bio">
                      <div className="profile-section-label">SOBRE</div>
                      <div className="profile-section-body">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
                    </div>
                  )
    ),
    achievements: (
(isMe || data.displayedAchievements?.length > 0) && (
                    <div className="profile-section">
                      <div className="profile-section-label">
                        <span>CONQUISTAS EM DESTAQUE</span>
                      </div>
                      {data.displayedAchievements?.length > 0 ? (
                        <div className="profile-badges-grid">
                          {data.displayedAchievements.map((a) => (
                            <div key={a.id} className="profile-badge-tile" title={a.description}>
                              <span className="profile-badge-tile-icon">
                                <img className="profile-badge-img" src={a.iconUrl ? proxyImage(a.iconUrl) : defaultAchievementIcon} alt="" />
                              </span>
                              <span className="profile-badge-tile-name truncate">{a.name}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="dim" style={{ fontSize: 13 }}>
                          {isMe ? 'Nenhuma conquista em destaque — escolha em Configurações → Perfil.' : 'Nenhuma conquista em destaque ainda.'}
                        </p>
                      )}
                    </div>
                  )
    ),
    album: (
<div className="profile-section">
                    <div className="profile-section-label">ÁLBUM DE FOTOS{photoTotal > 0 ? ` — ${photoTotal}` : ''}</div>
                    {photoPreview.length === 0 && <div className="dim profile-scrap-empty">Nenhuma foto ainda.</div>}
                    {photoPreview.length > 0 && (
                      <div className="profile-photo-grid">
                        {photoPreview.map((p) => (
                          <button key={p.id} className="profile-photo-grid-item" onClick={() => setAlbumOpen(true)}>
                            {p.url.match(/\.(mp4|webm|mov|mkv)$/i)
                              ? <video src={p.url} muted />
                              : <img src={proxyImage(p.url)} alt="" />}
                          </button>
                        ))}
                      </div>
                    )}
                    {(photoTotal > 6 || isMe) && (
                      <button className="profile-see-more-link" onClick={() => setAlbumOpen(true)}>
                        {isMe ? 'Ver álbum completo' : `Ver mais (${photoTotal})`}
                      </button>
                    )}
                  </div>
    ),
    polls: (
<div className="profile-section">
                    <div className="profile-section-label">ENQUETES{profilePolls.length > 0 ? ` — ${profilePolls.length}` : ''}</div>
                    {isMe && (
                      <div className="profile-poll-composer">
                        <input value={pollQuestion} onChange={(e) => setPollQuestion(e.target.value)} placeholder="Pergunta da enquete..." maxLength={200} />
                        {pollOptions.map((opt, i) => (
                          <input
                            key={i}
                            value={opt}
                            onChange={(e) => setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                            placeholder={`Opção ${i + 1}`}
                            maxLength={100}
                          />
                        ))}
                        <div className="profile-poll-composer-actions">
                          {pollOptions.length < 10 && <button className="btn-secondary" onClick={() => setPollOptions((prev) => [...prev, ''])}>+ Opção</button>}
                          <button className="btn-secondary" disabled={pollCreating} onClick={createPoll}>Criar enquete</button>
                        </div>
                      </div>
                    )}
                    {profilePolls.length === 0 && <div className="dim profile-scrap-empty">Nenhuma enquete ainda.</div>}
                    {profilePolls.map((poll) => (
                      <div key={poll.id} className="profile-poll">
                        <div className="profile-poll-question">{poll.question}</div>
                        {poll.options.map((opt) => (
                          <button
                            key={opt.id}
                            className={`profile-poll-option ${poll.myVoteOptionId === opt.id ? 'active' : ''}`}
                            onClick={() => submitPollVote(poll.id, opt.id)}
                          >
                            <span className="profile-poll-option-bar" style={{ width: `${opt.percent}%` }} />
                            <span className="profile-poll-option-text truncate">{opt.text}</span>
                            <span className="profile-poll-option-percent">{opt.percent}%</span>
                          </button>
                        ))}
                        <div className="dim profile-poll-total">{poll.totalVotes} {poll.totalVotes === 1 ? 'voto' : 'votos'}</div>
                        {isMe && <button className="profile-relationship-end" onClick={() => removePoll(poll.id)}>Apagar enquete</button>}
                      </div>
                    ))}
                  </div>
    ),
    community_activity: (
redditActivity?.length > 0 && (
                    <div className="profile-section">
                      <div className="profile-section-label">
                        ATIVIDADE EM CLUBES — {redditActivity.reduce((sum, p) => sum + p.score, 0)} Ups
                      </div>
                      <div className="profile-reddit-activity-list">
                        {redditActivity.slice(0, 5).map((post) => (
                          <button
                            key={post.id}
                            className="profile-reddit-activity-item"
                            onClick={() => { closeProfile(); navigate(`/posts/${post.id}`); }}
                          >
                            <span className="profile-reddit-activity-score">{post.score}</span>
                            <span className="profile-reddit-activity-info truncate">
                              <span className="truncate">{post.title}</span>
                              <span className="dim">c/{post.community.name}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
    ),
    roles: (
member && (memberRoles.length > 0 || canManageRoles) && (
                    <div className="profile-section" ref={rolesSectionRef}>
                      <div className="profile-section-label">
                        CARGOS NA COMUNIDADE
                      </div>
                      <div className="profile-roles-row">
                        {visibleRoles.map((r) => (
                          <span key={r.id} className="role-chip profile-role-chip" style={roleChipStyle(r.color)}>
                            {r.icon ? `${r.icon} ` : ''}{r.name}
                            {canManageRoles && (
                              <button
                                type="button"
                                className="profile-role-remove"
                                title="Remover cargo"
                                onClick={() => removeRole(r.id)}
                              >×</button>
                            )}
                          </span>
                        ))}
                        {hiddenRolesCount > 0 && (
                          <button
                            type="button"
                            className="role-chip profile-role-more"
                            title={`Ver todos os ${memberRoles.length} cargos`}
                            onClick={() => setRolesExpanded(true)}
                          >
                            +{hiddenRolesCount}…
                          </button>
                        )}
                        {rolesExpanded && memberRoles.length > ROLES_PREVIEW_COUNT && (
                          <button type="button" className="role-chip profile-role-more" onClick={() => setRolesExpanded(false)}>
                            mostrar menos
                          </button>
                        )}
                        {canManageRoles && (
                          <div className="profile-role-add-wrap">
                            <button
                              ref={roleAddBtnRef}
                              type="button"
                              className="role-chip profile-role-add"
                              title="Adicionar cargo"
                              onClick={() => setRoleMenuOpen((v) => !v)}
                            >+</button>
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
                    </div>
                  )
    ),
    member_since: (
<div className="profile-section">
                    <div className="profile-section-label">MEMBRO DESDE</div>
                    <div className="profile-section-body">{new Date(user.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                  </div>
    ),
    connections: (
(user.youtubeUrl || user.steamUrl || user.robloxUrl || user.xUrl) && (
                    <div className="profile-section">
                      <div className="profile-section-label">CONEXÕES</div>
                      <div className="profile-connections-row">
                        {user.youtubeUrl && (
                          <a className="profile-connection" href={user.youtubeUrl} target="_blank" rel="noreferrer" title="YouTube">
                            <span className="profile-connection-icon"><img className="ui-icon-sm" src={youtubeIcon} alt="" /></span> YouTube
                          </a>
                        )}
                        {user.steamUrl && (
                          <a className="profile-connection" href={user.steamUrl} target="_blank" rel="noreferrer" title="Steam">
                            <span className="profile-connection-icon"><img className="ui-icon-sm" src={steamIcon} alt="" /></span> Steam
                          </a>
                        )}
                        {user.robloxUrl && (
                          <a className="profile-connection" href={user.robloxUrl} target="_blank" rel="noreferrer" title="Roblox">
                            <span className="profile-connection-icon"><img className="ui-icon-sm" src={robloxIcon} alt="" /></span> Roblox
                          </a>
                        )}
                        {user.xUrl && (
                          <a className="profile-connection" href={user.xUrl} target="_blank" rel="noreferrer" title="X (Twitter)">
                            <span className="profile-connection-icon"><img className="ui-icon-sm" src={xIcon} alt="" /></span> X
                          </a>
                        )}
                      </div>
                    </div>
                  )
    ),
    mutual_friends: (
!isMe && data.mutualFriends?.length > 0 && (
                    <div className="profile-section">
                      <div className="profile-section-label">AMIGOS EM COMUM — {data.mutualFriends.length}</div>
                      <div className="profile-mutual-list">
                        {data.mutualFriends.map((f) => (
                          <div key={f.id} className="profile-mutual-item">
                            <div className="avatar tiny">
                              <UserAvatar user={f} size={24} />
                            </div>
                            <span className="truncate">{f.displayName}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
    ),
    relationship: (
<>
{!isMe && (
                    <div className="profile-section">
                      <div className="profile-section-label">RELACIONAMENTO</div>
                      {data.relationshipPartner ? (
                        <div className="profile-relationship-status">
                          💞 Namorando com <UserAvatar user={data.relationshipPartner} size={20} /> <b>{data.relationshipPartner.displayName}</b>
                        </div>
                      ) : (
                        <button className="btn-secondary" onClick={requestRelationship}>💌 Pedir em namoro</button>
                      )}
                    </div>
                  )}
{isMe && me.relationshipPartnerId && (
                    <div className="profile-section">
                      <div className="profile-section-label">RELACIONAMENTO</div>
                      <div className="profile-relationship-status">
                        💞 Em um relacionamento confirmado
                        <button className="profile-relationship-end" onClick={breakUpRelationship}>Terminar</button>
                      </div>
                    </div>
                  )}
</>
    ),
    traits: (
<>
                  {/* Item pedido: mais sistemas estilo Orkut — traços,
                      relacionamento, álbum de fotos, visitantes. */}
{!isMe && traitStatus && (
                    <div className="profile-section">
                      <div className="profile-section-label">O QUE ACHAM DE {user.displayName.split(' ')[0].toUpperCase()}</div>
                      <div className="profile-trait-row">
                        {[
                          { key: 'TRUSTWORTHY', label: 'Confiável' },
                          { key: 'COOL', label: 'Legal' },
                          { key: 'SEXY', label: 'Sexy' },
                        ].map(({ key, label }) => (
                          <button
                            key={key}
                            className={`profile-trait-chip ${traitStatus[key]?.voted ? 'active' : ''}`}
                            onClick={() => toggleTraitStatus(key)}
                          >
                            {label} <b>{traitStatus[key]?.count ?? 0}</b>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
</>
    ),
    scraps: (
<>
{/* Item pedido: "sistema igual tinha no Orkut" —
                      recados no mural e depoimentos (o antigo botão de
                      "sou fã" virou "Seguir", movido pra cima, perto de
                      Ups). */}

                  <div className="profile-section">
                    <div className="profile-section-label">RECADOS{scraps.length > 0 ? ` — ${scraps.length}` : ''}</div>
                    <div className="profile-scrap-composer">
                      <input
                        value={scrapDraft}
                        onChange={(e) => setScrapDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitScrap()}
                        placeholder={isMe ? 'Escreva no seu próprio mural...' : `Deixe um recado pra ${user.displayName}...`}
                        maxLength={300}
                      />
                      <button className="btn-secondary" disabled={!scrapDraft.trim() || scrapSending} onClick={submitScrap}>Enviar</button>
                    </div>
                    <div className="profile-scrap-list">
                      {scraps.length === 0 && <div className="dim profile-scrap-empty">Nenhum recado ainda — seja o primeiro a deixar um.</div>}
                      {scraps.slice(0, 3).map((s) => (
                        <div key={s.id} className="profile-scrap-item">
                          <UserAvatar user={s.author} size={28} />
                          <div className="profile-scrap-item-body">
                            <span className="profile-scrap-item-author">{s.author.displayName}</span>
                            <span className="profile-scrap-item-text">{s.text}</span>
                          </div>
                          {(s.authorId === me.id || isMe) && (
                            <button className="profile-scrap-item-remove" title="Apagar recado" onClick={() => removeScrap(s.id)}>✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Item pedido: mais de 3 recados -> "ver mais" abre
                        todos, paginados 100 por página. */}
                    {scrapTotal > 3 && (
                      <button className="profile-see-more-link" onClick={() => setScrapListOpen(true)}>Ver mais ({scrapTotal})</button>
                    )}
                  </div>
</>
    ),
    testimonials: (
<div className="profile-section">
                    <div className="profile-section-label">DEPOIMENTOS{testimonialTotal > 0 ? ` — ${testimonialTotal}` : ''}</div>
                    {!isMe && (
                      <div className="profile-testimonial-composer">
                        <textarea
                          value={testimonialDraft}
                          onChange={(e) => setTestimonialDraft(e.target.value)}
                          placeholder={`Escreva um depoimento pra ${user.displayName}... (fica visível só depois que a pessoa aprovar)`}
                          maxLength={1000}
                          rows={2}
                        />
                        <button className="btn-secondary" disabled={!testimonialDraft.trim() || testimonialSending} onClick={submitTestimonial}>Enviar depoimento</button>
                      </div>
                    )}
                    <div className="profile-testimonial-list">
                      {testimonials.length === 0 && <div className="dim profile-scrap-empty">Nenhum depoimento ainda.</div>}
                      {testimonials.slice(0, 3).map((t) => (
                        <div key={t.id} className="profile-testimonial-item">
                          <UserAvatar user={t.author} size={32} />
                          <div className="profile-testimonial-item-body">
                            <span className="profile-testimonial-item-author">{t.author.displayName}</span>
                            <span className="profile-testimonial-item-text">{t.text}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {testimonialTotal > 3 && (
                      <button className="profile-see-more-link" onClick={() => setTestimonialListOpen(true)}>Ver mais ({testimonialTotal})</button>
                    )}
                  </div>
    ),
    visitors: (
isMe && (
                    <div className="profile-section">
                      <div className="profile-section-label">QUEM VISITOU SEU PERFIL{visitorsData.totalVisits > 0 ? ` — ${visitorsData.totalVisits}` : ''}</div>
                      {visitorsData.visits.length === 0 && <div className="dim profile-scrap-empty">Ninguém visitou seu perfil ainda.</div>}
                      <div className="profile-mutual-list">
                        {visitorsData.visits.slice(0, 8).map((v) => (
                          <div key={v.id} className="profile-mutual-item">
                            <div className="avatar tiny"><UserAvatar user={v.visitor} size={24} /></div>
                            <span className="truncate">{v.visitor.displayName}</span>
                            {v.visitCount > 1 && <span className="dim"> ({v.visitCount}x)</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
    ),
  } : {};

  return (
    <div className="modal-overlay profile-fullscreen-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeProfile(); }}>
      <div
        className={`modal-box profile-modal-box profile-modal-fullscreen ${user ? 'profile-modal-accented' : ''}`}
        style={user ? profileAccentVars(user.profileColor) : undefined}
      >
        <button className="icon-btn profile-modal-close" onClick={closeProfile}><img className="ui-icon" src={cancelIcon} alt="x" /></button>
        {isMe && (
          <button className="icon-btn profile-modal-edit" onClick={() => useStore.getState().openSettings()} title="Editar perfil">
            <img className="ui-icon" src={settingsIcon} alt="" />
          </button>
        )}
        {loading && <div className="profile-modal-loading">Carregando...</div>}
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
                  <span className="status-dot large" style={{ background: STATUS_COLOR[status] }} title={STATUS_LABEL[status]} />
                </div>
                <div className="profile-ig-header-info">
                  <h2 className="profile-display-name"><span style={nameStyleProps(user)}>{user.displayName}</span> <TagBadge user={user} /></h2>
                  <div className="profile-username">@{user.username}{user.pronouns && <span className="profile-pronouns-inline"> · {user.pronouns}</span>}</div>
                  {(user.customStatus || user.customStatusEmoji) && (
                    <div className="profile-custom-status-balloon">
                      <ActivityIcon userId={user.id} /> {user.customStatusEmoji && <StatusEmoji emoji={user.customStatusEmoji} />} {user.customStatus}
                    </div>
                  )}
                  <ActivityBadge userId={user.id} />
                  <div className="profile-ig-stats">
                    <div className="profile-ig-stat">
                      <b>{liveUps}</b>
                      <span>Ups</span>
                    </div>
                    {/* Item pedido: "seguir" do lado de Ups, perto da
                        foto de perfil — o número fica junto dos outros
                        contadores; o botão de ação em si fica lá
                        embaixo, junto dos outros botões de ação
                        (Enviar mensagem/Adicionar amigo). */}
                    {!isMe && (
                      <div className="profile-ig-stat">
                        <b>{fanStatus.count}</b>
                        <span>{fanStatus.count === 1 ? 'Seguidor' : 'Seguidores'}</span>
                      </div>
                    )}
                    {data.badges?.length > 0 && (
                      <button type="button" className="profile-ig-stat" onClick={() => setBadgeListOpen(true)}>
                        <b>{data.badges.length}</b>
                        <span>Insígnias</span>
                      </button>
                    )}
                    {!isMe && data.mutualFriends?.length > 0 && (
                      <div className="profile-ig-stat">
                        <b>{data.mutualFriends.length}</b>
                        <span>Em comum</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="profile-modal-body">
              {/* Barra de nível redesenhada — mostra XP atual/necessário
                  e o número de porcentagem, não só uma barrinha muda. */}
              <div className="profile-level-bar-wrap">
                <div className="profile-level-bar-labels">
                  <span className="profile-level-bar-chip"><img className="ui-icon-sm" src={levelStarIcon} alt="" /> Nível {user.accountLevel ?? 1}</span>
                  <span className="dim">{data.levelProgress ?? 0}% para o próximo nível</span>
                </div>
                <div className="profile-level-progress-track">
                  <div className="profile-level-progress-fill" style={{ width: `${data.levelProgress ?? 0}%` }} />
                </div>
              </div>

              {!isMe && (
                <div className="profile-actions profile-ig-actions">
                  <button className="btn-primary" onClick={openDM}>Enviar mensagem</button>
                  <button className="btn-secondary" onClick={addFriend} disabled={friendSent}>
                    {friendSent ? 'Solicitado' : 'Adicionar amigo'}
                  </button>
                  <button className={`btn-secondary ${fanStatus.isFan ? 'active' : ''}`} onClick={toggleFanStatus}>
                    {fanStatus.isFan ? 'Seguindo' : 'Seguir'}
                  </button>
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
              )}


              {badgeListOpen && (
                <BadgeListModal userName={user.displayName} badges={data.badges} onClose={() => setBadgeListOpen(false)} />
              )}

              <div className="profile-color-divider" style={{ background: `linear-gradient(90deg, ${gradientStops(user.profileColor || '#F2894D')[0]}, ${gradientStops(user.profileColor || '#F2894D')[1] || gradientStops(user.profileColor || '#F2894D')[0]})` }} />


              <div className="profile-ig-fixed-top">
                  {data.badges?.length > 0 && (
                    <div className="profile-section">
                      <div className="profile-section-label">INSÍGNIAS</div>
                      <div className="profile-badges-grid">
                        {data.badges.map((b) => (
                          <div
                            key={b.id}
                            className="profile-badge-tile"
                            title={b.description || b.name}
                            onClick={() => setBadgeListOpen(true)}
                          >
                            <span className="profile-badge-tile-icon">
                              {badgeHasImage(b) ? <img className="profile-badge-img" src={proxyImage(b.iconUrl)} alt="" /> : b.icon}
                            </span>
                            <span className="profile-badge-tile-name truncate">{b.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isMe && (
                    <div className="profile-section">
                      <div className="profile-section-label">
                        <span>TAG DA COMUNIDADE</span>
                      </div>
                      <p className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
                        Exiba a tag da comunidade do lado do seu nome no chat, na lista de membros e no seu perfil.
                      </p>
                      <div className="server-tag-options">
                        <button
                          type="button"
                          className={`server-tag-option ${!me.tagEmoji ? 'active' : ''}`}
                          disabled={tagSaving}
                          onClick={() => pickTag(false)}
                        >
                          Nenhuma
                        </button>
                        <button
                          type="button"
                          className={`server-tag-option ${me.tagEmoji ? 'active' : ''}`}
                          disabled={tagSaving}
                          onClick={() => pickTag(true)}
                        >
                          <span className="server-tag-badge">🏠 Mostrar tag</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {isMe && (birthdays.today.length > 0 || birthdays.upcoming.length > 0) && (
                    <div className="profile-section">
                      <div className="profile-section-label">ANIVERSARIANTES</div>
                      {birthdays.today.length > 0 && (
                        <div className="profile-birthday-today">🎂 Hoje: {birthdays.today.map((f) => f.displayName).join(', ')}</div>
                      )}
                      {birthdays.upcoming.length > 0 && (
                        <div className="profile-mutual-list">
                          {birthdays.upcoming.map((f) => (
                            <div key={f.id} className="profile-mutual-item">
                              <div className="avatar tiny"><UserAvatar user={f} size={24} /></div>
                              <span className="truncate">{f.displayName}</span>
                              <span className="dim"> ({String(f.day).padStart(2, '0')}/{String(f.month).padStart(2, '0')})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

              </div>

              <div className="profile-ig-columns">
                {parseProfileSectionOrder(user.profileSectionOrder).map((key) => (
                  <div key={key} className="profile-section-order-wrap">{SECTION_ELEMENTS[key]}</div>
                ))}
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
          <div className="profile-modal-error">
            <div className="profile-modal-error-icon">⚠️</div>
            <div className="profile-modal-error-title">Não foi possível carregar este perfil</div>
            <div className="dim">Tente fechar e abrir de novo em alguns instantes.</div>
          </div>
        )}
      </div>
      {/* O modal de Configurações agora é renderizado uma única vez, globalmente, em MainApp.jsx — reage ao mesmo estado (settingsModalOpen) que o botão de engrenagem acima e o do cabeçalho abrem, então não precisa mais de uma instância própria aqui dentro. */}
    </div>
  );
}
