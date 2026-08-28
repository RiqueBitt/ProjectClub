import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { playSound } from '../utils/sounds';
import { getCommunity, listConversations, listFriends } from '../api/endpoints';
import MainSidebar from '../components/MainSidebar.jsx';
import TopSearchBar from '../components/TopSearchBar.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import MembersList from '../components/MembersList.jsx';
import PanelSlot from '../components/PanelSlot.jsx';
import DMProfilePanel from '../components/DMProfilePanel.jsx';
import CallBar from '../components/CallBar.jsx';
import IncomingCallBanner from '../components/IncomingCallBanner.jsx';
import NoticeToast from '../components/NoticeToast.jsx';
import WelcomePane from '../components/WelcomePane.jsx';
import UserProfileModal from '../components/modals/UserProfileModal.jsx';
import MiniProfileCard from '../components/MiniProfileCard.jsx';
import LinkConfirmModal from '../components/modals/LinkConfirmModal.jsx';
import ImageLightbox from '../components/ImageLightbox.jsx';
import AnnouncementOverlay from '../components/AnnouncementOverlay.jsx';
import QuickSwitcher from '../components/QuickSwitcher.jsx';
import { listUsableEmojis, listFavoriteGifs, getUiLayout, listCommunities } from '../api/endpoints';
import { checkForNativeUpdate } from '../utils/nativeUpdateCheck';
import { setupPushNotifications } from '../utils/pushNotifications';
import { updateUnreadBadge } from '../utils/unreadBadge';
import { useAuth } from '../context/AuthContext.jsx';

// BUG CORRIGIDO ("web mais rápido e otimizado"): todas essas páginas de
// seção (Amigos, Perfil, Notificações, Busca, Painel da staff, Economia,
// Ranks, Casas, Figurinhas, Suporte) eram importadas de forma "eager" —
// entravam no MESMO arquivo JS que o resto do app inteiro carrega já na
// primeira visita, mesmo pra quem só quer abrir o Chat e nunca vai clicar
// em "Painel" ou "Casas" naquela sessão. `lazy()` faz cada uma virar seu
// próprio pedaço (chunk) baixado só quando a pessoa navega até ali de
// verdade — o pacote inicial que todo mundo baixa pra simplesmente ABRIR
// o site fica menor, carregando mais rápido, especialmente em conexões
// mais lentas. `ChatWindow` continua "eager" de propósito (é a página que
// abre por padrão pra praticamente todo mundo, então não faria sentido
// atrasar ela com uma segunda viagem de rede).
const AmigosPage = lazy(() => import('./AmigosPage.jsx'));
const ProfilePage = lazy(() => import('./ProfilePage.jsx'));
const NotificationsPage = lazy(() => import('./NotificationsPage.jsx'));
const SearchPage = lazy(() => import('./SearchPage.jsx'));
const AdminPanel = lazy(() => import('./AdminPanel.jsx'));
const EconomyPage = lazy(() => import('./EconomyPage.jsx'));
const RankPage = lazy(() => import('./RankPage.jsx'));
const HousesPage = lazy(() => import('./HousesPage.jsx'));
const StickersPage = lazy(() => import('./StickersPage.jsx'));
const TicketsPage = lazy(() => import('./TicketsPage.jsx'));
const CommunitiesPage = lazy(() => import('./CommunitiesPage.jsx'));
const CommunityPage = lazy(() => import('./CommunityPage.jsx'));
const PostDetailPage = lazy(() => import('./PostDetailPage.jsx'));
const AchievementsPage = lazy(() => import('./AchievementsPage.jsx'));
const UpdatesPage = lazy(() => import('./UpdatesPage.jsx'));

