// Project Club — app de desktop (Windows). Não reimplementa nada do site:
// é uma janela do Chromium (Electron) carregando a MESMA versão web já
// hospedada, com o "a mais" que só um app nativo de verdade consegue dar:
// ícone na bandeja do sistema, iniciar sozinho com o Windows, e continuar
// rodando em segundo plano mesmo com a janela fechada — exatamente como
// Discord/Slack fazem.
const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');

// URL do site hospedado — trocar aqui se o domínio mudar um dia. Fica só
// nesse único lugar de propósito.
const APP_URL = process.env.PROJECT_CLUB_URL || 'https://projectclub.squareweb.app';

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Só uma cópia do app rodando por vez — clicar duas vezes no atalho (ou o
// Windows tentando abrir de novo no login enquanto já tá aberto) só traz
// a janela existente pra frente, em vez de abrir uma segunda instância.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  function createWindow(startHidden) {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: !startHidden,
      icon: path.join(__dirname, 'build', 'icon.ico'),
      autoHideMenuBar: true,
      backgroundColor: '#080a14',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        // Cada dispositivo de mídia (câmera/microfone) do canal de voz
        // precisa dessa permissão liberada de antemão — sem isso o
        // Electron bloqueia getUserMedia silenciosamente, diferente do
        // navegador normal que pergunta na hora.
        sandbox: false,
      },
    });

    mainWindow.loadURL(APP_URL);

    // Permite abrir links que o próprio app tenta abrir numa aba nova
    // (ex: conexões do perfil) no navegador padrão do sistema, em vez de
    // abrir uma segunda janela do Electron sem toolbar nem barra de
    // endereço — bem mais seguro pra sites externos.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(APP_URL)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    // Fechar a janela (o "X" do canto) só ESCONDE ela — o app continua
    // rodando de verdade na bandeja (é isso que permite "ficar em segundo
    // plano sem precisar deixar uma janela aberta"). Só encerra de
    // verdade pelo menu da bandeja ("Sair") ou fechando o Windows.
    mainWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        mainWindow.hide();
      }
    });
  }

  function createTray() {
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('Project Club');
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir Project Club', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        },
      },
      { type: 'separator' },
      { label: 'Sair', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
  }

  app.whenReady().then(() => {
    // "openAsHidden" é o que faz a inicialização automática cumprir o
    // pedido de "rodar em segundo plano sem precisar deixar uma janela
    // aberta" — abre direto minimizado na bandeja, não em cima de tudo.
    const startedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    createWindow(startedAtLogin);
    createTray();

    // Configura a inicialização automática já na primeira execução — a
    // pessoa não precisa achar isso em nenhum menu escondido.
    if (!app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    }
  });

  app.on('window-all-closed', () => {
    // Não faz nada — no Windows/Linux isso normalmente encerraria o app,
    // mas aqui a janela só se ESCONDE (ver mainWindow.on('close') acima),
    // então esse evento só dispara de verdade quando a pessoa realmente
    // pediu pra sair pelo menu da bandeja.
  });

  app.on('before-quit', () => { isQuitting = true; });
}
