"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardJitsu = exports.SELF_EFFECT_POWER_CARDS = exports.ELEMENT_BLOCK_POWER_CARDS = exports.ELEMENT_DISCARD_POWER_CARDS = exports.ON_PLAYED_POWER_CARDS = exports.COLOR_DISCARD_POWER_CARDS = exports.RULES = exports.Sensei = exports.NinjaPlayer = exports.Hand = void 0;
exports.getWinner = getWinner;
const utils_1 = require("../../../common/utils.js");
const cards_1 = require("../../game-logic/cards.js");
const rooms_1 = require("../../game-logic/rooms.js");
const waddle_game_1 = require("./waddle-game");
class Hand {
    _canDrawCards;
    _cantDrawCards;
    constructor(cards) {
        this._canDrawCards = [...cards];
        this._cantDrawCards = [];
    }
    draw() {
        if (this._canDrawCards.length === 0) {
            this._canDrawCards = this._cantDrawCards;
            this._cantDrawCards = [];
        }
        if (this._canDrawCards.length === 0) {
            throw new Error('Cannot draw a card while every card is held');
        }
        const index = (0, utils_1.randomInt)(0, this._canDrawCards.length - 1);
        return this._canDrawCards.splice(index, 1)[0];
    }
    discard(card) {
        this._cantDrawCards.push(card);
    }
}
exports.Hand = Hand;
class Ninja {
    /** Card currently chosen, using session ID */
    _chosen;
    /** For all elements, map all the card's session IDs */
    _scores;
    _seat;
    _cardsOnHand;
    _flawless;
    _blockedElement;
    constructor(seat) {
        this._seat = seat;
        this._scores = {
            'f': [],
            'w': [],
            's': []
        };
        this._cardsOnHand = [];
        this._flawless = true;
    }
    draw(id) {
        this._cardsOnHand.push(id);
        return this.onDraw(id);
    }
    choose(id) {
        this._chosen = id;
        this._cardsOnHand = this._cardsOnHand.filter(i => i !== id);
    }
    unchoose() {
        this._chosen = undefined;
    }
    hasChosen() {
        return this._chosen !== undefined;
    }
    get chosen() {
        if (this._chosen === undefined) {
            throw new Error('Accessing chosen card but none are chosen!');
        }
        return this._chosen;
    }
    get scores() {
        return this._scores;
    }
    get seat() {
        return this._seat;
    }
    // set opponent(ninja: Ninja) {
    //   this._opponent = ninja;
    // }
    // get opponent(): Ninja {
    //   if (this._opponent === undefined) {
    //     throw new Error('Accessing opponent before it is initialized');
    //   }
    //   return this._opponent;
    // }
    // get otherSeat(): number {
    //   return this.opponent.seat;
    // }
    score(element, id) {
        this._scores[element].push(id);
    }
    removeCards(cards) {
        const toDiscard = new Set(cards);
        (0, utils_1.iterateEntries)(this._scores, (element, cards) => {
            this._scores[element] = cards.filter((id) => !toDiscard.has(id));
        });
    }
    get cards() {
        return this._cardsOnHand;
    }
    get blockedElement() {
        return this._blockedElement;
    }
    removeFlawless() {
        this._flawless = false;
    }
    get isFlawless() {
        return this._flawless;
    }
    blockElement(element) {
        this._blockedElement = element;
    }
    unblockElement() {
        this._blockedElement = undefined;
    }
}
class NinjaPlayer extends Ninja {
    _player;
    _hand;
    _sessionToCard = new Map();
    constructor(player, seat) {
        super(seat);
        this._hand = new Hand(player.ninja.getDeck());
        this._player = player;
    }
    get player() {
        return this._player;
    }
    onDraw(id) {
        const cardId = this._hand.draw();
        this._sessionToCard.set(id, cardId);
        return cardId;
    }
    choose(id) {
        const cardId = this._sessionToCard.get(id);
        if (cardId === undefined) {
            throw new Error('Couldn\'t find card');
        }
        this._sessionToCard.delete(id);
        this._hand.discard(cardId);
        super.choose(id);
    }
    getCardInfo(sessionId) {
        const cardId = this._sessionToCard.get(sessionId);
        if (cardId === undefined) {
            throw new Error('Couldn\'t find card');
        }
        return cards_1.CARDS.getStrict(cardId);
    }
}
exports.NinjaPlayer = NinjaPlayer;
class Sensei extends Ninja {
    _unbeatable;
    /**
     * A map that takes session ID of cards from the opponent and session ID of cards Sensei has
     * indicating that when the opponent plays that card, Sensei must use this card to beat it
     * (only used in unbeatable mode)
     * */
    _cardsToUse = new Map();
    _pupil;
    constructor(unbeatable, opponent) {
        super(0);
        this._unbeatable = unbeatable;
        this._pupil = opponent;
    }
    _sessionToElement = new Map();
    pickCard() {
        if (this._unbeatable) {
            // it's cheating time
            // NOTE: this is an unbeatable algorithm. But the original sensei seems to lose sometimes
            // even if he is unbeatable
            const cardToTuse = this._cardsToUse.get(this._pupil.chosen);
            if (cardToTuse === undefined) {
                throw new Error('Logic error: Sensei hasn\'t registered what card to use');
            }
            this.choose(cardToTuse);
        }
        else {
            // choosing a card at random
            // this would raise an error if all cards on hand are of a blocked element
            const canPlayCards = this._cardsOnHand.filter(id => {
                if (this._blockedElement === undefined) {
                    return true;
                }
                return this._sessionToElement.get(id) !== this._blockedElement;
            });
            this.choose((0, utils_1.choose)(canPlayCards));
        }
    }
    onDraw(id) {
        let cardId;
        if (this._unbeatable) {
            let unbeatableCard;
            const cardsWithoutCounter = this._pupil.cards.filter(id => {
                return !this._cardsToUse.has(id);
            });
            if (cardsWithoutCounter.length === 0) {
                // sensei must always draw after the opponent
                throw new Error('Logic error: Sensei is drawing a new card, but the opponent has no new card');
            }
            const cardToCounterId = cardsWithoutCounter[0];
            const cardToCounter = this._pupil.getCardInfo(cardToCounterId);
            // this._game.getCard(cardToCounterId);
            // finding a card that can beat this card.
            // if a cheater card, for now we will use the same card to make tie
            // otherwise, pick any card of opposite element
            if (cardToCounter.powerId in REPLACEMENT_POWER_CARDS) {
                unbeatableCard = cardToCounter.id;
            }
            else {
                const winningElement = exports.RULES[exports.RULES[cardToCounter.element]];
                const card = (0, utils_1.choose)(cards_1.CARDS.rows.filter(card => card.element === winningElement));
                unbeatableCard = card.id;
            }
            this._cardsToUse.set(cardToCounterId, id);
            cardId = unbeatableCard;
        }
        else {
            const elements = this._cardsOnHand.map(id => this._sessionToElement.get(id)).filter(e => e !== undefined);
            // must have at least two different elements
            // to prevent death by block element
            // (unknown if this mechanism existed in the original, but this will greatly simplify this)
            if (elements.length === 1) {
                const elementComplement = cards_1.CARDS.rows.filter(c => c.element !== elements[0]);
                cardId = (0, utils_1.choose)(elementComplement).id;
            }
            else {
                cardId = (0, utils_1.choose)(cards_1.CARDS.rows).id;
            }
        }
        this._sessionToElement.set(id, cards_1.CARDS.getStrict(cardId).element);
        return cardId;
    }
}
exports.Sensei = Sensei;
const REPLACEMENT_POWER_CARDS = {
    16: ['w', 'f'],
    17: ['s', 'w'],
    18: ['f', 's']
};
exports.RULES = {
    'f': 's',
    'w': 'f',
    's': 'w'
};
exports.COLOR_DISCARD_POWER_CARDS = {
    7: 'r',
    8: 'b',
    9: 'g',
    10: 'y',
    11: 'o',
    12: 'p'
};
exports.ON_PLAYED_POWER_CARDS = new Set([1, 16, 17, 18]);
exports.ELEMENT_DISCARD_POWER_CARDS = {
    4: 's',
    5: 'w',
    6: 'f'
};
exports.ELEMENT_BLOCK_POWER_CARDS = {
    13: 's',
    14: 'f',
    15: 'w'
};
exports.SELF_EFFECT_POWER_CARDS = new Set([2]);
function getWinner(firstElement, secondElement, firstValue, secondValue) {
    if (firstElement === secondElement) {
        if (firstValue === secondValue) {
            return -1;
        }
        else {
            if (firstValue > secondValue) {
                return 0;
            }
            else {
                return 1;
            }
        }
    }
    else if (exports.RULES[firstElement] === secondElement) {
        return 0;
    }
    else {
        return 1;
    }
}
class CardJitsu extends waddle_game_1.WaddleGame {
    roomId = rooms_1.Room.CardJitsu;
    // public name: WaddleName = 'card';
    _cardId = 0;
    _ninjaSeats;
    _ninjas = new Map();
    _cards = new Map();
    /** If in Sensei fight */
    _sensei;
    /** Whether or not lowest value wins this round */
    _swapValue = false;
    /** Number modifiers to apply in next score */
    _valueModifier = [0, 0];
    _opponents = new Map();
    constructor(players) {
        super(players);
        this._sensei = players.length === 1;
        let ninjas;
        if (this._sensei) {
            const player = players[0];
            const ninja = new NinjaPlayer(player, 1);
            const sensei = new Sensei(player.ninja.senseiAttempts < 5, ninja);
            ninjas = [sensei, ninja];
            this._ninjas.set(player, ninja);
        }
        else {
            ninjas = [new NinjaPlayer(players[0], 0), new NinjaPlayer(players[1], 1)];
            players.forEach((p, i) => this._ninjas.set(p, ninjas[i]));
        }
        this._opponents.set(ninjas[0], ninjas[1]);
        this._opponents.set(ninjas[1], ninjas[0]);
        this._ninjaSeats = ninjas;
    }
    get sensei() {
        return this._sensei;
    }
    getOpponent(ninja) {
        const op = this._opponents.get(ninja);
        if (op === undefined) {
            throw new Error('No opponent found');
        }
        return op;
    }
    // /** Starts a match that is being started from matchmaking */
    // startMatch() {
    //   const waddleRoom = new WaddleRoom(1000 + this.players[0].id, this.players.length, 'card');
    //   // const gameRoom = this.server.getRoom(this.roomId);
    //   const playerInfo = this.players.map(p => `${p.info.name}|${p.info.color}`);
    //   // gameRoom.waddles.set(waddleRoom.id, waddleRoom);
    //   this.players.forEach((p) => {
    //     // don't know what the 0 : 10 thing is for, and what the difference is
    //     p.sendXt('scard', this.roomId, waddleRoom.getId(), this._sensei ? 1 : this.players.length, this._sensei ? 0 : 10, ...playerInfo);
    //   });
    // }
    draw(ninja) {
        this._cardId++;
        const card = ninja.draw(this._cardId) ?? -1;
        const cardInfo = cards_1.CARDS.getStrict(card);
        this._cards.set(this._cardId, cardInfo);
        return `${this._cardId}|${[
            cardInfo.id,
            cardInfo.element,
            cardInfo.value,
            cardInfo.color,
            cardInfo.powerId
        ].join('|')}`;
    }
    deal(ninja, amount) {
        return new Array(amount).fill(null).map(() => this.draw(ninja));
    }
    // chooseCard(ninja: NinjaPlayer, id: number): void {
    //   ninja.choose(id);
    // }
    getNinja(player) {
        const ninja = this._ninjas.get(player);
        if (ninja === undefined) {
            throw new Error('Penguin doesn\'t have a ninja');
        }
        return ninja;
    }
    // get swapEffect() {
    //   return this._swapValue;
    // }
    /** Get card using session ID */
    getCard(id) {
        const card = this._cards.get(id);
        if (card === undefined) {
            throw new Error('Invalid card id');
        }
        return card;
    }
    removeColorDuplicates(cards) {
        const colors = new Set();
        const noDuplicates = [];
        cards.forEach(card => {
            const color = this.getCard(card).color;
            if (!colors.has(color)) {
                noDuplicates.push(card);
                colors.add(color);
            }
        });
        return noDuplicates;
    }
    getWinningHand() {
        let i = 0;
        for (const ninja of this._ninjaSeats) {
            // check for elemental win
            for (const [_, cards] of Object.entries(ninja.scores)) {
                const noDupe = this.removeColorDuplicates(cards);
                if (noDupe.length >= 3) {
                    return {
                        seat: i,
                        cards: noDupe.slice(0, 3),
                        oneElement: true
                    };
                }
            }
            // check for all elements win
            const combos = Array.from(Object.values(ninja.scores).map(set => [...set])).reduce((acc, current) => {
                return acc.flatMap(a => current.map(b => [...a, b]));
            }, [[]]);
            for (const combo of combos) {
                const noDupes = this.removeColorDuplicates(combo);
                if (noDupes.length >= 3) {
                    return {
                        seat: i,
                        cards: noDupes.slice(0, 3),
                        oneElement: false
                    };
                }
            }
            i++;
        }
        return undefined;
    }
    judgeWinner() {
        const cards = this._ninjaSeats.map((n) => n.chosen);
        const cardInfo = cards.map(id => this.getCard(id));
        const elements = cardInfo.map((c) => c.element);
        // applying element replacement from powercards
        cardInfo.forEach((card, i) => {
            const replacement = REPLACEMENT_POWER_CARDS[card.powerId];
            if (replacement !== undefined) {
                const [original, target] = replacement;
                const other = (i + 1) % 2;
                if (elements[other] === original) {
                    elements[other] = target;
                }
            }
        });
        const [firstElement, secondElement] = elements;
        // adding modifier from power cards
        let [firstValue, secondValue] = cardInfo.map((card, i) => card.value + this._valueModifier[i]);
        this._valueModifier = [0, 0];
        if (this._swapValue) {
            [firstValue, secondValue] = [secondValue, firstValue];
        }
        const winIndex = getWinner(firstElement, secondElement, firstValue, secondValue);
        if (winIndex !== -1) {
            this._ninjaSeats[winIndex].score(cardInfo[winIndex].element, cards[winIndex]);
        }
        // resetting effects
        if (this._swapValue) {
            this._swapValue = false;
        }
        this._ninjaSeats.forEach(n => n.unblockElement());
        return winIndex;
    }
    setValueSwap() {
        this._swapValue = true;
    }
    alterModifier(seat, delta) {
        this._valueModifier[seat] += delta;
    }
    getNinjaBySeatIndex(index) {
        return this._ninjaSeats[index];
    }
    playerCanPlay(ninja) {
        // the only condition for not being able to play is an element being blocked
        const blockedElement = ninja.blockedElement;
        if (blockedElement === undefined) {
            return true;
        }
        const cards = ninja.cards;
        return cards.some(c => this.getCard(c)?.element !== blockedElement);
    }
}
exports.CardJitsu = CardJitsu;
