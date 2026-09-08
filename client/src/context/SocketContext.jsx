import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { useStore, roomKeyFor, messageMentionsUser, isChannelUnread, isConversationUnread } from '../store/useStore';
import { listFriends, getCommunity, listUsableEmojis, listServerStickers, listAssetCollections } from '../api/endpoints';
import { playSound } from '../utils/sounds';
import { setupNativeActivity } from '../utils/nativeActivity';
import { updateUnreadBadge } from '../utils/unreadBadge';

const SocketContext = createContext(null);

// BUG CORRIGIDO: o ícone da notificação apontava pra '/icon.svg', um
// arquivo que nunca existiu neste projeto (só existe /icon.png) — toda
// notificação nativa sempre saía sem ícone nenhum (ou com um genérico do
// sistema), silenciosamente, sem erro nenhum visível.
// BUG CORRIGIDO ("notificação só funcionava com a janela minimizada"):
// document.visibilityState só vira 'hidden' quando a aba/janela é
// MINIMIZADA ou trocada de aba — se a pessoa só está com o app aberto
// mas trabalhando em OUTRA janela por cima (o caso mais comum de
// verdade), a janela continua "visível" tecnicamente, então nenhuma
// notificação disparava. document.hasFocus() cobre esse caso também.
//
// Item pedido: "Sobreposição no jogo (overlay)... Nova mensagem,
// menção, convite, pedido de amizade e entrada em chamada aparecem na
// overlay" — toda notificação que já passa por AQUI (mensagem/menção/
// chamada/pedido de amizade, ver os pontos que chamam notifyUser mais
// abaixo) também é repassada pro app de desktop, que decide sozinho
// (ver desktop/main.js) se deve aparecer de verdade por cima do jogo.
// Sem efeito nenhum fora do app desktop (window.electronAPI não existe
// no navegador comum/celular).
function notifyUser(title, body, onClick) {
  useStore.getState().pushNotice(body ? `${title}: ${body}` : title);
  window.electronAPI?.showOverlayNotification?.({ title, body });
  const isHiddenOrUnfocused = typeof document !== 'undefined'
    && (document.visibilityState === 'hidden' || !document.hasFocus());
  if (isHiddenOrUnfocused && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, icon: '/icon.png' });
      // Clicar na notificação traz a janela pra frente — funciona tanto
      // no app de desktop (Electron, via a ponte exposta em preload.js)
      // quanto num navegador comum (window.focus() já resolve sozinho).
      n.onclick = () => {
        window.electronAPI?.focusWindow?.();
        window.focus();
        onClick?.();
      };
    } catch { /* not fatal */ }
  }
}

