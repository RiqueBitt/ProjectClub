import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSocket } from '../context/SocketContext.jsx';
import { useLiveRefresh } from './liveRefresh';

// Bolinhas vermelhas "novo" de Anúncios, Eventos e Coleções da Loja.
// O servidor guarda quando cada pessoa abriu cada seção (SectionSeen) e
// conta o que saiu depois; abrir a seção zera (aqui na hora e nos outros
// aparelhos pelo socket 'section-badges:seen').
export const SECTION_KEYS = ['anuncios', 'eventos', 'colecoes'];

let cache = null; // { [section]: { count, latestAt, seenAt } }
const openSections = new Set();
let inflight = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(cache));

export function sectionCount(sections, key) {
  const n = Number(sections?.[key]?.count) || 0;
  return n > 0 ? n : 0;
}

export function badgeLabel(n) {
  if (!n) return '';
  return n > 9 ? '9+' : String(n);
}

function load() {
  if (inflight) return inflight;
  inflight = api.get('/section-badges')
    .then((r) => {
      cache = r.data?.sections || {};
      // Chegou novidade numa seção que está aberta agora: já conta como vista.
      openSections.forEach((sec) => { if (cache[sec]?.count > 0) { lastSent[sec] = 0; markSectionSeen(sec); } });
      emit();
      return cache;
    })
    .catch(() => cache)
    .finally(() => { inflight = null; });
  return inflight;
}

function zero(section) {
  if (!cache?.[section]) return;
  cache = { ...cache, [section]: { ...cache[section], count: 0, seenAt: new Date().toISOString() } };
  emit();
}

const lastSent = {};
// Abriu a seção: apaga a bolinha e avisa o servidor (no máximo 1x a cada 10s).
export function markSectionSeen(section) {
  if (!SECTION_KEYS.includes(section)) return;
  zero(section);
  const now = Date.now();
  if (lastSent[section] && now - lastSent[section] < 10000) return;
  lastSent[section] = now;
  api.post(`/section-badges/${section}/seen`).catch(() => { lastSent[section] = 0; });
}

export function useSectionBadges() {
  const [sections, setSections] = useState(cache);
  const { socket } = useSocket() || {};

  useEffect(() => {
    listeners.add(setSections);
    if (!cache) load();
    return () => { listeners.delete(setSections); };
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onNew = () => { load(); };
    const onSeen = ({ section } = {}) => zero(section);
    socket.on('section-badges:new', onNew);
    socket.on('section-badges:seen', onSeen);
    return () => {
      socket.off('section-badges:new', onNew);
      socket.off('section-badges:seen', onSeen);
    };
  }, [socket]);

  useLiveRefresh(() => load(), { interval: 120000, realtimeInterval: 300000 });
  return sections || {};
}

// Zera a bolinha da seção enquanto a página dela está aberta.
export function useMarkSectionSeen(section, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    openSections.add(section);
    markSectionSeen(section);
    return () => { openSections.delete(section); };
  }, [section, enabled]);
}
