"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OfflineWorld = void 0;
const world_penguin_1 = require("./world/world-penguin");
// Note -> Offline world never unloads penguins
// Once a penguin is updated offline, it will remain in memory until it logins in
class OfflineWorld {
    _db;
    _penguins = new Map();
    constructor(_db) {
        this._db = _db;
    }
    async getPenguin(id) {
        const saved = this._penguins.get(id);
        if (saved === undefined) {
            const data = await this._db.get(id);
            if (data === null) {
                return undefined;
            }
            else {
                const penguin = new world_penguin_1.OfflinePenguin(id, data);
                this._penguins.set(id, penguin);
                return penguin;
            }
        }
        else {
            return saved;
        }
    }
    removePenguin(id) {
        this._penguins.delete(id);
    }
}
exports.OfflineWorld = OfflineWorld;
