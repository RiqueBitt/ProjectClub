"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FindFourTable = void 0;
const world_table_1 = require("./world-table");
class FindFourTable extends world_table_1.WorldTable {
    static FIND_FOUR_WIDTH = 7;
    static FIND_FOUR_HEIGHT = 6;
    _board;
    createBoard() {
        this._board = Array.from({ length: FindFourTable.FIND_FOUR_WIDTH }, () => Array(FindFourTable.FIND_FOUR_HEIGHT).fill(0));
    }
    getAutomaticTurnChange() {
        return true;
    }
    getMoveLength() {
        return 2;
    }
    sendMove(moves) {
        if (this._board === undefined) {
            return [null, null];
        }
        const column = moves[0];
        const dropRow = moves[1];
        this._board[column][dropRow] = this.turn + 1;
        const args = [this.turn, column, dropRow];
        // this.sendXt('zm', this.turn, column, dropRow);
        const win = this.findFourWin(column, dropRow);
        if (win !== undefined) {
            this.awardFindFourCoins(win.winner - 1);
            this.endGame();
            return [[win.x, win.y, win.direction], args];
            // return true;
        }
        else if (this.isFindFourBoardFull()) {
            this.awardFindFourCoins();
            this.endGame();
            return [[-10, -10, 1], args];
        }
        return [null, args];
    }
    isFindFourBoardFull() {
        if (this._board !== undefined) {
            for (let x = 0; x < FindFourTable.FIND_FOUR_WIDTH; x++) {
                for (let y = 0; y < FindFourTable.FIND_FOUR_HEIGHT; y++) {
                    if (this._board[x]?.[y] === 0) {
                        return false;
                    }
                }
            }
        }
        return true;
    }
    awardFindFourCoins(winnerSeat) {
        const rewards = [5, 5];
        if (winnerSeat === 0 || winnerSeat === 1) {
            rewards[winnerSeat] = 10;
        }
        this.awardCoins(rewards);
    }
    serializeBoard() {
        const values = [];
        if (this._board !== undefined) {
            for (let x = 0; x < FindFourTable.FIND_FOUR_WIDTH; x++) {
                for (let y = 0; y < FindFourTable.FIND_FOUR_HEIGHT; y++) {
                    values.push(this._board[x]?.[y] ?? 0);
                }
            }
        }
        return values.join(',');
    }
    findFourWin(lastX, lastY) {
        if (this._board === undefined) {
            return undefined;
        }
        const value = this._board[lastX]?.[lastY] ?? 0;
        if (value <= 0) {
            return undefined;
        }
        const inBounds = (x, y) => x >= 0 && x < FindFourTable.FIND_FOUR_WIDTH && y >= 0 && y < FindFourTable.FIND_FOUR_HEIGHT;
        const countInDirection = (dx, dy) => {
            let count = 0;
            if (this._board !== undefined) {
                let x = lastX + dx;
                let y = lastY + dy;
                while (inBounds(x, y) && this._board[x]?.[y] === value) {
                    count += 1;
                    x += dx;
                    y += dy;
                }
            }
            return count;
        };
        const directions = [
            { dx: 1, dy: 0, direction: 2 },
            { dx: 0, dy: 1, direction: 1 },
            { dx: 1, dy: 1, direction: 3 },
            { dx: 1, dy: -1, direction: 4 }
        ];
        let best;
        for (const { dx, dy, direction } of directions) {
            const back = countInDirection(-dx, -dy);
            const forward = countInDirection(dx, dy);
            const total = back + 1 + forward;
            if (total < 4) {
                continue;
            }
            const lineStartX = lastX - dx * back;
            const lineStartY = lastY - dy * back;
            const startMin = Math.max(0, back - 3);
            const startMax = Math.min(back, total - 4);
            for (let startIndex = startMin; startIndex <= startMax; startIndex++) {
                const startX = lineStartX + dx * startIndex;
                const startY = lineStartY + dy * startIndex;
                const positions = [
                    { x: startX, y: startY },
                    { x: startX + dx, y: startY + dy },
                    { x: startX + dx * 2, y: startY + dy * 2 },
                    { x: startX + dx * 3, y: startY + dy * 3 }
                ];
                const anchorY = Math.min(...positions.map((pos) => pos.y));
                const anchorX = direction === 4
                    ? Math.max(...positions.map((pos) => pos.x))
                    : Math.min(...positions.map((pos) => pos.x));
                const centerX = startX + dx * 1.5;
                const centerY = startY + dy * 1.5;
                const dist = (centerX - lastX) ** 2 + (centerY - lastY) ** 2;
                if (best === undefined || dist < best.dist) {
                    best = { x: anchorX, y: anchorY, direction, winner: value, dist };
                }
            }
        }
        if (best !== undefined) {
            return { x: best.x, y: best.y, direction: best.direction, winner: best.winner };
        }
        return undefined;
    }
}
exports.FindFourTable = FindFourTable;
