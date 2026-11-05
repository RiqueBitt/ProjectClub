"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCheckInventory = exports.handleEPFStamp = exports.handleSetPartyOp = exports.handleGetPartyOp = exports.handleGrantAwards = exports.handleBecomeAgent = exports.handleAddEpfItem = exports.handleGetEpfMedals = exports.handleGetFieldOps = exports.handleGetEpfStatus = exports.handleSetStampEarned = exports.handleSetStampbookCoverData = exports.handleGetRecentStamps = exports.handleGetStampbookCoverData = exports.handleGetMissionStamps = exports.handleGetPinInfo = exports.handleHeartbeat = exports.handleGetSpyDrillsReward = exports.handleGetSpyDrillsChallenge = exports.handleSetPuffleLaunchData = exports.handleGetPuffleLaunchData = exports.handleDisconnect = exports.handleFindPlayer = exports.handleFindBuddy = exports.handleGetPlayer = exports.handleBuddyMessage = exports.handleBuddyRemove = exports.handleBuddyDecline = exports.handleBuddyAccept = exports.handleBuddyRequest = exports.sendBuddyOnlineList = exports.sendGetBuddies = exports.handleReceiveInventory = exports.handleSpyRequest = exports.handleGetCoins = exports.handleSendCoins = exports.handleGetTotalCoins = exports.handlePBI = exports.handleGLR = exports.isBackyardGuard = exports.isPreBackyardGuard = exports.handleJoinPlayerModern = exports.handleJoinPlayerCpip = exports.handleJoinPlayerOld = exports.handleAddItem = exports.handleGetItems = exports.joinRoom = exports.leaveRoom = exports.handleJoinServer = exports.sendStamps = void 0;
exports.formatBuddyEntry = formatBuddyEntry;
exports.getPenguinString = getPenguinString;
exports.filterItems = filterItems;
exports.sendLPMessage = sendLPMessage;
const rooms_1 = require("../../game-logic/rooms.js");
const world_penguin_1 = require("../world/world-penguin.js");
const puffle_1 = require("./puffle");
const igloo_1 = require("./igloo");
const world_table_1 = require("../world/world-table.js");
const php_server_1 = require("../../http/php-server/index.js");
const items_1 = require("../../game-logic/items.js");
const flags_1 = require("../../game-logic/flags.js");
const starter_deck_1 = require("../../game-logic/starter-deck.js");
const cards_1 = require("../../game-logic/cards.js");
const utils_1 = require("../../../common/utils.js");
const spy_drills_1 = require("../../game-logic/spy-drills.js");
const fire_1 = require("./fire");
function unequipPuffle(p) {
    const hand = p.inventory.hand;
    if (hand >= 750 && hand <= 759) {
        p.inventory.updateWear({ hand: 0 });
    }
}
const STARTER_DECK_ID = 821;
function isEPFAgent(p) {
    return p.inventory.has(8009);
}
function isPSAAgent(p) {
    return p.inventory.has(800);
}
const isNewBuddyProtocol = (data) => {
    return !data.isPreCpip() || data.getChatVersion() >= 506;
};
async function formatBuddyEntry(id, world, db, includeOnlineFlag) {
    const name = world.getById(id)?.name ?? (await db.get(id))?.name ?? 'Unknown';
    if (!includeOnlineFlag) {
        return `${id}|${name}`;
    }
    const online = world.getById(id) !== undefined;
    return online ? `${id}|${name}|1` : `${id}|${name}`;
}
function sendGetOnlineBuddies(msg, p, world) {
    const onlineIds = p.buddy.buddies.filter(id => world.getById(id) !== undefined).map(i => String(i));
    msg.send(p, 'go', ...onlineIds);
}
const getOnlineBuddies = (world, penguin) => {
    return penguin.buddy.buddies.map(i => world.getById(i)).filter((i) => i !== undefined);
};
const handleSendBuddyOnline = ({ world, msg, penguin }) => {
    msg.send(getOnlineBuddies(world, penguin), 'bon', penguin.id);
};
function getPenguinString(data, p, state) {
    const approvedFlag = data.isNewShell2009() ? [1] : [];
    return [
        p.id,
        p.name,
        ...approvedFlag,
        p.inventory.color,
        p.inventory.head,
        p.inventory.face,
        p.inventory.neck,
        p.inventory.body,
        p.inventory.hand,
        p.inventory.feet,
        p.inventory.pin,
        p.inventory.background,
        state.x,
        state.y,
        state.frame,
        p.membership.isMember ? 1 : 0,
        ...(data.isPreCpip() ? [] : [p.time.age, // todo member age
            p.avatar.id,
            0, // TODO document these 0s and empty strings
            0,
            0,
            '',
            '',
            '',
            ''])
    ].join('|');
}
const enterRoom = (ctx, r, x, y) => {
    const { penguin, msg, data, world } = ctx;
    const previousPlayers = r.players;
    r.addPenguin(penguin, x, y);
    world.enterState(penguin, { room: r });
    msg.send(penguin, 'jr', r.id, ...r.playerStates.map(([p, s]) => getPenguinString(data, p, s)));
    if (!data.isSpOnJr() || x !== 0 || y !== 0) {
        msg.send(r.players, 'ap', getPenguinString(data, penguin, { x, y, frame: 1 }));
    }
    // modern versions don't have the puffle information on penguin so the packet is resent
    if (!data.puffleHandItems()) {
        const replayWalkingPuffle = (player, recipients) => {
            const walkingPuffleId = player.puffle.walking;
            if (walkingPuffleId === null) {
                return;
            }
            const args = (0, puffle_1.getPuffleWalkArguments)(data, player, walkingPuffleId, 1);
            if (args !== undefined) {
                msg.send(recipients, 'pw', ...args);
            }
        };
        previousPlayers.forEach((player) => replayWalkingPuffle(player, penguin));
        replayWalkingPuffle(penguin, previousPlayers);
    }
};
function filterItems(data, items) {
    if (data.isPreCpip()) {
        const clientItems = data.getClientItems();
        return items.filter(i => clientItems.has(i));
    }
    return items;
}
function sendCoinsForChange(data, msg, penguin) {
    const donations = data.getCoinsForChangeDonations();
    if (donations !== null) {
        // placeholder donation values
        msg.send(penguin, 'gcfct', donations.map((amount, i) => `${i}|${amount}`).join(','));
    }
}
function sendLPMessage(penguin, data, msg) {
    msg.send(penguin, 'lp', getPenguinString(data, penguin, { x: 0, y: 0, frame: 1 }), penguin.currency.coins, penguin.preference.isSafeChat ? 1 : 0, 1440, penguin.time.getDate(), penguin.time.age, 0, penguin.time.minutesPlayed, -1, 7, 1, 4, 3);
}
const sendStamps = async ({ msg, penguin }) => {
    await msg.send(penguin, 'gps', penguin.id, penguin.stampbook.stamps.join('|'));
};
exports.sendStamps = sendStamps;
const handleJoinServer = async (ctx) => {
    const { world, penguin, data, msg } = ctx;
    // penguins don't keep the puffle from previous session
    unequipPuffle(penguin);
    // Project Club: todo mundo tem o Baralho Inicial do Card-Jitsu. Sem ele, o
    // Pátio do Dojo (dojoext.swf, 2008+) desliga a interface do jogo e não
    // liga mais — o pinguim fica travado (não anda, não abre o mapa, não entra
    // no Dojo).
    if (!data.isPreCpip() && !penguin.inventory.has(STARTER_DECK_ID)) {
        penguin.inventory.add(STARTER_DECK_ID);
        const deck = starter_deck_1.STARTER_DECKS[STARTER_DECK_ID];
        if (deck !== undefined)
            addStarterDeck(ctx, deck);
        ctx.prst(penguin);
    }
    /*
    TODO: find what second number is
    Figure out how moderators will be handled
    Figure out what moderator_status is used for
    Add last number (something to do with stamp book)
    */
    // initializing penguin data
    msg.send(penguin, 'js', 
    // TODO date reference for EPF
    (data.isPreCpip() ? isPSAAgent(penguin) : isEPFAgent(penguin)) ? 1 : 0, 
    // moderator status
    ...(data.isPreCpip() ? [] : [penguin.mascot > 0 ? 3 : 0]));
    if (isNewBuddyProtocol(data)) {
        (0, exports.sendGetBuddies)(ctx);
        (0, exports.sendBuddyOnlineList)(ctx);
    }
    sendGetOnlineBuddies(msg, penguin, world);
    if (data.isPreCpip()) {
        getOnlineBuddies(world, penguin).forEach(buddy => sendGetOnlineBuddies(msg, buddy, world));
    }
    else {
        handleSendBuddyOnline(ctx);
    }
    if (data.isVanillaEngine()) {
        msg.send(penguin, 'activefeatures', data.getActiveFeatures() ?? '');
    }
    if (!data.isPreCpip()) {
        sendLPMessage(penguin, data, msg);
        // receiving inventory
        // TODO proper inventory
        // send stamps must be before join room
        // for the 365 days stamp to work
        await (0, exports.sendStamps)(ctx);
        const puffles = data.isVanillaEngine() ? penguin.puffle.puffles.map((puffle) => [
            puffle.id,
            ...(0, puffle_1.getClientPuffleIds)(puffle.type),
            puffle.name,
            10, // TODO, adoption date
            puffle.food,
            100, // TODO puffle play stat
            puffle.rest,
            puffle.clean,
            0, // TODO puffle hat
            0 // TODO unknown what this last one is
        ].join('|')) : penguin.puffle.puffles.map((puffle) => {
            return [puffle.id, puffle.name, puffle.type, puffle.clean, puffle.food, puffle.rest, 100, 100, 100].join('|');
        });
        msg.send(penguin, 'pgu', ...puffles);
        if (data.isVanillaEngine()) {
            msg.send(penguin, 'nxquestsettings', '{"ver":1,"spawnRoomId":800,"quests":[{"id":1,"name":"shopping","awards":[{"id":24023,"type":"penguinItem","n":1}],"tasks":[{"type":"room","description":"Visit the Clothes Shop","data":130}]},{"id":3,"name":"igloo","awards":[{"id":2166,"type":"furnitureItem","n":1}],"tasks":[{"type":"","description":"Visit your Igloo","data":null}]},{"id":2,"name":"puffle","awards":[{"id":70,"type":"puffleItem","n":1}],"tasks":[{"type":"room","description":"Visit the Pet Shop","data":310}]}]}');
            msg.send(penguin, 'nxquestdata', '{"quests":[{"id":1,"status":"prize claimed","tasks":[true]},{"id":3,"status":"prize claimed","tasks":[true]},{"id":2,"status":"prize claimed","tasks":[true]}]}');
        }
        // TODO: this would periodically send to each player but right now this isn't fully implemented
        sendCoinsForChange(data, msg, penguin);
    }
    // joining spawn room // TODO more spawn rooms in the future?
    enterRoom(ctx, world.getRoom(rooms_1.Room.Town), 0, 0);
};
exports.handleJoinServer = handleJoinServer;
const leaveRoom = async (ctx) => {
    const { room, penguin, msg, data } = ctx;
    room.removePenguin(penguin);
    await msg.send(room.players, 'rp', penguin.id, ...room.playerStates.map(([p, s]) => getPenguinString(data, p, s)));
};
exports.leaveRoom = leaveRoom;
// Pátio do Dojo "solo" (dojoextsolo, 2013): o cliente manda pra lá quem sai do
// Dojo sem ter o amuleto + os 4 baralhos. Essa sala abre o módulo AS3 do
// Sensei (courtyard_sensei) que não existe nesta época e deixa a interface
// desligada — o pinguim travava. Vai pro Pátio normal.
const DOJO_EXT_SOLO = 324;
const DOJO_EXT = 321;
const joinRoom = (ctx, id, x, y) => {
    const { world, penguin, msg, data } = ctx;
    if (id === DOJO_EXT_SOLO)
        id = DOJO_EXT;
    if ('room' in ctx) {
        (0, exports.leaveRoom)(ctx);
    }
    else if ('game' in ctx) {
        ctx.game.matchMaker?.removePlayer(penguin);
    }
    else if ('sled' in ctx) {
        ctx.sled.removePlayer(penguin);
    }
    if ((0, rooms_1.isGameRoom)(id)) {
        const game = world.getGame(id);
        world.enterState(penguin, { game });
        msg.send(penguin, 'jg', id);
    }
    else {
        const newRoom = world.getRoom(id);
        world.enterState(penguin, { room: newRoom });
        enterRoom(ctx, newRoom, x, y);
    }
};
exports.joinRoom = joinRoom;
const handleGetItems = ({ penguin, msg, data }) => {
    msg.send(penguin, 'gi', ...filterItems(data, penguin.inventory.items));
};
exports.handleGetItems = handleGetItems;
const addStarterDeck = ({ prst, penguin }, cards) => {
    const cardInfo = cards.map(id => cards_1.CARDS.getStrict(id));
    const powerCards = cardInfo.filter(c => c.powerId > 0);
    const normalCards = cardInfo.filter(c => c.powerId === 0);
    normalCards.forEach(card => penguin.ninja.addCard(card.id, 1));
    penguin.ninja.addCard((0, utils_1.choose)(powerCards).id, 1);
    prst(penguin);
};
const handleAddItem = (ctx, item) => {
    const { penguin, msg, data, prst } = ctx;
    const deck = starter_deck_1.STARTER_DECKS[item];
    if (deck !== undefined) {
        addStarterDeck(ctx, deck);
    }
    const info = data.getItem(item);
    // item que o jogo não conhece: getItem devolve undefined (antes passava e o
    // saldo virava NaN ao descontar um custo inexistente)
    if (info !== undefined && info !== null) {
        const cost = Number.isFinite(info.cost) ? info.cost : 0;
        if (penguin.currency.coins < cost) {
            msg.send(penguin, 'e', 401); // moedas insuficientes
            return;
        }
        penguin.inventory.add(item);
        msg.send(penguin, 'ai', item, penguin.currency.discount(cost));
    }
    prst(penguin);
};
exports.handleAddItem = handleAddItem;
const handleJoinPlayerOld = async (ctx, ownerId, isMember) => {
    const { world, db, data, msg, penguin } = ctx;
    const igloo = await (0, igloo_1.getIglooFromId)(world, db, ownerId);
    if (igloo === undefined) {
        return;
    }
    const args = [ownerId, igloo.type];
    // when igloo music was added, the music parameter is optional
    if (data.hasIglooMusicReleased()) {
        args.push(igloo.music);
    }
    // client misteriously removes the first element of the furniture
    msg.send(penguin, 'jp', ...args, ',' + (0, igloo_1.getFurnitureString)(igloo.furniture));
    const roomId = 2000 + ownerId;
    (0, exports.joinRoom)(ctx, roomId, 0, 0);
};
exports.handleJoinPlayerOld = handleJoinPlayerOld;
const handleJoinPlayerCpip = (ctx, fakeId) => {
    const { world } = ctx;
    // for some reason the ID given is the player + 1000
    // in WF igloo room IDs are playerID + 2000
    const iglooId = fakeId + 1000;
    const igloo = world.getRoom(iglooId);
    enterRoom(ctx, igloo, 0, 0);
};
exports.handleJoinPlayerCpip = handleJoinPlayerCpip;
const handleJoinPlayerModern = (ctx, playerId, roomType) => {
    const { msg, penguin, data, world } = ctx;
    // 1000 = backyard
    const roomId = roomType === 'igloo' ? playerId + 2000 : 1000;
    msg.send(penguin, 'jp', roomId, roomId, roomType);
    // TODO: backyard should only be player itself?
    enterRoom(ctx, world.getRoom(roomId), 0, 0);
};
exports.handleJoinPlayerModern = handleJoinPlayerModern;
const isPreBackyardGuard = (ctx) => !(0, exports.isBackyardGuard)(ctx);
exports.isPreBackyardGuard = isPreBackyardGuard;
const isBackyardGuard = ({ data }) => data.isVanillaEngine();
exports.isBackyardGuard = isBackyardGuard;
const handleGLR = ({ msg, penguin }) => {
    msg.send(penguin, 'glr', '');
};
exports.handleGLR = handleGLR;
const handlePBI = ({ msg, penguin }, id) => {
    msg.send(penguin, 'pbi', id);
};
exports.handlePBI = handlePBI;
const handleGetTotalCoins = ({ penguin, msg }) => {
    msg.send(penguin, 'gtc', penguin.currency.coins);
};
exports.handleGetTotalCoins = handleGetTotalCoins;
const handleSendCoins = (ctx) => {
    const { penguin, msg } = ctx;
    if ('room' in ctx) {
        if (ctx.room.getTables().some(t => t.unblockPayout(penguin))) {
            // don't send if payout is blocked from being a spectator
            return;
        }
    }
    msg.send(penguin, 'ac', penguin.currency.coins);
};
exports.handleSendCoins = handleSendCoins;
const handleGetCoins = ({ penguin, msg }) => {
    msg.send(penguin, 'gc', penguin.currency.coins);
};
exports.handleGetCoins = handleGetCoins;
const handleSpyRequest = ({ penguin }) => {
    penguin.psa.setAgentPending();
};
exports.handleSpyRequest = handleSpyRequest;
const handleReceiveInventory = () => {
    // seemingly useless handler, it just sends the client's inventory to the server
    return;
};
exports.handleReceiveInventory = handleReceiveInventory;
const sendGetBuddies = async ({ msg, penguin, world, db }) => {
    const buddies = await Promise.all(penguin.buddy.buddies.map(id => {
        return formatBuddyEntry(id, world, db, true);
    }));
    msg.send(penguin, 'gb', ...buddies);
};
exports.sendGetBuddies = sendGetBuddies;
const sendBuddyOnlineList = ({ msg, penguin, world }) => {
    const onlineIds = penguin.buddy.buddies.filter(id => world.getById(id) !== undefined);
    msg.send(penguin, 'go', ...onlineIds);
};
exports.sendBuddyOnlineList = sendBuddyOnlineList;
const handleBuddyRequest = (ctx, targetId) => {
    const { msg, penguin, world, data, prst } = ctx;
    const target = world.getById(targetId);
    if (target === undefined) {
        return;
    }
    if (penguin.buddy.isBuddy(targetId)) {
        return;
    }
    if (isNewBuddyProtocol(data)) {
        msg.send(target, 'br', penguin.id, penguin.name);
        // refresh sender list to avoid temporary placeholders client-side
        (0, exports.sendGetBuddies)(ctx);
    }
    else {
        msg.send(target, 'bq', penguin.id, penguin.name);
    }
    prst(target);
};
exports.handleBuddyRequest = handleBuddyRequest;
const handleBuddyAccept = async (ctx, requesterId) => {
    const { world, penguin, prst, msg, data, off } = ctx;
    const requester = world.getById(requesterId) ?? await off.getPenguin(requesterId);
    penguin.buddy.add(requesterId);
    if (requester === undefined) {
        return;
    }
    requester.buddy.add(penguin.id);
    if (requester instanceof world_penguin_1.WorldPenguin) {
        msg.send(requester, 'ba', penguin.id, penguin.name);
    }
    prst(requester);
    if (isNewBuddyProtocol(data)) {
        (0, exports.sendGetBuddies)(ctx);
        if (requester instanceof world_penguin_1.WorldPenguin) {
            (0, exports.sendGetBuddies)({ ...ctx, penguin: requester });
        }
    }
    prst(penguin);
};
exports.handleBuddyAccept = handleBuddyAccept;
const handleBuddyDecline = (ctx, requesterId) => {
    const { msg, world, penguin } = ctx;
    const requester = world.getById(requesterId);
    if (requester !== undefined) {
        msg.send(requester, 'bd', penguin.id, penguin.name);
    }
};
exports.handleBuddyDecline = handleBuddyDecline;
const handleBuddyRemove = async (ctx, removeId) => {
    const { penguin, prst, world, data, msg, off } = ctx;
    penguin.buddy.remove(removeId);
    const buddy = world.getById(removeId) ?? await off.getPenguin(removeId);
    if (buddy === undefined) {
        return;
    }
    buddy.buddy.remove(penguin.id);
    if (buddy instanceof world_penguin_1.WorldPenguin) {
        if (isNewBuddyProtocol(data)) {
            msg.send(buddy, 'rb', penguin.id, penguin.name);
        }
        else {
            msg.send(buddy, 'br', penguin.id, penguin.name);
        }
    }
    prst(penguin);
    prst(buddy);
};
exports.handleBuddyRemove = handleBuddyRemove;
const handleBuddyMessage = (ctx, targetId, messageId) => {
    const { msg, world, penguin } = ctx;
    const target = world.getById(targetId);
    if (target !== undefined) {
        msg.send(target, 'bm', penguin.id, penguin.name, messageId);
    }
};
exports.handleBuddyMessage = handleBuddyMessage;
const handleGetPlayer = async (ctx, playerId) => {
    const { world, msg, penguin, data, db } = ctx;
    const target = world.getById(playerId);
    if (target === undefined) {
        const data = await db.get(playerId);
        if (data !== null) {
            msg.send(penguin, 'gp', (0, php_server_1.getOfflinePenguinCrumb)(playerId, data), 0);
        }
    }
    else {
        const room = world.getPenguinRoom(target);
        if (room !== undefined) {
            msg.send(penguin, 'gp', getPenguinString(data, target, room.getState(target)), room.id);
        }
    }
};
exports.handleGetPlayer = handleGetPlayer;
const handleFindBuddy = ({ msg, penguin, world }, buddyId) => {
    const buddy = world.getById(buddyId);
    if (buddy !== undefined) {
        const room = world.getPenguinRoom(buddy);
        if (room !== undefined) {
            msg.send(penguin, 'bf', room.id);
        }
    }
};
exports.handleFindBuddy = handleFindBuddy;
/**
 * "Procurar" no cartão de um amigo (u#bf, cliente 2012): o jogo mostra
 * "aguarde" e espera sala + tipo + dono. Antes não havia resposta e o aviso
 * ficava na tela pra sempre. Offline (ou num minijogo) → -1.
 */
