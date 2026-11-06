"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CardJitsuFireProgress = exports.MIN_SENSEI_RANK = exports.getFireStampReward = exports.getFireReward = exports.CardJitsuProgress = void 0;
const stamps_1 = require("./stamps");
/** Manages EXP for Card-Jitsu */
class CardJitsuProgress {
    _xp;
    _rank;
    _ninja;
    /** Number of times that faced Sensei as a black belt without being a ninja */
    _senseiAttempts;
    /**
     * Index is the item you gain from reaching rank - 1
     * Eg index 0 means you are becoming rank 1
     */
    static ITEM_AWARDS = [4025, 4026, 4027, 4028, 4029, 4030, 4031, 4032, 4033, 104];
    /** Map a rank to the postcard you gain from reaching the rank */
    static POSTCARD_AWARDS = { 1: 177, 5: 178, 9: 179 };
    /** Map a rank to the stamp you earn frmo reaching the rank */
    static STAMP_AWARDS = {
        1: stamps_1.Stamp.Grasshopper,
        5: stamps_1.Stamp.FineStudent,
        9: stamps_1.Stamp.TrueNinja,
        10: stamps_1.Stamp.NinjaMaster
    };
    /** Max rank XP-wise, ie ninja is a rank above this */
    static MAX_RANK = 9;
    constructor(xp, attempts, ninja) {
        this._xp = xp;
        this._ninja = ninja;
        this._senseiAttempts = attempts;
        this._rank = this.calculateRank();
    }
    calculateRank() {
        if (this._ninja) {
            return CardJitsuProgress.MAX_RANK + 1;
        }
        // can be optimized, but unecessary
        let rank = 0;
        while (CardJitsuProgress.getThresholdForRank(rank + 1) <= this._xp) {
            rank++;
        }
        return rank;
    }
    get xp() {
        return this._xp;
    }
    earnXP(amount) {
        this._xp += amount;
        this._rank = this.calculateRank();
    }
    /** Gets how much XP is needed to be at this level */
    static getThresholdForRank(rank) {
        return Math.floor(((rank + 1) * rank) / 2) * 5;
    }
    get rank() {
        return this._rank;
    }
    get percentage() {
        if (this._rank >= CardJitsuProgress.MAX_RANK) {
            return 0;
        }
        const curRankThreshold = CardJitsuProgress.getThresholdForRank(this._rank);
        const delta = CardJitsuProgress.getThresholdForRank(this._rank + 1) - curRankThreshold;
        return Math.floor((this._xp - curRankThreshold) / delta * 100);
    }
    becomeNinja() {
        this._ninja = true;
        this._rank = this.calculateRank();
    }
    addAttempt() {
        this._senseiAttempts++;
    }
    get senseiAttempts() {
        return this._senseiAttempts;
    }
    get isNinja() {
        return this._ninja;
    }
}
exports.CardJitsuProgress = CardJitsuProgress;
// threshold for rank of index + 1
const FIRE_RANK_THRESHOLD = [
    25,
    50,
    100,
    150
];
const getFireReward = (rank) => {
    return [6025, 4120, 2013, 1086, 3032][rank - 1];
};
exports.getFireReward = getFireReward;
const getFireStampReward = (rank) => {
    return {
        2: stamps_1.Stamp.FireMidWay,
        4: stamps_1.Stamp.FireSuit,
        5: stamps_1.Stamp.FireNinja
    }[rank];
};
exports.getFireStampReward = getFireStampReward;
exports.MIN_SENSEI_RANK = FIRE_RANK_THRESHOLD.length;
// EXP manager using the modern system
class CardJitsuFireProgress {
    _xp;
    _ninja;
    constructor(xp, ninja) {
        this._xp = xp;
        this._ninja = ninja;
    }
    advanceFromPodium(position, playerCount) {
        if (position < 1 || position > playerCount || playerCount < 2 || playerCount > 4) {
            return;
        }
        this._xp += [
            [9, 3],
            [12, 6, 3],
            [15, 9, 6, 3]
        ][playerCount - 2][position - 1];
    }
    advanceFromOthersQuit() {
        this._xp += 2;
    }
    setNinja() {
        this._ninja = true;
    }
    getPercentage() {
        const rank = this.getRank();
        if (rank >= FIRE_RANK_THRESHOLD.length) {
            return 0;
        }
        else {
            const prevRankThreshold = FIRE_RANK_THRESHOLD[rank - 1] ?? 0;
            const nextTrankThreshold = FIRE_RANK_THRESHOLD[rank];
            return Math.floor((this._xp - prevRankThreshold) / (nextTrankThreshold - prevRankThreshold) * 100);
        }
    }
    getRank() {
        const unbeatenThreshold = FIRE_RANK_THRESHOLD.map((t, i) => [t, i]).find(([t]) => this._xp < t);
        return unbeatenThreshold === undefined
            ? FIRE_RANK_THRESHOLD.length + (this._ninja ? 1 : 0)
            : unbeatenThreshold[1];
    }
    get xp() {
        return this._xp;
    }
    get isFireNinja() {
        return this._ninja;
    }
}
exports.CardJitsuFireProgress = CardJitsuFireProgress;
