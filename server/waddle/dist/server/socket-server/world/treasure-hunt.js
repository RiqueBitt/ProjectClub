"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreasureHuntTable = void 0;
const world_table_1 = require("./world-table");
// placeholder until the correct logic is implemented
class TreasureHuntTable extends world_table_1.WorldTable {
    createBoard() {
    }
    serializeBoard() {
        return '';
    }
    getMoveLength() {
        return 0;
    }
    sendMove(moves) {
        return [[], []];
    }
    getAutomaticTurnChange() {
        return false;
    }
}
exports.TreasureHuntTable = TreasureHuntTable;
