// Apertar-pra-falar global: tradução da tecla (KeyboardEvent.code →
// keycode do uiohook) e o mapeamento pros eventos IPC ptt:down/ptt:up.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keycodeFor, createGlobalPtt } = require('../globalPtt');

test('keycodeFor: teclas comuns do PTT', () => {
  assert.equal(keycodeFor('Space'), 57);
  assert.equal(keycodeFor('KeyF'), 33);
  assert.equal(keycodeFor('KeyV'), 47);
  assert.equal(keycodeFor('Digit1'), 2);
  assert.equal(keycodeFor('Digit0'), 11);
  assert.equal(keycodeFor('F13'), 91);
  assert.equal(keycodeFor('F24'), 107);
  assert.equal(keycodeFor('Backquote'), 41);
  assert.equal(keycodeFor('ControlLeft'), 29);
  assert.equal(keycodeFor('AltRight'), 3640);
  assert.equal(keycodeFor('CapsLock'), 58);
  assert.equal(keycodeFor('Numpad5'), 76);
  assert.equal(keycodeFor('NumpadEnter'), 3612);
});

test('keycodeFor: desconhecida/inválida → null', () => {
  assert.equal(keycodeFor('IntlBackslash'), null);
  assert.equal(keycodeFor('F25'), null);
  assert.equal(keycodeFor(''), null);
  assert.equal(keycodeFor(undefined), null);
  assert.equal(keycodeFor('Keyf'), null);
});

function fakeHook() {
  const handlers = {};
  const calls = [];
  return {
    calls,
    handlers,
    mod: {
      uIOhook: {
        on: (ev, fn) => { handlers[ev] = fn; },
        off: (ev, fn) => { if (handlers[ev] === fn) delete handlers[ev]; },
        start: () => calls.push('start'),
        stop: () => calls.push('stop'),
      },
    },
  };
}

function setup({ focused = false, platform = 'win32', systemPreferences } = {}) {
  const hook = fakeHook();
  const sent = [];
  let focus = focused;
  const ptt = createGlobalPtt({
    loadHook: () => hook.mod, send: (ch) => sent.push(ch), isFocused: () => focus, platform, systemPreferences, log: () => {},
  });
  return { hook, sent, ptt, setFocus: (v) => { focus = v; } };
}

test('só a tecla configurada vira ptt:down/ptt:up; repetição ignorada', () => {
  const { hook, sent, ptt } = setup();
  assert.deepEqual(ptt.configure({ enabled: true, code: 'KeyF' }), { ok: true, active: true });
  assert.deepEqual(hook.calls, ['start']);
  hook.handlers.keydown({ keycode: 30 }); // A
  hook.handlers.keydown({ keycode: 33 });
  hook.handlers.keydown({ keycode: 33 }); // auto-repeat
  hook.handlers.keyup({ keycode: 30 });
  hook.handlers.keyup({ keycode: 33 });
  hook.handlers.keyup({ keycode: 33 });
  assert.deepEqual(sent, ['ptt:down', 'ptt:up']);
});

test('janela em foco: o site trata (sem ptt:down global)', () => {
  const { hook, sent, ptt, setFocus } = setup({ focused: true });
  ptt.configure({ enabled: true, code: 'Space' });
  hook.handlers.keydown({ keycode: 57 });
  hook.handlers.keyup({ keycode: 57 });
  assert.deepEqual(sent, []);
  // Down fora de foco, up depois de voltar pro app: o up sai mesmo assim.
  setFocus(false);
  hook.handlers.keydown({ keycode: 57 });
  setFocus(true);
  hook.handlers.keyup({ keycode: 57 });
  assert.deepEqual(sent, ['ptt:down', 'ptt:up']);
});

test('desligar para o gancho e solta a tecla presa', () => {
  const { hook, sent, ptt } = setup();
  ptt.configure({ enabled: true, code: 'Space' });
  hook.handlers.keydown({ keycode: 57 });
  assert.deepEqual(ptt.configure({ enabled: false }), { ok: true, active: false });
  assert.deepEqual(sent, ['ptt:down', 'ptt:up']);
  assert.deepEqual(hook.calls, ['start', 'stop']);
  assert.equal(ptt.isRunning(), false);
});

test('trocar a tecla com o gancho rodando não reinicia', () => {
  const { hook, sent, ptt } = setup();
  ptt.configure({ enabled: true, code: 'Space' });
  ptt.configure({ enabled: true, code: 'KeyV' });
  assert.deepEqual(hook.calls, ['start']);
  hook.handlers.keydown({ keycode: 57 });
  hook.handlers.keydown({ keycode: 47 });
  assert.deepEqual(sent, ['ptt:down']);
});

test('tecla sem suporte, binário ausente e macOS sem Acessibilidade', () => {
  assert.deepEqual(setup().ptt.configure({ enabled: true, code: 'IntlRo' }), { ok: false, reason: 'unsupported-key' });
  const broken = createGlobalPtt({ loadHook: () => { throw new Error('sem binário'); }, log: () => {} });
  assert.deepEqual(broken.configure({ enabled: true, code: 'Space' }), { ok: false, reason: 'unavailable' });
  let prompted = null;
  const mac = setup({ platform: 'darwin', systemPreferences: { isTrustedAccessibilityClient: (p) => { prompted = p; return false; } } });
  assert.deepEqual(mac.ptt.configure({ enabled: true, code: 'Space', prompt: true }), { ok: false, reason: 'accessibility' });
  assert.equal(prompted, true);
  assert.deepEqual(mac.hook.calls, []);
  const macOk = setup({ platform: 'darwin', systemPreferences: { isTrustedAccessibilityClient: () => true } });
  assert.equal(macOk.ptt.configure({ enabled: true, code: 'Space' }).ok, true);
});

test('erro ao iniciar o gancho não derruba', () => {
  const hook = fakeHook();
  hook.mod.uIOhook.start = () => { throw new Error('X11 ausente'); };
  const ptt = createGlobalPtt({ loadHook: () => hook.mod, log: () => {} });
  assert.deepEqual(ptt.configure({ enabled: true, code: 'Space' }), { ok: false, reason: 'error' });
  assert.equal(ptt.isRunning(), false);
});
