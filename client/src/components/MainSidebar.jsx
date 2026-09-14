import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, isChannelUnread, isConversationUnread, useMyRoleIds } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import topicIcon from '../assets/icons/nav-topic.png';
import feedIcon from '../assets/icons/nav-feed.png';
import friendsIcon from '../assets/icons/nav-profile.png';
import ranksIcon from '../assets/icons/nav-ranks.png';
import supportIcon from '../assets/icons/nav-support.png';
import dashboardIcon from '../assets/icons/nav-dashboard.png';
// Item pedido: "troque a logo... mantenha a cor dos ícones consistente
// com o resto da interface" — mesmo padrão isImg:true dos outros
// (mask-image via CSS, a cor de verdade vem de lá, não do PNG).
import appsIcon from '../assets/icons/nav-apps.png';
import achievementsIcon from '../assets/icons/nav-achievements.png'; // eslint-disable-line no-unused-vars -- mantido: pode ser reaproveitado se algum dia a categoria Progresso ganhar submenu na própria sidebar
import inicioIcon from '../assets/icons/nav-updates.png';
import { proxyImage } from '../utils/imageProxy';

// Barra lateral principal única do app. A marca/logo agora mora na
// TopSearchBar.jsx (barra de topo estilo Reddit) — esta barra só tem a
// navegação + a lista de comunidades (igual .homesidebar do clone do
// Reddit: nav de cima, depois "COMUNIDADES" com as que você participa),
// e o perfil fixo no rodapé. Ícones novos (pasta Icons_Novos.zip do
// usuário) substituem os emojis antigos — "nav-profile.png" (o ícone
// "User Account" do pacote) vai em Amigos, não em Perfil; Perfil fica
// com o emoji padrão já que não veio um ícone específico pra ele.
const ITEMS = [
  // Item pedido: "crie uma nova categoria chamada Início, primeira
  // categoria da lista, funcionando como página principal de
  // novidades e destaques" — substitui "Atualizações" (removida
  // completamente da navegação), que agora é só uma PARTE do
  // conteúdo consolidado dentro de Início (ver InicioPage.jsx).
  // Rota própria (/inicio), sem mexer na raiz "/" — ela já é usada em
  // vários lugares do app (redirecionamento pós-login, etc) apontando
  // pro Chat/Comunidade, mudar isso seria um risco desnecessário só
  // pra Início ser "tecnicamente" a rota raiz; sendo o primeiro item
  // da lista já atende ao pedido.
  { to: '/inicio', icon: inicioIcon, isImg: true, labelKey: 'nav.inicio', match: (p) => p === '/inicio' },
  { to: '/', icon: topicIcon, isImg: true, labelKey: 'nav.comunidade', match: (p) => p === '/' || p.startsWith('/channels/') },
  // Item pedido: "mude o feed para cima e o amigos para baixo" — ordem
  // invertida (Feeds vem antes de Amigos agora).
  { to: '/comunidades', icon: feedIcon, isImg: true, labelKey: 'nav.feeds', match: (p) => p === '/comunidades' || p.startsWith('/posts/') },
  { to: '/dms', icon: friendsIcon, isImg: true, labelKey: 'nav.amigos', match: (p) => p === '/dms' || p.startsWith('/conversations/') || p.startsWith('/clans') },
  // Item pedido originalmente: "crie uma nova categoria chamada Jogos,
  // posicionada logo abaixo da categoria Amigos" — item único levando
  // pra /jogos (ver JogosPage.jsx), mesmo padrão que o resto desta
  // barra já usa. ATUALIZADO: as abas internas "Jogos"/"Aplicativos"
  // que existiam DENTRO dessa página foram removidas a pedido ("remova
  // as categorias Jogos, Aplicativos e deixe todos os apps em um só
  // menu") — a "Aplicativos" nunca listava nada de verdade, virou uma
  // aba morta. Agora é uma grade única com tudo do catálogo.
  { to: '/jogos', icon: appsIcon, isImg: true, labelKey: 'nav.jogos', match: (p) => p.startsWith('/jogos') },
  // Item pedido: "remover a aba Notificações do menu lateral esquerdo
  // e deixar as notificações disponíveis somente pelo ícone de sino
  // localizado na parte superior da interface" — o sino já existe e
  // já leva pra essa mesma rota (ver TopSearchBar.jsx), então o
  // acesso continua funcionando normalmente, só sem essa entrada
  // duplicada aqui na barra lateral.
  // Item pedido: "Ranks e Conquistas ficam dentro da mesma categoria
  // (Progresso)" — antes eram duas entradas separadas na sidebar; uma
  // só agora, levando pra ProgressPage.jsx (que tem as duas dentro,
  // como abas, mais a nova aba de Recompensas).
  { to: '/progresso', icon: ranksIcon, isImg: true, labelKey: 'nav.progresso', match: (p) => p.startsWith('/progresso') || p.startsWith('/rank') || p.startsWith('/conquistas') },
  { to: '/tickets', icon: supportIcon, isImg: true, labelKey: 'nav.suporte', match: (p) => p.startsWith('/tickets') },
  // Item pedido: "renomear o sistema atual de Clãs para Clubes...
  // remover completamente a categoria Clãs da interface" — item
  // próprio na barra removido; o sistema (renomeado pra "Clube")
  // agora vive como uma aba dentro de Social (/dms), junto com
  // Amigos/Mensagens — ver AmigosPage.jsx.
];
// BUG CORRIGIDO: o painel de staff (/admin) ficou órfão depois da troca
// pra essa barra lateral única — os componentes antigos que linkavam pra
// lá (ChannelSidebar.jsx, TopMenu.jsx) não são mais renderizados em
// lugar nenhum, então quem é staff não tinha mais nenhum jeito de chegar
// no painel a não ser digitando a URL /admin na mão. Item separado (não
// dentro de ITEMS) porque só aparece pra ADMIN/MODERATOR — ver o filtro
// no componente abaixo.
const STAFF_ITEM = { to: '/admin', icon: dashboardIcon, isImg: true, labelKey: 'nav.painel', match: (p) => p.startsWith('/admin') };


