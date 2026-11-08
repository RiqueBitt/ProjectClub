'use strict';
// Aviso "o saldo de moedas desta conta mudou" (User.coins). Quem escuta: a
// Praça (Club Penguin), que traz o saldo novo pro pinguim online na hora —
// a moeda do jogo é a mesma do Project Club (ver services/waddle/penguinStore.js).
const listeners = new Set();

function onCoinsChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function coinsChanged(userId) {
  if (!userId) return;
  for (const fn of listeners) { try { fn(userId); } catch { /* ok */ } }
}

module.exports = { onCoinsChanged, coinsChanged };
