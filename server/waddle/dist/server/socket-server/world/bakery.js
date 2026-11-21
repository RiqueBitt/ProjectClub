"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bakery = void 0;
const utils_1 = require("../../../common/utils.js");
class Bakery {
    _state = 'IngredientsStation';
    static MAGIC_INGREDIENTS = ['Hay', 'Tire', 'Candy'];
    _ingredients = [];
    _currentIngredient = 0;
    _currentEmote = 1;
    static CHEER_CAPACITY = 7;
    _cheerCount = 0;
    _multiplierPenguins = new Set();
    _multiplierCount = 0;
    _updateListener = null;
    _countInterval = null;
    _room;
    constructor(room) {
        this._room = room;
        this.startIngredients();
    }
    //   get room() {
    //     return this._room;
    //   }
    get emote() {
        return this._currentEmote;
    }
    get cheerCount() {
        return this._cheerCount;
    }
    incrementCheer() {
        this._cheerCount++;
        this.fire();
        // only if exact, in order to only start the timeout once
        if (this._cheerCount === Bakery.CHEER_CAPACITY) {
            // takes about 3 seconds to proceed
            setTimeout(() => {
                this.startMultiplier();
            }, 3000);
        }
    }
    updateMultiplierPenguins() {
        for (const [p, state] of this.room.getPlayerStates()) {
            if (state.x >= 610) {
                this._multiplierPenguins.add(p.id);
            }
            else {
                this._multiplierPenguins.delete(p.id);
            }
        }
    }
    startIngredients() {
        this._state = 'IngredientsStation';
        this._currentIngredient = 0;
        const magicIngredient = (0, utils_1.choose)(Bakery.MAGIC_INGREDIENTS);
        const ingredients = [];
        const possibleIngredients = [magicIngredient, 'Milk', 'Eggs', 'Flour'];
        while (possibleIngredients.length > 0) {
            const i = (0, utils_1.randomInt)(0, possibleIngredients.length - 1);
            ingredients.push(...possibleIngredients.splice(i, 1));
        }
        this._ingredients = ingredients;
        this.fire();
    }
    startCheer() {
        this._state = 'CheerStation';
        this._cheerCount = 0;
        this._currentEmote = (0, utils_1.choose)([1, 2, 7]);
        this.fire();
    }
    startMultiplier() {
        this._state = 'MultiplierStation';
        this._multiplierCount = 9;
        this.updateMultiplierPenguins();
        this.fire();
        this._countInterval = setInterval(() => {
            this._multiplierCount--;
            // use < 0 to give a full second before switching to next station
            if (this._multiplierCount < 0 && this._countInterval !== null) {
                clearInterval(this._countInterval);
                this.startReset();
            }
            else {
                this.updateMultiplierPenguins();
                this.fire();
            }
        }, 1000);
    }
    startReset() {
        this._state = 'ResetStation';
        this.fire();
        // estimate based on videos
        setTimeout(() => {
            this.startIngredients();
        }, 6000);
    }
    get currentIngredient() {
        return this._ingredients[this._currentIngredient];
    }
    nextIngredient() {
        this._currentIngredient++;
        this.fire();
        if (this._currentIngredient >= this._ingredients.length) {
            this.startCheer();
        }
    }
    getMultiplier() {
        // none of these are confirmed values
        if (this._multiplierPenguins.size >= 10) {
            return 'Large';
        }
        if (this._multiplierPenguins.size >= 5) {
            return 'Medium';
        }
        return 'Small';
    }
    get bakeryState() {
        return JSON.stringify({
            CurrentStation: this._state,
            IngredientsStation: this._ingredients.map((ingredient, i) => {
                return {
                    IngredientType: ingredient,
                    // unknown if this total ever changed
                    TotalRequired: 1,
                    CurrentCount: this._currentIngredient > i ? 1 : 0
                };
            }),
            CheerStation: {
                CheerCapacity: Bakery.CHEER_CAPACITY,
                CurrentCheerCount: this.cheerCount,
                Emote: this.emote
            },
            MultiplierStation: {
                Counter: this._multiplierCount,
                Multiplier: this.getMultiplier()
            }
        });
    }
    fire() {
        if (this._updateListener !== null) {
            this._updateListener();
        }
    }
    addListener(callback) {
        this._updateListener = callback;
    }
    get players() {
        return this._room.players;
    }
    get room() {
        return this._room;
    }
}
exports.Bakery = Bakery;
