"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRoomRefresh = exports.isGameGuard = exports.handleLeaveGame = void 0;
const rooms_1 = require("../../game-logic/rooms.js");
const join_1 = require("./join");
const handleLeaveGame = (ctx, score) => {
    const { game, data, penguin, msg, prst } = ctx;
    const rawCoins = (0, rooms_1.isLiteralScoreGame)(game.getId()) ? (Number(score)) : (Math.floor(Number(score) / 10));
    if (data.isPreCpip()) {
        penguin.currency.add(rawCoins);
        msg.send(penguin, 'zo');
    }
    else {
        const gameStamps = data.getGameStamps(game.getId());
        const sessionStamps = penguin.stampbook.sessionStamps.filter(stamp => gameStamps.has(stamp));
        const collectedCount = [...gameStamps.values()].filter(stamp => penguin.stampbook.has(stamp)).length;
        const totalCount = gameStamps.size;
        const coins = ((totalCount > 0 && collectedCount === totalCount) ? 2 : 1) * rawCoins;
        penguin.stampbook.resetSessionStamps();
        // unknown what last 0 means
        msg.send(penguin, 'zo', penguin.currency.add(coins), sessionStamps.join('|'), collectedCount, totalCount, 0);
    }
    prst(penguin);
};
exports.handleLeaveGame = handleLeaveGame;
const isGameGuard = (ctx) => ctx.game !== undefined;
exports.isGameGuard = isGameGuard;
const handleRoomRefresh = ({ msg, data, penguin }) => {
    msg.send(penguin, 'grs', penguin.id, (0, join_1.getPenguinString)(data, penguin, { x: 0, y: 0, frame: 1 }));
};
exports.handleRoomRefresh = handleRoomRefresh;
