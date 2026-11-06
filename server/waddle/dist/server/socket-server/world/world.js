"use strict";
// ZA WAAAAARUDO!
Object.defineProperty(exports, "__esModule", { value: true });
exports.World = void 0;
const utils_1 = require("../../../common/utils.js");
const waddles_1 = require("../../game-logic/waddles.js");
const sled_1 = require("./sled");
const waddle_room_1 = require("./waddle-room");
const world_game_1 = require("./world-game");
const world_room_1 = require("./world-room");
const card_1 = require("./card");
const bakery_1 = require("./bakery");
const matchmaker_1 = require("./matchmaker");
const fire_1 = require("./fire");
const games_1 = require("../../game-data/games.js");
class World {
    gameData;
    // Project Club: ações dos pinguins pras quests da Praça
    _actionListeners = [];
    onAction(fn) { this._actionListeners.push(fn); }
    emitAction(a) { for (const fn of this._actionListeners) { try { fn(a); } catch { /* ok */ } } }
    penguins = new Map();
    states = new Map;
    rooms = new Map();
    games = new Map();
    spectators = new Set();
    igloos = new Set();
    _bakery;
    // create class responsible for the puck
    _puckPosition = new utils_1.Vector(0, 0);
    _puckPositionParty = new utils_1.Vector(0, 0);
    _teamsScore = [0, 0];
    constructor(gameData) {
        this.gameData = gameData;
        this.init();
        this._bakery = new bakery_1.Bakery(this.getRoom(853));
        games_1.MATCHMAKERS.forEach(({ id, count }) => {
            this.games.set(id, new world_game_1.WorldGame(id, new matchmaker_1.MatchMaker(count)));
        });
    }
    getRoom(id) {
        let room = this.rooms.get(id);
        if (room === undefined) {
            room = new world_room_1.WorldRoom(id);
            this.rooms.set(id, room);
        }
        return room;
    }
    addPenguin(penguin) {
        this.penguins.set(penguin.id, penguin);
    }
    getPenguinRoom(p) {
        const state = this.states.get(p);
        if (state === undefined || !('room' in state)) {
            return undefined;
        }
        return state.room;
    }
    getContext(p) {
        return this.states.get(p);
    }
    enterState(p, s) {
        this.states.set(p, s);
    }
    getPenguin(id) {
        return this.penguins.get(id);
    }
    getGame(id) {
        let game = this.games.get(id);
        if (game === undefined) {
            game = new world_game_1.WorldGame(id);
            this.games.set(id, game);
        }
        return game;
    }
    disconnect(penguin) {
        this.penguins.delete(penguin.id);
        this.states.delete(penguin);
    }
    init() {
        const extraWaddleRooms = this.gameData.getExtraWaddleRooms();
        [...waddles_1.WADDLE_ROOMS, ...extraWaddleRooms].forEach((waddle) => {
            const room = this.getRoom(waddle.roomId);
            room.addWaddle(waddle.waddleId, new waddle_room_1.WaddleRoom(waddle.waddleId, waddle.seats, waddle.game));
        });
    }
    getWaddleGame(name, players) {
        let game;
        switch (name) {
            case 'card':
                game = new card_1.CardJitsu(players);
                players.forEach(p => this.enterState(p, { card: game }));
                break;
            case 'fire':
                game = new fire_1.FireGame(players);
                players.forEach(p => this.enterState(p, { fire: game }));
                break;
            case 'sled':
                game = new sled_1.SledRace(players);
                players.forEach(p => this.enterState(p, { sled: game }));
                break;
            default:
                throw new Error('No waddle game constructor set');
        }
        return game;
    }
    getById(id) {
        return this.penguins.get(id);
    }
    removeSpectator(penguin) {
        return this.spectators.delete(penguin);
    }
    // maybe a class for managing open igloos 
    openIgloo(penguin) {
        this.igloos.add(penguin);
    }
    closeIgloo(penguin) {
        this.igloos.delete(penguin);
    }
    getOpenIglooPlayers() {
        return [...this.igloos.values()];
    }
    getPuckPosition() {
        return this._puckPosition.vector;
    }
    getPuckPositionParty() {
        return this._puckPositionParty.vector;
    }
    get players() {
        return [...this.penguins.values()];
    }
    get teamScores() {
        return [...this._teamsScore];
    }
    getPuck(room) {
        return {
            802: this.getPuckPosition(),
            898: this.getPuckPositionParty()
        }[room.id] ?? null;
    }
    updatePuck(x, y, room) {
        if (room.id === 802) {
            this._puckPosition = new utils_1.Vector(x, y);
            return true;
        }
        else if (room.id === 898) {
            this._puckPositionParty = new utils_1.Vector(x, y);
            return true;
        }
        else {
            return false;
        }
    }
    updateTeamScore(team) {
        this._teamsScore[team]++;
        if (this._teamsScore[team] >= 10) {
            this._teamsScore = [0, 0];
        }
    }
    addBakeryListener(callback) {
        this._bakery.addListener(callback);
    }
    get bakery() {
        return this._bakery;
    }
}
exports.World = World;