const handleFindPlayer = ({ msg, penguin, world }, playerId) => {
    const target = world.getById(playerId);
    const room = target === undefined ? undefined : world.getPenguinRoom(target);
    if (target === undefined || room === undefined) {
        msg.send(penguin, 'bf', -1, 'invalid', -1);
        return;
    }
    if (room.id >= 2000) {
        // iglu: no WF a sala do iglu é dono + 2000; o cliente usa dono + 1000
        msg.send(penguin, 'bf', room.id - 1000, 'igloo', room.id - 2000);
    }
    else if (room.id === 1000) {
        msg.send(penguin, 'bf', room.id, 'backyard', playerId);
    }
    else {
        msg.send(penguin, 'bf', room.id, 'invalid', -1);
    }
};
exports.handleFindPlayer = handleFindPlayer;
const handleDisconnect = async (ctx) => {
    if ('penguin' in ctx) {
        const { penguin, msg, prst, world } = ctx;
        if (penguin.psa.isPending) {
            penguin.inventory.add(800);
        }
        (await Promise.all(penguin.buddy.buddies.map(id => world.getById(id)))).filter((p) => p !== undefined)
            .forEach(p => {
            (0, exports.sendBuddyOnlineList)({ ...ctx, penguin: p });
        });
        if ('room' in ctx) {
            const table = ctx.room.getPenguinTable(penguin);
            await (0, exports.leaveRoom)(ctx);
            if (table !== null) {
                const index = table.getSeatIndex(penguin);
                if (index !== undefined && index !== world_table_1.WorldTable.TABLE_SPECTATOR_SEAT) {
                    table.removePlayer(penguin);
                    if (table.hasStarted()) {
                        await msg.send(table.penguins, 'cz', penguin.name);
                        table.resetRound();
                    }
                    else {
                        if (table.getCount() === 0) {
                            table.reset();
                        }
                    }
                    await msg.send(ctx.room.players, 'ut', table.getId(), table.getCount());
                }
            }
        }
        else if ('fire' in ctx) {
            await (0, fire_1.handleLeaveFire)(ctx);
        }
        world.disconnect(penguin);
        prst(penguin);
        msg.unlinkClient(penguin);
    }
};
exports.handleDisconnect = handleDisconnect;
const handleGetPuffleLaunchData = ({ msg, penguin }) => {
    msg.send(penguin, 'ggd', penguin.puffleLaunch.data === null ? '' : penguin.puffleLaunch.data.toString('utf-8'));
};
exports.handleGetPuffleLaunchData = handleGetPuffleLaunchData;
const handleSetPuffleLaunchData = ({ prst, penguin }, data) => {
    penguin.puffleLaunch.set(Buffer.from(data));
    prst(penguin);
};
exports.handleSetPuffleLaunchData = handleSetPuffleLaunchData;
const handleGetSpyDrillsChallenge = ({ msg, penguin }) => {
    // The original algorithm is unknown, so we are using experimental data to simulate it
    const randomOption = (0, utils_1.choose)(spy_drills_1.SPY_DRILLS_DATA);
    const [games, medalCount] = randomOption;
    /*
    Regarding the generation, it would pick 3 random spy drill games and then assign a medal count to them.
    We don't know how either of those processes worked exactly
  
    # Minigame picking
    At first you would think it is random, but there seems to be a clear relation with how the games are picked.
    The algorithm seems to have a difficulty preference and it tries to increase the difficulty each time.
    It is not exactly known what algorithm is used for this, however
  
    # Medals Calculation
    The medals number is deterministic, meaning the same minigames always give the same medals.
    It is likely that it just follows a simple point system, but the points are likely decimal, which make it
    hard to predict their values since they would get rounded into an integer, and we lose a lot
    of information because of that
    */
    msg.send(penguin, 'zr', games.join(','), medalCount);
};
exports.handleGetSpyDrillsChallenge = handleGetSpyDrillsChallenge;
const handleGetSpyDrillsReward = ({ penguin, prst }, medals) => {
    penguin.epf.addMedals(medals);
    prst(penguin);
};
exports.handleGetSpyDrillsReward = handleGetSpyDrillsReward;
const handleHeartbeat = ({ msg, penguin }) => {
    msg.send(penguin, 'h', '');
};
exports.handleHeartbeat = handleHeartbeat;
const handleGetPinInfo = (ctx) => {
    const { msg, penguin, data } = ctx;
    const pins = penguin.inventory.items.filter((item) => {
        const id = Number(item);
        return data.getItem(id)?.type === items_1.ItemType.Pin && !(0, flags_1.isFlag)(id);
    }).map((pin) => {
        const item = data.getItem(pin);
        return [item.id, (new Date(`${item.releaseDate}T12:00:00`)).getTime() / 1000, item.isMember ? 1 : 0].join('|');
    });
    msg.send(penguin, 'qpp', ...pins);
};
exports.handleGetPinInfo = handleGetPinInfo;
const handleGetMissionStamps = (ctx) => {
    const { msg, penguin, data } = ctx;
    const awards = penguin.inventory.items.filter(id => {
        const info = data.getItem(id);
        return info?.type === items_1.ItemType.Award;
    });
    msg.send(penguin, 'qpa', penguin.id, awards.join('|'));
};
exports.handleGetMissionStamps = handleGetMissionStamps;
const handleGetStampbookCoverData = (ctx) => {
    const { msg, penguin } = ctx;
    const stamps = penguin.stampbook.cover.stamps.map(stamp => [
        0, stamp.stamp, stamp.x, stamp.y, stamp.rotation, stamp.depth
    ].join('|'));
    msg.send(penguin, 'gsbcd', penguin.stampbook.cover.color, penguin.stampbook.cover.highlight, penguin.stampbook.cover.pattern, penguin.stampbook.cover.icon, ...stamps);
};
exports.handleGetStampbookCoverData = handleGetStampbookCoverData;
const handleGetRecentStamps = ({ msg, penguin, prst }) => {
    msg.send(penguin, 'gmres', penguin.stampbook.recentStamps.join('|'));
    penguin.stampbook.clearRecentStamps();
    prst(penguin);
};
exports.handleGetRecentStamps = handleGetRecentStamps;
const handleSetStampbookCoverData = ({ penguin, prst }, color, highlight, pattern, icon, ...stamps) => {
    penguin.stampbook.setCover(Number(color), Number(highlight), Number(pattern), Number(icon), stamps.map(str => {
        const [_, id, x, y, rotation, depth] = str.split('|').map(n => Number(n));
        return {
            stamp: id,
            x,
            y,
            rotation,
            depth
        };
    }));
    prst(penguin);
};
exports.handleSetStampbookCoverData = handleSetStampbookCoverData;
const handleSetStampEarned = ({ penguin, prst }, stampId) => {
    penguin.stampbook.add(stampId);
    prst(penguin);
};
exports.handleSetStampEarned = handleSetStampEarned;
const handleGetEpfStatus = ({ penguin, msg }) => {
    msg.send(penguin, 'epfga', penguin.psa.isAgent ? 1 : 0);
};
exports.handleGetEpfStatus = handleGetEpfStatus;
const handleGetFieldOps = ({ penguin, msg }) => {
    // sends an integer boolean, FALSE if there is an active field ops
    // that wasn't done
    msg.send(penguin, 'epfgf', 0);
};
exports.handleGetFieldOps = handleGetFieldOps;
const handleGetEpfMedals = ({ msg, penguin }) => {
    msg.send(penguin, 'epfgr', penguin.epf.careerMedals, penguin.epf.medals);
};
exports.handleGetEpfMedals = handleGetEpfMedals;
const handleAddEpfItem = ({ data, penguin, msg, prst }, itemId) => {
    const item = data.getItem(itemId);
    if (item === null || !item.isEPF) {
        throw new Error(`Item ${itemId} is marked as not being from EPF, but is being bought through it`);
    }
    penguin.inventory.add(itemId);
    msg.send(penguin, 'epfai', penguin.epf.removeMedals(item.cost));
    prst(penguin);
};
exports.handleAddEpfItem = handleAddEpfItem;
const handleBecomeAgent = ({ prst, msg, penguin }) => {
    msg.send(penguin, 'epfsa', 1);
    penguin.psa.setAgent();
    prst(penguin);
};
exports.handleBecomeAgent = handleBecomeAgent;
const handleGrantAwards = ({ prst, penguin }, medals) => {
    penguin.epf.addMedals(medals);
    prst(penguin);
};
exports.handleGrantAwards = handleGrantAwards;
const handleGetPartyOp = ({ msg, data, penguin }) => {
    if (data.getPartyOp() === 'battle-of-doom') {
        msg.send(penguin, 'epfgp', penguin.battleOfDoom.completed ? 1 : 0);
    }
};
exports.handleGetPartyOp = handleGetPartyOp;
const handleSetPartyOp = ({ data, penguin, prst }, completed) => {
    if (completed === 1) {
        if (data.getPartyOp() === 'battle-of-doom') {
            penguin.battleOfDoom.setComplete();
        }
    }
    prst(penguin);
};
exports.handleSetPartyOp = handleSetPartyOp;
const handleEPFStamp = ({ msg, penguin }, stamp) => {
    if (!isEPFAgent(penguin)) {
        msg.send(penguin, 'epfsf', 'naa'); // TODO document
    }
    if (penguin.stampbook.has(stamp)) {
        msg.send(penguin, 'epfsf', 'ahm'); // TODO document
    }
    else {
        msg.send(penguin, 'epfsf', 'nem', stamp); // giving the stamp
    }
};
exports.handleEPFStamp = handleEPFStamp;
/** i#qi: o jogador (eu ou outro) tem esse item? */
const handleCheckInventory = async ({ msg, penguin, world, db }, itemId, playerId) => {
    if (!Number.isFinite(itemId) || !Number.isFinite(playerId)) {
        return;
    }
    let owned = false;
    const live = playerId === penguin.id ? penguin : world.getById(playerId);
    if (live !== undefined) {
        owned = live.inventory.has(itemId);
    }
    else {
        try {
            owned = ((await db.get(playerId))?.inventory ?? []).includes(itemId);
        }
        catch { /* sem dados */ }
    }
    msg.send(penguin, 'qi', itemId, playerId, owned ? 1 : 0);
};
exports.handleCheckInventory = handleCheckInventory;
