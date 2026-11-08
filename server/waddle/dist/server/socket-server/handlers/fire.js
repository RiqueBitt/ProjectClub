"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleFireMove = exports.handleLeaveFire = exports.handleEnterFireGame = exports.isFireGuard = void 0;
const logger_1 = require("../../logger.js");
const fire_1 = require("../world/fire");
const card_1 = require("../world/card");
const cards_1 = require("../../game-logic/cards.js");
const card_2 = require("./card");
const utils_1 = require("../../../common/utils.js");
const ninja_progress_1 = require("../../game-logic/ninja-progress.js");
const stamps_1 = require("../../game-logic/stamps.js");
const puffle_1 = require("./puffle");
const isFireGuard = () => true;
exports.isFireGuard = isFireGuard;
const handleEnterFireGame = async (ctx) => {
    const { fire, penguin, msg } = ctx;
    const ninja = fire.fromPenguin(penguin);
    if (ninja === undefined) {
        return;
    }
    ninja.setReady();
    await msg.send(penguin, 'jz', ninja.seat);
    await msg.send(penguin, 'sz', fire.activePlayer.seat, // this is seemingly always 0, which is odd
    fire.ninjas.map(n => n instanceof fire_1.FirePlayer ? n.penguin.name : 'Sensei').join(','), fire.ninjas.map(n => n instanceof fire_1.FirePlayer ? n.penguin.inventory.color : -1).join(','), fire.energies.join(','), fire.positions.join(','), ninja.hand.join(','), fire.spin.join(','), fire.ninjas.filter(n => n instanceof fire_1.FirePlayer).map(n => n.penguin.ninja.cardRank).join(','), '' // unused
    );
    if (fire.everyoneReady()) {
        fire.setBoardTimeout(() => handleBoardTimeout(ctx));
    }
};
exports.handleEnterFireGame = handleEnterFireGame;
const fireStamps = (data) => {
    return data.isStampAvailable(stamps_1.Stamp.WarmUp);
};
const handleClickSpinner = ({ msg, fire }, tablet) => {
    msg.send(fire.players, 'zm', 'is', '' /* unused */, tablet);
};
const getBattleInfo = (battleType) => battleType === 'b' ? ['be', ''] : ['bt', battleType];
const handleStartBattle = async (ctx, type, players) => {
    const { fire, msg } = ctx;
    const [battle, trump] = getBattleInfo(type);
    fire.clearBoardTimeout();
    fire.createRound(players, type);
    fire.round.players.forEach(b => {
        b.setCardTimeout(() => {
            if (b.chosen === null) {
                handleClickCardRandom({ ...ctx, penguin: b.ninja.penguin });
            }
        });
    });
    await msg.send(fire.players, 'zm', 'sb', battle, players.map(p => p.seat).join(','), trump);
};
const handleSendChooseOpponent = async ({ msg, fire }, pool) => {
    await msg.send(fire.players, 'zm', 'co', '' /* unused */, pool.map(n => n.seat).join(','));
};
const handleChooseOpponent = async (ctx, opponent) => {
    const { fire, penguin } = ctx;
    const ninja = fire.fromPenguin(penguin);
    if (ninja === undefined) {
        return;
    }
    await handleStartBattle(ctx, 'b', [ninja, fire.fromSeat(opponent)]);
};
var ClickBoardFlag;
(function (ClickBoardFlag) {
    ClickBoardFlag[ClickBoardFlag["Manual"] = 0] = "Manual";
    ClickBoardFlag[ClickBoardFlag["Auto"] = 1] = "Auto";
    ClickBoardFlag[ClickBoardFlag["Sensei"] = 2] = "Sensei";
})(ClickBoardFlag || (ClickBoardFlag = {}));
;
const handleClickBoard = async (ctx, tile, flag) => {
    const { msg, fire, penguin } = ctx;
    const ninja = flag === ClickBoardFlag.Sensei ? fire.sensei : fire.fromPenguin(penguin);
    if (ninja === undefined || ninja === null) {
        return;
    }
    const auto = flag !== ClickBoardFlag.Manual;
    const playersInTile = fire.activePlayers
        .map(n => n.tile === tile ? n : null)
        .filter((n) => n !== null);
    ninja.updateTile(tile);
    await msg.send(fire.players, 'zm', 'ub', ninja.seat, fire.positions.join(','), auto ? (0, utils_1.randomInt)(1, 6) : 0 // the tablet being clicked, though this is seemingly only needed in auto play in the first turn
    );
    if (playersInTile.length > 0) {
        if (playersInTile.length === 1) {
            await handleStartBattle(ctx, 'b', [ninja, ...playersInTile]);
        }
        else {
            if (auto) {
                await handleStartBattle(ctx, 'b', [ninja, (0, utils_1.choose)(playersInTile)]);
            }
            else {
                await handleSendChooseOpponent(ctx, playersInTile);
            }
        }
    }
    else {
        const type = fire_1.BOARD[tile];
        if (type === 'b') {
            if (fire.players.length > 2) {
                if (auto) {
                    await handleStartBattle(ctx, 'b', [ninja, (0, utils_1.choose)(fire.activePlayers.filter(n => n !== ninja))]);
                }
                else {
                    await handleSendChooseOpponent(ctx, fire.activePlayers);
                }
            }
            else {
                await handleStartBattle(ctx, type, fire.activePlayers);
            }
        }
        else if (type === 'c') {
            if (auto) {
                await handleChooseTrump(ctx, (0, utils_1.choose)(['f', 'w', 's']));
            }
            else {
                await msg.send(fire.players, 'zm', 'ct');
            }
        }
        else {
            await handleStartBattle(ctx, type, fire.activePlayers);
        }
    }
};
const handleClickBoardPlayer = async (ctx, tile) => await handleClickBoard(ctx, tile, ClickBoardFlag.Manual);
const handleClickBoardRandom = async (ctx, sensei) => {
    const { fire } = ctx;
    await handleClickBoard(ctx, fire.spin[(0, utils_1.randomInt)(1, 2)], sensei ? ClickBoardFlag.Sensei : ClickBoardFlag.Auto);
};
const handleBoardTimeout = async (ctx) => {
    const { msg, fire } = ctx;
    const ninja = fire.activePlayer;
    if (ninja instanceof fire_1.FirePlayer) {
        await msg.send(ninja.penguin, 'zm', 'tb');
        await handleClickBoardRandom({ ...ctx, penguin: ninja.penguin }, false);
    }
};
const getCardJitsuResults = (cardId1, cardId2) => {
    const card1 = cards_1.CARDS.getStrict(cardId1);
    const card2 = cards_1.CARDS.getStrict(cardId2);
    const winner = (0, card_1.getWinner)(card1.element, card2.element, card1.value, card2.value);
    const element = winner === 0 ? card1.element : card2.element;
    const results = winner === -1 ? [2, 2] :
        winner === 0 ? [4, 1] : [1, 4];
    return [results, element];
};
const getTrumpResults = (cardIds, element) => {
    const cardValues = cardIds.map(id => {
        const card = cards_1.CARDS.getStrict(id);
        return card.element === element ? card.value : null;
    });
    const validValues = cardValues.filter((value) => value !== null);
    const highest = validValues.length === 0 ? null : Math.max(...validValues);
    const isTie = validValues.filter(v => v === highest).length > 1;
    return [cardValues.map(value => {
            const winner = value !== null && value === highest;
            return winner ? (isTie ? 2 : 3) : 1;
        }), element];
};
const handleFireNinjaRankup = async ({ msg, penguin, prst, data }, expUpdater) => {
    const oldRank = penguin.ninja.fireProgress.getRank();
    expUpdater();
    const newRank = penguin.ninja.fireProgress.getRank();
    // from start to account for old penguins
    for (let i = 0; i <= newRank; i++) {
        const stamp = (0, ninja_progress_1.getFireStampReward)(i);
        if (stamp !== undefined) {
            (0, puffle_1.getStamp)(data, msg, penguin, stamp);
        }
    }
    if (newRank > oldRank) {
        const reward = (0, ninja_progress_1.getFireReward)(newRank);
        if (reward !== undefined) {
            penguin.inventory.add(reward);
        }
        await msg.send(penguin, 'zm', 'nr', 0, newRank);
    }
    prst(penguin);
};
const getSenseiMatchCards = (playerCard, beatable, type) => {
    if (beatable) {
        const pool = cards_1.CARDS.rows.filter(c => type === 'b' ? true : c.element === type);
        return [playerCard, (0, utils_1.choose)(pool).id];
    }
    else {
        const cardInfo = cards_1.CARDS.getStrict(playerCard);
        const pool = cards_1.CARDS.rows.filter(c => type === 'b' ? (card_1.RULES[c.element] === cardInfo.element || (c.element === cardInfo.element && c.value > cardInfo.value))
            : (c.element === type && c.value >= cardInfo.value));
        return [playerCard, (0, utils_1.choose)(pool).id];
    }
};
const handleResolveBattle = async (ctx, cardIndexes) => {
    const { msg, fire, penguin, data } = ctx;
    const ninja = fire.fromPenguin(penguin);
    if (ninja === undefined) {
        return;
    }
    const cardIds = fire.sensei === null ? fire.round.players.map((b, i) => {
        return b.ninja.hand[cardIndexes[i]];
    }) : getSenseiMatchCards(ninja.hand[cardIndexes[0]], fire.sensei.beatable, fire.round.type);
    // results: 1 = losing, 2 = in a tie, 3 = winning, 4 = winning in card jitsu
    const [results, element] = fire.round.type === 'b'
        ? getCardJitsuResults(cardIds[0], cardIds[1])
        : getTrumpResults(cardIds, fire.round.type);
    results.forEach((result, i) => {
        const ninja = fire.round.ninjas[i];
        if (result === 4) {
            ninja.addEnergy();
            if (ninja instanceof fire_1.FirePlayer) {
                if (ninja.energyGains >= 1) {
                    (0, puffle_1.getStamp)(data, msg, ninja.penguin, stamps_1.Stamp.ScoreFire);
                    if (ninja.energyGains >= 3) {
                        (0, puffle_1.getStamp)(data, msg, ninja.penguin, stamps_1.Stamp.MaxEnergy);
                    }
                }
            }
        }
        else if (result === 1) {
            ninja.removeEnergy();
            if (ninja.energy <= 0) {
                fire.playerEntersPodium(ninja);
            }
        }
    });
    cardIndexes.forEach((cardIndex, i) => {
        fire.round.players[i].ninja.drawCard(cardIndex);
    });
    const energies = fire.round.ninjas.map(n => n.energy);
    const [battleType] = getBattleInfo(fire.round.type);
    const battleIds = fire.round.ninjas.map(n => n.seat);
    await Promise.all(fire.players.map(p => {
        const ninja = fire.fromPenguin(p);
        if (ninja === undefined) {
            return;
        }
        return msg.send(p, 'zm', 'rb', battleIds.join(','), cardIds.join(','), energies.join(','), results.join(','), [battleType, element].join(','), ninja.hand.join(','), fire.standings.join(','));
    }));
    const finished = fire.energies.filter(energy => energy > 0).length <= 1;
    await Promise.all(fire.round.players.map(b => {
        const penguin = b.ninja.penguin;
        const noEnergy = b.ninja.energy <= 0;
        if (noEnergy) {
            fire.removePlayer(penguin);
        }
        if (noEnergy || finished) {
            if (!noEnergy) {
                fire.playerEntersPodium(b.ninja);
                if (fireStamps(data)) {
                    penguin.ninja.addFireWin();
                    if (penguin.ninja.fireWins >= 10) {
                        (0, puffle_1.getStamp)(data, msg, penguin, stamps_1.Stamp.WarmUp);
                        if (penguin.ninja.fireWins >= 50) {
                            (0, puffle_1.getStamp)(data, msg, penguin, stamps_1.Stamp.FireExpert);
                        }
                    }
                    if (!b.ninja.lostEnergy) {
                        (0, puffle_1.getStamp)(data, msg, penguin, stamps_1.Stamp.StrongDefence);
                    }
                }
            }
            handleFireNinjaRankup({ ...ctx, penguin }, () => {
                if (fire.sensei !== null && !noEnergy) {
                    penguin.ninja.fireProgress.setNinja();
                }
                else {
                    penguin.ninja.fireProgress.advanceFromPodium(fire.getPosition(b.ninja), fire.matchPlayerCount);
                }
            });
            return msg.send(penguin, 'zm', 'zo', fire.standings.join(','));
        }
    }));
};
const handleClickCardRandom = async (ctx) => {
    await handleClickCard(ctx, (0, utils_1.randomInt)(0, 4));
};
const handleClickCard = async (ctx, cardIndex) => {
    const { msg, fire, penguin } = ctx;
    const battleNinja = fire.round.fromPenguin(penguin);
    if (battleNinja === undefined) {
        return;
    }
    battleNinja.clearTimeout();
    battleNinja.setCard(cardIndex);
    await msg.send(fire.players.filter(p => p !== penguin), 'zm', 'ic', battleNinja.ninja.seat);
    const [pendingPeople, nonPendingPeople] = (0, utils_1.doubleFilter)((n => n.isPending()), fire.round.players);
    if (nonPendingPeople.filter(b => b.chosen === null).length === 0) {
        await Promise.all(pendingPeople.map(pending => {
            return (async () => {
                if (pending.chosen === null) {
                    await handleClickCardRandom({ ...ctx, penguin: pending.ninja.penguin });
                }
                await pending.callPending();
            })();
        }));
    }
    const cards = fire.round.cards;
    if (cards.every((card) => card !== null)) {
        await handleResolveBattle(ctx, cards);
    }
};
const handleReady = async (ctx) => {
    const { msg, penguin, fire } = ctx;
    const ninja = fire.fromPenguin(penguin);
    if (ninja === undefined || !fire.isPlaying(ninja)) {
        // 'ir' is still sent even after the end of the game
        return;
    }
    ninja.setReady();
    if (fire.everyoneReady()) {
        fire.nextPlayer();
        fire.newSpin();
        await Promise.all(fire.players.map(p => {
            const ninja = fire.fromPenguin(p);
            if (ninja === undefined) {
                return;
            }
            return msg.send(p, 'zm', 'nt', fire.activePlayer.seat, fire.spin.join(','), ninja.hand.join(','));
        }));
        if (fire.activePlayer instanceof fire_1.FireSensei) {
            await handleClickBoardRandom(ctx, true);
        }
        else {
            fire.setBoardTimeout(() => handleBoardTimeout(ctx));
        }
    }
};
const handleChooseTrump = (ctx, trump) => {
    const { fire } = ctx;
    handleStartBattle(ctx, trump, fire.activePlayers);
};
const handleLeaveFire = async (ctx) => {
    const { msg, fire, penguin, prst } = ctx;
    const ninja = fire.fromPenguin(penguin);
    if (ninja === undefined) {
        return;
    }
    if (fire.isPlaying(ninja)) {
        if (fire.activePlayers.length === 2) {
            const lastNinja = fire.activePlayers.filter(n => n !== ninja)[0];
            if (lastNinja instanceof fire_1.FirePlayer) {
                const lastPlayer = lastNinja.penguin;
                await handleFireNinjaRankup({ ...ctx, penguin: lastPlayer }, () => {
                    lastPlayer.ninja.fireProgress.advanceFromOthersQuit();
                });
                await msg.send(lastPlayer, 'cz');
                prst(lastPlayer);
            }
            fire.clearBoardTimeout();
        }
        else {
            const leaveMatch = async () => {
                await msg.send(fire.players, 'zm', 'cz', ninja.seat);
                fire.playerEntersPodium(ninja);
            };
            await (0, card_2.handleSendCardJitsuStampInfo)(ctx);
            fire.removePlayer(penguin);
            if (fire.activePlayer === ninja && fire.isChoosing()) {
                await handleClickBoardRandom(ctx, false);
                const battleNinja = fire.round.fromPenguin(penguin);
                if (battleNinja !== undefined) {
                    battleNinja.setPending(leaveMatch);
                }
            }
            else if (fire.activePlayer !== ninja) {
                leaveMatch();
            }
        }
    }
    await (0, card_2.handleSendCardJitsuStampInfo)(ctx);
};
exports.handleLeaveFire = handleLeaveFire;
const handleFireMove = (ctx, action, ...rest) => {
    switch (action) {
        case 'is':
            handleClickSpinner(ctx, Number(rest[1]));
            break;
        case 'cb':
            handleClickBoardPlayer(ctx, Number(rest[0]));
            break;
        case 'cc':
            handleClickCard(ctx, Number(rest[0]));
            break;
        case 'co':
            handleChooseOpponent(ctx, Number(rest[0]));
            break;
        case 'ir':
            handleReady(ctx);
            break;
        case 'ct':
            handleChooseTrump(ctx, rest[0]);
            break;
        default:
            (0, logger_1.logdebugerr)('unknown cjfire action: ' + action);
    }
};
exports.handleFireMove = handleFireMove;
