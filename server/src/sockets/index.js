const { guardSocket } = require('./guardHandler');
const { Server } = require('socket.io');
const { verifyAccessToken } = require('../services/tokens');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { getEffectivePermissions, channelHasRestrictions } = require('../services/authz');
const { has } = require('../services/permissions');
const { messageInclude } = require('../controllers/messageController');
const presenceStore = require('../services/presenceStore');
const devicePresence = require('../services/devicePresence');
const activityStore = require('../services/activityStore');
const voiceStore = require('../services/voiceRoomStore');
const voiceExtras = require('../services/voiceExtras');
const voiceUsage = require('../services/voiceUsage');
const gamePlaytime = require('../services/gamePlaytime');
const { steamAppIdOf } = require('../utils/steamCover');
const ytWatch = require('./ytWatch');
const { initSledRacing } = require('./sledRacing');
const { visibleStatus, installSocketMasking } = require('../utils/presenceVisibility');
const { createTokenBucket } = require('../utils/tokenBucket');

// Quem está online agora (Redis) — lido no máximo a cada 5s e
// compartilhado entre conexões: depois de um deploy, centenas de sockets
// reconectam juntos e cada um fazia a varredura sozinho.
let onlineIdsCache = { at: 0, promise: null };
function getOnlineIdsCached() {
  const now = Date.now();
  if (onlineIdsCache.promise && now - onlineIdsCache.at < 5000) return onlineIdsCache.promise;
  const promise = presenceStore.listOnlineUserIds().catch(() => []);
  onlineIdsCache = { at: now, promise };
  return promise;
}

// Retrato de presença pra quem conecta: só quem tem sessão viva (mais a
// própria pessoa), com "Invisível" virando "Offline" pros outros. O
// cliente trata a lista como completa — quem não está nela, está offline.
async function buildPresenceSnapshot(viewerId) {
  const ids = new Set(await getOnlineIdsCached());
  if (viewerId) ids.add(viewerId);
  if (!ids.size) return [];
  const rows = await prisma.user.findMany({
    where: { id: { in: [...ids] } }, select: { id: true, status: true, customStatus: true },
  });
  return rows.map((u) => {
    const status = visibleStatus(u.status, u.id === viewerId);
    return { userId: u.id, status, customStatus: u.customStatus, mobile: status !== 'OFFLINE' && devicePresence.onMobile(u.id) };
  });
}

// Canal privado (ou com sobrescritas): a lista de quem está na voz não
// pode ir pra comunidade inteira. Cache curto do "é restrito?" por canal.
const restrictedChannelCache = new Map(); // channelId -> { at, restricted }
async function isRestrictedChannel(channelId) {
  const hit = restrictedChannelCache.get(channelId);
  if (hit && Date.now() - hit.at < 60000) return hit.restricted;
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, isPrivate: true, categoryId: true } });
  // Canal inexistente (ex.: voz de clã/DM, que nem passa por aqui) = não restrito.
  const restricted = channel ? await channelHasRestrictions(channel) : false;
  restrictedChannelCache.set(channelId, { at: Date.now(), restricted });
  if (restrictedChannelCache.size > 2000) restrictedChannelCache.clear();
  return restricted;
}

// Mesma atividade (só uma reconfirmação)? Spotify: mesma faixa e o
// progresso novo bate (±3s) com o anterior + o tempo que passou — se a
// pessoa pausou/pulou/voltou, conta como mudança e é retransmitida.
function sameActivity(a, b) {
  if (!a || !b || a.type !== b.type || a.name !== b.name || (a.detail || null) !== (b.detail || null)
    || (a.imageUrl || null) !== (b.imageUrl || null) || (a.durationMs || null) !== (b.durationMs || null)) return false;
  // AppID da Steam: só conta como mudança quando o aviso novo traz um
  // (o guardado pode ter vindo da biblioteca de jogos — ver activity:update).
  if (b.steamAppId && a.steamAppId !== b.steamAppId) return false;
  if (b.type !== 'spotify') return true;
  if (!Number.isFinite(a.progressMs) || !Number.isFinite(b.progressMs)) return a.progressMs === b.progressMs;
  const expected = a.progressMs + (b.startedAt - a.startedAt);
  return Math.abs(b.progressMs - expected) < 3000;
}

// Item pedido: verificar se todos os toggles de Configurações têm efeito
// real. "Compartilhar atividade" e "Quem pode ver sua atividade" já
// existiam na tela, mas todo emit de atividade ia direto pra sala
// "community" inteira — literalmente todo mundo conectado via socket,
// sem checar os dois toggles nenhuma vez. Mesmo já corrigido em
// userController.js/getUser() (quando alguém abre o perfil manualmente de
// propósito), a atualização AO VIVO — que é como a maioria realmente vê
// "fulano está jogando X", sem precisar abrir o perfil — continuava
// ignorando o controle de privacidade por completo. Centralizado aqui
// (chamado nos 3 pontos que emitiam 'activity:changed' direto pra
// 'community') em vez de cada um reimplementar a checagem.
async function broadcastActivityChange(io, userId, activity) {
  const payload = { userId, activity };
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { activitySharing: true, activityVisibility: true } });
  const sharingOn = settings?.activitySharing !== false;
  const visibility = settings?.activityVisibility || 'everyone';
  if (!sharingOn || visibility === 'none') return;
  if (visibility === 'everyone') { io.to('community').emit('activity:changed', payload); return; }

  // 'friends' ou 'friends_groups' — nunca broadcast amplo; manda só pra
  // quem de fato tem o direito de ver, via as rooms individuais
  // (user:<id>) que cada socket já entra ao conectar.
  const friendships = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  friendIds.forEach((fid) => io.to(`user:${fid}`).emit('activity:changed', payload));
  if (visibility === 'friends_groups') {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { clanId: true } });
    if (me?.clanId) io.to(`clan:${me.clanId}`).emit('activity:changed', payload);
  }
  // O próprio usuário sempre recebe também — sem isso, outras abas/
  // dispositivos dele mesmo não veriam a própria atividade atualizar.
  io.to(`user:${userId}`).emit('activity:changed', payload);
}

// Presença (quem está online, em quais sockets) agora vive no Redis — ver
// services/presenceStore.js — não em memória do processo, pra funcionar
// certo se a plataforma rodar em mais de uma instância no futuro.
//
// O timer de graça abaixo continua em memória DE PROPÓSITO — um handle de
// setTimeout do Node não é um dado serializável (não existe "salvar um
// timer no Redis"), só faz sentido existir dentro do processo que o
// criou. Isso não compromete a fonte de verdade (quem está online de
// verdade é sempre o que está no Redis) — na pior das hipóteses, rodando
// em mais de uma instância, o período de graça vira "por instância" em
// vez de global, o que é só uma pequena perda de suavidade, não um dado
// errado.
// userId -> setTimeout handle. See the disconnect handler's comment: going
// offline is delayed by a short grace period instead of firing the instant
// a user's last socket drops, specifically to absorb a quick
// disconnect+reconnect (backgrounding the mobile app for a few seconds,
// a brief network blip, a page navigation inside the SPA) without ever
// telling anyone else the person went offline in the first place.
const pendingOfflineTimers = new Map();
// Kept short on purpose — long enough to swallow a normal quick
// reconnect, short enough that actually closing the app/tab still reads as
// "went offline" promptly instead of the old default (up to ~45s from
// socket.io's ping interval+timeout alone) that read as "stays online
// forever" to the person watching.
const OFFLINE_GRACE_MS = 6000;

// Ausência por inatividade: se a pessoa está com o site aberto (socket
// conectado) mas não mexe em nada (sem mouse/teclado/toque — ver
// SocketContext.jsx no cliente, que manda 'presence:activity' de vez em
// quando enquanto detecta atividade), depois de 15 minutos ela deve
// aparecer como "Ausente" pros outros, do mesmo jeito que o Discord.
// Fechar a aba/app de vez continua indo pra OFFLINE pelo fluxo de
// disconnect logo abaixo — isso aqui é só pra quem deixou a aba aberta e
// saiu do computador.
//
// Igual ao pendingOfflineTimers acima, o timer em si (setTimeout) só faz
// sentido em memória do processo, não dá pra "salvar" ele no Redis — na
// pior das hipóteses (mais de uma instância no futuro) o relógio de 15min
// vira por-instância, não muda o resultado final.
const idleTimers = new Map(); // userId -> setTimeout handle
// Quem esse servidor colocou em "Ausente" sozinho (por inatividade) —
// distingue de alguém que escolheu "Ausente" manualmente no dropdown.
// Só quem está aqui volta pra ONLINE sozinho quando mexe no site de novo;
// quem escolheu Ausente/Não perturbe/Invisível na mão fica do jeito que
// escolheu até mudar de novo manualmente.
const autoIdledUsers = new Set();
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// NOVO: depois de ficar "Ausente" por INATIVIDADE (não por escolha
// própria) por mais 4 horas seguidas ainda sem nenhuma atividade, o
// status passa a mostrar OFFLINE pros outros — a pessoa continua com o
// site aberto/conectado de verdade, só que deixa de aparecer como
// "disponível" depois de tanto tempo parado (como o Discord faz depois
// de bastante tempo ausente). Importante: só conta pra quem foi marcado
// Ausente AUTOMATICAMENTE (autoIdledUsers) — se a pessoa escolheu
// "Ausente" na mão pelo menu de status, esse relógio de 4h nunca começa
// pra ela (ver onManualStatusChange, que sempre tira a pessoa de
// autoIdledUsers em qualquer troca manual) — ela fica Ausente até mudar
// de novo por conta própria, do jeito que já era antes. Assim que
// qualquer atividade real acontecer (mexer o mouse, digitar, reabrir a
// aba), markActive() cancela esse relógio e devolve ONLINE na hora,
// mesmo que já tenha virado OFFLINE — a pessoa nunca precisa mudar o
// status na mão só porque ficou parada tempo demais.
const idleToOfflineTimers = new Map(); // userId -> setTimeout handle
const IDLE_TO_OFFLINE_MS = 4 * 60 * 60 * 1000;

// Quem está em cada canal de voz agora, e o estado de cada chamada de DM
// em andamento, agora vivem no Redis — ver services/voiceRoomStore.js —
// não mais em Maps do processo, pra funcionar certo se a plataforma um
// dia rodar em mais de uma instância.

