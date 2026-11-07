"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModManager = exports.ModError = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("../common/paths.js");
const items_1 = require("./game-logic/items");
const utils_1 = require("../common/utils.js");
const frame_hacks_1 = require("./game-data/frame-hacks");
const rooms_1 = require("./game-data/rooms");
// object used for validating objects at runtime
const customItemKeys = {
    cost: 'number',
    id: 'number',
    'isBack': 'boolean',
    'isMember': 'boolean',
    'layer': 'number',
    'name': 'string',
    'type': 'number'
};
const customHackKeys = {
    'body': 'number',
    'face': 'number',
    'feet': 'number',
    'frame': 'number',
    'hand': 'number',
    'head': 'number',
    'neck': 'number',
    'secret_frame': 'number'
};
/** Name of file that tracks the active mods */
const ACTIVE_MODS_FILE = '.active_mods';
const modsSettingsPath = path_1.default.join(paths_1.MODS_DIRECTORY, ACTIVE_MODS_FILE);
if (!fs_1.default.existsSync(paths_1.MODS_DIRECTORY)) {
    fs_1.default.mkdirSync(paths_1.MODS_DIRECTORY);
}
if (!fs_1.default.existsSync(modsSettingsPath)) {
    fs_1.default.writeFileSync(modsSettingsPath, '');
}
// macOS folder file
const MAC_FOLDER_FILE = '.DS_Store';
const FORBIDDEN_FOLDER_NAMES = new Set([
    ACTIVE_MODS_FILE,
    MAC_FOLDER_FILE
]);
const FORBIDDEN_FILE_NAMES = new Set([
    paths_1.MOD_ITEMS_FILE,
    paths_1.MOD_HACKS_FILE,
    MAC_FOLDER_FILE
]);
/** Errors raised from incorrect JSON in mods */
class ModError extends Error {
}
exports.ModError = ModError;
function getModFile(file, mod) {
    const filePath = path_1.default.join(paths_1.MODS_DIRECTORY, mod, file);
    if (fs_1.default.existsSync(filePath)) {
        try {
            return {
                type: 'exists',
                content: JSON.parse(fs_1.default.readFileSync(filePath, { encoding: 'utf-8' }))
            };
        }
        catch (error) {
            if (!(error instanceof SyntaxError)) {
                throw error;
            }
            return {
                type: 'parseerror'
            };
        }
    }
    return {
        type: 'none'
    };
}
/** Helper function that parses a JSON file for an array of objects */
function parseObjectArrayJSON(file, mod, name, keyTypes) {
    const modContent = getModFile(file, mod);
    if (modContent.type !== 'none') {
        const objs = modContent.type === 'exists' ? modContent.content : undefined;
        if (!Array.isArray(objs)) {
            throw new ModError(`Your mod contains invalid JSON in the ${name} file, there should be an array (square brackets) with items inside.`);
        }
        objs.forEach((obj, i) => {
            if (typeof obj !== 'object' || obj === null) {
                throw new ModError(`Invalid JSON member inside the array (square brackets) inside the ${name} file (element at index ${i}). It should contain an object which is defined with curly brackets`);
            }
            (0, utils_1.iterateEntries)(keyTypes, (key, type) => {
                if (!(key in obj) || typeof obj[key] !== type) {
                    throw new ModError(`Invalid value for the ${key} of the item at index ${i}: ${key} must be a ${type}`);
                }
            });
        });
        return objs;
    }
    return [];
}
/** Abstraction for a mod and its extensions. Will raise an error in the constructor if any of the JSONs are faulty */
class Mod {
    name;
    items;
    hacks;
    music;
    // all file routes that this mod serves
    files;
    constructor(name) {
        this.name = name;
        this.items = this.getItems();
        this.hacks = this.getHacks();
        this.music = this.getMusic();
        this.files = (0, utils_1.getFilesInDirectory)(path_1.default.join(paths_1.MODS_DIRECTORY, this.name)).filter(file => {
            return !FORBIDDEN_FILE_NAMES.has(file);
        });
    }
    loadCustomItems() {
        this.items.forEach(item => items_1.ITEMS.addCustomItem(item));
    }
    unloadCustomItems() {
        this.items.forEach(item => {
            items_1.ITEMS.removeCustomItem(item.id);
        });
    }
    loadCustomFrameHacks() {
        frame_hacks_1.FRAME_HACKS.addCustom(this.name, this.hacks);
    }
    unloadCustomFrameHacks() {
        frame_hacks_1.FRAME_HACKS.removeCustom(this.name);
    }
    getFiles() {
        return this.files;
    }
    getName() {
        return this.name;
    }
    getItems() {
        const items = parseObjectArrayJSON(paths_1.MOD_ITEMS_FILE, this.name, 'items', customItemKeys);
        // mods can't override items that already exist
        const conflicts = items.filter(obj => {
            return items_1.ITEMS.has(obj.id);
        });
        if (conflicts.length > 0) {
            throw new ModError(`There was a conflict of item IDs, either with another mod, or with an item from the original game. Conflicting item IDs: ${conflicts.map(item => item.id).join(', ')}`);
        }
        return items;
    }
    getHacks() {
        return parseObjectArrayJSON(paths_1.MOD_HACKS_FILE, this.name, 'frames', customHackKeys);
    }
    getMusic() {
        const fileContent = getModFile(paths_1.MOD_MUSIC_FILE, this.name);
        if (fileContent.type === 'none') {
            return new Map();
        }
        if (fileContent.type === 'parseerror') {
            throw new ModError('Your mod contains an error in the music file. Please review the syntax of your JSON file');
        }
        const content = fileContent.content;
        const map = new Map();
        if (Array.isArray(content)) {
            throw new ModError('Your mod contains incorrect JSON for the music file. It contains an array (square brackets) when it should include an object (curly brackets). Please review the syntax of the file');
        }
        for (const key of Object.keys(content)) {
            if (!(key in rooms_1.ROOMS)) {
                throw new ModError(`Unknown room name in music file: ${key}. Check the list of valid room names if you are unsure`);
            }
            if (typeof content[key] !== 'number') {
                throw new ModError(`Non number music found for room ${key} in the music file. Please change it to be the ID of a music file`);
            }
            map.set(key, content[key]);
        }
        return map;
    }
    getRoomsMusic() {
        return this.music;
    }
}
/** Manages all of the integration of the user mods */
class ModManager {
    /** Cache flag that becomes true whenever the game detects any mod in the game folder */
    usingMods = false;
    _activeMods;
    updateListener = new utils_1.EventListener();
    constructor() {
        this._activeMods = new Map();
        // initializing usingMods cache
        this.getMods();
    }
    getMods() {
        const mods = fs_1.default.readdirSync(paths_1.MODS_DIRECTORY).filter((name) => !FORBIDDEN_FOLDER_NAMES.has(name));
        this.usingMods = mods.length > 0;
        return mods;
    }
    getActiveMods() {
        return this._activeMods.values();
    }
    getActiveModNames() {
        return this._activeMods.keys();
    }
    /** Enables all the mods that the active mods file said are supposed to be active, filtering and returning the mods that raised an error */
    initializeMods() {
        const activeMods = fs_1.default.readFileSync(modsSettingsPath, { encoding: 'utf-8' }).split('\n').map((value) => value.trim()).filter((value) => value !== '');
        const failedMods = [];
        for (const modName of activeMods) {
            try {
                const mod = new Mod(modName);
                mod.loadCustomItems();
                mod.loadCustomFrameHacks();
                this._activeMods.set(modName, mod);
            }
            catch (e) {
                if (e instanceof ModError) {
                    failedMods.push(modName);
                }
            }
        }
        this.writeActiveMods();
        return failedMods;
    }
    addListener(callback) {
        this.updateListener.addListener(callback);
    }
    writeActiveMods() {
        this.updateListener.fire();
        fs_1.default.writeFileSync(modsSettingsPath, [...this.getActiveModNames()].join('\n'));
    }
    /** Attempts to enable a mod. Will raise an error if the mod is incorrect */
    setModActive(name) {
        const mod = new Mod(name);
        mod.loadCustomItems();
        mod.loadCustomFrameHacks();
        this._activeMods.set(name, mod);
        this.writeActiveMods();
    }
    setModInactive(name) {
        const mod = this._activeMods.get(name);
        if (mod !== undefined) {
            mod.unloadCustomItems();
            mod.unloadCustomFrameHacks();
            this._activeMods.delete(name);
            this.writeActiveMods();
        }
    }
    isModActive(name) {
        return this._activeMods.has(name);
    }
    getMusic() {
        return [...this._activeMods.values()].map(m => m.getRoomsMusic()).reduce((previous, current) => new Map([...previous, ...current]), new Map());
    }
}
exports.ModManager = ModManager;
