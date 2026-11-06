"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideMedievalSound = overrideMedievalSound;
const files_1 = require("../../game-data/files.js");
async function overrideMedievalSound(d, s, b) {
    if (s.settings.medieval_sound_fix) {
        return await (0, files_1.getMediaFile)('archives:RoomsParty24-11Feb2014.swf');
    }
    return b;
}
