"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommandsHandler = exports.CommandsHandler = void 0;
exports.getCommandsList = getCommandsList;
const arg_parser_1 = require("../socket-server/arg-parser.js");
const items_1 = require("../game-logic/items.js");
const join_1 = require("../socket-server/handlers/join.js");
const rooms_1 = require("../game-data/rooms.js");
const pufflelaunch_1 = __importDefault(require("../game-logic/pufflelaunch.js"));
const cards_1 = require("../game-logic/cards.js");
const getCommands = (generators) => {
    return generators.map(([name, responses]) => {
        const responder = (ctx, commandArgs) => {
            for (const [types, callback] of responses) {
                const parse = (0, arg_parser_1.parseArgs)(commandArgs, types);
                if (parse !== null) {
                    callback(ctx, ...parse);
                    break;
                }
            }
        };
        return [
            name,
            responder
        ];
    });
};
const handleAddItem = ({ msg, penguin, prst }, itemId) => {
    penguin.inventory.add(itemId);
    msg.send(penguin, 'ai', itemId, penguin.currency.coins);
    prst(penguin);
};
const handleAddAllItems = ({ msg, penguin, prst, data }, action) => {
    if (action === 'all') {
        const allItems = items_1.ITEMS.rows;
        allItems.forEach(item => penguin.inventory.add(item.id));
        msg.send(penguin, 'gi', ...(0, join_1.filterItems)(data, penguin.inventory.items));
        prst(penguin);
    }
};
const handleJoinRoomId = (ctx, id) => {
    (0, join_1.joinRoom)(ctx, id, 0, 0);
};
const handleJoinRoomName = (ctx, name) => {
    if (name in rooms_1.ROOMS) {
        const info = rooms_1.ROOMS[name];
        (0, join_1.joinRoom)(ctx, info.id, 0, 0);
    }
};
const handleAddCoins = ({ msg, penguin, prst, data }, coins) => {
    console.log(typeof coins, 'eis os coins');
    const total = penguin.currency.add(coins);
    if (data.isPreCpip()) {
        msg.send(penguin, 'ac', total);
    }
    else {
        (0, join_1.sendLPMessage)(penguin, data, msg);
    }
    prst(penguin);
};
const handleRename = ({ penguin, msg, data, prst }, ...names) => {
    const name = names.join(' ');
    penguin.changeName(name);
    // TODO what about pre-cpip?
    (0, join_1.sendLPMessage)(penguin, data, msg);
    prst(penguin);
};
const handleAwards = ({ msg, penguin, prst }) => {
    // grant m7-m11 awards for speedrunning
    const awards = [815, 817, 819, 822, 8007];
    awards.forEach((award) => {
        penguin.inventory.add(award);
        msg.send(penguin, 'ai', award, penguin.currency.coins);
    });
    prst(penguin);
};
const handleAge = ({ msg, prst, penguin, data }) => {
    penguin.time.setVirtualRegistrationToNow();
    (0, join_1.sendLPMessage)(penguin, data, msg);
    prst(penguin);
};
const handleMember = ({ penguin, prst, msg, data }) => {
    penguin.membership.swap();
    (0, join_1.sendLPMessage)(penguin, data, msg);
    prst(penguin);
};
const handleAddFurniture = ({ penguin, prst, msg }, id, amount) => {
    const ownedAmount = penguin.igloo.getFurnitureAmount(id);
    const addAmount = Math.max(Math.min(amount, 99 - ownedAmount), 0);
    penguin.igloo.addFurniture(id, addAmount);
    for (let i = 0; i < addAmount; i++) {
        msg.send(penguin, 'af', id, penguin.currency.coins);
    }
    prst(penguin);
};
const handleAddOneFurniture = (ctx, id) => handleAddFurniture(ctx, id, 1);
function getPuffleLaunchDataWithAlLBerries(times, turboStatuses) {
    return new pufflelaunch_1.default([
        34, 46, 99, 90, 115, 39,
        84, 42, 120, 123, 183, 54,
        59, 75, 243, 88, 203, 135,
        113, 284, 122, 153, 172, 69,
        44, 48, 103, 97, 86, 144,
        318, 165, 219, 87, 277, 33
    ], times, turboStatuses);
}
const handleUnlockPlLevels = ({ penguin, prst }) => {
    penguin.puffleLaunch.set(new pufflelaunch_1.default((new Array(36)).fill(0x1), [], []).get());
    prst(penguin);
};
const handleUnlockTimeAttack = ({ penguin, prst }) => {
    penguin.puffleLaunch.set(getPuffleLaunchDataWithAlLBerries([], []).get());
    prst(penguin);
};
const handleUnlockTurbo = ({ penguin, prst }) => {
    penguin.puffleLaunch.set(getPuffleLaunchDataWithAlLBerries((new Array(36)).fill(1), []).get());
    prst(penguin);
};
const handleUnlockSlowMove = ({ penguin, prst }) => {
    penguin.puffleLaunch.set(getPuffleLaunchDataWithAlLBerries((new Array(36)).fill(1), (new Array(36)).fill(true)).get());
    prst(penguin);
};
const handleNoSave = ({ penguin, prst }) => {
    penguin.preference.disableSave();
    prst(penguin, true);
};
const handleEnableSave = ({ penguin, prst }) => {
    penguin.preference.enableSave();
    prst(penguin);
};
const handleAmulet = ({ penguin, prst }, element) => {
    switch (element) {
        case 'water':
            penguin.ninja.setWaterNinja(!penguin.ninja.isWaterNinja);
            break;
        case 'snow':
            penguin.ninja.setSnowNinja(!penguin.ninja.isSnowNinja);
            break;
    }
    prst(penguin);
};
const handleCjOneWin = ({ penguin, prst }) => {
    penguin.ninja.addMatchProgress(true);
    prst(penguin);
};
const handleCjWins = ({ penguin, prst }, amount) => {
    for (let i = 0; i < amount; i++) {
        penguin.ninja.addMatchProgress(true);
    }
    prst(penguin);
};
const handlePowercards = ({ penguin, prst }) => {
    cards_1.CARDS.rows.forEach(row => {
        if (row.powerId > 0) {
            penguin.ninja.addCard(row.id, 1);
        }
    });
    prst(penguin);
};
const handleAddCard = ({ penguin, prst }, card, amount) => {
    penguin.ninja.addCard(card, amount);
    prst(penguin);
};
const handleSafechat = ({ penguin, prst }) => {
    penguin.preference.setSafeChat(!penguin.preference.isSafeChat);
    prst(penguin);
};
class CommandsHandler {
    _listeners;
    constructor(listeners) {
        this._listeners = new Map(listeners);
    }
    run(ctx, name, args) {
        const callback = this._listeners.get(name);
        if (callback !== undefined) {
            callback(ctx, args);
        }
    }
}
exports.CommandsHandler = CommandsHandler;
const c = (args, callback) => {
    return [args, callback];
};
const generators = [
    [
        'ai',
        [c(['number'], handleAddItem), c(['string'], handleAddAllItems)],
        {
            argNames: ['id'],
            description: "Add a clothing item to your penguin. You can also do 'ai all' to add all clothing items in the game.",
            examples: ['ai 102', 'ai all']
        }
    ],
    [
        'jr',
        [c(['number'], handleJoinRoomId), c(['string'], handleJoinRoomName)],
        {
            argNames: ['id/name'],
            description: "Join a room by its ID or name.",
            examples: ['jr 400', 'jr plaza']
        }
    ],
    [
        'ac',
        [c(['number'], handleAddCoins)],
        {
            argNames: ['amount'],
            description: "Add a given amount of coins to your penguin. You can also give a negative number to subtract coins.",
            examples: ['ac 1024', 'ac -329']
        }
    ],
    [
        'rename',
        [c('string', handleRename)],
        {
            argNames: ['name'],
            description: "Rename your penguin to something else.",
            examples: ['rename UnfunnyPenguin67']
        }
    ],
    [
        'awards',
        [c([], handleAwards)],
        {
            argNames: [],
            description: "For speedrunning purposes, adds the medals from PSA missions 7 through 11 to your penguin.",
            examples: []
        }
    ],
    [
        'age',
        [c([], handleAge)],
        {
            argNames: [],
            description: `Make your penguin's \"birthday\" be on the day you are currently in on the timeline.

      For example, if you run this command on January 15, 2009, and then jump to February 20, 2009, then your penguin will be 36 days old.
      `,
            examples: []
        }
    ],
    [
        'member',
        [c([], handleMember)],
        {
            argNames: [],
            description: "Swap the membership status of your penguin. If your penguin is currently a member, then it will turn into a non-member, and vice-versa.",
            examples: []
        }
    ],
    [
        'af',
        [c(['number', 'number'], handleAddFurniture), c(['number'], handleAddOneFurniture)],
        {
            argNames: ['id', 'quantity'],
            description: "Adds the given quantity (or just 1 if not provided) of the furniture item with the given ID to your penguin.",
            examples: ['af 33', 'af 2320 50']
        }
    ],
    [
        'plunlocklevels',
        [c([], handleUnlockPlLevels)],
        {
            argNames: [],
            description: "Unlocks all levels in Puffle Launch.",
            examples: []
        }
    ],
    [
        'plunlocktimeattack',
        [c([], handleUnlockTimeAttack)],
        {
            argNames: [],
            description: "Unlocks time attack mode in Puffle Launch.",
            examples: []
        }
    ],
    [
        'plunlockturbo',
        [c([], handleUnlockTurbo)],
        {
            argNames: [],
            description: "Unlocks turbo mode in Puffle Launch.",
            examples: []
        }
    ],
    [
        'plunlockslowmode',
        [c([], handleUnlockSlowMove)],
        {
            argNames: [],
            description: "Unlocks slow mode in Puffle Launch.",
            examples: []
        }
    ],
    [
        'nosave',
        [c([], handleNoSave)],
        {
            argNames: [],
            description: "When used, the penguin's current state will be saved, and any changes made to the penguin afterward will not be saved, meaning relogging will go back to the initial state.",
            examples: []
        }
    ],
    [
        'enablesave',
        [c([], handleEnableSave)],
        {
            argNames: [],
            description: "Undoes the effect of the nosave command.",
            examples: []
        }
    ],
    [
        'amulet',
        [c(['string'], handleAmulet)],
        {
            argNames: ['element'],
            description: "Add the gem of the given element to your Card-Jitsu amulet, which can be fire, water, or snow.",
            examples: ['element fire', 'element water', 'element snow']
        }
    ],
    [
        'cjwin',
        [c([], handleCjOneWin), c(['number'], handleCjWins)],
        {
            argNames: ['wins'],
            description: "Adds a given number of wins (or just 1 if not provided) to your Card-Jitsu progress.",
            examples: ['cjwin', 'cjwin 20']
        }
    ],
    [
        'powercards',
        [c([], handlePowercards)],
        {
            argNames: [],
            description: "Adds 1 of each of all the Card-Jitsu powercards to your penguin.",
            examples: []
        }
    ],
    [
        'addcard',
        [c(['number', 'number'], handleAddCard)],
        {
            argNames: ['id', 'amount'],
            description: "Adds the given amount (or just 1 if not provided) of Card-Jitsu cards with the given card ID.",
            examples: ['addcard 76', 'addcard 345 10']
        }
    ],
    [
        'safechat',
        [c([], handleSafechat)],
        {
            argNames: [],
            description: "Toggles safe-chat mode for your penguin.",
            examples: []
        }
    ]
];
function getCommandsList() {
    return generators.map(([name, _, displayInfo]) => {
        return { name, ...displayInfo };
    });
}
const getCommandsHandler = () => {
    return new CommandsHandler(getCommands(generators));
};
exports.getCommandsHandler = getCommandsHandler;
