// Clipes (Fase 7): captura do atalho na tela de Configurações.
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceleratorFromEvent, prettyAccelerator } from '../src/utils/clipsHotkey.js';

const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('atalho: Alt+F10 (padrão), F9 sozinha, Ctrl+Shift+S', () => {
  assert.equal(acceleratorFromEvent(ev('F10', { altKey: true })), 'Alt+F10');
  assert.equal(acceleratorFromEvent(ev('F9')), 'F9');
  assert.equal(acceleratorFromEvent(ev('KeyS', { ctrlKey: true, shiftKey: true })), 'CommandOrControl+Shift+S');
  assert.equal(acceleratorFromEvent(ev('Digit5', { altKey: true })), 'Alt+5');
  assert.equal(acceleratorFromEvent(ev('Numpad1', { ctrlKey: true })), 'CommandOrControl+num1');
});

test('atalho: recusa tecla comum sozinha, Shift+letra e só modificador', () => {
  assert.equal(acceleratorFromEvent(ev('KeyA')), null);
  assert.equal(acceleratorFromEvent(ev('KeyA', { shiftKey: true })), null);
  assert.equal(acceleratorFromEvent(ev('AltLeft', { altKey: true })), null);
  assert.equal(acceleratorFromEvent(ev('Semicolon', { ctrlKey: true })), null);
  assert.equal(acceleratorFromEvent(null), null);
});

test('texto bonito do atalho', () => {
  assert.equal(prettyAccelerator('Alt+F10'), 'Alt + F10');
  assert.equal(prettyAccelerator('CommandOrControl+Super+num3'), 'Ctrl + Win + Num 3');
  assert.equal(prettyAccelerator(''), '');
});
