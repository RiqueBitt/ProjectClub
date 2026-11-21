"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPenguinActionFramesJson = getPenguinActionFramesJson;
const frame_hacks_1 = require("../game-data/frame-hacks.js");
function getPenguinActionFramesJson(d) {
    return frame_hacks_1.FRAME_HACKS.getJSON();
}
