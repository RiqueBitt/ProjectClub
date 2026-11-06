"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupLoginServer = exports.LoginServer = void 0;
const servers_1 = require("../servers/index.js");
const socket_server_1 = require("./socket-server");
const messenger_1 = require("./messenger.js");
const login_handlers_1 = require("./login-handlers");
class LoginServer {
    gameData;
    settings;
    db;
    _msg;
    _handler;
    constructor(gameData, settings, db) {
        this.gameData = gameData;
        this.settings = settings;
        this.db = db;
        this._msg = new messenger_1.PenguinMessenger();
        this._handler = (0, login_handlers_1.createLoginXmlHandler)();
    }
    handle(client, message) {
        this._handler.handle({
            msg: this._msg,
            data: this.gameData,
            settings: this.settings,
            db: this.db,
            client
        }, message);
    }
    ;
    async disconnect() { }
}
exports.LoginServer = LoginServer;
const setupLoginServer = async (settings, db, gameData) => {
    const loginServer = new LoginServer(gameData, settings, db);
    await (0, socket_server_1.setupSocketServer)('login', servers_1.LOGIN_PORT, loginServer);
};
exports.setupLoginServer = setupLoginServer;
