// Regras do soundboard (tocar na call). Ver controllers/soundboardController.js.
const MAX_SOUNDS = 48;
const MAX_DURATION_MS = 5000;
const USER_COOLDOWN_MS = 3000;   // 1 som a cada 3 s por pessoa
const ROOM_BURST = 4;            // no máximo 4 sons por sala…
const ROOM_WINDOW_MS = 10_000;   // …a cada 10 s (todo mundo junto)

const userLast = new Map();
const roomHits = new Map();
let cache = { at: 0, byId: new Map() };

function cleanName(v) {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return s.length >= 2 ? s : null;
}
function cleanEmoji(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return [...s].slice(0, 2).join('').slice(0, 16) || null;
}
function invalidate() { cache = { at: 0, byId: new Map() }; }

async function findSound(id, { prisma = require('../config/prisma'), now = Date.now() } = {}) {
  if (now - cache.at > 60_000) {
    const rows = await prisma.soundboardSound.findMany({ select: { id: true, name: true, emoji: true, url: true, durationMs: true } });
    cache = { at: now, byId: new Map(rows.map((r) => [r.id, r])) };
  }
  return cache.byId.get(String(id || '')) || null;
}

/** Pode tocar agora? Marca o uso quando sim. */
function allow(userId, channelId, now = Date.now()) {
  if (now - (userLast.get(userId) || 0) < USER_COOLDOWN_MS) return { ok: false, reason: 'Espere um pouquinho para tocar outro som.' };
  const hits = (roomHits.get(channelId) || []).filter((t) => now - t < ROOM_WINDOW_MS);
  if (hits.length >= ROOM_BURST) { roomHits.set(channelId, hits); return { ok: false, reason: 'Muitos sons ao mesmo tempo nesta sala. Espere alguns segundos.' }; }
  hits.push(now);
  roomHits.set(channelId, hits);
  userLast.set(userId, now);
  if (userLast.size > 5000) userLast.clear();
  if (roomHits.size > 2000) roomHits.clear();
  return { ok: true };
}

function _resetForTests() { userLast.clear(); roomHits.clear(); invalidate(); }

module.exports = { MAX_SOUNDS, MAX_DURATION_MS, USER_COOLDOWN_MS, ROOM_BURST, cleanName, cleanEmoji, invalidate, findSound, allow, _resetForTests };
