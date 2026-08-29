import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { VoiceProvider } from './context/VoiceContext.jsx';
import { ContextMenuProvider } from './context/ContextMenuContext.jsx';
import { useStore } from './store/useStore';
import { getPlatformStatus, getCommunity } from './api/endpoints';
import MaintenanceScreen from './pages/MaintenanceScreen.jsx';
import InterfaceEditorPage from './pages/InterfaceEditorPage.jsx';
import { playSound } from './utils/sounds';
import { CUSTOM_BACKGROUND_ENABLED } from './utils/featureFlags';

import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import MainApp from './pages/MainApp.jsx';
import LandingPage from './pages/LandingPage.jsx';

// "Em reforma" (see adminController.setMaintenanceMode) only gates the
// actual protected app — /login, /register etc stay reachable regardless,
// so a staff member whose session lapsed during maintenance can still log
// back in. Checked once per mount and again every 30s so it takes effect
// for anyone with the app already open, not just on a fresh page load; the
// real enforcement is server-side (middleware/auth.js's requireAuth) —
// this is just the client reflecting that state instead of every request
// failing with an unexplained 503.
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const [maintenance, setMaintenance] = useState(null);
  const [staffBypassed, setStaffBypassed] = useState(false);
  // BUG CORRIGIDO ("a tela de carregamento não aparece mais / quero ela
  // aparecendo e sumindo quando tudo tiver carregado de verdade"): a
  // correção anterior deixou esse tempo mínimo tão curto (150ms) que na
  // prática a tela nunca chegava a ficar visível de verdade — ela
  // desaparecia quase junto com a checagem de login, bem antes dos
  // dados reais (comunidade, avatares) sequer começarem a chegar. O
  // problema não era o tempo mínimo em si — era a tela nunca ter sido
  // amarrada ao carregamento de dados REAIS, só a um relógio arbitrário.
  // Agora ela só some quando a comunidade (membros, com as fotos de
  // perfil) já tiver terminado de carregar de verdade — ver
  // communityPreview abaixo — não mais um tempo fixo qualquer.
  const MIN_SPLASH_MS = 150;
  const [minSplashDone, setMinSplashDone] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMinSplashDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const check = () => getPlatformStatus().then((d) => {
      setMaintenance(d);
      useStore.getState().setDisabledSystems(d.disabledSystems || []);
    }).catch(() => {});
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // A busca da comunidade (usada tanto pra saber "já carregou de
  // verdade" quanto pras fotos de perfil reais na tela de esqueleto —
  // ver AppSkeletonScreen) só pode começar depois que a checagem de
  // login já resolveu E existe uma conta de verdade — antes disso a
  // chamada falharia com 401. `communityPreview` fica `null` enquanto
  // ainda não sabemos, e vira um array (mesmo vazio, se a busca falhar)
  // assim que sabemos — null é o único valor que mantém a tela de
  // esqueleto visível.
  const [communityPreview, setCommunityPreview] = useState(null);
  const communityFetchStarted = useRef(false);
  useEffect(() => {
    if (loading || !user || communityFetchStarted.current) return;
    communityFetchStarted.current = true;
    getCommunity()
      .then((d) => setCommunityPreview((d.members || []).slice(0, 7)))
      // Se a busca falhar (rede caiu, etc.), não trava a pessoa numa
      // tela de carregamento pra sempre — considera "carregado" mesmo
      // assim (sem fotos de prévia) e deixa ela entrar no app normal,
      // que vai tentar essa mesma busca de novo por conta própria.
      .catch(() => setCommunityPreview([]));
  }, [loading, user]);

  // Só considera "pronto" (esconde a tela de esqueleto) quando: a
  // checagem de login terminou, o tempo mínimo já passou (evita um
  // "pisca" de meio frame em conexões muito rápidas), e — só quando
  // existe uma conta de verdade — a comunidade também já carregou.
  // Sem conta (vai cair no redirect pro login logo abaixo) não precisa
  // esperar a comunidade, que nunca vai carregar mesmo.
  const appReady = !loading && minSplashDone && (!user || communityPreview !== null);
  if (!appReady) return <AppSkeletonScreen previewMembers={communityPreview} />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailVerified) return <Navigate to="/verify-email" replace />;

  const isStaff = ['ADMIN', 'MODERATOR'].includes(user.platformRole);
  if (maintenance?.maintenanceMode && !(isStaff && staffBypassed)) {
    return <MaintenanceScreen message={maintenance.maintenanceMessage} onStaffBypass={() => setStaffBypassed(true)} />;
  }
  // Without this, removing the "pular" button on VerifyEmailPage would be
  // purely cosmetic — a logged-in-but-unverified user could still just type
  // any app URL and land straight in MainApp, since a valid access token is
  // already issued at registration (see authController.register). This is
  // the actual enforcement point: no verified e-mail, no access past here,
  // regardless of what URL is typed.
  return children;
}

