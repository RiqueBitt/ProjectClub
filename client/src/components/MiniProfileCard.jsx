import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { getUserProfile } from '../api/endpoints';
import { useLiveRefresh, sameData } from '../utils/liveRefresh';
import { roleChipStyle } from '../utils/roleColor';
import { profileAccentVars } from '../utils/profileAccent';
import { badgeHasImage } from '../utils/badgeRarity';
import { renderRichContent } from '../utils/richTextRender.jsx';
import UserAvatar from './UserAvatar.jsx';
import ActivityBadge from './ActivityBadge.jsx';
import TagBadge from './TagBadge.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import levelStarIcon from '../assets/icons/level-star.png';
import { proxyImage } from '../utils/imageProxy';
import PresenceDot from './PresenceDot.jsx';
import PendantIcon from './PendantIcon.jsx';
import { nameStyleProps, nameStyleClassName } from '../utils/nameStyle';
import BannerImage from './ProfileBanner.jsx';
import ProfileEffectOverlay from './ProfileEffectOverlay.jsx';
import { cssZoom } from '../utils/cssZoom';

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
  const [mutualFriends, setMutualFriends] = useState([]);
  const cardRef = useRef(null);
  // Posição só fica pronta depois de medir a altura real do card (abaixo),
  // então começa escondido pra não "piscar" no canto errado antes de flipar.
  const [pos, setPos] = useState(null);

  // Item pedido: "colocar animações simples e dinâmicas para ao abrir
  // e fechar mini perfis como no discord" — userId (da store) vira
  // null IMEDIATAMENTE quando fecha, mas o card ainda precisa ficar
  // montado mais um instante pra tocar a animação de saída antes de
  // sumir de vez. renderedUserId "atrasa" esse desmonte; closing
  // controla qual animação CSS toca (ver .mini-profile-closing).
  const [renderedUserId, setRenderedUserId] = useState(userId);
  const [closing, setClosing] = useState(false);
  // useLayoutEffect (não useEffect): a classe de fechar entra ANTES do
  // navegador pintar o frame em que o userId virou null — senão sobrava um
  // frame "aberto" sem âncora (ver BUG CORRIGIDO em reposition).
  useLayoutEffect(() => {
    if (userId) {
      setRenderedUserId(userId);
      setClosing(false);
      return undefined;
    }
    if (!renderedUserId) return undefined;
    setClosing(true);
    const t = setTimeout(() => setRenderedUserId(null), 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const member = members.find((m) => m.user.id === renderedUserId);
  // BUG CORRIGIDO ("troque o emoji pela foto de um amigo em comum
  // aleatório"): Math.random() direto no JSX recalcularia a CADA
  // re-render (o card re-renderiza por vários motivos — reposição,
  // tick do ActivityBadge — sem mutualFriends ter mudado de verdade),
  // fazendo a foto trocar sem motivo a cada segundo. useMemo escolhe
  // uma vez só, e só recalcula quando mutualFriends muda de verdade.
  const randomMutualFriend = useMemo(() => (
    mutualFriends.length > 0 ? mutualFriends[Math.floor(Math.random() * mutualFriends.length)] : null
  ), [mutualFriends]);
  const memberRoles = member ? roles.filter((r) => !r.isDefault && member.roleIds?.includes(r.id)) : [];
  const visibleRoles = memberRoles.slice(0, ROLES_PREVIEW_COUNT);

  useEffect(() => {
    // Item pedido: animação de fechar — não limpa mais os dados aqui
    // quando fecha (userId vira null); assim o card continua
    // mostrando o último perfil carregado enquanto toca a animação de
    // saída, em vez de piscar pra "Carregando..." bem na hora de
    // sumir. Só limpa (e refaz a busca) quando um usuário NOVO é
    // aberto de verdade.
    if (!userId) return;
    setUser(null); setBadges([]); setMutualFriends([]);
    getUserProfile(userId)
      .then((d) => {
        setUser(d.user); setBadges(d.badges || []); setMutualFriends(d.mutualFriends || []);
        // Item pedido: "ActivityBadge igual tem no perfil" — mesmo
        // ajuste que já existia em UserProfileModal.jsx: sem isso, o
        // badge fica vazio até chegar algum aviso ao vivo pelo socket,
        // mesmo com a atividade já existindo de verdade no servidor.
        if (d.activity) useStore.getState().setActivity(userId, d.activity);
      })
      .catch(() => { setUser(null); setBadges([]); setMutualFriends([]); });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const onDocDown = (e) => { if (!cardRef.current?.contains(e.target)) closeMiniProfile('outside'); };
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
  // BUG CORRIGIDO ("miniperfil muda de lugar ao fechar, dependendo de onde
  // clico"): closeMiniProfile limpa userId, anchorRect e side DE UMA VEZ na
  // store. O render seguinte ainda tinha o card montado (renderedUserId) e
  // closing=false (só virava true num useEffect, depois do layout) — o
  // useLayoutEffect abaixo via anchorRect/side mudarem, rodava reposition()
  // e, sem âncora, caía no fallback (meio da tela, lado padrão): o card
  // pulava pro centro e a animação de saída tocava lá, com o
  // transform-origin trocado. Agora a âncora/lado só são lidos enquanto o
  // miniperfil está aberto (userId != null) e reposition não roda depois
  // que ele começou a fechar — o card fecha exatamente onde estava.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const anchorRectRef = useRef(anchorRect);
  if (userId) anchorRectRef.current = anchorRect;
  const sideRef = useRef(side);
  if (userId) sideRef.current = side;

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
    // Item pedido: animação de fechar — enquanto fechando, NÃO
    // recalcula a posição (ela ficaria "grudada" no centro da tela por
    // causa do fallback do anchorRect, que já é limpo nesse momento —
    // ver closeMiniProfile na store). Mantém a última posição válida
    // parada, só a animação CSS (.mini-profile-closing) cuida do resto.
    if (!renderedUserId || closing || !userIdRef.current || !el) return;
    const { height: vh, width: vw, offsetTop: vTop, offsetLeft: vLeft } = getViewport();
    const rect = anchorRectRef.current || { top: vh / 2, left: vw / 2, bottom: vh / 2 };
    // BUG CORRIGIDO (miniperfil por cima da lista de membros): o
    // getBoundingClientRect do card pega o tamanho no MEIO da animação de
    // abrir (transform: scale) — menor que o real — e a posição final
    // ficava errada (sobrepondo o painel / passando da borda). offsetWidth/
    // offsetHeight ignoram transform; vezes o zoom = mesma escala da tela.
    const zoomNow = cssZoom();
    const cardWidth = (el.offsetWidth * zoomNow) || 320;
    // scrollHeight = altura do conteúdo inteiro, mesmo quando o card está
    // encolhido por um maxHeight anterior — com offsetHeight, encolher
    // fazia "caber" na medição seguinte, o card crescia de novo e ficava
    // alternando de posição (pulando) perto das bordas.
    const cardHeight = (Math.max(el.offsetHeight, el.scrollHeight) * zoomNow) || 220;
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
    // Trava final dentro da área visível (nunca acima do topo nem abaixo
    // do fim da tela, qualquer que seja o ramo escolhido acima).
    const shownHeight = maxHeight !== undefined ? Math.min(cardHeight, maxHeight) : cardHeight;
    top = Math.max(viewportTop, Math.min(top, viewportBottom - shownHeight));
    if (shownHeight > viewportBottom - viewportTop) { top = viewportTop; maxHeight = viewportBottom - viewportTop; }
    left = Math.max(vLeft + margin, left);
    // BUG CORRIGIDO ("miniperfil corta/sai da tela nas bordas"): todas as
    // medidas acima (getBoundingClientRect) vêm em pixels da TELA, mas
    // top/left/maxHeight de um elemento fixo são multiplicados pelo zoom
    // CSS da interface (1.2 no desktop) — o card ia parar 20% mais pra
    // direita/baixo e estourava a borda. Converte de volta pra pixels CSS.
    setPos({ top: top / zoomNow, left: left / zoomNow, maxHeight: maxHeight !== undefined ? maxHeight / zoomNow : undefined });
    // Item pedido: animação de abrir "como no Discord" — a origem do
    // scale/fade fica no canto mais perto de onde a pessoa clicou (se
    // abriu pra baixo do avatar, cresce a partir do topo; se virou pra
    // cima, cresce a partir de baixo), em vez de sempre crescer do
    // centro — fica com a sensação de "sair" do clique.
    el.style.setProperty('--mini-profile-transform-origin', `${sideRef.current === 'left' ? 'right' : 'left'} ${top === rect.bottom + margin ? 'top' : 'bottom'}`);
  };

  useLayoutEffect(() => {
    reposition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedUserId, closing, anchorRect, side, user, badges, member]);

  useEffect(() => {
    if (!renderedUserId || closing) return undefined;
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
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
  }, [renderedUserId, closing]);

  // Tempo real (30s; 60s com socket — atividade/presença já chegam por
  // evento): atualiza o miniperfil aberto sem fechar nem piscar.
  // Mantém a mesma referência quando nada mudou (o amigo em comum
  // sorteado não troca à toa).
  useLiveRefresh(async (ctx) => {
    const d = await getUserProfile(userId);
    if (!ctx.ok() || !d?.user) return;
    const keep = (setter, v) => setter((prev) => (sameData(prev, v) ? prev : v));
    keep(setUser, d.user); keep(setBadges, d.badges || []); keep(setMutualFriends, d.mutualFriends || []);
    if (d.activity) useStore.getState().setActivity(userId, d.activity);
  }, { enabled: !!userId, key: userId, interval: 30000, realtimeInterval: 60000 });

  if (!renderedUserId) return null;

  return (
    <div
      ref={cardRef}
      className={`mini-profile-card ${user ? 'mini-profile-accented' : ''} ${closing ? 'mini-profile-closing' : ''}`}
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
      {user?.profileEffect && <ProfileEffectOverlay effect={user.profileEffect} variant="mini" />}
      {user && (
        <>
          {/* Item pedido: "quando o user tiver colocado um banner no
              perfil e não tiver colocado um banner do mini perfil, o
              banner do perfil vai aparecer também no mini perfil até
              o user mudar" — miniProfileBannerUrl primeiro, cai pro
              bannerUrl do perfil completo, só cai na cor sólida se
              nenhum dos dois estiver definido. */}
          {/* Cada banner com o próprio enquadramento (editor de banner). */}
          <div className="mini-profile-banner" style={{ background: (user.miniProfileBannerUrl || user.bannerUrl) ? 'var(--profile-accent-start, var(--brand))' : 'var(--brand)' }}>
            <BannerImage
              url={user.miniProfileBannerUrl || user.bannerUrl}
              framing={user.miniProfileBannerUrl ? user.miniProfileBannerFraming : user.bannerFraming}
            />
          </div>
          <div className="mini-profile-body">
            <div className="mini-profile-avatar-row">
              <div className="mini-profile-avatar-wrap">
                {/* Item pedido: "aumentar o tamanho geral do mini
                    perfil... colocar a foto do perfil um pouco mais
                    acima estilo discord pegando a foto na metade do
                    banner" — 64 → 84 (ver mini-profile-improvements.css
                    pro tamanho do wrap/recuo pra cima em si). */}
                <div className="mini-profile-avatar"><UserAvatar user={user} size={84} /></div>
                {/* (Removido) A cor personalizada da bolha de status não é
                    mais aplicada: a bolinha mostra só a cor real da
                    presença e a borda acompanha o fundo do card, como
                    padrão. statusBubbleColor continua no banco, mas não é
                    mais consumido aqui. */}
                <PresenceDot
                  status={presence[renderedUserId]?.status || user.status || 'OFFLINE'}
                  userId={renderedUserId}
                  className="mini-profile-presence-dot"
                />
              </div>
              {/* BUG CORRIGIDO ("o status fica do lado da foto de
                  perfil, não no banner") — movido pra cá, ao lado do
                  avatar, em vez de flutuando sobre o banner. */}
              {user.customStatus && (
                <span className="mini-profile-status-bubble">{user.customStatusEmoji ? `${user.customStatusEmoji} ` : ''}{user.customStatus}</span>
              )}
            </div>
            <div className="mini-profile-name"><span className={nameStyleClassName(user, { fullEffect: true })} style={nameStyleProps(user, { fullEffect: true })}>{user.displayName}</span> <PendantIcon user={user} /> <TagBadge user={user} /> <ClanTagBadge user={user} /></div>
            <div className="dim mini-profile-handle">
              @{user.username}
              {user.pronouns && <span> • {user.pronouns}</span>}
              {/* Item pedido: "colocar a barra de nível do mini perfil
                  do lado do pronome" — antes ficava numa linha própria
                  embaixo (era "depois dos pronomes", mas ainda assim
                  quebrando linha); agora entra na MESMA linha, logo ao
                  lado. */}
              <span className="mini-profile-level-badge">
                <img className="ui-icon-sm" src={levelStarIcon} alt="" /> Nível {user.accountLevel ?? 1}
              </span>
            </div>
            {/* Item pedido: a atividade aparecia DUAS vezes (linha curta
                "Ouvindo X" + caixa grande). Fica só a caixa grande
                (ActivityBadge, com capa/ícone e progresso), mais abaixo. */}

            {(badges.length > 0) && (
              <div className="mini-profile-badges-row">
                {badges.map((b) => (
                  <span key={b.id} className="mini-profile-badge" title={`${b.name}${b.description ? ' — ' + b.description : ''}`}>
                    {badgeHasImage(b) ? <img className="mini-profile-badge-img" src={proxyImage(b.iconUrl)} alt="" /> : b.icon}
                  </span>
                ))}
              </div>
            )}

            {/* Item pedido: "remover conquistas em destaque do mini
                perfil, deixar somente no perfil completo" — removido
                daqui (ver UserProfileModal.jsx, que continua mostrando). */}

            {/* Seções em blocos com rótulo (Sobre mim / Cargos / Atividade),
                estilo popout do Discord. */}
            {user.bio && (
              <div className="mini-profile-section">
                <div className="mini-profile-section-label">Sobre mim</div>
                <div className="mini-profile-bio">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
              </div>
            )}

            {visibleRoles.length > 0 && (
              <div className="mini-profile-section">
                <div className="mini-profile-section-label">Cargos</div>
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
              </div>
            )}

            {/* BUG CORRIGIDO ("Ver biografia completa fica embaixo da
                atividade em vez de embaixo da biografia") — o
                ActivityBadge continua DEPOIS da bio. */}
            <ActivityBadge userId={renderedUserId} />

            {mutualFriends.length > 0 && (
              <div className="mini-profile-mutual-row dim">
                {/* BUG CORRIGIDO ("troque o emoji pela foto de um
                    amigo em comum aleatório") — antes usava 🤝 fixo. */}
                <UserAvatar user={randomMutualFriend} size={16} className="mini-profile-mutual-avatar" />
                {' '}{mutualFriends.length} amigo{mutualFriends.length > 1 ? 's' : ''} em comum
              </div>
            )}

            {/* BUG CORRIGIDO ("remova o texto 'há mais de 1 ano na
                comunidade'") — removido. */}

            <button
              className="btn-primary"
              style={{
                width: '100%', marginTop: 12,
                // Item pedido: "mudando a cor do botão ver perfil
                // completo" — só sobrescreve quando a pessoa
                // personalizou; senão fica com a cor de marca padrão
                // do app, igual já era antes. Item pedido: "essa
                // sombra do botão sempre ser igual a cor do botão,
                // porém um pouco mais escura" — --btn-shadow-color
                // acompanha, pra sombra nunca ficar destoando (ver
                // .btn-primary em global.css).
                ...(user.miniProfileButtonColor ? { background: user.miniProfileButtonColor, '--btn-shadow-color': user.miniProfileButtonColor } : {}),
              }}
              onClick={() => { openProfile(renderedUserId); closeMiniProfile(); }}
            >
              Ver perfil completo
            </button>
          </div>
        </>
      )}
    </div>
  );
}
