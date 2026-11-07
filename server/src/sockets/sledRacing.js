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
// Timers (segundos/ms) — sobrescrevíveis por env só pra testes rodarem rápido.
const envNum = (k, d) => (Number.isFinite(Number(process.env[k])) && process.env[k] !== '' ? Number(process.env[k]) : d);
const COUNTDOWN_SECONDS = envNum('SLED_COUNTDOWN_SECONDS', 15); // ao chegar o 2º jogador
const READY_DELAY_MS = envNum('SLED_READY_DELAY_MS', 3500); // contagem→LoadMap→"PRONTOS/ATENÇÃO/JÁ" antes do start
const MAX_ROOMS = 300; // guarda-chuva contra abuso
const ICON = 'Assets/UserIcon.png';

// ---- Torneios (chaveamento) ----
// Até 8 pessoas: 2 baterias de até 4 → os 2 melhores de cada vão pra FINAL
// de 4. Abre a contagem (45s) quando chegam 4 inscritos; com 8 começa logo.
// Quem termina a bateria espera as outras; eliminados recebem a posição.
const TOURNAMENT_MIN = 4;
const TOURNAMENT_MAX = 8;
const TOURNAMENT_COUNTDOWN_SECONDS = envNum('SLED_TOURNAMENT_COUNTDOWN_SECONDS', 45);
const TOURNAMENT_FULL_DELAY_SECONDS = envNum('SLED_TOURNAMENT_FULL_DELAY_SECONDS', 5);
const HEAT_COUNTDOWN_SECONDS = envNum('SLED_HEAT_COUNTDOWN_SECONDS', 10);
const HEAT_GRACE_MS = envNum('SLED_HEAT_GRACE_MS', 60 * 1000); // depois do 1º a terminar, quem não terminou é DNF
const ADVANCE_PER_HEAT = 2;

function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[<>]/g, '').trim().slice(0, 19);
  return s || 'Pinguim';
}

