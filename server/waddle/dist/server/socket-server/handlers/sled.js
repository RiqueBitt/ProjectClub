"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleEndSled = exports.handleMoveSled = exports.handleJoinSled = exports.isSledGuard = void 0;
const isSledGuard = (ctx) => ctx.sled !== undefined;
exports.isSledGuard = isSledGuard;
const handleJoinSled = ({ sled, penguin, msg, data }) => {
    msg.send(penguin, 'uz', sled.getPlayerCount(), ...sled.players.map((p) => {
        return (data.isPreCpip() ? [p.name, p.inventory.color] : [p.name, p.inventory.color, p.inventory.hand, p.name]).join('|');
    }));
};
exports.handleJoinSled = handleJoinSled;
const handleMoveSled = ({ sled, msg }, id, x, y, time) => {
    msg.send(sled.players, 'zm', id, x, y, time);
};
exports.handleMoveSled = handleMoveSled;
const handleEndSled = ({ msg, penguin, prst, data }, standing) => {
    const coins = [20, 10, 5, 5][standing - 1];
    const total = penguin.currency.add(coins);
    if (data.isPreCpip()) {
        msg.send(penguin, 'zo');
    }
    else {
        msg.send(penguin, 'zo', total, '', 0, 0);
    }
    prst(penguin);
};
exports.handleEndSled = handleEndSled;
