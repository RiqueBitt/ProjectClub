// Aviso de segurança do console: aparece na hora, de novo a cada 5 s, e
// nunca com mais de um intervalo.
//   node --test client/test/consoleWarning.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startConsoleWarning, CONSOLE_WARNING_TITLE, CONSOLE_WARNING_TEXT, CONSOLE_WARNING_INTERVAL_MS } from '../src/utils/consoleWarning.js';

// Janela de mentira com relógio controlado.
function fakeWindow(userAgent = 'Mozilla/5.0 (Windows NT 10.0) Chrome/158') {
  const timers = new Map();
  let seq = 0;
  const win = {
    navigator: { userAgent },
    setInterval(fn, ms) { seq += 1; timers.set(seq, { fn, ms }); return seq; },
    clearInterval(id) { timers.delete(id); },
  };
  return { win, timers, tick: () => { for (const t of [...timers.values()]) t.fn(); } };
}
const logger = () => { const lines = []; return { lines, log: (...a) => lines.push(a) }; };
const titles = (out) => out.lines.filter((l) => String(l[0]).includes(CONSOLE_WARNING_TITLE)).length;

test('aparece assim que a página abre, com título grande e vermelho e o texto de apoio', () => {
  const { win } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  assert.equal(out.lines.length, 2);
  assert.equal(out.lines[0][0], `%c${CONSOLE_WARNING_TITLE}`);
  assert.match(out.lines[0][1], /color:#ff1a1a/);
  assert.match(out.lines[0][1], /font-size:56px/);
  assert.match(out.lines[0][1], /font-weight:900/);
  assert.equal(out.lines[1][0], `%c${CONSOLE_WARNING_TEXT}`);
  assert.match(out.lines[1][1], /font-size:15px/);
});

test('reaparece a cada 5 segundos', () => {
  const { win, timers, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  assert.equal(CONSOLE_WARNING_INTERVAL_MS, 5000);
  assert.deepEqual([...timers.values()].map((t) => t.ms), [5000]);
  tick(); tick(); tick();
  assert.equal(titles(out), 4);
});

test('ligar de novo (troca de página, recarga a quente) não cria outro intervalo', () => {
  const { win, timers, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  startConsoleWarning({ win, out });
  startConsoleWarning({ win, out });
  assert.equal(timers.size, 1);
  assert.equal(titles(out), 1);
  tick();
  assert.equal(titles(out), 2);
});

test('desligar limpa o intervalo e permite ligar de novo', () => {
  const { win, timers } = fakeWindow();
  const out = logger();
  const stop = startConsoleWarning({ win, out });
  stop();
  assert.equal(timers.size, 0);
  startConsoleWarning({ win, out });
  assert.equal(timers.size, 1);
});

test('dentro do app Android (WebView) não escreve nada', () => {
  const { win, timers } = fakeWindow('Mozilla/5.0 (Linux; Android 16; SM-A075M Build/X; wv) AppleWebKit/537.36');
  const out = logger();
  startConsoleWarning({ win, out });
  assert.equal(out.lines.length, 0);
  assert.equal(timers.size, 0);
});

test('console quebrado não derruba a página', () => {
  const { win } = fakeWindow();
  assert.doesNotThrow(() => startConsoleWarning({ win, out: { log() { throw new Error('sem console'); } } }));
});
