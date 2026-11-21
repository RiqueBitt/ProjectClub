"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlayerIglooOpen = exports.handleGetMusicTracks = exports.handleAddIglooLocation = exports.handleUpdateIglooLayout = exports.handleAddIglooLayout = exports.handleGetAllIglooLayouts = exports.handleGetDj3kTracks = exports.handleGetNamesBySwid = exports.handleGetIglooLikes = exports.handleLikeIgloo = exports.handleCanLikeIgloo = exports.handleGetIglooTypes = exports.handleUpdateMusic = exports.handleGetOpenIgloos = exports.handleCloseIgloo = exports.handleOpenIgloo = exports.handleGetFurnitureNew = exports.handleGetFurniture = exports.handleUpdateIglooOld = exports.handleUpdateIglooNew = exports.handleUpdateIgloo = exports.handleAddFlooring = exports.handleUpdateIglooType = exports.handleAddIgloo = exports.handleAddFurniture = exports.handleGetIglooItems = exports.handleGetIglooCpip = exports.getIglooOld = void 0;
exports.getIglooFromId = getIglooFromId;
exports.getFurnitureString = getFurnitureString;
exports.processFurniture = processFurniture;
exports.swidOf = swidOf;
exports.idOfSwid = idOfSwid;
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
function getModernIglooString(igloo, index, likeCount = 0) {
    return [
        igloo.id,
        index,
        0, // TODO don't know what this is
        igloo.locked ? 1 : 0,
        igloo.music,
        igloo.flooring,
        // local 0 não existe: o cliente 2012 trava a fila de carregamento ao não
        // achar o local e os móveis não aparecem ao entrar no iglu → "Padrão" (1)
        igloo.location || 1,
        igloo.type,
        likeCount,
        getFurnitureString(igloo.furniture)
    ].join(':');
}
const handleGetIglooCpip = async ({ world, db, penguin, msg, data }, penguinId) => {
    // Dono offline (ex.: visitar a casa de um amigo pela lista de amigos): o iglu
    // vem do banco. Antes só respondia com o dono online e o cliente ficava
    // carregando pra sempre esperando o 'gm'.
    let igloo;
    try {
        igloo = await getIglooFromId(world, db, penguinId);
    }
    catch {
        igloo = undefined;
    }
    if (igloo === undefined) {
        // sem dados: iglu básico vazio (nunca deixa a tela de carregamento presa)
        igloo = { id: 1, type: 1, music: 0, flooring: 0, furniture: [], locked: false, location: 1 };
    }
    if (!data.isVanillaEngine()) {
        msg.send(penguin, 'gm', penguinId, igloo.type, igloo.music, igloo.flooring, getFurnitureString(igloo.furniture));
    }
    else {
        let likes = 0;
        try {
            likes = countLikes((await getOwnerLikes(world, db, penguinId)).likes, igloo.id);
        }
        catch { /* sem curtidas */ }
        msg.send(penguin, 'gm', penguinId, getModernIglooString(igloo, 1, likes));
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
    penguin.igloo.updateIgloo({ type, music, flooring, location: location || 1, furniture });
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
// ---- Curtidas no iglu (botão de "curtir" do iglu dos amigos) ----
// Cada pinguim guarda as curtidas que os iglus dele receberam:
// iglooLikes[layout][quemCurtiu] = [curtidas, última curtida (ms)].
// Dá pra curtir o mesmo iglu uma vez por dia (como no jogo original).
const LIKE_PERIOD_MS = 24 * 60 * 60 * 1000;
/** SWID falso (o cliente identifica quem curtiu pelo SWID): guarda o id do pinguim. */
function swidOf(id) {
    return `{00000000-0000-0000-0000-${String(id).padStart(12, '0')}}`;
}
function idOfSwid(swid) {
    const m = /([0-9]{1,12})\}?\s*$/.exec(String(swid));
    return m ? Number(m[1]) : null;
}
function countLikes(likes, layoutId) {
    return Object.values(likes[String(layoutId)] ?? {}).reduce((sum, [count]) => sum + count, 0);
}
async function getOwnerLikes(world, db, ownerId) {
    const live = world.getById(ownerId);
    if (live !== undefined) {
        return { live, likes: live.iglooLikes };
    }
    const json = await db.get(ownerId);
    if (json === null) {
        return { likes: {} };
    }
    json.iglooLikes = json.iglooLikes ?? {};
    return { json, likes: json.iglooLikes };
}
/** Dono e layout do iglu onde o pinguim está agora (ou null se não está num iglu). */
async function currentIgloo(world, db, penguin) {
    const room = world.getPenguinRoom(penguin);
    if (room === undefined || room.id < 2000) {
        return null;
    }
    const ownerId = room.id - 2000;
    const igloo = await getIglooFromId(world, db, ownerId).catch(() => undefined);
    return { ownerId, layoutId: igloo?.id ?? 1 };
}
function canLikeInfo(likes, layoutId, likerId, ownerId, now = Date.now()) {
    if (likerId === ownerId) {
        return { canLike: false, nextLike_msecs: 0 };
    }
    const entry = likes[String(layoutId)]?.[String(likerId)];
    const wait = entry === undefined ? 0 : entry[1] + LIKE_PERIOD_MS - now;
    return { canLike: wait <= 0, nextLike_msecs: Math.max(0, Math.round(wait)) };
}
const handleCanLikeIgloo = async ({ msg, penguin, world, db }) => {
    const where = await currentIgloo(world, db, penguin);
    if (where === null) {
        msg.send(penguin, 'cli', 0, 204, JSON.stringify({ canLike: false, periodicity: 'ScheduleDaily', nextLike_msecs: 0 }));
        return;
    }
    const { likes } = await getOwnerLikes(world, db, where.ownerId);
    const info = canLikeInfo(likes, where.layoutId, penguin.id, where.ownerId);
    msg.send(penguin, 'cli', where.layoutId, 200, JSON.stringify({ ...info, periodicity: 'ScheduleDaily' }));
};
exports.handleCanLikeIgloo = handleCanLikeIgloo;
const handleLikeIgloo = async ({ msg, penguin, world, db, prst }) => {
    const where = await currentIgloo(world, db, penguin);
    if (where === null) {
        return;
    }
    const owner = await getOwnerLikes(world, db, where.ownerId);
    const now = Date.now();
    if (!canLikeInfo(owner.likes, where.layoutId, penguin.id, where.ownerId, now).canLike) {
        msg.send(penguin, 'li', where.layoutId, 409, '{}');
        return;
    }
    const layout = (owner.likes[String(where.layoutId)] ??= {});
    const prev = layout[String(penguin.id)] ?? [0, 0];
    layout[String(penguin.id)] = [prev[0] + 1, now];
    if (owner.live !== undefined) {
        prst(owner.live);
    }
    else if (owner.json !== undefined) {
        await db.write(where.ownerId, owner.json);
    }
    const total = countLikes(owner.likes, where.layoutId);
    msg.send(penguin, 'li', where.layoutId, 200, JSON.stringify({ count: total }));
    const room = world.getPenguinRoom(penguin);
    const others = (room?.players ?? []).filter((p) => p !== penguin);
    if (others.length > 0) {
        msg.send(others, 'lue', swidOf(penguin.id), total);
    }
};
exports.handleLikeIgloo = handleLikeIgloo;
const handleGetIglooLikes = async ({ msg, penguin, world, db }, start, size) => {
    const where = await currentIgloo(world, db, penguin);
    // fora de um iglu: o próprio iglu ativo (ex.: tela de edição)
    const ownerId = where?.ownerId ?? penguin.id;
    const layoutId = where?.layoutId ?? penguin.igloo.activeIgloo?.id ?? 1;
    const { likes } = await getOwnerLikes(world, db, ownerId);
    const entries = Object.entries(likes[String(layoutId)] ?? {})
        .sort((a, b) => b[1][1] - a[1][1]);
    const count = entries.reduce((sum, [, [c]]) => sum + c, 0);
    const from = Number.isFinite(start) ? Math.max(0, start) : 0;
    const len = Number.isFinite(size) && size > 0 ? Math.min(size, 100) : 20;
    const IDs = entries.slice(from, from + len).map(([id, [c, t]]) => ({
        id: swidOf(Number(id)),
        count: c,
        time: t,
        isFriend: penguin.buddy.isBuddy(Number(id)),
    }));
    msg.send(penguin, 'gili', layoutId, 200, JSON.stringify({
        likedby: {
            counts: { count, maxCount: count, accumCount: count },
            IDs
        }
    }));
};
exports.handleGetIglooLikes = handleGetIglooLikes;
/** u#pbsu: nomes a partir dos SWIDs (janela de curtidas). */
const handleGetNamesBySwid = async ({ msg, penguin, world, db }, swids) => {
    const list = String(swids ?? '').split(',').filter((s) => s.length > 0).slice(0, 100);
    const names = await Promise.all(list.map(async (swid) => {
        const id = idOfSwid(swid);
        if (id === null)
            return '';
        const live = world.getById(id);
        if (live !== undefined)
            return live.name;
        try {
            return (await db.get(id))?.name ?? '';
        }
        catch {
            return '';
        }
    }));
    msg.send(penguin, 'pbsu', names.join(','));
};
exports.handleGetNamesBySwid = handleGetNamesBySwid;
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
/**
 * "O iglu deste pinguim está aberto?" (g#pio) — o cartão do jogador só mostra
 * o botão de visitar a casa com a resposta. Amigos sempre podem entrar; os
 * outros, quando o iglu não está trancado.
 */
const handlePlayerIglooOpen = async ({ world, db, msg, penguin }, ownerId) => {
    let open = true;
    if (ownerId !== penguin.id && !penguin.buddy.isBuddy(ownerId)) {
        try {
            const igloo = await getIglooFromId(world, db, ownerId);
            open = igloo === undefined ? true : !igloo.locked;
        }
        catch {
            open = true;
        }
    }
    msg.send(penguin, 'pio', open ? 1 : 0);
};
exports.handlePlayerIglooOpen = handlePlayerIglooOpen;
