"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMascotMessage = exports.handleTourGuideMessage = exports.handleCoinDig = exports.handleTeleport = exports.isHockeyGuard = exports.isTableGuard = exports.handleUpdateHockeyGame = exports.handleMoveHockeyPuckOld = exports.handleMoveHockeyPuck = exports.handleGetHockeyGame = exports.handleUpdateBackground = exports.handleUpdatePin = exports.handleUpdateFeet = exports.handleUpdateHand = exports.handleUpdateBody = exports.handleUpdateNeck = exports.handleUpdateFace = exports.handleUpdateHead = exports.handleUpdateColor = exports.handleUpdatePenguinOld = exports.handleSendTableMove = exports.handleLeaveTableGame = exports.handleJoinTableGame = exports.handleGetTableGame = exports.handleLeaveTable = exports.handleJoinTable = exports.handleGetTables = exports.sendTeleportOld = exports.handlePlayerTransform = exports.handleCloseToy = exports.handleAddToyOld = exports.handleAddToy = exports.handleLeaveWaddle = exports.handleJoinWaddle = exports.handleGetWaddle = exports.handleSendLine = exports.handleSafeMessage = exports.handleSendMessage = exports.handleSendJoke = exports.handleSendEmote = exports.handleSetSnowball = exports.handleSetAction = exports.handleSetFrame = exports.handleSetPosition = void 0;
const join_1 = require("./join");
const world_table_1 = require("../world/world-table.js");
const rooms_1 = require("../../game-data/rooms.js");
const handleSetPosition = ({ penguin, room, msg, data }, x, y) => {
    const state = room.getState(penguin);
    const isInitialPosition = state.x === 0 && state.y === 0;
    room.updatePosition(penguin, x, y);
    if (data.isSpOnJr() && isInitialPosition) {
        msg.send(room.players, 'ap', (0, join_1.getPenguinString)(data, penguin, { ...state, x, y }));
    }
    else {
        msg.send(room.players, 'sp', penguin.id, x, y);
    }
};
exports.handleSetPosition = handleSetPosition;
const handleSetFrame = ({ penguin, room, msg }, frame) => {
    room.updateFrame(penguin, frame);
    msg.send(room.players, 'sf', penguin.id, frame);
};
exports.handleSetFrame = handleSetFrame;
const handleSetAction = ({ room, msg, penguin }, action) => {
    msg.send(room.players, 'sa', penguin.id, action);
};
exports.handleSetAction = handleSetAction;
const handleSetSnowball = ({ room, msg, penguin, world }, x, y) => {
    msg.send(room.players, 'sb', penguin.id, x, y);
    world.emitAction({ penguinId: penguin.id, room: room.id, kind: 'snowball', value: `${x},${y}` });
};
exports.handleSetSnowball = handleSetSnowball;
const handleSendEmote = ({ room, msg, penguin, data, world }, emote) => {
    if (data.hasBakery() && room === world.bakery.room) {
        if (Number(emote) === world.bakery.emote) {
            world.bakery.incrementCheer();
        }
    }
    msg.send(room.players, 'se', penguin.id, emote);
    world.emitAction({ penguinId: penguin.id, room: room.id, kind: 'emote', value: String(emote) });
};
exports.handleSendEmote = handleSendEmote;
const handleSendJoke = ({ room, msg, penguin, world }, joke) => {
    msg.send(room.players, 'sj', penguin.id, joke);
    world.emitAction({ penguinId: penguin.id, room: room.id, kind: 'joke', value: String(joke) });
};
exports.handleSendJoke = handleSendJoke;
const handleSendMessage = ({ room, msg, penguin, world }, _penguin, message) => {
    msg.send(room.players, 'sm', penguin.id, message);
    world.emitAction({ penguinId: penguin.id, room: room.id, kind: 'message', value: String(message) });
};
exports.handleSendMessage = handleSendMessage;
const handleSafeMessage = ({ room, msg, penguin, world }, message) => {
    msg.send(room.players, 'ss', penguin.id, message);
    world.emitAction({ penguinId: penguin.id, room: room.id, kind: 'safe', value: String(message) });
};
exports.handleSafeMessage = handleSafeMessage;
const handleSendLine = ({ room, msg, penguin }, line) => {
    msg.send(room.players, 'sl', penguin.id, line);
};
exports.handleSendLine = handleSendLine;
const handleGetWaddle = ({ msg, penguin, room }) => {
    msg.send(penguin, 'gw', ...room.getWaddleRooms().map((w) => {
        return `${w.getId()}|${w.getSeats().map(p => {
            return p?.name ?? '';
        }).join(',')}`;
    }));
};
exports.handleGetWaddle = handleGetWaddle;
const handleJoinWaddle = ({ msg, penguin, room, world, data }, waddleId) => {
    const waddle = room.getWaddleRoom(waddleId);
    if (waddle !== undefined) {
        const seat = room.enterWaddleRoom(waddle, penguin);
        msg.send(penguin, 'jw', seat);
        msg.send(room.players, 'uw', waddleId, seat, penguin.name, penguin.id);
        if (waddle.isFull()) {
            const players = waddle.getSeats().filter((p) => p !== null);
            players.forEach(p => {
                room.removePenguin(p);
            });
            const game = world.getWaddleGame(waddle.getGame(), players);
            waddle.reset();
            msg.send(players, 'jg', game.roomId);
            // 2006 sled race notification for starting the game
            if (waddle.getGame() === 'sled' && data.isPreCpip()) {
                msg.send(players, 'sw', waddle.getId(), room.id, players.length);
            }
        }
    }
};
exports.handleJoinWaddle = handleJoinWaddle;
const handleLeaveWaddle = ({ penguin, msg, room }) => {
    const waddleRoom = room.getWaddleRooms().find(room => room.getSeats().includes(penguin));
    if (waddleRoom === undefined) {
        return;
    }
    const seatIndex = waddleRoom.removePlayer(penguin);
    msg.send(room.players, 'uw', waddleRoom.getId(), seatIndex);
};
exports.handleLeaveWaddle = handleLeaveWaddle;
//TODO persistence for new players joining (was that actually a thing?)
const handleAddToy = ({ msg, penguin, room }, toy) => {
    msg.send(room.players, 'at', penguin.id, toy);
};
exports.handleAddToy = handleAddToy;
const handleAddToyOld = ({ msg, penguin, room }, toy, frame) => {
    msg.send(room.players, 'at', penguin.id, toy, frame);
};
exports.handleAddToyOld = handleAddToyOld;
const handleCloseToy = ({ msg, room, penguin }) => {
    msg.send(room.players, 'rt', penguin.id);
};
exports.handleCloseToy = handleCloseToy;
const handlePlayerTransform = ({ msg, room, penguin }, avatarId) => {
    penguin.avatar.transform(avatarId);
    msg.send(room.players, 'spts', penguin.id, avatarId);
};
exports.handlePlayerTransform = handlePlayerTransform;
const sendTeleportOld = ({ msg, penguin, room }, x, y, frame) => {
    room.updatePosition(penguin, x, y);
    room.updateFrame(penguin, frame);
    msg.send(room.players, 'st', x, y, frame);
};
exports.sendTeleportOld = sendTeleportOld;
const handleGetTables = ({ msg, penguin, room }, ...tableIds) => {
    // return table occupancy counts for the requested table ids
    msg.send(penguin, 'gt', ...tableIds.map(id => {
        return `${id}|${room.getTable(id).getCount()}`;
    }));
};
exports.handleGetTables = handleGetTables;
const handleJoinTable = ({ msg, penguin, room }, tableId) => {
    const table = room.getTable(tableId);
    const before = table.getCount();
    const seatId = table.getSeatIndex(penguin) ?? table.assignSeatIndex(penguin);
    if (seatId !== world_table_1.WorldTable.TABLE_SPECTATOR_SEAT && before === 0) {
        table.reset();
    }
    if (seatId !== world_table_1.WorldTable.TABLE_SPECTATOR_SEAT) {
        const count = table.getCount();
        if (count !== before) {
            msg.send(room.players, 'ut', table.getId(), table.getCount());
        }
    }
    // the index here is 1 based
    const tableSeatId = seatId === world_table_1.WorldTable.TABLE_SPECTATOR_SEAT ? seatId : seatId + 1;
    msg.send(penguin, 'jt', tableId, tableSeatId);
};
exports.handleJoinTable = handleJoinTable;
const handleLeaveTable = ({ msg, room, penguin }) => {
    // old leave flow: free seat, broadcast count, and reset if empty
    const table = room.getPenguinTable(penguin);
    if (table !== null) {
        table.removePlayer(penguin);
        const count = table.getCount();
        msg.send(room.players, 'ut', table.getId(), table.getCount());
        if (count === 0) {
            table.reset();
        }
    }
};
exports.handleLeaveTable = handleLeaveTable;
function isTableId(tableId) {
    return world_table_1.WorldTable.FIND_FOUR_TABLE_IDS.has(tableId) || world_table_1.WorldTable.MANCALA_TABLE_IDS.has(tableId);
}
const handleGetTableGame = ({ msg, room, penguin }, tableId) => {
    // resolve table id from context so spectators can re-open correctly
    let resolvedTableId = Number(tableId);
    if (!isTableId(resolvedTableId)) {
        const existingTable = room.getPenguinTable(penguin);
        if (existingTable !== null) {
            resolvedTableId = existingTable.getId();
        }
    }
    const table = room.getTable(resolvedTableId);
    const boardState = table.serializeBoard();
    msg.send(penguin, 'gz', ...table.getNames(), boardState);
};
exports.handleGetTableGame = handleGetTableGame;
const handleJoinTableGame = ({ msg, room, penguin }) => {
    // join the game instance after table seat selection
    const table = room.getPenguinTable(penguin);
    if (table !== null) {
        const currentSeat = table.getSeatIndex(penguin);
        let seatId;
        if (currentSeat !== undefined) {
            seatId = currentSeat;
        }
        else {
            seatId = table.assignSeatIndex(penguin);
        }
        table.setJoined(seatId);
        msg.send(penguin, 'jz', seatId);
        table.getSeats().forEach((seat, index) => {
            msg.send(penguin, 'uz', index, seat?.name ?? '');
        });
        msg.send(table.penguins, 'uz', seatId, penguin.name);
        // start the match when both players have joined
        if (!table.hasStarted()) {
            if (table.hasEveryoneJoined()) {
                table.setStarted();
                msg.send(table.penguins, 'sz', table.getTurn());
            }
            return;
        }
    }
};
exports.handleJoinTableGame = handleJoinTableGame;
const handleLeaveTableGame = ({ msg, room, penguin }) => {
    // leave the active game: spectators just close, players clear seats/reset
    const table = room.getPenguinTable(penguin);
    if (table !== null) {
        const seat = table.getSeatIndex(penguin);
        if (seat === world_table_1.WorldTable.TABLE_SPECTATOR_SEAT) {
            table.removeSpectator(penguin);
            msg.send(penguin, 'lz');
            return;
        }
        if (!table.hasStarted()) {
            if (seat !== undefined) {
                table.removePlayer(penguin);
                msg.send(table.penguins, 'uz', seat, '');
            }
            const count = table.getCount();
            msg.send(room.players, 'ut', table.getId(), table.getCount());
            if (count === 0) {
                table.reset();
            }
            return;
        }
        msg.send(table.penguins, 'cz', penguin.name);
        table.resetRound();
        msg.send(room.players, 'ut', table.getId(), table.getCount());
    }
};
exports.handleLeaveTableGame = handleLeaveTableGame;
const handleSendTableMove = ({ msg, room, penguin, data }, ...moves) => {
    // dispatch board moves for find four or mancala
    const table = room.getPenguinTable(penguin);
    if (table !== null) {
        if (!table.hasStarted() || table.hasEnded()) {
            return;
        }
        const seat = table.getSeatIndex(penguin);
        if (seat === undefined || seat === world_table_1.WorldTable.TABLE_SPECTATOR_SEAT || !table.hasJoined(seat)) {
            return;
        }
        const player = seat;
        if (player !== 0 && player !== 1) {
            return;
        }
        if (table.getTurn() !== player) {
            return;
        }
        // table game specific logic
        if (moves.length === table.getMoveLength()) {
            // TODO
            const [endArgs, args] = table.sendMove(moves);
            // Ignore non-table zm packets (e.g. sled racing uses 4 args).
            if (table.getAutomaticTurnChange()) {
                table.changeTurn();
            }
            if (args !== null) {
                msg.send(table.penguins, 'zm', ...args);
            }
            if (endArgs !== null) {
                // end args is pre-cpip thing
                // post-cpip: regular player coins
                if (data.isPreCpip()) {
                    table.blockSpectators();
                    msg.send(table.penguins, 'zo', ...endArgs);
                }
                else {
                    table.penguins.forEach(p => msg.send(p, 'zo', p.currency.coins));
                }
                msg.send(room.players, 'ut', table.getId(), table.getCount());
                table.resetRound();
            }
        }
    }
};
exports.handleSendTableMove = handleSendTableMove;
const handleUpdatePenguinOld = ({ penguin, room, msg, data, prst }, color, head, face, neck, body, hand, feet, pin, background) => {
    penguin.inventory.updateWear({
        color,
        head,
        face,
        neck,
        body,
        hand,
        feet,
        pin,
        background
    });
    msg.send(room.players, 'up', (0, join_1.getPenguinString)(data, penguin, room.getState(penguin)));
    prst(penguin);
};
exports.handleUpdatePenguinOld = handleUpdatePenguinOld;
const handleUpdateColor = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ color: id });
    msg.send(room.players, 'upc', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateColor = handleUpdateColor;
const handleUpdateHead = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ head: id });
    msg.send(room.players, 'uph', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateHead = handleUpdateHead;
const handleUpdateFace = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ face: id });
    msg.send(room.players, 'upf', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateFace = handleUpdateFace;
const handleUpdateNeck = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ neck: id });
    msg.send(room.players, 'upn', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateNeck = handleUpdateNeck;
const handleUpdateBody = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ body: id });
    msg.send(room.players, 'upb', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateBody = handleUpdateBody;
const handleUpdateHand = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ hand: id });
    msg.send(room.players, 'upa', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateHand = handleUpdateHand;
const handleUpdateFeet = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ feet: id });
    msg.send(room.players, 'upe', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateFeet = handleUpdateFeet;
const handleUpdatePin = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ pin: id });
    msg.send(room.players, 'upl', penguin.id, id);
    prst(penguin);
};
exports.handleUpdatePin = handleUpdatePin;
const handleUpdateBackground = ({ room, msg, penguin, prst }, id) => {
    penguin.inventory.updateWear({ background: id });
    msg.send(room.players, 'upp', penguin.id, id);
    prst(penguin);
};
exports.handleUpdateBackground = handleUpdateBackground;
const handleGetHockeyGame = ({ world, room, penguin, msg }) => {
    const pos = world.getPuck(room);
    if (pos !== null) {
        msg.send(penguin, 'gz', ...pos, ...world.teamScores);
    }
};
exports.handleGetHockeyGame = handleGetHockeyGame;
const handleMoveHockeyPuck = ({ world, room, msg }, penguinId, x, y, ...speed) => {
    if (world.updatePuck(x, y, room)) {
        msg.send(room.players, 'zm', penguinId, x, y, ...speed);
    }
};
exports.handleMoveHockeyPuck = handleMoveHockeyPuck;
const handleMoveHockeyPuckOld = ({ world, room, msg }, x, y) => {
    if (world.updatePuck(x, y, room)) {
        msg.send(room.players, 'zm', x, y);
    }
};
exports.handleMoveHockeyPuckOld = handleMoveHockeyPuckOld;
const handleUpdateHockeyGame = ({ msg, room, world }, team) => {
    if (room.id !== 802) {
        return;
    }
    world.updateTeamScore(team);
    msg.send(room.players, 'uz', ...world.teamScores);
};
exports.handleUpdateHockeyGame = handleUpdateHockeyGame;
const isTableGuard = ({ room }) => {
    return room.hasTable();
};
exports.isTableGuard = isTableGuard;
const isHockeyGuard = ({ room }) => {
    return room.id === rooms_1.ROOMS.rink.id || room.id === rooms_1.ROOMS.pitch.id;
};
exports.isHockeyGuard = isHockeyGuard;
const handleTeleport = ({ msg, room, penguin }, x, y) => {
    msg.send(room.players, 'tp', penguin.id, x, y);
};
exports.handleTeleport = handleTeleport;
// Mina (cavemine): cavar com o capacete de mineiro dá moedas (r#cdu). Antes o
// servidor não respondia e a escavação não pagava nada. Um intervalo mínimo
// entre escavações evita repetir o pedido sem parar (o limite diário de moedas
// do Project Club continua valendo).
const COIN_DIG_ROOM = 813;
// o jogo pede a cada 2 s enquanto a pessoa dança na área com capacete/pá
const COIN_DIG_COOLDOWN_MS = 1800;
const COIN_DIG_TABLE = [1, 1, 1, 2, 2, 3, 5, 5, 10, 25];
const lastCoinDig = new WeakMap();
const handleCoinDig = ({ penguin, room, msg, prst }) => {
    const now = Date.now();
    const last = lastCoinDig.get(penguin) ?? 0;
    if (room.id !== COIN_DIG_ROOM || now - last < COIN_DIG_COOLDOWN_MS) {
        msg.send(penguin, 'cdu', 0, penguin.currency.coins);
        return;
    }
    lastCoinDig.set(penguin, now);
    // 1 em 100: prêmio grande (o jogo tem animação própria pra 100+)
    const coins = Math.random() < 0.01 ? 100 : COIN_DIG_TABLE[Math.floor(Math.random() * COIN_DIG_TABLE.length)];
    msg.send(penguin, 'cdu', coins, penguin.currency.add(coins));
    prst(penguin);
};
exports.handleCoinDig = handleCoinDig;
/** u#sg: guia turístico apresentando a sala (balão com a descrição pra todos). */
const handleTourGuideMessage = ({ penguin, room, msg }, roomId) => {
    if (!Number.isFinite(roomId)) {
        return;
    }
    msg.send(room.players, 'sg', penguin.id, roomId);
};
exports.handleTourGuideMessage = handleTourGuideMessage;
/** u#sma: frases prontas dos mascotes (Rockhopper, Tia Ártica…). */
const handleMascotMessage = ({ penguin, room, msg }, lineId) => {
    if (!Number.isFinite(lineId) || !penguin.mascot) {
        return;
    }
    msg.send(room.players, 'sma', penguin.id, lineId);
};
exports.handleMascotMessage = handleMascotMessage;
