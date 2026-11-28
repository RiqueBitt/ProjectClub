// Clipes dos últimos 30 segundos (Fase 7) — orquestra a gravação no app de
// PC. Desligado por padrão: com a opção desligada não existe janela
// escondida, nem atalho registrado, nem nada gravando.
//
// Ligado:
//  - uma janela ESCONDIDA (clips/recorder.html, sessão própria em memória)
//    grava a tela escolhida — ou só a janela do jogo detectado, no modo
//    "Jogo" — com o MediaRecorder em baixa prioridade (30/60 fps, 720p ou
//    1080p);
//  - os pedaços ficam só na memória, num buffer circular de ~30 s
//    (clipBuffer.js) — nada vai pro disco nem pra internet;
//  - o atalho global (padrão Alt+F10) salva os últimos 30 s em
//    Vídeos/Project Club Clipes/*.webm e mostra "Clipe salvo" com o botão
//    de abrir a pasta;
//  - enquanto grava, o app mostra um indicador ("Clipes ativos") e a
//    bandeja avisa — nunca grava escondido.
// Áudio: só o som do PC SEM o som do próprio app (as vozes da call não
// entram — ninguém é gravado sem consentimento). Onde isso não é possível
// (Windows antigo, Linux), o clipe sai sem som. Ver clipsCore.pickClipAudio.
//
// As dependências do Electron chegam por parâmetro (main.js), pra dar pra
// testar a lógica com objetos falsos.
const fs = require('fs');
const path = require('path');
const core = require('./clipsCore');
const { WebmClipBuffer } = require('./clipBuffer');

const SETTINGS_FILE = 'clips.json';
// Nome do jogo da atividade detectada (jogo em primeiro plano, ou o jogo
// "por trás" quando a atividade mostrada é música/app).
const gameNameOf = (activity) => (activity?.type === 'game' ? activity.name : activity?.playingGame?.name) || null;
const RETRY_MS = 10_000;
const MAX_RETRIES = 3;

