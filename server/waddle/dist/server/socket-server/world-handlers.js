"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorldXtHandler = void 0;
const join_1 = require("./handlers/join");
const xt_handler_1 = require("./xt-handler");
const room_1 = require("./handlers/room");
const utils_1 = require("../../common/utils.js");
const card_1 = require("./handlers/card");
const mail_1 = require("./handlers/mail");
const create_1 = require("./handlers/create");
const game_1 = require("./handlers/game");
const igloo_1 = require("./handlers/igloo");
const ninja_1 = require("./handlers/ninja");
const party_1 = require("./handlers/party");
const puffle_1 = require("./handlers/puffle");
const rainbow_1 = require("./handlers/rainbow");
const sled_1 = require("./handlers/sled");
const buddy_1 = require("./handlers/buddy");
const fire_1 = require("./handlers/fire");
class XtGenerator {
    _tester;
    constructor(_tester) {
        this._tester = _tester;
    }
    xt(extension, code, signature, callback, params) {
        return [
            extension, code,
            [this._tester, params?.guard === undefined ? (undefined) : params.guard],
            signature,
            callback,
            params?.xt ?? {}
        ];
    }
}
const groupCallbacks = (callbacks) => {
    if (callbacks.length === 0) {
        return [];
    }
    const first = callbacks[0];
    const tail = callbacks.slice(1);
    const [ext, code] = first;
    const [others, rest] = (0, utils_1.doubleFilter)(i => i[0] === ext && i[1] === code, tail);
    return [
        [[ext, code].join('%'), [first, ...others].map(i => [i[2], i[3], i[4], i[5]])],
        ...groupCallbacks(rest)
    ];
};
const getFinalCallbacks = (grouped) => {
    return grouped.map(([name, callbacks]) => {
        if (callbacks.length > 1 && callbacks.filter(([[_, guard]]) => guard === undefined).length > 0) {
            throw new Error(`Multiple functions for ${name}, but some had no guard`);
        }
        return [name, callbacks.map(([[types, guard], signature, callback, params]) => [[types, guard === undefined ? (() => true) : guard], signature, callback, params])];
    });
};
const createWorldXtHandler = () => {
    const p = new XtGenerator((ctx) => 'penguin' in ctx);
    const r = new XtGenerator((ctx) => 'room' in ctx);
    const c = new XtGenerator((ctx) => 'card' in ctx);
    const z = new XtGenerator((_) => true);
    const g = new XtGenerator((ctx) => 'game' in ctx);
    const s = new XtGenerator((ctx) => 'sled' in ctx);
    const f = new XtGenerator(ctx => 'fire' in ctx);
    const callbacks = [
        p.xt('s', 'js', 'string', join_1.handleJoinServer),
        p.xt('s', 'jr', ['number', 'number', 'number'], join_1.joinRoom),
        p.xt('s', 'gi', [], join_1.handleGetItems),
        p.xt('s', 'ai', ['number'], join_1.handleAddItem),
        p.xt('s', 'jp', ['number', 'number'], join_1.handleJoinPlayerOld),
        p.xt('s', 'ac', [], join_1.handleSendCoins),
        p.xt('s', 'gc', [], join_1.handleGetCoins),
        p.xt('s', 'il', [], join_1.handleReceiveInventory),
        r.xt('s', 'sp', ['number', 'number'], room_1.handleSetPosition),
        r.xt('s', 'sf', ['number'], room_1.handleSetFrame),
        r.xt('s', 'sa', ['string'], room_1.handleSetAction),
        r.xt('s', 'sb', ['string', 'string'], room_1.handleSetSnowball),
        r.xt('s', 'se', ['string'], room_1.handleSendEmote),
        r.xt('s', 'sj', ['string'], room_1.handleSendJoke),
        r.xt('s', 'ss', ['string'], room_1.handleSafeMessage),
        r.xt('s', 'at', ['string', 'string'], room_1.handleAddToyOld),
        r.xt('s', 'rt', [], room_1.handleCloseToy),
        r.xt('s', 'st', ['number', 'number', 'number'], room_1.sendTeleportOld),
        r.xt('s', 'up', ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'], room_1.handleUpdatePenguinOld),
        r.xt('s', 'gt', 'number', room_1.handleGetTables),
        r.xt('s', 'jt', ['number'], room_1.handleJoinTable),
        r.xt('s', 'lt', [], room_1.handleLeaveTable),
        p.xt('s', 'gb', [], join_1.sendGetBuddies),
        p.xt('s', 'go', [], join_1.sendBuddyOnlineList),
        p.xt('s', 'bq', ['number'], join_1.handleBuddyRequest),
        p.xt('s', 'ba', ['number'], join_1.handleBuddyAccept),
        p.xt('s', 'bd', ['number'], join_1.handleBuddyDecline),
        p.xt('s', 'br', ['number'], join_1.handleBuddyRemove),
        p.xt('s', 'bm', ['number', 'number'], join_1.handleBuddyMessage),
        p.xt('s', 'gp', ['number'], join_1.handleGetPlayer),
        p.xt('s', 'an', ['number'], buddy_1.handleAddIgnore),
        p.xt('s', 'rn', ['number'], buddy_1.handleRemoveIgnore),
        p.xt('s', 'af', ['number'], igloo_1.handleAddFurniture),
        p.xt('s', 'au', ['number'], igloo_1.handleAddIgloo),
        p.xt('s', 'gf', [], igloo_1.handleGetFurniture),
        p.xt('s', 'ur', 'string', igloo_1.handleUpdateIglooOld),
        p.xt('s', 'sc', ['number', 'number', 'number'], mail_1.handleSendCard),
        p.xt('r', 'gm', ['number'], igloo_1.getIglooOld),
        p.xt('r', 'af', ['number'], igloo_1.handleAddFurniture),
        p.xt('r', 'au', ['number'], igloo_1.handleAddIgloo),
        p.xt('r', 'ag', ['number'], igloo_1.handleAddFlooring),
        p.xt('r', 'ur', 'string', igloo_1.handleUpdateIgloo),
        p.xt('r', 'gf', [], igloo_1.handleGetFurniture),
        p.xt('r', 'or', ['number'], igloo_1.handleOpenIgloo),
        p.xt('r', 'cr', ['number'], igloo_1.handleCloseIgloo),
        p.xt('r', 'gr', [], igloo_1.handleGetOpenIgloos),
        p.xt('r', 'um', ['number'], igloo_1.handleUpdateMusic),
        p.xt('k', 'spy', ['number'], join_1.handleSpyRequest),
        p.xt('b', 'gb', [], join_1.sendGetBuddies),
        p.xt('b', 'go', [], join_1.sendBuddyOnlineList),
        p.xt('b', 'br', ['number'], join_1.handleBuddyRequest),
        p.xt('b', 'ba', ['number'], join_1.handleBuddyAccept),
        p.xt('b', 'bd', ['number'], join_1.handleBuddyDecline),
        p.xt('b', 'rb', ['number'], join_1.handleBuddyRemove),
        p.xt('b', 'bm', ['number', 'number'], join_1.handleBuddyMessage),
        p.xt('n', 'gn', [], buddy_1.handleGetIgnoreList),
        p.xt('n', 'an', ['number'], buddy_1.handleAddIgnore),
        p.xt('n', 'rn', ['number'], buddy_1.handleRemoveIgnore),
        p.xt('p', 'gp', ['number'], join_1.handleGetPlayer),
        r.xt('z', 'gw', 'string', room_1.handleGetWaddle),
        r.xt('z', 'jw', ['number'], room_1.handleJoinWaddle),
        r.xt('z', 'lw', [], room_1.handleLeaveWaddle),
        r.xt('z', 'jz', [], room_1.handleJoinTableGame, { guard: room_1.isTableGuard }),
        s.xt('z', 'jz', [], sled_1.handleJoinSled, { guard: sled_1.isSledGuard }),
        r.xt('z', 'gz', 'string', room_1.handleGetTableGame, { guard: room_1.isTableGuard }),
        r.xt('z', 'gz', [], room_1.handleGetHockeyGame, { guard: room_1.isHockeyGuard }),
        c.xt('z', 'gz', ['number'], card_1.handleEnterCardGame, { guard: card_1.isCardJitsuGuard }),
        f.xt('z', 'gz', ['number'], fire_1.handleEnterFireGame, { guard: fire_1.isFireGuard }),
        r.xt('z', 'uz', ['number'], room_1.handleUpdateHockeyGame, { guard: room_1.isHockeyGuard }),
        c.xt('z', 'uz', [], card_1.handleUpdateCardSeats, { guard: card_1.isCardJitsuGuard }),
        r.xt('z', 'lz', [], room_1.handleLeaveTableGame, { guard: room_1.isTableGuard }),
        c.xt('z', 'lz', [], card_1.handleQuitCard, { guard: card_1.isCardJitsuGuard }),
        f.xt('z', 'lz', [], fire_1.handleLeaveFire, { guard: fire_1.isFireGuard }),
        r.xt('z', 'zm', 'number', room_1.handleSendTableMove, { guard: room_1.isTableGuard }),
        r.xt('z', 'zm', ['number', 'number'], room_1.handleMoveHockeyPuckOld, { guard: room_1.isHockeyGuard }),
        s.xt('z', 'zm', ['number', 'number', 'number', 'number'], sled_1.handleMoveSled, { guard: sled_1.isSledGuard }),
        c.xt('z', 'zm', ['string', 'number'], card_1.handleCardJitsuAction, { guard: card_1.isCardJitsuGuard }),
        f.xt('z', 'zm', 'string', fire_1.handleFireMove, { guard: fire_1.isFireGuard }),
        r.xt('z', 'm', ['number', 'number', 'number', 'number', 'number'], room_1.handleMoveHockeyPuck, { guard: room_1.isHockeyGuard }),
        p.xt('z', 'ggd', [], join_1.handleGetPuffleLaunchData),
        p.xt('z', 'sgd', ['string'], join_1.handleSetPuffleLaunchData),
        g.xt('z', 'zo', ['number'], game_1.handleLeaveGame, { guard: game_1.isGameGuard }),
        s.xt('z', 'zo', ['number'], sled_1.handleEndSled, { guard: sled_1.isSledGuard }),
        c.xt('z', 'zo', ['number'], card_1.handleAbortCard, { guard: card_1.isCardJitsuGuard }),
        p.xt('z', 'zr', [], join_1.handleGetSpyDrillsChallenge),
        p.xt('z', 'zc', ['number'], join_1.handleGetSpyDrillsReward),
        p.xt('z', 'epfsf', ['number'], join_1.handleEPFStamp),
        g.xt('z', 'jmm', [], ninja_1.handleJoinMatchmaking),
        g.xt('z', 'lmm', [], ninja_1.handleLeaveMatchmake),
        g.xt('z', 'jsen', [], ninja_1.handleJoinSensei),
        p.xt('s', 'j#js', ['string', 'string', 'string'], join_1.handleJoinServer),
        p.xt('s', 'j#jr', ['number', 'number', 'number'], join_1.joinRoom),
        g.xt('s', 'j#grs', [], game_1.handleRoomRefresh),
        p.xt('s', 'j#jp', ['number'], join_1.handleJoinPlayerCpip, { guard: join_1.isPreBackyardGuard }),
        p.xt('s', 'j#jp', ['number', 'string'], join_1.handleJoinPlayerModern, { guard: join_1.isBackyardGuard }),
        p.xt('s', 'i#gi', [], join_1.handleGetItems),
        p.xt('s', 'i#ai', ['number'], join_1.handleAddItem),
        p.xt('s', 'i#qpp', ['number'], join_1.handleGetPinInfo),
        p.xt('s', 'i#qpa', ['number'], join_1.handleGetMissionStamps),
        p.xt('s', 'l#mst', [], mail_1.handleMailTotal),
        p.xt('s', 'l#mg', ['number'], mail_1.handleGetMail),
        p.xt('s', 'l#mc', [], mail_1.handleSetMailCheck),
        p.xt('s', 'l#ms', ['number', 'number'], mail_1.handleSendMail),
        p.xt('s', 'l#mdp', ['number'], mail_1.handleDeleteMailFromPenguin),
        p.xt('s', 'l#md', ['number'], mail_1.handleDeletePostcard),
        r.xt('s', 'u#sp', ['number', 'number'], room_1.handleSetPosition),
        r.xt('s', 'u#sf', ['number'], room_1.handleSetFrame),
        r.xt('s', 'u#sa', ['string'], room_1.handleSetAction),
        r.xt('s', 'u#sb', ['string', 'string'], room_1.handleSetSnowball),
        r.xt('s', 'u#se', ['string'], room_1.handleSendEmote),
        r.xt('s', 'u#sj', ['string'], room_1.handleSendJoke),
        r.xt('s', 'u#ss', ['string'], room_1.handleSafeMessage),
        r.xt('s', 'u#sl', ['string'], room_1.handleSendLine),
        r.xt('s', 'u#tp', ['number', 'number'], room_1.handleTeleport),
        p.xt('s', 'u#glr', [], join_1.handleGLR),
        p.xt('s', 'u#pbi', ['string'], join_1.handlePBI),
        p.xt('s', 'u#h', [], join_1.handleHeartbeat),
        p.xt('s', 'u#gp', ['number'], join_1.handleGetPlayer),
        r.xt('s', 'm#sm', ['string', 'string'], room_1.handleSendMessage),
        r.xt('s', 't#at', ['string', 'string'], room_1.handleAddToy),
        r.xt('s', 't#rt', ['string', 'string'], room_1.handleCloseToy),
        r.xt('s', 's#upc', ['number'], room_1.handleUpdateColor),
        r.xt('s', 's#uph', ['number'], room_1.handleUpdateHead),
        r.xt('s', 's#upn', ['number'], room_1.handleUpdateNeck),
        r.xt('s', 's#upf', ['number'], room_1.handleUpdateFace),
        r.xt('s', 's#upb', ['number'], room_1.handleUpdateBody),
        r.xt('s', 's#upa', ['number'], room_1.handleUpdateHand),
        r.xt('s', 's#upe', ['number'], room_1.handleUpdateFeet),
        r.xt('s', 's#upl', ['number'], room_1.handleUpdatePin),
        r.xt('s', 's#upp', ['number'], room_1.handleUpdateBackground),
        p.xt('s', 'p#pg', ['number'], puffle_1.handleGetIglooPufflesOld, { guard: join_1.isPreBackyardGuard }),
        p.xt('s', 'p#pg', ['number', 'string'], puffle_1.handleGetIglooPuffles, { guard: join_1.isBackyardGuard }),
        p.xt('s', 'p#pn', ['number', 'string'], puffle_1.handleAdoptPuffleOld, { guard: puffle_1.isBeforePuffleCreatureGuard }),
        p.xt('s', 'p#pn', ['number', 'string', 'number'], puffle_1.handleAdoptPuffle, { guard: puffle_1.isAfterPuffleCreatureGuard, xt: { cooldown: 2000 } }),
        p.xt('s', 'p#pgpi', [], puffle_1.handleGetPuffleInventory),
        p.xt('s', 'p#papi', ['number'], puffle_1.handleBuyPuffleCareItem),
        p.xt('s', 'p#checkpufflename', ['string'], puffle_1.sendModernPuffleCheck),
        p.xt('s', 'p#pcn', ['string'], puffle_1.sendPuffleCheck),
        p.xt('s', 'p#pw', ['number', 'number'], puffle_1.handlePuffleWalk),
        p.xt('s', 'p#puffleswap', ['number', 'string'], puffle_1.handlePuffleBackyardSwap),
        r.xt('s', 'p#puffledig', ['number'], puffle_1.handlePuffleDigRandom),
        r.xt('s', 'p#puffledigoncommand', [], puffle_1.handlePuffleDigOnCommand),
        p.xt('s', 'p#pcid', ['number', 'number'], puffle_1.handleEatPuffleItem),
        p.xt('s', 'p#revealgoldpuffle', [], puffle_1.handleRevealGoldPuffle),
        p.xt('s', 'g#gm', ['number'], igloo_1.handleGetIglooCpip),
        // o cliente 2012 manda o id do dono do iglu (g#gii 1000): aceita qualquer argumento
        p.xt('s', 'g#gii', 'string', igloo_1.handleGetIglooItems),
        p.xt('s', 'g#af', ['number'], igloo_1.handleAddFurniture),
        p.xt('s', 'g#au', ['number'], igloo_1.handleAddIgloo),
        p.xt('s', 'g#ag', ['number'], igloo_1.handleAddFlooring),
        p.xt('s', 'g#ur', 'string', igloo_1.handleUpdateIgloo),
        p.xt('s', 'g#ao', ['number'], igloo_1.handleUpdateIglooType),
        p.xt('s', 'g#gf', [], igloo_1.handleGetFurnitureNew),
        p.xt('s', 'g#go', [], igloo_1.handleGetIglooTypes),
        p.xt('s', 'g#or', ['number', 'string'], igloo_1.handleOpenIgloo),
        p.xt('s', 'g#cr', ['number'], igloo_1.handleCloseIgloo),
        p.xt('s', 'g#gr', [], igloo_1.handleGetOpenIgloos),
        p.xt('s', 'g#um', ['number'], igloo_1.handleUpdateMusic),
        p.xt('s', 'g#gili', 'string', igloo_1.handleGetIglooLikes),
        p.xt('s', 'g#ggd', 'string', igloo_1.handleGetDj3kTracks),
        p.xt('s', 'g#gail', ['number'], igloo_1.handleGetAllIglooLayouts),
        p.xt('s', 'g#uic', ['number', 'number', 'number', 'number', 'number', 'string'], igloo_1.handleUpdateIglooNew),
        p.xt('s', 'g#al', [], igloo_1.handleAddIglooLayout),
        p.xt('s', 'g#uiss', ['number', 'string'], igloo_1.handleUpdateIglooLayout),
        p.xt('s', 'g#aloc', ['number'], igloo_1.handleAddIglooLocation),
        p.xt('s', 'b#gb', [], join_1.sendGetBuddies),
        p.xt('s', 'b#br', ['number'], join_1.handleBuddyRequest),
        p.xt('s', 'b#ba', ['number'], join_1.handleBuddyAccept),
        p.xt('s', 'b#bf', ['number'], join_1.handleFindBuddy),
        p.xt('s', 'b#rb', ['number'], join_1.handleBuddyRemove),
        p.xt('s', 'n#gn', [], buddy_1.handleGetIgnoreList),
        p.xt('s', 'n#an', ['number'], buddy_1.handleAddIgnore),
        p.xt('s', 'n#rn', ['number'], buddy_1.handleRemoveIgnore),
        r.xt('s', 'a#gt', 'number', room_1.handleGetTables),
        r.xt('s', 'a#jt', ['number'], room_1.handleJoinTable),
        r.xt('s', 'a#lt', [], room_1.handleLeaveTable),
        p.xt('s', 'musictrack#getmymusictracks', [], igloo_1.handleGetMusicTracks),
        r.xt('s', 'pt#spts', ['number'], room_1.handlePlayerTransform),
        p.xt('s', 'r#gtc', [], join_1.handleGetTotalCoins),
        p.xt('s', 'st#gsbcd', ['number'], join_1.handleGetStampbookCoverData),
        p.xt('s', 'st#gps', ['number'], join_1.sendStamps),
        p.xt('s', 'st#gmres', [], join_1.handleGetRecentStamps),
        p.xt('s', 'st#ssbcd', 'string', join_1.handleSetStampbookCoverData),
        p.xt('s', 'st#sse', ['number'], join_1.handleSetStampEarned),
        p.xt('s', 'f#epfga', [], join_1.handleGetEpfStatus),
        p.xt('s', 'f#epfgf', [], join_1.handleGetFieldOps),
        p.xt('s', 'f#epfgr', [], join_1.handleGetEpfMedals),
        p.xt('s', 'f#epfai', ['number'], join_1.handleAddEpfItem),
        p.xt('s', 'f#epfsa', [], join_1.handleBecomeAgent),
        p.xt('s', 'f#epfgrantreward', ['number'], join_1.handleGrantAwards),
        p.xt('s', 'f#epfgp', [], join_1.handleGetPartyOp),
        p.xt('s', 'f#epfsp', ['number'], join_1.handleSetPartyOp),
        p.xt('s', 'ni#gnr', ['number'], ninja_1.handleGetNinjaRanks),
        p.xt('s', 'ni#gnl', [], ninja_1.handleGetNinjaLevel),
        p.xt('s', 'ni#gcd', [], ninja_1.handleGetNinjaCards),
        p.xt('s', 'ni#gfl', [], ninja_1.handleGetFireLevel),
        p.xt('s', 'ni#gwl', [], ninja_1.handleGetWaterLevel),
        p.xt('s', 'w#jx', ['number', 'number', 'number'], ninja_1.handleJoinFromMatchmake),
        p.xt('s', 'cd#bpc', [], ninja_1.handleBuyNinjaCards),
        p.xt('s', 'rpq#rpqd', [], rainbow_1.handleGetRainbowQuestData),
        p.xt('s', 'rpq#rpqtc', ['number'], rainbow_1.handleSendRainbowTaskComplete),
        p.xt('s', 'rpq#rpqcc', ['string'], rainbow_1.handleSendRainbowQuestCollectCoins),
        p.xt('s', 'rpq#rpqic', ['number'], rainbow_1.handleSendRainbowQuestItemCollect),
        p.xt('s', 'rpq#rpqbc', [], rainbow_1.handleSendRainbowQuestBonusCoins),
        p.xt('s', 'e#dc', ['string', 'number'], party_1.handleDonateCoins),
        p.xt('s', 'mdvl#retrieve', [], party_1.handleRetrieveMedieval2012),
        p.xt('s', 'mdvl#msgviewed', ['number'], party_1.handleViewedMedieval2012),
        p.xt('s', 'ba#barsu', [], party_1.handleGetBakeryState),
        p.xt('s', 'ba#seh', ['string'], party_1.handleSendEnterHopper),
        p.xt('s', 'ba#ctc', [], party_1.handleGetCookieInventory),
        r.xt('m', 'sm', ['string', 'string'], room_1.handleSendMessage),
        r.xt('m', 'ss', ['string'], room_1.handleSafeMessage),
        z.xt('m', 'checkName', ['string'], create_1.handleCheckName)
    ];
    const grouped = groupCallbacks(callbacks);
    return new xt_handler_1.XtHandler(getFinalCallbacks(grouped), join_1.handleDisconnect);
};
exports.createWorldXtHandler = createWorldXtHandler;
