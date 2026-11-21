"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGetCookieInventory = exports.handleSendEnterHopper = exports.handleGetBakeryState = exports.addBakeryListener = exports.handleViewedMedieval2012 = exports.handleRetrieveMedieval2012 = exports.handleDonateCoins = void 0;
const login_1 = require("./login");
const handleDonateCoins = ({ prst, penguin, msg }, _, donation) => {
    // choice is useless, since we are not trying to rewrite history unfortunately
    // client doesn't check if can donate
    if (penguin.currency.coins >= donation) {
        penguin.currency.discount(donation);
    }
    else {
        (0, login_1.sendError)(msg, penguin, 401);
    }
    msg.send(penguin, 'dc', penguin.currency.coins);
    prst(penguin);
};
exports.handleDonateCoins = handleDonateCoins;
const handleRetrieveMedieval2012 = ({ penguin, msg }) => {
    const medievalMessage = penguin.medieval2012.message;
    msg.send(penguin, 'sent', JSON.stringify({
        'msgViewedArray': [medievalMessage >= 1 ? 1 : 0, medievalMessage >= 2 ? 1 : 0]
    }));
};
exports.handleRetrieveMedieval2012 = handleRetrieveMedieval2012;
const handleViewedMedieval2012 = ({ penguin, prst }, message) => {
    penguin.medieval2012.setViewed(message);
    prst(penguin);
};
exports.handleViewedMedieval2012 = handleViewedMedieval2012;
const addBakeryListener = (world, msg) => {
    world.addBakeryListener(() => {
        msg.send(world.bakery.players, 'barsu', world.bakery.bakeryState);
    });
};
exports.addBakeryListener = addBakeryListener;
const handleGetBakeryState = ({ msg, penguin, world }) => {
    msg.send(penguin, 'barsu', world.bakery.bakeryState);
};
exports.handleGetBakeryState = handleGetBakeryState;
const handleSendEnterHopper = ({ world }, type) => {
    // this is a recreation of this handler, it is unknown if the original handler sent the snowball type or not
    // the type was added to prevent bugs with people spamming snowballs
    // however, the way this was added isn't perfect and it's likely it didn't really check the types, as the shell function
    // never receives the snowball thrown event information, and instead I had to fetch it directly from the transformation
    // which introduces the bug of the player walking mid snowball throw
    const enumType = type.match(/\[ball(\w+)\|\d+\]/);
    if (enumType !== null) {
        const ingredient = {
            'Candy': 'Candy',
            'Egg': 'Eggs',
            'Tire': 'Tire',
            'Hay': 'Hay',
            'Flour': 'Flour',
            'Milk': 'Milk'
        }[enumType[1]];
        console.log(ingredient, world.bakery.currentIngredient, 'KKKK');
        if (world.bakery.currentIngredient === ingredient) {
            world.bakery.nextIngredient();
        }
    }
};
exports.handleSendEnterHopper = handleSendEnterHopper;
const handleGetCookieInventory = ({ penguin, msg }) => {
    // placeholder just so that the animation works
    // cookie stock should theoreticailly increase when the bakery happens and decrease when a transformation happens
    // none of that is implemented however
    // and the max cookie variable is an unknown
    // current, max
    msg.send(penguin, 'ctc', 500, 1000);
};
exports.handleGetCookieInventory = handleGetCookieInventory;
