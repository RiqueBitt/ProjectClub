import { useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMissions } from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { useStore } from '../store/useStore';

// Contador de missões prontas pra resgatar (badge do item Economia no
// menu) + aviso "Missão concluída" quando uma termina. Um estado só pro
// app todo (vários menus usam o mesmo número sem buscar de novo):
// busca ao abrir, a cada 90s com a aba visível e quando o socket avisa
// progresso/mudança de missões.
let count = 0;
const listeners = new Set();
let started = false;
let inflight = null;
let attachedSocket = null;
let navigateRef = null;
const toasted = new Set();

function emit(n) {
  if (n === count) return;
  count = n;
  listeners.forEach((l) => l());
}

export function setClaimableMissions(n) { emit(Math.max(0, Number(n) || 0)); }

export function refreshClaimableMissions() {
  if (inflight) return inflight;
  // Sistema Economia desligado pela staff: sem badge e sem requisição.
  if ((useStore.getState().disabledSystems || []).includes('economia')) { emit(0); return Promise.resolve(); }
  inflight = listMissions()
    .then((d) => emit((d?.missions || []).filter((m) => m.completed && !m.claimed).length))
    .catch(() => {})
    .finally(() => { inflight = null; });
  return inflight;
}

function start() {
  if (started) return;
  started = true;
  refreshClaimableMissions();
  setInterval(() => { if (!document.hidden) refreshClaimableMissions(); }, 90000);
}

function onProgress(p) {
  if (!p?.completed) return;
  refreshClaimableMissions();
  const key = `${p.missionId}|${p.periodKey || ''}`;
  if (toasted.has(key)) return;
  toasted.add(key);
  const title = p.title || 'Missão';
  useStore.getState().pushNotice?.(`Missão concluída: ${title}`, {
    label: 'Resgatar',
    onClick: () => (navigateRef ? navigateRef('/missoes') : window.location.assign('/missoes')),
  });
}
function onUpdate() { refreshClaimableMissions(); }
// Aviso salvo novo (lembrete de evento, presente da Loja): toast com atalho.
function onNotice(n) {
  if (!n?.title) return;
  const lead = n.kind === 'EVENT_REMINDER' ? 'Lembrete' : n.kind === 'GIFT' ? 'Presente' : 'Aviso';
  useStore.getState().pushNotice?.(`${lead}: ${n.title}${n.body ? ` · ${n.body}` : ''}`, n.link ? {
    label: 'Ver',
    onClick: () => (navigateRef ? navigateRef(n.link) : window.location.assign(n.link)),
  } : undefined);
}

function attach(socket) {
  if (!socket || socket === attachedSocket) return;
  if (attachedSocket) {
    attachedSocket.off('missions:progress', onProgress);
    attachedSocket.off('missions:update', onUpdate);
    attachedSocket.off('notice:new', onNotice);
  }
  attachedSocket = socket;
  socket.on('missions:progress', onProgress);
  socket.on('missions:update', onUpdate);
  socket.on('notice:new', onNotice);
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => count;

// Usado pelos menus (useBadges / MainSidebar). Devolve o número atual.
export function useClaimableMissions() {
  const { socket } = useSocket() || {};
  const navigate = useNavigate();
  const n = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { navigateRef = navigate; start(); }, [navigate]);
  useEffect(() => { attach(socket); }, [socket]);
  return n;
}
