"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMods = startMods;
exports.startServices = startServices;
exports.createWaddle = createWaddle;
const database_1 = require("./database/database");
const constants_1 = require("../common/constants.js");
const paths_1 = require("../common/paths.js");
const settings_1 = __importDefault(require("./settings"));
const game_data_1 = require("./timelines/game-data");
const http_1 = require("./http");
const world_server_1 = require("./socket-server/world-server");
const login_server_1 = require("./socket-server/login-server");
const socket_server_1 = require("./socket-server/socket-server");
/** Initialize the mods. Returns a list of any that failed to start. */
function startMods() {
    return settings_1.default.mods.initializeMods();
}
/** Initialize the db, game data, and the 3 services (http, login, world). Returns the world server. */
async function startServices() {
    const data = new database_1.DataFolder(paths_1.USER_DATA_FOLDER);
    data.init(constants_1.VERSION);
    const gameData = new game_data_1.GameData(settings_1.default);
    const db = new database_1.FilePenguinRepository(data.getPath());
    await (0, database_1.ensureMascots)(db);
    await (0, login_server_1.setupLoginServer)(settings_1.default, db, gameData);
    const world = await (0, world_server_1.setupWorldServer)(settings_1.default, db, gameData);
    await (new http_1.HttpServer(gameData, settings_1.default, db)).setupServer();
    return world;
}
/**
 * Modo embutido (Project Club): monta tudo SEM abrir porta nenhuma. Quem chama
 * pendura o router HTTP no Express do site e entrega os WebSockets via attach().
 */
async function createWaddle(options = {}) {
    const settings = settings_1.default;
    if (options.targetIP)
        settings.targetIP = options.targetIP;
    if (options.targetPort)
        settings.targetPort = options.targetPort;
    settings.relativeUrls = true;
    // WADDLE_VERSION=auto (padrão no Project Club): data do jogo = hoje, no ano
    // da linha do tempo (WADDLE_CALENDAR_YEAR, padrão 2012).
    const wanted = (process.env.WADDLE_VERSION || 'auto').trim();
    if (wanted === 'auto') {
        settings.followCalendar(Number(process.env.WADDLE_CALENDAR_YEAR) || 2012);
    }
    else if (settings.settings.version !== wanted) {
        settings.updateSettings({ version: wanted });
    }
    startMods();
    let db = options.db;
    if (db === undefined) {
        const data = new database_1.DataFolder(paths_1.USER_DATA_FOLDER);
        data.init(constants_1.VERSION);
        db = new database_1.FilePenguinRepository(data.getPath());
    }
    await (0, database_1.ensureMascots)(db);
    const gameData = new game_data_1.GameData(settings);
    const world = new world_server_1.WorldServer(settings, gameData, db);
    const login = new login_server_1.LoginServer(gameData, settings, db);
    const http = new http_1.HttpServer(gameData, settings, db);
    const handlers = { login, world };
    return {
        settings,
        gameData,
        db,
        world,
        login,
        http,
        attach: (kind, ws, transform) => (0, socket_server_1.attachWebSocket)(kind, ws, handlers[kind], transform),
    };
}
