"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeSwf30Fps = makeSwf30Fps;
const manipulate_1 = require("../../../common/flash/manipulate.js");
async function makeSwf30Fps(d, s, b) {
    if (typeof b === 'string') {
        b = Buffer.from(b);
    }
    if (s.settings.fps30) {
        b = (0, manipulate_1.changeFrameRate)(b, 30);
    }
    return b;
}
