// Clipes: orquestração com Electron falso — desligado não cria nada; ligado
// registra o atalho, grava a fonte certa, só aceita pedaços da janela do
// gravador, salva o .webm na pasta de vídeos e respeita o áudio permitido.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createClipsManager } = require('../clipsManager');

const tick = () => new Promise((r) => setTimeout(r, 15));
const UNKNOWN = Buffer.from([0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
// WebM mínimo válido: cabeçalho + 3 clusters de 1 s (vídeo na faixa 1).
function webm() {
  const el = (idHex, payload) => Buffer.concat([Buffer.from(idHex, 'hex'), Buffer.from([0x80 | payload.length]), payload]);
  const head = Buffer.concat([
    el('1a45dfa3', el('4282', Buffer.from('webm'))),
    Buffer.from('18538067', 'hex'), UNKNOWN,
    el('1654ae6b', el('ae', Buffer.concat([el('d7', Buffer.from([1])), el('83', Buffer.from([1]))]))),
  ]);
  const cl = (tc, key) => Buffer.concat([Buffer.from('1f43b675', 'hex'), UNKNOWN, el('e7', Buffer.from([tc >> 8, tc & 0xFF])),
    el('a3', Buffer.from([0x81, 0x00, 0x00, key ? 0x80 : 0x00, 0x11])), el('a3', Buffer.from([0x81, 0x01, 0xF4, 0x00, 0x22]))]);
  return Buffer.concat([head, cl(0, true), cl(1000, false), cl(2000, true)]);
}

function fakes({ registerOk = true, audio = null, sources } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-clips-'));
  const ipcMain = new EventEmitter();
  const windows = [];
  const notifications = [];
  const shortcuts = new Map();
  let displayHandler = null;
  class FakeWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.destroyed = false;
      this.scripts = [];
      const self = this;
      this.webContents = Object.assign(new EventEmitter(), {
        setWindowOpenHandler() {},
        executeJavaScript(code, gesture) { self.scripts.push({ code, gesture }); return Promise.resolve(); },
      });
      windows.push(this);
    }
    loadFile() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const fakeSession = {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    setDisplayMediaRequestHandler(fn) { displayHandler = fn; },
  };
  const deps = {
    app: { getPath: (k) => path.join(base, k) },
    BrowserWindow: FakeWindow,
    session: { fromPartition: () => fakeSession },
    desktopCapturer: { getSources: async () => sources || [{ id: 'screen:0:0', display_id: '1', name: 'Tela' }, { id: 'window:7:0', name: 'Lethal Company' }] },
    globalShortcut: {
      register: (acc, cb) => { if (!registerOk) return false; shortcuts.set(acc, cb); return true; },
      unregister: (acc) => shortcuts.delete(acc),
    },
    Notification: class { constructor(o) { this.o = o; } static isSupported() { return true; } on() {} show() { notifications.push(this.o); } },
    shell: { showItemInFolder() {}, openPath: async () => '' },
    ipcMain,
    platformAudio: () => audio,
    now: () => new Date(2026, 10, 2, 20, 15, 0),
  };
  const sent = (win, channel, payload) => ipcMain.emit(channel, { sender: win.webContents }, payload);
  const pick = (request = { audioRequested: true }) => new Promise((resolve) => displayHandler(request, resolve));
  return { base, deps, windows, notifications, shortcuts, sent, pick, ipcMain };
}

test('desligado por padrão: sem janela, sem atalho, sem gravar', async () => {
  const f = fakes();
  const m = createClipsManager(f.deps);
  m.init();
  await tick();
  assert.equal(f.windows.length, 0);
  assert.equal(f.shortcuts.size, 0);
  const st = m.getState();
  assert.equal(st.settings.enabled, false);
  assert.equal(st.recording, false);
  assert.deepEqual(await m.save(), { saved: false, reason: 'disabled' });
});

test('ligado: atalho Alt+F10, janela escondida e gravação da tela escolhida sem som', async () => {
  const f = fakes({ audio: null });
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true, audio: true });
  await tick();
  assert.ok(f.shortcuts.has('Alt+F10'));
  assert.equal(f.windows.length, 1);
  const w = f.windows[0];
  assert.equal(w.opts.show, false);
  assert.equal(w.opts.webPreferences.sandbox, true);
  f.sent(w, 'clips:recorder-state', { ready: true });
  const start = w.scripts.find((s) => s.code.includes('clipRecorder.start'));
  assert.ok(start && start.gesture === true);
  assert.match(start.code, /"audio":false/, 'sem captura que exclua a call = sem som');
  assert.deepEqual(await f.pick(), { video: { id: 'screen:0:0', display_id: '1', name: 'Tela' } });
  f.sent(w, 'clips:recorder-state', { recording: true, mimeType: 'video/webm;codecs=vp9' });
  assert.equal(m.getState().recording, true);
  m.shutdown();
});

