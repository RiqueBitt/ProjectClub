// Aviso de segurança do console: aviso completo na hora (um bloco só), lembrete
// curto a cada 5 s (só com a aba à vista) e nunca com mais de um intervalo.
//   node --test client/test/consoleWarning.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startConsoleWarning, CONSOLE_WARNING_TITLE, CONSOLE_WARNING_TEXT, CONSOLE_WARNING_SCAM, CONSOLE_WARNING_SHORT, CONSOLE_WARNING_REPO,
  CONSOLE_WARNING_INTERVAL_MS,
} from '../src/utils/consoleWarning.js';

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

// Divide uma chamada do console em trechos: [{ text, style }].
function pieces(line) {
  const [format, ...styles] = line;
  const texts = String(format).split('%c');
  assert.equal(texts.length - 1, styles.length, 'um estilo pra cada %c');
  return texts.slice(1).map((text, i) => ({ text, style: styles[i] }));
}
const props = (style) => style.split(';').filter(Boolean).map((d) => d.slice(0, d.indexOf(':')).trim());

test('aparece assim que a página abre, num bloco só: selo, título grande e vermelho, texto e aviso de golpe', () => {
  const { win } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  assert.equal(out.lines.length, 1, 'uma mensagem só: sem risco entre as partes nem um link de arquivo em cada linha');
  const parts = pieces(out.lines[0]);
  const blocks = parts.filter((p) => p.style);
  assert.match(blocks[0].text, /PROJECT CLUB/);
  assert.match(blocks[1].text, /Aviso de segurança/);
  const title = blocks.find((p) => p.text === CONSOLE_WARNING_TITLE);
  assert.match(title.style, /color:#F23F43/);
  assert.match(title.style, /font-size:4\dpx/);
  assert.match(title.style, /font-weight:900/);
  const text = blocks.find((p) => p.text === CONSOLE_WARNING_TEXT);
  assert.match(text.style, /font-size:14px/);
  assert.ok(blocks.some((p) => p.text.includes(CONSOLE_WARNING_SCAM)));
  assert.ok(blocks.at(-1).text.includes(CONSOLE_WARNING_REPO), 'o endereço completo vira link sozinho no console');
});

// O defeito que isto segura: no Firefox o trecho estilizado fica "em linha" e, com padding e
// texto em mais de uma linha, o fundo de uma linha cobria a de cima (texto cortado).
test('todo trecho com estilo é uma caixinha (display:inline-block), no aviso e no lembrete', () => {
  const { win, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  tick();
  assert.equal(out.lines.length, 2);
  for (const line of out.lines) {
    for (const { text, style } of pieces(line)) {
      if (style === '') { assert.equal(text, '\n', 'trecho sem estilo só serve de quebra de linha'); continue; }
      assert.ok(style.startsWith('display:inline-block;'), `sem caixinha: "${text.slice(0, 30)}"`);
      assert.match(style, /line-height:/, `sem altura de linha: "${text.slice(0, 30)}"`);
    }
  }
});

test('os blocos do aviso ficam um embaixo do outro (quebra de linha entre eles)', () => {
  const { win } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  const parts = pieces(out.lines[0]);
  assert.equal(parts.filter((p) => p.style === '' && p.text === '\n').length, 4);
  assert.ok(!parts.some((p) => p.style && p.text.includes('\n')), 'quebra de linha dentro de um bloco desmonta o desenho no Chrome');
});

// O Chrome só aceita estas propriedades no %c (o resto ele joga fora em silêncio); o Firefox
// aceita todas elas e mais o display.
test('só usa CSS que o console do Chrome e o do Firefox aceitam', () => {
  const { win, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  tick();
  const allowed = /^(display|background|border|color|font|line|margin|padding|text)/;
  for (const line of out.lines) {
    for (const { style } of pieces(line)) {
      for (const name of props(style)) assert.match(name, allowed, `propriedade que não funciona no console: ${name}`);
      assert.doesNotMatch(style, /url\(|expression|javascript:/i);
    }
  }
});

test('o lembrete dos 5 s é curto (uma linha só)', () => {
  const { win, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  const before = out.lines.length;
  tick();
  assert.equal(out.lines.length, before + 1);
  const reminder = pieces(out.lines.at(-1));
  assert.deepEqual(reminder.map((p) => p.text), [CONSOLE_WARNING_TITLE, CONSOLE_WARNING_SHORT]);
  assert.ok(CONSOLE_WARNING_SHORT.length <= 80);
  assert.ok(!out.lines.at(-1)[0].includes('\n'));
});

test('o lembrete é sempre igual, pra o navegador agrupar as repetições em vez de encher o console', () => {
  const { win, tick } = fakeWindow();
  const out = logger();
  startConsoleWarning({ win, out });
  tick(); tick(); tick();
  assert.deepEqual(out.lines[1], out.lines[2]);
  assert.deepEqual(out.lines[2], out.lines[3]);
});

test('com a aba escondida o lembrete não é escrito', () => {
  const { win, tick } = fakeWindow();
  win.document = { hidden: true };
  const out = logger();
  startConsoleWarning({ win, out });
  const before = out.lines.length;
  tick(); tick();
  assert.equal(out.lines.length, before);
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
