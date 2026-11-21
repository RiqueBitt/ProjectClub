"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldRoom = void 0;
const find_four_1 = require("./find-four");
const mancala_1 = require("./mancala");
const treasure_hunt_1 = require("./treasure-hunt");
const world_table_1 = require("./world-table");
class WorldRoom {
    _id;
    penguins = new Map();
    waddles = new Map();
    tables = new Map();
    constructor(_id) {
        this._id = _id;
    }
    getPlayers() {
        return [];
    }
    getPlayerStates() {
        return this.penguins.entries();
    }
    get players() {
        return [...this.penguins.keys()];
    }
    get playerStates() {
        return [...this.penguins.entries()];
    }
    addPenguin(penguin, x, y) {
        this.penguins.set(penguin, { x, y, frame: 1 });
    }
    getState(penguin) {
        const state = this.penguins.get(penguin);
        if (state === undefined) {
            throw new Error("Penguin not found");
        }
        return state;
    }
    removePenguin(penguin) {
        this.penguins.delete(penguin);
    }
    addWaddle(id, waddle) {
        this.waddles.set(id, waddle);
    }
    getWaddleRooms() {
        return [...this.waddles.values()];
    }
    getWaddleRoom(id) {
        return this.waddles.get(id);
    }
    enterWaddleRoom(waddle, penguin) {
        const index = waddle.addPenguin(penguin);
        if (index === null) {
            throw new Error("Somehow entered full waddle room");
        }
        return index;
    }
    getTable(id) {
        let table = this.tables.get(id);
        if (table === undefined) {
            if (world_table_1.WorldTable.FIND_FOUR_TABLE_IDS.has(id)) {
                table = new find_four_1.FindFourTable(id);
            }
            else if (world_table_1.WorldTable.MANCALA_TABLE_IDS.has(id)) {
                table = new mancala_1.MancalaTable(id);
            }
            else if (world_table_1.WorldTable.TREASURE_HUNT_TABLE_IDS.has(id)) {
                table = new treasure_hunt_1.TreasureHuntTable(id);
            }
            else {
                throw new Error('Unknown table id');
            }
            this.tables.set(id, table);
        }
        return table;
    }
    getPenguinTable(penguin) {
        for (const table of this.tables.values()) {
            if (table.hasPlayer(penguin)) {
                return table;
            }
        }
        return null;
    }
    get id() {
        return this._id;
    }
    setFrame(penguin, frame) {
        const info = this.penguins.get(penguin);
        if (info !== undefined) {
            info.frame = frame;
        }
    }
    updatePosition(penguin, x, y) {
        // dance animation resets
        this.penguins.set(penguin, { x, y, frame: 1 });
    }
    updateFrame(penguin, frame) {
        this.penguins.set(penguin, { ...this.getState(penguin), frame });
    }
    hasTable() {
        return this.tables.size > 0;
    }
    getTables() {
        return [...this.tables.values()];
    }
}
exports.WorldRoom = WorldRoom;
