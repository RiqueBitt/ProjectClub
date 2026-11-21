"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCardJitsuGuard = exports.handleAbortCard = exports.handleQuitCard = exports.handleCardJitsuAction = exports.handleSendCardJitsuStampInfo = exports.handleUpdateCardSeats = exports.handleEnterCardGame = void 0;
const card_1 = require("../world/card.js");
const puffle_1 = require("./puffle");
const stamps_1 = require("../../game-logic/stamps.js");
const ninja_progress_1 = require("../../game-logic/ninja-progress.js");
const mail_1 = require("./mail");
const handleEnterCardGame = async ({ card, penguin, msg }) => {
    const seatNumber = card.sensei ? 1 : card.getSeatId(penguin);
    // TODO why is seats duplicated?
    await msg.send(penguin, 'gz', card.getPlayerCount(), card.getPlayerCount());
    await msg.send(penguin, 'jz', seatNumber, penguin.name, penguin.inventory.color, penguin.ninja.cardRank);
};
exports.handleEnterCardGame = handleEnterCardGame;
const handleUpdateCardSeats = ({ msg, penguin, card }) => {
    const playersInfo = [
        ...(card.sensei ? [[0, 'Sensei', 14, 10]] : []),
        ...card.players.map((p, i) => [i + (card.sensei ? 1 : 0), p.name, p.inventory.color, p.ninja.cardRank])
    ];
    msg.send(penguin, 'uz', ...playersInfo.map(info => info.join('|')));
    msg.send(penguin, 'sz');
};
exports.handleUpdateCardSeats = handleUpdateCardSeats;
const handleCardJitsuDeal = ({ penguin, card, msg }, amount) => {
    const ninja = card.getNinja(penguin);
    const cards = card.deal(ninja, amount);
    msg.send(card.players, 'zm', 'deal', ninja.seat, ...cards);
    if (card.sensei) {
        const sensei = card.getOpponent(ninja);
        const cards = card.deal(sensei, amount);
        msg.send(card.players, 'zm', 'deal', sensei.seat, ...cards);
    }
};
const ninjaRankUp = (ctx, previous) => {
    const { prst, msg, penguin, data } = ctx;
    for (let i = previous + 1; i <= penguin.ninja.cardRank; i++) {
        penguin.inventory.add(ninja_progress_1.CardJitsuProgress.ITEM_AWARDS[i - 1]);
        const postcard = ninja_progress_1.CardJitsuProgress.POSTCARD_AWARDS[i];
        if (postcard !== undefined) {
            (0, mail_1.handleReceiveMail)(ctx, penguin.mail.receivePostcard(postcard, {}));
        }
        const stamp = ninja_progress_1.CardJitsuProgress.STAMP_AWARDS[i];
        if (stamp !== undefined) {
            (0, puffle_1.getStamp)(data, msg, penguin, stamp);
        }
    }
    msg.send(penguin, 'cza', penguin.ninja.cardRank);
    prst(penguin);
};
const gainProgress = (ctx, won) => {
    const { penguin, prst } = ctx;
    penguin.ninja.addWin();
    if (penguin.ninja.cardRank < ninja_progress_1.CardJitsuProgress.MAX_RANK) {
        const exp = won ? 5 : 1;
        const previousRank = penguin.ninja.cardRank;
        penguin.ninja.earnXP(exp);
        if (penguin.ninja.cardRank > previousRank) {
            ninjaRankUp(ctx, previousRank);
        }
    }
    prst(penguin);
};
const handleSendCardJitsuStampInfo = async (ctx) => {
    const { data, penguin, msg, prst } = ctx;
    const game = 'card' in ctx ? ctx.card :
        'fire' in ctx ? ctx.fire : undefined;
    const roomId = game?.roomId;
    if (roomId === undefined) {
        return;
    }
    const gameStamps = data.getGameStamps(roomId);
    const sessionStamps = penguin.stampbook.sessionStamps.filter(stamp => gameStamps.has(stamp));
    const collectedCount = [...gameStamps.values()].filter(stamp => penguin.stampbook.has(stamp)).length;
    const totalCount = gameStamps.size;
    penguin.stampbook.resetSessionStamps();
    await msg.send(penguin, 'cjsi', sessionStamps.join('|'), collectedCount, totalCount, 0);
    prst(penguin);
};
exports.handleSendCardJitsuStampInfo = handleSendCardJitsuStampInfo;
const exitGame = async (ctx) => {
    const { penguin, data, msg } = ctx;
    // for when the player got stamps in older versions
    for (let i = 0; i <= penguin.ninja.cardRank; i++) {
        const stamp = ninja_progress_1.CardJitsuProgress.STAMP_AWARDS[i];
        if (stamp !== undefined) {
            (0, puffle_1.getStamp)(data, msg, penguin, stamp);
        }
    }
    (0, exports.handleSendCardJitsuStampInfo)(ctx);
};
const setWinner = async (ctx, winner, ...cards) => {
    const { card, msg } = ctx;
    // players are removed so that they don't get the "player quit" popup even though the game ended normally
    await Promise.all(card.players.map(p => exitGame({ ...ctx, penguin: p })));
    msg.send(card.players, 'czo', 0, winner, ...cards);
};
const handleCardJitsuPick = (ctx, sessionId) => {
    const { penguin, card, msg, data, prst } = ctx;
    const ninja = card.getNinja(penguin);
    const otherNinja = card.getOpponent(ninja);
    ninja.choose(sessionId);
    msg.send(card.players, 'zm', 'pick', ninja.seat, sessionId);
    if (otherNinja instanceof card_1.Sensei) {
        otherNinja.pickCard();
        msg.send(card.players, 'zm', 'pick', otherNinja.seat, otherNinja.chosen);
    }
    if (otherNinja.hasChosen()) {
        const winner = card.judgeWinner();
        const winningHand = card.getWinningHand();
        const ninjas = [ninja, otherNinja];
        ninjas.forEach((n) => {
            const otherN = card.getOpponent(n);
            const chosenCard = card.getCard(n.chosen);
            if (chosenCard.id === 256) {
                card.players.forEach(p => (0, puffle_1.getStamp)(data, msg, p, stamps_1.Stamp.SenseiCard));
            }
            if (n.seat !== winner) {
                n.removeFlawless();
            }
            if (card_1.ON_PLAYED_POWER_CARDS.has(chosenCard.powerId) || (chosenCard.powerId > 0 && n.seat === winner)) {
                const cardsToDiscard = [];
                if (chosenCard.powerId === 1) {
                    card.setValueSwap();
                }
                else if (chosenCard.powerId === 2) {
                    card.alterModifier(n.seat, 2);
                }
                else if (chosenCard.powerId === 3) {
                    card.alterModifier(otherN.seat, -2);
                }
                const colorToDiscard = card_1.COLOR_DISCARD_POWER_CARDS[chosenCard.powerId];
                if (colorToDiscard !== undefined) {
                    Object.values(otherN.scores).forEach((cards) => {
                        cards.forEach((sessionId) => {
                            if (card.getCard(sessionId).color === colorToDiscard) {
                                cardsToDiscard.push(sessionId);
                            }
                        });
                    });
                    otherN.removeCards(cardsToDiscard);
                }
                const elementToDiscard = card_1.ELEMENT_DISCARD_POWER_CARDS[chosenCard.powerId];
                if (elementToDiscard !== undefined) {
                    const cards = otherN.scores[elementToDiscard];
                    const last = cards[cards.length - 1];
                    cardsToDiscard.push(last);
                    otherN.removeCards(cardsToDiscard);
                }
                // element blocking
                const elementToBlock = card_1.ELEMENT_BLOCK_POWER_CARDS[chosenCard.powerId];
                if (elementToBlock !== undefined) {
                    otherN.blockElement(elementToBlock);
                }
                const [sender, recipient] = card_1.SELF_EFFECT_POWER_CARDS.has(chosenCard.powerId) ? [n.seat, n.seat] : [n.seat, otherN.seat];
                msg.send(card.players, 'zm', 'power', sender, recipient, chosenCard.powerId, ...cardsToDiscard);
            }
            n.unchoose();
        });
        otherNinja.unchoose();
        ninja.unchoose();
        msg.send(card.players, 'zm', 'judge', winner);
        if (winningHand !== undefined) {
            const winnerNinja = card.getNinjaBySeatIndex(winner);
            const loserNinja = card.getOpponent(winnerNinja);
            if (winnerNinja instanceof card_1.NinjaPlayer) {
                // TODO research order stamps are given?
                if (winningHand.oneElement) {
                    (0, puffle_1.getStamp)(data, msg, winnerNinja.player, stamps_1.Stamp.OneElement);
                }
                else {
                    (0, puffle_1.getStamp)(data, msg, winnerNinja.player, stamps_1.Stamp.ElementalWin);
                }
                if (winnerNinja.isFlawless) {
                    (0, puffle_1.getStamp)(data, msg, winnerNinja.player, stamps_1.Stamp.FlawlessVictory);
                }
                const scoredCards = Object.values(winnerNinja.scores).flat().length;
                if (scoredCards >= 9) {
                    (0, puffle_1.getStamp)(data, msg, winnerNinja.player, stamps_1.Stamp.FullDojo);
                }
                gainProgress({ ...ctx, penguin: winnerNinja.player }, true);
                if (winnerNinja.player.ninja.cardWins >= 25) {
                    (0, puffle_1.getStamp)(data, msg, winnerNinja.player, stamps_1.Stamp.MatchMaster);
                }
                // beating Sensei without Ninja Mask
                if (card.sensei && !penguin.ninja.isNinja) {
                    penguin.ninja.becomeNinja();
                }
            }
            if (loserNinja instanceof card_1.NinjaPlayer) {
                gainProgress({ ...ctx, penguin: loserNinja.player }, false);
                // losing to Sensei as a black belt
                if (winnerNinja instanceof card_1.Sensei) {
                    if (loserNinja.player.ninja.cardRank >= ninja_progress_1.CardJitsuProgress.MAX_RANK) {
                        loserNinja.player.ninja.addAttempt();
                        prst(loserNinja.player);
                    }
                }
            }
            setWinner(ctx, winningHand.seat, ...winningHand.cards);
        }
    }
};
const handleCardJitsuDeath = (ctx) => {
    const { card, penguin } = ctx;
    const ninja = card.getNinja(penguin);
    const opponent = card.getOpponent(ninja);
    if (opponent instanceof card_1.NinjaPlayer) {
        gainProgress({ ...ctx, penguin: opponent.player }, true);
    }
    if (ninja instanceof card_1.NinjaPlayer) {
        gainProgress({ ...ctx, penguin: ninja.player }, false);
    }
    setWinner(ctx, opponent.seat);
};
const handleCardJitsuAction = (ctx, action, arg) => {
    if (action === 'deal') {
        handleCardJitsuDeal(ctx, arg);
    }
    else if (action === 'pick') {
        handleCardJitsuPick(ctx, arg);
    }
    else if (action === 'death') {
        handleCardJitsuDeath(ctx);
    }
};
exports.handleCardJitsuAction = handleCardJitsuAction;
const handleQuitCard = (ctx) => {
    const { card, msg, penguin } = ctx;
    exitGame(ctx);
    const seat = card.getSeatId(penguin);
    msg.send(card.players, 'cz', penguin.name);
    msg.send(card.players, 'lz', seat);
};
exports.handleQuitCard = handleQuitCard;
const handleAbortCard = ({ msg, penguin }) => {
    msg.send(penguin, 'zo', penguin.currency.coins, '', 0, 0, 0);
};
exports.handleAbortCard = handleAbortCard;
const isCardJitsuGuard = ({ card }) => card !== undefined;
exports.isCardJitsuGuard = isCardJitsuGuard;
