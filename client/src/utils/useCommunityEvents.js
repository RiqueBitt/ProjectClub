import { useEffect, useState } from 'react';
import { listEvents } from '../api/endpoints';
import { useLiveRefresh, sameData } from './liveRefresh';
import { useSocket } from '../context/SocketContext.jsx';

// Eventos da comunidade (os mesmos da página Início), compartilhados entre
// o canal em destaque "Eventos" da lista e a página dele — uma busca só,
// atualizada ao vivo pelos eventos de socket event:new/update/delete.
let cache = null;
let inflight = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(cache));
const setCache = (next) => { cache = next; emit(); };

function load(force = false) {
  if (inflight) return inflight;
  if (cache && !force) return Promise.resolve(cache);
  inflight = listEvents()
    .then((d) => { const next = d.events || []; if (!sameData(cache, next)) setCache(next); return cache; })
    .catch(() => { if (!cache) setCache([]); return cache; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useCommunityEvents() {
  const [events, setEvents] = useState(cache);
  const { socket } = useSocket() || {};

  useEffect(() => {
    listeners.add(setEvents);
    load();
    return () => { listeners.delete(setEvents); };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNew = (e) => setCache(cache ? [e, ...cache.filter((x) => x.id !== e.id)] : [e]);
    // event:update não traz o RSVP — mantém o que já estava.
    const onUpdate = (e) => setCache((cache || []).map((x) => (x.id === e.id ? { ...e, rsvp: e.rsvp || x.rsvp } : x)));
    const onDelete = ({ id }) => setCache((cache || []).filter((x) => x.id !== id));
    // Contagem de "Eu vou / Talvez / Não vou" mudou (a minha resposta fica).
    const onRsvp = ({ eventId, rsvp }) => setCache((cache || []).map((x) => (x.id === eventId ? { ...x, rsvp: { ...rsvp, mine: x.rsvp?.mine ?? null } } : x)));
    socket.on('event:new', onNew);
    socket.on('event:update', onUpdate);
    socket.on('event:delete', onDelete);
    socket.on('event:rsvp', onRsvp);
    return () => {
      socket.off('event:rsvp', onRsvp);
      socket.off('event:new', onNew);
      socket.off('event:update', onUpdate);
      socket.off('event:delete', onDelete);
    };
  }, [socket]);

  // Tempo real: eventos já chegam por socket; ressincroniza em silêncio a
  // cada 33s (várias telas usando o hook
  // dividem a mesma requisição via `inflight`).
  useLiveRefresh(() => load(true), { interval: 33000 });

  // Atualiza um evento só na lista compartilhada (ex.: depois do RSVP).
  const patchEvent = (id, changes) => setCache((cache || []).map((x) => (x.id === id ? { ...x, ...changes } : x)));
  return { events, reload: () => load(true), patchEvent };
}
