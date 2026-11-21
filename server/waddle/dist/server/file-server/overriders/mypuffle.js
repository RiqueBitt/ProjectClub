"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideMyPuffle = overrideMyPuffle;
const files_1 = require("../../game-data/files.js");
async function overrideMyPuffle(d, s, b) {
    if (s.settings.modern_my_puffle) {
        return (0, files_1.getMediaFile)('unknown:my_puffle_2013.swf');
    }
    return b;
}
