"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOverrider = exports.REGEX_OVERRIDERS = exports.OVERRIDERS = void 0;
const _30fps_1 = require("./30fps");
const index_html_1 = require("./index.html");
const load_swf_1 = require("./load.swf");
const mods_1 = require("./mods");
const mypuffle_1 = require("./mypuffle");
const sound_fix_1 = require("./sound-fix");
exports.OVERRIDERS = {
    '': index_html_1.overrideIndexHtml,
    'load.swf': load_swf_1.overrideLoadSwf,
    'play/v2/client/load.swf': _30fps_1.makeSwf30Fps,
    'play/v2/load.swf': _30fps_1.makeSwf30Fps,
    'boots.swf': _30fps_1.makeSwf30Fps,
    'play/v2/client/club_penguin.swf': _30fps_1.makeSwf30Fps,
    'play/v2/games/book1/bootstrap.swf': mypuffle_1.overrideMyPuffle,
    'play/v2/games/dancing/dance.swf': mods_1.overrideDanceContest,
    'play/v2/games/jetpack/JetpackAdventures.swf': mods_1.overrideJPALevelSelector,
    'play/v2/games/thinice/ThinIce.swf': mods_1.overrideThinIce,
    'play/v2/games/pufflescape/RollerscapeCP_CP.swf': mods_1.overrideRollerscape,
    'play/v2/content/global/rooms/party24.swf': sound_fix_1.overrideMedievalSound
};
exports.REGEX_OVERRIDERS = [
    [/^chat\d+\.swf$/, _30fps_1.makeSwf30Fps]
];
class FileOverrider {
    gameData;
    settings;
    overriders;
    regexOverriders;
    constructor(gameData, settings, overriders, regexOverriders) {
        this.gameData = gameData;
        this.settings = settings;
        this.overriders = new Map(Object.entries(overriders));
        this.regexOverriders = [...regexOverriders];
    }
    async override(route, binary) {
        let func = this.overriders.get(route);
        if (func === undefined) {
            for (const [key, overrider] of this.regexOverriders) {
                if (key.test(route)) {
                    func = overrider;
                    break;
                }
            }
        }
        if (func === undefined) {
            return binary;
        }
        else {
            return await func(this.gameData, this.settings, binary);
        }
    }
}
exports.FileOverrider = FileOverrider;
