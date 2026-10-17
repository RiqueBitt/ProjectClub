// Apertar-pra-falar GLOBAL (com o app fora de foco) — igual ao Discord.
//
// O site guarda a tecla como `KeyboardEvent.code` ('Space', 'KeyF',
// 'Digit1', 'F13', 'ControlLeft'…). Aqui ela vira o keycode do libuiohook
// (uiohook-napi, MIT — prebuilds N-API pra Windows/macOS/Linux, sem
// recompilar pro Electron) e o processo principal manda `ptt:down` /
// `ptt:up` pra janela.
//
// Regras:
//  - O gancho de teclado só roda enquanto o site pede (chamada ativa + PTT
//    ligado — `ptt:configure`); fora disso é parado (uIOhook.stop()).
//  - Só a tecla configurada sai do processo principal; nenhuma outra tecla
//    é repassada (não é um keylogger).
//  - Com a janela EM FOCO o próprio site trata keydown/keyup (o `ptt:down`
//    global é ignorado); o `ptt:up` sempre sai se o down foi global.
//  - uiohook-napi é carregado sob demanda com try/catch: faltando o binário
//    ou sem permissão, o PTT continua funcionando só com o app em foco.
//  - macOS: precisa de permissão de Acessibilidade. Sem ela não liga o
//    gancho (evita o prompt em loop) e devolve { ok:false, reason:'accessibility' };
//    `prompt:true` abre o pedido do sistema uma vez.

// KeyboardEvent.code → nome do UiohookKey.
const SPECIAL = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Escape: 'Escape', CapsLock: 'CapsLock',
  PageUp: 'PageUp', PageDown: 'PageDown', End: 'End', Home: 'Home', Insert: 'Insert', Delete: 'Delete',
  ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowRight: 'ArrowRight', ArrowDown: 'ArrowDown',
  Semicolon: 'Semicolon', Equal: 'Equal', Comma: 'Comma', Minus: 'Minus', Period: 'Period', Slash: 'Slash',
  Backquote: 'Backquote', BracketLeft: 'BracketLeft', Backslash: 'Backslash', BracketRight: 'BracketRight', Quote: 'Quote',
  ControlLeft: 'Ctrl', ControlRight: 'CtrlRight', AltLeft: 'Alt', AltRight: 'AltRight',
  ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', MetaLeft: 'Meta', MetaRight: 'MetaRight',
  NumLock: 'NumLock', ScrollLock: 'ScrollLock', PrintScreen: 'PrintScreen',
  NumpadMultiply: 'NumpadMultiply', NumpadAdd: 'NumpadAdd', NumpadSubtract: 'NumpadSubtract',
  NumpadDecimal: 'NumpadDecimal', NumpadDivide: 'NumpadDivide', NumpadEnter: 'NumpadEnter',
};

// Tabela do uiohook-napi 1.5.x (dist/index.js → UiohookKey) — copiada pra
// não precisar carregar o binário só pra traduzir a tecla.
const UIOHOOK_KEYS = Object.freeze({
  0: 11, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10,
  Backspace: 14, Tab: 15, Enter: 28, CapsLock: 58, Escape: 1, Space: 57,
  PageUp: 3657, PageDown: 3665, End: 3663, Home: 3655,
  ArrowLeft: 57419, ArrowUp: 57416, ArrowRight: 57421, ArrowDown: 57424, Insert: 3666, Delete: 3667,
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38, M: 50,
  N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45, Y: 21, Z: 44,
  Numpad0: 82, Numpad1: 79, Numpad2: 80, Numpad3: 81, Numpad4: 75, Numpad5: 76, Numpad6: 77, Numpad7: 71, Numpad8: 72, Numpad9: 73,
  NumpadMultiply: 55, NumpadAdd: 78, NumpadSubtract: 74, NumpadDecimal: 83, NumpadDivide: 3637, NumpadEnter: 3612,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  F13: 91, F14: 92, F15: 93, F16: 99, F17: 100, F18: 101, F19: 102, F20: 103, F21: 104, F22: 105, F23: 106, F24: 107,
  Semicolon: 39, Equal: 13, Comma: 51, Minus: 12, Period: 52, Slash: 53, Backquote: 41,
  BracketLeft: 26, Backslash: 43, BracketRight: 27, Quote: 40,
  Ctrl: 29, CtrlRight: 3613, Alt: 56, AltRight: 3640, Shift: 42, ShiftRight: 54, Meta: 3675, MetaRight: 3676,
  NumLock: 69, ScrollLock: 70, PrintScreen: 3639,
});

