// Atalhos de teclado (sem conflito com os que já existiam), navegação de
// canais e posicionamento do balão do tour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcut, findFrom, stepIndex, SHORTCUT_GROUPS, keyLabel, codeLabel, isEditableTarget } from '../src/components/conforto/shortcuts.js';
import { placePopover, TOUR_STEPS } from '../src/components/conforto/tourSteps.js';

const ev = (key, mods = {}, target = { tagName: 'DIV' }) => ({ key, code: mods.code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...mods });
const input = { tagName: 'TEXTAREA' };

test('atalhos novos: Ctrl+/ e ? abrem a lista; ? não vale digitando', () => {
  assert.equal(matchShortcut(ev('/', { ctrlKey: true }), { mac: false }), 'shortcuts');
  assert.equal(matchShortcut(ev('/', { metaKey: true }), { mac: true }), 'shortcuts');
  assert.equal(matchShortcut(ev('?', { shiftKey: true })), 'shortcuts');
  assert.equal(matchShortcut(ev('?', { shiftKey: true }, input)), null);
  assert.equal(matchShortcut(ev('/', { ctrlKey: true }, input), { mac: false }), 'shortcuts');
});

test('atalhos novos: mudo/ensurdecer e canais', () => {
  assert.equal(matchShortcut(ev('M', { ctrlKey: true, shiftKey: true }), { mac: false }), 'toggleMute');
  assert.equal(matchShortcut(ev('D', { ctrlKey: true, shiftKey: true }), { mac: false }), 'toggleDeafen');
  assert.equal(matchShortcut(ev('ArrowUp', { altKey: true })), 'prevChannel');
  assert.equal(matchShortcut(ev('ArrowDown', { altKey: true })), 'nextChannel');
  assert.equal(matchShortcut(ev('ArrowDown', { altKey: true, shiftKey: true })), 'nextUnread');
  assert.equal(matchShortcut(ev('Escape')), 'markRead');
});

test('atalhos novos não roubam os que já existiam nem os do navegador', () => {
  const mac = false;
  // Ctrl+K (QuickSwitcher), Ctrl+F (busca no chat), Ctrl+Shift+F (modo foco)
  assert.equal(matchShortcut(ev('k', { ctrlKey: true }), { mac }), null);
  assert.equal(matchShortcut(ev('f', { ctrlKey: true }), { mac }), null);
  assert.equal(matchShortcut(ev('F', { ctrlKey: true, shiftKey: true }), { mac }), null);
  // Ctrl+Shift+I/J/C (bloqueados em App.jsx), Alt+←/→ (voltar/avançar)
  for (const k of ['I', 'J', 'C']) assert.equal(matchShortcut(ev(k, { ctrlKey: true, shiftKey: true }), { mac }), null);
  assert.equal(matchShortcut(ev('ArrowLeft', { altKey: true })), null);
  assert.equal(matchShortcut(ev('ArrowRight', { altKey: true })), null);
  // ↑ sozinho (editar última mensagem), Enter, Shift+Enter
  assert.equal(matchShortcut(ev('ArrowUp', {}, input)), null);
  assert.equal(matchShortcut(ev('Enter', {}, input)), null);
  // Ctrl+Alt+↑ não é nosso; Ctrl+Shift+Alt+M também não.
  assert.equal(matchShortcut(ev('ArrowUp', { altKey: true, ctrlKey: true })), null);
  assert.equal(matchShortcut(ev('m', { ctrlKey: true, shiftKey: true, altKey: true }), { mac }), null);
  // Esc com modificador não marca como lido; composição de IME é ignorada.
  assert.equal(matchShortcut(ev('Escape', { shiftKey: true })), null);
  assert.equal(matchShortcut(ev('/', { ctrlKey: true, isComposing: true }), { mac }), null);
});

test('lista de atalhos: ids únicos e combinações novas sem repetição', () => {
  const all = SHORTCUT_GROUPS.flatMap((g) => g.items);
  assert.equal(new Set(all.map((i) => i.id)).size, all.length);
  const combos = all.filter((i) => !i.existing).map((i) => i.keys.join('+'));
  assert.equal(new Set(combos).size, combos.length);
  assert.equal(keyLabel('Mod', { mac: true }), '⌘');
  assert.equal(keyLabel('Mod', { mac: false }), 'Ctrl');
  assert.equal(codeLabel('KeyV'), 'V');
  assert.equal(codeLabel('Space'), 'Espaço');
  assert.equal(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('navegação circular de canais (Alt+↑/↓ e só não lidos)', () => {
  const items = ['a', 'b', 'c', 'd'];
  assert.equal(findFrom(items, 1, 1, () => true), 2);
  assert.equal(findFrom(items, 3, 1, () => true), 0);
  assert.equal(findFrom(items, 0, -1, () => true), 3);
  assert.equal(findFrom(items, -1, 1, () => true), 0);
  assert.equal(findFrom(items, -1, -1, () => true), 3);
  assert.equal(findFrom(items, 0, 1, (x) => x === 'd'), 3);
  assert.equal(findFrom(items, 3, 1, (x) => x === 'b'), 1);
  assert.equal(findFrom(items, 2, 1, (x) => x === 'c'), -1); // só o próprio
  assert.equal(stepIndex(0, 0, 1), -1);
  assert.equal(stepIndex(3, 2, 1), 0);
});

test('tour: 5 a 7 passos e balão sempre dentro da tela', () => {
  assert.ok(TOUR_STEPS.length >= 5 && TOUR_STEPS.length <= 7);
  const vp = { width: 1280, height: 800 };
  const pop = { width: 340, height: 200 };
  const side = placePopover({ top: 100, left: 0, width: 260, height: 400 }, pop, vp);
  assert.equal(side.side, 'right');
  assert.ok(side.left >= 260);
  const center = placePopover(null, pop, vp);
  assert.equal(center.side, 'center');
  // Celular estreito: nada cabe dos lados → embaixo/em cima, dentro da tela.
  const phone = placePopover({ top: 600, left: 10, width: 340, height: 60 }, { width: 330, height: 200 }, { width: 360, height: 700 });
  assert.ok(phone.left >= 12 && phone.left + 330 <= 360);
  assert.ok(phone.top >= 12 && phone.top + 200 <= 700);
});
