"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGlobalCrumbsSwf = getGlobalCrumbsSwf;
const utils_1 = require("../../common/utils.js");
const avm1_1 = require("../../common/flash/avm1.js");
const emitter_1 = require("../../common/flash/emitter.js");
const rooms_1 = require("../game-data/rooms");
const iglooItems_1 = require("../game-logic/iglooItems");
const puffle_1 = require("../game-logic/puffle");
const furniture_1 = require("../game-logic/furniture");
const items_1 = require("../game-logic/items");
const frame_hacks_1 = require("../game-data/frame-hacks");
const global_paths_1 = require("../game-data/global-paths");
const servers_1 = __importDefault(require("../servers"));
const game_crumbs_1 = require("../game-data/game-crumbs");
function getIglooCrumbs() {
    const code = [];
    iglooItems_1.IGLOO_TYPES.rows.forEach(igloo => {
        code.push([avm1_1.Action.Push, "igloo_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, igloo.id, "cost", igloo.cost, 1], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getServerCrumbs(ip, loginPort, worldPort, modern) {
    const code = [
        // normal servers
        [avm1_1.Action.Push, "servers"],
        [avm1_1.Action.Push, 0],
        [avm1_1.Action.Push, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal
    ];
    if (modern) {
        code.push([avm1_1.Action.Push, "login_server"], [avm1_1.Action.Push, 0], [avm1_1.Action.Push, "Object"], avm1_1.Action.NewObject, avm1_1.Action.DefineLocal, [avm1_1.Action.Push, "login_server"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "ip", ip], avm1_1.Action.SetMember, [avm1_1.Action.Push, "login_server"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "port"], [avm1_1.Action.Push, loginPort], avm1_1.Action.SetMember);
    }
    else {
        // login server: ip is array and even and odd ports
        code.push([avm1_1.Action.Push, "login_server"], [avm1_1.Action.Push, 0], [avm1_1.Action.Push, "Object"], avm1_1.Action.NewObject, avm1_1.Action.DefineLocal, [avm1_1.Action.Push, "login_server"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "ip"], [avm1_1.Action.Push, ip], [avm1_1.Action.Push, ip], [avm1_1.Action.Push, 2], avm1_1.Action.InitArray, avm1_1.Action.SetMember, [avm1_1.Action.Push, "login_server"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "even_port"], [avm1_1.Action.Push, loginPort], avm1_1.Action.SetMember, [avm1_1.Action.Push, "login_server"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "odd_port"], [avm1_1.Action.Push, worldPort], avm1_1.Action.SetMember);
    }
    servers_1.default.forEach(server => {
        code.push([avm1_1.Action.Push, "servers"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, server.id], [avm1_1.Action.Push, "ip"], [avm1_1.Action.Push, ip], [avm1_1.Action.Push, "is_safe"], [avm1_1.Action.Push, false], [avm1_1.Action.Push, "port"], [avm1_1.Action.Push, worldPort], [avm1_1.Action.Push, 3], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getGameCrumbs(music) {
    const code = [
        [avm1_1.Action.Push, "game_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal
    ];
    (0, utils_1.iterateEntries)(game_crumbs_1.GAME_CRUMBS, (game, crumb) => {
        const musicId = music.get(game);
        code.push([avm1_1.Action.Push, "game_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, game, "room_id", Number(crumb.room_id), "music_id", musicId ?? Number(crumb.music_id), "path", crumb.path, 3], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getFloorCrumbs() {
    const code = [];
    iglooItems_1.IGLOO_FLOORING.rows.forEach(floor => {
        code.push([avm1_1.Action.Push, "floor_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, floor.id, "cost", floor.cost, 1], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getRoomCrumbs(music, member) {
    const code = [];
    (0, utils_1.iterateEntries)(rooms_1.ROOMS, (room, info) => {
        let total = 3;
        let memberArgs = [];
        if (member.get(room) === true) {
            total += 1;
            memberArgs = ['is_member', true];
        }
        code.push([avm1_1.Action.Push, "room_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, room, "room_id", info.id, "music_id", music.get(room) ?? 0, "path", `${room}.swf`, ...memberArgs, total], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getPuffleCrumbs() {
    const code = [];
    puffle_1.PUFFLE_DATA.forEach((info, i) => {
        code.push([avm1_1.Action.Push, "puffle_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, i, "colour", info.colour, "max_health", info.max_health, "max_hunger", info.max_hunger, "max_rest", info.max_rest, 4], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getFurnitureCrumbs(prices) {
    const code = [];
    furniture_1.FURNITURE.rows.forEach(row => {
        let total = 3;
        const typeVar = {
            1: 'TYPE_ROOM',
            2: 'TYPE_WALL',
            3: 'TYPE_FLOOR',
            4: 'TYPE_WALL'
        }[row.type];
        if (typeVar === undefined) {
            throw new Error('Invalid furniture type');
        }
        const sortVar = {
            1: 'SORT_ROOM',
            2: 'SORT_WALL',
            3: 'SORT_FLOOR',
            4: 'SORT_PET'
        }[row.sort];
        if (sortVar === undefined) {
            throw new Error('Invalid sort type');
        }
        code.push([avm1_1.Action.Push, "furniture_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, row.id, "type", typeVar], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "sort", sortVar], avm1_1.Action.GetVariable);
        if (row.interactive !== null) {
            total += 1;
            const interactiveVar = {
                0: 'INTERACTIVE_PLAY',
                1: 'INTERACTIVE_REST',
                2: 'INTERACTIVE_FEED'
            }[row.interactive];
            if (interactiveVar === undefined) {
                throw new Error('Invalid interactive type');
            }
            code.push([avm1_1.Action.Push, "interactive", interactiveVar], avm1_1.Action.GetVariable);
        }
        const cost = prices.get(row.id) ?? row.cost;
        code.push([avm1_1.Action.Push, "cost", cost, total], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getPaperCrumbs(prices) {
    const code = [];
    items_1.ITEMS.rows.forEach(item => {
        let total = 3;
        const type = {
            [items_1.ItemType.Color]: 'COLOUR',
            [items_1.ItemType.Head]: 'HEAD',
            [items_1.ItemType.Face]: 'FACE',
            [items_1.ItemType.Neck]: 'NECK',
            [items_1.ItemType.Body]: 'BODY',
            [items_1.ItemType.Hand]: 'HAND',
            [items_1.ItemType.Feet]: 'FEET',
            [items_1.ItemType.Pin]: 'FLAG',
            [items_1.ItemType.Background]: 'PHOTO',
            [items_1.ItemType.Award]: 'OTHER'
        }[item.type];
        code.push([avm1_1.Action.Push, "paper_crumbs"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, item.id, "type", type], avm1_1.Action.GetVariable);
        if (item.makeAgent) {
            code.push([avm1_1.Action.Push, "make_secret_agent", true]);
            total++;
        }
        if (item.isMedal) {
            code.push([avm1_1.Action.Push, "is_medal", true]);
            total++;
        }
        if (item.isGift) {
            code.push([avm1_1.Action.Push, "is_gift", true]);
            total++;
        }
        if (item.noPurchasePopup) {
            code.push([avm1_1.Action.Push, "noPurchasePopup", true]);
            total++;
        }
        if (item.isTour) {
            code.push([avm1_1.Action.Push, "make_tour_guide", true]);
            total++;
        }
        if (item.isBack) {
            code.push([avm1_1.Action.Push, "is_back", true]);
            total++;
        }
        if (item.customDepth !== null) {
            code.push([avm1_1.Action.Push, "customDepth", item.customDepth]);
            total++;
        }
        const exclusive = {
            [items_1.ExclusiveType.Exclusive]: 'INVENTORY_EXCLUSIVE',
            [items_1.ExclusiveType.Super]: 'INVENTORY_SUPER_EXCLUSIVE',
            [items_1.ExclusiveType.Not]: null
        }[item.exclusive];
        if (exclusive !== null) {
            code.push([avm1_1.Action.Push, "exclusive", "shell"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, exclusive], avm1_1.Action.GetMember);
            total++;
        }
        const cost = prices.get(item.id) ?? item.cost;
        code.push([avm1_1.Action.Push, "cost", cost, "is_member", item.isMember, total], avm1_1.Action.InitObject, avm1_1.Action.SetMember);
    });
    return code;
}
function getFrameHacks() {
    const code = [];
    for (const [frame, hacks] of frame_hacks_1.FRAME_HACKS.getEntries()) {
        code.push([avm1_1.Action.Push, "frame_hacks"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, frame]);
        [...hacks].reverse().forEach(obj => {
            code.push([avm1_1.Action.Push, "head", obj.head, "face", obj.face, "neck", obj.neck, "body", obj.body, "hand", obj.hand, "feet", obj.feet, "secret_frame", obj.secret_frame, 7], avm1_1.Action.InitObject);
        });
        code.push([avm1_1.Action.Push, hacks.length], avm1_1.Action.InitArray, avm1_1.Action.SetMember);
    }
    return code;
}
function getGlobalPath(paths, useCompositePaths) {
    const code = [];
    // TODO put below code in version check. Currently all paths in GLOBAL_PATHS are written twice
    if (useCompositePaths) {
        code.push([avm1_1.Action.Push, "global_content"], [avm1_1.Action.Push, 0], [avm1_1.Action.Push, "shell"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "getGlobalContentPath"], avm1_1.Action.CallMethod, avm1_1.Action.DefineLocal, [avm1_1.Action.Push, "game_path"], [avm1_1.Action.Push, 0], [avm1_1.Action.Push, "shell"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, "getGameContentPath"], avm1_1.Action.CallMethod, avm1_1.Action.DefineLocal);
        const newPaths = {};
        paths.forEach((value, key) => {
            if (value !== undefined && value !== null) {
                newPaths[key] = value;
            }
        });
        const compositePaths = (0, global_paths_1.makeGlobalPathsComposite)({ ...global_paths_1.GLOBAL_PATHS, ...newPaths });
        (0, utils_1.iterateEntries)(compositePaths, (key, value) => {
            const [base, path] = value;
            code.push([avm1_1.Action.Push, "global_path"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, key, base], avm1_1.Action.GetVariable, [avm1_1.Action.Push, path], avm1_1.Action.Add2, avm1_1.Action.SetMember);
        });
    }
    else {
        [...Object.entries(global_paths_1.GLOBAL_PATHS), ...paths.entries()].forEach(([key, path]) => {
            if (path !== undefined && path !== null) {
                code.push([avm1_1.Action.Push, "global_path"], avm1_1.Action.GetVariable, [avm1_1.Action.Push, key, path], avm1_1.Action.SetMember);
            }
        });
    }
    return code;
}
function getScavengerHunt(reward, member) {
    const code = [
        [avm1_1.Action.Push, "scavenger_hunt_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "scavenger_hunt_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "hunt_active", true],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "scavenger_hunt_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "member_hunt", member],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "scavenger_hunt_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "itemRewardID", reward],
        avm1_1.Action.SetMember
    ];
    return code;
}
function getGlobalCrumbsSwf(d, s) {
    const migrator = d.getMigrator();
    const hunt = d.getHunt();
    const code = [
        [avm1_1.Action.Push, "shell", 0, "_global"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "getCurrentShell"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "igloo_options", 0],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "igloo_options"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "contestRunning", false],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "igloo_crumbs", 0],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        ...getIglooCrumbs(),
        [avm1_1.Action.Push, "floor_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        ...getFloorCrumbs(),
        [avm1_1.Action.Push, "room_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        ...getRoomCrumbs(d.getRoomsMusic(s.mods.getMusic()), d.getRoomsMember()),
        [avm1_1.Action.Push, "puffle_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        ...getPuffleCrumbs(),
        [avm1_1.Action.Push, "furniture_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "TYPE_ROOM", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_TYPE_ROOM"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "TYPE_WALL", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_TYPE_WALL"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "TYPE_FLOOR", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_TYPE_FLOOR"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "SORT_ROOM", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_SORT_ROOM"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "SORT_WALL", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_SORT_WALL"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "SORT_FLOOR", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_SORT_FLOOR"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "SORT_PET", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "FURNITURE_SORT_PET"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "INTERACTIVE_PLAY", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INTERACTIVE_PLAY"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "INTERACTIVE_REST", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INTERACTIVE_REST"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "INTERACTIVE_FEED", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INTERACTIVE_FEED"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        ...getFurnitureCrumbs(d.getFurniturePrices()),
        [avm1_1.Action.Push, "paper_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "COLOUR", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_COLOUR"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "HEAD", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_HEAD"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "FACE", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_FACE"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "NECK", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_NECK"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "BODY", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_BODY"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "HAND", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_HAND"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "FEET", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_FEET"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "FLAG", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_FLAG"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PHOTO", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_PHOTO"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "OTHER", "shell"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "INVENTORY_TYPE_OTHER"],
        avm1_1.Action.GetMember,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_TOP_LAYER", 7500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_HAND_LAYER", 7000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_HAND_AND_HEAD", 6500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_HEAD_LAYER", 6000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_HEAD_AND_FACE", 5500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_FACE_LAYER", 5000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_FACE_AND_NECK", 4500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_NECK_LAYER", 4000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_NECK_AND_BODY", 3500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BODY_LAYER", 3000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_BODY_AND_FEET", 2500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_FEET_LAYER", 2000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BETWEEN_FEET_AND_BACK", 1500],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BACK_LAYER", 1000],
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "PAPERDOLLDEPTH_BOTTOM_LAYER", 500],
        avm1_1.Action.DefineLocal,
        ...getPaperCrumbs(d.getItemPrices()),
        [avm1_1.Action.Push, "player_colours", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 0, "0x003366"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 1, "0x003366"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 2, "0x009900"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 3, "0xFF3399"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 4, "0x333333"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 5, "0xCC0000"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 6, "0xFF6600"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 7, "0xFFCC00"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 8, "0x660099"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 9, "0x996600"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 10, "0xFF6666"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 11, "0x006600"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 12, "0x0099CC"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 13, "0x8AE302"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 14, "0x93A0A4"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "player_colours"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 15, "0x02A797"],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "frame_hacks", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        ...getFrameHacks(),
        [avm1_1.Action.Push, "blocked_prefixes", 0, "Array"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "sensei", 1, "blocked_prefixes"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "push"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.Pop,
        [avm1_1.Action.Push, "room_", 1, "blocked_prefixes"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "push"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.Pop,
        [avm1_1.Action.Push, "map", 1, "blocked_prefixes"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "push"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.Pop,
        [avm1_1.Action.Push, "blocked_suffixes", 0, "Array"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "blocked_overrides", 0, "Array"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "room_dojo", 1, "blocked_overrides"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "push"],
        avm1_1.Action.CallMethod,
        avm1_1.Action.Pop,
        [avm1_1.Action.Push, "global_path", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        ...getGlobalPath(d.getGlobalPaths(), d.useCompositePaths()),
        [avm1_1.Action.Push, "mascot_options", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "mascot_options"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, "migrator_active", migrator],
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "rockhopper", "name", "Rockhopper", "gift_id", 959, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "auntArctic", "name", "Aunt Arctic", "gift_id", 9021, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "cadence", "name", "Cadence", "gift_id", 9015, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "gary", "name", "Gary", "gift_id", 9007, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "franky", "name", "Franky", "gift_id", 996, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "peteyK", "name", "Petey K", "gift_id", 996, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "gBilly", "name", "G Billy", "gift_id", 996, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "stompinBob", "name", "Stompin Bob", "gift_id", 996, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "sensei", "name", "Sensei", "gift_id", 9036, 2],
        avm1_1.Action.InitObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "mascot_crumbs", 0, "Object"],
        avm1_1.Action.NewObject,
        avm1_1.Action.DefineLocal,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 1, "rockhopper"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 2, "auntArctic"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 3, "cadence"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 4, "gary"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 5, "franky"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 6, "peteyK"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 7, "gBilly"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 8, "stompinBob"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        [avm1_1.Action.Push, "mascot_crumbs"],
        avm1_1.Action.GetVariable,
        [avm1_1.Action.Push, 9, "sensei"],
        avm1_1.Action.GetVariable,
        avm1_1.Action.SetMember,
        ...getServerCrumbs(s.targetIP, s.loginPort, s.worldPort, d.isVanillaEngine()),
        ...getGameCrumbs(d.getGamesMusic())
    ];
    if (hunt !== null) {
        code.push(...getScavengerHunt(hunt.global.reward, hunt.global.member));
    }
    return Buffer.from((0, emitter_1.emitCrumbSwf)((0, avm1_1.createBytecode)(code)));
}
