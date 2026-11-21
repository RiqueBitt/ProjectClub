"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaddleRoom = void 0;
class WaddleRoom {
    id;
    game;
    _seats;
    _capacity;
    _takenIndex = 0;
    constructor(id, seats, game) {
        this.id = id;
        this.game = game;
        this._capacity = seats;
        this._seats = new Array(seats).fill(null);
    }
    getId() {
        return this.id;
    }
    getSeats() {
        return [...this._seats];
    }
    addPenguin(penguin) {
        if (this._takenIndex < this._capacity) {
            const seat = this._takenIndex;
            this._seats[seat] = penguin;
            for (this._takenIndex = seat + 1; this._takenIndex < this._capacity; this._takenIndex++) {
                if (this._seats[this._takenIndex] === null) {
                    break;
                }
            }
            return seat;
        }
        return null;
    }
    isFull() {
        return this._takenIndex >= this._capacity;
    }
    getGame() {
        return this.game;
    }
    reset() {
        this._seats = new Array(this._capacity).fill(null);
        this._takenIndex = 0;
    }
    removePlayer(penguin) {
        const index = this._seats.findIndex(p => p === penguin);
        if (index > -1) {
            this._seats[index] = null;
            for (let i = 0; i < this._capacity; i++) {
                if (this._seats[i] === null) {
                    this._takenIndex = i;
                    break;
                }
            }
        }
        return index;
    }
}
exports.WaddleRoom = WaddleRoom;
