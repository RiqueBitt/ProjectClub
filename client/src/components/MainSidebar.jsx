import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
import achievementsIcon from '../assets/icons/nav-achievements.png';
import inicioIcon from '../assets/icons/nav-updates.png';
import clansIcon from '../assets/icons/nav-clans.png';
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
  { to: '/dms', icon: friendsIcon, isImg: true, labelKey: 'nav.amigos', match: (p) => p === '/dms' || p.startsWith('/conversations/') },
  // Item pedido: "crie uma nova categoria chamada Jogos, posicionada
  // logo abaixo da categoria Amigos... dentro de Jogos, crie duas
  // opções: Jogos e Aplicativos" — sem ícone dedicado no pacote de
  // ícones do app (mesma situação de Clãs antes de ganhar um próprio),
  // emoji como os outros itens já usam quando não há um ícone
  // customizado disponível. As duas "opções" (Jogos/Aplicativos)
  // viram abas DENTRO da própria página — ver JogosPage.jsx — mesmo
  // padrão que o resto desta barra já usa (item único levando pra uma
  // página com navegação interna própria), em vez de inventar um
  // segundo nível de menu que não existe em nenhum outro lugar dela.
  { to: '/jogos', icon: appsIcon, isImg: true, labelKey: 'nav.jogos', match: (p) => p.startsWith('/jogos') },
  // Item pedido: "remover a aba Notificações do menu lateral esquerdo
  // e deixar as notificações disponíveis somente pelo ícone de sino
  // localizado na parte superior da interface" — o sino já existe e
  // já leva pra essa mesma rota (ver TopSearchBar.jsx), então o
  // acesso continua funcionando normalmente, só sem essa entrada
  // duplicada aqui na barra lateral.
  { to: '/rank', icon: ranksIcon, isImg: true, labelKey: 'nav.ranks', match: (p) => p.startsWith('/rank') },
  { to: '/conquistas', icon: achievementsIcon, isImg: true, labelKey: 'nav.conquistas', match: (p) => p.startsWith('/conquistas') },
  { to: '/tickets', icon: supportIcon, isImg: true, labelKey: 'nav.suporte', match: (p) => p.startsWith('/tickets') },
  // Item pedido: "nova opção chamada Clans na barra lateral" — sem
  // ícone dedicado no pacote de ícones do app (isImg: true exigiria
  // um arquivo próprio), emoji como os outros lugares do app já usam
  // quando não há um ícone customizado disponível.
  // Item pedido: "trocar o emoji por esse icon" (ícone enviado pelo
  // usuário) — mesmo padrão isImg:true dos outros itens da barra.
  // Item pedido: "caixinha azul com BETA... bordas onduladas, pra
  // mostrar que é uma funcionalidade beta" — badge: true ativa esse
  // selo ao lado do texto (ver renderização abaixo).
  { to: '/clans', icon: clansIcon, isImg: true, labelKey: 'nav.clas', beta: true, match: (p) => p.startsWith('/clans') },
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

  // Lista de Clubes — igual a seção "COMUNIDADES" da HomeSideBar do
  // clone do Reddit (subredditList: cada uma com ícone + nome), só que
  // agora vem do estado global (useStore) em vez de um fetch próprio —
  // é a mesma lista que a página de Feeds usa, e as duas atualizam
  // sozinhas em tempo real via socket quando a staff cria/edita/exclui
  // um Clube (ver SocketContext.jsx). Clubes não têm mais conceito de
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
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`main-sidebar-item ${active ? 'active' : ''}`}
                onClick={() => useStore.getState().closeMobileSidebar()}
              >
                <span className="main-sidebar-item-icon">
                  {item.isImg
                    ? <span className="main-sidebar-item-icon-img" style={{ WebkitMaskImage: `url(${item.icon})`, maskImage: `url(${item.icon})` }} />
                    : item.icon}
                  {badge > 0 && <span className="main-sidebar-item-badge">{badge > 99 ? '99+' : badge}</span>}
                </span>
                <span className="main-sidebar-item-label">{t(item.labelKey)}{item.beta && <span className="beta-badge">BETA</span>}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="main-sidebar-section">
          <div className="main-sidebar-section-label">Clubes</div>
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
              <div className="dim main-sidebar-community-empty">Nenhum Clube criado ainda.</div>
            )}
            {isStaff && (
              <button className="main-sidebar-community-item main-sidebar-community-create" onClick={() => navigate('/comunidades')}>
                <span className="main-sidebar-community-icon">➕</span>
                <span className="main-sidebar-community-name">Criar Clube</span>
              </button>
            )}          </div>
        </div>
      </div>
    </aside>
  );
}
