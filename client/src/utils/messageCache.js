import { idbGet, idbSet, idbDel, idbClear } from './idbKv';
import { getExtra } from './extraPrefs';
import {
  sanitizeForCache, updateCacheIndex, roomCacheKey, indexCacheKey, CACHE_MAX_AGE_MS,
} from './messageCacheCore';

// Cache de mensagens pra abrir canal/DM NA HORA.
//
// Guarda, no IndexedDB do aparelho e separado por conta, as últimas ~50
// mensagens dos ~30 canais/conversas abertos mais recentemente (teto de
// ~4 MB). Ao abrir um deles, o ChatWindow mostra essa cópia imediatamente
// enquanto a página nova chega do servidor; aí junta as duas (mensagens
// apagadas/editadas nesse meio tempo são corrigidas — mergeLatestMessages).
//
// Privacidade: desligável em Configurações → Privacidade ("Guardar
// mensagens recentes neste aparelho"); desligar apaga tudo. Sair da conta
// também apaga.

export function messageCacheEnabled() {
  try { return getExtra().cacheMessages !== false; } catch { return true; }
}

export async function loadCachedRoom(userId, roomKey) {
  if (!userId || !roomKey || !messageCacheEnabled()) return null;
  const entry = await idbGet(roomCacheKey(userId, roomKey));
  if (!entry || !Array.isArray(entry.messages) || !entry.messages.length) return null;
  if (Date.now() - (entry.at || 0) > CACHE_MAX_AGE_MS) return null;
  return entry.messages;
}

// Gravações em série (o índice é lido e regravado — duas ao mesmo tempo se
// atropelariam) e com atraso por sala (rajada de mensagens = 1 gravação).
let chain = Promise.resolve();
const timers = new Map();

export function saveCachedRoom(userId, roomKey, messages, delayMs = 1200) {
  if (!userId || !roomKey || !messageCacheEnabled()) return;
  const k = `${userId}|${roomKey}`;
  clearTimeout(timers.get(k));
  timers.set(k, setTimeout(() => {
    timers.delete(k);
    const clean = sanitizeForCache(messages);
    if (!clean.length) return;
    chain = chain.then(() => writeRoom(userId, roomKey, clean)).catch(() => {});
  }, delayMs));
}

async function writeRoom(userId, roomKey, clean) {
  let json;
  try { json = JSON.stringify(clean); } catch { return; }
  const now = Date.now();
  const idxKey = indexCacheKey(userId);
  const { index, evict } = updateCacheIndex(await idbGet(idxKey), roomKey, json.length, now);
  if (!evict.includes(roomKey)) await idbSet(roomCacheKey(userId, roomKey), { at: now, messages: clean });
  await Promise.all(evict.map((r) => idbDel(roomCacheKey(userId, r))));
  await idbSet(idxKey, index);
}

// Perdeu o acesso à sala (403/404): apaga a cópia dela.
export function forgetCachedRoom(userId, roomKey) {
  if (!userId || !roomKey) return;
  const k = `${userId}|${roomKey}`;
  clearTimeout(timers.get(k));
  timers.delete(k);
  chain = chain.then(() => idbDel(roomCacheKey(userId, roomKey))).catch(() => {});
}

// Sair da conta / desligar a opção: apaga tudo (todas as contas do aparelho).
export function clearMessageCache() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  chain = chain.then(() => idbClear()).catch(() => {});
  return chain;
}
