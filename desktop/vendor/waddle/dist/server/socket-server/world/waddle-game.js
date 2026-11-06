"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaddleGame = void 0;
class WaddleGame {
    _players;
    _gameSeats;
    constructor(_players) {
        this._players = _players;
        this._gameSeats = [..._players];
    }
    removePlayer(penguin) {
        const index = this._players.indexOf(penguin);
        if (index !== -1) {
            this._players.splice(index, 1);
        }
    }
    getPlayerCount() {
        return this._players.length;
    }
    get players() {
        return [...this._players];
    }
    getSeatId(penguin) {
        return this._gameSeats.indexOf(penguin);
    }
}
exports.WaddleGame = WaddleGame;