// Pedido de gravação com consentimento (N), por canal. Vive só na memória
// do processo de propósito: é um estado curto (segundos) e efêmero —
// enquanto todo mundo decide "aceito/recuso". Se a plataforma rodar em
// várias instâncias um dia, isto deve migrar pro Redis como o resto; por
// enquanto só começa de verdade DEPOIS que todos os presentes aceitaram,
// e nunca grava nada escondido.
const recordingRequests = new Map(); // channelId -> request (ver services/voiceExtras.js)

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    // Defaults (25s interval / 20s timeout) mean a connection that goes
    // silently dead (wifi drop, phone locked/backgrounded, laptop lid
    // closed) without a clean close frame can take up to ~45s to be
    // detected as disconnected — which is exactly the "I left and still
    // show online" gap. Tightened so a truly-dead connection is caught
    // within ~16s instead, while still being loose enough not to
    // false-positive on a momentarily busy tab.
    pingInterval: 8000,
    pingTimeout: 8000,
    // Compressão do WebSocket (vem desligada no Socket.IO 4): só pra
    // mensagens >= 1KB (lista de membros, mensagem com embed, sync de
    // presença), nível baixo (pouca CPU) e SEM "context takeover" — cada
    // conexão não guarda um dicionário zlib próprio na memória, que com
    // muita gente online pesava mais que a economia de banda.
    perMessageDeflate: {
      threshold: 1024,
      zlibDeflateOptions: { level: 3, memLevel: 7 },
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
    },
  });

  // Todo emit (broadcast, sala user:<id>, socket direto) mascara o status
  // INVISIBLE de quem não é o destinatário — ver presenceVisibility.js.
  installSocketMasking(io);

  // Multiplayer da Corrida de Trenó (namespace próprio /sled, sem login —
  // ver sledRacing.js). Isolado do socket principal: não roda a autenticação
  // acima nem toca em presença/voz/chat.
  initSledRacing(io);

  // SECURITY: antes só validava o JWT — uma conta banida, suspensa ou
  // desativada com um access token ainda dentro da validade continuava
  // conectando e recebendo tudo em tempo real. Agora confere o estado da
  // conta no banco a cada conexão (mesmas regras de requireAuth).
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isPlatformBanned: true, suspendedUntil: true, accountDisabledAt: true },
      });
      if (!user) return next(new Error('unauthorized'));
      if (user.isPlatformBanned) return next(new Error('banned'));
      if (user.accountDisabledAt) return next(new Error('account_disabled'));
      if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) return next(new Error('suspended'));
      socket.userId = payload.sub;
      socket.data.userId = payload.sub; // visível também via fetchSockets() (RemoteSocket)
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  gamePlaytime.startSweeper(); // fecha sessões de jogo sem batimento

  // Presença no boot: nenhum socket sobrevive a um restart do processo
  // (mesma lógica de voiceStore.clearAllRooms() no index.js), então tudo
  // que estiver no Redis agora é de conexões mortas. Antes isso ficava lá
  // até expirar e "segurava" a pessoa online. Toda conexão nova espera
  // essa limpeza terminar (no máximo 4s, pra nunca travar se o Redis
  // estiver fora) antes de se registrar.
  const presenceReady = Promise.race([
    presenceStore.clearAll()
      .then((n) => { if (n > 0) console.log(`[presença] boot: ${n} registro(s) de conexões antigas limpos`); })
      .catch((err) => console.error('[presença] limpeza no boot falhou:', err?.message || err)),
    new Promise((resolve) => { setTimeout(resolve, 4000).unref?.(); }),
  ]);

  io.on('connection', async (socket) => {
    // Todo socket.on/once desta conexão passa a ter rede de segurança: um
    // handler que lança (ou rejeita) fica registrado com o nome do evento
    // em vez de virar unhandledRejection anônimo — ver guardHandler.js.
    guardSocket(socket);
    const userId = socket.userId;
    // Reconexão rápida: cancela já (antes de qualquer await) o "marcar
    // offline" atrasado da conexão anterior — ver OFFLINE_GRACE_MS.
    if (pendingOfflineTimers.has(userId)) {
      clearTimeout(pendingOfflineTimers.get(userId));
      pendingOfflineTimers.delete(userId);
    }

    // A throw anywhere in here used to be an unhandled promise rejection —
    // in modern Node that crashes the *entire* process (every connected
    // user gets disconnected, mid-call voice drops, etc.) instead of just
    // failing this one person's connection setup. Wrapped so a single bad
    // connection attempt (e.g. a DB hiccup) can't take the whole server
    // down; see also the process-level safety net in index.js.
    // Celular ou PC? (pra mostrar o ícone de celular no lugar da bolinha)
    const mobileChanged = devicePresence.add(userId, socket.id, devicePresence.isMobileUserAgent(socket.handshake?.headers?.['user-agent']));
    socket.once('disconnect', () => {
      if (devicePresence.remove(userId, socket.id)) {
        presenceStore.isOnline(userId).then((on) => { if (on) broadcastPresence(io, userId); }).catch(() => {});
      }
    });
    try {
      await presenceReady;
      const socketCount = await presenceStore.addSocket(userId, socket.id);
      // BUG CORRIGIDO ("continua online mesmo sem a web aberta"): a
      // entrada de presença no Redis agora expira sozinha depois de
      // PRESENCE_TTL_SECONDS (ver o comentário grande em
      // presenceStore.js) — então, enquanto ESTA conexão realmente
      // continuar viva, precisa "renovar o relógio" de vez em quando,
      // ou a pessoa vai parecer offline mesmo estando conectada de
      // verdade. Um intervalo bem mais curto que o TTL (1/3 dele) dá
      // margem de sobra pra alguma renovação eventualmente atrasar
      // (um GC, uma reconexão momentânea do Redis) sem a chave chegar
      // a expirar à toa. Cancelado no 'disconnect' logo abaixo — depois
      // que a conexão cai de verdade, não tem mais nada aqui pra
      // renovar, e a entrada expira sozinha do jeito certo.
      // Renova o relógio DESTE socket (não só da chave) — ver
      // presenceStore.refreshPresence. Se a conexão já caiu (inclusive
      // enquanto este 'connection' ainda rodava, quando o 'once' abaixo
      // pode nunca disparar), o intervalo se cancela sozinho.
      const heartbeat = setInterval(() => {
        if (!socket.connected) { clearInterval(heartbeat); return; }
        presenceStore.refreshPresence(userId, socket.id).catch((err) => console.error('[socket] falha ao renovar presença:', err));
      }, (presenceStore.PRESENCE_TTL_SECONDS || 90) * 1000 / 3);
      socket.once('disconnect', () => clearInterval(heartbeat));
      // (O cancelamento do "marcar offline" atrasado de uma conexão
      // anterior agora acontece no topo do 'connection', antes dos awaits.)

      // Junta na sala pessoal (DMs/notificações), na sala única da
      // comunidade e em toda conversa de que o usuário participa.
      socket.join(`user:${userId}`);
      socket.join('community');
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, clanId: true } });
      if (['ADMIN', 'MODERATOR'].includes(me?.platformRole)) socket.join('staff');
      // Item pedido: "Somente usuários que fazem parte daquele clan
      // poderão acessar e utilizar esses canais" — sala própria por
      // clã, só quem é membro dele entra aqui (mesma ideia de
      // 'community' acima, mas isolada por clã em vez de global).
      if (me?.clanId) socket.join(`clan:${me.clanId}`);
      const conversations = await prisma.conversationMember.findMany({ where: { userId } });
      conversations.forEach((c) => socket.join(`conversation:${c.conversationId}`));

      // First connection for this user -> mark online and tell friends.
      if (socketCount === 1) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        // BUG CORRIGIDO ("fico em não perturbe, saio do app ou
        // atualizo, e ele volta pro online"): a checagem só protegia
        // "Invisível" de ser sobrescrita aqui — "Ausente" e "Não
        // perturbe" (os outros dois status escolhidos manualmente
        // pela própria pessoa) não estavam na lista, então toda
        // reconexão (fechar/abrir o app, recarregar a página) forçava
        // de volta pro Online, mesmo a pessoa tendo escolhido outra
        // coisa antes de fechar. Agora só sobrescreve quando o status
        // salvo já era "Offline" (ou nunca foi definido) — qualquer
        // status escolhido manualmente pela pessoa nunca é mexido
        // aqui, só quando ela mesma trocar de novo.
        if (user && (!user.status || user.status === 'OFFLINE')) {
          await prisma.user.update({ where: { id: userId }, data: { status: 'ONLINE' } });
        }
        broadcastPresence(io, userId);
      } else if (mobileChanged) {
        broadcastPresence(io, userId);
      }

      // BUG CORRIGIDO: até aqui, o cliente só descobria o status de outra
      // pessoa de duas formas — o retrato estático de GET /api/community
      // (tirado uma vez, na hora em que a página carregou) e os eventos
      // `presence:update` que chegassem DEPOIS disso via socket. Não havia
      // nenhuma sincronização completa ao conectar — então qualquer evento
      // perdido (uma reconexão, uma instabilidade de rede, uma troca de
      // status que aconteceu bem na janela de reconexão) deixava a pessoa
      // vendo o status ERRADO de alguém PARA SEMPRE, até esse alguém mudar
      // de status de novo por acaso. Isso batia exatamente com os dois
      // sintomas relatados: gente ativa aparecendo como "Ausente" (o
      // evento que voltaria pra Online nunca chegou) e gente offline
      // aparecendo como "Online" (o evento de OFFLINE nunca chegou).
      // Agora, toda vez que alguém conecta (abre o site, dá F5, reconecta
      // depois de cair), o servidor manda um retrato completo e atual do
      // status de todo mundo — o cliente substitui o que tinha na hora,
      // então mesmo que eventos tenham se perdido no caminho, o estado se
      // autocorrige a cada conexão/reconexão, sem depender só de eventos
      // incrementais nunca falharem.
      // Só quem está online de verdade (Redis) — antes lia TODOS os
      // usuários do banco a cada conexão. O cliente trata a lista como o
      // conjunto completo de quem está online (o resto fica offline).
      const snapshot = await buildPresenceSnapshot(userId);
      socket.emit('presence:sync', snapshot, { complete: true });

      // Item pedido: ícone de atividade (jogo/Spotify/app) na lista de
      // membros — sem isso, só quem TROCASSE de atividade DEPOIS de eu
      // já estar conectado apareceria; alguém que já estava jogando
      // ANTES de eu abrir o site nunca apareceria, já que a atividade só
      // é retransmitida ao vivo quando MUDA (ver activity:update acima),
      // não quando alguém simplesmente conecta. Só busca de quem está
      // online agora (offline nunca tem atividade de verdade) — evita
      // buscar no Redis pra todo mundo à toa.
      const onlineIds = snapshot.filter((u) => u.status !== 'OFFLINE').map((u) => u.userId);
      const activityEntries = await Promise.all(onlineIds.map(async (uid) => [uid, await activityStore.getActivity(uid)]));
      const activitiesMap = Object.fromEntries(activityEntries.filter(([, activity]) => activity));
      socket.emit('activity:sync', activitiesMap);

      // Abrir o site (ou uma nova aba/dispositivo) conta como atividade —
      // começa/reinicia a contagem de 15min pra "Ausente" e, se a pessoa
      // já estava ausente sozinha (não por escolha própria), volta pra
      // Online.
      await markActive(io, userId);
    } catch (err) {
      console.error('[socket] falha ao inicializar conexão:', err);
    }

    // SECURITY: these two used to join the room with zero access check —
    // any authenticated socket could call channel:join/conversation:join
    // with an arbitrary id it merely knew or guessed and start silently
    // receiving message:new/update/delete + typing events for a private
    // channel or someone else's DM it was never a member of. REST endpoints
    // already gate the exact same data behind assertAccess (see
    // messageController.js) — these now enforce the same rule for the
    // real-time channel. Leaving a room never needs a check (you can only
    // ever leave one you're actually in).
    // `ack` (opcional): avisa o cliente QUANDO já está na sala — ele usa
    // isso pra buscar o que chegou entre a 1ª página e a entrada na sala.
    socket.on('channel:join', async (channelId, ack) => {
      const reply = (ok) => { if (typeof ack === 'function') ack({ ok }); };
      try {
        if (!channelId) return reply(false);
        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) return reply(false);
        const perms = await getEffectivePermissions(userId, channelId, channel);
        const ok = has(perms, 'VIEW_CHANNEL');
        if (ok) socket.join(`channel:${channelId}`);
        reply(ok);
      } catch (err) { console.error('[socket] channel:join falhou:', err); reply(false); }
    });
    socket.on('channel:leave', (channelId) => {
      if (typeof channelId === 'string' && channelId) socket.leave(`channel:${channelId}`);
    });
    socket.on('conversation:join', async (conversationId, ack) => {
      const reply = (ok) => { if (typeof ack === 'function') ack({ ok }); };
      try {
        if (!conversationId) return reply(false);
        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId } },
        }).catch(() => null);
        if (member) socket.join(`conversation:${conversationId}`);
        reply(!!member);
      } catch (err) { console.error('[socket] conversation:join falhou:', err); reply(false); }
    });

    socket.on('ticket:join', async (ticketId) => {
      try {
        if (!ticketId) return;
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { authorId: true } });
        if (!ticket) return;
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
        const isStaff = ['ADMIN', 'MODERATOR'].includes(me?.platformRole);
        if (ticket.authorId === userId || isStaff) socket.join(`ticket:${ticketId}`);
      } catch (err) { console.error('[socket] ticket:join falhou:', err); }
    });

    // SECURITY: sem checar acesso aqui, alguém podia mandar
    // 'typing:start'/'typing:stop' com o ID de uma conversa/canal
    // privado que NUNCA tinha acesso de verdade (nunca passou por
    // 'channel:join'/'conversation:join', que já checam permissão —
    // ver logo acima) e ainda assim fazer o servidor retransmitir um
    // "está digitando" falso pros membros de verdade daquela sala. Não
    // vaza conteúdo nenhum, mas é uma ação sendo feita em nome de uma
    // sala que a pessoa não tem autorização de participar — o mesmo
    // princípio de ownership/autorização do resto da auditoria.
    // Resultado guardado por 30s por sala: o "digitando" dispara várias
    // vezes por mensagem e cada uma consultava o banco.
    const typingAccessCache = new Map(); // roomKey -> { ok, at }
    async function canRelayTyping({ conversationId, channelId }) {
      const key = conversationId ? `c:${conversationId}` : channelId ? `ch:${channelId}` : null;
      if (!key || typeof (conversationId || channelId) !== 'string') return false;
      const hit = typingAccessCache.get(key);
      if (hit && Date.now() - hit.at < 30000) return hit.ok;
      let ok = false;
      if (conversationId) {
        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId } },
        }).catch(() => null);
        ok = !!member;
      } else {
        const perms = await getEffectivePermissions(userId, channelId).catch(() => null);
        ok = !!perms && has(perms, 'VIEW_CHANNEL');
      }
      if (typingAccessCache.size > 100) typingAccessCache.clear();
      typingAccessCache.set(key, { ok, at: Date.now() });
      return ok;
    }
    // Limites por socket (balde de fichas): eventos baratos de mandar em
    // loop. Estourou = o evento é ignorado em silêncio.
    const typingBucket = createTokenBucket({ capacity: 10, refillPerSec: 2 });
    const presenceBucket = createTokenBucket({ capacity: 5, refillPerSec: 0.2 });
    const signalBucket = createTokenBucket({ capacity: 300, refillPerSec: 60 });
    // Reações rápidas na chamada (I): no máximo uma rajada de 5, repondo 1
    // a cada ~0,8s — suficiente pra comemorar, longe o bastante de virar spam.
    const reactionBucket = createTokenBucket({ capacity: 5, refillPerSec: 1.25 });
    socket.on('typing:start', async ({ conversationId, channelId } = {}) => {
      if (!typingBucket()) return;
      if (!(await canRelayTyping({ conversationId, channelId }))) return;
      socket.to(roomFor({ conversationId, channelId })).emit('typing:start', { userId, conversationId, channelId });
    });
    socket.on('typing:stop', async ({ conversationId, channelId } = {}) => {
      if (!typingBucket()) return;
      if (!(await canRelayTyping({ conversationId, channelId }))) return;
      socket.to(roomFor({ conversationId, channelId })).emit('typing:stop', { userId, conversationId, channelId });
    });

    socket.on('presence:set', async (status) => {
      if (!presenceBucket()) return;
      try {
        const allowed = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'];
        if (!allowed.includes(status)) return;
        await prisma.user.update({ where: { id: userId }, data: { status } });
        broadcastPresence(io, userId);
        // Escolha manual sempre vence o que o sweep de inatividade decidiu.
        onManualStatusChange(userId, status);
      } catch (err) { console.error('[socket] presence:set falhou:', err); }
    });

    // Mandado pelo cliente (throttled) enquanto a pessoa mexe na página —
    // ver SocketContext.jsx. Não muda status nenhum sozinho aqui; só
    // reinicia o relógio de 15min e desfaz um "Ausente" automático.
    socket.on('presence:activity', () => {
      markActive(io, userId).catch((err) => console.error('[socket] presence:activity falhou:', err));
    });

    // --- Voice / video call signaling (mesh WebRTC — every peer connects
    // directly to every other peer in the same voice/stage channel). The
    // server's only job is: (1) gate joins behind the CONNECT permission,
    // (2) keep a roster so newcomers know who to dial, and (3) relay
    // opaque SDP/ICE payloads between exact peers. No media ever touches
    // the server.

    socket.on('voice:join', async ({ channelId }) => {
      try {
        // DM/group-DM calls: reuse this exact same voice room/mesh/signaling
        // machinery (it's already generic — id in, room Map out) instead of
        // building a parallel system, by giving DM calls a synthetic id
        // that can never collide with a real Channel.id (`dm:<uuid>`).
        // Gated by conversation membership instead of server permissions;
        // no STAGE-style roles/capacity limit (a DM call is just "everyone
        // in the conversation who wants to join").
        if (typeof channelId === 'string' && channelId.startsWith('dm:')) {
          const conversationId = channelId.slice(3);
          const membership = await prisma.conversationMember.findUnique({
            where: { conversationId_userId: { conversationId, userId } },
          });
          if (!membership) {
            socket.emit('voice:join-denied', { channelId, reason: 'Você não faz parte desta conversa.' });
            return;
          }

          // Mesma reconciliação idempotente do canal normal, ver o
          // comentário completo mais abaixo — aqui também vale: um
          // voice:join duplicado pra uma chamada de DM que a pessoa já
          // está NUNCA deve reemitir voice:user-joined nem tocar no
          // estado de mudo/câmera/tela dela.
          const existingDmSelf = await voiceStore.getParticipant(channelId, userId);
          if (existingDmSelf) {
            // Mesma correção do canal normal — ver comentário completo
            // mais abaixo.
            if (existingDmSelf.socketId && existingDmSelf.socketId !== socket.id) {
              io.to(existingDmSelf.socketId).emit('voice:kicked-by-other-device', { channelId });
            }
            await voiceStore.updateParticipant(channelId, userId, { socketId: socket.id });
            clearVoiceGrace(userId, channelId);
            socket.join(`voice:${channelId}`);
            const roomNow = await voiceStore.getRoom(channelId);
            const rosterForSelf = Object.entries(roomNow)
              .filter(([uid]) => uid !== userId)
              .map(([uid, p]) => ({ userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role }));
            socket.emit('voice:joined', { channelId, participants: rosterForSelf, myRole: existingDmSelf.role || 'speaker' });
            return;
          }

          const isNewCall = (await voiceStore.roomSize(channelId)) === 0;
          if (isNewCall) await voiceStore.setStartedAt(channelId, Date.now());

          const otherRoomIds = await voiceStore.getActiveRoomIds();
          for (const otherChannelId of otherRoomIds) {
            if (otherChannelId !== channelId && await voiceStore.hasParticipant(otherChannelId, userId)) {
              await leaveVoice(io, socket, otherChannelId, userId);
            }
          }

          // BUG CORRIGIDO ("quando alguém entra ou sai de uma call,
          // algumas pessoas desaparecem da lista de participantes"):
          // antes, o snapshot pra mandar pro próprio usuário (via
          // 'voice:joined') era lido ANTES de gravar a própria entrada
          // no Redis. Se duas pessoas entrassem quase ao mesmo tempo, a
          // segunda podia ler o snapshot ANTES da primeira ter sido
          // gravada — ficando com uma lista sem ela — e nunca mais
          // recebia atualização nenhuma que a incluísse depois, já que
          // 'voice:user-joined' só é emitido NO MOMENTO exato da
          // entrada de alguém, não retroativamente. Corrigido lendo o
          // snapshot DEPOIS de já ter gravado a própria entrada — o
          // Redis grava de forma atômica (HSET), então isso garante que
          // pelo menos a ordem "quem entrou primeiro aparece pra quem
          // entrou depois" sempre se mantém, eliminando a janela de
          // corrida real que existia entre ler e escrever.
          // Provedor de mídia desta entrada — guardado junto pra contar os
          // minutos no provedor certo (ver services/voiceUsage.js). joinedAt
          // marca o início pra duração. O provedor ATIVO (servidor próprio →
          // LiveKit → ... → Jitsi) é decidido no servidor (voiceDecision.js).
          const dmProvider = await voiceUsage.resolveActiveProvider(channelId);
          await voiceStore.setParticipant(channelId, userId, { socketId: socket.id, conversationId, muted: false, deafened: false, video: false, screenSharing: false, role: 'speaker', provider: dmProvider, joinedAt: Date.now() });
          socket.join(`voice:${channelId}`);

          const roomAfter = await voiceStore.getRoom(channelId);
          const existingParticipants = Object.entries(roomAfter)
            .filter(([uid]) => uid !== userId)
            .map(([uid, p]) => ({
              userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role,
            }));

          socket.emit('voice:joined', { channelId, participants: existingParticipants, myRole: 'speaker' });
          socket.to(`voice:${channelId}`).emit('voice:user-joined', { channelId, userId, role: 'speaker' });

          const caller = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
          if (isNewCall) {
            // Starting a brand-new call — post the "está ligando..." embed
            // (see createCallMessage) so anyone opening this DM later, not
            // just whoever's online right now, can see a call happened.
            const messageId = await createCallMessage(io, { conversationId, callerId: userId, callerName: caller?.displayName || 'Alguém' });
            await voiceStore.setDmCallState(channelId, { messageId, conversationId, answered: false, resolved: false });
            // Rings every other participant currently online in the DM,
            // even ones not looking at this conversation right now (see the
            // client's IncomingCallBanner) — without this there's no way to
            // know someone started a call unless you already happened to
            // have it open. Only rung once, when the call actually starts —
            // ringing again on every subsequent joiner (e.g. a 3rd person
            // joining an already-answered group DM call) would just be noise.
            const otherMembers = await prisma.conversationMember.findMany({ where: { conversationId, userId: { not: userId } } });
            await Promise.all(otherMembers.map(async (m) => {
              const socketIds = await presenceStore.getSocketIds(m.userId);
              socketIds.forEach((sid) => {
                io.to(sid).emit('dm-call:ringing', { conversationId, channelId, fromUserId: userId, callerName: caller?.displayName || 'Alguém' });
              });
            }));
          } else {
            // Someone else joining an in-progress/ringing call counts as it
            // being answered — flip the embed from "está ligando..." to
            // "em andamento" once, the first time this happens.
            const state = await voiceStore.getDmCallState(channelId);
            if (state && !state.answered) {
              await voiceStore.updateDmCallState(channelId, { answered: true });
              updateCallMessage(io, { conversationId, messageId: state.messageId, description: 'Chamada em andamento', color: '#23a55a' }).catch(() => {});
            }
          }
          return;
        }

        // BUG CORRIGIDO ("ninguém aparece na call do clã"): a voz do clã
        // usa o id sintético "clan:<id>" (ver ClanPage.jsx), que não existe
        // na tabela de canais — o findUnique abaixo voltava null e a
        // entrada era ignorada em silêncio. A mídia conectava, mas o
        // servidor nunca registrava ninguém, então a lista ficava vazia.
        // Acesso: só membros do clã (mesma regra do /api/voice/join).
        let channel;
        let perms = null;
        if (typeof channelId === 'string' && channelId.startsWith('clan:')) {
          const me = await prisma.user.findUnique({ where: { id: userId }, select: { clanId: true } });
          if (!me?.clanId || me.clanId !== channelId.slice(5)) {
            socket.emit('voice:join-denied', { channelId, reason: 'Você não é membro deste clã.' });
            return;
          }
          socket.join(`clan:${me.clanId}`);
          channel = { id: channelId, type: 'VOICE', userLimit: null };
        } else {
          channel = await prisma.channel.findUnique({ where: { id: channelId } });
          if (!channel) return;
          perms = await getEffectivePermissions(userId, channelId, channel);
          if (!has(perms, 'CONNECT')) {
            socket.emit('voice:join-denied', { channelId, reason: 'Você não tem permissão para entrar neste canal.' });
            return;
          }
        }

        // IDEMPOTÊNCIA DE VERDADE (itens pedidos: "entrada idempotente",
        // "proteção contra requisições simultâneas", "evite eventos
        // duplicados"): antes, receber voice:join mais de uma vez pro
        // MESMO canal (clique duplo/triplo rápido, reenvio de rede, aba
        // duplicada) reprocessava a entrada inteira do zero toda vez —
        // reemitindo voice:user-joined pros outros de novo (ruído de rede
        // à toa) e, pior, SOBRESCREVENDO muted/deafened/video/
        // screenSharing da pessoa de volta pro estado inicial mesmo que
        // ela já tivesse mudado alguma dessas coisas depois de entrar
        // (uma corrida real: um voice:join duplicado chegando DEPOIS de
        // um voice:state podia apagar silenciosamente o estado
        // atualizado). Agora, se a pessoa JÁ é participante desse canal
        // exato, isso é tratado como uma reconciliação — nunca como uma
        // entrada nova: só atualiza qual socket é o "dono" atual (cobre
        // reconexão/refresh de página com um socket novo) e devolve o
        // roster atualizado só pra ela mesma, sem avisar mais ninguém
        // (os outros já sabem que ela está aqui) e sem tocar em nenhum
        // estado que ela já tinha configurado.
        const existingSelf = await voiceStore.getParticipant(channelId, userId);
        if (existingSelf) {
          // BUG CORRIGIDO ("entro na call de outro dispositivo e o
          // primeiro fica travado/'fantasma'"): antes disso, trocar o
          // socket "dono" da vaga era sempre feito em silêncio — pensado
          // originalmente só pra reconexão/refresh de página (mesmo
          // dispositivo, socket novo), mas isso também cobria sem querer
          // "entrar de um APARELHO diferente", que precisa de um
          // tratamento diferente: o dispositivo ANTIGO continuava achando
          // que estava conectado (mídia publicada, UI mostrando "na
          // call"), mesmo o servidor de mídia já tendo derrubado a mídia
          // dele por dentro (dois clientes com o MESMO usuário no mesmo
          // canal não é permitido). Agora, só quando é de verdade um socket
          // DIFERENTE (não um simples refresh do mesmo), avisa
          // explicitamente o dispositivo antigo pra ele sair sozinho, de
          // forma limpa — em vez de ficar "preso" numa call morta.
          if (existingSelf.socketId && existingSelf.socketId !== socket.id) {
            io.to(existingSelf.socketId).emit('voice:kicked-by-other-device', { channelId });
          }
          await voiceStore.updateParticipant(channelId, userId, { socketId: socket.id, lastActiveAt: Date.now() });
          clearVoiceGrace(userId, channelId); // reconectou dentro da tolerância
          socket.join(`voice:${channelId}`);
          const roomNow = await voiceStore.getRoom(channelId);
          const rosterForSelf = Object.entries(roomNow)
            .filter(([uid]) => uid !== userId)
            .map(([uid, p]) => ({ userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role }));
          socket.emit('voice:joined', { channelId, participants: rosterForSelf, myRole: existingSelf.role || 'speaker' });
          return;
        }

        const roomSizeBefore = await voiceStore.roomSize(channelId);
        if (roomSizeBefore === 0) await voiceStore.setStartedAt(channelId, Date.now());

        // See Channel.userLimit in schema.prisma — a entrada já tratada
        // acima (reconciliação) nunca chega até aqui, então esse "cheio"
        // só bloqueia gente genuinamente nova de verdade.
        if (channel.userLimit && roomSizeBefore >= channel.userLimit) {
          socket.emit('voice:join-denied', { channelId, reason: 'Este canal de voz está cheio.' });
          return;
        }

        // Leave any other voice channel first (Discord only lets you be in one at a time).
        const otherRoomIds = await voiceStore.getActiveRoomIds();
        for (const otherChannelId of otherRoomIds) {
          if (otherChannelId !== channelId && await voiceStore.hasParticipant(otherChannelId, userId)) {
            await leaveVoice(io, socket, otherChannelId, userId);
          }
        }

        // Stage channels start everyone as audience (muted, can't transmit)
        // except moderators (anyone who could mute/move members), who join
        // as speakers automatically — mirrors Discord's Stage behavior.
        // Plain voice channels have no audience concept, so everyone is a
        // 'speaker' there (the field is simply unused by the client).
        let role = 'speaker';
        let startMuted = false;
        if (channel.type === 'STAGE') {
          const isModerator = has(perms, 'MUTE_MEMBERS') || has(perms, 'MOVE_MEMBERS') || has(perms, 'MANAGE_CHANNELS');
          role = isModerator ? 'speaker' : 'audience';
          startMuted = role === 'audience';
        }

        // BUG CORRIGIDO ("quando alguém entra ou sai de uma call, algumas
        // pessoas desaparecem da lista de participantes") — mesma causa e
        // mesma correção do fluxo de chamada de DM acima: lê o snapshot
        // DEPOIS de já ter gravado a própria entrada no Redis, não antes,
        // eliminando a janela de corrida entre duas pessoas entrando quase
        // ao mesmo tempo (ver o comentário completo lá).
        // Provedor de mídia desta entrada + início, pra contar
        // minutos na saída (ver leaveVoice e services/voiceUsage.js). O
        // provedor ativo vem da cadeia (services/voiceDecision.js).
        const joinProvider = await voiceUsage.resolveActiveProvider(channelId);
        await voiceStore.setParticipant(channelId, userId, {
          socketId: socket.id,
          muted: startMuted, deafened: false, video: false, screenSharing: false, role,
          lastActiveAt: Date.now(),
          provider: joinProvider, joinedAt: Date.now(),
        });
        socket.join(`voice:${channelId}`);

        const roomAfter = await voiceStore.getRoom(channelId);
        const existingParticipants = Object.entries(roomAfter)
          .filter(([uid]) => uid !== userId)
          .map(([uid, p]) => ({
            userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role,
          }));

        socket.emit('voice:joined', { channelId, participants: existingParticipants, myRole: role });
        socket.to(`voice:${channelId}`).emit('voice:user-joined', { channelId, userId, role });
        await broadcastRoster(io, channelId);
      } catch (err) { console.error('[socket] voice:join falhou:', err?.message || err); }
    });

    // Reconciliação periódica (cliente em chamada manda a cada ~20s e ao
    // voltar pra aba): o servidor é a fonte da verdade. Se a pessoa ainda
    // está na sala, devolve o retrato completo (corrige qualquer evento
    // perdido: alguém que "sumiu" da tela, estado de tela/câmera velho).
    // Se não está mais (caiu, servidor reiniciou), avisa pra ela entrar
    // de novo sozinha — sem precisar sair e entrar na mão.
    socket.on('voice:sync', async ({ channelId } = {}) => {
      try {
        if (!channelId) return;
        const self = await voiceStore.getParticipant(channelId, userId);
        if (!self) { socket.emit('voice:not-in-room', { channelId }); return; }
        if (self.socketId && self.socketId !== socket.id) {
          // Outra conexão é a "dona" da vaga. Se ela ainda está viva, é
          // outro dispositivo de verdade — este aqui sai. Se já morreu
          // (reconexão cujo voice:join se perdeu), adota a vaga.
          const alive = await io.in(self.socketId).fetchSockets().catch(() => []);
          if (alive.length > 0) { socket.emit('voice:kicked-by-other-device', { channelId }); return; }
          await voiceStore.updateParticipant(channelId, userId, { socketId: socket.id });
        }
        clearVoiceGrace(userId, channelId);
        socket.join(`voice:${channelId}`);
        const roomNow = await voiceStore.getRoom(channelId);
        const list = Object.entries(roomNow)
          .filter(([uid]) => uid !== userId)
          .map(([uid, p]) => ({ userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role }));
        socket.emit('voice:joined', { channelId, participants: list, myRole: self.role || 'speaker', sync: true });
        ytWatch.sendState(socket, channelId); // "Assistir juntos": estado atual do vídeo
      } catch (err) { console.error('[socket] voice:sync falhou:', err?.message || err); }
    });

    // BUG CORRIGIDO ("abro o site e diz que não tem ninguém na call, mas
    // tem gente"): a lista de quem está em cada canal de voz só chegava
    // quando ALGUÉM entrava/saía depois que você conectou — nunca existia
    // um retrato inicial. Quem abria/recarregava o site via todas as
    // salas vazias até a próxima mudança. O cliente pede isso ao conectar
    // (e a cada reconexão) e substitui o que tinha.
    socket.on('voice:rosters', async () => {
      try {
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { clanId: true } });
        const out = {};
        for (const channelId of await voiceStore.getActiveRoomIds()) {
          if (channelId.startsWith('dm:')) continue; // chamadas de DM são privadas
          if (channelId.startsWith('clan:') && channelId !== `clan:${me?.clanId}`) continue;
          // Canal que a pessoa não pode VER: não revela quem está nele.
          if (!channelId.startsWith('clan:')) {
            // eslint-disable-next-line no-await-in-loop
            const perms = await getEffectivePermissions(userId, channelId).catch(() => null);
            if (!perms || !has(perms, 'VIEW_CHANNEL')) continue;
          }
          const room = await voiceStore.getRoom(channelId);
          const participants = Object.entries(room).map(([uid, p]) => ({
            userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role,
          }));
          if (participants.length === 0) continue;
          out[channelId] = { participants, startedAt: (await voiceStore.getStartedAt(channelId)) || null };
        }
        socket.emit('voice:rosters', out);
      } catch (err) { console.error('[socket] voice:rosters falhou:', err?.message || err); }
    });

    // --- Stage channel speaker/audience management ---

    // YouTube "Assistir juntos" na chamada (yt:open/play/pause/seek/next/close/queue:add) — ver ytWatch.js.
    ytWatch.register(io, socket, userId);

    socket.on('voice:raise-hand', async ({ channelId, raised }) => {
      // Checa se a pessoa está mesmo na sala (o roster já mora no Redis
      // — ver services/voiceRoomStore.js) — sem isso, qualquer um
      // conseguiria mandar uma "mão levantada" falsa pra um canal que
      // nunca entrou de verdade.
      if (!(await voiceStore.hasParticipant(channelId, userId))) return;
      io.to(`voice:${channelId}`).emit('voice:hand-raised', { channelId, userId, raised: !!raised });
    });

    socket.on('voice:set-role', async ({ channelId, userId: targetUserId, role }) => {
      try {
        const target = await voiceStore.getParticipant(channelId, targetUserId);
        if (!target) return;
        const nextRole = role === 'speaker' ? 'speaker' : 'audience';

        // Anyone can voluntarily step down to the audience; only moderators
        // can promote someone else (or demote someone else) on the stage.
        const isSelfDemote = targetUserId === userId && nextRole === 'audience';
        if (!isSelfDemote) {
          const channel = await prisma.channel.findUnique({ where: { id: channelId } });
          if (!channel) return;
          const perms = await getEffectivePermissions(userId, channelId, channel);
          const isModerator = has(perms, 'MUTE_MEMBERS') || has(perms, 'MOVE_MEMBERS') || has(perms, 'MANAGE_CHANNELS');
          if (!isModerator) return;
        }

        // Demoting force-mutes (audience can't transmit); promoting to
        // speaker clears the forced mute so the newly-invited speaker can
        // talk immediately without an extra manual unmute step.
        const updated = await voiceStore.updateParticipant(channelId, targetUserId, { role: nextRole, muted: nextRole === 'audience' });
        io.to(`voice:${channelId}`).emit('voice:role-update', { channelId, userId: targetUserId, role: updated.role, muted: updated.muted });
        await broadcastRoster(io, channelId);
      } catch (err) { /* ignore malformed signaling */ }
    });

    // BUG CORRIGIDO ("entro pelo celular e o PC me derruba da call"): o
    // dispositivo antigo recebe voice:kicked-by-other-device, sai e manda
    // voice:leave — que removia a vaga que JÁ era do dispositivo novo.
    // Agora só sai de verdade quem é o dono atual da vaga.
    socket.on('voice:leave', async ({ channelId } = {}) => {
      try {
        const p = await voiceStore.getParticipant(channelId, userId);
        if (p && p.socketId && p.socketId !== socket.id) {
          const owner = await io.in(p.socketId).fetchSockets().catch(() => []);
          if (owner.length > 0) { socket.leave(`voice:${channelId}`); return; }
        }
        clearVoiceGrace(userId, channelId);
        await leaveVoice(io, socket, channelId, userId);
      } catch (err) { console.error('[socket] voice:leave falhou:', err?.message || err); }
    });

    // Callee explicitly declined an incoming DM call without ever joining
    // the voice room (see the client's IncomingCallBanner "Recusar" button)
    // — distinct from voice:leave, since the person rejecting was never a
    // room participant in the first place. Tells every tab of every member
    // of the conversation to drop the ringing UI right away, and — if
    // nobody else has answered yet either — settles the call's chat embed
    // as missed instead of leaving it stuck on "está ligando..." until the
    // caller eventually gives up and hangs up on their own.
    socket.on('dm-call:reject', async ({ conversationId }) => {
      try {
        if (!conversationId) return;
        io.to(`conversation:${conversationId}`).emit('dm-call:declined', { conversationId, byUserId: userId });
        const channelId = `dm:${conversationId}`;
        const state = await voiceStore.getDmCallState(channelId);
        if (state && !state.answered && !state.resolved) {
          const size = await voiceStore.roomSize(channelId);
          if (size <= 1) {
            await voiceStore.updateDmCallState(channelId, { resolved: true });
            await updateCallMessage(io, { conversationId, messageId: state.messageId, description: 'Chamada perdida', color: '#ed4245' });
          }
        }
      } catch (err) { console.error('[socket] dm-call:reject falhou:', err); }
    });

    socket.on('voice:signal', async ({ channelId, to, data } = {}) => {
      if (!signalBucket()) return;
      // The sender must themselves be a legitimate participant of this
      // voice room, not just the target — otherwise anyone could inject
      // arbitrary WebRTC signaling data into any active call by naming a
      // participant's userId, impersonating a peer that was never dialed.
      if (!(await voiceStore.hasParticipant(channelId, userId))) return;
      const target = await voiceStore.getParticipant(channelId, to);
      if (!target) return;
      io.to(target.socketId).emit('voice:signal', { channelId, from: userId, data });
    });

    // Som de entrada (Configurações → Voz e vídeo): ao entrar numa call, a
    // pessoa pode tocar um efeito curto pra todo mundo da sala. Só sons da
    // lista fixa (sintetizados no cliente), no máximo 1 a cada 20s.
    const ENTRY_SOUNDS = new Set(['tada', 'oi', 'fanfarra', 'moeda', 'portal', 'sino', 'buzina', 'pulo', 'magia', 'tambor']);
    let lastEntrySound = 0;
    socket.on('voice:entry-sound', async ({ channelId, sound } = {}) => {
      if (!ENTRY_SOUNDS.has(sound) || typeof channelId !== 'string') return;
      if (Date.now() - lastEntrySound < 20000) return;
      if (!socket.rooms.has(`voice:${channelId}`)) return;
      lastEntrySound = Date.now();
      socket.to(`voice:${channelId}`).emit('voice:entry-sound', { channelId, userId, sound });
    });

    socket.on('voice:state', async ({ channelId, muted, deafened, video, screenSharing }) => {
      const patch = {};
      if (muted !== undefined) patch.muted = !!muted;
      if (deafened !== undefined) patch.deafened = !!deafened;
      if (video !== undefined) patch.video = !!video;
      if (screenSharing !== undefined) patch.screenSharing = !!screenSharing;
      const updated = await voiceStore.updateParticipant(channelId, userId, patch);
      if (!updated) return;
      // Bug fix: this used to be `io.to(...)`, which includes the sender —
      // your own client would receive its own mute/camera/audio toggle back
      // as if it were a state update from "another participant" with your
      // same user id, and the voice view's tile grid (which already always
      // shows yourself from local state) would render a second, ghost tile
      // for that duplicate participants-map entry. `socket.to(...)` sends to
      // everyone else in the room *except* the socket that triggered it.
      socket.to(`voice:${channelId}`).emit('voice:state', {
        channelId, userId, muted: updated.muted, deafened: updated.deafened,
        video: updated.video, screenSharing: updated.screenSharing,
      });
      // BUG CORRIGIDO ("está transmitindo mas não aparece na prévia"):
      // mudo/câmera/tela nunca atualizavam a lista pública das salas
      // (barra lateral, prévia do canal) — só quem já estava dentro via.
      if (patch.video !== undefined || patch.screenSharing !== undefined || patch.muted !== undefined) {
        broadcastRoster(io, channelId).catch(() => {});
      }
    });

    // High-frequency, ephemeral — not persisted in the roster, just relayed
    // live. Relayed to two audiences: the `voice:${channelId}` room (actual
    // call participants — drives the green ring on the tiles grid) AND the
    // wider `server:${serverId}` room (every server member, even ones just
    // browsing text channels — drives the same indicator in the channel
    // sidebar's voice roster). `.to().to()` unions the two rooms so anyone
    // in both only gets the event once.
    socket.on('voice:speaking', async ({ channelId, speaking }) => {
      if (!(await voiceStore.hasParticipant(channelId, userId))) return;
      // Só falar de fato conta como atividade pro AFK sweep abaixo.
      if (speaking) await voiceStore.updateParticipant(channelId, userId, { lastActiveAt: Date.now() });
      const target = socket.to(`voice:${channelId}`).to(rosterRoomFor(channelId));
      target.emit('voice:speaking', { channelId, userId, speaking: !!speaking });
    });

    // Reações rápidas (I): emoji flutuante que todos na chamada veem.
    // Efêmero, não fica guardado em lugar nenhum — só retransmitido ao
    // vivo pra sala. Validado (só a lista fixa de emojis) e com limite
    // anti-spam por socket. Precisa estar MESMO na sala pra reagir.
    socket.on('voice:reaction', async ({ channelId, emoji } = {}) => {
      if (!voiceExtras.isValidReaction(emoji)) return;
      if (!reactionBucket()) return;
      if (!(await voiceStore.hasParticipant(channelId, userId))) return;
      // Inclui o próprio remetente (io.to): a reação dele também flutua na
      // tela dele, igual pros outros.
      io.to(`voice:${channelId}`).emit('voice:reaction', { channelId, userId, emoji });
    });

    // ---------- Gravação com consentimento (N) ----------
    // Só começa DEPOIS que todos os presentes aceitaram. Qualquer recusa
    // cancela. Nunca grava escondido.
    socket.on('voice:recording-request', async ({ channelId } = {}) => {
      try {
        if (!(await voiceStore.hasParticipant(channelId, userId))) return;
        // Um pedido de cada vez por canal.
        const active = recordingRequests.get(channelId);
        if (active && (active.status === 'pending' || active.status === 'recording')) {
          socket.emit('voice:recording-denied', { channelId, reason: 'Já existe uma gravação ou um pedido em andamento.' });
          return;
        }
        const room = await voiceStore.getRoom(channelId);
        const participantIds = Object.keys(room);
        const me = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
        const request = voiceExtras.createRecordingRequest({
          requesterId: userId, requesterName: me?.displayName || 'Alguém', participantIds,
        });
        // Sala só com uma pessoa: já pode gravar (só ela mesma).
        if (voiceExtras.allAccepted(request)) {
          request.status = 'recording';
          recordingRequests.set(channelId, request);
          io.to(`voice:${channelId}`).emit('voice:recording-started', { channelId, byUserId: userId, byName: request.requesterName });
          return;
        }
        recordingRequests.set(channelId, request);
        // Pede o consentimento visível pra todo mundo na sala.
        io.to(`voice:${channelId}`).emit('voice:recording-prompt', {
          channelId, requesterId: userId, requesterName: request.requesterName,
        });
      } catch (err) { console.error('[socket] voice:recording-request falhou:', err?.message || err); }
    });

    socket.on('voice:recording-consent', async ({ channelId, accepted } = {}) => {
      try {
        const active = recordingRequests.get(channelId);
        if (!active || active.status !== 'pending') return;
        if (!(await voiceStore.hasParticipant(channelId, userId))) return;
        const next = voiceExtras.applyConsent(active, userId, !!accepted);
        recordingRequests.set(channelId, next);
        io.to(`voice:${channelId}`).emit('voice:recording-consent-update', {
          channelId, userId, accepted: !!accepted,
        });
        if (next.status === 'recording') {
          io.to(`voice:${channelId}`).emit('voice:recording-started', {
            channelId, byUserId: next.requesterId, byName: next.requesterName,
          });
        } else if (next.status === 'denied') {
          recordingRequests.delete(channelId);
          io.to(`voice:${channelId}`).emit('voice:recording-denied', {
            channelId, byUserId: userId, reason: 'Alguém não permitiu a gravação.',
          });
        }
      } catch (err) { console.error('[socket] voice:recording-consent falhou:', err?.message || err); }
    });

    socket.on('voice:recording-stop', async ({ channelId } = {}) => {
      try {
        const active = recordingRequests.get(channelId);
        if (!active) return;
        // Só quem iniciou pode parar a própria gravação.
        if (String(active.requesterId) !== String(userId)) return;
        recordingRequests.delete(channelId);
        io.to(`voice:${channelId}`).emit('voice:recording-stopped', { channelId, byUserId: userId });
      } catch (err) { console.error('[socket] voice:recording-stop falhou:', err?.message || err); }
    });

    // Item pedido: "Rich Presence" (jogo/Spotify) — só o app de desktop
    // (Electron) manda isso de verdade, já que só ele tem acesso ao
    // sistema operacional pra detectar isso (ver desktop/main.js). O
    // formato é sempre { type: 'game'|'spotify', name, imageUrl,
    // startedAt, detail? } ou null (parou de jogar/ouvir). Retransmite
    // pra sala "community" — o mesmo canal amplo que presença/status
    // customizado já usa, então quem já escuta um já escuta o outro.
    socket.on('activity:update', async (activity) => {
      if (activity && typeof activity === 'object') {
        // Nunca confia cegamente no que o cliente manda além do formato
        // esperado — corta qualquer campo extra e limita tamanho de
        // texto, mesmo sendo um dado de baixo risco (só aparece pro
        // próprio usuário e amigos, nunca decide permissão nenhuma).
        const clean = {
          type: ['spotify', 'app'].includes(activity.type) ? activity.type : 'game',
          name: String(activity.name || '').slice(0, 120),
          detail: activity.detail ? String(activity.detail).slice(0, 120) : undefined,
          // Item pedido: capa de álbum de verdade — quando é do
          // Spotify, imageUrl vem como uma "data URL" (a imagem
          // inteira em base64, embutida no texto), bem maior que uma
          // URL comum — precisa de um limite bem mais generoso que os
          // outros tipos (logo de jogo/app, que são links curtos de
          // verdade). 300KB de string já cobre uma capa de álbum
          // pequena com folga.
          imageUrl: activity.imageUrl ? String(activity.imageUrl).slice(0, 300000) : undefined,
          startedAt: Number.isFinite(activity.startedAt) ? activity.startedAt : Date.now(),
          durationMs: Number.isFinite(activity.durationMs) ? activity.durationMs : undefined,
          progressMs: Number.isFinite(activity.progressMs) ? activity.progressMs : undefined,
        };
        // Capa do jogo da Steam: o desktop manda o AppID (ou ele sai do
        // link da arte, em versões antigas do app) — ver utils/steamCover.js.
        if (clean.type === 'game') clean.steamAppId = steamAppIdOf(activity) || undefined;
        // Biblioteca de jogos: cada aviso é um batimento de tempo de jogo.
        // Só conta jogo (nunca Spotify/apps); playingGame = jogo rodando por
        // trás quando o que aparece é música/app (ver activityDetector.js).
        const playing = clean.type === 'game' ? clean : (activity.playingGame && typeof activity.playingGame === 'object' ? activity.playingGame : null);
        gamePlaytime.recordBeat(userId, playing);
        // ECONOMIA DE REDE: o app de desktop reconfirma a mesma atividade
        // de tempos em tempos (Spotify a cada poucos segundos). Se nada
        // mudou de verdade (mesma música/jogo e o progresso bate com o
        // tempo que passou), só renova a validade no Redis — sem
        // retransmitir pra comunidade inteira a cada reenvio.
        const prev = await activityStore.getActivity(userId).catch(() => null);
        if (prev && sameActivity(prev, clean)) {
          await activityStore.setActivity(userId, clean.type === 'spotify' ? clean : prev);
          return;
        }
        // Jogo sem AppID (fora da Steam ou app de desktop antigo): se a
        // biblioteca de jogos da pessoa já descobriu o AppID desse jogo
        // (gamePlaytime.fillSteamAppId, pelo nome), usa a mesma capa.
        // Só roda quando a atividade MUDA (não a cada reconfirmação).
        if (clean.type === 'game' && !clean.steamAppId && clean.name) {
          const known = await prisma.gamePlaytime.findUnique({
            where: { userId_gameKey: { userId, gameKey: gamePlaytime.gameKeyFor(clean.name) } },
            select: { steamAppId: true },
          }).catch(() => null);
          if (known?.steamAppId) clean.steamAppId = known.steamAppId;
        }
        await activityStore.setActivity(userId, clean);
        await broadcastActivityChange(io, userId, clean);
      } else {
        gamePlaytime.recordBeat(userId, null);
        await activityStore.clearActivity(userId);
        await broadcastActivityChange(io, userId, null);
      }
    });

    // Registrado só aqui embaixo, DEPOIS dos awaits do início da conexão:
    // se a conexão caiu no meio deles, o evento 'disconnect' já passou e
    // nunca chegaria a este handler — o socket morto ficava registrado na
    // presença (uma das causas do "corrigido X: ONLINE -> OFFLINE"). Por
    // isso, se já estiver desconectado, roda a limpeza na hora.
    const onDisconnect = async () => {
      try {
        // BUG CORRIGIDO ("some da call mesmo continuando conectado"):
        // (1) qualquer socket da pessoa que caísse (outra aba, o app de
        // desktop aberto junto, um F5 em outra janela) tirava ela da
        // chamada — mesmo a chamada estando em OUTRA conexão. Agora só
        // conta a queda da conexão dona da vaga. (2) Uma queda rápida de
        // rede (o socket.io reconecta em segundos, e o áudio da chamada
        // nem cai) removia a pessoa na hora e a fazia "piscar" pra todo
        // mundo. Agora espera VOICE_GRACE_MS: se ela reconectar (voice:join
        // ou voice:sync), o timer é cancelado e ninguém percebe nada.
        for (const channelId of await voiceStore.getActiveRoomIds()) {
          const p = await voiceStore.getParticipant(channelId, userId);
          if (!p || (p.socketId && p.socketId !== socket.id)) continue;
          scheduleVoiceGrace(userId, channelId, socket.id);
        }

        const remaining = await presenceStore.removeSocket(userId, socket.id);
        if (remaining === 0) {
          // Sem nenhum dispositivo conectado, não faz sentido continuar
          // mostrando "jogando X" pra ninguém — o app de desktop que
          // mandava isso também caiu junto (é o mesmo processo).
          await activityStore.clearActivity(userId);
          await broadcastActivityChange(io, userId, null);
          gamePlaytime.flushUser(userId); // grava o tempo de jogo acumulado
          // Ninguém mais conectado nessa conta — não faz sentido continuar
          // contando os 15min pra "Ausente" (vai ficar OFFLINE daqui a
          // pouco de qualquer jeito, ver timer logo abaixo).
          clearIdleTimer(userId);
          clearAutoOfflineTimer(userId);
          autoIdledUsers.delete(userId);
          // Don't broadcast OFFLINE immediately — this exact socket
          // dropping doesn't necessarily mean the person left; it's just
          // as often a page navigation inside the SPA, the mobile app
          // being backgrounded for a moment, or a brief network blip that
          // socket.io-client is about to auto-reconnect from on its own.
          // Wait a short grace period; if a new connection for this same
          // user shows up in that window (see the `connection` handler's
          // pendingOfflineTimers cancel above), this timer gets cleared
          // and nobody ever sees them flicker offline. If it fires, they
          // really are gone and everyone else should be told.
          if (pendingOfflineTimers.has(userId)) clearTimeout(pendingOfflineTimers.get(userId));
          const timer = setTimeout(async () => {
            pendingOfflineTimers.delete(userId);
            // Callback de timer: sem try, um Redis fora do ar em isOnline()
            // virava unhandledRejection (nada mais pega esse erro).
            try {
              if (await presenceStore.isOnline(userId)) return; // reconnected in the meantime after all
              await prisma.user.update({ where: { id: userId }, data: { status: 'OFFLINE' } }).catch(() => {});
              broadcastPresence(io, userId);
            } catch (err) { console.error('[socket] marcar offline falhou:', err?.message || err); }
          }, OFFLINE_GRACE_MS);
          pendingOfflineTimers.set(userId, timer);
        }
      } catch (err) { console.error('[socket] disconnect cleanup falhou:', err); }
    };
    if (socket.disconnected) onDisconnect();
    else socket.on('disconnect', onDisconnect);
  });

  // ---------- Tolerância de queda de conexão em chamadas de voz ----------
  const VOICE_GRACE_MS = 12000;
  const voiceGraceTimers = new Map(); // `${userId}|${channelId}` -> timeout
  function clearVoiceGrace(userId, channelId) {
    const key = `${userId}|${channelId}`;
    if (voiceGraceTimers.has(key)) { clearTimeout(voiceGraceTimers.get(key)); voiceGraceTimers.delete(key); }
  }
  function scheduleVoiceGrace(userId, channelId, deadSocketId) {
    clearVoiceGrace(userId, channelId);
    const key = `${userId}|${channelId}`;
    voiceGraceTimers.set(key, setTimeout(async () => {
      voiceGraceTimers.delete(key);
      try {
        const p = await voiceStore.getParticipant(channelId, userId);
        // Já voltou com outro socket (ou já saiu) — nada a fazer.
        if (!p || (p.socketId && p.socketId !== deadSocketId)) return;
        await leaveVoice(io, null, channelId, userId);
      } catch (err) { console.error('[socket] limpeza de voz atrasada falhou:', err?.message || err); }
    }, VOICE_GRACE_MS));
  }

  // Quem recebe a lista de participantes de cada sala: canais normais vão
  // pra comunidade toda; voz de clã só pro clã; chamada de DM só pra
  // conversa (antes ia pra comunidade inteira — vazava quem estava em
  // chamada privada).
  function rosterRoomFor(channelId) {
    if (channelId.startsWith('dm:')) return `conversation:${channelId.slice(3)}`;
    if (channelId.startsWith('clan:')) return `clan:${channelId.slice(5)}`;
    return 'community';
  }

  // Varredura de "fantasmas": participante cujo socket não existe mais em
  // lugar nenhum (servidor caiu no meio, evento de desconexão perdido) e
  // que não está na tolerância acima. Sem isso a pessoa ficava pra sempre
  // na lista mesmo fora da chamada.
  setInterval(async () => {
    try {
      for (const channelId of await voiceStore.getActiveRoomIds()) {
        const room = await voiceStore.getRoom(channelId);
        for (const [uid, p] of Object.entries(room)) {
          if (voiceGraceTimers.has(`${uid}|${channelId}`)) continue;
          // eslint-disable-next-line no-await-in-loop
          const alive = p.socketId ? await io.in(p.socketId).fetchSockets().catch(() => [1]) : [];
          if (alive.length === 0) {
            console.log(`[voz] removendo participante fantasma ${uid} de ${channelId}`);
            await leaveVoice(io, null, channelId, uid);
          }
        }
      }
    } catch (err) { console.error('[socket] varredura de voz falhou:', err?.message || err); }
  }, 30 * 1000);

  async function leaveVoice(io, socket, channelId, userId) {
    const participant = await voiceStore.getParticipant(channelId, userId);
    if (!participant) return;
    const { conversationId } = participant;
    // Contabilidade de uso por PROVEDOR: agora é feita pelo ticker de
    // minutos-participante (voiceUsage.startProviderUsageTicker, ligado no
    // index.js), que a cada minuto soma as pessoas ativas ao provedor ATIVO
    // daquele minuto — a métrica certa pros limites gratuitos de cada
    // serviço (LiveKit/Daily/...). Não é mais contada aqui na saída.
    const remaining = await voiceStore.removeParticipant(channelId, userId);
    if (socket) socket.leave(`voice:${channelId}`);
    else if (participant.socketId) io.in(participant.socketId).socketsLeave(`voice:${channelId}`);
    io.to(`voice:${channelId}`).emit('voice:user-left', { channelId, userId });
    // Gravação com consentimento (N): se a pessoa saiu no meio de um
    // pedido pendente, tira o voto dela — e se os que sobraram já tinham
    // todos aceitado, a gravação começa (ou, se não sobrou ninguém, o
    // pedido some). Se ela era quem estava gravando, para a gravação.
    const rec = recordingRequests.get(channelId);
    if (rec) {
      if (rec.status === 'recording' && String(rec.requesterId) === String(userId)) {
        recordingRequests.delete(channelId);
        io.to(`voice:${channelId}`).emit('voice:recording-stopped', { channelId, byUserId: userId });
      } else if (rec.status === 'pending') {
        const next = voiceExtras.dropParticipant(rec, userId);
        if (next.status === 'recording') {
          recordingRequests.set(channelId, next);
          io.to(`voice:${channelId}`).emit('voice:recording-started', { channelId, byUserId: next.requesterId, byName: next.requesterName });
        } else if (next.status === 'cancelled') {
          recordingRequests.delete(channelId);
        } else {
          recordingRequests.set(channelId, next);
        }
      }
    }
    if (remaining === 0) {
      recordingRequests.delete(channelId);
      await voiceStore.deleteRoom(channelId);
      ytWatch.clearIfEmpty(channelId);
      // Last person just left a DM call room — resolve its chat message
      // (see createCallMessage/updateCallMessage) to whatever actually
      // happened: nobody ever answered -> "Chamada perdida", someone did
      // answer at some point -> "Chamada encerrada". Guarded by `resolved`
      // so an explicit dm-call:reject a moment earlier (which already
      // settled it as missed/declined) doesn't get silently overwritten.
      if (channelId.startsWith('dm:')) {
        const state = await voiceStore.getDmCallState(channelId);
        if (state && !state.resolved) {
          await voiceStore.updateDmCallState(channelId, { resolved: true });
          const description = state.answered ? 'Chamada encerrada' : 'Chamada perdida';
          const color = state.answered ? '#5865f2' : '#ed4245';
          updateCallMessage(io, { conversationId: conversationId || state.conversationId, messageId: state.messageId, description, color }).catch(() => {});
        }
        await voiceStore.clearDmCallState(channelId);
        io.to(`conversation:${conversationId}`).emit('dm-call:ended', { conversationId });
      }
    }
    await broadcastRoster(io, channelId);
  }

  // Creates/edits the single "📞 Chamada de voz" embed message that
  // represents a DM call's whole lifecycle in the conversation (see
  // voiceRoomStore's DM call state comment above). Uses the exact same `messageInclude`
  // shape messageController.js's REST endpoints already return, so the
  // client's normal message:new/message:update handling (built for that
  // shape) needs no special-casing for these.
  async function createCallMessage(io, { conversationId, callerId, callerName }) {
    const message = await prisma.message.create({
      data: {
        authorId: callerId,
        conversationId,
        embed: JSON.stringify({
          title: '📞 Chamada de voz',
          description: `${callerName} está ligando...`,
          color: '#23a55a',
        }),
      },
      include: messageInclude,
    });
    io.to(`conversation:${conversationId}`).emit('message:new', message);
    return message.id;
  }

  async function updateCallMessage(io, { conversationId, messageId, description, color }) {
    if (!messageId) return;
    try {
      const message = await prisma.message.update({
        where: { id: messageId },
        data: { embed: JSON.stringify({ title: '📞 Chamada de voz', description, color }) },
        include: messageInclude,
      });
      io.to(`conversation:${conversationId}`).emit('message:update', message);
    } catch (err) {
      // Message may have been deleted meanwhile (e.g. conversation cleared) — not fatal.
    }
  }

  async function broadcastRoster(io, channelId) {
    const room = await voiceStore.getRoom(channelId);
    const participants = Object.entries(room).map(([uid, p]) => ({
      userId: uid, muted: p.muted, deafened: p.deafened, video: p.video, screenSharing: p.screenSharing, role: p.role,
    }));
    const startedAt = await voiceStore.getStartedAt(channelId);
    let target = rosterRoomFor(channelId);
    // Canal de voz privado/restrito: a lista só vai pra quem está dentro
    // da chamada (antes ia pra comunidade inteira).
    if (target === 'community' && await isRestrictedChannel(channelId).catch(() => false)) target = `voice:${channelId}`;
    io.to(target).emit('voice:roster', { channelId, participants, startedAt: startedAt || null });
  }

  // ---------- Ausência automática por inatividade (15min -> 4h offline) ----------

  function clearIdleTimer(userId) {
    if (idleTimers.has(userId)) {
      clearTimeout(idleTimers.get(userId));
      idleTimers.delete(userId);
    }
  }

  function clearAutoOfflineTimer(userId) {
    if (idleToOfflineTimers.has(userId)) {
      clearTimeout(idleToOfflineTimers.get(userId));
      idleToOfflineTimers.delete(userId);
    }
  }

  // Começa a contar as 4h que, se ninguém mexer em nada, transformam um
  // "Ausente" automático em OFFLINE (ver comentário grande no topo do
  // arquivo, perto de IDLE_TO_OFFLINE_MS). Chamado só pelo próprio
  // scheduleIdleTimer, no momento exato em que a pessoa acabou de virar
  // Ausente sozinha — nunca chamado direto de fora.
  function scheduleAutoOfflineTimer(io, userId) {
    clearAutoOfflineTimer(userId);
    const timer = setTimeout(async () => {
      idleToOfflineTimers.delete(userId);
      try {
        // Só efetiva se NADA mudou nesse meio tempo: ainda conectada, o
        // status automático ainda é o mesmo "Ausente" de antes (não virou
        // Não perturbe/Invisível/Online na mão), e ainda está marcada
        // como auto-ausente (uma troca manual qualquer já teria tirado
        // daqui, ver onManualStatusChange).
        if (!autoIdledUsers.has(userId)) return;
        if (!(await presenceStore.isOnline(userId))) return;
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
        if (user?.status === 'IDLE') {
          await prisma.user.update({ where: { id: userId }, data: { status: 'OFFLINE' } });
          // Continua em autoIdledUsers de propósito — é o que faz
          // markActive() saber, mais tarde, que esse OFFLINE também foi
          // automático e pode voltar pra ONLINE sozinho na próxima
          // atividade, em vez de ficar OFFLINE até alguém mudar na mão.
          broadcastPresence(io, userId);
        }
      } catch (err) { console.error('[socket] falha ao marcar offline por ausência prolongada:', err); }
    }, IDLE_TO_OFFLINE_MS);
    idleToOfflineTimers.set(userId, timer);
  }

  // (Re)inicia a contagem de 15min. Quando o tempo esgota, só marca
  // "Ausente" se o status atual for exatamente ONLINE — quem está em Não
  // perturbe/Invisível/Ausente (manual) fica intocado.
  function scheduleIdleTimer(io, userId) {
    clearIdleTimer(userId);
    const timer = setTimeout(async () => {
      idleTimers.delete(userId);
      try {
        if (!(await presenceStore.isOnline(userId))) return; // já desconectou nesse meio tempo
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
        if (user?.status === 'ONLINE') {
          await prisma.user.update({ where: { id: userId }, data: { status: 'IDLE', autoIdle: true } });
          autoIdledUsers.add(userId);
          broadcastPresence(io, userId);
          scheduleAutoOfflineTimer(io, userId);
        }
      } catch (err) { console.error('[socket] falha ao marcar ausência automática:', err); }
    }, IDLE_TIMEOUT_MS);
    idleTimers.set(userId, timer);
  }

  // Chamado a cada conexão nova e a cada 'presence:activity' — reinicia o
  // relógio de 15min e, se a pessoa tinha sido marcada Ausente (ou depois
  // Offline, pela ausência prolongada de 4h) sozinha por este mesmo
  // mecanismo — não por escolha própria —, volta pra Online.
  // BUG CORRIGIDO ("fico ausente e, quando mando mensagem/abro menu, não
  // volta pro online"): quem foi posto Ausente sozinho ficava marcado só
  // na memória (autoIdledUsers) — qualquer reinício do servidor (todo
  // deploy) apagava isso, e a pessoa ficava presa em Ausente até trocar na
  // mão. Agora a marca também fica no banco (User.autoIdle).
  async function markActive(io, userId) {
    scheduleIdleTimer(io, userId);
    clearAutoOfflineTimer(userId);
    const inMemory = autoIdledUsers.delete(userId);
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, autoIdle: true } });
      if (!user || (!inMemory && !user.autoIdle)) return;
      if (user.status === 'IDLE' || user.status === 'OFFLINE') {
        await prisma.user.update({ where: { id: userId }, data: { status: 'ONLINE', autoIdle: false } });
        broadcastPresence(io, userId);
      } else if (user.autoIdle) {
        await prisma.user.update({ where: { id: userId }, data: { autoIdle: false } });
      }
    } catch (err) { console.error('[socket] falha ao voltar de ausência automática:', err); }
  }

  // Chamado sempre que o status muda por ação explícita da pessoa
  // (dropdown no cliente, seja via socket presence:set ou via
  // PATCH /users/me/status): a escolha manual sempre vence o automático.
  function onManualStatusChange(userId, status) {
    autoIdledUsers.delete(userId);
    prisma.user.update({ where: { id: userId }, data: { autoIdle: false } }).catch(() => {});
    clearAutoOfflineTimer(userId);
    if (status === 'ONLINE') {
      // Escolher "Online" na mão também conta como atividade.
      scheduleIdleTimer(io, userId);
    } else {
      // Ausente/Não perturbe/Invisível escolhidos na mão não devem virar
      // Online sozinhos só porque a pessoa mexeu no mouse — e (Ausente
      // manual em particular) nunca deve virar Offline sozinho depois de
      // 4h, já que esse relógio só roda pra quem entrou em Ausente pela
      // inatividade, nunca por escolha própria.
      clearIdleTimer(userId);
    }
  }

  // Um emit global (os clientes filtram), com payload mínimo. "Invisível"
  // só vai cru pra própria pessoa (todas as abas dela); pros outros é
  // "Offline".
  function emitPresence(io, user) {
    if (!user) return;
    const payload = { userId: user.id, status: user.status, customStatus: user.customStatus ?? null, mobile: user.status !== 'OFFLINE' && devicePresence.onMobile(user.id) };
    if (user.status === 'INVISIBLE') {
      io.to(`user:${user.id}`).emit('presence:update', payload);
      io.except(`user:${user.id}`).emit('presence:update', { ...payload, status: 'OFFLINE', mobile: false });
    } else {
      io.emit('presence:update', payload);
    }
  }
  // Chamado "solto" (sem await) em vários lugares: sem o try, uma falha
  // passageira do banco aqui virava unhandledRejection a cada chamada.
  async function broadcastPresence(io, userId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, customStatus: true } });
      if (user) emitPresence(io, user);
    } catch (err) { console.error('[presença] broadcast falhou:', err?.message || err); }
  }

  function roomFor({ conversationId, channelId }) {
    return conversationId ? `conversation:${conversationId}` : `channel:${channelId}`;
  }

  // Small helper surface used by REST controllers (attached to the Express app).
  io.notifyUser = (userId, event, payload) => io.to(`user:${userId}`).emit(event, payload);
  // Excluir conta (painel de staff) — força a saída de qualquer sessão
  // ativa dessa conta em todos os dispositivos, na hora, depois que os
  // dados já foram apagados do banco (nunca antes — ver
  // adminController.deleteUserAccount). `fetchSockets()` traz os sockets
  // de verdade conectados agora (não só os que ESTE processo conhece),
  // então funciona certo mesmo com múltiplas instâncias do servidor no
  // futuro.
  io.disconnectUser = async (userId) => {
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    sockets.forEach((s) => s.disconnect(true));
  };
  // Ban/suspensão/desativação: avisa o cliente (pra ele mostrar a tela
  // certa) e derruba TODOS os sockets dessa conta logo em seguida — antes
  // o socket aberto continuava recebendo mensagens/presença em tempo
  // real até a pessoa recarregar a página. O atraso curto dá tempo do
  // evento chegar antes do corte. Reconectar não adianta: o io.use acima
  // recusa contas banidas/suspensas/desativadas.
  io.kickUser = (userId, event, payload) => {
    if (!userId) return;
    if (event) io.to(`user:${userId}`).emit(event, payload || {});
    const t = setTimeout(() => {
      io.in(`user:${userId}`).disconnectSockets(true);
    }, 500);
    t.unref?.();
  };
  io.emitPresenceUpdate = (user) => emitPresence(io, user);
  io.isOnline = (userId) => presenceStore.isOnline(userId);
  io.onManualStatusChange = onManualStatusChange;

  // "Reload User" (painel de staff → Reload) — ver o comentário completo
  // em presenceStore.clearAll(). Não desconecta ninguém (os sockets
  // continuam vivos e a heartbeat de cada um vai se autorrenovar sozinha
  // em até ~30s); só limpa o que o servidor SABE sobre quem tá online
  // agora, fazendo todo mundo aparecer offline pros outros até se
  // reconectar de verdade (recarregando a página) ou a heartbeat rodar
  // de novo sozinha.
  // Agora o "Reload" refaz a presença na hora: depois de limpar, registra
  // de novo cada socket que está conectado DE VERDADE neste momento,
  // corrige o banco (reconcilePresence) e manda o retrato completo pra
  // todo mundo — antes todos ficavam "offline" até recarregar a página.
  io.reloadAllUserPresence = async () => {
    const cleared = await presenceStore.clearAll();
    io.emit('presence:reset');
    const live = await io.fetchSockets().catch(() => []);
    await Promise.all(live.map((s) => (s.userId || s.data?.userId)
      ? presenceStore.addSocket(s.userId || s.data.userId, s.id).catch(() => {})
      : null));
    await reconcilePresence({ summary: true, label: 'reload da staff' }).catch(() => {});
    onlineIdsCache = { at: 0, promise: null };
    const snapshot = await buildPresenceSnapshot(null);
    io.emit('presence:sync', snapshot, { complete: true });
    // Quem está "Invisível" recebeu "Offline" no retrato geral — devolve
    // o status real só pra ela mesma.
    const invisible = await prisma.user.findMany({
      where: { id: { in: snapshot.map((s) => s.userId) }, status: 'INVISIBLE' }, select: { id: true, status: true, customStatus: true },
    }).catch(() => []);
    invisible.forEach((u) => io.to(`user:${u.id}`).emit('presence:update', { userId: u.id, status: u.status, customStatus: u.customStatus }));
    return cleared;
  };

  // BUG CORRIGIDO ("continua aparecendo online/ausente mesmo sem a web
  // aberta"): o TTL adicionado em presenceStore.js já evita que NOVAS
  // desconexões sujas (o processo do servidor caindo/reiniciando com
  // gente conectada) fiquem presas pra sempre — mas ele sozinho só
  // resolve o problema aos poucos, na próxima vez que alguém tentar usar
  // aquela entrada. Esta varredura periódica é o que corrige ativamente
  // qualquer conta que já tenha ficado presa (inclusive de antes desta
  // correção existir): a cada minuto, olha todo mundo marcado
  // ONLINE/IDLE no banco e confere se realmente tem alguma sessão viva
  // no Redis — se não tiver (o TTL já expirou a entrada sozinho, ou ela
  // nunca existiu), corrige pra OFFLINE e avisa todo mundo, em vez de
  // depender só do fluxo normal de desconexão (que é exatamente o que
  // falha quando o processo inteiro morre no meio de uma conexão).
  // BUG CORRIGIDO (2ª rodada — "ainda tem 2 usuários bugados com o
  // status" mesmo depois da correção acima): a varredura anterior só
  // corrigia UMA direção do problema — quem está ONLINE/IDLE no banco
  // sem sessão real. Mas existe a direção OPOSTA também: alguém que
  // está de verdade conectado agora (tem sessão viva no Redis), mas o
  // banco continua mostrando OFFLINE — acontece se o servidor cair bem
  // no meio da conexão de alguém, entre o socket já ter sido registrado
  // no Redis e o `status: 'ONLINE'` ainda não ter sido gravado no banco
  // (uma janela bem pequena, mas splits de segundo existem, e isso já
  // aconteceu várias vezes nesta sessão com tantos restarts seguidos).
  // Sem corrigir essa direção também, quem caiu nessa janela específica
  // ficava "offline" pros outros pra sempre, mesmo conectado, até sair
  // e entrar de novo no site na mão. Agora a varredura cobre as duas
  // direções, e loga (com nome, não só ID) quem foi corrigido — fica no
  // log do servidor pra dar pra confirmar exatamente quem estava
  // afetado e em qual direção, sem precisar acessar o banco direto.
  // Agora a varredura é só REDE DE SEGURANÇA: as causas reais do
  // desencontro (sockets mortos contando como vivos, 'disconnect' perdido
  // durante o início da conexão, batimento que não recriava a presença
  // depois do "Reload" e registros de antes de um restart) foram
  // corrigidas na origem — ver presenceStore.js e o 'connection' acima.
  // Também ficou mais barata: em vez de 1 consulta no Redis por usuário
  // cadastrado, lê de uma vez quem tem socket vivo e só confere no banco
  // quem está do lado errado.
  // Não Perturbe também entra: o 'disconnect' já marca OFFLINE qualquer
  // status, então "Não perturbe" sem nenhuma conexão é o mesmo desencontro.
  const PRESENCE_SWEEP_MS = 120 * 1000; // era 60s — 2 min basta
  async function reconcilePresence({ summary = false, label = 'boot' } = {}) {
    const liveIds = await presenceStore.listOnlineUserIds();
    const liveSet = new Set(liveIds);
    const fixedDown = [];
    const fixedUp = [];
    const stale = await prisma.user.findMany({
      where: { status: { in: ['ONLINE', 'IDLE', 'DND'] }, ...(liveIds.length ? { id: { notIn: liveIds } } : {}) },
      select: { id: true, displayName: true, status: true },
    });
    for (const u of stale) {
      if (liveSet.has(u.id) || pendingOfflineTimers.has(u.id)) continue;
      // Confere de novo, um a um: pode ter conectado durante a varredura.
      // eslint-disable-next-line no-await-in-loop
      if (await presenceStore.isOnline(u.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      await prisma.user.update({ where: { id: u.id }, data: { status: 'OFFLINE' } }).catch(() => {});
      clearIdleTimer(u.id);
      clearAutoOfflineTimer(u.id);
      autoIdledUsers.delete(u.id);
      broadcastPresence(io, u.id);
      fixedDown.push(u);
    }
    if (liveIds.length) {
      // Direção oposta: conectado de verdade, mas o banco diz OFFLINE.
      // Quem virou OFFLINE pela ausência prolongada (autoIdledUsers) está
      // assim de propósito e não entra aqui.
      const missing = await prisma.user.findMany({
        where: { status: 'OFFLINE', id: { in: liveIds } },
        select: { id: true, displayName: true, status: true },
      });
      for (const u of missing) {
        if (autoIdledUsers.has(u.id)) continue;
        // eslint-disable-next-line no-await-in-loop
        await prisma.user.update({ where: { id: u.id }, data: { status: 'ONLINE' } }).catch(() => {});
        broadcastPresence(io, u.id);
        fixedUp.push(u);
      }
    }
    if (summary) {
      if (fixedDown.length || fixedUp.length) {
        console.log(`[presença] ${label}: ${fixedDown.length} conta(s) marcadas offline (sem conexão), ${fixedUp.length} marcadas online`);
      }
      return;
    }
    fixedDown.forEach((u) => console.log(`[presença] corrigido "${u.displayName}" (${u.id}): ${u.status} -> OFFLINE (sem sessão real)`));
    fixedUp.forEach((u) => console.log(`[presença] corrigido "${u.displayName}" (${u.id}): OFFLINE -> ONLINE (sessão real encontrada)`));
  }
  // Logo depois do boot: quem estava online antes do deploy e não voltou
  // em 30s (o cliente reconecta em poucos segundos) é marcado offline de
  // uma vez, com UMA linha de log — em vez de esperar a varredura e
  // aparecer como "corrigido" um por um.
  setTimeout(() => {
    presenceReady.then(() => reconcilePresence({ summary: true }))
      .catch((err) => console.error('[socket] reconciliação de presença no boot falhou:', err));
  }, 30 * 1000).unref?.();
  setInterval(() => {
    reconcilePresence().catch((err) => console.error('[socket] varredura de presença falhou:', err));
  }, PRESENCE_SWEEP_MS);

  // AFK sweep: fase 2 (junto com o resto de voz/vídeo) — o conceito de
  // "canal AFK" era configurado por servidor (Server.afkChannelId), que não
  // existe mais nesse modelo de comunidade única. Desativado por enquanto;
  // pode voltar como uma configuração global em PlatformSettings.

  return io;
}

module.exports = { initSockets, broadcastActivityChange, sameActivity };
