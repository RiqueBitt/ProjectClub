import { test, expect } from '@playwright/test';
import { QUICK_REACTIONS, isValidReaction, makeReactionRateLimiter, prettyKeyName } from '../src/utils/voicePrefs.js';

// Lógica pura dos extras de voz: reações (I) e nomes de tecla do
// "apertar pra falar" (F). Sem navegador.

test('reação: só os 5 emojis fixos são válidos', () => {
  expect(QUICK_REACTIONS).toEqual(['👍', '❤️', '😂', '🎉', '😮']);
  for (const ok of QUICK_REACTIONS) expect(isValidReaction(ok)).toBe(true);
  for (const bad of ['', 'x', '🤡', '<b>', null, 7]) expect(isValidReaction(bad)).toBe(false);
});

test('limite anti-spam das reações: 5 numa rajada, depois bloqueia; repõe com o tempo', () => {
  const allow = makeReactionRateLimiter({ max: 5, windowMs: 4000 });
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i += 1) expect(allow(t0 + i)).toBe(true);
  // A 6ª na mesma janela é bloqueada.
  expect(allow(t0 + 6)).toBe(false);
  // Passada a janela, volta a permitir.
  expect(allow(t0 + 4100)).toBe(true);
});

test('nome amigável da tecla do apertar pra falar', () => {
  expect(prettyKeyName('Space')).toBe('Barra de espaço');
  expect(prettyKeyName('KeyV')).toBe('V');
  expect(prettyKeyName('Digit4')).toBe('4');
  expect(prettyKeyName('ControlLeft')).toBe('Ctrl');
  expect(prettyKeyName('')).toBe('—');
});