// Interface com UMA barra lateral principal só (MainSidebar.jsx —
// Chat/Amigos/Perfil/Notificações/Ranks/Busca/Suporte). A antiga dupla
// NavBar (topo) + TopMenu (canais/DMs/outras áreas) + ChannelSidebar/
// DMSidebar (gaveta mobile) saiu de aqui: a navegação entre chats
// específicos agora vive dentro da própria área de Chat, como abas no
// topo do ChatWindow (ver ChannelSwitcher.jsx). As rotas de
// Economia/Casas/Figurinhas/Painel continuam existindo (nada foi
// apagado do projeto) — só não fazem mais parte da barra principal,
// que deve ter somente os 7 itens pedidos.
export default function MainApp() {
  const { user } = useAuth();
  const {
    setCommunityStructure, setConversations, setFriends, setUsableEmojis, setFavoriteGifs, setClubs,
  } = useStore();
  const [membersOpen, setMembersOpen] = useState(true);
  const [dmProfileOpen, setDmProfileOpen] = useState(true);
  const mobileMembersOpen = useStore((s) => s.mobileMembersOpen);
  const openMobileMembers = useStore((s) => s.openMobileMembers);
  const closeMobileMembers = useStore((s) => s.closeMobileMembers);
  const closeMobileSidebar = useStore((s) => s.closeMobileSidebar);
  const setUiLayoutAll = useStore((s) => s.setUiLayoutAll);
  const uiLayout = useStore((s) => s.uiLayout);
  const location = useLocation();
  const touchStart = useRef(null);

  useEffect(() => {
    getCommunity().then((d) => setCommunityStructure({
      categories: d.categories, channels: d.channels, members: d.members, roles: d.roles, community: d.community,
    })).catch(() => {});
    listConversations().then((d) => setConversations(d.conversations)).catch(() => {});
    listFriends().then((d) => setFriends(d.friendships)).catch(() => {});
    listUsableEmojis().then((d) => setUsableEmojis(d.emojis)).catch(() => {});
    listFavoriteGifs().then((d) => setFavoriteGifs(d.gifs)).catch(() => {});
    listCommunities().then((d) => setClubs(d.communities)).catch(() => {});
    checkForNativeUpdate();
    setupPushNotifications();
    getUiLayout().then((d) => setUiLayoutAll(d)).catch(() => {});
  }, []);

  // Item pedido: bolinha de não lidas no ícone do app — em vez de
  // espalhar chamadas manuais em cada lugar que marca algo como lido/
  // não lido (muitos lugares diferentes), observa as fatias do estado
  // que decidem "tem algo não lido" e recalcula sozinho sempre que
  // qualquer uma delas muda — sempre correto, sem depender de lembrar de
  // chamar isso em todo canto novo que mexer nisso no futuro.
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const channelReadAt = useStore((s) => s.channelReadAt);
  const conversationsForBadge = useStore((s) => s.conversations);
  const friendsForBadge = useStore((s) => s.friends);
  useEffect(() => {
    updateUnreadBadge(user.id);
  }, [channels, categories, channelReadAt, conversationsForBadge, friendsForBadge, user.id]);

  // Aplica a largura de sidebar/lista de membros configurada no Editor de
  // Interface (staff) — via CSS custom properties na raiz, com fallback
  // pro valor fixo do CSS se ainda não carregou ou não houver configuração.
  useEffect(() => {
    if (!uiLayout) return;
    document.documentElement.style.setProperty('--sidebar-width', `${uiLayout.sidebarWidth}px`);
    document.documentElement.style.setProperty('--members-width', `${uiLayout.membersWidth}px`);
    document.documentElement.style.setProperty('--members-default-display', uiLayout.membersDefaultOpen === false ? 'none' : 'block');
  }, [uiLayout]);

  // Som de "trocar" ao navegar entre canais/seções — não toca na primeira
  // renderização (isso já é coberto pelo som de abrir a plataforma).
  const isFirstRouteRef = useRef(true);
  const lastSoundedPathRef = useRef(location.pathname);
  // BUG CORRIGIDO: clicar repetidamente e rápido no mesmo item da barra
  // lateral (Chat/Amigos/Perfil/...) tocava o mesmo som várias vezes
  // seguidas mesmo já estando naquela seção — a proteção que já existia
  // (`location.pathname === lastSoundedPathRef.current`) só cobre "estou
  // exatamente na mesma URL agora"; não protegia contra cliques MUITO
  // rápidos em sequência (o próprio React Router pode processar cada
  // clique como uma navegação própria antes do efeito anterior "assentar"
  // o novo pathname como referência, deixando uma pequena janela onde
  // vários cliques em fila disparam o som cada um). Adicionado um
  // cooldown de tempo mínimo entre sons, complementar à checagem de
  // pathname — nenhum dos dois sozinho cobria 100% dos casos.
  const lastSoundAtRef = useRef(0);
  const SOUND_COOLDOWN_MS = 400;
  useEffect(() => {
    closeMobileSidebar();
    closeMobileMembers();
    if (isFirstRouteRef.current) { isFirstRouteRef.current = false; lastSoundedPathRef.current = location.pathname; return; }
    if (location.pathname === lastSoundedPathRef.current) return;
    lastSoundedPathRef.current = location.pathname;
    const now = Date.now();
    if (now - lastSoundAtRef.current < SOUND_COOLDOWN_MS) return;
    lastSoundAtRef.current = now;
    playSound('switchChannel', 0.25);
  }, [location.pathname]);

  const EDGE_ZONE = 24;
  const SWIPE_THRESHOLD = 60;

  // Só sobrou o gesto de abrir/fechar a lista de membros (borda direita)
  // — a gaveta de canais/DMs não existe mais, MainSidebar é sempre visível.
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const deltaX = t.clientX - start.x;
    const deltaY = t.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

    if (mobileMembersOpen) {
      if (deltaX > 0) closeMobileMembers();
      return;
    }
    if (deltaX < 0 && start.x > window.innerWidth - EDGE_ZONE) openMobileMembers();
  };

  return (
    <div
      className={`app-shell ${mobileMembersOpen ? 'mobile-members-open' : ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="mobile-sidebar-backdrop" onClick={closeMobileMembers} />
      <TopSearchBar />
      <MainSidebar />

      <PanelSlot panelId="main">
        <div className="app-main">
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<CommunityDefaultChannel />} />
              <Route path="/dms" element={<AmigosPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/economia" element={<EconomyPage />} />
              <Route path="/rank" element={<RankPage />} />
              <Route path="/casas" element={<HousesPage />} />
              <Route path="/figurinhas" element={<StickersPage />} />
              <Route path="/tickets" element={<TicketsPage />} />
              <Route path="/comunidades" element={<CommunitiesPage />} />
              <Route path="/comunidades/:slug" element={<CommunityPage />} />
              <Route path="/posts/:id" element={<PostDetailPage />} />
              <Route path="/conquistas" element={<AchievementsPage />} />
              <Route path="/atualizacoes" element={<UpdatesPage />} />
              <Route path="/conversations/:conversationId" element={<ChatWindow kind="conversation" />} />
              <Route path="/channels/:channelId" element={<ChatWindow kind="channel" />} />
            </Routes>
          </Suspense>
        </div>
      </PanelSlot>

      <Routes>
        <Route path="/" element={membersOpen ? <PanelSlot panelId="membersList"><MembersList onToggle={() => setMembersOpen(false)} /></PanelSlot> : null} />
        <Route path="/channels/:channelId" element={membersOpen ? <PanelSlot panelId="membersList"><MembersList onToggle={() => setMembersOpen(false)} /></PanelSlot> : null} />
        <Route path="/conversations/:conversationId" element={dmProfileOpen ? <PanelSlot panelId="membersList"><DMProfilePanel onToggle={() => setDmProfileOpen(false)} /></PanelSlot> : null} />
      </Routes>

      <IncomingCallBanner />
      <PanelSlot panelId="callbar"><CallBar /></PanelSlot>
      <NoticeToast />
      <UserProfileModal />
      <MiniProfileCard />
      <LinkConfirmModal />
      <ImageLightbox />
      <AnnouncementOverlay />
      <QuickSwitcher />
    </div>
  );
}

// Ao abrir a raiz "/" (área "Chat" da barra lateral), pula direto pro
// chat "Geral" por padrão — cai num outro canal só se não existir
// nenhum canal chamado "Geral" na comunidade.
function CommunityDefaultChannel() {
  const navigate = useNavigate();
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);

  useEffect(() => {
    const all = [...channels, ...categories.flatMap((c) => c.channels || [])];
    const geral = all.find((c) => c.name?.trim().toLowerCase() === 'geral');
    const firstChannel = geral || categories.flatMap((c) => c.channels || [])[0] || channels[0];
    if (firstChannel) navigate(`/channels/${firstChannel.id}`, { replace: true });
  }, [categories, channels]);

  return <WelcomePane />;
}

// Fallback leve mostrado só durante a fração de segundo em que uma seção
// carregada sob demanda (ver os lazy() no topo do arquivo) ainda está
// baixando seu próprio pedaço de JS pela primeira vez — depois disso o
// navegador já guarda esse pedaço em cache e nem esse fallback chega a
// aparecer de novo pra essa pessoa.
function RouteLoadingFallback() {
  return (
    <div className="route-loading-fallback">
      <div className="route-loading-spinner" />
    </div>
  );
}
