import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { fetchSections } from './bootstrap';
import { applyBootData } from './applyBoot';
import { useSocket } from '../context/SocketContext.jsx';
import { useLiveRefresh, sameData, setRealtimeConnected } from './liveRefresh';
import '../styles/perf.css';

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
const onlyChanged = (r) => Object.fromEntries([...r.changed].map((k) => [k, r.data[k]]));

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

  // Tudo numa requisição só (GET /api/bootstrap, ver utils/bootstrap.js),
  // mandando os hashes do que já temos: seção que não mudou nem volta no
  // corpo. Status da plataforma, anúncio e eventos vêm junto (antes cada
  // um tinha o próprio relógio e a própria requisição).
  useLiveRefresh(async (ctx) => {
    const r = await fetchSections(['community', 'channelStates', 'me', 'conversations', 'friends', 'clan', 'status', 'announcement', 'events'], { accept: ctx.ok });
    if (!ctx.ok()) return;
    // Só o que mudou no servidor desde a última vez (o resto já está no
    // store — reaplicar o valor antigo poderia desfazer algo que chegou
    // pelo socket nesse meio-tempo).
    applyBootData(onlyChanged(r));
    const d = r.changed.has('me') ? r.data.me : null;
    if (!d?.user) return;
    const prev = userRef.current;
    if (!prev || prev.id !== d.user.id || sameData(prev, d.user)) return;
    const st = useStore.getState();
    ACCOUNT_PREFS.forEach(([field, setter]) => {
      if (d.user[field] && d.user[field] !== prev[field]) st[setter]?.(d.user[field]);
    });
    setUser(d.user);
  }, { interval: 22000, realtimeInterval: 60000 });

  useLiveRefresh(async (ctx) => {
    const r = await fetchSections(['usableEmojis', 'stickers', 'emojiCollections', 'stickerCollections', 'favoriteGifs', 'clubs', 'settings', 'uiLayout'], { accept: ctx.ok });
    if (ctx.ok()) applyBootData(onlyChanged(r));
  }, { interval: 90000, realtimeInterval: 180000 });
}
