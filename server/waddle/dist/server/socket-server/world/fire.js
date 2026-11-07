"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FireGame = exports.BattlePlayer = exports.FireSensei = exports.FirePlayer = exports.FireNinja = exports.getCounterClockwise = exports.getClockwise = exports.getRandomSpin = exports.BOARD = exports.STARTER_ENERGY = void 0;
const utils_1 = require("../../../common/utils.js");
const waddle_game_1 = require("./waddle-game");
const ninja_progress_1 = require("../../game-logic/ninja-progress.js");
exports.STARTER_ENERGY = 6;
const BOARD_TILE_COUNT = 16;
exports.BOARD = [
    'b', 's', 'w', 'f',
    'c', 's', 'f', 'w',
    'b', 's', 'w', 'f',
    'c', 'w', 's', 'f'
];
const START_POSITIONS = [12, 4, 8, 0];
const getRandomSpin = () => (0, utils_1.randomInt)(1, 6);
exports.getRandomSpin = getRandomSpin;
const getClockwise = (base, spin) => (0, utils_1.modulo)(base - spin, BOARD_TILE_COUNT);
exports.getClockwise = getClockwise;
const getCounterClockwise = (base, spin) => (0, utils_1.modulo)(base + spin, BOARD_TILE_COUNT);
exports.getCounterClockwise = getCounterClockwise;
class Hand {
    _canDrawCards;
    _cantDrawCards;
    _hand;
    constructor(cards) {
        this._canDrawCards = [...cards];
        this._cantDrawCards = [];
        this._hand = [];
    }
    get cards() {
        return [...this._hand];
    }
    draw(index) {
        const useIndex = (0, utils_1.randomInt)(0, this._canDrawCards.length - 1);
        const card = this._canDrawCards.splice(useIndex, 1)[0];
        this._cantDrawCards.push(card);
        if (index === undefined) {
            this._hand.push(card);
        }
        else {
            this._hand[index] = card;
        }
        if (this._canDrawCards.length === 0) {
            this._canDrawCards = this._cantDrawCards;
            this._cantDrawCards = [];
            this._hand.forEach(card => {
                const index = this._canDrawCards.findIndex(c => c === card);
                if (index !== -1) {
                    this._canDrawCards.splice(index, 1);
                    this._cantDrawCards.push(card);
                }
            });
        }
        return card;
    }
}
class FireNinja {
    _tile;
    _energy = exports.STARTER_ENERGY;
    _seatId;
    _energyGains = 0;
    _lostEnergy = false;
    constructor(tile, seat) {
        this._tile = tile;
        this._seatId = seat;
    }
    get tile() {
        return this._tile;
    }
    updateTile(tile) {
        this._tile = tile;
    }
    get energy() {
        return this._energy;
    }
    get energyGains() {
        return this._energyGains;
    }
    get lostEnergy() {
        return this._lostEnergy;
    }
    addEnergy() {
        this._energy++;
        this._energyGains++;
    }
    removeEnergy() {
        this._energy--;
        this._lostEnergy = true;
    }
    get seat() {
        return this._seatId;
    }
}
exports.FireNinja = FireNinja;
class FirePlayer extends FireNinja {
    _hand;
    _ready = false;
    _penguin;
    constructor(tile, p, seat) {
        super(tile, seat);
        this._hand = new Hand(p.ninja.getDeck());
        for (let i = 0; i < 5; i++) {
            this._hand.draw();
        }
        this._penguin = p;
    }
    get penguin() {
        return this._penguin;
    }
    get hand() {
        return this._hand.cards;
    }
    drawCard(index) {
        this._hand.draw(index);
    }
    get ready() {
        return this._ready;
    }
    setReady() {
        this._ready = true;
    }
    unready() {
        this._ready = false;
    }
}
exports.FirePlayer = FirePlayer;
class FireSensei extends FireNinja {
    _beatable;
    constructor(tile, beatable, seat) {
        super(tile, seat);
        this._beatable = beatable;
    }
    get beatable() {
        return this._beatable;
    }
}
exports.FireSensei = FireSensei;
class BattlePlayer {
    _chosenIndex = null;
    _ninja;
    _cardTimeout = null;
    _pendingCallback = null;
    constructor(ninja) {
        this._ninja = ninja;
    }
    setCard(index) {
        this._chosenIndex = index;
    }
    get chosen() {
        return this._chosenIndex;
    }
    get ninja() {
        return this._ninja;
    }
    setCardTimeout(callback) {
        this._cardTimeout = setTimeout(() => {
            callback();
            this._cardTimeout = null;
        }, 23000);
    }
    clearTimeout() {
        if (this._cardTimeout !== null) {
            clearTimeout(this._cardTimeout);
            this._cardTimeout = null;
        }
    }
    setPending(callback) {
        this._pendingCallback = async () => {
            await callback();
            this._pendingCallback = null;
        };
    }
    isPending() {
        return this._pendingCallback !== null;
    }
    async callPending() {
        if (this._pendingCallback !== null) {
            await this._pendingCallback();
        }
    }
}
exports.BattlePlayer = BattlePlayer;
class FireRound {
    _seats;
    _ninjas;
    _players;
    _battleType;
    constructor(type, players) {
        this._ninjas = [...players];
        this._players = new Map(players.filter(n => n instanceof FirePlayer).map(n => [n.penguin, new BattlePlayer(n)]));
        this._seats = [...this._players.values()];
        this._battleType = type;
    }
    fromPenguin(p) {
        return this._players.get(p);
    }
    get cards() {
        return this._seats.map(b => b.chosen);
    }
    get players() {
        return [...this._seats];
    }
    get ninjas() {
        return [...this._ninjas];
    }
    get type() {
        return this._battleType;
    }
}
class FireGame extends waddle_game_1.WaddleGame {
    _spin = [0, 0, 0];
    _round;
    _seats;
    _activePlayer;
    _playing;
    _standing = new Map();
    _penguins;
    _sensei = null;
    _boardTimeout = null;
    roomId = 997;
    constructor(players) {
        super(players);
        const isSensei = players.length === 1;
        this._seats = [...players, ...(isSensei ? [null] : [])].map((p, i) => {
            const tile = START_POSITIONS[i];
            if (p === null) {
                const sensei = new FireSensei(tile, players[0].ninja.fireProgress.getRank() >= ninja_progress_1.MIN_SENSEI_RANK, i);
                this._sensei = sensei;
                return sensei;
            }
            else {
                return new FirePlayer(START_POSITIONS[i], p, i);
            }
        });
        this._penguins = new Map(this._seats.filter((n) => n instanceof FirePlayer).map(n => [n.penguin, n]));
        this._playing = [...this._seats];
        this._activePlayer = this._playing[0];
        this.newSpin();
        this._round = new FireRound('b', []);
    }
    get spin() {
        return [...this._spin];
    }
    newSpin() {
        const tile = this._activePlayer.tile;
        const spin = (0, exports.getRandomSpin)();
        this._spin = [spin, (0, exports.getClockwise)(tile, spin), (0, exports.getCounterClockwise)(tile, spin)];
    }
    nextPlayer() {
        const index = this._playing.findIndex(p => p === this._activePlayer);
        this._activePlayer = this._playing[(index + 1) % this._playing.length];
    }
    get positions() {
        return this._seats.map(n => n.tile);
    }
    createRound(players, type) {
        this._round = new FireRound(type, players);
    }
    get round() {
        return this._round;
    }
    get energies() {
        return this._seats.map(n => n.energy);
    }
    everyoneReady() {
        const ready = this._playing.every(n => !(n instanceof FirePlayer) || n.ready);
        if (ready) {
            this._playing.forEach(n => {
                if (n instanceof FirePlayer) {
                    n.unready();
                }
            });
        }
        return ready;
    }
    get activePlayer() {
        return this._activePlayer;
    }
    get activePlayers() {
        return [...this._playing];
    }
    get standings() {
        return this._seats.map((n) => this._standing.get(n) ?? 1);
    }
    playerEntersPodium(ninja) {
        this._playing = this._playing.filter(n => n !== ninja);
        this._standing.set(ninja, this._seats.length - this._standing.size);
    }
    getPosition(n) {
        return this._standing.get(n) ?? 1;
    }
    get matchPlayerCount() {
        return this._seats.length;
    }
    fromPenguin(p) {
        return this._penguins.get(p);
    }
    fromSeat(seat) {
        return this._seats[seat];
    }
    isPlaying(ninja) {
        return this._standing.get(ninja) === undefined;
    }
    setBoardTimeout(callback) {
        this._boardTimeout = setTimeout(() => {
            callback();
            this._boardTimeout = null;
        }, 23000);
    }
    clearBoardTimeout() {
        if (this._boardTimeout !== null) {
            clearTimeout(this._boardTimeout);
            this._boardTimeout = null;
        }
    }
    isChoosing() {
        return this._boardTimeout !== null;
    }
    get ninjas() {
        return [...this._seats];
    }
    get sensei() {
        return this._sensei;
    }
}
exports.FireGame = FireGame;
