"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideDanceContest = overrideDanceContest;
exports.overrideJPALevelSelector = overrideJPALevelSelector;
exports.overrideThinIce = overrideThinIce;
exports.overrideRollerscape = overrideRollerscape;
const files_1 = require("../../game-data/files.js");
async function overrideDanceContest(d, s, b) {
    if (s.settings.swap_dance_arrow) {
        return (0, files_1.getMediaFile)('mod:dance_contest_swapped.swf');
    }
    return b;
}
async function overrideJPALevelSelector(d, s, b) {
    if (s.settings.jpa_level_selector) {
        return (0, files_1.getMediaFile)('mod:jpa_level_selector.swf');
    }
    return b;
}
async function overrideThinIce(d, s, b) {
    if (s.settings.thin_ice_igt) {
        if (s.settings.fps30) {
            return (0, files_1.getMediaFile)('mod:thinice_igt30.swf');
        }
        else {
            return (0, files_1.getMediaFile)('mod:thinice_igt24.swf');
        }
    }
    return b;
}
async function overrideRollerscape(d, s, b) {
    if (s.settings.fps30) {
        return (0, files_1.getMediaFile)('tool:rollerscapecp_30.swf');
    }
    return b;
}
