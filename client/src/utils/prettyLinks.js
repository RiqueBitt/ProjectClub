// Links bonitos — parte ligada ao store. Use estas funções em TODO lugar
// que monta um link/navega pra canal, conversa, perfil, evento ou post:
//
//   navigate(channelPath(ch))       → /canal/chat-geral
//   navigate(conversationPath(c))   → /dm/fulano  ou  /dm/grupo-amigos
//   userPath(u) / eventPath(ev) / postPath(p) / libraryPath(u)
//
// Aceitam o objeto ou só o id (procuram o resto no que já está carregado).
// Ver prettyPaths.js (parte pura) e components/PrettyRoutes.jsx (as rotas,
// que também aceitam os endereços antigos e trocam pelo bonito).
import { useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { api } from '../api/client';
import {
  channelPathFrom, conversationPathFrom, userPathFrom, libraryPathFrom, eventPath, postPath, roomFromPath,
} from './prettyPaths';

export {
  eventPath, postPath, slugify, isChannelPath, isDmPath, isChatPath, isPostPath, parseAppPath, UUID_RE,
} from './prettyPaths';

// Quem está logado (pra saber quem é "a outra pessoa" numa DM 1:1).
// AuthContext atualiza sempre que a conta muda.
let meId = null;
export function setPrettyLinksMe(id) { meId = id || null; }
export function getPrettyLinksMe() { return meId; }

const st = () => useStore.getState();

export const channelPath = (chOrId) => channelPathFrom(st(), chOrId);
export const conversationPath = (convOrId) => conversationPathFrom(st(), convOrId, meId);
export const userPath = (userOrId) => userPathFrom(st(), userOrId);
export const libraryPath = (userOrId) => libraryPathFrom(st(), userOrId);
// Mensagem dentro do canal/conversa (?m=<id> pula até ela).
export const roomPath = ({ channelId, conversationId } = {}) => (channelId ? channelPath(channelId) : conversationId ? conversationPath(conversationId) : '/');
export const absoluteUrl = (path) => `${typeof window !== 'undefined' ? window.location.origin : ''}${path}`;

// Sala aberta na URL atual, com o id de verdade ({ channelId } | { conversationId } | null).
export function useRouteRoom() {
  const { pathname } = useLocation();
  // Re-renderiza quando canais/conversas chegam (slug → id).
  useStore((s) => s.channels);
  useStore((s) => s.categories);
  useStore((s) => s.conversations);
  return roomFromPath(pathname, st(), meId);
}
export const roomFromCurrentPath = (pathname) => roomFromPath(pathname, st(), meId);

// Pergunta ao servidor (endereço antigo, slug antigo, ou algo que ainda não
// está carregado). Mesma regra de acesso dos ids: sem acesso = null.
const cache = new Map();
export function resolveLinkRemote(path) {
  const key = String(path);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.promise;
  const promise = api.get('/links/resolve', { params: { path: key } })
    .then((r) => r.data?.link || null)
    .catch(() => null);
  cache.set(key, { at: Date.now(), promise });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return promise;
}
