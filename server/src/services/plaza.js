// Praça virtual 2D (Fase 8) — regras puras (sem socket, sem banco), usadas
// por sockets/plaza.js e pelos testes.
//
// - Mapa fixo de MAP_W × MAP_H "pixels do mundo"; ninguém sai dele.
// - Cada movimento anda no máximo MAX_STEP (anti-teletransporte): o cliente
//   manda posições intermediárias enquanto anda.
// - Limite de envio por "balde de fichas": ~15 movimentos/s e poucas falas.
// - Conversa por proximidade: a fala só chega em quem está a até
//   PROXIMITY_RADIUS de distância de quem falou.
// - Até ROOM_CAP pessoas por sala; lotou, abre "Praça 2", "Praça 3"...

const MAP_W = 1600;
const MAP_H = 1000;
const ROOM_CAP = 50;
const MAX_ROOMS = 20;
const MAX_STEP = 48;
const MOVE_RATE = 15; // por segundo
const MOVE_BURST = 15;
const CHAT_MAX = 120;
const CHAT_BURST = 3;
const CHAT_REFILL_MS = 2000; // 1 fala a cada 2s depois da rajada
const PROXIMITY_RADIUS = 280;
const SNAPSHOT_MS = 100;
const SPAWN = { x: 800, y: 620 };

// Zonas decorativas (o cliente desenha; o servidor só usa a do palco).
const ZONES = [
  { id: 'fonte', label: 'Fonte', kind: 'fountain', x: 700, y: 380, w: 200, h: 200 },
  { id: 'jardim', label: 'Jardim', kind: 'garden', x: 80, y: 80, w: 380, h: 300 },
  { id: 'lago', label: 'Lago gelado', kind: 'ice', x: 1140, y: 80, w: 380, h: 280 },
  { id: 'palco', label: 'Palco (call)', kind: 'stage', x: 1140, y: 640, w: 380, h: 280, voice: true },
  { id: 'cafe', label: 'Cantinho do café', kind: 'cafe', x: 80, y: 640, w: 380, h: 280 },
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Normaliza e limita uma posição pedida a partir da posição atual.
function validateMove(from, to) {
  const tx = Number(to?.x);
  const ty = Number(to?.y);
  if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
  let nx = clamp(tx, 0, MAP_W);
  let ny = clamp(ty, 0, MAP_H);
  const dx = nx - from.x;
  const dy = ny - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist > MAX_STEP) {
    nx = from.x + (dx / dist) * MAX_STEP;
    ny = from.y + (dy / dist) * MAX_STEP;
  }
  return { x: Math.round(clamp(nx, 0, MAP_W)), y: Math.round(clamp(ny, 0, MAP_H)) };
}

// Balde de fichas: capacidade `burst`, repõe `ratePerSec` fichas por segundo.
function makeBucket(burst, ratePerSec, now = Date.now()) {
  return { tokens: burst, burst, rate: ratePerSec, last: now };
}
function takeToken(bucket, now = Date.now()) {
  const elapsed = Math.max(0, now - bucket.last) / 1000;
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsed * bucket.rate);
  bucket.last = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
const makeMoveBucket = (now) => makeBucket(MOVE_BURST, MOVE_RATE, now);
const makeChatBucket = (now) => makeBucket(CHAT_BURST, 1000 / CHAT_REFILL_MS, now);

// Limpa a fala: tira caracteres de controle/invisíveis, junta espaços e
// corta em CHAT_MAX. O cliente sempre mostra como TEXTO (nunca HTML).
function sanitizeChat(raw) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return Array.from(text).slice(0, CHAT_MAX).join('');
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Quem ouve uma fala de `speaker` (inclui a própria pessoa).
function listenersFor(speaker, members, radius = PROXIMITY_RADIUS) {
  return members.filter((m) => m.userId === speaker.userId || distance(m, speaker) <= radius);
}

function zoneAt(pos) {
  return ZONES.find((z) => pos.x >= z.x && pos.x <= z.x + z.w && pos.y >= z.y && pos.y <= z.y + z.h) || null;
}

// Escolhe a sala: a pedida se tiver vaga; senão a primeira com vaga; senão
// abre a próxima. `sizes` = Map(roomId -> quantidade). Salas são "1", "2"...
function pickRoom(sizes, requested = null, cap = ROOM_CAP, maxRooms = MAX_ROOMS) {
  const req = requested != null ? String(requested) : null;
  if (req && /^\d{1,2}$/.test(req) && Number(req) >= 1 && Number(req) <= maxRooms && (sizes.get(req) || 0) < cap) return req;
  for (let i = 1; i <= maxRooms; i += 1) {
    if ((sizes.get(String(i)) || 0) < cap) return String(i);
  }
  return null;
}

const roomLabel = (roomId) => (roomId === '1' ? 'Praça' : `Praça ${roomId}`);

function spawnPoint(rand = Math.random) {
  return { x: Math.round(SPAWN.x + (rand() - 0.5) * 160), y: Math.round(SPAWN.y + (rand() - 0.5) * 80) };
}

module.exports = {
  MAP_W, MAP_H, ROOM_CAP, MAX_ROOMS, MAX_STEP, MOVE_RATE, MOVE_BURST, CHAT_MAX, CHAT_BURST, CHAT_REFILL_MS,
  PROXIMITY_RADIUS, SNAPSHOT_MS, ZONES,
  validateMove, makeBucket, takeToken, makeMoveBucket, makeChatBucket, sanitizeChat, distance,
  listenersFor, zoneAt, pickRoom, roomLabel, spawnPoint,
};
