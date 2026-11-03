"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGetMusicTracks = exports.handleAddIglooLocation = exports.handleUpdateIglooLayout = exports.handleAddIglooLayout = exports.handleGetAllIglooLayouts = exports.handleGetDj3kTracks = exports.handleGetIglooLikes = exports.handleGetIglooTypes = exports.handleUpdateMusic = exports.handleGetOpenIgloos = exports.handleCloseIgloo = exports.handleOpenIgloo = exports.handleGetFurnitureNew = exports.handleGetFurniture = exports.handleUpdateIglooOld = exports.handleUpdateIglooNew = exports.handleUpdateIgloo = exports.handleAddFlooring = exports.handleUpdateIglooType = exports.handleAddIgloo = exports.handleAddFurniture = exports.handleGetIglooItems = exports.handleGetIglooCpip = exports.getIglooOld = void 0;
exports.getIglooFromId = getIglooFromId;
exports.getFurnitureString = getFurnitureString;
exports.processFurniture = processFurniture;
const furniture_1 = require("../../game-logic/furniture.js");
const iglooItems_1 = require("../../game-logic/iglooItems.js");
const puffle_1 = require("./puffle");
async function getIglooFromId(world, db, ownerId) {
    return world.getById(ownerId)?.igloo.activeIgloo ??
        ((data) => {
            if (data === null) {
                return undefined;
            }
            return data.igloos.find(igloo => igloo.id === data.igloo);
        })(await db.get(ownerId));
}
function getFurnitureString(furniture) {
    return furniture.map((furniture) => {
        return [
            furniture.id,
            furniture.x,
            furniture.y,
            furniture.rotation,
            furniture.frame
        ].join('|');
    }).join(',');
}
const getIglooOld = async (ctx, ownerId) => {
    const { world, db, msg, penguin } = ctx;
    const igloo = await getIglooFromId(world, db, ownerId);
    if (igloo === undefined) {
        return;
    }
    msg.send(penguin, 'gm', ownerId, igloo.type, igloo.music, igloo.flooring, getFurnitureString(igloo.furniture));
};
exports.getIglooOld = getIglooOld;
function getModernIglooString(igloo, index) {
    const likeCount = 0;
    return [
        igloo.id,
        index,
        0, // TODO don't know what this is
        igloo.locked ? 1 : 0,
        igloo.music,
        igloo.flooring,
        igloo.location,
        igloo.type,
        likeCount,
        getFurnitureString(igloo.furniture)
    ].join(':');
}
const handleGetIglooCpip = ({ world, penguin, msg, data }, penguinId) => {
    const host = world.getById(penguinId);
    if (host !== undefined) {
        // const igloo = host.getOwnIglooString();
        const igloo = host.igloo.activeIgloo;
        if (!data.isVanillaEngine()) {
            msg.send(penguin, 'gm', penguinId, igloo.type, igloo.music, igloo.flooring, getFurnitureString(igloo.furniture));
        }
        else {
            msg.send(penguin, 'gm', penguinId, getModernIglooString(igloo, 1));
        }
    }
};
exports.handleGetIglooCpip = handleGetIglooCpip;
const handleGetIglooItems = ({ msg, penguin }) => {
    // No idea what these zeros are used for
    const zeros = '0000000000';
    const furnitureInfo = penguin.igloo.furniture.map((pair) => {
        const [id, amount] = pair;
        return `${id}|${zeros}|${amount}`;
    });
    const floorings = penguin.igloo.floorings;
    const igloos = penguin.igloo.types;
    const locations = penguin.igloo.locations;
    const information = [
        furnitureInfo,
        // this ... is for the other types which don't have "amount"
        ...[
            floorings,
            igloos,
            locations
        ].map((items) => {
            return items.map(item => `${item}|${zeros}`);
        })
    ].map((infoArray) => {
        return infoArray.join(',');
    });
    msg.send(penguin, 'gii', ...information);
};
exports.handleGetIglooItems = handleGetIglooItems;
const handleAddFurniture = (ctx, furnitureId) => {
    const { penguin, msg, prst } = ctx;
    const item = furniture_1.FURNITURE.getStrict(furnitureId);
    penguin.igloo.addFurniture(furnitureId, 1);
    msg.send(penguin, 'af', furnitureId, penguin.currency.discount(item.cost));
    prst(penguin);
};
exports.handleAddFurniture = handleAddFurniture;
const handleAddIgloo = (ctx, iglooId) => {
    const { penguin, msg, prst, data } = ctx;
    const cost = (0, iglooItems_1.getIglooCost)(iglooId);
    if (data.isAfterOwnedIgloos()) {
        penguin.igloo.addIglooType(iglooId);
    }
    else {
        // unknown if music was reset or not in the original
        penguin.igloo.updateIgloo({ type: iglooId, music: 0, flooring: 0, furniture: [] });
    }
    msg.send(penguin, 'au', iglooId, penguin.currency.discount(cost));
    prst(penguin);
};
exports.handleAddIgloo = handleAddIgloo;
const handleUpdateIglooType = ({ prst, penguin }, iglooType) => {
    // is it not required to remove flooring etc?
    penguin.igloo.updateIgloo({ type: iglooType });
    prst(penguin);
};
exports.handleUpdateIglooType = handleUpdateIglooType;
const handleAddFlooring = (ctx, flooring) => {
    const { msg, penguin, prst, data } = ctx;
    const cost = (0, iglooItems_1.getFlooringCost)(flooring);
    if (data.isVanillaEngine()) {
        // placeholder for when flooring inventory was added (before it was auto updated)
        penguin.igloo.addFlooring(flooring);
    }
    else {
        penguin.igloo.updateIgloo({ flooring });
    }
    msg.send(penguin, 'ag', flooring, penguin.currency.discount(cost));
    prst(penguin);
};
exports.handleAddFlooring = handleAddFlooring;
function processFurniture(furnitureItems) {
    return furnitureItems.map((furnitureString) => {
        const [furniture, x, y, rotation, frame] = furnitureString.split('|').map((str) => Number(str));
        return {
            id: furniture,
            x,
            y,
            rotation,
            frame
        };
    });
}
const addFullHouseStamp = (ctx) => {
    (0, puffle_1.getStamp)(ctx.data, ctx.msg, ctx.penguin, 23);
};
const handleUpdateIgloo = (ctx, ...furnitureItems) => {
    const { prst, penguin } = ctx;
    const igloo = processFurniture(furnitureItems);
    if (igloo.length === 99) {
        addFullHouseStamp(ctx);
    }
    penguin.igloo.updateIgloo({ furniture: igloo });
    prst(penguin);
};
exports.handleUpdateIgloo = handleUpdateIgloo;
const handleUpdateIglooNew = (ctx, layoutId, type, flooring, location, music, furnitureData) => {
    const { prst, penguin } = ctx;
    penguin.igloo.setActiveIgloo(layoutId);
    const furniture = furnitureData === '' ? [] : processFurniture(furnitureData.split(','));
    if (furniture.length >= 99) {
        addFullHouseStamp(ctx);
    }
    penguin.igloo.updateIgloo({ type, music, flooring, location, furniture });
    prst(penguin);
};
exports.handleUpdateIglooNew = handleUpdateIglooNew;
const handleUpdateIglooOld = (ctx, type, ...rest) => {
    const { penguin, prst } = ctx;
    // music ID is placed at the start, though it may not be present
    const [furnitureItems, music] = rest[0].includes('|')
        ? [rest, 0]
        : [rest.slice(1), Number(rest[0])];
    const igloo = processFurniture(furnitureItems);
    penguin.igloo.updateIgloo({ furniture: igloo, type: Number(type), music });
    prst(penguin);
};
exports.handleUpdateIglooOld = handleUpdateIglooOld;
const handleGetFurniture = (ctx) => {
    const { msg, penguin } = ctx;
    const furniture = penguin.igloo.getAllFurniture().flatMap(([id, amount]) => new Array(amount).fill(id));
    msg.send(penguin, 'gf', ...furniture);
};
exports.handleGetFurniture = handleGetFurniture;
const handleGetFurnitureNew = ({ msg, penguin }) => {
    msg.send(penguin, 'gf', ...penguin.igloo.getAllFurniture().map(pair => pair.join('|')));
};
exports.handleGetFurnitureNew = handleGetFurnitureNew;
const handleOpenIgloo = (ctx) => {
    const { world, penguin } = ctx;
    world.openIgloo(penguin);
};
exports.handleOpenIgloo = handleOpenIgloo;
const handleCloseIgloo = (ctx) => {
    const { world, penguin } = ctx;
    world.closeIgloo(penguin);
};
exports.handleCloseIgloo = handleCloseIgloo;
const handleGetOpenIgloos = (ctx) => {
    const { msg, penguin, world } = ctx;
    // TODO need to figure out how to make this penguin "nickname" properly display
    // on showHint, without modding. Seems to require an old shell
    // (and for the newer shells, what is the proper map SWF to use?)
    //TODO sendXtEmptyLast?
    msg.send(penguin, 'gr', ...world.getOpenIglooPlayers().map(p => `${p.id}|${p.name}`));
};
exports.handleGetOpenIgloos = handleGetOpenIgloos;
const handleUpdateMusic = (ctx, music) => {
    const { penguin, prst } = ctx;
    penguin.igloo.updateIgloo({ music });
    prst(penguin);
};
exports.handleUpdateMusic = handleUpdateMusic;
const handleGetIglooTypes = ({ msg, penguin }) => {
    msg.send(penguin, 'go', penguin.igloo.types.join('|'));
};
exports.handleGetIglooTypes = handleGetIglooTypes;
const handleGetIglooLikes = ({ msg, penguin }) => {
    const id = 1; // TODO Unsure what this ID is
    const likeCount = 0; // TODO like system
    // TODO unsure what this 200 is
    msg.send(penguin, 'gili', id, 200, JSON.stringify({
        likedby: {
            counts: {
                count: likeCount,
                maxCount: likeCount,
                accumCount: likeCount
            },
            IDs: []
        }
    }));
};
exports.handleGetIglooLikes = handleGetIglooLikes;
const handleGetDj3kTracks = ({ msg, penguin }) => {
    msg.send(penguin, 'ggd', '');
};
exports.handleGetDj3kTracks = handleGetDj3kTracks;
const handleGetAllIglooLayouts = ({ msg, penguin }) => {
    const layouts = penguin.igloo.getAllLayouts().map(([index, layout]) => {
        return getModernIglooString(layout, index);
    });
    // TODO unsure what the 0 is
    msg.send(penguin, 'gail', penguin.id, 0, ...layouts);
};
exports.handleGetAllIglooLayouts = handleGetAllIglooLayouts;
const handleAddIglooLayout = ({ msg, penguin, prst }) => {
    const [id, igloo] = penguin.igloo.addIglooLayout();
    // TODO document better what this slot-index is for in the engine 3 string
    msg.send(penguin, 'al', penguin.id, getModernIglooString(igloo, id));
    prst(penguin);
};
exports.handleAddIglooLayout = handleAddIglooLayout;
const handleUpdateIglooLayout = ({ prst, penguin }, layoutId, locks) => {
    penguin.igloo.setActiveIgloo(layoutId);
    locks.split(',').map(str => str.split('|')).forEach(([i, locked]) => {
        penguin.igloo.setLocked(Number(i), locked === '1');
    });
    prst(penguin);
};
exports.handleUpdateIglooLayout = handleUpdateIglooLayout;
const handleAddIglooLocation = ({ prst, penguin, msg }, location) => {
    penguin.igloo.addIglooLocation(location);
    // TODO cost deducting
    msg.send(penguin, 'aloc', location, penguin.currency.coins);
    prst(penguin);
};
exports.handleAddIglooLocation = handleAddIglooLocation;
const handleGetMusicTracks = ({ msg, penguin }) => {
    const playerTracks = []; // TODO player tracks
    msg.send(penguin, 'getmymusictracks', playerTracks.length, playerTracks.join(','));
};
exports.handleGetMusicTracks = handleGetMusicTracks;
