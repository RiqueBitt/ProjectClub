// Project Club — app de desktop (Windows). Não reimplementa nada do site:
// é uma janela do Chromium (Electron) carregando a MESMA versão web já
// hospedada, com o "a mais" que só um app nativo de verdade consegue dar:
// ícone na bandeja do sistema, iniciar sozinho com o Windows, e continuar
// rodando em segundo plano mesmo com a janela fechada — exatamente como
// Discord/Slack fazem.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, globalShortcut, nativeImage, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { startActivityDetection } = require('./activityDetector');

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

  // Abre uma janelinha própria de seleção de tela/janela pra compartilhar
  // — mostra uma miniatura de cada opção disponível (telas inteiras +
  // janelas de outros programas abertos), a pessoa clica na que quer, e
  // essa promise resolve com a fonte escolhida (ou null se ela fechar a
  // janela/cancelar sem escolher nada).
  // Abre uma janelinha própria de seleção de tela/janela pra compartilhar
  // — mostra uma miniatura de cada opção disponível (telas inteiras +
  // janelas de outros programas abertos), a pessoa clica na que quer, e
  // essa promise resolve com a fonte escolhida (ou null se ela fechar a
  // janela/cancelar sem escolher nada).
  function showScreenPickerWindow(rawSources) {
    return new Promise((resolve) => {
      // BUG CORRIGIDO ("aparecem telas sem sentido tipo C:/Users/etc"):
      // o Windows Explorer e alguns outros programas usam o CAMINHO DA
      // PASTA como título da janela — sem nenhum filtro, isso aparecia
      // como uma opção pra compartilhar igual qualquer outra, mas sem
      // fazer sentido nenhum pra pessoa escolher. Filtra fora janelas
      // sem nome de verdade, ou cujo nome parece um caminho de arquivo
      // (letra de unidade tipo "C:\" ou "/", típico do Explorer/
      // gerenciador de arquivos) — telas inteiras (type 'screen') nunca
      // são filtradas, só janelas de programas.
      const sources = rawSources.filter((s) => {
        const name = (s.name || '').trim();
        if (!name) return false;
        if (s.id.startsWith('screen:')) return true; // tela inteira, sempre mantém
        if (/^[a-zA-Z]:\\|^\//.test(name)) return false; // parece um caminho de pasta/arquivo
        return true;
      });

      const picker = new BrowserWindow({
        width: 760, height: 560, resizable: false, minimizable: false, maximizable: false,
        // Item pedido: "melhore a interface, em vez de outra aba, faça
        // um menu" — sem moldura/barra de título nativa do sistema,
        // isso já deixa de parecer "outra janela/aba solta do
        // Windows" e passa a parecer um menu/painel de verdade que
        // pertence ao próprio app, flutuando por cima dele.
        frame: false,
        parent: mainWindow, modal: true, backgroundColor: '#232428',
        webPreferences: {
          preload: path.join(__dirname, 'screenPickerPreload.js'),
          contextIsolation: true, nodeIntegration: false,
        },
      });

      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        if (!picker.isDestroyed()) picker.close();
      };

      ipcMain.once('screen-picker:choice', (_event, sourceId) => {
        finish(rawSources.find((s) => s.id === sourceId) || null);
      });
      picker.on('closed', () => finish(null));

      const screens = sources.filter((s) => s.id.startsWith('screen:'));
      const windows = sources.filter((s) => !s.id.startsWith('screen:'));

      const cardsFor = (list) => list.map((s) => `
        <button class="card" onclick="window.screenPickerAPI.choose(${JSON.stringify(s.id)})">
          <img src="${s.thumbnail.toDataURL()}" alt="" />
          <span>${(s.name || 'Sem nome').replace(/</g, '&lt;').slice(0, 42)}</span>
        </button>
      `).join('');

      // Item pedido: "melhore deixando mais bonito" — cores/tipografia
      // no mesmo espírito do resto do app (fundo bem escuro, acento
      // azul/roxo, cantos arredondados, cards com hover suave) em vez
      // do visual genérico de antes.
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body {
          margin: 0; background: #232428; color: #f2f3f5;
          font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
          padding: 20px; -webkit-app-region: drag; user-select: none;
        }
        .titlebar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        h1 { font-size: 16px; font-weight: 700; margin: 0; }
        .close-btn {
          -webkit-app-region: no-drag; width: 28px; height: 28px; border-radius: 6px; border: none;
          background: transparent; color: #b5bac1; cursor: pointer; font-size: 15px;
        }
        .close-btn:hover { background: #3a3c42; color: #fff; }
        .section-label { font-size: 11px; font-weight: 700; letter-spacing: .4px; color: #949ba4; text-transform: uppercase; margin: 14px 0 8px; -webkit-app-region: no-drag; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; -webkit-app-region: no-drag; }
        .card {
          background: #2b2d31; border: 2px solid transparent; border-radius: 10px; padding: 8px; cursor: pointer;
          color: #f2f3f5; font-size: 12px; text-align: left; transition: border-color .12s ease, background .12s ease;
        }
        .card:hover { border-color: #5865F2; background: #34363c; }
        .card img { width: 100%; height: 84px; object-fit: contain; background: #1a1b1e; border-radius: 6px; margin-bottom: 8px; }
        .card span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .scroll { max-height: 400px; overflow-y: auto; padding-right: 4px; }
        .empty { color: #949ba4; font-size: 13px; padding: 8px 0; }
      </style></head><body>
        <div class="titlebar">
          <h1>Escolha o que compartilhar</h1>
          <button class="close-btn" onclick="window.screenPickerAPI.choose(null)">✕</button>
        </div>
        <div class="scroll">
          ${screens.length ? `<div class="section-label">Telas</div><div class="grid">${cardsFor(screens)}</div>` : ''}
          ${windows.length ? `<div class="section-label">Janelas abertas</div><div class="grid">${cardsFor(windows)}</div>` : `<div class="empty">Nenhuma janela disponível pra compartilhar agora.</div>`}
        </div>
      </body></html>`;

      const htmlPath = path.join(app.getPath('temp'), 'project-club-screen-picker.html');
      fs.writeFileSync(htmlPath, html, 'utf-8');
      picker.loadFile(htmlPath);
    });
  }

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
        sandbox: false,
      },
    });

    mainWindow.loadURL(APP_URL);

    // Item pedido: "Rich Presence" (jogo/Spotify) — só começa a detectar
    // depois que a janela terminar de carregar o site de verdade, senão
    // a primeira detecção (que roda na hora, sem esperar o primeiro
    // temporizador de 15s) tentaria mandar pro site antes dele sequer
    // existir. mainWindow.webContents.send manda direto pro JS da
    // página, sem precisar de handle/invoke — é só um aviso, não uma
    // pergunta que espera resposta.
    mainWindow.webContents.once('did-finish-load', () => {
      startActivityDetection((activity) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('activity:detected', activity);
        }
      });
    });

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

  // Item pedido: o site (rodando dentro da janela) precisa saber "qual
  // versão do app nativo está instalada" pra comparar com a mais
  // recente publicada e avisar quando tem atualização — ver preload.js
  // e client/src/utils/nativeUpdateCheck.js. app.getVersion() lê direto
  // do package.json empacotado (o CI grava a versão certa ali antes de
  // gerar o instalador, ver .github/workflows/build-apps.yml).
  ipcMain.handle('get-app-version', () => app.getVersion());
  // Item pedido: botão "Baixar agora" no aviso de atualização precisa
  // abrir a página de download no NAVEGADOR de verdade — o app nativo
  // nunca mostra a página de marketing/download dentro dele mesmo (ver
  // RootGate em App.jsx), então "navegar pra lá" dentro da própria janela
  // não funcionaria. shell.openExternal manda pro navegador padrão do
  // sistema, de verdade.
  ipcMain.handle('open-external', (_event, url) => shell.openExternal(url));
  // Item pedido: clicar numa notificação nativa traz a janela de volta
  // pra frente (mesmo vindo da bandeja) — ver o onclick da notificação
  // em SocketContext.jsx.
  ipcMain.handle('focus-window', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  // Item pedido: bolinha vermelha de não lidas sobreposta no ícone da
  // barra de tarefas do Windows (setOverlayIcon é a API certa pra isso
  // — diferente de macOS/Linux, o Windows não tem "badge count" nativo
  // com número, só ícones sobrepostos; por isso é uma bolinha simples,
  // igual pedido, não um número). Fica só ligado/desligado — não some
  // sozinho, alguém precisa realmente ler as mensagens novas.
  const badgeIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'badge-dot.png'));
  ipcMain.handle('set-unread-count', (_event, count) => {
    if (!mainWindow) return;
    mainWindow.setOverlayIcon(count > 0 ? badgeIcon : null, count > 0 ? `${count} não lida(s)` : '');
  });

  // Item pedido: "compartilhar tela não funciona no .exe" — o Electron
  // (diferente de um navegador comum) NÃO tem embutido o pedido nativo
  // de "escolher uma tela/janela pra compartilhar" — sem isso configurado
  // aqui, getDisplayMedia() do site (usado pelo Agora) simplesmente nunca
  // teria de onde escolher nada. session.setDisplayMediaRequestHandler é
  // o gancho oficial do Electron pra isso: sempre que o site pede
  // getDisplayMedia(), esse handler roda aqui no processo principal,
  // lista as telas/janelas disponíveis via desktopCapturer, abre uma
  // telinha própria de seleção com miniaturas (o seletor NATIVO do
  // sistema operacional só existe no macOS 15+, não ajuda no Windows/
  // Linux, que é o público real desse app), e devolve pro site a escolha
  // feita. 'loopback' no áudio já captura o som do sistema de brinde no
  // Windows, sem precisar de nada a mais.
  //
  // Precisa ficar dentro do app.whenReady() — session.defaultSession só
  // fica disponível de verdade depois que o Electron termina de
  // inicializar, diferente de ipcMain.handle (que pode ser registrado a
  // qualquer momento).
  function setupScreenShareHandler() {
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 300, height: 200 },
          fetchWindowIcons: true,
        });
        const chosen = await showScreenPickerWindow(sources);
        if (!chosen) { callback({}); return; } // pessoa cancelou — devolve vazio, o site trata como "cancelado" normalmente
        callback({ video: chosen, audio: 'loopback' });
      } catch (err) {
        console.error('[compartilhar tela] falhou:', err);
        callback({});
      }
    }, { useSystemPicker: false });
  }

  app.whenReady().then(() => {
    setupScreenShareHandler();
    // BUG CORRIGIDO — CAUSA RAIZ CONFIRMADA de "no PC eu falo e não sai
    // áudio nenhum, mas eu escuto todo mundo": faltava isto aqui. Um
    // comentário antigo (removido) dizia que `sandbox: false` resolvia a
    // permissão de microfone do Electron — não resolve, são coisas
    // completamente diferentes (sandbox é sobre isolamento de processo,
    // não sobre permissão de mídia). Sem um handler de permissão
    // explícito, o Electron NUNCA mostra o popup nativo "permitir
    // microfone?" que um navegador normal mostra — ele só nega o pedido
    // de getUserMedia() por baixo dos panos, silenciosamente. O
    // resultado bate 100% com o relatado: a chamada conecta normal (o
    // WebRTC em si nunca teve erro nenhum), a pessoa CONTINUA ouvindo
    // todo mundo (só o RECEBER áudio é afetado por isso), mas o próprio
    // áudio dela nunca chega a ninguém — porque o microfone nunca foi
    // liberado de verdade pro app, em NENHUMA rede, o que também explica
    // por que testar com o celular no wifi ou nos dados móveis dava
    // exatamente no mesmo resultado: o problema nunca esteve na rede.
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'microphone', 'camera', 'display-capture', 'notifications'];
      callback(allowed.includes(permission));
    });
    // Mesma liberação, mas pra checagem SÍNCRONA que alguns navegadores/
    // versões do Electron fazem antes mesmo de chegar no handler acima
    // (checkPermission, não requestPermission) — sem isso, em algumas
    // versões o pedido nem chega a acionar o handler de cima, e cai
    // direto numa negação silenciosa de qualquer jeito.
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      const allowed = ['media', 'microphone', 'camera', 'display-capture', 'notifications'];
      return allowed.includes(permission);
    });

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

    // Item pedido: atalho de teclado global (funciona mesmo com o app em
    // segundo plano/sem foco, diferente de um atalho comum) pra abrir o
    // app rapidamente. Ctrl+Shift+P — escolhido por ser raro de colidir
    // com outros programas comuns (P de "Project Club").
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide(); // aperta de novo pra esconder — alterna, como o Discord faz
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on('window-all-closed', () => {
    // Não faz nada — no Windows/Linux isso normalmente encerraria o app,
    // mas aqui a janela só se ESCONDE (ver mainWindow.on('close') acima),
    // então esse evento só dispara de verdade quando a pessoa realmente
    // pediu pra sair pelo menu da bandeja.
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); });
}
