"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldTable = void 0;
class WorldTable {
    id;
    seats = [null, null];
    joined = [false, false];
    spectators = new Set();
    _blockPayout = new Set();
    static TABLE_SPECTATOR_SEAT = 99;
    started = false;
    ended = false;
    turn = 0;
    constructor(id) {
        this.id = id;
    }
    static MANCALA_TABLE_IDS = new Set([100, 101, 102, 103, 104]);
    static FIND_FOUR_TABLE_IDS = new Set([200, 201, 202, 203, 204, 205, 206, 207]);
    static TREASURE_HUNT_TABLE_IDS = new Set([300, 301, 302, 303, 304, 305, 306, 307]);
    getCount() {
        return this.seats.filter(p => p !== null).length;
    }
    getId() {
        return this.id;
    }
    getSeatIndex(penguin) {
        if (this.spectators.has(penguin)) {
            return WorldTable.TABLE_SPECTATOR_SEAT;
        }
        const seatIndex = this.seats.findIndex((seat) => seat?.id === penguin.id);
        return seatIndex === -1 ? undefined : seatIndex;
    }
    assignSeatIndex(penguin) {
        const existingSeat = this.getSeatIndex(penguin);
        if (existingSeat !== undefined) {
            return existingSeat;
        }
        const openSeat = this.seats.findIndex((seat) => seat === null);
        if (openSeat === -1) {
            this.spectators.add(penguin);
            return WorldTable.TABLE_SPECTATOR_SEAT;
        }
        this.seats[openSeat] = penguin;
        return openSeat;
    }
    reset() {
        this.createBoard();
        this.started = false;
        this.ended = false;
        this.turn = 0;
        this.spectators = new Set();
    }
    getSeats() {
        return [...this.seats];
    }
    resetRound() {
        this.reset();
        this.seats = [null, null];
        this.joined = [false, false];
    }
    hasPlayer(penguin) {
        return this.getSeatIndex(penguin) !== -1;
    }
    removePlayer(penguin) {
        const seat = this.getSeatIndex(penguin);
        if (seat !== undefined) {
            this.seats[seat] = null;
        }
    }
    removeSpectator(penguin) {
        return this.spectators.delete(penguin);
    }
    unblockPayout(penguin) {
        return this._blockPayout.delete(penguin);
    }
    blockSpectators() {
        this.spectators.forEach(s => this._blockPayout.add(s));
    }
    getNames() {
        return this.seats.map(p => p?.name ?? '');
    }
    setJoined(seat) {
        this.joined[seat] = true;
    }
    get penguins() {
        return [...this.seats.filter((value) => {
                return value !== null;
            }), ...this.spectators];
    }
    hasStarted() {
        return this.started;
    }
    hasJoined(seat) {
        return this.joined[seat];
    }
    hasEveryoneJoined() {
        return this.joined.every(joined => joined);
    }
    setStarted() {
        this.started = true;
        this.turn = 0;
    }
    getTurn() {
        return this.turn;
    }
    hasEnded() {
        return this.ended;
    }
    changeTurn() {
        this.turn = (this.turn + 1) % 2;
    }
    endGame() {
        this.ended = true;
    }
    awardCoins(scores) {
        this.seats.forEach((player, index) => {
            if (player !== null && (index == 0 || index == 1)) {
                const score = scores[index];
                if (score > 0) {
                    player.currency.add(score);
                }
            }
        });
    }
}
exports.WorldTable = WorldTable;
