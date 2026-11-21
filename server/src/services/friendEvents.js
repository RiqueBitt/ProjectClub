'use strict';
// Aviso "a amizade entre estas duas contas mudou" (aceitou, desfez, bloqueou).
// Quem escuta: a Praça — os amigos do Project Club são amigos dentro do
// Club Penguin também (ver services/waddle/penguinStore.js → syncFriends).
const listeners = new Set();

function onFriendsChanged(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function friendsChanged(...userIds) {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return;
  for (const fn of listeners) { try { fn(ids); } catch { /* ok */ } }
}

module.exports = { onFriendsChanged, friendsChanged };