function initSledRacing(io) {
  const ns = io.of('/sled');
  const rooms = new Map(); // id -> room
  const tournaments = new Map(); // id -> tournament
  let seq = 0;
  let tseq = 0;

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

  function startCountdown(room, seconds = COUNTDOWN_SECONDS) {
    room.state = 'countdown';
    room.countdownLeft = seconds;
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
          room.startedAt = Date.now();
          ns.to(room.id).emit('start_race');
        }, READY_DELAY_MS);
      }
    }, 1000);
    room.timer.unref?.();
  }

  // Volta pra "esperando" se a sala em contagem ficou com menos de 2.
  function maybeStall(room) {
    if (room.tournament) return; // bateria de torneio nunca volta a esperar
    if (room.state === 'countdown' && room.players.length < 2) {
      stopTimers(room);
      room.state = 'waiting';
      waitingText(room);
    }
  }

  function findOpenRoom() {
    for (const room of rooms.values()) {
      if (room.tournament) continue;
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
    if (room.tournament) { heatMaybeDone(room); return; }
    if (room.players.length === 0) { destroyRoom(room); return; }
    maybeStall(room);
  }

  // ---------------- Torneios ----------------
  function tournamentBroadcast(t) {
    for (const p of t.players) {
      const sock = ns.sockets.get(p.sid);
      if (sock) sock.emit('tournament_update', { id: t.id, count: t.players.length, min: TOURNAMENT_MIN, max: TOURNAMENT_MAX, seconds: t.countdownLeft || 0, state: t.state });
    }
  }

  function findOpenTournament() {
    for (const t of tournaments.values()) if (t.state === 'waiting' && t.players.length < TOURNAMENT_MAX) return t;
    if (tournaments.size >= 50) return null;
    const t = { id: `t_${tseq += 1}`, players: [], state: 'waiting', countdownLeft: 0, timer: null, heats: [], finalists: [], placings: [], final: null };
    tournaments.set(t.id, t);
    return t;
  }

  function tournamentStopTimer(t) { if (t.timer) { clearInterval(t.timer); t.timer = null; } }

  function tournamentCountdown(t, seconds) {
    tournamentStopTimer(t);
    t.countdownLeft = seconds;
    tournamentBroadcast(t);
    t.timer = setInterval(() => {
      t.countdownLeft -= 1;
      if (t.countdownLeft <= 0) {
        tournamentStopTimer(t);
        if (t.players.length >= TOURNAMENT_MIN) startTournament(t);
        else { t.countdownLeft = 0; tournamentBroadcast(t); }
        return;
      }
      if (t.countdownLeft % 5 === 0 || t.countdownLeft <= 10) tournamentBroadcast(t);
    }, 1000);
    t.timer.unref?.();
  }

  function tournamentJoin(socket, name) {
    if (socket.data.tournament) return;
    leaveRoom(socket); // sai da fila normal, se estava
    const t = findOpenTournament();
    if (!t) { socket.emit('tournament_update', { full: true }); return; }
    const entry = { sid: socket.id, name };
    t.players.push(entry);
    socket.data.tournament = t;
    socket.data.tEntry = entry;
    if (t.players.length >= TOURNAMENT_MAX) tournamentCountdown(t, TOURNAMENT_FULL_DELAY_SECONDS);
    else if (t.players.length >= TOURNAMENT_MIN && !t.timer) tournamentCountdown(t, TOURNAMENT_COUNTDOWN_SECONDS);
    else tournamentBroadcast(t);
  }

  function tournamentLeave(socket) {
    const t = socket.data.tournament;
    const entry = socket.data.tEntry;
    socket.data.tournament = null; socket.data.tEntry = null;
    if (!t || !tournaments.has(t.id)) return;
    if (t.state === 'waiting') {
      const i = t.players.indexOf(entry);
      if (i !== -1) t.players.splice(i, 1);
      if (t.players.length === 0) { tournamentStopTimer(t); tournaments.delete(t.id); return; }
      if (t.players.length < TOURNAMENT_MIN && t.timer) { tournamentStopTimer(t); t.countdownLeft = 0; }
      tournamentBroadcast(t);
    }
    // Em andamento: a bateria/final trata pela saída da sala (DNF).
  }

  function makeHeatRoom(t, entries, stage, label) {
    const room = {
      id: `sled_${seq += 1}`, players: [], state: 'waiting', tournament: t, stage, label,
      map: Math.floor(Math.random() * MAPS), countdownLeft: 0, timer: null, startTimer: null,
      finishes: [], firstFinishAt: null, graceTimer: null, done: false, startedAt: null,
    };
    rooms.set(room.id, room);
    for (const e of entries) {
      const sock = ns.sockets.get(e.sid);
      if (!sock) continue;
      const player = { sid: sock.id, name: e.name, idx: room.players.length, entry: e };
      room.players.push(player);
      sock.data.room = room; sock.data.player = player;
      sock.join(room.id);
    }
    for (const p of room.players) {
      const sock = ns.sockets.get(p.sid);
      if (!sock) continue;
      sock.emit('tournament_stage', { stage, label, heat: room.id, players: room.players.length });
      sock.emit('game_connected', { map: room.map, players: roomPlayersFor(room, sock.id) });
    }
    startCountdown(room, HEAT_COUNTDOWN_SECONDS);
    return room;
  }

  function startTournament(t) {
    t.state = 'running';
    // Só quem ainda está conectado corre.
    t.players = t.players.filter((p) => ns.sockets.get(p.sid));
    if (t.players.length < 2) { tournaments.delete(t.id); return; }
    // Embaralha e divide em 2 baterias o mais igual possível.
    const shuffled = [...t.players].sort(() => Math.random() - 0.5);
    const half = Math.ceil(shuffled.length / 2);
    const groups = [shuffled.slice(0, half), shuffled.slice(half)].filter((g) => g.length);
    t.heats = groups.map((g, i) => makeHeatRoom(t, g, 'heat', `Bateria ${i + 1} de ${groups.length}`));
  }

  // Chegada: ordem de chegada no servidor (ms do cliente só desempata).
  function recordFinish(socket, ms) {
    const room = socket.data.room; const player = socket.data.player;
    if (!room || !player || !room.tournament || room.done) return;
    if (room.finishes.some((f) => f.player === player)) return;
    room.finishes.push({ player, at: Date.now(), ms: Number.isFinite(Number(ms)) ? Number(ms) : null });
    if (!room.firstFinishAt) {
      room.firstFinishAt = Date.now();
      room.graceTimer = setTimeout(() => { room.graceTimer = null; finishHeat(room); }, HEAT_GRACE_MS);
      room.graceTimer.unref?.();
    }
    heatMaybeDone(room);
  }

  function heatMaybeDone(room) {
    if (!room.tournament || room.done) return;
    const alive = room.players.filter((p) => ns.sockets.get(p.sid));
    const finished = room.finishes.map((f) => f.player);
    const pending = alive.filter((p) => !finished.includes(p));
    if (pending.length === 0 && (finished.length > 0 || alive.length === 0)) finishHeat(room);
  }

  function finishHeat(room) {
    if (room.done) return;
    room.done = true;
    if (room.graceTimer) { clearTimeout(room.graceTimer); room.graceTimer = null; }
    stopTimers(room);
    const t = room.tournament;
    const order = [...room.finishes].sort((a, b) => a.at - b.at || (a.ms || 0) - (b.ms || 0)).map((f) => f.player);
    const dnf = room.players.filter((p) => !order.includes(p));
    const ranking = [...order, ...dnf];
    if (room.stage === 'heat') {
      ranking.forEach((p, i) => {
        const sock = ns.sockets.get(p.sid);
        if (i < ADVANCE_PER_HEAT) {
          t.finalists.push(p.entry);
          sock?.emit('tournament_stage', { stage: 'wait', label: `Você passou (${i + 1}º na bateria)! Aguardando a outra bateria…` });
        } else {
          sock?.emit('tournament_eliminated', { place: i + 1, label: `${i + 1}º na bateria — eliminado` });
          if (sock) { sock.data.tournament = null; sock.data.tEntry = null; }
        }
        if (sock) { sock.leave(room.id); sock.data.room = null; sock.data.player = null; }
      });
      rooms.delete(room.id);
      if (t.heats.every((h) => h.done)) startFinal(t);
    } else {
      // Final: pódio pra todo mundo do torneio que ainda está conectado.
      const standings = ranking.map((p, i) => ({ place: i + 1, name: p.name, dnf: dnf.includes(p) }));
      for (const p of t.players) ns.sockets.get(p.sid)?.emit('tournament_result', { standings });
      for (const p of room.players) {
        const sock = ns.sockets.get(p.sid);
        if (sock) { sock.leave(room.id); sock.data.room = null; sock.data.player = null; sock.data.tournament = null; sock.data.tEntry = null; }
      }
      rooms.delete(room.id);
      t.state = 'done';
      tournaments.delete(t.id);
    }
  }

  function startFinal(t) {
    const finalists = t.finalists.filter((e) => ns.sockets.get(e.sid)).slice(0, MAX_PLAYERS);
    if (finalists.length < 2) {
      // Só sobrou um (os outros caíram): campeão por W.O.
      const standings = finalists.map((e, i) => ({ place: i + 1, name: e.name, dnf: false }));
      for (const p of t.players) ns.sockets.get(p.sid)?.emit('tournament_result', { standings, walkover: true });
      for (const e of finalists) { const s = ns.sockets.get(e.sid); if (s) { s.data.tournament = null; s.data.tEntry = null; } }
      tournaments.delete(t.id);
      return;
    }
    t.final = makeHeatRoom(t, finalists, 'final', 'FINAL');
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
    socket.data.tournament = null;
    socket.data.tEntry = null;
    const fallbackName = cleanName(socket.handshake.auth && socket.handshake.auth.name);

    // O cliente manda tag_verify(tags, nome) ao conectar (estando no Lobby).
    socket.on('tag_verify', (_tags, username) => {
      join(socket, cleanName(username) || fallbackName);
    });

    // Clicou em "Jogar sozinho": sai da sala (os outros seguem esperando).
    socket.on('solo_game', () => { leaveRoom(socket); tournamentLeave(socket); });

    // Torneio: entrar na inscrição / sair / avisar que cruzou a linha.
    socket.on('tournament_join', (username) => { tournamentJoin(socket, cleanName(username) || fallbackName); });
    socket.on('tournament_leave', () => { tournamentLeave(socket); });
    socket.on('race_finished', (data) => { recordFinish(socket, data && data.ms); });

    // Jogada do participante (curva/colisão/impulso) → repassa aos outros.
    socket.on('action', (action) => {
      const room = socket.data.room;
      const player = socket.data.player;
      if (!room || !player || !action || typeof action.type !== 'string') return;
      // id = índice+1 (o jogo usa .player[player='id'], que é índice+1 no DOM).
      socket.to(room.id).emit('player_action', player.idx + 1, action);
    });

    socket.on('disconnect', () => { leaveRoom(socket); tournamentLeave(socket); });
  });

  ns._state = { rooms, tournaments };
  return ns;
}

module.exports = { initSledRacing };
