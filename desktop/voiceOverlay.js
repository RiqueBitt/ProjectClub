// Sobreposição de voz por cima do jogo (item "Sobreposição de voz no PC"):
// lista de quem está na call, com destaque em quem está falando.
//
// Mesmas regras da sobreposição de notificações (main.js →
// showOverlayNotification): só aparece com "Sobreposição no jogo" ligada E um
// jogo de verdade aberto; janela transparente, sempre no topo, que não rouba
// foco nem clique. O site manda o retrato da sala (VoiceContext.jsx →
// window.electronAPI.voiceOverlay); null = saiu da call.
const fs = require('fs');
const path = require('path');

const ROW_H = 30;
const MAX_ROWS = 10;
const WIDTH = 230;

let deps = null;     // { BrowserWindow, screen, app, getSettings, getActivity }
let win = null;
let ready = false;
let htmlPath = null;
let last = null;
let checkTimer = null;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .box { display: inline-flex; flex-direction: column; gap: 2px; padding: 6px; border-radius: 10px; background: rgba(20, 21, 24, .55); }
  .ch { font-size: 10px; font-weight: 700; color: #b5bac1; padding: 0 4px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 214px; text-transform: uppercase; letter-spacing: .04em; }
  .p { display: flex; align-items: center; gap: 7px; height: ${ROW_H - 2}px; padding: 0 6px 0 2px; border-radius: 14px; color: #f2f3f5; font-size: 13px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
  .av { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; background: #4e5058; color: #fff; flex: none; box-shadow: 0 0 0 2px transparent; transition: box-shadow .08s; }
  .p.on .av { box-shadow: 0 0 0 2px #23a55a; }
  .p.on { background: rgba(35, 165, 90, .18); }
  .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
  .ic { font-size: 11px; opacity: .85; }
</style></head><body><div class="box" id="b"></div><script>
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ini = (n) => esc(String(n || '?').trim().slice(0, 1).toUpperCase());
  window.__render = (d) => {
    const b = document.getElementById('b');
    if (!d) { b.innerHTML = ''; return; }
    b.innerHTML = '<div class="ch">' + esc(d.channelName) + '</div>' + d.people.map((p) =>
      '<div class="p' + (p.speaking ? ' on' : '') + '"><span class="av">' + ini(p.name) + '</span><span class="n">' + esc(p.name) + '</span>'
      + (p.deafened ? '<span class="ic">🔇</span>' : p.muted ? '<span class="ic">🎙️✕</span>' : '') + '</div>').join('');
  };
</script></body></html>`;

function sanitize(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.people)) return null;
  return {
    channelName: String(payload.channelName || 'Chamada').slice(0, 60),
    people: payload.people.slice(0, MAX_ROWS).map((p) => ({
      name: String(p?.name || 'Alguém').slice(0, 40), speaking: !!p?.speaking, muted: !!p?.muted, deafened: !!p?.deafened,
    })),
  };
}

function shouldShow() {
  if (!deps || !last) return false;
  const s = deps.getSettings() || {};
  const act = deps.getActivity();
  return !!s.overlayEnabled && !!act && act.type === 'game';
}

function destroy() {
  ready = false;
  if (win && !win.isDestroyed()) win.close();
  win = null;
  if (htmlPath) { fs.unlink(htmlPath, () => {}); htmlPath = null; }
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return;
  const { BrowserWindow, screen, app } = deps;
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: WIDTH, height: ROW_H * (MAX_ROWS + 1) + 16, x: area.x + 16, y: area.y + 16,
    resizable: false, minimizable: false, maximizable: false, focusable: false, frame: false,
    transparent: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  htmlPath = path.join(app.getPath('temp'), 'project-club-voice-overlay.html');
  fs.writeFileSync(htmlPath, HTML, 'utf-8');
  win.loadFile(htmlPath).then(() => { ready = true; render(); if (win && !win.isDestroyed()) win.showInactive(); }).catch(() => destroy());
  win.on('closed', () => { win = null; ready = false; });
}

function render() {
  if (!win || win.isDestroyed() || !ready) return;
  win.webContents.executeJavaScript(`window.__render(${JSON.stringify(last)})`).catch(() => {});
}

function refresh() {
  if (!shouldShow()) { destroy(); return; }
  ensureWindow();
  render();
}

function update(payload) {
  last = sanitize(payload);
  refresh();
}

function init(d) {
  deps = d;
  if (!checkTimer) {
    // O jogo pode abrir/fechar sem a sala mudar: confere de tempos em tempos.
    checkTimer = setInterval(refresh, 3000);
    checkTimer.unref?.();
  }
}

module.exports = { init, update, destroy, _test: { sanitize, shouldShow: () => shouldShow(), HTML } };
