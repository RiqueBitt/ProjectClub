import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { getUserProfile } from '../api/endpoints';
import { roleChipStyle } from '../utils/roleColor';
import { profileAccentVars } from '../utils/profileAccent';
import { badgeHasImage } from '../utils/badgeRarity';
import { renderRichContent } from '../utils/richTextRender.jsx';
import UserAvatar from './UserAvatar.jsx';
import TagBadge from './TagBadge.jsx';
import levelStarIcon from '../assets/icons/level-star.png';
import achievementDefaultIcon from '../assets/icons/nav-achievements.png';
import { proxyImage } from '../utils/imageProxy';
import { nameStyleProps, nameStyleClassName } from '../utils/nameStyle';

// Quantos cargos mostrar no popup compacto (a bio é limitada por CSS a 3
// linhas — .mini-profile-bio) — o perfil completo (UserProfileModal) mostra
// tudo, aqui é só uma prévia.
const ROLES_PREVIEW_COUNT = 2;

export default function MiniProfileCard() {
  const userId = useStore((s) => s.miniProfileUserId);
  const anchorRect = useStore((s) => s.miniProfileAnchorRect);
  const side = useStore((s) => s.miniProfileSide);
  const closeMiniProfile = useStore((s) => s.closeMiniProfile);
  const openProfile = useStore((s) => s.openProfile);
  const roles = useStore((s) => s.roles);
  const members = useStore((s) => s.members);
  const usableEmojis = useStore((s) => s.usableEmojis);
  // Item pedido: "faça o mini perfil parecido com a imagem" — bolinha
  // de presença no avatar (nenhum componente do app tinha isso ainda,
  // nem a lista de membros — que só usa cor de texto/agrupamento pro
  // status, sem indicador visual no próprio avatar).
  const presence = useStore((s) => s.presence);
  // Bio não é escopada a nenhum servidor específico (igual no perfil
  // completo), então usa só o set de emojis próprios do usuário — sem
  // @menções aqui, não tem lista de canal/membros pra mencionar contra.
  const bioEmojiMap = Object.fromEntries(usableEmojis.map((e) => [e.name, e.url]));
  const [user, setUser] = useState(null);
  const [badges, setBadges] = useState([]);
  const [miniAchievements, setMiniAchievements] = useState([]);
  const [mutualFriends, setMutualFriends] = useState([]);
  const cardRef = useRef(null);
  // Posição só fica pronta depois de medir a altura real do card (abaixo),
  // então começa escondido pra não "piscar" no canto errado antes de flipar.
  const [pos, setPos] = useState(null);

  const member = members.find((m) => m.user.id === userId);
  const memberRoles = member ? roles.filter((r) => !r.isDefault && member.roleIds?.includes(r.id)) : [];
  const visibleRoles = memberRoles.slice(0, ROLES_PREVIEW_COUNT);

  useEffect(() => {
    if (!userId) { setUser(null); setBadges([]); setMiniAchievements([]); setMutualFriends([]); return; }
    getUserProfile(userId)
      .then((d) => { setUser(d.user); setBadges(d.badges || []); setMiniAchievements(d.displayedAchievementsMini || []); setMutualFriends(d.mutualFriends || []); })
      .catch(() => { setUser(null); setBadges([]); setMiniAchievements([]); setMutualFriends([]); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const onDocDown = (e) => { if (!cardRef.current?.contains(e.target)) closeMiniProfile(); };
    const onKey = (e) => { if (e.key === 'Escape') closeMiniProfile(); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [userId, closeMiniProfile]);

  // Mede a altura real do card (varia com bio/cargos/badges) e reposiciona:
  // por padrão abre pra baixo do avatar, mas se não couber até o fim da
  // tela, flipa pra cima do anchor — nunca deixando o card estourar a
  // viewport nem embaixo nem em cima. Usa um ResizeObserver (não só o
  // useLayoutEffect abaixo) porque o card pode crescer depois da 1ª medição
  // — ex: uma imagem de insígnia ou emoji da bio que termina de carregar
  // um instante depois de badges/user já terem chegado.
  const anchorRectRef = useRef(anchorRect);
  anchorRectRef.current = anchorRect;
  const sideRef = useRef(side);
  sideRef.current = side;

  // Bug: perto do fim da lista de mensagens (penúltima/antepenúltima), o
  // avatar costuma estar sendo tocado com o teclado aberto (usuário estava
  // digitando). `window.innerHeight` NÃO desconta o teclado — ele reporta a
  // altura da tela toda, então o cálculo de "cabe embaixo?" achava que
  // sobrava espaço e não flipava o card pra cima, e o teclado cobria/cortava
  // a parte de baixo do card. `visualViewport` reflete a área realmente
  // visível (já descontando teclado), então é isso que deve mandar aqui —
  // com fallback pra innerHeight/innerWidth em navegadores sem suporte.
  const getViewport = () => {
    // Correção definitiva pro bug de zoom (achei que só afetava a
    // largura, mas afeta a ALTURA também, do mesmo jeito — por isso o
    // chat voltou a vazar por baixo). Em vez de misturar APIs diferentes
    // do navegador (algumas ficam na escala com zoom, outras não,
    // dependendo do navegador), mede a altura E a largura usando O MESMO
    // método (getBoundingClientRect no container do app) que já é usado
    // pro item clicado — duas medidas pelo mesmo método SEMPRE ficam na
    // mesma escala. .app-shell usa height:100dvh (unidade que já
    // desconta o teclado do celular sozinha), então isso continua
    // reagindo certo ao teclado abrir/fechar sem precisar do
    // visualViewport pra essa parte.
    const shellRect = document.querySelector('.app-shell')?.getBoundingClientRect();
    const vv = window.visualViewport;
    return {
      height: shellRect?.height ?? vv?.height ?? window.innerHeight,
      width: shellRect?.width ?? vv?.width ?? window.innerWidth,
      offsetTop: shellRect?.top ?? vv?.offsetTop ?? 0,
      offsetLeft: shellRect?.left ?? vv?.offsetLeft ?? 0,
    };
  };

  const reposition = () => {
    const el = cardRef.current;
    if (!userId || !el) { setPos(null); return; }
    const { height: vh, width: vw, offsetTop: vTop, offsetLeft: vLeft } = getViewport();
    const rect = anchorRectRef.current || { top: vh / 2, left: vw / 2, bottom: vh / 2 };
    // offsetWidth/offsetHeight ficam em outra escala que
    // getBoundingClientRect() sob CSS zoom em alguns navegadores (mesmo
    // tipo de inconsistência já corrigida pro container/anchor abaixo) —
    // troca pra medir o card com o MESMO método getBoundingClientRect,
    // consistente com rect/shellRect em toda a função.
    const elRect = el.getBoundingClientRect();
    const cardWidth = elRect.width || 280;
    const cardHeight = elRect.height || 220;
    const margin = 8;
    // Limites da área visível em coordenadas de `position: fixed` (que é
    // relativo ao layout viewport, não ao visual viewport — por isso soma
    // o offsetTop/offsetLeft do visualViewport quando o teclado empurra a
    // área visível pra baixo/lado).
    const viewportBottom = vTop + vh - margin;
    const viewportTop = vTop + margin;

    // Vertical: SEMPRE adaptativo, não importa se é mensagem do chat ou
    // item da lista de online — abre pra BAIXO do que foi clicado por
    // padrão (mais natural), só vira pra CIMA quando não sobra espaço
    // suficiente embaixo. Nunca sobrepõe o próprio item clicado.
    const availableBelow = viewportBottom - rect.bottom - margin;
    const availableAbove = rect.top - margin - viewportTop;
    // Margem de segurança extra só pro caso "abre pra baixo" — na
    // prática ainda vazava por baixo às vezes (provavelmente o card
    // cresce um pouco depois da 1ª medição, ex.: insígnia/emoji
    // terminando de carregar, e o ResizeObserver reage um instante
    // depois). Exigir uma folga a mais aqui faz ele preferir virar pra
    // cima um pouco mais cedo, em vez de abrir embaixo bem no limite.
    const belowSafetyBuffer = 24;

    let top;
    let maxHeight; // só definido quando precisa encolher o card pra não estourar
    if (cardHeight + belowSafetyBuffer <= availableBelow) {
      top = rect.bottom + margin;
    } else if (cardHeight <= availableAbove) {
      top = rect.top - margin - cardHeight;
    } else if (availableAbove > availableBelow) {
      // Não cabe inteiro em nenhum dos dois lados — abre pro lado com
      // mais espaço e encolhe (rola por dentro) em vez de cortar.
      top = viewportTop;
      maxHeight = Math.max(availableAbove, 80);
    } else {
      top = rect.bottom + margin;
      maxHeight = Math.max(availableBelow, 80);
    }

    let left;
    if (sideRef.current === 'left') {
      // Lista de online/lateral: SEMPRE abre pro lado dos canais/chat
      // (esquerda), nunca em cima da própria barra que lista os
      // usuários. Em vez de calcular a partir do item individual
      // clicado, mede o painel INTEIRO da lista de online
      // (.members-list) e ancora pela borda esquerda DELE — mais
      // confiável, porque não depende de nenhuma particularidade de
      // medida do item de dentro da lista, só da borda do painel em si.
      const membersPanel = document.querySelector('.members-list');
      const panelRect = membersPanel?.getBoundingClientRect();
      const anchorLeft = panelRect ? panelRect.left : rect.left;
      left = Math.max(vLeft + margin, anchorLeft - margin - cardWidth);
    } else {
      left = rect.left;
    }
    left = Math.min(Math.max(vLeft + margin, left), vLeft + vw - cardWidth - margin);
    setPos({ top, left, maxHeight });
  };

  useLayoutEffect(() => {
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, anchorRect, side, user, badges, member]);

  useEffect(() => {
    if (!userId) return;
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => reposition());
    ro.observe(el);
    window.addEventListener('resize', reposition);
    // Teclado abrindo/fechando ou a página rolando por baixo dele dispara
    // resize/scroll no visualViewport, não no window — sem isso o card não
    // reajusta quando o teclado aparece/some com ele já aberto.
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) return null;

  return (
    <div
      ref={cardRef}
      className={`mini-profile-card ${user ? 'mini-profile-accented' : ''}`}
      style={{
        position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        ...(pos?.maxHeight ? { maxHeight: pos.maxHeight } : {}),
        // Mesmo degradê de cima a baixo da cor de perfil usado no perfil
        // completo (ver .profile-modal-box.profile-modal-accented), incluindo
        // a cor de texto legível calculada (--profile-accent-text) — só
        // aplicado quando o usuário já carregou, pra não piscar com a cor
        // default enquanto ainda tá buscando os dados.
        // Item pedido: "cor do mini perfil separada do perfil grande"
        // — miniProfileColor sobrescreve profileColor só aqui, quando
        // definida; senão cai no comportamento de antes (mesma cor do
        // perfil grande).
        ...(user ? profileAccentVars(user.miniProfileColor || user.profileColor) : {}),
      }}
    >
      {!user && <p className="dim" style={{ padding: 16 }}>Carregando...</p>}
      {user && (
        <>
          <div className="mini-profile-banner" style={{ background: user.miniProfileBannerUrl ? `url(${user.miniProfileBannerUrl}) center/cover` : 'var(--brand)' }} />
          <div className="mini-profile-body">
            <div className="mini-profile-avatar-row">
              <div className="mini-profile-avatar-wrap">
                <div className="mini-profile-avatar"><UserAvatar user={user} size={64} /></div>
                <span className={`mini-profile-presence-dot ${(presence[userId]?.status || user.status) === 'ONLINE' ? 'online' : ''}`} />
              </div>
              {/* BUG CORRIGIDO ("o status fica do lado da foto de
                  perfil, não no banner") — movido pra cá, ao lado do
                  avatar, em vez de flutuando sobre o banner. */}
              {user.customStatus && (
                <span className="mini-profile-status-bubble">{user.customStatusEmoji ? `${user.customStatusEmoji} ` : ''}{user.customStatus}</span>
              )}
            </div>
            <div className="mini-profile-name"><span className={nameStyleClassName(user)} style={nameStyleProps(user)}>{user.displayName}</span> <TagBadge user={user} /></div>
            <div className="dim mini-profile-handle">
              @{user.username}
              {user.pronouns && <span> • {user.pronouns}</span>}
            </div>

            {(badges.length > 0) && (
              <div className="mini-profile-badges-row">
                {badges.map((b) => (
                  <span key={b.id} className="mini-profile-badge" title={`${b.name}${b.description ? ' — ' + b.description : ''}`}>
                    {badgeHasImage(b) ? <img className="mini-profile-badge-img" src={proxyImage(b.iconUrl)} alt="" /> : b.icon}
                  </span>
                ))}
              </div>
            )}

            {miniAchievements.length > 0 && (
              <div className="mini-profile-badges-row">
                {miniAchievements.map((a) => (
                  <span key={a.id} className="mini-profile-badge" title={`${a.name} — ${a.description}`}>
                    <img className="mini-profile-badge-img" src={proxyImage(a.iconUrl) || achievementDefaultIcon} alt="" />
                  </span>
                ))}
              </div>
            )}

            <div className="mini-profile-stats">
              <span className="economy-balance-chip"><img className="ui-icon-sm" src={levelStarIcon} alt="" /> Nível {user.accountLevel ?? 1}</span>
              <span className="dim" style={{ fontSize: 12 }}>{(user.accountXp ?? 0).toLocaleString('pt-BR')} XP</span>
            </div>

            {visibleRoles.length > 0 && (
              <div className="mini-profile-roles-row">
                {visibleRoles.map((r) => (
                  <span key={r.id} className="role-chip" style={roleChipStyle(r.color)}>
                    {r.icon ? `${r.icon} ` : ''}{r.name}
                  </span>
                ))}
                {memberRoles.length > visibleRoles.length && (
                  <span className="role-chip mini-profile-roles-more">+{memberRoles.length - visibleRoles.length}</span>
                )}
              </div>
            )}

            {mutualFriends.length > 0 && (
              <div className="mini-profile-mutual-row dim">
                🤝 {mutualFriends.length} amigo{mutualFriends.length > 1 ? 's' : ''} em comum
              </div>
            )}

            {/* BUG CORRIGIDO ("não é pra mostrar link de conexões,
                só bio/amigos mútuos etc") — removido o link em
                destaque que eu tinha adicionado. */}

            <div className="mini-profile-member-since dim">
              há {Math.max(1, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000)))} anos na comunidade
            </div>

            {user.bio && <div className="mini-profile-bio">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>}
            {user.bio && (
              <button type="button" className="btn-link mini-profile-full-bio-link" onClick={() => { openProfile(userId); closeMiniProfile(); }}>
                Ver biografia completa
              </button>
            )}
            <button
              className="btn-primary"
              style={{
                width: '100%', marginTop: 8,
                // Item pedido: "mudando a cor do botão ver perfil
                // completo" — só sobrescreve quando a pessoa
                // personalizou; senão fica com a cor de marca padrão
                // do app, igual já era antes.
                ...(user.miniProfileButtonColor ? { background: user.miniProfileButtonColor } : {}),
              }}
              onClick={() => { openProfile(userId); closeMiniProfile(); }}
            >
              Ver perfil completo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
