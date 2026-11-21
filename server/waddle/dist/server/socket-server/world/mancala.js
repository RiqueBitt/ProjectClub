"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MancalaTable = void 0;
const world_table_1 = require("./world-table");
class MancalaTable extends world_table_1.WorldTable {
    _board;
    createBoard() {
        this._board = [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
    }
    serializeBoard() {
        if (this._board == undefined) {
            return '';
        }
        return this._board.join(',');
    }
    getMoveLength() {
        return 1;
    }
    getAutomaticTurnChange() {
        return false;
    }
    isMancalaCupForPlayer(player, cup) {
        return player === 0 ? cup >= 0 && cup <= 5 : cup >= 7 && cup <= 12;
    }
    applyMancalaMove(board, player, cup) {
        let stones = board[cup];
        board[cup] = 0;
        const opponentMancala = player === 0 ? 13 : 6;
        let index = cup;
        while (stones > 0) {
            index = (index + 1) % 14;
            if (index === opponentMancala) {
                index = (index + 1) % 14;
            }
            board[index] += 1;
            stones -= 1;
        }
        const playerMancala = player === 0 ? 6 : 13;
        const lastCup = index;
        let command = '';
        let nextTurn = player === 0 ? 1 : 0;
        if (lastCup === playerMancala) {
            command = 'f';
            nextTurn = player;
        }
        else if (this.isMancalaCupForPlayer(player, lastCup) && board[lastCup] === 1) {
            const oppositeCup = 12 - lastCup;
            if (board[oppositeCup] > 0) {
                command = 'c';
                board[playerMancala] += board[oppositeCup] + board[lastCup];
                board[oppositeCup] = 0;
                board[lastCup] = 0;
            }
        }
        const gameOver = this.isMancalaSideEmpty(0) || this.isMancalaSideEmpty(1);
        return { command, nextTurn, gameOver };
    }
    isMancalaSideEmpty(player) {
        if (this._board === undefined) {
            return true;
        }
        const start = player === 0 ? 0 : 7;
        const end = player === 0 ? 5 : 12;
        for (let i = start; i <= end; i++) {
            if (this._board[i] > 0) {
                return false;
            }
        }
        return true;
    }
    sendMove(moves) {
        const cup = moves[0];
        if (!this.isMancalaCupForPlayer(this.turn, cup)) {
            return [null, null];
        }
        if (this._board === undefined || this._board[cup] <= 0) {
            return [null, null];
        }
        const { command, nextTurn, gameOver } = this.applyMancalaMove(this._board, this.turn, cup);
        const zmArgs = [this.turn, cup];
        if (command !== '') {
            zmArgs.push(command);
        }
        // this.sendXt('zm', ...zmArgs);
        this.turn = nextTurn;
        if (gameOver) {
            this.awardMancalaCoins();
            this.endGame();
            return [[], zmArgs];
        }
        return [null, zmArgs];
    }
    awardMancalaCoins() {
        this.awardCoins([this.getMancalaScore(0), this.getMancalaScore(1)]);
    }
    getMancalaScore(player) {
        let total = 0;
        if (this._board !== undefined) {
            const start = player === 0 ? 0 : 7;
            const end = player === 0 ? 6 : 13;
            for (let i = start; i <= end; i++) {
                total += this._board[i];
            }
        }
        return total;
    }
}
exports.MancalaTable = MancalaTable;
