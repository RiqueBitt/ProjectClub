"use strict";
// ZAAAA WAAAARUDO!
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWorldServer = exports.WorldServer = void 0;
const servers_1 = require("../servers/index.js");
const socket_server_1 = require("./socket-server");
const messenger_1 = require("./messenger.js");
const world_1 = require("./world/world");
const party_1 = require("./handlers/party");
const ninja_1 = require("./handlers/ninja");
const world_handlers_1 = require("./world-handlers");
const login_handlers_1 = require("./login-handlers");
const commands_1 = require("../commands/commands.js");
const offline_world_1 = require("./offline-world");
class WorldServer {
    _settings;
    _gameData;
    _db;
    _world;
    _msg = new messenger_1.PenguinMessenger();
    _off;
    _commandsHandler;
    _xtHandler;
    _xmlHandler;
    _persister;
    constructor(_settings, _gameData, _db) {
        this._settings = _settings;
        this._gameData = _gameData;
        this._db = _db;
        this._off = new offline_world_1.OfflineWorld(_db);
        this._world = new world_1.World(_gameData);
        this._commandsHandler = (0, commands_1.getCommandsHandler)();
        this._persister = (p, force = false) => {
            if (p.canSave || force) {
                this._db.write(p.id, p.getJSON());
            }
        };
        this._xtHandler = (0, world_handlers_1.createWorldXtHandler)();
        this._xmlHandler = (0, login_handlers_1.createLoginXmlHandler)();
        this.init();
    }
    // ---- Painel da equipe (Project Club) ----
    /** Pinguim conectado agora (undefined se offline). */
    getOnline(penguinId) {
        return this._world.getById(penguinId);
    }
    /** Grava o pinguim online no banco (depois de mexer nele pelo painel). */
    persist(penguin) {
        this._persister(penguin, true);
    }
    /** Manda um pacote xt pro cliente (ex.: 'ai' item adicionado). */
    notify(penguin, message, ...args) {
        this._msg.send(penguin, message, ...args);
    }
    /** Derruba a conexão do pinguim (ele entra de novo pela página). */
    kick(penguinId) {
        const penguin = this._world.getById(penguinId);
        if (penguin === undefined)
            return false;
        try {
            this._msg.getClient(penguin).end();
        }
        catch {
            return false;
        }
        return true;
    }
    runCommand(penguinId, name, args) {
        const penguin = this._world.getById(penguinId);
        if (penguin !== undefined) {
            const client = this._msg.getClient(penguin);
            this._commandsHandler.run({
                world: this._world,
                penguin,
                prst: this._persister,
                msg: this._msg,
                data: this._gameData,
                db: this._db,
                settings: this._settings,
                off: this._off,
                client,
                room: this._world.getPenguinRoom(penguin)
            }, name, args);
        }
    }
    getAllPlayersInfo() {
        return this._world.players.map(p => ({
            name: p.name,
            id: p.id
        }));
    }
    init() {
        (0, party_1.addBakeryListener)(this._world, this._msg);
        (0, ninja_1.addMatchmakerListeners)(this._world, this._msg);
    }
    async reset() {
        await Promise.all(this._msg.getClients().map(client => this.disconnect(client)));
        this._msg.close();
        this._msg = new messenger_1.PenguinMessenger();
        this._world = new world_1.World(this._gameData);
        this.init();
    }
    getContext(client) {
        const penguin = this._msg.getPenguin(client);
        return {
            world: this._world,
            msg: this._msg,
            data: this._gameData,
            settings: this._settings,
            db: this._db,
            prst: this._persister,
            off: this._off,
            client,
            ...(penguin === undefined ? {} : {
                penguin, ...this._world.getContext(penguin)
            })
        };
    }
    handle(client, message) {
        if (message.startsWith('<')) {
            this._xmlHandler.handle({
                msg: this._msg,
                data: this._gameData,
                settings: this._settings,
                db: this._db,
                off: this._off,
                client,
                world: this._world
            }, message);
        }
        else {
            this._xtHandler.handle(client, this.getContext(client), message);
        }
    }
    async disconnect(client) {
        const context = this.getContext(client);
        await this._xtHandler.disconnect(context);
    }
}
exports.WorldServer = WorldServer;
const setupWorldServer = async (settings, db, gameData) => {
    const world = new WorldServer(settings, gameData, db);
    await (0, socket_server_1.setupSocketServer)('world', servers_1.WORLD_PORT, world);
    return world;
};
exports.setupWorldServer = setupWorldServer;
