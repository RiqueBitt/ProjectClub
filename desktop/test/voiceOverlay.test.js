// Sobreposição de voz (voiceOverlay.js): só aparece com a opção ligada e um
// jogo aberto; some ao sair da call ou ao fechar o jogo.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const vo = require('../voiceOverlay');

function fakeElectron() {
  const wins = [];
  class BrowserWindow {
    constructor(opts) { this.opts = opts; this.destroyed = false; this.shown = false; this.js = []; this.handlers = {}; wins.push(this);
      this.webContents = { executeJavaScript: async (code) => { this.js.push(code); } }; }
    setAlwaysOnTop() {} setIgnoreMouseEvents(v) { this.ignore = v; }
    loadFile() { return Promise.resolve(); } showInactive() { this.shown = true; }
    isDestroyed() { return this.destroyed; } close() { this.destroyed = true; this.handlers.closed?.(); }
    on(ev, fn) { this.handlers[ev] = fn; }
  }
  return { wins, BrowserWindow, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }, app: { getPath: () => os.tmpdir() } };
}
const tick = () => new Promise((r) => setImmediate(r));

test('limpa o que vem do site (nomes longos, campos estranhos, no máximo 10)', () => {
  const s = vo._test.sanitize({ channelName: 'x'.repeat(100), people: Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, speaking: i === 0, extra: 'lixo' })) });
  assert.equal(s.channelName.length, 60);
  assert.equal(s.people.length, 10);
  assert.deepEqual(Object.keys(s.people[0]).sort(), ['deafened', 'muted', 'name', 'speaking']);
  assert.equal(vo._test.sanitize(null), null);
  assert.match(vo._test.HTML, /esc\(/); // nomes passam pelo escape no HTML
});

test('mostra só com a opção ligada e jogo aberto; some ao sair', async () => {
  const el = fakeElectron();
  let settings = { overlayEnabled: false };
  let activity = { type: 'game', name: 'Jogo' };
  vo.init({ ...el, getSettings: () => settings, getActivity: () => activity });
  const room = { channelName: 'Geral', people: [{ name: 'Ana', speaking: true }] };

  vo.update(room);
  assert.equal(el.wins.length, 0); // opção desligada

  settings = { overlayEnabled: true };
  vo.update(room);
  await tick();
  assert.equal(el.wins.length, 1);
  const w = el.wins[0];
  assert.equal(w.ignore, true); // não pega clique do jogo
  assert.equal(w.opts.focusable, false);
  assert.equal(w.shown, true);
  assert.match(w.js.at(-1), /"Ana"/);

  activity = { type: 'app', name: 'Bloco de notas' };
  vo.update(room);
  assert.equal(w.destroyed, true); // sem jogo, some

  activity = { type: 'game', name: 'Jogo' };
  vo.update(room);
  await tick();
  vo.update(null); // saiu da call
  assert.equal(el.wins.at(-1).destroyed, true);
  vo.destroy();
});
