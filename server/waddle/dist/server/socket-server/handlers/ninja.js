"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleJoinFromMatchmake = exports.handleLeaveMatchmake = exports.handleGetWaterLevel = exports.handleGetFireLevel = exports.handleJoinSensei = exports.handleJoinMatchmaking = exports.addMatchmakerListeners = exports.handleBuyNinjaCards = exports.handleGetNinjaCards = exports.handleGetNinjaLevel = exports.handleGetNinjaRanks = void 0;
const cards_1 = require("../../game-logic/cards.js");
const utils_1 = require("../../../common/utils.js");
const games_1 = require("../../game-data/games.js");
const handleGetNinjaRanks = ({ msg, penguin }) => {
    msg.send(penguin, 'gnr', penguin.id, penguin.ninja.cardRank, penguin.ninja.fireProgress.getRank(), penguin.ninja.isWaterNinja ? 5 : 0, penguin.ninja.isSnowNinja ? 13 : 0);
};
exports.handleGetNinjaRanks = handleGetNinjaRanks;
const handleGetNinjaLevel = ({ msg, penguin }) => {
    // ranke, percentage, unsure what 10 is
    msg.send(penguin, 'gnl', penguin.ninja.cardRank, penguin.ninja.cardPercentage, 10);
};
exports.handleGetNinjaLevel = handleGetNinjaLevel;
const handleGetNinjaCards = ({ msg, penguin }) => {
    msg.send(penguin, 'gcd', penguin.ninja.cards.map((card) => {
        return card.join(',');
    }).join('|'));
};
exports.handleGetNinjaCards = handleGetNinjaCards;
function getAllPowerCards() {
    return cards_1.CARDS.rows.filter((card) => card.powerId > 0).map(card => card.id);
}
const handleBuyNinjaCards = ({ msg, penguin, prst }) => {
    const powerCards = getAllPowerCards();
    const cards = (0, utils_1.chooseN)(powerCards, 3);
    cards.forEach(card => {
        penguin.ninja.addCard(card, 1);
    });
    msg.send(penguin, 'bpc', cards.join(','), penguin.currency.discount(1500));
    prst(penguin);
};
exports.handleBuyNinjaCards = handleBuyNinjaCards;
const addMatchmakerListeners = (world, msg) => {
    games_1.MATCHMAKERS.forEach(({ name, id }) => {
        const mm = world.getGame(id).matchMaker;
        if (mm === null) {
            return;
        }
        switch (name) {
            case 'card':
                mm.addMatchListener((players) => {
                    const game = world.getWaddleGame('card', players);
                    const playersInfo = players.map(p => [p.name, p.inventory.color].join('|'));
                    msg.send(players, 'scard', game.roomId, 1000 + players[0].id, players.length, 10, ...playersInfo);
                });
                mm.addTickListener((players, time) => {
                    msg.send(players, 'tmm', time, ...players.map(p => p.name));
                });
                break;
            case 'fire':
                mm.addMatchListener((players) => {
                    const game = world.getWaddleGame('fire', players);
                    const playersInfo = players.map(p => [p.name, p.inventory.color].join('|'));
                    msg.send(players, 'scard', game.roomId, 1000 + players[0].id, players.length, 10, ...playersInfo);
                });
                mm.addTickListener((players, time) => {
                    msg.send(players, 'tmm', players.length, time, ...players.map(p => [p.name, p.inventory.color].join('|')));
                });
                break;
        }
    });
};
exports.addMatchmakerListeners = addMatchmakerListeners;
const handleJoinMatchmaking = ({ msg, penguin, game }) => {
    if (game.matchMaker !== null) {
        game.matchMaker.addPlayer(penguin);
        msg.send(penguin, 'jmm', penguin.name);
    }
};
exports.handleJoinMatchmaking = handleJoinMatchmaking;
const handleJoinSensei = ({ world, penguin, msg, game }) => {
    const room = games_1.MATCHMAKERS.find(m => m.id === game.getId());
    if (room !== undefined) {
        switch (room.name) {
            case 'card':
                const cardGame = world.getWaddleGame('card', [penguin]);
                msg.send(penguin, 'scard', cardGame.roomId, 1000 + penguin.id, 1, 0, [penguin.name, penguin.inventory.color].join('|'));
                break;
            case 'fire':
                const fireGame = world.getWaddleGame('fire', [penguin]);
                msg.send(penguin, 'scard', fireGame.roomId, 1000 + penguin.id, 1, 0, [penguin.name, penguin.inventory.color].join('|'));
                break;
        }
    }
};
exports.handleJoinSensei = handleJoinSensei;
const handleGetFireLevel = ({ penguin, msg }) => {
    msg.send(penguin, 'gfl', penguin.ninja.fireProgress.getRank(), penguin.ninja.fireProgress.getPercentage());
};
exports.handleGetFireLevel = handleGetFireLevel;
const handleGetWaterLevel = ({ msg, penguin }) => {
    msg.send(penguin, 'gwl', 0, 0);
};
exports.handleGetWaterLevel = handleGetWaterLevel;
const handleLeaveMatchmake = ({ game, penguin }) => {
    game.matchMaker?.removePlayer(penguin);
};
exports.handleLeaveMatchmake = handleLeaveMatchmake;
const handleJoinFromMatchmake = (ctx, id) => {
    const { msg, penguin } = ctx;
    msg.send(penguin, 'jx', id);
};
exports.handleJoinFromMatchmake = handleJoinFromMatchmake;
