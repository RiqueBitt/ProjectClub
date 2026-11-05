"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhpServer = void 0;
exports.getOfflinePenguinCrumb = getOfflinePenguinCrumb;
const express_1 = __importDefault(require("express"));
const express_2 = require("express");
const versions_1 = require("../../routes/versions.js");
const utils_1 = require("../../../common/utils.js");
const database_1 = require("../../database/database.js");
const join_1 = require("../../socket-server/handlers/join.js");
function getOfflinePenguinCrumb(id, penguin) {
    return [
        id,
        penguin.name,
        penguin.color,
        penguin.head,
        penguin.face,
        penguin.neck,
        penguin.body,
        penguin.hand,
        penguin.feet,
        penguin.pin,
        penguin.background,
        0, // unecessary data: room state
        0,
        0,
        penguin.is_member ? 1 : 0,
    ].join('|');
}
// todo: better organize listener declarations
const POST_LISTENERS = {
    '/create_account/create_account.php': async (body, { settings, db, session }) => {
        let res = '';
        let sid = body.sid;
        if (sid === undefined) {
            const newSID = session.generateSession();
            res += `sid=${newSID}&`;
            sid = newSID;
        }
        const sessionInfo = session.get(sid);
        if (sessionInfo === undefined) {
            return 'timeout=1&error=Session expired! Please try again';
        }
        sessionInfo.timeout = session.setTimeout(sid);
        res += `sid=${sid}&`;
        switch (body.action) {
            case 'validate_agreement':
                if (body.agree_to_rules !== '1' && body.agree_to_terms !== '1') {
                    res += 'error=Please agree to the rules and terms';
                    break;
                }
                if (body.agree_to_rules !== '1') {
                    res += 'error=Please agree to the rules';
                    break;
                }
                if (body.agree_to_terms !== '1') {
                    res += 'error=Please agree to the terms';
                    break;
                }
                res += 'success=1';
                break;
            case 'validate_username':
                if (body.username.length < 1 || body.username.length > 12) {
                    res += 'error=Please choose a username between 1 and 12 characters.';
                    break;
                }
                if (await db.exists(body.username)) {
                    res += 'error=This penguin already exists!';
                    break;
                }
                sessionInfo.username = body.username;
                sessionInfo.color = Number(body.colour);
                res += 'success=1';
                break;
            case 'validate_password_email':
                if (sessionInfo.username.length < 1) {
                    return '';
                }
                await db.create((0, database_1.getDefaultPenguin)(sessionInfo.username, sessionInfo.color, settings.settings.always_member, settings.getVirtualDate(0).getTime()));
                res += 'success=1';
                break;
        }
        return res;
    },
    '/php/join.php': async (body, { settings, db }) => {
        const name = body.Username;
        if (name.length < 3 || name.length > 12 || (await db.exists(name))) {
            return 'e=700';
        }
        await db.create((0, database_1.getDefaultPenguin)(name, Number(body.Colour), settings.settings.always_member, settings.getVirtualDate(0).getTime()));
        return 'e=0';
    },
    '/php/online.php': async () => {
        return '0';
    },
    // returns a crumb for a given player ID
    '/php/gp.php': async (body, { db }) => {
        const rawId = body.PlayerId ?? body.playerId ?? body.id;
        const penguinId = Number(rawId);
        if (!Number.isFinite(penguinId)) {
            return 'e=0&crumb=0|Unknown|0|0|0|0|0|0|0|0|0|0|0|0|0';
        }
        const penguinData = await db.get(penguinId);
        if (penguinData !== null) {
            return `e=0&crumb=${getOfflinePenguinCrumb(penguinId, penguinData)}`;
        }
        const crumb = `${penguinId}|Unknown|0|0|0|0|0|0|0|0|0|0|0|0|0`;
        return `e=0&crumb=${crumb}`;
    },
    // Logging in
    '/php/login.php': async (body, { settings, db, data }) => {
        const { Username } = body;
        let penguin = await db.fromName(Username);
        if (settings.settings.no_create_via_login && penguin === null) {
            return 'e=100';
        }
        if (penguin === null) {
            const json = (0, database_1.getDefaultPenguin)(Username, 1 /* blue as default */, settings.settings.always_member, settings.getVirtualDate(0).getTime());
            penguin = [await db.create(json), json];
        }
        const virtualDate = settings.getVirtualDate(43);
        const [id, penguinData] = penguin;
        const buddies = (await Promise.all((penguinData.buddies ?? []).map(id => new Promise((res) => {
            db.get(id).then(p => {
                if (p !== null) {
                    res([id, p.name]);
                }
                else {
                    res(null);
                }
            });
        })))).filter((p) => p !== null);
        const ignored = (await Promise.all((penguinData.ignored ?? []).map(id => new Promise((res) => {
            db.get(id).then(p => {
                if (p !== null) {
                    res([id, p.name]);
                }
                else {
                    res(null);
                }
            });
        })))).filter((p) => p !== null);
        const params = {
            crumb: getOfflinePenguinCrumb(id, penguinData),
            k1: 'a',
            c: penguinData.coins,
            s: penguinData.safeChat ? 1 : 0,
            // data real em que o pinguim foi criado (a idade do cartão usa a mesma)
            jd: (0, utils_1.getDateString)(Number.isFinite(penguinData.registration_date) && penguinData.registration_date > 0 ? penguinData.registration_date : Date.now()),
            ed: '10000-1-1', // EXPIRACY DATE TODO what is it for?
            h: '', // TODO what is?
            w: '100|0', // TODO what is?
            m: '', // TODO what is
            bl: buddies.map(([id, name]) => `${id}|${name}`).join(','),
            nl: ignored.map(([id, name]) => `${id}|${name}`).join(','),
            il: (0, join_1.filterItems)(data, penguinData.inventory).join('|'), // item list
            td: `${virtualDate.getUTCFullYear()}-${String(virtualDate.getUTCMonth()).padStart(2, '0')}-${String(virtualDate.getUTCDate()).padStart(2, '0')}:${virtualDate.getUTCHours()}:${virtualDate.getUTCMinutes()}:${virtualDate.getUTCSeconds()}` // used for the snow forts clock in later years
        };
        let response = '';
        for (const key in params) {
            response += `&${key}=${params[key]}`;
        }
        return response;
    }
};
const GET_LISTENERS = {
    '/flash/date.php': (settings) => {
        const [year, month, day] = (0, versions_1.processVersion)(settings.settings.version);
        return `output=${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${String(year % 2000).padStart(2, '0')}`;
    }
};
class SessionManager {
    _sessions = new Map();
    setTimeout(sid) {
        const session = this._sessions.get(sid);
        if (session) {
            clearTimeout(session.timeout);
        }
        return setTimeout(() => {
            this._sessions.delete(sid);
        }, 5 * 60 * 1000);
    }
    generateSession() {
        // crypto.randomUUID() can't be accessed here, so this will have to do
        const gen = () => Date.now() * Math.random();
        let sid;
        do {
            sid = String(gen());
        } while (this._sessions.has(sid));
        this._sessions.set(sid, { username: '', color: 1, timeout: this.setTimeout(sid) });
        return sid;
    }
    get(sid) {
        return this._sessions.get(sid);
    }
}
class PhpServer {
    settings;
    db;
    gameData;
    postListeners;
    getListeners;
    _sessionManager = new SessionManager();
    constructor(settings, db, gameData) {
        this.settings = settings;
        this.db = db;
        this.gameData = gameData;
        this.postListeners = new Map(Object.entries(POST_LISTENERS));
        this.getListeners = new Map(Object.entries(GET_LISTENERS));
    }
    getExpressRouter() {
        const router = (0, express_2.Router)();
        router.use(express_1.default.urlencoded({ extended: true }));
        router.use(express_1.default.json());
        this.postListeners.forEach((callback, path) => {
            router.post(path, (req, res) => {
                callback(req.body, {
                    settings: this.settings,
                    db: this.db,
                    data: this.gameData,
                    session: this._sessionManager
                }).then(r => {
                    res.send(r);
                });
            });
        });
        this.getListeners.forEach((callback, path) => {
            router.get(path, (_, res) => {
                res.send(callback(this.settings, this.db));
            });
        });
        return router;
    }
}
exports.PhpServer = PhpServer;
