const { Server } = require('socket.io');
const { verifyAccessToken } = require('../services/tokens');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const { messageInclude } = require('../controllers/messageController');
const presenceStore = require('../services/presenceStore');
const activityStore = require('../services/activityStore');
const voiceStore = require('../services/voiceRoomStore');

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
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      socket.userId = payload.sub;
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    // A throw anywhere in here used to be an unhandled promise rejection —
    // in modern Node that crashes the *entire* process (every connected
    // user gets disconnected, mid-call voice drops, etc.) instead of just
    // failing this one person's connection setup. Wrapped so a single bad
    // connection attempt (e.g. a DB hiccup) can't take the whole server
    // down; see also the process-level safety net in index.js.
    try {
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
      const heartbeat = setInterval(() => {
        presenceStore.refreshPresence(userId).catch((err) => console.error('[socket] falha ao renovar presença:', err));
      }, (presenceStore.PRESENCE_TTL_SECONDS || 90) * 1000 / 3);
      socket.once('disconnect', () => clearInterval(heartbeat));
      // A quick reconnect (see OFFLINE_GRACE_MS above) means the previous
      // disconnect's delayed "mark offline" never actually fired yet —
      // cancel it so it doesn't go through moments from now and wrongly
      // flip someone who's clearly still connected to OFFLINE.
      if (pendingOfflineTimers.has(userId)) {
        clearTimeout(pendingOfflineTimers.get(userId));
        pendingOfflineTimers.delete(userId);
      }

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
      const allStatuses = await prisma.user.findMany({ select: { id: true, status: true, customStatus: true } });
      socket.emit('presence:sync', allStatuses.map((u) => ({ userId: u.id, status: u.status, customStatus: u.customStatus })));

      // Item pedido: ícone de atividade (jogo/Spotify/app) na lista de
      // membros — sem isso, só quem TROCASSE de atividade DEPOIS de eu
      // já estar conectado apareceria; alguém que já estava jogando
      // ANTES de eu abrir o site nunca apareceria, já que a atividade só
      // é retransmitida ao vivo quando MUDA (ver activity:update acima),
      // não quando alguém simplesmente conecta. Só busca de quem está
      // online agora (offline nunca tem atividade de verdade) — evita
      // buscar no Redis pra todo mundo à toa.
      const onlineIds = allStatuses.filter((u) => u.status !== 'OFFLINE').map((u) => u.id);
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
    socket.on('channel:join', async (channelId) => {
      try {
        if (!channelId) return;
        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) return;
        const perms = await getEffectivePermissions(userId, channelId, channel);
        if (has(perms, 'VIEW_CHANNEL')) socket.join(`channel:${channelId}`);
      } catch (err) { console.error('[socket] channel:join falhou:', err); }
    });
    socket.on('channel:leave', (channelId) => socket.leave(`channel:${channelId}`));
    socket.on('conversation:join', async (conversationId) => {
      try {
        if (!conversationId) return;
        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId } },
        }).catch(() => null);
        if (member) socket.join(`conversation:${conversationId}`);
      } catch (err) { console.error('[socket] conversation:join falhou:', err); }
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
    async function canRelayTyping({ conversationId, channelId }) {
      if (conversationId) {
        const member = await prisma.conversationMember.findUnique({
          where: { conversationId_userId: { conversationId, userId } },
        });
        return !!member;
      }
      if (channelId) {
        const perms = await getEffectivePermissions(userId, channelId);
        return has(perms, 'VIEW_CHANNEL');
      }
      return false;
    }
    socket.on('typing:start', async ({ conversationId, channelId }) => {
      if (!(await canRelayTyping({ conversationId, channelId }))) return;
      socket.to(roomFor({ conversationId, channelId })).emit('typing:start', { userId, conversationId, channelId });
    });
    socket.on('typing:stop', async ({ conversationId, channelId }) => {
      if (!(await canRelayTyping({ conversationId, channelId }))) return;
      socket.to(roomFor({ conversationId, channelId })).emit('typing:stop', { userId, conversationId, channelId });
    });

    socket.on('presence:set', async (status) => {
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
          await voiceStore.setParticipant(channelId, userId, { socketId: socket.id, conversationId, muted: false, deafened: false, video: false, screenSharing: false, role: 'speaker' });
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

        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) return;
        const perms = await getEffectivePermissions(userId, channelId, channel);
        if (!has(perms, 'CONNECT')) {
          socket.emit('voice:join-denied', { channelId, reason: 'Você não tem permissão para entrar neste canal.' });
          return;
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
          // que estava conectado (Agora publicado, UI mostrando "na
          // call"), mesmo o Agora já tendo derrubado a mídia dele por
          // dentro (dois clientes com o MESMO usuário no mesmo canal não
          // é permitido). Agora, só quando é de verdade um socket
          // DIFERENTE (não um simples refresh do mesmo), avisa
          // explicitamente o dispositivo antigo pra ele sair sozinho, de
          // forma limpa — em vez de ficar "preso" numa call morta.
          if (existingSelf.socketId && existingSelf.socketId !== socket.id) {
            io.to(existingSelf.socketId).emit('voice:kicked-by-other-device', { channelId });
          }
          await voiceStore.updateParticipant(channelId, userId, { socketId: socket.id, lastActiveAt: Date.now() });
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
        await voiceStore.setParticipant(channelId, userId, {
          socketId: socket.id,
          muted: startMuted, deafened: false, video: false, screenSharing: false, role,
          lastActiveAt: Date.now(),
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
      } catch (err) { /* silently ignore malformed signaling */ }
    });

    // --- Stage channel speaker/audience management ---

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

    socket.on('voice:leave', ({ channelId }) => leaveVoice(io, socket, channelId, userId));

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

    socket.on('voice:signal', async ({ channelId, to, data }) => {
      // The sender must themselves be a legitimate participant of this
      // voice room, not just the target — otherwise anyone could inject
      // arbitrary WebRTC signaling data into any active call by naming a
      // participant's userId, impersonating a peer that was never dialed.
      if (!(await voiceStore.hasParticipant(channelId, userId))) return;
      const target = await voiceStore.getParticipant(channelId, to);
      if (!target) return;
      io.to(target.socketId).emit('voice:signal', { channelId, from: userId, data });
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
      const target = socket.to(`voice:${channelId}`).to('community');
      target.emit('voice:speaking', { channelId, userId, speaking: !!speaking });
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
        await activityStore.setActivity(userId, clean);
        await broadcastActivityChange(io, userId, clean);
      } else {
        await activityStore.clearActivity(userId);
        await broadcastActivityChange(io, userId, null);
      }
    });

    socket.on('disconnect', async () => {
      try {
        for (const channelId of await voiceStore.getActiveRoomIds()) {
          if (await voiceStore.hasParticipant(channelId, userId)) await leaveVoice(io, socket, channelId, userId);
        }

        const remaining = await presenceStore.removeSocket(userId, socket.id);
        if (remaining === 0) {
          // Sem nenhum dispositivo conectado, não faz sentido continuar
          // mostrando "jogando X" pra ninguém — o app de desktop que
          // mandava isso também caiu junto (é o mesmo processo).
          await activityStore.clearActivity(userId);
          await broadcastActivityChange(io, userId, null);
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
            if (await presenceStore.isOnline(userId)) return; // reconnected in the meantime after all
            await prisma.user.update({ where: { id: userId }, data: { status: 'OFFLINE' } }).catch(() => {});
            broadcastPresence(io, userId);
          }, OFFLINE_GRACE_MS);
          pendingOfflineTimers.set(userId, timer);
        }
      } catch (err) { console.error('[socket] disconnect cleanup falhou:', err); }
    });
  });

  async function leaveVoice(io, socket, channelId, userId) {
    const participant = await voiceStore.getParticipant(channelId, userId);
    if (!participant) return;
    const { conversationId } = participant;
    const remaining = await voiceStore.removeParticipant(channelId, userId);
    socket.leave(`voice:${channelId}`);
    io.to(`voice:${channelId}`).emit('voice:user-left', { channelId, userId });
    if (remaining === 0) {
      await voiceStore.deleteRoom(channelId);
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
    io.to('community').emit('voice:roster', { channelId, participants, startedAt: startedAt || null });
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
          await prisma.user.update({ where: { id: userId }, data: { status: 'IDLE' } });
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
  async function markActive(io, userId) {
    scheduleIdleTimer(io, userId);
    clearAutoOfflineTimer(userId);
    if (!autoIdledUsers.has(userId)) return;
    autoIdledUsers.delete(userId);
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (user?.status === 'IDLE' || user?.status === 'OFFLINE') {
        await prisma.user.update({ where: { id: userId }, data: { status: 'ONLINE' } });
        broadcastPresence(io, userId);
      }
    } catch (err) { console.error('[socket] falha ao voltar de ausência automática:', err); }
  }

  // Chamado sempre que o status muda por ação explícita da pessoa
  // (dropdown no cliente, seja via socket presence:set ou via
  // PATCH /users/me/status): a escolha manual sempre vence o automático.
  function onManualStatusChange(userId, status) {
    autoIdledUsers.delete(userId);
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

  async function broadcastPresence(io, userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const payload = { userId: user.id, status: user.status, customStatus: user.customStatus };
    // Broadcast to every room this user shares with others (simplest correct approach
    // for a moderate-size deployment: emit globally, clients filter by relevance).
    io.emit('presence:update', payload);
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
  io.emitPresenceUpdate = (user) => io.emit('presence:update', {
    userId: user.id, status: user.status, customStatus: user.customStatus,
  });
  io.isOnline = (userId) => presenceStore.isOnline(userId);
  io.onManualStatusChange = onManualStatusChange;

  // "Reload User" (painel de staff → Reload) — ver o comentário completo
  // em presenceStore.clearAll(). Não desconecta ninguém (os sockets
  // continuam vivos e a heartbeat de cada um vai se autorrenovar sozinha
  // em até ~30s); só limpa o que o servidor SABE sobre quem tá online
  // agora, fazendo todo mundo aparecer offline pros outros até se
  // reconectar de verdade (recarregando a página) ou a heartbeat rodar
  // de novo sozinha.
  io.reloadAllUserPresence = async () => {
    const cleared = await presenceStore.clearAll();
    io.emit('presence:reset');
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
  const PRESENCE_SWEEP_MS = 60 * 1000;
  setInterval(async () => {
    try {
      const suspects = await prisma.user.findMany({
        where: { status: { in: ['ONLINE', 'IDLE', 'OFFLINE'] } },
        select: { id: true, displayName: true, status: true },
      });
      for (const { id, displayName, status } of suspects) {
        const reallyOnline = await presenceStore.isOnline(id);
        if (status !== 'OFFLINE' && !reallyOnline) {
          // Achava que estava online/ausente, mas não tem sessão real —
          // corrige pra offline (mesma correção de antes).
          await prisma.user.update({ where: { id }, data: { status: 'OFFLINE' } }).catch(() => {});
          clearIdleTimer(id);
          clearAutoOfflineTimer(id);
          autoIdledUsers.delete(id);
          broadcastPresence(io, id);
          console.log(`[presença] corrigido "${displayName}" (${id}): ${status} -> OFFLINE (sem sessão real)`);
        } else if (status === 'OFFLINE' && reallyOnline) {
          // Direção oposta: está mesmo conectado, mas o banco ainda
          // mostra offline — corrige pra online.
          await prisma.user.update({ where: { id }, data: { status: 'ONLINE' } }).catch(() => {});
          broadcastPresence(io, id);
          console.log(`[presença] corrigido "${displayName}" (${id}): OFFLINE -> ONLINE (sessão real encontrada)`);
        }
      }
    } catch (err) { console.error('[socket] varredura de presença falhou:', err); }
  }, PRESENCE_SWEEP_MS);

  // AFK sweep: fase 2 (junto com o resto de voz/vídeo) — o conceito de
  // "canal AFK" era configurado por servidor (Server.afkChannelId), que não
  // existe mais nesse modelo de comunidade única. Desativado por enquanto;
  // pode voltar como uma configuração global em PlatformSettings.

  return io;
}

module.exports = { initSockets };
