"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldGame = void 0;
const rooms_1 = require("../../game-logic/rooms.js");
class WorldGame {
    id;
    _matchMaker = null;
    constructor(id, mm) {
        this.id = id;
        this._matchMaker = mm ?? null;
    }
    get matchMaker() {
        return this._matchMaker;
    }
    getId() {
        return this.id;
    }
    getCoinsFromScore(score) {
        return (0, rooms_1.isLiteralScoreGame)(this.id) ? (Number(score)) : (Math.floor(Number(score) / 10));
    }
}
exports.WorldGame = WorldGame;