export function SocketProvider({ children }) {
  const { token, user, logout } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const {
    addMessage, updateMessage, removeMessage, setPresence, setTypingUser,
    setConversations, setFriends, bumpRoomActivity, bumpChannelMention,
    patchUserEverywhere, setUsableEmojis, setServerStickers, setEmojiCollections, setStickerCollections,
  } = useStore.getState();

  useEffect(() => {
    if (!token || !user) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    const socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    });
    socket.on('disconnect', () => setConnected(false));

    // Detecção de atividade pra status "Ausente" automático: o servidor
    // conta 15min sem receber nenhum 'presence:activity' e marca a conta
    // como ausente sozinho (ver sockets/index.js). Aqui só escutamos
    // interação de verdade com a página e avisamos o servidor — throttled
    // bem folgado (bem menor que os 15min do servidor) só pra não gerar
    // um evento por pixel de mouse movido.
    const ACTIVITY_THROTTLE_MS = 60 * 1000;
    let lastActivitySentAt = 0;
    const notifyActivity = () => {
      // BUG CORRIGIDO ("melhore o sistema de identificação se o user
      // entra mesmo na web, mexendo, pra manter o online"): eventos de
      // teclado/mouse/toque não eram checados contra visibilidade da
      // aba — na prática o navegador já não entrega a maioria desses
      // eventos pra uma aba em segundo plano, mas 'scroll'/'wheel' podem
      // disparar em cenários bordas (ex.: a aba ainda visível mas sem
      // foco, atrás de outra janela só parcialmente cobrindo a tela).
      // Essa checagem garante que só conta como "a pessoa está de fato
      // usando o site agora" quando a aba realmente está em primeiro
      // plano — mais fiel ao que "Ausente" deveria significar.
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastActivitySentAt < ACTIVITY_THROTTLE_MS) return;
      lastActivitySentAt = now;
      socket.emit('presence:activity');
    };
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    activityEvents.forEach((evt) => window.addEventListener(evt, notifyActivity, { passive: true }));
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') notifyActivity();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Voltar o foco pra aba (trocar de janela/aplicativo e voltar) também
    // conta como "a pessoa está aqui de novo" — cobre o caso de alguém
    // que deixa a aba visível mas sem foco por um tempo (não dispara
    // visibilitychange, já que a aba nunca ficou tecnicamente "hidden").
    window.addEventListener('focus', notifyActivity);

    socket.on('message:new', (message) => {
      addMessage(roomKeyFor(message), message);
      bumpRoomActivity(message);

      if (message.authorId !== user.id) {
        let wasMentioned = false;
        if (message.channelId) {
          const { members } = useStore.getState();
          const me = members.find((m) => m.user.id === user.id);
          if (messageMentionsUser(message, user.id, me?.roleIds || [])) {
            bumpChannelMention(message.channelId);
            wasMentioned = true;
          }
        }
        const isReplyToMe = message.replyTo?.authorId === user.id || message.replyTo?.author?.id === user.id;

        const { activeConversationId } = useStore.getState();
        const isOpenConversation = message.conversationId && message.conversationId === activeConversationId;
        const shouldPlaySound = message.channelId
          ? (wasMentioned || isReplyToMe)
          : !isOpenConversation;
        if (shouldPlaySound) playSound(wasMentioned || isReplyToMe ? 'mention' : 'message');

        if (wasMentioned || isReplyToMe) {
          const authorName = message.author?.displayName || 'Alguém';
          const verb = isReplyToMe && !wasMentioned ? 'respondeu sua mensagem' : 'mencionou você';
          const preview = (message.content || '').slice(0, 120);
          notifyUser(`${authorName} ${verb}`, preview, () => navigate(`/`));
        } else if (message.conversationId && !isOpenConversation) {
          // Item pedido: notificação nativa pra mensagem direta (DM), não
          // só pra menção — igual Discord notifica qualquer DM nova,
          // mesmo sem @ nenhum, já que é sempre "pessoal" por definição.
          const authorName = message.author?.displayName || 'Alguém';
          const preview = (message.content || '').slice(0, 120) || '📎 Anexo';
          notifyUser(authorName, preview, () => navigate(`/conversations/${message.conversationId}`));
        }
      }
      // Item pedido: bolinha de não lidas no ícone da bandeja/dock — só
      // atualiza quando a mensagem é de outra pessoa e realmente conta
      // como não lida (mesma condição de cima), refletindo direto no
      // ícone do app via Electron (ver App.jsx/desktop main.js).
      updateUnreadBadge(userId);
    });
    socket.on('message:update', (message) => {
      updateMessage(roomKeyFor(message), message);
    });
    socket.on('message:delete', ({ id, ...room }) => {
      removeMessage(roomKeyFor(room), id);
    });

    socket.on('presence:update', ({ userId, status, customStatus }) => {
      setPresence(userId, { status, customStatus });
    });
    // BUG CORRIGIDO: sem isso, o status de cada pessoa só chegava via
    // eventos incrementais (presence:update) — se um evento se perdesse
    // no caminho (reconexão, instabilidade), o status errado dela ficava
    // preso pra sempre. Esse evento manda o retrato completo e atual de
    // todo mundo toda vez que este socket conecta/reconecta — substitui o
    // mapa de presença inteiro, então corrige sozinho qualquer coisa que
    // tenha ficado desatualizada. Ver server/src/sockets/index.js.
    socket.on('presence:sync', (list) => {
      const { setPresence: setP } = useStore.getState();
      list.forEach(({ userId, status, customStatus }) => setP(userId, { status, customStatus }));
    });

    // "Reload User" (painel de staff → Reload) — o servidor limpou o
    // cache de presença de todo mundo (ver adminController.reloadUserPresence).
    // Zera a presença local também, pra refletir isso na hora em vez de
    // continuar mostrando pontinhos verdes desatualizados até a próxima
    // atualização incremental chegar.
    socket.on('presence:reset', () => useStore.setState({ presence: {} }));

    // Item pedido: "Rich Presence" (jogo/Spotify tocando agora) — chega
    // sempre que o app de desktop de alguém detecta início/fim de um
    // jogo/música, ou quando ela sai de vez (ver server/src/sockets/
    // index.js). activity vem null quando parou.
    socket.on('activity:changed', ({ userId: uid, activity }) => {
      useStore.getState().setActivity(uid, activity);
    });
    // Item pedido: ícone de atividade na lista de membros aparecer
    // mesmo pra quem já estava jogando/ouvindo ANTES de eu conectar —
    // "foto instantânea" de tudo que já existe, mandada uma vez só ao
    // conectar (ver server/src/sockets/index.js), diferente de
    // activity:changed (que só chega quando algo MUDA depois).
    socket.on('activity:sync', (activitiesMap) => {
      Object.entries(activitiesMap).forEach(([uid, activity]) => useStore.getState().setActivity(uid, activity));
    });
    // Item pedido: "Rich Presence" — no app de desktop, começa a
    // escutar os avisos que o Electron manda (ver desktop/
    // activityDetector.js + preload.js) e repassa pro servidor. Sem
    // efeito nenhum na web comum/Android (setupNativeActivity já
    // verifica isso sozinho e não faz nada se não for o app de
    // desktop).
    setupNativeActivity(socket);

    // Conta excluída pela staff (painel → Usuários → Excluir conta) — a
    // pessoa é deslogada na hora, com um aviso claro, em vez de só ficar
    // travada com erros estranhos na tela (o token dela ainda "parece"
    // válido pro navegador, mas o usuário já não existe mais no banco).
    socket.on('account:deleted', () => {
      alert('Sua conta foi excluída pela equipe.');
      logout();
    });

    socket.on('typing:start', ({ userId, ...room }) => setTypingUser(roomKeyFor(room), userId, true));
    socket.on('typing:stop', ({ userId, ...room }) => setTypingUser(roomKeyFor(room), userId, false));

    socket.on('community:update', () => refreshCommunity());
    socket.on('ui-layout:update', ({ device, config }) => {
      // Editor de Interface (staff arrasta os menus/painéis, muda tamanho
      // de barras etc) — muda pra TODO MUNDO na hora, sem precisar
      // recarregar a página nem esperar o próximo check de status.
      useStore.getState().setUiLayout(device, config);
    });
    socket.on('user:update', (user) => patchUserEverywhere(user));
    // Reflete na hora quando a staff liga/desliga um sistema em /admin →
    // Sistema (ver adminController.adminUpdateSystemToggles) — antes esse
    // evento era emitido mas ninguém no cliente escutava ele, então a UI
    // (AppRail escondendo ícones, a nova seção "Cor do perfil" em
    // UserSettingsModal) só reagia depois de recarregar a página inteira.
    socket.on('system:toggles-update', ({ disabledSystems }) => {
      useStore.getState().setDisabledSystems(disabledSystems || []);
    });
    socket.on('account:banned', ({ reason, automated } = {}) => {
      let msg = `Sua conta foi banida da comunidade${automated ? ' pelo AutoMod' : ''}.`;
      if (reason) msg += `\nMotivo: ${reason}`;
      alert(msg);
      window.location.reload();
    });

    socket.on('conversation:new', ({ conversation }) => {
      useStore.getState().upsertConversation(conversation);
    });
    socket.on('conversation:left', ({ conversationId }) => {
      useStore.getState().removeConversation(conversationId);
    });

    socket.on('dm-call:ringing', ({ conversationId, fromUserId }) => {
      const convo = useStore.getState().conversations.find((c) => c.id === conversationId);
      const caller = convo?.members.find((m) => m.id === fromUserId);
      notifyUser(`${caller?.displayName || 'Alguém'} está ligando`, convo?.isGroup ? convo.name : 'Toque para atender');
    });

    socket.on('channel:new', () => refreshCommunity());
    socket.on('channel:update', () => refreshCommunity());
    socket.on('channel:delete', () => refreshCommunity());
    socket.on('channel:reorder', () => refreshCommunity());
    socket.on('category:new', () => refreshCommunity());
    socket.on('category:update', () => refreshCommunity());
    socket.on('category:delete', () => refreshCommunity());
    socket.on('category:reorder', () => refreshCommunity());
    socket.on('overwrite:update', () => refreshCommunity());
    // BUG CORRIGIDO ("editar cargo tem delay"): esses 4 avisos JÁ vêm
    // com o cargo inteiro pronto (ou o ID, no caso de exclusão) — não
    // tinha necessidade nenhuma de rebuscar a comunidade INTEIRA
    // (categorias+canais+membros+cargos) toda vez que UM cargo mudava.
    // Isso rodava em cima da atualização otimista que o próprio
    // componente que edita já fazia (ver RoleManagerModal.jsx),
    // dobrando o trabalho de rede à toa a cada clique numa permissão.
    // role:reorder continua recarregando tudo — o aviso só traz a nova
    // ORDEM dos ids, não os cargos com a posição já recalculada.
    socket.on('role:new', (role) => useStore.getState().upsertRole(role));
    socket.on('role:update', (role) => useStore.getState().upsertRole(role));
    socket.on('role:delete', ({ id }) => useStore.getState().removeRole(id));
    socket.on('role:reorder', () => refreshCommunity());

    // Clubes (fusão com o Reddit clone) — item 5: antes esses eventos
    // nem existiam (criar/editar/excluir Clube não emitia nada), então
    // quem já estava com o site aberto só via a mudança recarregando a
    // página. Diferente de refreshCommunity() acima (refaz um GET
    // inteiro), aqui já vem o objeto pronto no payload — atualiza
    // direto no estado global sem precisar de uma segunda ida ao
    // servidor.
    socket.on('club:new', (club) => useStore.getState().upsertClub(club));
    socket.on('club:update', (club) => useStore.getState().upsertClub(club));
    socket.on('club:delete', ({ id }) => useStore.getState().removeClub(id));
    socket.on('club:category:new', ({ communityId, category }) => useStore.getState().upsertClubCategory(communityId, category));
    socket.on('club:category:update', ({ communityId, category }) => useStore.getState().upsertClubCategory(communityId, category));
    socket.on('club:category:delete', ({ communityId, id }) => useStore.getState().removeClubCategory(communityId, id));

    // Conquistas e Ups em tempo real — ver services/achievements.js e
    // services/ups.js no backend, que emitem esses eventos.
    socket.on('achievement:unlocked', (achievement) => {
      useStore.getState().pushNotice(`🏆 Conquista desbloqueada: ${achievement.name}`);
    });
    socket.on('user:ups-update', ({ userId, totalUps }) => useStore.getState().setUserUps(userId, totalUps));
    socket.on('member:roles-update', () => refreshCommunity());

    socket.on('emoji:new', () => refreshUsableEmojis());
    socket.on('emoji:update', () => refreshUsableEmojis());
    socket.on('emoji:delete', () => refreshUsableEmojis());
    socket.on('sticker:new', () => refreshServerStickers());
    socket.on('sticker:delete', () => refreshServerStickers());
    socket.on('assetCollection:new', ({ kind }) => refreshCollections(kind));
    socket.on('assetCollection:update', ({ kind }) => refreshCollections(kind));
    socket.on('assetCollection:delete', ({ kind }) => refreshCollections(kind));

    socket.on('moderation:timeout', ({ timeoutUntil, reason, automated }) => {
      const until = new Date(timeoutUntil).toLocaleString('pt-BR');
      let msg = `Você recebeu um silêncio temporário${automated ? ' automático' : ''} até ${until}.`;
      if (reason) msg += `\nMotivo: ${reason}`;
      useStore.getState().pushNotice(msg);
    });
    socket.on('moderation:warning', ({ reason, automated }) => {
      useStore.getState().pushNotice(`Você recebeu uma advertência${automated ? ' automática' : ''}.\nMotivo: ${reason}`);
    });
    socket.on('automod:raid-alert', ({ reason }) => {
      useStore.getState().pushNotice(`⚠️ Proteção anti-raid ativada: ${reason}`);
    });
    socket.on('xp:levelup', ({ newLevel, newLevelName, coinsReward }) => {
      let msg = `🎉 Você subiu para o Nível ${newLevel} (${newLevelName})!`;
      if (coinsReward > 0) msg += ` +${coinsReward} moedas.`;
      useStore.getState().pushNotice(msg);
    });

    // Item pedido: "Sobreposição no jogo (overlay)... Pedido de
    // amizade... aparece na overlay" — antes esse evento só tocava um
    // som e recarregava a lista, sem nenhuma notificação de verdade
    // (nativa ou na overlay). Agora usa o mesmo notifyUser() de tudo
    // mais acima — cobre as duas coisas de uma vez.
    socket.on('friend:request', ({ from }) => {
      playSound('friendRequest');
      refreshFriends();
      notifyUser('Novo pedido de amizade', from?.displayName ? `${from.displayName} quer ser seu amigo` : undefined, () => navigate('/friends'));
    });
    socket.on('friend:update', () => refreshFriends());
    socket.on('friend:removed', () => refreshFriends());

    // Item pedido: sistemas estilo Orkut — avisos em tempo real, mesmo
    // padrão dos outros acima (a lista de verdade é buscada sob
    // demanda por quem precisa dela — perfil, notificações — esses
    // avisos aqui são só o "toast" imediato).
    socket.on('testimonial:new-pending', ({ testimonial }) => {
      useStore.getState().pushNotice(`📝 ${testimonial.author.displayName} escreveu um depoimento pra você — dá uma olhada nas notificações.`);
    });
    socket.on('testimonial:approved', () => {
      useStore.getState().pushNotice('✅ Seu depoimento foi aprovado e já está visível no perfil da pessoa!');
    });
    socket.on('scrap:new', ({ scrap }) => {
      useStore.getState().pushNotice(`💬 ${scrap.author.displayName} deixou um recado no seu mural!`);
    });
    socket.on('fan:new', ({ fanName }) => {
      useStore.getState().pushNotice(`⭐ ${fanName} agora é seu fã!`);
    });

    async function refreshFriends() {
      const { friendships } = await listFriends().catch(() => ({ friendships: [] }));
      setFriends(friendships);
    }

    async function refreshCommunity() {
      const data = await getCommunity().catch(() => null);
      if (!data) return;
      useStore.getState().setCommunityStructure({
        categories: data.categories, channels: data.channels, members: data.members, roles: data.roles, community: data.community,
      });
    }

    async function refreshUsableEmojis() {
      const { emojis } = await listUsableEmojis().catch(() => ({ emojis: [] }));
      setUsableEmojis(emojis);
    }

    async function refreshServerStickers() {
      const { stickers } = await listServerStickers().catch(() => ({ stickers: [] }));
      setServerStickers(stickers);
    }

    async function refreshCollections(kind) {
      const { collections } = await listAssetCollections(kind).catch(() => ({ collections: [] }));
      if (kind === 'STICKER') setStickerCollections(collections);
      else setEmojiCollections(collections);
    }

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, notifyActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', notifyActivity);
      socket.disconnect();
    };
  }, [token, userId]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
