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
      // (letra de unidade tipo "C:\\" ou "/", típico do Explorer/
      // gerenciador de arquivos) — telas inteiras nunca são filtradas.
      const sources = rawSources.filter((s) => {
        const name = (s.name || '').trim();
        if (!name) return false;
        if (s.id.startsWith('screen:')) return true;
        if (/^[a-zA-Z]:\\|^\//.test(name)) return false;
        return true;
      });

      const screens = sources.filter((s) => s.id.startsWith('screen:'));
      const windows = sources.filter((s) => !s.id.startsWith('screen:'));

      const picker = new BrowserWindow({
        width: 820, height: 600, resizable: false, minimizable: false, maximizable: false,
        frame: false,
        parent: mainWindow, modal: true, backgroundColor: '#232428',
        webPreferences: {
          preload: path.join(__dirname, 'screenPickerPreload.js'),
          contextIsolation: true, nodeIntegration: false,
        },
      });

      let resolved = false;
      const onChoice = (_event, sourceId) => {
        finish(rawSources.find((s) => s.id === sourceId) || null);
      };
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        ipcMain.removeListener('screen-picker:choice', onChoice);
        resolve(value);
        if (!picker.isDestroyed()) picker.close();
      };

      ipcMain.on('screen-picker:choice', onChoice);
      picker.on('closed', () => finish(null));

      // Item pedido: "adicione no topo do menu opção Aplicativos,
      // Monitor (se tiver mais de 1 monitor)" — igual o Discord/Zoom já
      // fazem, duas abas em vez de tudo misturado numa lista só. A aba
      // "Tela" só numera os monitores (Tela 1, Tela 2...) quando existe
      // mais de um — com um só, o nome fica simplesmente "Tela inteira".
      const cardsFor = (list, isScreen) => list.map((s, i) => `
        <button class="card" data-source-id="${s.id.replace(/"/g, '&quot;')}">
          <div class="card-thumb"><img src="${s.thumbnail.toDataURL()}" alt="" /></div>
          <span>${isScreen && list.length > 1 ? `Tela ${i + 1}` : isScreen ? 'Tela inteira' : (s.name || 'Sem nome').replace(/</g, '&lt;').slice(0, 46)}</span>
        </button>
      `).join('');

      const screensHtml = screens.length
        ? `<div class="grid">${cardsFor(screens, true)}</div>`
        : `<div class="empty">Nenhuma tela detectada.</div>`;
      const windowsHtml = windows.length
        ? `<div class="grid">${cardsFor(windows, false)}</div>`
        : `<div class="empty">Nenhuma janela disponível pra compartilhar agora.</div>`;

      // Item pedido: "melhore deixando mais bonito" — visual bem mais
      // trabalhado que a versão anterior: abas de verdade no topo,
      // miniaturas maiores com moldura própria, cantos mais arredondados,
      // transições suaves, mesma paleta escura/acento roxo-azulado do
      // resto do app.
      //
      // BUG CORRIGIDO ("clico e não acontece nada"): SEM
      // -webkit-app-region: drag em lugar nenhum — essa propriedade
      // fazia o próprio sistema operacional capturar o clique pra mover
      // a janela antes dele chegar nos botões, um comportamento
      // conhecido e nada confiável do Electron nesse cenário. A telinha
      // não precisa ser arrastável pra funcionar.
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body {
          margin: 0; background: #1e1f22; color: #f2f3f5;
          font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
          padding: 0; user-select: none; overflow: hidden;
        }
        .titlebar { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 0; }
        h1 { font-size: 17px; font-weight: 700; margin: 0; }
        .cancel-btn {
          border-radius: 8px; border: none; padding: 8px 16px;
          background: #3a3c42; color: #f2f3f5; cursor: pointer; font-size: 13px; font-weight: 600;
          transition: background .12s ease;
        }
        .cancel-btn:hover { background: #46484f; }
        .tabs { display: flex; gap: 6px; padding: 18px 22px 0; border-bottom: 1px solid #303136; }
        .tab {
          border: none; background: none; color: #949ba4; font-size: 13px; font-weight: 600;
          padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
          transition: color .12s ease, border-color .12s ease;
        }
        .tab:hover { color: #dbdee1; }
        .tab.active { color: #fff; border-bottom-color: #5865F2; }
        .panel { display: none; padding: 20px 22px; max-height: 420px; overflow-y: auto; }
        .panel.active { display: block; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .card {
          background: #2b2d31; border: 2px solid transparent; border-radius: 12px; padding: 10px; cursor: pointer;
          color: #f2f3f5; font-size: 12px; font-weight: 600; text-align: left;
          transition: border-color .12s ease, background .12s ease, transform .12s ease;
        }
        .card:hover { border-color: #5865F2; background: #34363c; transform: translateY(-1px); }
        .card-thumb {
          width: 100%; aspect-ratio: 16/10; background: #101113; border-radius: 8px; margin-bottom: 10px;
          display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none;
        }
        .card-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .card span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
        .empty { color: #949ba4; font-size: 13px; padding: 30px 0; text-align: center; }
        .error-banner { display: none; background: #f23f42; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 12px; margin: 0 22px 12px; }
      </style></head><body>
        <div class="titlebar">
          <h1>Escolha o que compartilhar</h1>
          <button class="cancel-btn" id="cancel-btn">Não compartilhar</button>
        </div>
        <div class="error-banner" id="error-banner"></div>
        <div class="tabs">
          <button class="tab active" id="tab-screen" data-target="panel-screen">Tela${screens.length > 1 ? `s (${screens.length})` : ''}</button>
          <button class="tab" id="tab-window" data-target="panel-window">Aplicativos${windows.length ? ` (${windows.length})` : ''}</button>
        </div>
        <div class="panel active" id="panel-screen">${screensHtml}</div>
        <div class="panel" id="panel-window">${windowsHtml}</div>
        <script>
          function showError(msg) {
            var el = document.getElementById('error-banner');
            el.textContent = msg;
            el.style.display = 'block';
          }
          function safeChoose(sourceId) {
            try {
              if (!window.screenPickerAPI) {
                showError('Falha interna: a ponte de comunicação com o app não carregou. Feche e tente de novo.');
                return;
              }
              window.screenPickerAPI.choose(sourceId);
            } catch (err) {
              showError('Erro ao escolher: ' + err.message);
            }
          }
          try {
            document.getElementById('cancel-btn').addEventListener('click', function () {
              safeChoose(null);
            });
            document.querySelectorAll('.card').forEach(function (card) {
              card.addEventListener('click', function () {
                safeChoose(card.getAttribute('data-source-id'));
              });
            });
            document.querySelectorAll('.tab').forEach(function (tab) {
              tab.addEventListener('click', function () {
                document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                document.getElementById(tab.getAttribute('data-target')).classList.add('active');
              });
            });
          } catch (err) {
            showError('Não foi possível carregar a lista — ' + err.message);
          }
        </script>
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