test('som do PC só com a captura que exclui o próprio app', async () => {
  const f = fakes({ audio: 'loopbackWithoutChrome' });
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true, audio: true });
  await tick();
  f.sent(f.windows[0], 'clips:recorder-state', { ready: true });
  assert.match(f.windows[0].scripts[0].code, /"audio":true/);
  assert.equal((await f.pick()).audio, 'loopbackWithoutChrome');
  m.setSettings({ audio: false });
  await tick();
  const w2 = f.windows[f.windows.length - 1];
  f.sent(w2, 'clips:recorder-state', { ready: true });
  assert.equal((await f.pick()).audio, undefined);
  m.shutdown();
});

test('só aceita pedaços da janela do gravador; atalho salva o .webm em Vídeos/Project Club Clipes', async () => {
  const f = fakes();
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true });
  await tick();
  const w = f.windows[0];
  const data = webm();
  // Pedaço vindo de outra página: ignorado.
  f.ipcMain.emit('clips:chunk', { sender: {} }, data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  assert.equal(m._ring.headerReady, false);
  f.sent(w, 'clips:chunk', data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  assert.equal(m._ring.headerReady, true);
  f.shortcuts.get('Alt+F10')();
  await tick();
  const dir = path.join(f.base, 'videos', 'Project Club Clipes');
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['Clipe 2026-11-02 20-15-00.webm']);
  assert.equal(fs.readFileSync(path.join(dir, files[0])).subarray(0, 4).toString('hex'), '1a45dfa3');
  assert.equal(f.notifications.at(-1).title, 'Clipe salvo');
  assert.equal(m.getState().lastSaved.name, files[0]);
  m.shutdown();
});

test('salvar sem vídeo ainda: avisa e não cria arquivo', async () => {
  const f = fakes();
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true });
  await tick();
  assert.deepEqual(await m.save(), { saved: false, reason: 'empty' });
  assert.equal(f.notifications.at(-1).title, 'Clipe ainda não disponível');
  m.shutdown();
});

test('modo Jogo: espera um jogo, grava a janela dele e para quando ele fecha', async () => {
  const f = fakes();
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true, source: 'game' });
  await tick();
  assert.equal(f.windows.length, 0);
  assert.equal(m.getState().waitingGame, true);
  m.onActivity({ type: 'game', name: 'Lethal Company' });
  await tick();
  const w = f.windows.at(-1);
  assert.ok(w && !w.isDestroyed());
  f.sent(w, 'clips:recorder-state', { ready: true });
  assert.equal((await f.pick({ audioRequested: false })).video.id, 'window:7:0');
  m.onActivity(null);
  await tick();
  assert.ok(f.windows.every((x) => x.isDestroyed()));
  assert.equal(m.getState().waitingGame, true);
  m.shutdown();
});

test('atalho ocupado por outro programa: avisa (hotkeyOk = false); desligar libera tudo', async () => {
  const f = fakes({ registerOk: false });
  const m = createClipsManager(f.deps);
  m.init();
  m.setSettings({ enabled: true, hotkey: 'ctrl+shift+f9' });
  await tick();
  assert.equal(m.getState().hotkeyOk, false);
  assert.equal(m.getState().settings.hotkey, 'CommandOrControl+Shift+F9');
  m.setSettings({ enabled: false });
  await tick();
  assert.ok(f.windows.every((x) => x.isDestroyed()));
  assert.equal(m.getState().recording, false);
  // Configuração gravada em disco.
  const saved = JSON.parse(fs.readFileSync(path.join(f.base, 'userData', 'clips.json'), 'utf8'));
  assert.equal(saved.enabled, false);
  assert.equal(saved.hotkey, 'CommandOrControl+Shift+F9');
});