export default function MainSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const myRoleIds = useMyRoleIds(user.id);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversations = useStore((s) => s.conversations);
  const friends = useStore((s) => s.friends);
  // Item pedido: "deixa a pessoa abrir e fechar o menu de categorias...
  // e todas as categorias, não só em comunidade" — toggle manual pra
  // qualquer seção do app (ver useStore.js).
  const mainSidebarCollapsed = useStore((s) => s.mainSidebarCollapsed);
  const toggleMainSidebar = useStore((s) => s.toggleMainSidebar);

  // BUG CORRIGIDO ("tô com o mouse em cima e não aparece nada"): o
  // tooltip (position: absolute, saindo pra direita do item) ficava
  // dentro de .main-sidebar-scroll — que tem overflow-x: hidden pra
  // não deixar a lista rolar de lado à toa — então qualquer coisa que
  // "vazasse" pra fora dele na horizontal, incluindo o tooltip inteiro,
  // ficava cortada/invisível, mesmo com opacity:1 (o navegador nunca
  // desenhava aquele pedaço). Reescrito pra usar um portal (mesma
  // técnica que outros popovers do app, tipo CustomStatusModal.jsx, já
  // usam): calcula a posição de verdade do ícone na tela
  // (getBoundingClientRect) e desenha o tooltip direto no <body>, fora
  // de qualquer container com overflow escondido — assim nunca mais
  // corre o risco de ser cortado por nenhum ancestral, agora ou no
  // futuro. getComputedStyle no momento do hover, em vez de duplicar a
  // condição "a barra está minimizada" aqui em JS, garante que o
  // tooltip só aparece exatamente quando o CSS de verdade já escondeu
  // o nome do item — nunca dessincronizado um do outro.
  const [tooltip, setTooltip] = useState(null); // { label, top, left } | null
  const showTooltip = (e, label) => {
    const labelEl = e.currentTarget.querySelector('.main-sidebar-item-label');
    if (!labelEl || getComputedStyle(labelEl).display !== 'none') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 12 });
  };
  const hideTooltip = () => setTooltip(null);
  // Rede de segurança extra: qualquer troca de página (não só clique
  // num item desta sidebar — também vale pra navegação disparada por
  // outro lugar do app) fecha um tooltip que porventura tenha ficado
  // preso, mesmo que o onClick acima não tenha disparado por algum
  // motivo.
  useEffect(() => { hideTooltip(); }, [location.pathname]);
  // BUG CORRIGIDO ("a barra [tooltip] fica em cima do conteúdo do
  // Início e do Feeds, cortando a barra de abas"): no toque, o
  // onTouchStart mostrava o tooltip, mas quem escondia ele de novo era
  // só o onTouchEnd — só que o toque também navega (troca de página),
  // e às vezes o React já trocou/re-renderizou esse link antes do
  // touchend disparar nele, deixando o tooltip preso visível por cima
  // da página nova. Agora o próprio clique/navegação (onClick, que já
  // fecha a gaveta da sidebar) também esconde o tooltip — não depende
  // mais só do touchend acontecer a tempo.

  // Lista de Temas — igual a seção "COMUNIDADES" da HomeSideBar do
  // clone do Reddit (subredditList: cada uma com ícone + nome), só que
  // agora vem do estado global (useStore) em vez de um fetch próprio —
  // é a mesma lista que a página de Feeds usa, e as duas atualizam
  // sozinhas em tempo real via socket quando a staff cria/edita/exclui
  // um Tema (ver SocketContext.jsx). Temas não têm mais conceito de
  // "entrar" — são categorias oficiais, mostradas pra todo mundo.
  const clubs = useStore((s) => s.clubs);
  const sortedClubs = [...clubs].sort((a, b) => a.name.localeCompare(b.name));

  // Badges simples por item — não são um sistema de notificações à parte,
  // só reaproveitam o que o store já sabe (menções não lidas / conversas
  // não lidas / pedidos de amizade pendentes) pra dar um sinal visual
  // rápido em cada ícone, igual o sininho de "Notificações" já mostra
  // em detalhe.
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const unreadChannels = allChannels.filter((ch) => isChannelUnread(ch, channelReadAt, user.id, myRoleIds)).length;
  const unreadConversations = conversations.filter((c) => isConversationUnread(c, user.id)).length;
  const pendingIncoming = friends.filter((f) => f.status === 'PENDING' && f.isIncoming).length;

  const badgeFor = (to) => {
    if (to === '/') return unreadChannels;
    if (to === '/dms') return unreadConversations + pendingIncoming;
    if (to === '/notifications') return unreadChannels + unreadConversations + pendingIncoming;
    return 0;
  };

  const isStaff = user?.platformRole === 'ADMIN' || user?.platformRole === 'MODERATOR';
  const navItems = isStaff ? [...ITEMS, STAFF_ITEM] : ITEMS;

  return (
    <aside className={`main-sidebar ${mainSidebarCollapsed ? 'main-sidebar-manually-collapsed' : ''}`}>
      <button
        type="button"
        className="main-sidebar-toggle"
        title={mainSidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
        onClick={toggleMainSidebar}
      >
        {mainSidebarCollapsed ? '›' : '‹'}
      </button>
      <div className="main-sidebar-scroll">
        <nav className="main-sidebar-nav">
          {navItems.map((item) => {
            const active = item.match(location.pathname);
            const badge = badgeFor(item.to);
            const label = t(item.labelKey);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`main-sidebar-item ${active ? 'active' : ''}`}
                onClick={() => { useStore.getState().closeMobileSidebar(); hideTooltip(); }}
                onMouseEnter={(e) => showTooltip(e, label)}
                onMouseLeave={hideTooltip}
                onTouchStart={(e) => showTooltip(e, label)}
                onTouchEnd={hideTooltip}
              >
                <span className="main-sidebar-item-icon">
                  {item.isImg
                    ? <span className="main-sidebar-item-icon-img" style={{ WebkitMaskImage: `url(${item.icon})`, maskImage: `url(${item.icon})` }} />
                    : item.icon}
                  {badge > 0 && <span className="main-sidebar-item-badge">{badge > 99 ? '99+' : badge}</span>}
                </span>
                <span className="main-sidebar-item-label">{label}{item.beta && <span className="beta-badge">BETA</span>}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="main-sidebar-section">
          <div className="main-sidebar-section-label">Temas</div>
          <div className="main-sidebar-community-list">
            {sortedClubs.map((c) => (
              <button
                key={c.id}
                className={`main-sidebar-community-item ${location.pathname === `/comunidades/${c.slug}` ? 'active' : ''}`}
                onClick={() => { navigate(`/comunidades/${c.slug}`); useStore.getState().closeMobileSidebar(); }}
                title={c.name}
              >
                <span className="main-sidebar-community-icon">{c.iconUrl ? <img src={proxyImage(c.iconUrl)} alt="" /> : '📌'}</span>
                <span className="main-sidebar-community-name truncate">{c.name}</span>
              </button>
            ))}
            {sortedClubs.length === 0 && (
              <div className="dim main-sidebar-community-empty">Nenhum Tema criado ainda.</div>
            )}
            {isStaff && (
              <button className="main-sidebar-community-item main-sidebar-community-create" onClick={() => navigate('/comunidades')}>
                <span className="main-sidebar-community-icon">➕</span>
                <span className="main-sidebar-community-name">Criar Tema</span>
              </button>
            )}          </div>
        </div>
      </div>
      {tooltip && createPortal(
        <div className="main-sidebar-item-tooltip-portal" style={{ top: tooltip.top, left: tooltip.left }}>
          {tooltip.label}
        </div>,
        document.body,
      )}
    </aside>
  );
}
