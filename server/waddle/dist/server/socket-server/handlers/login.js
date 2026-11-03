"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = exports.getKey = exports.checkVersion = exports.filePolicy = void 0;
exports.sendError = sendError;
const database_1 = require("../../database/database.js");
const logger_1 = require("../../logger.js");
const world_penguin_1 = require("../world/world-penguin.js");
const servers_1 = __importStar(require("../../servers/index.js"));
function sendError(msg, p, error) {
    msg.send(p, 'e', error);
}
const filePolicy = ({ client }) => {
    client.end('<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>');
};
exports.filePolicy = filePolicy;
const checkVersion = ({ msg, client }) => {
    // version checking
    // this is irrelevant for us, we just always send an OK response
    msg.sendXml(client, 'apiOK', '', 0);
};
exports.checkVersion = checkVersion;
const getKey = ({ msg, client }) => {
    // random key generation
    // this is used for authentication, so it is not needed for us, we just send any key
    msg.sendXml(client, 'rndK', '<k>key</k>', -1);
};
exports.getKey = getKey;
const login = async (ctx, message) => {
    const { msg, data, settings, db, client } = ctx;
    const joinMatch = message.match(/<login z='j'>/);
    if (data.isPreCpip() && joinMatch) {
        // join.swf sends 'j' as the login
        msg.sendXml(client, 'logOK', '');
        return;
    }
    const nicknameMatch = message.match(/<nick><!\[CDATA\[(.*)\]\]><\/nick>/);
    if (nicknameMatch === null) {
        (0, logger_1.logdebug)('No nickname provided during Login, terminating.');
    }
    else {
        const nickname = data.isPreCpip() ? nicknameMatch[1].replace(/_/g, ' ') : nicknameMatch[1];
        // in the LOGIN world of modern clients, nickname -> ID
        // everywhere else, nickname -> name
        // account creation only happens when given name, not when given ID
        const modernLogin = ('world' in ctx && data.isVanillaEngine());
        if (!modernLogin) {
            if (!await db.exists(nickname)) {
                // todo: error 101 is incorrect password
                if (settings.settings.no_create_via_login) {
                    sendError(msg, client, 100);
                    return;
                }
                const json = (0, database_1.getDefaultPenguin)(nickname, 1 /* blue */, settings.settings.always_member, settings.getVirtualDate(0).getTime());
                await db.create(json);
            }
        }
        const idTest = modernLogin ? Number(nickname) : await db.fromName(nickname);
        if (idTest === null) {
            throw new Error(`Could not find penguin with name: ${nickname}`);
        }
        const id = typeof idTest === 'number' ? idTest : idTest[0];
        if ('world' in ctx) {
            const offline = await ctx.off.getPenguin(id);
            if (offline === undefined) {
                throw new Error('Couldn\'t find penguin');
            }
            const p = new world_penguin_1.WorldPenguin(id, offline.getJSON(), settings);
            ctx.off.removePenguin(offline.id);
            ctx.world.addPenguin(p);
            msg.linkClient(client, p);
        }
        console.log(`${nickname} is logging in`);
        /*
        TODO
        buddies
        how will server size be handled after NPCs?
        */
        // information regarding how many populations are in each server
        msg.send(client, 'l', id, id, '', servers_1.default.map((server) => {
            const population = server.name === 'Blizzard' ? 5 : (0, servers_1.getServerPopulation)();
            return `${server.id},${population}`;
        }).join('|'));
    }
};
exports.login = login;
