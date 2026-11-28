// "Entrar com Discord / GitHub" dentro do app desktop.
//
// O site manda a janela principal pra /api/auth/oauth/<provedor>/start, e
// o servidor responde com um redirecionamento pra página do provedor. Em
// vez de deixar a janela principal (sem moldura, com a ponte do preload)
// abrir discord.com/github.com, o redirecionamento é interceptado e a
// página do provedor abre numa janelinha própria, COM moldura (dá pra
// fechar), sem preload e na mesma sessão (os cookies do login são os
// mesmos). Quando o provedor devolve pro callback do Project Club, a
// janelinha fecha e a janela principal carrega o callback — o login
// termina ali, igual no navegador.
//
// O Google não entra aqui: ele bloqueia login em navegadores embutidos
// ("disallowed_useragent"), por isso o botão dele nem aparece no app
// desktop (ver client/src/components/auth/OAuthButtons.jsx e docs/oauth.md).
const { BrowserWindow, shell } = require('electron');

// Só esses domínios podem ser abertos na janelinha (e navegados dentro dela).
const PROVIDER_HOSTS = {
  discord: ['discord.com', 'www.discord.com'],
  github: ['github.com'],
};

function providerOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    return Object.keys(PROVIDER_HOSTS).find((p) => PROVIDER_HOSTS[p].includes(host)) || null;
  } catch {
    return null;
  }
}

// Página de AUTORIZAÇÃO do provedor (o começo do fluxo) — só ela abre a
// janelinha; um link comum pro discord.com/github.com no chat continua
// indo pro navegador do sistema, como antes.
const AUTHORIZE_PATHS = {
  discord: [/^\/oauth2\/authorize$/, /^\/api\/oauth2\/authorize$/],
  github: [/^\/login\/oauth\/authorize$/],
};
function isAuthorizeUrl(url) {
  const provider = providerOf(url);
  if (!provider) return false;
  try { return AUTHORIZE_PATHS[provider].some((re) => re.test(new URL(url).pathname)); } catch { return false; }
}

function isCallbackUrl(url, isAppUrl) {
  if (!isAppUrl(url)) return false;
  try { return /^\/api\/auth\/oauth\/[a-z]+\/callback$/.test(new URL(url).pathname); } catch { return false; }
}

// Liga a interceptação na janela principal. `appUrl` = origem do site.
function attach(mainWindow, { isAppUrl, appUrl }) {
  const wc = mainWindow.webContents;
  let popup = null;

  // Entrar/inscrever: o /start do site redireciona pro provedor.
  wc.on('will-redirect', (event, url) => {
    if (!isAuthorizeUrl(url) || !isAppUrl(wc.getURL())) return;
    event.preventDefault();
    openPopup(url);
  });

  function openPopup(url) {
    const provider = providerOf(url);
    if (!provider) return;
    if (popup && !popup.isDestroyed()) { popup.loadURL(url); popup.focus(); return; }
    let finished = false;
    popup = new BrowserWindow({
      parent: mainWindow,
      modal: process.platform !== 'darwin',
      width: 520,
      height: 760,
      minWidth: 380,
      minHeight: 520,
      show: false,
      autoHideMenuBar: true,
      title: provider === 'github' ? 'Entrar com GitHub' : 'Entrar com Discord',
      backgroundColor: '#0b0b0e',
      webPreferences: {
        // Sem preload: a página do provedor nunca vê a ponte do app.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Mesma sessão (padrão) da janela principal: o cookie de estado do
        // login vai junto pro callback.
      },
    });
    const pwc = popup.webContents;
    popup.once('ready-to-show', () => popup?.show());

    const finish = (callbackUrl) => {
      finished = true;
      if (popup && !popup.isDestroyed()) popup.destroy();
      popup = null;
      mainWindow.show();
      mainWindow.focus();
      wc.loadURL(callbackUrl);
    };
    const guard = (event, target) => {
      if (isCallbackUrl(target, isAppUrl)) { event.preventDefault(); finish(target); return; }
      if (providerOf(target) === provider) return; // continua no provedor (login, 2FA...)
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
    };
    pwc.on('will-navigate', guard);
    pwc.on('will-redirect', guard);
    pwc.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//i.test(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    popup.on('closed', () => {
      popup = null;
      // Fechou sem terminar: avisa a tela de login (botão sai do "carregando").
      if (!finished) wc.loadURL(new URL(`/login?oauth_error=cancelado&provider=${provider}`, appUrl).toString());
    });
    popup.loadURL(url);
  }

  // Conectar conta (Configurações): o site navega direto pra URL de
  // autorização. Chamado pelo will-navigate da janela principal; devolve
  // true quando cuidou da navegação.
  return function handleNavigation(url) {
    if (!isAuthorizeUrl(url) || !isAppUrl(wc.getURL())) return false;
    openPopup(url);
    return true;
  };
}

module.exports = { attach, providerOf, isAuthorizeUrl, isCallbackUrl };
