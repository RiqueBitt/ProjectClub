// Corrida de Trenó — servidor de salas (multiplayer próprio do Project Club).
//
// O jogo (client/public/minigames/sledracing) já vinha com TODO o protocolo
// de multiplayer pronto; só o servidor externo original (sledracing.ep8script
// .com) tinha sido removido. Aqui a gente hospeda esse servidor dentro do
// próprio Project Club, num namespace Socket.IO separado (/sled).
//
// Como é um joguinho casual, o namespace NÃO exige login: a identidade é só o
// nome de exibição que o app passa pro jogo (?name=). Ele não acessa nada da
// conta — só junta quem está esperando e repassa as jogadas (curva/colisão/
// impulso) entre os participantes. A posição de cada trenó é simulada em cada
// cliente a partir dessas jogadas (lockstep leve), igual o jogo original fazia.
//
// Fluxo (os nomes dos eventos são os que o cliente já escuta/emite):
//   cliente conecta → emite 'tag_verify'(tags, nome)
//   servidor → 'confirmed' (entrou na fila)
//            → 'game_connected' {map, players}  (a sala e quem já está nela)
//   pra quem já estava → 'new_player' {username, icon}
//   enquanto espera     → 'update_room'()        ("Esperando jogadores (n/4)")
//   ao chegar o 2º      → 'update_room'(15)       (contagem de 15s começa)
//   quem entra na contagem → 'update_room'(restante) (re-sincroniza)
//   fim da contagem     → 'start_race'            (todos largam juntos)
//   em jogo             → 'player_action'(idPlayer, acao)  (curva/colisão/impulso)
//   alguém sai          → 'player_disconnected'(indice)
//
// Tudo em memória do processo (uma sala vive segundos/minutos). Se o processo
// reiniciar, as salas somem — quem estava jogando cai no modo solo (o cliente
// já trata o 'disconnect' assim). Não usa Redis: é efêmero e local de propósito.

const MAPS = 4; // map[0..3] definidos em Maps.js
const MAX_PLAYERS = 4;
const COUNTDOWN_SECONDS = 15; // ao chegar o 2º jogador
const READY_DELAY_MS = 3500; // contagem→LoadMap→"PRONTOS/ATENÇÃO/JÁ" antes do start
const MAX_ROOMS = 300; // guarda-chuva contra abuso
const ICON = 'Assets/UserIcon.png';

function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[<>]/g, '').trim().slice(0, 19);
  return s || 'Pinguim';
}

function initSledRacing(io) {
  const ns = io.of('/sled');
  const rooms = new Map(); // id -> room
  let seq = 0;

  const roomPlayersFor = (room, meSid) => room.players.map((p) => ({
    username: p.name, icon: ICON, me: p.sid === meSid,
  }));

  function waitingText(room) {
    // Re-emite o estado da sala pra todo mundo nela (o cliente mostra
    // "Esperando jogadores (n/4)" e, sem contagem, o botão "Jogar sozinho").
    ns.to(room.id).emit('update_room');
  }

  function stopTimers(room) {
    if (room.timer) { clearInterval(room.timer); room.timer = null; }
    if (room.startTimer) { clearTimeout(room.startTimer); room.startTimer = null; }
  }

  function destroyRoom(room) {
    stopTimers(room);
    rooms.delete(room.id);
  }

  function startCountdown(room) {
    room.state = 'countdown';
    room.countdownLeft = COUNTDOWN_SECONDS;
    ns.to(room.id).emit('update_room', room.countdownLeft);
    room.timer = setInterval(() => {
      room.countdownLeft -= 1;
      if (room.countdownLeft <= 0) {
        clearInterval(room.timer); room.timer = null;
        room.state = 'racing';
        // Os clientes terminam a contagem local, montam o mapa e a animação
        // "PRONTOS/ATENÇÃO/JÁ"; aí sim todos largam juntos.
        room.startTimer = setTimeout(() => {
          room.startTimer = null;
          ns.to(room.id).emit('start_race');
        }, READY_DELAY_MS);
      }
    }, 1000);
    room.timer.unref?.();
  }

  // Volta pra "esperando" se a sala em contagem ficou com menos de 2.
  function maybeStall(room) {
    if (room.state === 'countdown' && room.players.length < 2) {
      stopTimers(room);
      room.state = 'waiting';
      waitingText(room);
    }
  }

  function findOpenRoom() {
    for (const room of rooms.values()) {
      if ((room.state === 'waiting' || room.state === 'countdown') && room.players.length < MAX_PLAYERS) {
        return room;
      }
    }
    if (rooms.size >= MAX_ROOMS) return null;
    const room = {
      id: `sled_${seq += 1}`, players: [], state: 'waiting',
      map: Math.floor(Math.random() * MAPS), countdownLeft: 0, timer: null, startTimer: null,
    };
    rooms.set(room.id, room);
    return room;
  }

  function leaveRoom(socket, { silent = false } = {}) {
    const room = socket.data.room;
    const player = socket.data.player;
    socket.data.room = null; socket.data.player = null;
    if (!room || !rooms.has(room.id)) return;
    const i = room.players.indexOf(player);
    if (i !== -1) {
      room.players.splice(i, 1);
      // Avisa os outros (índice 0-based, como o cliente espera pra remover).
      if (!silent) socket.to(room.id).emit('player_disconnected', player.idx);
    }
    socket.leave(room.id);
    if (room.players.length === 0) { destroyRoom(room); return; }
    maybeStall(room);
  }

  function join(socket, name) {
    if (socket.data.room) return; // já está numa sala
    const room = findOpenRoom();
    if (!room) { socket.emit('update_room'); return; } // lotado de salas: fica só esperando
    const player = { sid: socket.id, name, idx: room.players.length };
    room.players.push(player);
    socket.data.room = room;
    socket.data.player = player;
    socket.join(room.id);

    socket.emit('confirmed');
    socket.emit('game_connected', { map: room.map, players: roomPlayersFor(room, socket.id) });
    socket.to(room.id).emit('new_player', { username: name, icon: ICON });

    if (room.players.length >= 2 && room.state === 'waiting') {
      startCountdown(room);
    } else if (room.state === 'countdown') {
      // Entrou durante a contagem: re-sincroniza todo mundo (os que já
      // estavam tiveram o timer local parado pelo 'new_player').
      ns.to(room.id).emit('update_room', room.countdownLeft);
    } else {
      waitingText(room); // ainda só 1: "Esperando jogadores (1/4)" + solo
    }
  }

  ns.on('connection', (socket) => {
    socket.data.room = null;
    socket.data.player = null;
    const fallbackName = cleanName(socket.handshake.auth && socket.handshake.auth.name);

    // O cliente manda tag_verify(tags, nome) ao conectar (estando no Lobby).
    socket.on('tag_verify', (_tags, username) => {
      join(socket, cleanName(username) || fallbackName);
    });

    // Clicou em "Jogar sozinho": sai da sala (os outros seguem esperando).
    socket.on('solo_game', () => { leaveRoom(socket); });

    // Jogada do participante (curva/colisão/impulso) → repassa aos outros.
    socket.on('action', (action) => {
      const room = socket.data.room;
      const player = socket.data.player;
      if (!room || !player || !action || typeof action.type !== 'string') return;
      // id = índice+1 (o jogo usa .player[player='id'], que é índice+1 no DOM).
      socket.to(room.id).emit('player_action', player.idx + 1, action);
    });

    socket.on('disconnect', () => { leaveRoom(socket); });
  });

  return ns;
}

module.exports = { initSledRacing };
