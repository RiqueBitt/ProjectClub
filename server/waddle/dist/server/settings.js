"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsManager = void 0;
const fs_1 = __importDefault(require("fs"));
const paths_1 = require("../common/paths");
const versions_1 = require("./routes/versions");
const constants_1 = require("../common/constants");
const servers_1 = require("./servers");
const mods_1 = require("./mods");
const utils_1 = require("../common/utils.js");
class SettingsManager {
    settings;
    mods;
    /** IP used by the server */
    targetIP;
    /** HTTP port used by the server, undefined if default */
    _targetPort;
    updateListener = new utils_1.EventListener();
    set targetPort(port) {
        this._targetPort = port;
    }
    get targetPort() {
        return this._targetPort ?? constants_1.HTTP_PORT;
    }
    constructor() {
        let settingsJson = {};
        if (fs_1.default.existsSync(paths_1.SETTINGS_PATH)) {
            settingsJson = JSON.parse(fs_1.default.readFileSync(paths_1.SETTINGS_PATH, { encoding: 'utf-8' }));
        }
        this.mods = new mods_1.ModManager();
        this.settings = {
            fps30: this.readBoolean(settingsJson, 'fps30', false),
            thin_ice_igt: this.readBoolean(settingsJson, 'thin_ice_igt', false),
            clothing: this.readBoolean(settingsJson, 'clothing', true),
            modern_my_puffle: this.readBoolean(settingsJson, 'modern_my_puffle', false),
            remove_idle: this.readBoolean(settingsJson, 'remove_idle', false),
            jpa_level_selector: this.readBoolean(settingsJson, 'jpa_level_selector', false),
            swap_dance_arrow: this.readBoolean(settingsJson, 'swap_dance_arrow', false),
            version: this.readVersion(settingsJson),
            always_member: this.readBoolean(settingsJson, 'always_member', true),
            minified_website: this.readBoolean(settingsJson, 'minified_website', false),
            no_rainbow_quest_wait: this.readBoolean(settingsJson, 'no_rainbow_quest_wait', false),
            no_create_via_login: this.readBoolean(settingsJson, 'no_create_via_login', false),
            answered_packages: this.readString(settingsJson, 'answered_packages'),
            ignored_version: this.readString(settingsJson, 'ignored_version'),
            medieval_sound_fix: this.readBoolean(settingsJson, 'medieval_sound_fix', true),
            inventory_accuracy: this.readBoolean(settingsJson, 'inventory_accuracy', true),
            faq_warning: this.readBoolean(settingsJson, 'faq_warning', false)
        };
        this.updateSettings({});
        this.targetIP = '127.0.0.1';
        this.targetPort = constants_1.HTTP_PORT;
    }
    readString(object, property) {
        const value = object[property];
        if (typeof value === 'string') {
            return value;
        }
        else {
            return '';
        }
    }
    readVersion(object) {
        const value = object['version'];
        if (value === undefined || !(0, versions_1.isVersionValid)(value)) {
            // Project Club: data padrão do jogo pode vir do .env (WADDLE_VERSION)
            const env = process.env.WADDLE_VERSION;
            return env !== undefined && (0, versions_1.isVersionValid)(env) ? env : '2010-10-25';
        }
        else {
            return value;
        }
    }
    readBoolean(object, property, default_value) {
        const value = object[property];
        if (typeof value === 'boolean') {
            return value;
        }
        else {
            return default_value;
        }
    }
    updateSettings(partial) {
        this.settings = { ...this.settings, ...partial };
        fs_1.default.writeFileSync(paths_1.SETTINGS_PATH, JSON.stringify(this.settings));
        this.updateListener.fire();
    }
    addListener(callback) {
        this.updateListener.addListener(callback);
    }
    get loginPort() {
        return this.targetPort + servers_1.LOGIN_DELTA;
    }
    get worldPort() {
        return this.targetPort + servers_1.WORLD_DELTA;
    }
    getVirtualDate(offset) {
        const [year, month, day] = (0, versions_1.processVersion)(this.settings.version);
        // simulating PST time for the current day
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const second = now.getSeconds();
        // date generates this time thinking in the same timezone as the user
        // an arbitrary offset may be applied depending on how each client behaves
        return new Date(year, month - 1, day, hour + offset, minute, second);
    }
}
exports.SettingsManager = SettingsManager;
const settingsManager = new SettingsManager();
exports.default = settingsManager;