// Reaproveitado pelas duas rotas que precisam do app protegido de verdade
// (o catch-all "/*" pra qualquer URL interna, e a raiz "/" quando a
// pessoa já está logada — ver RootGate abaixo) — sem duplicar a árvore
// de providers (Socket/Voice/ContextMenu) em dois lugares diferentes.
function ProtectedApp() {
  return (
    <ProtectedRoute>
      <SocketProvider>
        <VoiceProvider>
          <ContextMenuProvider>
            <MainApp />
          </ContextMenuProvider>
        </VoiceProvider>
      </SocketProvider>
    </ProtectedRoute>
  );
}

// Item pedido: abrir o site direto não deve mais cair no formulário de
// login sem nenhuma introdução — a raiz "/" agora mostra a página
// inicial pública (LandingPage.jsx, estilo Discord) pra quem ainda não
// está logado, e só entra direto no app de verdade pra quem já tem
// sessão ativa (mesmo comportamento de antes, preservado).
// Item pedido: a página inicial (com os botões de baixar .exe/.apk/
// .AppImage) só faz sentido pra quem está no NAVEGADOR — dentro do
// próprio app instalado (Windows/Linux/Android) não faz sentido nenhum
// mostrar "baixar para Windows" pra quem já está rodando o app do
// Windows. isNativeApp() detecta os dois tipos de app nativo que esse
// projeto tem: Electron (desktop, expõe window.electronAPI via
// preload.js) e Capacitor (Android, expõe window.Capacitor).
function isNativeApp() {
  if (typeof window === 'undefined') return false;
  if (window.electronAPI) return true;
  return !!window.Capacitor?.isNativePlatform?.();
}

// BUG CORRIGIDO ("clicar em Comunidade recarrega a página inteira"): "/"
// e "/*" eram DUAS entradas <Route> separadas, mesmo as duas
// terminando em <ProtectedApp/> — só que pro React Router (e pro React
// por baixo), rotas DIFERENTES na árvore de JSX nunca preservam a
// identidade do componente entre uma e outra, mesmo renderizando "a
// mesma coisa". Navegar de qualquer lugar (ex: /dms) de volta pra "/"
// desmontava o <ProtectedApp>/<MainApp> inteiro e montava um novo do
// zero — reexecutando TODOS os efeitos de inicialização (buscar
// clubes, checar atualização, registrar push, recalcular o badge...) a
// cada clique, o que "parece" um recarregamento completo mesmo sem ser
// de verdade um F5 no navegador. RootGate agora cuida de "/" e "/*" ao
// mesmo tempo, numa ÚNICA <Route>, usando o pathname atual (useLocation)
// só pra decidir se mostra a página de marketing (só na raiz "/", só
// pra quem não está logado) — sem nunca duplicar a rota que leva no
// <ProtectedApp/>, que a partir de agora é sempre a MESMA instância,
// nunca remontada só por causa de navegação interna.
function RootGate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (user) return <ProtectedApp />;
  if (location.pathname !== '/') return <ProtectedApp />; // ProtectedRoute (dentro) cuida do redirecionamento pro /login
  // App nativo sem sessão ativa vai direto pro login — sem passar pela
  // página de marketing/download no meio do caminho.
  if (isNativeApp()) return <Navigate to="/login" replace />;
  return <LandingPage />;
}

