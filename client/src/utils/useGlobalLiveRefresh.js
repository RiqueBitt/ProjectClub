import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import {
  getCommunity, listConversations, listFriends, fetchMe, getMyClan, getUserSettings,
  listUsableEmojis, listServerStickers, listAssetCollections, listFavoriteGifs, listCommunities, getUiLayout,
} from '../api/endpoints';
import { useSocket } from '../context/SocketContext.jsx';
import { useLiveRefresh, sameData, setRealtimeConnected } from './liveRefresh';
import '../styles/perf.css';

// Só grava no store se o valor mudou de verdade (evita re-render global
// a cada 11s quando nada aconteceu).
function setIfChanged(key, value, setter) {
  if (value === undefined) return;
  if (sameData(useStore.getState()[key], value)) return;
  setter(value);
}

// Campos da conta que também vivem no store local (tema, layout...). Só
// aplica se mudou NA CONTA desde o último valor visto (ex: trocado em
// outro dispositivo) — nunca sobrescreve uma escolha local à toa.
const ACCOUNT_PREFS = [
  ['preferredTheme', 'setTheme'],
  ['layoutStyle', 'setLayoutStyle'],
  ['emojiStyle', 'setEmojiStyle'],
  ['chatZoom', 'setChatZoom'],
  ['interfaceZoom', 'setInterfaceZoom'],
];

// Atualização ao vivo dos dados GLOBAIS (barra lateral, cabeçalho,
// pickers): estrutura da comunidade (canais/categorias/cargos/membros),
// a própria conta, conversas, amigos e clã a cada 22s (60s com o socket
// conectado, já que quase tudo isso chega por evento); o resto (emojis,
// figurinhas, coleções, GIFs favoritos, clubes, layout, configurações)
// num ritmo bem mais leve (90s / 3min com socket), já que muda raramente.
export function useGlobalLiveRefresh() {
  const { user, setUser } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  // Informa o relógio global se o tempo real (socket) está de pé: com ele
  // conectado, os dados abaixo já chegam por evento e o refresh vira só
  // rede de segurança (bem mais espaçado); ao reconectar, ressincroniza.
  const { connected } = useSocket() || {};
  useEffect(() => { setRealtimeConnected(!!connected); }, [connected]);
  useEffect(() => () => setRealtimeConnected(false), []);

  useLiveRefresh(async (ctx) => {
    const s = useStore.getState();
    await Promise.all([
      getCommunity().then((d) => {
        if (!ctx.ok()) return;
        const cur = useStore.getState();
        const patch = {};
        ['categories', 'channels', 'members', 'roles', 'community'].forEach((k) => {
          if (d[k] !== undefined && !sameData(cur[k], d[k])) patch[k] = d[k];
        });
        if (Object.keys(patch).length) s.setCommunityStructure(patch);
      }).catch(() => {}),
      fetchMe().then((d) => {
        if (!ctx.ok() || !d?.user) return;
        const prev = userRef.current;
        if (!prev || prev.id !== d.user.id || sameData(prev, d.user)) return;
        const st = useStore.getState();
        ACCOUNT_PREFS.forEach(([field, setter]) => {
          if (d.user[field] && d.user[field] !== prev[field]) st[setter]?.(d.user[field]);
        });
        setUser(d.user);
      }).catch(() => {}),
      listConversations().then((d) => { if (ctx.ok()) setIfChanged('conversations', d.conversations, s.setConversations); }).catch(() => {}),
      listFriends().then((d) => { if (ctx.ok()) setIfChanged('friends', d.friendships, s.setFriends); }).catch(() => {}),
      getMyClan().then((d) => {
        if (!ctx.ok() || !d) return;
        const cur = useStore.getState();
        const next = { clan: d.clan, myRole: d.myRole || null, myCapabilities: d.myCapabilities || {} };
        const prev = { clan: cur.myClan, myRole: cur.myClanRole, myCapabilities: cur.myClanCapabilities };
        if (!sameData(prev, next) || (d.pendingRequests !== undefined && !sameData(cur.myClanPendingRequests, d.pendingRequests))) s.setMyClan(d);
      }).catch(() => {}),
    ]);
  }, { interval: 22000, realtimeInterval: 60000 });

  useLiveRefresh(async (ctx) => {
    const s = useStore.getState();
    await Promise.all([
      listUsableEmojis().then((d) => { if (ctx.ok()) setIfChanged('usableEmojis', d.emojis, s.setUsableEmojis); }).catch(() => {}),
      listServerStickers().then((d) => { if (ctx.ok()) setIfChanged('serverStickers', d.stickers, s.setServerStickers); }).catch(() => {}),
      listAssetCollections('EMOJI').then((d) => { if (ctx.ok()) setIfChanged('emojiCollections', d.collections, s.setEmojiCollections); }).catch(() => {}),
      listAssetCollections('STICKER').then((d) => { if (ctx.ok()) setIfChanged('stickerCollections', d.collections, s.setStickerCollections); }).catch(() => {}),
      listFavoriteGifs().then((d) => { if (ctx.ok()) setIfChanged('favoriteGifs', d.gifs, s.setFavoriteGifs); }).catch(() => {}),
      listCommunities().then((d) => { if (ctx.ok()) setIfChanged('clubs', d.communities, s.setClubs); }).catch(() => {}),
      getUserSettings().then((d) => { if (ctx.ok()) setIfChanged('userSettings', d.settings, s.setUserSettings); }).catch(() => {}),
      getUiLayout().then((d) => { if (ctx.ok() && !sameData(useStore.getState().uiLayoutAll, d)) s.setUiLayoutAll(d); }).catch(() => {}),
    ]);
  }, { interval: 90000, realtimeInterval: 180000 });
}
