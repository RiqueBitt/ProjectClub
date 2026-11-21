"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchMaker = void 0;
/**
 * Handles a room that will be used for making a match  of games that have queueing
 * */
class MatchmakingRoom {
    _max;
    _matchedCallback;
    _tickCallback;
    _players;
    _time = 0;
    _timer;
    constructor(_max, _matchedCallback, _tickCallback) {
        this._max = _max;
        this._matchedCallback = _matchedCallback;
        this._tickCallback = _tickCallback;
        this._players = [];
        this.resetTime();
        this._timer = setInterval(() => {
            this._tickCallback(this._players, this._time);
            this._time--;
            if (this._time < 0) {
                if (this._players.length >= 2) {
                    this._matchedCallback(this._players);
                    clearInterval(this._timer);
                }
                else {
                    this.resetTime();
                }
            }
        }, 1000);
    }
    resetTime() {
        this._time = 10;
    }
    addPlayer(player) {
        this._players.push(player);
    }
    removePlayer(player) {
        this._players = this._players.filter(p => p !== player);
    }
    clearTimer() {
        clearTimeout(this._timer);
    }
    isEmpty() {
        return this._players.length === 0;
    }
    get full() {
        return this._players.length === this._max;
    }
}
class MatchMaker {
    /** Max number of players each match supports */
    _maxPlayers;
    /** All rooms available */
    _rooms;
    /** Callback to run when a match is found */
    _onMatched = null;
    /** Callback to run each second that ticks while matchmaking */
    _onTick = null;
    constructor(max) {
        this._maxPlayers = max;
        this._rooms = [];
    }
    get capacity() {
        return this._maxPlayers;
    }
    /** Add a player to matchmaking with others in the server */
    addPlayer(player) {
        if (this._onMatched === null || this._onTick === null) {
            throw new Error('Adding player to matchmaking without listeners');
        }
        const availableIndex = this._rooms.findIndex(room => !room.full);
        if (availableIndex === -1) {
            const room = new MatchmakingRoom(this._maxPlayers, players => {
                this._rooms = this._rooms.filter(candidate => candidate !== room);
                this._onMatched?.(players);
            }, this._onTick);
            room.addPlayer(player);
            this._rooms.push(room);
        }
        else {
            const firstOnQueue = this._rooms[availableIndex];
            firstOnQueue.addPlayer(player);
        }
    }
    removePlayer(player) {
        this._rooms.forEach(room => {
            room.removePlayer(player);
            if (room.isEmpty()) {
                room.clearTimer();
            }
        });
        this._rooms = this._rooms.filter(r => !r.isEmpty());
    }
    addMatchListener(callback) {
        this._onMatched = callback;
    }
    addTickListener(callback) {
        this._onTick = callback;
    }
}
exports.MatchMaker = MatchMaker;