// BUG CORRIGIDO ("tela de carregamento boba"): a antiga SplashScreen era
// uma tela genérica e vazia (só uma marca girando + uma dica de texto),
// sem nenhuma relação com o que está de fato carregando. Esse componente
// desenha uma versão "esqueleto" da interface REAL — a mesma barra
// lateral, com círculos cinza no lugar dos ícones/avatar do perfil, e a
// mesma área de chat, com barrinhas cinza no lugar de nome/mensagem —
// tudo com um brilho suave passando por cima (efeito "shimmer", comum em
// apps como Discord/Instagram durante o carregamento). Assim que os dados
// de verdade chegam, o React troca isso pela interface real no lugar
// exato onde cada peça já "estava" — a pessoa vê a própria aplicação
// se montando, não uma tela solta sem relação com o app.
//
// BUG CORRIGIDO (2ª rodada — "ir carregando as fotos de perfil etc, em
// vez de ser só uma tela de carregamento boba"): a lista de membros
// (com as fotos de perfil reais) é buscada pelo ProtectedRoute logo
// acima — recebida aqui como `previewMembers` — em vez desta tela
// buscar por conta própria, já que agora a MESMA busca também decide
// quando a tela deve desaparecer (ver appReady em ProtectedRoute).
function AppSkeletonScreen({ previewMembers }) {
  // Mantém o "toque" sonoro de abrir o app, que antes vivia na tela de
  // splash antiga — só o visual mudou, o som de abertura continua.
  useEffect(() => { playSound('appOpen'); }, []);

  return (
    <div className="app-skeleton-shell">
      <div className="app-skeleton-sidebar">
        <div className="app-skeleton-pulse app-skeleton-brand" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="app-skeleton-pulse app-skeleton-nav-item" />
        ))}
        <div className="app-skeleton-sidebar-spacer" />
        <div className="app-skeleton-pulse app-skeleton-profile" />
      </div>
      <div className="app-skeleton-main">
        <div className="app-skeleton-header">
          <div className="app-skeleton-pulse app-skeleton-header-bar" />
        </div>
        <div className="app-skeleton-messages">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="app-skeleton-message-row">
              <div className="app-skeleton-pulse app-skeleton-avatar" />
              <div className="app-skeleton-message-lines">
                <div className="app-skeleton-pulse app-skeleton-line" style={{ width: `${38 + (i * 7) % 30}%` }} />
                <div className="app-skeleton-pulse app-skeleton-line" style={{ width: `${55 + (i * 11) % 35}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="app-skeleton-members">
        {Array.from({ length: 7 }).map((_, i) => {
          const member = previewMembers?.[i];
          const hasPhoto = member?.user?.avatarUrl;
          return (
            <div key={i} className="app-skeleton-member-row">
              {hasPhoto ? (
                <img className="app-skeleton-avatar-real" src={member.user.avatarUrl} alt="" />
              ) : (
                <div className="app-skeleton-pulse app-skeleton-avatar-sm" />
              )}
              {member ? (
                <span className="app-skeleton-member-name truncate">{member.user.displayName}</span>
              ) : (
                <div className="app-skeleton-pulse app-skeleton-line" style={{ width: `${45 + (i * 9) % 30}%` }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const customBackground = useStore((s) => s.customBackground);

  // Deterrent-only "no inspecting" measures: blocks the browser's own
  // right-click menu everywhere (custom context menus elsewhere in the app
  // already call preventDefault() themselves — this is just the fallback
  // for everywhere else) and the common inspect-element/view-source
  // shortcuts (F12, Ctrl/Cmd+Shift+I/J/C, Ctrl/Cmd+U). Worth being honest
  // about what this actually is: a deterrent for casual right-click use,
  // not real security — anyone who actually wants dev tools open can still
  // get to them (browser menu, About page, a different shortcut), and
  // nothing server-side depends on this holding. Real protection for
  // anything sensitive has to live on the server, not the client.
  useEffect(() => {
    const onContextMenu = (e) => e.preventDefault();
    const onKeyDown = (e) => {
      const key = e.key?.toLowerCase();
      const blockedCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(key);
      const viewSource = (e.ctrlKey || e.metaKey) && key === 'u';
      if (key === 'f12' || blockedCombo || viewSource) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // A custom background is a single gradient painted on one fixed,
  // full-viewport backdrop element (#custom-bg-backdrop, rendered below)
  // sitting behind everything — see the .custom-bg-active rules in
  // global.css for how surface panels turn semi-transparent so that one
  // backdrop shows through them consistently, and why menus/modals
  // deliberately don't. Clearing it removes the backdrop's gradient and the
  // transparency overrides at once; the theme's normal solid colors show
  // again everywhere.
  useEffect(() => {
    const backdrop = document.getElementById('custom-bg-backdrop');
    // Função desativada (CUSTOM_BACKGROUND_ENABLED em utils/featureFlags.js):
    // mesmo que exista um customBackground salvo de antes no store de algum
    // usuário, ele deixa de ser aplicado — sempre cai na cor sólida do tema.
    if (CUSTOM_BACKGROUND_ENABLED && customBackground) {
      if (backdrop) backdrop.style.background = `linear-gradient(to bottom, ${customBackground.top}, ${customBackground.bottom})`;
      document.documentElement.classList.add('custom-bg-active');
    } else {
      if (backdrop) backdrop.style.background = 'none';
      document.documentElement.classList.remove('custom-bg-active');
    }
  }, [customBackground]);

  return (
    <>
      <div id="custom-bg-backdrop" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/admin/interface-editor"
          element={
            <ProtectedRoute>
              <InterfaceEditorPage />
            </ProtectedRoute>
          }
        />
        <Route path="/*" element={<RootGate />} />
      </Routes>
    </>
  );
}
