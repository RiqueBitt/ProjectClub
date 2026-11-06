"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTINGS_PATH = exports.MOD_MUSIC_FILE = exports.MOD_HACKS_FILE = exports.MOD_ITEMS_FILE = exports.MODS_DIRECTORY = exports.USER_DATA_FOLDER = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Pasta de dados do jogo no Project Club (configurações, mods, pinguins no
 * modo avulso). Em produção os pinguins ficam no MySQL (ver
 * server/src/services/waddle/penguinStore.js); aqui só ficam coisas leves.
 *
 * WADDLE_DATA_DIR  → caminho absoluto (padrão: server/data/waddle)
 */
exports.USER_DATA_FOLDER = process.env.WADDLE_DATA_DIR
    ? path_1.default.resolve(process.env.WADDLE_DATA_DIR)
    : path_1.default.resolve(__dirname, '..', '..', '..', 'data', 'waddle');
exports.MODS_DIRECTORY = path_1.default.join(exports.USER_DATA_FOLDER, 'mods');
/** name of the file that contains custom items in a mod */
exports.MOD_ITEMS_FILE = 'items.json';
/** name of the file that contains the custom frame hacks in a mod */
exports.MOD_HACKS_FILE = 'frames.json';
exports.MOD_MUSIC_FILE = 'music.json';
exports.SETTINGS_PATH = path_1.default.join(exports.USER_DATA_FOLDER, 'settings.json');
fs_1.default.mkdirSync(exports.USER_DATA_FOLDER, { recursive: true });