function uiohookNameFor(code) {
  if (typeof code !== 'string' || !code) return null;
  if (SPECIAL[code]) return SPECIAL[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad([0-9])$/.exec(code);
  if (m) return code;
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (m) return code;
  return null;
}

// KeyboardEvent.code → keycode do uiohook (ou null se não suportada).
function keycodeFor(code, table = UIOHOOK_KEYS) {
  const name = uiohookNameFor(code);
  if (!name) return null;
  const v = table[name];
  return Number.isInteger(v) ? v : null;
}

function defaultLoadHook() {
  // eslint-disable-next-line global-require
  const mod = require('uiohook-napi');
  return mod && mod.uIOhook ? mod : null;
}

// deps: { loadHook, send(channel), isFocused(), platform, systemPreferences, log }
function createGlobalPtt(deps = {}) {
  const loadHook = deps.loadHook || defaultLoadHook;
  const send = deps.send || (() => {});
  const isFocused = deps.isFocused || (() => false);
  const platform = deps.platform || process.platform;
  const log = deps.log || ((...a) => console.warn('[ptt global]', ...a));
  let mod = null;
  let loadFailed = false;
  let running = false;
  let keycode = null;
  let down = false; // down enviado pelo gancho global (espera o up)

  const onKeyDown = (e) => {
    if (keycode == null || !e || e.keycode !== keycode) return;
    if (down) return; // repetição automática do teclado
    if (isFocused()) return; // em foco: o site trata
    down = true;
    send('ptt:down');
  };
  const onKeyUp = (e) => {
    if (keycode == null || !e || e.keycode !== keycode) return;
    if (!down) return;
    down = false;
    send('ptt:up');
  };

  function load() {
    if (mod || loadFailed) return mod;
    try { mod = loadHook(); } catch (err) { log('uiohook-napi indisponível:', err?.message || err); mod = null; }
    if (!mod) loadFailed = true;
    return mod;
  }

  function stop() {
    if (down) { down = false; send('ptt:up'); }
    if (!running || !mod) { running = false; return; }
    try {
      mod.uIOhook.off?.('keydown', onKeyDown);
      mod.uIOhook.off?.('keyup', onKeyUp);
      mod.uIOhook.stop();
    } catch (err) { log('falha ao parar o gancho:', err?.message || err); }
    running = false;
  }

  // Liga/desliga. Devolve { ok, reason? } — reason: 'unsupported-key' |
  // 'accessibility' | 'unavailable' | 'error'.
  function configure({ enabled, code, prompt = false } = {}) {
    if (!enabled) { stop(); keycode = null; return { ok: true, active: false }; }
    const kc = keycodeFor(code);
    if (kc == null) { stop(); keycode = null; return { ok: false, reason: 'unsupported-key' }; }
    if (platform === 'darwin' && deps.systemPreferences?.isTrustedAccessibilityClient) {
      let trusted = false;
      try { trusted = !!deps.systemPreferences.isTrustedAccessibilityClient(!!prompt); } catch { trusted = false; }
      if (!trusted) { stop(); return { ok: false, reason: 'accessibility' }; }
    }
    if (kc !== keycode && down) { down = false; send('ptt:up'); }
    keycode = kc;
    if (running) return { ok: true, active: true };
    if (!load()) return { ok: false, reason: 'unavailable' };
    try {
      mod.uIOhook.on('keydown', onKeyDown);
      mod.uIOhook.on('keyup', onKeyUp);
      mod.uIOhook.start();
      running = true;
      return { ok: true, active: true };
    } catch (err) {
      log('falha ao ligar o gancho:', err?.message || err);
      try { mod.uIOhook.off?.('keydown', onKeyDown); mod.uIOhook.off?.('keyup', onKeyUp); } catch { /* ok */ }
      return { ok: false, reason: 'error' };
    }
  }

  return {
    configure,
    stop,
    isRunning: () => running,
    // O gancho vê o keyup mesmo com a janela em foco, então um down global
    // nunca fica preso se a pessoa voltar pro app segurando a tecla.
    _handlers: { onKeyDown, onKeyUp },
  };
}

module.exports = { keycodeFor, uiohookNameFor, createGlobalPtt, UIOHOOK_KEYS };
