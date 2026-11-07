// Guarda de conexão do app de computador: só abre a tela "Project Club ·
// Conexão" quando internet/servidor estão mesmo fora; falso alarme vira
// recarga silenciosa (com limite); quando o servidor volta, fecha a tela e
// reabre o Project Club. Electron simulado (roda com `node --test`).
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

let online = true; let serverUp = true; const windows = [];
class FakeWin extends EventEmitter {
  constructor(opts) { super(); this.opts = opts || {}; this.visible = false; this.destroyed = false; this.loaded = []; this.webContents = Object.assign(new EventEmitter(), { url: '', getURL: () => this.webContents.url, send: () => {}, setWindowOpenHandler: () => {} }); windows.push(this); }
  show() { this.visible = true; } hide() { this.visible = false; } focus() {} minimize() {}
  isVisible() { return this.visible; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; this.emit('closed'); }
  getBounds() { return { x: 0, y: 0, width: 1200, height: 800 }; } loadURL(u) { this.loaded.push(u); } loadFile(f) { this.loaded.push(f); }
  once(ev, fn) { if (ev === 'ready-to-show') fn(); else super.once(ev, fn); } removeMenu() {}
}
const handlers = {};
const electron = {
  BrowserWindow: FakeWin,
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } },
  net: { isOnline: () => online, fetch: async () => { if (!serverUp) throw new Error('down'); return { status: 200 }; } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? electron : origLoad.call(this, req, ...rest); };
const { createConnectionGuard } = require('../connectionWindow');

const APP = 'https://projectclub.shardweb.app';
let guard; let main;
beforeEach(() => {
  online = true; serverUp = true; windows.length = 0;
  guard = createConnectionGuard({ appUrl: APP, isAppUrl: (u) => String(u).startsWith(APP), icon: 'x' });
  main = new FakeWin(); main.visible = true;
  guard.attach(main);
});
afterEach(() => guard.dispose());
const fail = () => main.webContents.emit('did-fail-load', {}, -106, 'ERR', `${APP}/`, true);
const flush = () => new Promise((r) => setTimeout(r, 5));

test('falso alarme (servidor respondendo): recarrega em silêncio, sem tela de conexão', async () => {
  fail(); await flush();
  assert.equal(guard.isActive(), false);
  assert.deepEqual(main.loaded, [APP]);
  assert.equal(windows.length, 1, 'nenhuma janela nova');
});

test('falha repetida com servidor ok: depois de 2 recargas por minuto, mostra a tela', async () => {
  for (let i = 0; i < 3; i++) { fail(); await flush(); }
  assert.equal(guard.isActive(), true);
  assert.equal(main.loaded.length, 2);
});

test('servidor fora: esconde o Project Club e abre a janela de conexão; volta sozinho', async () => {
  serverUp = false;
  fail(); await flush();
  assert.equal(guard.isActive(), true);
  assert.equal(main.isVisible(), false);
  const conn = windows[1];
  assert.ok(conn && conn.isVisible(), 'janela de conexão aberta');
  assert.match(conn.loaded[0], /conexao[\\/]index\.html$/);
  serverUp = true;
  await handlers['conexao:check']({ sender: conn.webContents });
  assert.equal(guard.isActive(), false);
  assert.equal(conn.isDestroyed(), true);
  assert.equal(main.isVisible(), true);
  assert.deepEqual(main.loaded, [APP]);
});

test('navegação cancelada (-3) e falhas de subframe não contam', async () => {
  main.webContents.emit('did-fail-load', {}, -3, 'ABORTED', `${APP}/`, true);
  main.webContents.emit('did-fail-load', {}, -106, 'ERR', 'https://youtube.com/embed', false);
  await flush();
  assert.equal(main.loaded.length, 0);
  assert.equal(guard.isActive(), false);
});

test('pedidos de outra janela são recusados', async () => {
  serverUp = false; fail(); await flush();
  await assert.rejects(() => handlers['conexao:check']({ sender: main.webContents }), /não autorizado/);
});