function createClipsManager(deps) {
  const {
    app, BrowserWindow, session, desktopCapturer, globalShortcut, Notification, shell,
    ipcMain, getActivity = () => null, onState = () => {}, onSaved = () => {}, powerMonitor = null,
    fsx = fs, now = () => new Date(), platformAudio = () => core.pickClipAudio(),
  } = deps;

  const settingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILE);
  let settings = (() => {
    try { return core.sanitizeSettings(JSON.parse(fsx.readFileSync(settingsPath(), 'utf8'))); } catch { return core.sanitizeSettings(null); }
  })();
  const ring = new WebmClipBuffer({ keepMs: core.CLIP_SECONDS * 1000, marginMs: 4000 });
  let win = null;
  let ready = false;
  let pendingStart = null;
  let registeredHotkey = null;
  let chosenSource = null;
  let chosenAudio = null;
  let currentGame = null;
  let locked = false;
  let retries = 0;
  let retryTimer = null;
  let ipcBound = false;
  const state = { recording: false, waitingGame: false, error: null, hotkeyOk: true, audio: false, mimeType: null, lastSaved: null };

  const audioAvailable = () => !!platformAudio();
  function snapshot() {
    return {
      settings: { ...settings },
      recording: state.recording,
      waitingGame: state.waitingGame,
      error: state.error,
      hotkeyOk: state.hotkeyOk,
      audio: state.audio,
      audioAvailable: audioAvailable(),
      bufferedSeconds: Math.round(ring.bufferedMs() / 1000),
      lastSaved: state.lastSaved,
      folder: clipsFolder(),
    };
  }
  const emit = () => { try { onState(snapshot()); } catch { /* janela fechando */ } };

  function clipsFolder() {
    let videos;
    try { videos = app.getPath('videos'); } catch { videos = path.join(app.getPath('home'), 'Videos'); }
    return path.join(videos, core.FOLDER_NAME);
  }

  function saveSettings() {
    const file = settingsPath();
    fsx.mkdirSync(path.dirname(file), { recursive: true });
    fsx.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2), 'utf8');
    fsx.renameSync(`${file}.tmp`, file);
  }

  // ---------- Atalho global ----------
  function applyHotkey() {
    const want = settings.enabled ? settings.hotkey : null;
    if (registeredHotkey && registeredHotkey !== want) {
      try { globalShortcut.unregister(registeredHotkey); } catch { /* já saiu */ }
      registeredHotkey = null;
    }
    if (want && registeredHotkey !== want) {
      let ok = false;
      try { ok = globalShortcut.register(want, () => { save().catch(() => {}); }); } catch { ok = false; }
      registeredHotkey = ok ? want : null;
      state.hotkeyOk = ok;
    }
    if (!want) state.hotkeyOk = true;
  }

  // ---------- Janela escondida ----------
  function bindIpc() {
    if (ipcBound) return;
    ipcBound = true;
    const fromRecorder = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents;
    ipcMain.on('clips:chunk', (event, data) => {
      if (!fromRecorder(event)) return;
      if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return;
      ring.push(data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    });
    ipcMain.on('clips:recorder-state', (event, s) => {
      if (!fromRecorder(event) || !s || typeof s !== 'object') return;
      if (s.ready) { ready = true; if (pendingStart) { const p = pendingStart; pendingStart = null; runStart(p); } return; }
      state.recording = !!s.recording;
      state.audio = !!s.audio;
      state.mimeType = typeof s.mimeType === 'string' ? s.mimeType.slice(0, 60) : state.mimeType;
      state.error = s.error ? String(s.error).slice(0, 200) : null;
      if (state.recording) retries = 0;
      // A tela/janela sumiu (jogo fechou, monitor desligado): tenta de novo.
      if (!state.recording && s.error && settings.enabled) scheduleRetry();
      emit();
    });
  }

  function clipSession() {
    const ses = session.fromPartition('clips-recorder'); // em memória (sem "persist:")
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'display-capture'));
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'display-capture');
    // Sem seletor: a fonte já foi escolhida aqui (tela ou janela do jogo).
    ses.setDisplayMediaRequestHandler((request, callback) => {
      if (!chosenSource) { callback({}); return; }
      const out = { video: chosenSource };
      if (request.audioRequested && chosenAudio) out.audio = chosenAudio;
      callback(out);
    }, { useSystemPicker: false });
    return ses;
  }

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    bindIpc();
    ready = false;
    const w = new BrowserWindow({
      show: false, width: 320, height: 200, skipTaskbar: true, focusable: false,
      webPreferences: {
        preload: path.join(__dirname, 'clips', 'recorderPreload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, session: clipSession(),
      },
    });
    win = w;
    const wc = w.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('render-process-gone', () => { state.recording = false; state.error = 'O gravador fechou sozinho.'; emit(); destroyWindow(); scheduleRetry(); });
    // Só zera se ainda for ESTA janela (uma antiga pode fechar depois de
    // uma nova já ter sido criada).
    w.on('closed', () => { if (win === w) { win = null; ready = false; } });
    w.loadFile(path.join(__dirname, 'clips', 'recorder.html')).catch(() => {});
    return w;
  }

  function destroyWindow() {
    const w = win;
    win = null;
    ready = false;
    if (w && !w.isDestroyed()) { try { w.destroy(); } catch { /* já fechou */ } }
  }

  function scheduleRetry() {
    if (retryTimer || retries >= MAX_RETRIES) return;
    retries += 1;
    retryTimer = setTimeout(() => { retryTimer = null; restart(); }, RETRY_MS);
  }

  function runStart(opts) {
    if (!win || win.isDestroyed()) return;
    // userGesture = true: libera o getDisplayMedia sem clique (a pessoa já
    // ligou a opção nas Configurações).
    win.webContents.executeJavaScript(`window.clipRecorder && window.clipRecorder.start(${JSON.stringify(opts)})`, true).catch(() => {});
  }

  async function chooseSource() {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
    if (settings.source === 'game') {
      if (!currentGame) return { source: null, waitingGame: true };
      const gameWin = core.pickGameWindow(sources, currentGame);
      // Jogo em tela cheia exclusiva às vezes não aparece como janela:
      // aí grava a tela escolhida enquanto o jogo estiver aberto.
      return { source: gameWin || core.pickScreenSource(sources, settings.displayId), waitingGame: false };
    }
    return { source: core.pickScreenSource(sources, settings.displayId), waitingGame: false };
  }

  async function startRecording() {
    const { source, waitingGame } = await chooseSource();
    state.waitingGame = waitingGame;
    if (!source) {
      stopRecording();
      state.error = waitingGame ? null : 'Nenhuma tela disponível pra gravar.';
      emit();
      return;
    }
    chosenSource = source;
    chosenAudio = settings.audio ? platformAudio() : null;
    const profile = core.videoProfile(settings);
    ring.reset(); // fluxo novo = cabeçalho novo
    const opts = { ...profile, audio: !!chosenAudio, sourceId: source.id, mimeTypes: core.MIME_PREFERENCE };
    ensureWindow();
    if (ready) runStart(opts); else pendingStart = opts;
    emit();
  }

  function stopRecording() {
    pendingStart = null;
    chosenSource = null;
    // Fechar a janela encerra o processo do gravador — a captura para na hora.
    destroyWindow();
    ring.reset();
    state.recording = false;
  }

  // Uma reconfiguração por vez (ligar/desligar rápido, jogo abrindo e
  // fechando): cada pedido espera o anterior terminar.
  let chain = Promise.resolve();
  function restart() {
    chain = chain.then(doRestart, doRestart);
    return chain;
  }
  async function doRestart() {
    try {
      if (!settings.enabled || locked) { stopRecording(); emit(); return; }
      await startRecording();
    } catch (err) {
      state.error = String(err?.message || err).slice(0, 200);
      emit();
    }
  }

  // ---------- Salvar ----------
  async function save() {
    if (!settings.enabled) return { saved: false, reason: 'disabled' };
    const clip = ring.exportClip(core.CLIP_SECONDS * 1000);
    if (!clip) {
      notify('Clipe ainda não disponível', 'Os Clipes acabaram de começar a gravar — tente de novo em alguns segundos.');
      return { saved: false, reason: 'empty' };
    }
    const dir = clipsFolder();
    await fsx.promises.mkdir(dir, { recursive: true });
    const file = core.uniquePath(dir, core.clipFileName(now(), currentGame), (p) => fsx.existsSync(p));
    await fsx.promises.writeFile(file, clip.buffer);
    const seconds = Math.round(clip.durationMs / 1000);
    state.lastSaved = { file, name: path.basename(file), seconds, at: now().toISOString() };
    notify('Clipe salvo', `${path.basename(file)} · ${seconds}s — clique para abrir a pasta`, () => shell.showItemInFolder(file));
    try { onSaved({ ...state.lastSaved }); } catch { /* janela fechando */ }
    emit();
    return { saved: true, ...state.lastSaved };
  }

  function notify(title, body, onClick) {
    try {
      if (!Notification?.isSupported?.()) return;
      const n = new Notification({ title, body, silent: true });
      if (onClick) n.on('click', onClick);
      n.show();
    } catch { /* sem notificação nativa */ }
  }

  // ---------- API pro main.js ----------
  function setSettings(patch) {
    const before = settings;
    settings = core.sanitizeSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) });
    saveSettings();
    applyHotkey();
    if (!before.enabled && settings.enabled) currentGame = gameNameOf(getActivity()) || currentGame;
    const needsRestart = ['enabled', 'audio', 'source', 'displayId', 'quality', 'fps'].some((k) => before[k] !== settings[k]);
    if (needsRestart) { retries = 0; restart(); } else emit();
    return snapshot();
  }

  // Atividade detectada mudou (activityDetector): no modo "Jogo", começa/
  // para/troca a janela gravada.
  function onActivity(activity) {
    const game = gameNameOf(activity);
    const changed = (game || null) !== currentGame;
    currentGame = game || null;
    if (changed && settings.enabled && settings.source === 'game') restart();
  }

  function init() {
    currentGame = gameNameOf(getActivity()) || currentGame;
    if (powerMonitor) {
      // Tela bloqueada: para (não grava a tela de bloqueio nem gasta CPU).
      powerMonitor.on('lock-screen', () => { locked = true; restart(); });
      powerMonitor.on('unlock-screen', () => { locked = false; restart(); });
    }
    applyHotkey();
    if (settings.enabled) restart();
  }

  function shutdown() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (registeredHotkey) { try { globalShortcut.unregister(registeredHotkey); } catch { /* ok */ } registeredHotkey = null; }
    stopRecording();
  }

  return {
    init, shutdown, save, setSettings, onActivity,
    getState: snapshot, folder: clipsFolder,
    openFolder: async () => { const dir = clipsFolder(); await fsx.promises.mkdir(dir, { recursive: true }); return shell.openPath(dir); },
    _ring: ring,
  };
}

module.exports = { createClipsManager, SETTINGS_FILE };
